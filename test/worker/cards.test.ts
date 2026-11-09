import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyForm, type DocketForm, type ProductionJob } from "../../src/shared/docketForm";
import { __setTestGateways } from "../../src/worker/google/gateways";
import { fakeGateways } from "./fakeGoogle";
import { row } from "./fixtures";
import { api, createUser, login, resetAuthTables } from "./helpers";

let g: ReturnType<typeof fakeGateways>;
let manager = "";
const ids: Record<string, number> = {};

const form = (over: Partial<DocketForm> = {}): DocketForm => {
  const f = emptyForm("2026-11-05", "Ana");
  f.forName = "Encore Lounge";
  f.salesperson = "JB";
  return { ...f, ...over };
};
const step = (roleId: string, assigneeIds: number[] = []) => ({ roleId, assigneeIds });
const route = (...roles: string[]): ProductionJob[] => [{ name: "Whole docket", steps: roles.map((r) => step(r)) }];

type CardRow = { id: number; job_sort: number; step: number; role_id: string; status: string; fields_json: string; assignee_ids: string; version: number };

export async function cardsOf(wo: string): Promise<CardRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM cards WHERE work_order = ? ORDER BY job_sort, step").bind(wo).all<CardRow>();
  return results;
}
async function eventsOf(wo: string) {
  const { results } = await env.DB.prepare("SELECT action, detail_json, card_id FROM card_events WHERE work_order = ? ORDER BY id")
    .bind(wo)
    .all<{ action: string; detail_json: string; card_id: number }>();
  return results;
}

async function createDocket(cookie: string, jobs: ProductionJob[], f = form()) {
  const res = await api("/api/virtual-dockets", { method: "POST", cookie, json: { form: f, jobs } });
  expect(res.status).toBe(200);
  return (await res.json()) as { workOrder: string; version: number };
}
async function editRoute(cookie: string, wo: string, version: number, jobs: ProductionJob[], f = form()) {
  const res = await api(`/api/virtual-dockets/${wo}`, { method: "PUT", cookie, json: { form: f, jobs, version } });
  expect(res.status).toBe(200);
  return (await res.json()) as { workOrder: string; version: number };
}

beforeEach(async () => {
  g = fakeGateways();
  g.sheet.rows.push(row(91487, { 6: "Tartan Towing" }));
  __setTestGateways(g);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM card_sheet_queue"),
    env.DB.prepare("DELETE FROM app_settings"),
    env.DB.prepare("DELETE FROM job_steps"),
    env.DB.prepare("DELETE FROM docket_jobs"),
    env.DB.prepare("DELETE FROM virtual_dockets"),
    env.DB.prepare("DELETE FROM dockets"),
  ]);
  await resetAuthTables();
  ids.mgr = await createUser("mgr", "manager");
  manager = await login("mgr");
});
afterEach(() => __setTestGateways(null));

describe("cards follow the route", () => {
  it("creates one card per step; the first is active", async () => {
    const { workOrder } = await createDocket(manager, route("designer", "printer_roll", "laminate_roll"));
    const cards = await cardsOf(workOrder);
    expect(cards.map((c) => [c.step, c.role_id, c.status])).toEqual([
      [0, "designer", "active"],
      [1, "printer_roll", "waiting"],
      [2, "laminate_roll", "waiting"],
    ]);
    const ev = await eventsOf(workOrder);
    expect(ev).toEqual([expect.objectContaining({ action: "activated", card_id: cards[0].id })]);
  });

  it("activates the first card of every job", async () => {
    const { workOrder } = await createDocket(manager, [
      { name: "Banner", steps: [step("printer_roll"), step("finishing")] },
      { name: "Decals", steps: [step("printer_fb"), step("colex")] },
    ]);
    const cards = await cardsOf(workOrder);
    expect(cards.map((c) => [c.job_sort, c.role_id, c.status])).toEqual([
      [0, "printer_roll", "active"],
      [0, "finishing", "waiting"],
      [1, "printer_fb", "active"],
      [1, "colex", "waiting"],
    ]);
  });

  it("a route with no steps has no cards", async () => {
    const { workOrder } = await createDocket(manager, [{ name: "Whole docket", steps: [] }]);
    expect(await cardsOf(workOrder)).toEqual([]);
  });

  it("inserting a step before the active one keeps done work and fields", async () => {
    const d = await createDocket(manager, route("designer", "printer_roll", "laminate_roll"));
    const [c0, c1] = await cardsOf(d.workOrder);
    await env.DB.batch([
      env.DB.prepare("UPDATE cards SET status = 'done' WHERE id = ?").bind(c0.id),
      env.DB.prepare(`UPDATE cards SET status = 'active', fields_json = '{"printed":true}' WHERE id = ?`).bind(c1.id),
    ]);
    // New route: designer, printer_fb (new, at step 1), printer_roll, laminate_roll.
    await editRoute(manager, d.workOrder, d.version, route("designer", "printer_fb", "printer_roll", "laminate_roll"));
    const cards = await cardsOf(d.workOrder);
    expect(cards.map((c) => [c.step, c.role_id, c.status])).toEqual([
      [0, "designer", "done"],
      [1, "printer_fb", "active"],
      [2, "printer_roll", "waiting"],
      [3, "laminate_roll", "waiting"],
    ]);
    expect(cards[0].id).toBe(c0.id);
    expect(JSON.parse(cards[1].fields_json)).toEqual({});
    expect(JSON.parse(cards[2].fields_json)).toEqual({ printed: true });
  });

  it("removing the active step activates the next and records the removal", async () => {
    const d = await createDocket(manager, route("designer", "printer_roll", "laminate_roll"));
    await editRoute(manager, d.workOrder, d.version, route("printer_roll", "laminate_roll"));
    const cards = await cardsOf(d.workOrder);
    expect(cards.map((c) => [c.step, c.role_id, c.status])).toEqual([
      [0, "printer_roll", "active"],
      [1, "laminate_roll", "waiting"],
    ]);
    const ev = await eventsOf(d.workOrder);
    const removed = ev.find((e) => e.action === "removed");
    expect(JSON.parse(removed!.detail_json)).toEqual({ removedArea: "Design" });
  });

  it("changing only assignees keeps status and fields", async () => {
    const d = await createDocket(manager, route("printer_roll", "laminate_roll"));
    const [c0] = await cardsOf(d.workOrder);
    await env.DB.prepare(`UPDATE cards SET fields_json = '{"printed":true}' WHERE id = ?`).bind(c0.id).run();
    await editRoute(manager, d.workOrder, d.version, [
      { name: "Whole docket", steps: [step("printer_roll", [ids.mgr]), step("laminate_roll")] },
    ]);
    const [after] = await cardsOf(d.workOrder);
    expect(after.id).toBe(c0.id);
    expect(after.status).toBe("active");
    expect(JSON.parse(after.fields_json)).toEqual({ printed: true });
    expect(JSON.parse(after.assignee_ids)).toEqual([ids.mgr]);
  });
});

async function addRole(userId: number, roleId: string) {
  await env.DB.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, roleId).run();
}
async function staffWith(username: string, ...roles: string[]) {
  const id = await createUser(username, "staff");
  for (const r of roles) await addRole(id, r);
  ids[username] = id;
  return login(username);
}
const post = (path: string, cookie: string, json: unknown = {}) => api(path, { method: "POST", cookie, json });
const put = (path: string, cookie: string, json: unknown) => api(path, { method: "PUT", cookie, json });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("card actions", () => {
  it("Continue is blocked until required fields are set, then moves to the next area", async () => {
    const lam = await staffWith("lee", "laminate_roll");
    const d = await createDocket(manager, route("laminate_roll", "finishing"));
    const [c] = await cardsOf(d.workOrder);
    let res = await post(`/api/cards/${c.id}/continue`, lam, { version: c.version });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe('Mark "Laminated" to continue');

    res = await put(`/api/cards/${c.id}/fields`, lam, { fields: { laminated: true }, version: c.version });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as { version: number; fields: Record<string, unknown> };
    expect(saved.fields).toEqual({ laminated: true });

    res = await post(`/api/cards/${c.id}/continue`, lam, { version: saved.version });
    expect(res.status).toBe(200);
    const cards = await cardsOf(d.workOrder);
    expect(cards.map((x) => x.status)).toEqual(["done", "active"]);
    const actions = (await eventsOf(d.workOrder)).map((e) => e.action);
    expect(actions.slice(-2)).toEqual(["continued", "activated"]);
    const cont = (await eventsOf(d.workOrder)).find((e) => e.action === "continued");
    expect(JSON.parse(cont!.detail_json)).toEqual({ to: "Finishing" });
  });

  it("Send back returns the job to an earlier area with a reason", async () => {
    const d = await createDocket(manager, route("designer", "printer_roll", "laminate_roll"));
    const cards0 = await cardsOf(d.workOrder);
    await env.DB.batch([
      env.DB.prepare("UPDATE cards SET status = 'done', done_by = ? WHERE id IN (?, ?)").bind(ids.mgr, cards0[0].id, cards0[1].id),
      env.DB.prepare(`UPDATE cards SET fields_json = '{"printed":true}' WHERE id = ?`).bind(cards0[1].id),
      env.DB.prepare("UPDATE cards SET status = 'active' WHERE id = ?").bind(cards0[2].id),
    ]);
    const lam = await staffWith("lee", "laminate_roll");
    const c = (await cardsOf(d.workOrder))[2];
    const res = await post(`/api/cards/${c.id}/send-back`, lam, { toStep: 0, reason: "Cut file missing", version: c.version });
    expect(res.status).toBe(200);
    const cards = await cardsOf(d.workOrder);
    expect(cards.map((x) => x.status)).toEqual(["active", "waiting", "waiting"]);
    const target = await env.DB.prepare("SELECT returned_reason, returned_by, done_by FROM cards WHERE id = ?").bind(cards[0].id).first();
    expect(target).toEqual({ returned_reason: "Cut file missing", returned_by: ids.lee, done_by: null });
    expect(JSON.parse(cards[1].fields_json)).toEqual({ printed: true });
    const back = (await eventsOf(d.workOrder)).find((e) => e.action === "sent_back");
    expect(JSON.parse(back!.detail_json)).toEqual({ to: "Design", reason: "Cut file missing" });
  });

  it("Send back needs a reason and an earlier area", async () => {
    const d = await createDocket(manager, route("designer", "printer_roll"));
    const [, c] = await cardsOf(d.workOrder);
    await env.DB.prepare("UPDATE cards SET status = CASE WHEN step = 0 THEN 'done' ELSE 'active' END WHERE work_order = ?").bind(d.workOrder).run();
    let res = await post(`/api/cards/${c.id}/send-back`, manager, { toStep: 0, reason: "  ", version: c.version });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Write a reason (at least 3 characters).");
    res = await post(`/api/cards/${c.id}/send-back`, manager, { toStep: 1, reason: "Wrong size", version: c.version });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Choose an earlier area.");
  });

  it("two Continues at once: one wins, the other is told who moved it", async () => {
    const d = await createDocket(manager, route("designer", "printer_roll"));
    const [c] = await cardsOf(d.workOrder);
    const [a, b] = await Promise.all([
      post(`/api/cards/${c.id}/continue`, manager, { version: c.version }),
      post(`/api/cards/${c.id}/continue`, manager, { version: c.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(await errorOf(loser)).toBe("This card was already moved by mgr.");
  });

  it("only the card's team (or managers) can work on it", async () => {
    const other = await staffWith("ira", "designer");
    const d = await createDocket(manager, route("printer_roll"));
    const [c] = await cardsOf(d.workOrder);
    let res = await post(`/api/cards/${c.id}/claim`, other);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("You can't work on this card.");
    res = await post(`/api/cards/${c.id}/claim`, manager);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { claimedBy: { name: string } }).claimedBy.name).toBe("mgr");
  });

  it("a card assigned to specific people is closed to the rest of the team", async () => {
    const erin = await staffWith("erin", "printer_roll");
    const seb = await staffWith("seb", "printer_roll");
    const d = await createDocket(manager, [{ name: "Whole docket", steps: [step("printer_roll", [ids.erin])] }]);
    const [c] = await cardsOf(d.workOrder);
    expect((await post(`/api/cards/${c.id}/claim`, seb)).status).toBe(403);
    expect((await post(`/api/cards/${c.id}/claim`, erin)).status).toBe(200);
  });

  it("the last Continue completes the docket and queues COMP", async () => {
    const d = await createDocket(manager, route("colex"));
    const [c] = await cardsOf(d.workOrder);
    const res = await post(`/api/cards/${c.id}/continue`, manager, { version: c.version });
    expect(res.status).toBe(409); // colex needs Completed
    await put(`/api/cards/${c.id}/fields`, manager, { fields: { completed: true }, version: c.version });
    const ok = await post(`/api/cards/${c.id}/continue`, manager, { version: c.version + 1 });
    expect(ok.status).toBe(200);
    expect((await eventsOf(d.workOrder)).map((e) => e.action)).toContain("completed");
    const q = await env.DB.prepare("SELECT comp FROM card_sheet_queue WHERE work_order = ?").bind(d.workOrder).first();
    expect(q).toEqual({ comp: 1 });
  });

  it("saving fields with an old version is refused", async () => {
    const d = await createDocket(manager, route("printer_roll"));
    const [c] = await cardsOf(d.workOrder);
    await put(`/api/cards/${c.id}/fields`, manager, { fields: { printed: true }, version: c.version });
    const res = await put(`/api/cards/${c.id}/fields`, manager, { fields: { note: "x" }, version: c.version });
    expect(res.status).toBe(409);
  });
});
