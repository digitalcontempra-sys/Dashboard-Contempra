import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushCardSheet, PRODUCTION_COLUMNS_VERSION, STAGE_HEADERS } from "../../src/worker/cards/sheetSync";
import { layoutReader, physicalCells, physicalRange } from "../../src/worker/sheet/layout";
import { cardOf, docketForm, handDocket, move, newDocket, post, put, route, setupCards, teardownCards } from "./cardHelpers";
import { HEADER } from "./fixtures";
import { api } from "./helpers";

describe("sheet layout translation", () => {
  it("shifts Contempra columns from L on when the STATUS column exists", () => {
    expect(physicalRange("Contempra!A1:P", true)).toEqual({ range: "Contempra!A1:Q", drop: 11 });
    expect(physicalRange("Contempra!A5:P5", true)).toEqual({ range: "Contempra!A5:Q5", drop: 11 });
    expect(physicalRange("Contempra!Q1:AB1", true)).toEqual({ range: "Contempra!R1:AC1", drop: null });
    expect(physicalRange("Contempra!Q1", true)).toEqual({ range: "Contempra!R1", drop: null });
    expect(physicalRange("Contempra!C1:C", true)).toEqual({ range: "Contempra!C1:C", drop: null });
    expect(physicalRange("'Production'!A2:F", true)).toEqual({ range: "'Production'!A2:F", drop: null });
  });

  it("leaves everything alone without the STATUS column", () => {
    expect(physicalRange("Contempra!A1:P", false)).toEqual({ range: "Contempra!A1:P", drop: null });
    expect(physicalCells({ K: "Ira", L: false, STATUS: "Starting", AB: "x" }, false)).toEqual({ K: "Ira", L: false, AB: "x" });
  });

  it("moves cells right of K one column and puts STATUS in L", () => {
    expect(physicalCells({ C: 1, K: "Ira", L: false, P: "link", STATUS: "Starting", AB: "x" }, true)).toEqual({
      C: 1,
      K: "Ira",
      M: false,
      Q: "link",
      L: "Starting",
      AC: "x",
    });
  });

  it("the sync reader drops the STATUS column so rows keep their A–P shape", async () => {
    const physical = [[...HEADER.slice(0, 11), "STATUS", ...HEADER.slice(11)]];
    const asked: string[] = [];
    const read = layoutReader(async (r) => (asked.push(r), physical), async () => true);
    expect(await read("Contempra!A1:P2")).toEqual([HEADER]);
    expect(asked).toEqual(["Contempra!A1:Q2"]);
  });
});

describe("STATUS column", () => {
  let s: Awaited<ReturnType<typeof setupCards>>;
  beforeEach(async () => {
    s = await setupCards();
  });
  afterEach(teardownCards);

  const setup = () => post("/api/admin/production-columns", s.admin, { confirm: "SET UP" });
  const row = (wo: string) => s.g.sheet.rowOf(wo)!;

  it("set up inserts a real STATUS column after ROLE, once", async () => {
    expect((await setup()).status).toBe(200);
    const head = s.g.sheet.rows[0];
    expect(head.slice(10, 13)).toEqual(["ROLE", "STATUS", "Inv"]);
    expect(head[16]).toBe("LINK");
    expect(head.slice(17, 30)).toEqual(STAGE_HEADERS);
    // The existing docket moved with it.
    expect(row("91487")[6]).toBe("Tartan Towing");
    expect(row("91487")[11]).toBe("");

    // Again (older version flag): no second column.
    await env.DB.prepare("UPDATE app_settings SET value = 'v4' WHERE key = 'production_columns'").run();
    expect((await setup()).status).toBe(200);
    expect(s.g.sheet.rows[0].filter((h) => h === "STATUS")).toHaveLength(1);
    const flag = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'production_columns'").first();
    expect(flag).toEqual({ value: PRODUCTION_COLUMNS_VERSION });
  });

  it("the column and its header are inserted in one request (no second blank column after a failure)", async () => {
    const writes: string[] = [];
    const orig = s.g.sheet.writeRange.bind(s.g.sheet);
    s.g.sheet.writeRange = async (a1, v) => (writes.push(a1), orig(a1, v));
    await setup();
    expect(writes).not.toContain("Contempra!L1");
    expect(s.g.sheet.rows[0][11]).toBe("STATUS");
  });

  it("a newly connected sheet without the STATUS column asks for set up again", async () => {
    await setup();
    const ready = async () => ((await (await api("/api/production-board", { cookie: s.manager })).json()) as { productionColumnsReady: boolean }).productionColumnsReady;
    expect(await ready()).toBe(true);
    await env.DB.prepare(
      "INSERT OR REPLACE INTO google_connection (id, email, refresh_token_enc, sheet_id, status, connected_at) VALUES (1, 'x@y.z', 'enc', 'real-sheet', 'connected', 't')",
    ).run();
    expect(await ready()).toBe(false);
  });

  it("ROLE shows the person and STATUS the state, through to Done", async () => {
    await setup();
    const ira = await s.staffWith("ira", "designer");
    const d = await handDocket(s.manager, [{ userId: s.ids.ira, instruction: "Logo" }]);
    const wo = d.workOrder;
    expect(row(wo)[12]).toBe(false); // Inv checkbox, now in M
    await flushCardSheet(env, wo);
    expect(row(wo).slice(10, 12)).toEqual(["ira", "Starting"]);

    await post(`/api/cards/${(await cardOf(wo, s.ids.ira)).id}/claim`, ira);
    await flushCardSheet(env, wo);
    expect(row(wo).slice(10, 12)).toEqual(["ira", "In progress"]);

    expect((await move(await cardOf(wo, s.ids.ira), "proof-sent", ira)).status).toBe(200);
    await flushCardSheet(env, wo);
    expect(row(wo).slice(10, 12)).toEqual(["mgr", "Waiting for design approval"]);

    await move(await cardOf(wo, s.ids.mgr, { creator: true }), "continue", s.manager, { to: [{ userId: s.ids.ira, instruction: "Final" }] });
    await move(await cardOf(wo, s.ids.ira), "done", ira);
    await flushCardSheet(env, wo);
    expect(row(wo).slice(10, 12)).toEqual(["mgr", "Ready to close"]);

    await move(await cardOf(wo, s.ids.mgr, { creator: true }), "close", s.manager);
    await flushCardSheet(env, wo);
    expect(row(wo).slice(10, 12)).toEqual(["mgr", "Done"]);
    expect(row(wo)[17]).toBe("Done"); // Stage, now in R
  });

  it("a returned card says Returned; split holders list in the same order", async () => {
    await setup();
    const ira = await s.staffWith("ira", "designer");
    const cole = await s.staffWith("cole", "colex");
    const d = await handDocket(s.manager, [{ userId: s.ids.ira, instruction: "Logo" }]);
    await move(await cardOf(d.workOrder, s.ids.ira), "continue", ira, { to: [{ userId: s.ids.cole, instruction: "Cut" }] });
    await move(await cardOf(d.workOrder, s.ids.cole), "send-back", cole, { reason: "Wrong size" });
    await flushCardSheet(env, d.workOrder);
    expect(row(d.workOrder).slice(10, 12)).toEqual(["ira", "Returned"]);

    const e = await handDocket(s.manager, [
      { userId: s.ids.cole, instruction: "Cut" },
      { userId: s.ids.ira, instruction: "Logo" },
    ]);
    await post(`/api/cards/${(await cardOf(e.workOrder, s.ids.cole)).id}/claim`, cole);
    await flushCardSheet(env, e.workOrder);
    expect(row(e.workOrder).slice(10, 12)).toEqual(["cole, ira", "In progress, Starting"]);
  });

  it("saving and editing a docket keep working after the column is inserted", async () => {
    await setup();
    const d = await newDocket(s.manager, route("colex"), docketForm({ forName: "Encore Lounge", address: "1 Main St" }));
    expect(row(d.workOrder)[6]).toBe("Encore Lounge");
    const res = await put(`/api/virtual-dockets/${d.workOrder}`, s.manager, {
      form: docketForm({ forName: "Encore Lounge 2", address: "1 Main St" }),
      jobs: route("colex"),
      version: d.version,
    });
    expect(res.status).toBe(200);
    expect(row(d.workOrder)[6]).toBe("Encore Lounge 2");
    const mirror = await env.DB.prepare("SELECT customer, inv FROM dockets WHERE work_order = ?").bind(d.workOrder).first();
    expect(mirror).toEqual({ customer: "Encore Lounge 2", inv: 0 });
  });
});
