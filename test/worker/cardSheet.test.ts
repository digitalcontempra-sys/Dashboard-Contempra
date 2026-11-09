import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushCardSheet, PRODUCTION_HEADERS, queueCardSheet, retryCardSheet, STAGE_HEADERS } from "../../src/worker/cards/sheetSync";
import { cardsOf, errorOf, newDocket, post, put, route, setupCards, teardownCards } from "./cardHelpers";

let s: Awaited<ReturnType<typeof setupCards>>;
const OLD = ["SUB", "QC", "Design", "Print", "Lam", "Cut", "Fin", "Inst", "Notes2"];

beforeEach(async () => {
  s = await setupCards();
  // The live sheet has old headers in Q..Y and some legacy values.
  s.g.sheet.rows[0].push(...OLD);
  s.g.sheet.rows[1].push("x", "", "", "", "", "", "", "", "old");
});
afterEach(teardownCards);

const setup = () => post("/api/admin/production-columns", s.admin, { confirm: "SET UP" });
const sheetRow = (wo: string) => s.g.sheet.rowOf(wo)!;
const stageCells = (wo: string) => sheetRow(wo).slice(16, 26);
const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/Winnipeg", month: "2-digit", day: "2-digit" }).format(new Date());

describe("Set up production columns", () => {
  it("archives Q–Y, clears them and writes the new headers", async () => {
    const res = await setup();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ archivedRows: 1 });
    expect(s.g.sheet.tabs["Legacy Q-Y"]).toEqual([
      ["Work Order", ...OLD],
      [91487, "x", "", "", "", "", "", "", "", "old"],
    ]);
    expect(s.g.sheet.rows[0].slice(16, 26)).toEqual(STAGE_HEADERS);
    expect(s.g.sheet.rows[1].slice(16, 25).every((v) => v === "")).toBe(true);
    expect(s.g.sheet.tabs.Production).toEqual([PRODUCTION_HEADERS]);
    const flag = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'production_columns'").first();
    expect(flag).toEqual({ value: "ready" });
  });

  it("runs once, needs confirmation, and is for admins only", async () => {
    expect((await post("/api/admin/production-columns", s.admin, {})).status).toBe(400);
    expect((await post("/api/admin/production-columns", s.manager, { confirm: "SET UP" })).status).toBe(403);
    expect((await setup()).status).toBe(200);
    const again = await setup();
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("Production columns are already set up.");
  });
});

describe("Stage columns", () => {
  it("stay untouched (but queued) until the columns are set up", async () => {
    const d = await newDocket(s.manager, route("designer", "printer_roll"));
    const [c] = await cardsOf(d.workOrder);
    await post(`/api/cards/${c.id}/continue`, s.manager, { version: c.version });
    await flushCardSheet(env, d.workOrder);
    expect(sheetRow(d.workOrder).length).toBe(16);
    const q = await env.DB.prepare("SELECT work_order FROM card_sheet_queue WHERE work_order = ?").bind(d.workOrder).first();
    expect(q).toEqual({ work_order: d.workOrder });
  });

  it("show the stage of every area and the Production tab rows", async () => {
    await setup();
    const d = await newDocket(s.manager, route("designer", "printer_roll", "laminate_roll"));
    let [c] = await cardsOf(d.workOrder);
    await post(`/api/cards/${c.id}/continue`, s.manager, { version: c.version });
    c = (await cardsOf(d.workOrder))[1];
    await put(`/api/cards/${c.id}/fields`, s.manager, { fields: { printed: true, file: "ok" }, version: c.version });
    await post(`/api/cards/${c.id}/continue`, s.manager, { version: c.version + 1 });
    await flushCardSheet(env, d.workOrder);
    expect(stageCells(d.workOrder)).toEqual([
      "Laminate",
      `✓ mgr ${today}`,
      `✓ mgr ${today}`,
      "—",
      "Active · Team",
      "—",
      "—",
      "—",
      "—",
      "Team",
    ]);
    const prod = s.g.sheet.tabs.Production.slice(1);
    expect(prod.map((r) => [r[0], r[2], r[3], r[5]])).toEqual([
      [d.workOrder, 1, "Designer", "Done"],
      [d.workOrder, 2, "Printer Roll", "Done"],
      [d.workOrder, 3, "Laminate Roll", "Active"],
    ]);
    expect(prod[1][6]).toBe("Printed ✓ · File: OK");
    expect(await env.DB.prepare("SELECT count(*) AS n FROM card_sheet_queue").first()).toEqual({ n: 0 });

    // A second flush updates rows in place.
    c = (await cardsOf(d.workOrder))[2];
    await post(`/api/cards/${c.id}/send-back`, s.manager, { toStep: 0, reason: "New logo", version: c.version });
    await flushCardSheet(env, d.workOrder);
    expect(s.g.sheet.tabs.Production).toHaveLength(4);
    expect(stageCells(d.workOrder)[1]).toBe("Returned · New logo");
    expect(s.g.sheet.tabs.Production[1][5]).toBe("Returned");
  });

  it("a failed write stays queued and the cron retries it", async () => {
    // Create before the columns are ready, so no background flush races this test; then mark them ready.
    const d = await newDocket(s.manager, route("printer_roll"));
    await new Promise((r) => setTimeout(r, 100)); // let the save's background flush finish (it is a no-op: not ready)
    await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('production_columns', 'ready')").run();
    s.g.sheet.tabs.Production = [[...PRODUCTION_HEADERS]];
    await queueCardSheet(env.DB, d.workOrder);
    s.g.sheet.failNext("updateCells");
    await flushCardSheet(env, d.workOrder);
    const q = await env.DB.prepare("SELECT attempts, last_error FROM card_sheet_queue WHERE work_order = ?").bind(d.workOrder).first<{
      attempts: number;
      last_error: string;
    }>();
    expect(q?.attempts).toBe(1);
    expect(q?.last_error).toContain("503");
    await retryCardSheet(env);
    expect(stageCells(d.workOrder)[0]).toBe("Print Roll");
    expect(await env.DB.prepare("SELECT count(*) AS n FROM card_sheet_queue").first()).toEqual({ n: 0 });
  });

  it("the last Continue marks COMP; designer On hold marks HOLD", async () => {
    await setup();
    const a = await newDocket(s.manager, route("colex"));
    const [c] = await cardsOf(a.workOrder);
    await put(`/api/cards/${c.id}/fields`, s.manager, { fields: { completed: true }, version: c.version });
    await post(`/api/cards/${c.id}/continue`, s.manager, { version: c.version + 1 });
    await flushCardSheet(env, a.workOrder);
    expect(sheetRow(a.workOrder)[3]).toBe(true);
    expect(stageCells(a.workOrder)[0]).toBe("Done");

    const b = await newDocket(s.manager, route("designer"));
    const [dc] = await cardsOf(b.workOrder);
    await put(`/api/cards/${dc.id}/fields`, s.manager, { fields: { onHold: true }, version: dc.version });
    await flushCardSheet(env, b.workOrder);
    expect(sheetRow(b.workOrder)[4]).toBe(true);
  });
});
