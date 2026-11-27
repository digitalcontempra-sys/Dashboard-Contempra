import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocketDetail, DocketListResponse, TaskCardDTO } from "../../src/shared/types";
import { runSync } from "../../src/worker/sync/syncDockets";
import { errorOf, post, setupCards, teardownCards } from "./cardHelpers";
import { HEADER, row } from "./fixtures";
import { api } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
  await env.DB.batch([env.DB.prepare("DELETE FROM docket_follows"), env.DB.prepare("DELETE FROM task_cards")]);
  await runSync(env, [
    HEADER,
    row(401, { 6: "One" }),
    row(402, { 6: "Two", 1: "RUSH" }),
    row(403, { 6: "Three", 3: true }), // completed
    row(404, { 6: "Four" }),
  ]);
});
afterEach(teardownCards);

const json = async <T>(res: Response) => (await res.json()) as T;
const follow = (wo: string, cookie: string) => api(`/api/dockets/${wo}/follow`, { method: "PUT", cookie });
const unfollow = (wo: string, cookie: string) => api(`/api/dockets/${wo}/follow`, { method: "DELETE", cookie });
const list = async (qs: string, cookie: string) => json<DocketListResponse>(await api(`/api/dockets?${qs}`, { cookie }));
const wos = (r: DocketListResponse) => r.items.map((i) => i.workOrder).sort();
const note = (cookie: string, body: object) => post("/api/task-cards", cookie, { note: "Call the client", ...body });

describe("My List", () => {
  it("follow and unfollow are idempotent and personal", async () => {
    expect(await json(await follow("401", s.manager))).toEqual({ followed: true });
    expect((await follow("401", s.manager)).status).toBe(200);
    await follow("402", s.manager);
    await follow("404", s.admin);
    expect(wos(await list("list=1", s.manager))).toEqual(["401", "402"]);
    expect(wos(await list("list=1", s.admin))).toEqual(["404"]);
    expect(await json(await unfollow("401", s.manager))).toEqual({ followed: false });
    expect((await unfollow("401", s.manager)).status).toBe(200);
    expect(wos(await list("list=1", s.manager))).toEqual(["402"]);
  });

  it("unknown work order is 404, staff is 403", async () => {
    const res = await follow("999", s.manager);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("Work order not found");
    const staff = await s.staffWith("ira", "designer");
    expect((await follow("401", staff)).status).toBe(403);
  });

  it("keeps sections, counts, filters and shows closed dockets in History", async () => {
    for (const wo of ["401", "402", "403"]) await follow(wo, s.manager);
    const active = await list("list=1", s.manager);
    expect(wos(active)).toEqual(["401", "402"]);
    expect(active.counts).toMatchObject({ rush_today: 1, no_due_date: 1 });
    expect(wos(await list("list=1&bucket=rush_today", s.manager))).toEqual(["402"]);
    expect(wos(await list("list=1&q=One", s.manager))).toEqual(["401"]);
    expect(wos(await list("list=1&view=history", s.manager))).toEqual(["403"]);
  });

  it("an empty list matches nothing", async () => {
    expect((await list("list=1", s.manager)).total).toBe(0);
  });

  it("each item says if I follow it and how many open notes I have on it", async () => {
    await follow("401", s.manager);
    await note(s.manager, { toUserId: s.ids.mgr, workOrder: "401" });
    await note(s.manager, { toUserId: s.ids.mgr, workOrder: "401" });
    await note(s.admin, { toUserId: s.ids.boss, workOrder: "401" });
    const mine = (await list("", s.manager)).items.find((i) => i.workOrder === "401")!;
    expect(mine).toMatchObject({ followed: true, myOpenNotes: 2 });
    const other = (await list("", s.manager)).items.find((i) => i.workOrder === "404")!;
    expect(other).toMatchObject({ followed: false, myOpenNotes: 0 });
    const boss = (await list("", s.admin)).items.find((i) => i.workOrder === "401")!;
    expect(boss).toMatchObject({ followed: false, myOpenNotes: 1 });
    const detail = await json<DocketDetail>(await api("/api/dockets/401", { cookie: s.manager }));
    expect(detail).toMatchObject({ followed: true, myOpenNotes: 2 });
  });
});

describe("Notes pinned to a docket", () => {
  it("are notes to self with the work order, listed per docket, and leave when done", async () => {
    const t = await json<TaskCardDTO>(await note(s.manager, { toUserId: s.ids.mgr, workOrder: "401" }));
    expect(t.workOrder).toBe("401");
    await note(s.manager, { toUserId: s.ids.mgr });
    const of401 = await json<TaskCardDTO[]>(await api("/api/task-cards?workOrder=401", { cookie: s.manager }));
    expect(of401.map((x) => x.id)).toEqual([t.id]);
    const inbox = await json<TaskCardDTO[]>(await api("/api/task-cards", { cookie: s.manager }));
    expect(inbox.find((x) => x.id === t.id)?.workOrder).toBe("401");
    await post(`/api/task-cards/${t.id}/done`, s.manager, {});
    expect(await json(await api("/api/task-cards?workOrder=401", { cookie: s.manager }))).toEqual([]);
    expect((await list("", s.manager)).items.find((i) => i.workOrder === "401")?.myOpenNotes).toBe(0);
  });

  it("cannot be sent to someone else", async () => {
    const res = await note(s.manager, { toUserId: s.ids.boss, workOrder: "401" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("A docket note is a note to self.");
  });

  it("need an existing docket", async () => {
    const res = await note(s.manager, { toUserId: s.ids.mgr, workOrder: "999" });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe("Work order not found");
  });

  it("are for managers only", async () => {
    const staff = await s.staffWith("ira", "designer");
    const res = await note(staff, { toUserId: s.ids.ira, workOrder: "401" });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("Only managers can add notes to a docket.");
  });

  it("reject a work order that is not text", async () => {
    const res = await note(s.manager, { toUserId: s.ids.mgr, workOrder: 401 });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Invalid work order.");
  });

  it("lose the docket link if the owner becomes Staff", async () => {
    const t = await json<TaskCardDTO>(await note(s.manager, { toUserId: s.ids.mgr, workOrder: "401" }));
    await env.DB.prepare("UPDATE users SET access_level = 'staff' WHERE id = ?").bind(s.ids.mgr).run();
    const inbox = await json<TaskCardDTO[]>(await api("/api/task-cards", { cookie: s.manager }));
    expect(inbox.find((x) => x.id === t.id)?.workOrder).toBeNull();
  });

  it("other people's notes are never listed for me", async () => {
    await note(s.admin, { toUserId: s.ids.boss, workOrder: "401" });
    expect(await json(await api("/api/task-cards?workOrder=401", { cookie: s.manager }))).toEqual([]);
  });
});
