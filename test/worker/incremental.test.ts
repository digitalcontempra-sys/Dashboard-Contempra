import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { runIncrementalSync, type SheetReader } from "../../src/worker/sync/incremental";
import { runNightlyReconcile } from "../../src/worker/sync/nightly";
import { runSync } from "../../src/worker/sync/syncDockets";
import { HEADER, row } from "./fixtures";

/** A fake Google Sheet answering A1 ranges like the Sheets API (trailing empty rows dropped). */
function fakeSheet(sheet: unknown[][]) {
  const reads: string[] = [];
  const reader: SheetReader = async (range) => {
    reads.push(range);
    const m = /!([A-Z])(\d+):([A-Z])(\d*)$/.exec(range)!;
    const c1 = m[1].charCodeAt(0) - 65;
    const c2 = m[3].charCodeAt(0) - 65;
    const r1 = Number(m[2]);
    const r2 = m[4] ? Number(m[4]) : sheet.length;
    return sheet.slice(r1 - 1, r2).map((r) => r.slice(c1, c2 + 1));
  };
  return { reader, reads };
}

const opts = { topRows: 3, pageRows: 3 };
const docket = (wo: string) =>
  env.DB.prepare("SELECT * FROM dockets WHERE work_order = ?").bind(wo).first<Record<string, unknown>>();
const state = () => env.DB.prepare("SELECT * FROM sync_state WHERE id = 1").first<Record<string, unknown>>();

// 9 data rows: sheet rows 2..10, newest (highest WO) on top.
const base = () => [HEADER, ...[9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => row(n, { 6: `Customer ${n}` }))];

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM dockets"),
    env.DB.prepare("DELETE FROM review_items"),
    env.DB.prepare("UPDATE sync_state SET page_cursor = NULL, last_error = NULL, last_full_at = NULL WHERE id = 1"),
  ]);
  await runSync(env, base());
});

describe("runIncrementalSync", () => {
  it("reads only the top rows plus one rotating page", async () => {
    const { reader, reads } = fakeSheet(base());
    const r = await runIncrementalSync(env, reader, opts);
    expect(r.ok).toBe(true);
    expect(reads).toEqual(["Contempra!A1:P4", "Contempra!A5:P7"]);
    expect(r.rowsChanged).toBe(0);
  });

  it("picks up a new docket inserted at the top", async () => {
    const sheet = base();
    sheet.splice(1, 0, row(10, { 6: "Brand New" }));
    const r = await runIncrementalSync(env, fakeSheet(sheet).reader, opts);
    expect((await docket("10"))?.customer).toBe("Brand New");
    expect(r.rowsChanged).toBeGreaterThanOrEqual(1);
  });

  it("advances the page cursor and wraps to the first page after the end", async () => {
    const { reader, reads } = fakeSheet(base());
    await runIncrementalSync(env, reader, opts); // page rows 5-7
    await runIncrementalSync(env, reader, opts); // page rows 8-10
    await runIncrementalSync(env, reader, opts); // past the end -> wraps
    await runIncrementalSync(env, reader, opts);
    expect(reads.filter((r) => r !== "Contempra!A1:P4")).toEqual([
      "Contempra!A5:P7",
      "Contempra!A8:P10",
      "Contempra!A11:P13",
      "Contempra!A5:P7",
    ]);
  });

  it("an edit to an old row arrives when its page comes around", async () => {
    const sheet = base();
    sheet[9] = row(1, { 6: "Edited Old" }); // sheet row 10
    const { reader } = fakeSheet(sheet);
    await runIncrementalSync(env, reader, opts);
    expect((await docket("1"))?.customer).toBe("Customer 1");
    await runIncrementalSync(env, reader, opts);
    expect((await docket("1"))?.customer).toBe("Edited Old");
  });

  it("aborts on a header mismatch without writing", async () => {
    const sheet = base();
    sheet[0] = [...HEADER];
    sheet[0][6] = "Client";
    sheet[1] = row(9, { 6: "Should Not Land" });
    const r = await runIncrementalSync(env, fakeSheet(sheet).reader, opts);
    expect(r).toMatchObject({ ok: false, error: "Header mismatch: G" });
    expect((await docket("9"))?.customer).toBe("Customer 9");
  });

  it("never lets a lower duplicate overwrite the docket", async () => {
    const sheet = base();
    sheet[8] = row(9, { 6: "Lower Duplicate" }); // sheet row 9 duplicates WO 9 (row 2)
    await runNightlyReconcile(env, fakeSheet(sheet).reader);
    const { reader } = fakeSheet(sheet);
    await runIncrementalSync(env, reader, opts);
    await runIncrementalSync(env, reader, opts);
    expect((await docket("9"))?.customer).toBe("Customer 9");
  });

  it("explains when no Google Sheet is connected", async () => {
    await env.DB.prepare("DELETE FROM google_connection").run();
    const r = await runIncrementalSync(env);
    expect(r).toMatchObject({ ok: false, error: "Google Sheet is not connected yet" });
  });
});

describe("runNightlyReconcile", () => {
  it("reads only the Work Order column", async () => {
    const { reader, reads } = fakeSheet(base());
    await runNightlyReconcile(env, reader);
    expect(reads).toEqual(["Contempra!C1:C"]);
  });

  it("deletes dockets whose work order left the sheet", async () => {
    const sheet = base().filter((r) => r[2] !== 5);
    const r = await runNightlyReconcile(env, fakeSheet(sheet).reader);
    expect(r).toMatchObject({ ok: true, rowsDeleted: 1 });
    expect(await docket("5")).toBeNull();
    expect((await state())?.last_full_at).toBeTruthy();
  });

  it("rebuilds Needs Review from duplicates and invalid work orders", async () => {
    const sheet = base();
    sheet[8] = row(9);
    sheet[9] = row("abc");
    await runNightlyReconcile(env, fakeSheet(sheet).reader);
    const { results } = await env.DB.prepare("SELECT kind, work_order, sheet_row FROM review_items ORDER BY sheet_row").all();
    expect(results).toEqual([
      { kind: "duplicate_work_order", work_order: "9", sheet_row: 2 },
      { kind: "duplicate_work_order", work_order: "9", sheet_row: 9 },
      { kind: "invalid_work_order", work_order: "abc", sheet_row: 10 },
    ]);
  });

  it("refuses to delete when the column comes back mostly empty", async () => {
    const many = [HEADER, ...Array.from({ length: 200 }, (_, i) => row(i + 1))];
    await runSync(env, many);
    const r = await runNightlyReconcile(env, fakeSheet([HEADER, row(1)]).reader);
    expect(r).toMatchObject({ ok: false, error: "Sheet returned too few rows (1 of 200)" });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM dockets").first<{ n: number }>())?.n).toBe(200);
  });

  it("aborts when the Work Order header moved", async () => {
    const sheet = base().map((r) => [...r]);
    sheet[0][2] = "WO";
    const r = await runNightlyReconcile(env, fakeSheet(sheet).reader);
    expect(r).toMatchObject({ ok: false, error: "Header mismatch: C" });
  });
});
