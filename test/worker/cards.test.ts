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
