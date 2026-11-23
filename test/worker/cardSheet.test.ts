import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  flushCardSheet,
  PRODUCTION_COLUMNS_VERSION,
  PRODUCTION_HEADERS,
  queueCardSheet,
  retryCardSheet,
  STAGE_HEADERS,
  TRACKING_HEADERS,
  TRACKING_TAB,
  trackingLine,
} from "../../src/worker/cards/sheetSync";
import { cardsOf, docketForm, errorOf, newDocket, post, put, route, setupCards, step, teardownCards } from "./cardHelpers";

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
const stageCells = (wo: string) => sheetRow(wo).slice(16, 28);
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
    expect(s.g.sheet.rows[0].slice(16, 28)).toEqual(STAGE_HEADERS);
    expect(s.g.sheet.rows[1].slice(16, 25).every((v) => v === "")).toBe(true);
    expect(s.g.sheet.tabs.Production).toEqual([PRODUCTION_HEADERS]);
    const flag = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'production_columns'").first();
    expect(flag).toEqual({ value: PRODUCTION_COLUMNS_VERSION });
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

describe("Photos column", () => {
  it("a sheet on the Q–AA layout gets the Photos header in AB", async () => {
    expect((await setup()).status).toBe(200);
    s.g.sheet.rows[0].splice(16, 12, ...STAGE_HEADERS.slice(0, 11));
    await env.DB.prepare("UPDATE app_settings SET value = 'v2' WHERE key = 'production_columns'").run();
    const res = await setup();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ archivedRows: 0, updated: true });
    expect(s.g.sheet.rows[0][27]).toBe("Photos");
  });

  it("links the docket's photo folder from column AB", async () => {
    await setup();
    const d = await newDocket(s.manager, route("installer"));
    const [c] = await cardsOf(d.workOrder);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO docket_photo_folders (work_order, folder_id, link) VALUES (?, 'f1', 'https://drive.google.com/drive/folders/f1')").bind(d.workOrder),
      env.DB.prepare("INSERT INTO card_photos (card_id, work_order, drive_file_id, link, name, created_at) VALUES (?, ?, 'p1', 'l', 'n', 't')").bind(c.id, d.workOrder),
      env.DB.prepare("INSERT INTO card_photos (card_id, work_order, drive_file_id, link, name, created_at) VALUES (?, ?, 'p2', 'l', 'n', 't')").bind(c.id, d.workOrder),
    ]);
    await queueCardSheet(env.DB, d.workOrder);
    await flushCardSheet(env, d.workOrder);
    expect(sheetRow(d.workOrder)[27]).toBe('=HYPERLINK("https://drive.google.com/drive/folders/f1","Photos (2)")');
  });
});

describe("Contour Cut column", () => {
  it("a sheet set up before Contour Cut existed gets the new headers, keeping its legacy tab", async () => {
    expect((await setup()).status).toBe(200);
    // Simulate the first layout (Q–Z, no Contour Cut) and its settings value.
    s.g.sheet.rows[0].splice(16, 11, "Stage", "Design", "Print Roll", "Print FB", "Laminate", "Liquid Lam", "Colex", "Finishing", "Install", "Assigned");
    await env.DB.prepare("UPDATE app_settings SET value = 'ready' WHERE key = 'production_columns'").run();
    const legacy = s.g.sheet.tabs["Legacy Q-Y"];
    const res = await setup();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ archivedRows: 0, updated: true });
    expect(s.g.sheet.rows[0].slice(16, 28)).toEqual(STAGE_HEADERS);
    expect(STAGE_HEADERS[5]).toBe("Contour Cut");
    expect(STAGE_HEADERS[10]).toBe("Assigned");
    expect(STAGE_HEADERS[11]).toBe("Photos");
    expect(s.g.sheet.tabs["Legacy Q-Y"]).toBe(legacy);
    const flag = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'production_columns'").first();
    expect(flag).toEqual({ value: PRODUCTION_COLUMNS_VERSION });
  });

  it("a Contour Cut step shows in column V", async () => {
    await setup();
    const d = await newDocket(s.manager, route("contour_cut"));
    await flushCardSheet(env, d.workOrder);
    expect(stageCells(d.workOrder)[0]).toBe("Contour Cut");
    expect(stageCells(d.workOrder)[5]).toBe("Active · Team");
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
      "—",
      "Team",
      "",
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
    await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('production_columns', ?)").bind(PRODUCTION_COLUMNS_VERSION).run();
    s.g.sheet.tabs.Production = [[...PRODUCTION_HEADERS]];
    s.g.sheet.tabs[TRACKING_TAB] = [[...TRACKING_HEADERS]];
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

  it("column K shows who has the docket now: claimer, assignees, area, or Done", async () => {
    await setup();
    await s.staffWith("ira", "designer");
    const erin = await s.staffWith("erin", "printer_roll");
    const d = await newDocket(s.manager, [{ name: "Whole docket", steps: [step("designer", [s.ids.ira]), step("printer_roll")] }]);
    await flushCardSheet(env, d.workOrder);
    expect(sheetRow(d.workOrder)[10]).toBe("ira");

    let [c, p] = await cardsOf(d.workOrder);
    await post(`/api/cards/${c.id}/continue`, s.manager, { version: c.version });
    await flushCardSheet(env, d.workOrder);
    expect(sheetRow(d.workOrder)[10]).toBe("Printer Roll");

    await post(`/api/cards/${p.id}/claim`, erin);
    await flushCardSheet(env, d.workOrder);
    expect(sheetRow(d.workOrder)[10]).toBe("erin");

    p = (await cardsOf(d.workOrder))[1];
    await put(`/api/cards/${p.id}/fields`, s.manager, { fields: { printed: true, file: "ok" }, version: p.version });
    await post(`/api/cards/${p.id}/continue`, s.manager, { version: p.version + 1 });
    await flushCardSheet(env, d.workOrder);
    expect(sheetRow(d.workOrder)[10]).toBe("Done");
  });

  it("column K lists parallel holders once each, comma separated", async () => {
    await setup();
    await s.staffWith("ira", "designer");
    const d = await newDocket(s.manager, [
      { name: "Banner", steps: [step("designer", [s.ids.ira])] },
      { name: "Decals", steps: [step("designer", [s.ids.ira])] },
      { name: "Signs", steps: [step("colex")] },
    ]);
    await flushCardSheet(env, d.workOrder);
    expect(sheetRow(d.workOrder)[10]).toBe("ira, Colex");
  });

  it("a docket without cards keeps its column K", async () => {
    await setup();
    s.g.sheet.rows[1][10] = "IN ship room";
    await queueCardSheet(env.DB, "91487");
    await flushCardSheet(env, "91487");
    expect(sheetRow("91487")[10]).toBe("IN ship room");
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

describe("Docket Tracking tab", () => {
  const WHEN = /^(.+) - (received|started) - [A-Z][a-z]+ \d{1,2} \d{4} - \d{1,2}:\d{2} (AM|PM)$/;
  const lines = (wo: string) => {
    const r = s.g.sheet.tabs[TRACKING_TAB].find((x) => String(x[0]) === wo)!;
    return String(r[2]).split("\n").map((l) => l.match(WHEN)!.slice(1, 3));
  };

  it("formats a line in Winnipeg time", () => {
    // Summer dates: Winnipeg is UTC-5 then.
    expect(trackingLine("Ira", "received", "2026-07-23T14:37:00.000Z")).toBe("Ira - received - July 23 2026 - 9:37 AM");
    expect(trackingLine("Erin", "started", "2026-07-24T18:05:00.000Z")).toBe("Erin - started - July 24 2026 - 1:05 PM");
  });

  it("set up creates the tab with its headers; an older layout gets it too, keeping Legacy Q-Y", async () => {
    await setup();
    expect(s.g.sheet.tabs[TRACKING_TAB]).toEqual([TRACKING_HEADERS]);
    delete s.g.sheet.tabs[TRACKING_TAB];
    await env.DB.prepare("UPDATE app_settings SET value = 'v3' WHERE key = 'production_columns'").run();
    const legacy = s.g.sheet.tabs["Legacy Q-Y"];
    expect((await setup()).status).toBe(200);
    expect(s.g.sheet.tabs[TRACKING_TAB]).toEqual([TRACKING_HEADERS]);
    expect(s.g.sheet.tabs["Legacy Q-Y"]).toBe(legacy);
  });

  it("records who received work and who started it, one row per docket updated in place", async () => {
    await setup();
    await s.staffWith("ira", "designer");
    const erin = await s.staffWith("erin", "printer_roll");
    const d = await newDocket(s.manager, [{ name: "Whole docket", steps: [step("designer", [s.ids.ira]), step("printer_roll")] }]);
    const [c, p] = await cardsOf(d.workOrder);
    await post(`/api/cards/${c.id}/continue`, s.manager, { version: c.version });
    await post(`/api/cards/${p.id}/claim`, erin);
    await flushCardSheet(env, d.workOrder);
    await flushCardSheet(env, d.workOrder);
    const rows = s.g.sheet.tabs[TRACKING_TAB].filter((x) => String(x[0]) === d.workOrder);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe(sheetRow(d.workOrder)[6]);
    expect(lines(d.workOrder)).toEqual([
      ["ira", "received"],
      ["Printer Roll", "received"],
      ["erin", "started"],
    ]);
  });

  it("reassigning an active card in the route editor counts as received", async () => {
    await setup();
    await s.staffWith("ira", "designer");
    await s.staffWith("ana", "designer");
    const d = await newDocket(s.manager, [{ name: "Whole docket", steps: [step("designer", [s.ids.ira])] }]);
    const res = await put(`/api/virtual-dockets/${d.workOrder}`, s.manager, {
      form: docketForm(),
      jobs: [{ name: "Whole docket", steps: [step("designer", [s.ids.ana])] }],
      version: d.version,
    });
    expect(res.status).toBe(200);
    await flushCardSheet(env, d.workOrder);
    expect(lines(d.workOrder)).toEqual([
      ["ira", "received"],
      ["ana", "received"],
    ]);
  });
});
