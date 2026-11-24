import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { MyCardsSummary, TaskCardDTO } from "../../src/shared/types";
import { api, createUser, login, resetAuthTables } from "./helpers";

const ids: Record<string, number> = {};
let ana = "";
let erin = "";
let mgr = "";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM task_cards").run();
  await resetAuthTables();
  ids.ana = await createUser("ana", "staff");
  ids.erin = await createUser("erin", "staff");
  ids.mgr = await createUser("mgr", "manager");
  ana = await login("ana");
  erin = await login("erin");
  mgr = await login("mgr");
});

const post = (path: string, cookie: string, json: unknown = {}) => api(path, { method: "POST", cookie, json });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
const box = async (cookie: string, which: "inbox" | "sent") =>
  (await (await api(`/api/task-cards?box=${which}`, { cookie })).json()) as TaskCardDTO[];
const summary = async (cookie: string) => (await (await api("/api/my-cards/summary", { cookie })).json()) as MyCardsSummary;

async function send(over: Record<string, unknown> = {}) {
  const res = await post("/api/task-cards", ana, { toUserId: ids.erin, note: "Call the vendor", due: { kind: "today" }, ...over });
  expect(res.status).toBe(200);
  return (await res.json()) as TaskCardDTO;
}

describe("task cards", () => {
  it("arrives in the recipient's inbox and the sender's sent list", async () => {
    const t = await send();
    const inbox = await box(erin, "inbox");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ id: t.id, note: "Call the vendor", from: { id: ids.ana, name: "ana" }, isNew: true, status: "open", bucket: "rush_today" });
    expect((await box(ana, "sent")).map((x) => x.status)).toEqual(["open"]);
    expect(await box(ana, "inbox")).toEqual([]);
    const s = await summary(erin);
    expect(s.newTasks).toBe(1);
    expect(s.newCount).toBe(1);
  });

  it("validates with clear messages", async () => {
    const bad = async (body: Record<string, unknown>, msg: string) => {
      const res = await post("/api/task-cards", ana, { toUserId: ids.erin, note: "x", due: { kind: "none" }, ...body });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe(msg);
    };
    await bad({ note: "  " }, "Write a note (up to 1000 characters).");
    await bad({ note: "x".repeat(1001) }, "Write a note (up to 1000 characters).");
    await bad({ toUserId: 99999 }, "Choose someone to send it to.");
    await bad({ due: { kind: "date", date: "2026-13-45" } }, "Choose a valid date.");
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(ids.mgr).run();
    await bad({ toUserId: ids.mgr }, "Choose someone to send it to.");
  });

  it("seen, done, and the soft alert for the sender", async () => {
    const t = await send();
    expect((await post(`/api/task-cards/${t.id}/seen`, erin)).status).toBe(200);
    expect((await box(erin, "inbox"))[0].isNew).toBe(false);
    expect((await summary(erin)).newTasks).toBe(0);

    expect((await post(`/api/task-cards/${t.id}/done`, erin)).status).toBe(200);
    expect(await box(erin, "inbox")).toEqual([]);
    let s = await summary(ana);
    expect(s.doneTasks).toBe(1);
    expect(s.newCount).toBe(0);
    const sent = await box(ana, "sent");
    expect(sent[0]).toMatchObject({ status: "done", isNew: true });
    expect(sent[0].doneAt).toBeTruthy();
    expect((await post("/api/task-cards/sent/seen", ana)).status).toBe(200);
    s = await summary(ana);
    expect(s.doneTasks).toBe(0);
  });

  it("only the recipient marks done, only the sender deletes, once", async () => {
    const t = await send();
    let res = await post(`/api/task-cards/${t.id}/done`, ana);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("This task is not yours.");
    expect((await api(`/api/task-cards/${t.id}`, { method: "DELETE", cookie: erin })).status).toBe(403);
    expect((await post(`/api/task-cards/${t.id}/done`, erin)).status).toBe(200);
    res = await post(`/api/task-cards/${t.id}/done`, erin);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("This task is already done.");
    res = await api(`/api/task-cards/${t.id}`, { method: "DELETE", cookie: ana });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("Only open tasks can be deleted.");
    expect((await post("/api/task-cards/99999/done", erin)).status).toBe(404);
  });

  it("the sender can delete an open task, even if the recipient was deactivated", async () => {
    const t = await send();
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(ids.erin).run();
    expect((await box(ana, "sent"))[0].status).toBe("open");
    expect((await api(`/api/task-cards/${t.id}`, { method: "DELETE", cookie: ana })).status).toBe(200);
    expect(await box(ana, "sent")).toEqual([]);
  });

  it("sent hides done tasks older than 30 days", async () => {
    const t = await send();
    await post(`/api/task-cards/${t.id}/done`, erin);
    await env.DB.prepare("UPDATE task_cards SET done_at = '2026-01-01T00:00:00Z' WHERE id = ?").bind(t.id).run();
    expect(await box(ana, "sent")).toEqual([]);
  });

  it("a note to self is a quiet personal note", async () => {
    const t = await send({ toUserId: ids.ana });
    expect(t).toMatchObject({ from: { id: ids.ana }, to: { id: ids.ana }, isNew: false, status: "open" });
    expect((await box(ana, "inbox")).map((x) => x.id)).toEqual([t.id]);
    let s = await summary(ana);
    expect(s).toMatchObject({ newTasks: 0, newCount: 0, activeCount: 1, doneTasks: 0 });
    // Not in Sent by me: that list is for tasks to other people.
    expect(await box(ana, "sent")).toEqual([]);
    expect((await post(`/api/task-cards/${t.id}/done`, ana)).status).toBe(200);
    s = await summary(ana);
    expect(s).toMatchObject({ newCount: 0, doneTasks: 0, activeCount: 0 });
    // Its owner can delete it while open.
    const u = await send({ toUserId: ids.ana });
    expect((await api(`/api/task-cards/${u.id}`, { method: "DELETE", cookie: ana })).status).toBe(200);
  });

  it("history lists finished tasks sent and received, newest first, 50 a page", async () => {
    const history = async (cookie: string, page = 1) =>
      (await (await api(`/api/task-cards?box=history&page=${page}`, { cookie })).json()) as { items: TaskCardDTO[]; hasMore: boolean };
    const sent = await send({ note: "Sent by ana" });
    const got = (await (await post("/api/task-cards", erin, { toUserId: ids.ana, note: "Sent to ana" })).json()) as TaskCardDTO;
    const self = await send({ toUserId: ids.ana, note: "Self" });
    const open = await send({ note: "Still open" });
    await post(`/api/task-cards/${sent.id}/done`, erin);
    await post(`/api/task-cards/${got.id}/done`, ana);
    await post(`/api/task-cards/${self.id}/done`, ana);
    const at = (id: number, iso: string) => env.DB.prepare("UPDATE task_cards SET done_at = ? WHERE id = ?").bind(iso, id).run();
    await at(sent.id, "2026-11-20T10:00:00Z");
    await at(got.id, "2026-11-22T10:00:00Z");
    await at(self.id, "2026-01-02T10:00:00Z");
    const h = await history(ana);
    expect(h.items.map((x) => x.note)).toEqual(["Sent to ana", "Sent by ana", "Self"]);
    expect(h.hasMore).toBe(false);
    expect(h.items.some((x) => x.id === open.id)).toBe(false);
    // Mgr is not part of any of them.
    expect((await history(mgr)).items).toEqual([]);
    // Paging: 50 per page.
    const stmt = env.DB.prepare(
      "INSERT INTO task_cards (from_user, to_user, note, status, created_at, done_at) VALUES (?, ?, 'Bulk', 'done', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    );
    await env.DB.batch(Array.from({ length: 50 }, () => stmt.bind(ids.erin, ids.ana)));
    const p1 = await history(ana);
    expect(p1.items).toHaveLength(50);
    expect(p1.hasMore).toBe(true);
    const p2 = await history(ana, 2);
    expect(p2.items).toHaveLength(3);
    expect(p2.hasMore).toBe(false);
    // A silly page number falls back to page 1 instead of failing.
    for (const bad of ["1e999", "-3", "abc", "2.5"]) {
      const res = await api(`/api/task-cards?box=history&page=${bad}`, { cookie: ana });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { items: TaskCardDTO[] }).items).toHaveLength(50);
    }
  });

  it("managers use the same rules", async () => {
    const res = await post("/api/task-cards", mgr, { toUserId: ids.erin, note: "Check stock", due: { kind: "date", date: "2026-12-01" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TaskCardDTO).due).toEqual({ kind: "date", date: "2026-12-01" });
  });
});
