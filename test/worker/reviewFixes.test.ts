import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardEventDTO } from "../../src/shared/types";
import { flushCardSheet, PRODUCTION_HEADERS, queueCardSheet, retryCardSheet } from "../../src/worker/cards/sheetSync";
import { withLock } from "../../src/worker/dockets/lock";
import { SHEET_LOCK } from "../../src/worker/dockets/service";
import { cardsOf, newDocket, post, put, route, setupCards, step, teardownCards } from "./cardHelpers";
import { api } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
});
afterEach(() => {
  vi.restoreAllMocks();
  teardownCards();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function editJobs(wo: string, version: number, jobs: Parameters<typeof newDocket>[1]) {
  const f = (await (await api(`/api/virtual-dockets/${wo}`, { cookie: s.manager })).json()) as { form: unknown };
  const res = await put(`/api/virtual-dockets/${wo}`, s.manager, { form: f.form, jobs, version });
  expect(res.status).toBe(200);
  return (await res.json()) as { version: number };
}
/** Columns ready without the setup route (no background flush races the test). */
async function columnsReady() {
  await sleep(100);
  await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('production_columns', 'v2')").run();
  s.g.sheet.tabs.Production = [[...PRODUCTION_HEADERS]];
}

describe("review fixes", () => {
  it("removing the first job keeps the second job's cards", async () => {
    const d = await newDocket(s.manager, [
      { name: "Banner", steps: [step("designer"), step("printer_roll")] },
      { name: "Decals", steps: [step("designer")] },
    ]);
    const cards = await cardsOf(d.workOrder);
    const decals = cards.find((c) => c.job_sort === 1)!;
    await env.DB.prepare(`UPDATE cards SET fields_json = '{"sentProof":true}' WHERE id = ?`).bind(decals.id).run();
    await env.DB.prepare("UPDATE cards SET status = 'done' WHERE id = ?").bind(cards[0].id).run();
    await editJobs(d.workOrder, d.version, [{ name: "Decals", steps: [step("designer")] }]);
    const after = await cardsOf(d.workOrder);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(decals.id);
    expect(after[0].status).toBe("active");
    expect(JSON.parse(after[0].fields_json)).toEqual({ sentProof: true });
  });

  it("removing a whole job keeps its history", async () => {
    const d = await newDocket(s.manager, [
      { name: "Banner", steps: [step("designer"), step("printer_roll")] },
      { name: "Decals", steps: [step("colex")] },
    ]);
    const [c0] = await cardsOf(d.workOrder);
    await post(`/api/cards/${c0.id}/continue`, s.manager, { version: c0.version });
    await editJobs(d.workOrder, d.version, [{ name: "Decals", steps: [step("colex")] }]);
    const h = (await (await api(`/api/virtual-dockets/${d.workOrder}/history`, { cookie: s.manager })).json()) as CardEventDTO[];
    const lines = h.map((e) => `${e.area} · ${e.detail}`);
    expect(lines).toContain("Design · Send to production → Print Roll");
    expect(lines).toContain("Design · Removed Design from the route");
    expect(lines).toContain("Print Roll · Removed Print Roll from the route");
  });

  it("a step inserted before done work leaves that work done", async () => {
    const d = await newDocket(s.manager, route("designer", "printer_roll"));
    const [c0] = await cardsOf(d.workOrder);
    await post(`/api/cards/${c0.id}/continue`, s.manager, { version: c0.version });
    await editJobs(d.workOrder, d.version, route("colex", "designer", "printer_roll"));
    const after = await cardsOf(d.workOrder);
    expect(after.map((c) => [c.role_id, c.status])).toEqual([
      ["colex", "active"],
      ["designer", "done"],
      ["printer_roll", "waiting"],
    ]);
  });

  it("a card that moves to another step gets a new version", async () => {
    const d = await newDocket(s.manager, route("designer", "printer_roll"));
    const before = (await cardsOf(d.workOrder))[1];
    await editJobs(d.workOrder, d.version, route("designer", "colex", "printer_roll"));
    const moved = (await cardsOf(d.workOrder)).find((c) => c.id === before.id)!;
    expect(moved.step).toBe(2);
    expect(moved.version).toBeGreaterThan(before.version);
  });

  it("the flush writes the state as of when it got the lock", async () => {
    const d = await newDocket(s.manager, route("printer_roll", "laminate_roll"));
    await columnsReady();
    await queueCardSheet(env.DB, d.workOrder);
    let release!: () => void;
    const held = withLock(env.DB, SHEET_LOCK, () => new Promise<void>((r) => (release = r)));
    await sleep(20);
    const flushing = flushCardSheet(env, d.workOrder);
    await sleep(50);
    // Meanwhile Print Roll finishes.
    const [c0, c1] = await cardsOf(d.workOrder);
    await env.DB.batch([
      env.DB.prepare("UPDATE cards SET status = 'done', done_by = ?, done_at = ? WHERE id = ?").bind(s.ids.mgr, new Date().toISOString(), c0.id),
      env.DB.prepare("UPDATE cards SET status = 'active' WHERE id = ?").bind(c1.id),
    ]);
    await queueCardSheet(env.DB, d.workOrder);
    release();
    await held;
    await flushing;
    expect(s.g.sheet.rowOf(d.workOrder)![16]).toBe("Laminate");
  });

  it("the cron keeps retrying, and a new change resets the attempts", async () => {
    const d = await newDocket(s.manager, route("printer_roll"));
    await columnsReady();
    await queueCardSheet(env.DB, d.workOrder);
    await env.DB.prepare("UPDATE card_sheet_queue SET attempts = 25, last_error = 'x' WHERE work_order = ?").bind(d.workOrder).run();
    await queueCardSheet(env.DB, d.workOrder);
    const q = await env.DB.prepare("SELECT attempts, last_error FROM card_sheet_queue WHERE work_order = ?").bind(d.workOrder).first();
    expect(q).toEqual({ attempts: 0, last_error: null });
    await env.DB.prepare("UPDATE card_sheet_queue SET attempts = 25 WHERE work_order = ?").bind(d.workOrder).run();
    await retryCardSheet(env);
    expect(s.g.sheet.rowOf(d.workOrder)![16]).toBe("Print Roll");
  });

  it("Production tab rows are written in one batch", async () => {
    const d = await newDocket(s.manager, route("designer", "printer_roll", "laminate_roll"));
    await columnsReady();
    await queueCardSheet(env.DB, d.workOrder);
    await flushCardSheet(env, d.workOrder); // appends the 3 rows
    const single = vi.spyOn(s.g.sheet, "writeRange");
    const batch = vi.spyOn(s.g.sheet, "writeRanges");
    await queueCardSheet(env.DB, d.workOrder);
    await flushCardSheet(env, d.workOrder); // updates the 3 rows in place
    expect(single).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(3);
  });
});
