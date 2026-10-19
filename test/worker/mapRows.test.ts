import { describe, expect, it } from "vitest";
import { HeaderMismatchError, mapSheet } from "../../src/worker/sheet/mapRows";
import { HEADER, row } from "./fixtures";


describe("mapSheet", () => {
  it("rejects a renamed column with HeaderMismatchError", async () => {
    const bad = [...HEADER];
    bad[6] = "Client";
    const err = await mapSheet([bad, row(1)]).catch((e) => e);
    expect(err).toBeInstanceOf(HeaderMismatchError);
    expect(err.column).toBe("G");
  });

  it("accepts 'Account Manager' as the column J header", async () => {
    const h = [...HEADER];
    h[9] = "Account Manager";
    const { dockets } = await mapSheet([h, row(5)]);
    expect(dockets).toHaveLength(1);
  });

  it("maps a full row", async () => {
    const { dockets } = await mapSheet([
      HEADER,
      [46314, "RUSH", 91487, false, false, 3, "Tartan Towing", "Decals", "", " mb ", "", false, "", "", "", ""],
    ]);
    expect(dockets[0]).toMatchObject({
      workOrder: "91487",
      sheetRow: 2,
      dateIso: "2026-10-19",
      dueRaw: "RUSH",
      dueRush: true,
      accountManager: "MB",
      customer: "Tartan Towing",
      status: "active",
      billing: "not_billed",
    });
  });

  it("pads trailing-trimmed rows", async () => {
    const { dockets } = await mapSheet([HEADER, ["", "", 91000]]);
    expect(dockets[0]).toMatchObject({ workOrder: "91000", customer: null, comp: false, link: null });
  });

  it("skips fully empty rows", async () => {
    const { dockets, review } = await mapSheet([HEADER, [], ["", "", "", false, false]]);
    expect(dockets).toHaveLength(0);
    expect(review).toHaveLength(0);
  });

  it("keeps the topmost duplicate and reports every occurrence", async () => {
    const { dockets, review } = await mapSheet([
      HEADER, row(90919, { 6: "Top" }), row(1), row(2), row(90919, { 6: "Bottom" }),
    ]);
    const d = dockets.filter((x) => x.workOrder === "90919");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ sheetRow: 2, customer: "Top" });
    expect(review.filter((r) => r.kind === "duplicate_work_order").map((r) => r.sheetRow)).toEqual([2, 5]);
  });

  it("reports a non-numeric work order as invalid", async () => {
    const { dockets, review } = await mapSheet([HEADER, row("abc")]);
    expect(dockets).toHaveLength(0);
    expect(review).toEqual([expect.objectContaining({ kind: "invalid_work_order", sheetRow: 2, workOrder: "abc" })]);
  });

  it("accepts a numeric string work order", async () => {
    const { dockets } = await mapSheet([HEADER, row("91500")]);
    expect(dockets[0].workOrder).toBe("91500");
  });

  it("hash is stable and changes with content", async () => {
    const a = await mapSheet([HEADER, row(7)]);
    const b = await mapSheet([HEADER, row(7)]);
    const c = await mapSheet([HEADER, row(7, { 14: "new note" })]);
    expect(a.dockets[0].rowHash).toBe(b.dockets[0].rowHash);
    expect(c.dockets[0].rowHash).not.toBe(a.dockets[0].rowHash);
  });

  it("hash ignores the sheet row position", async () => {
    const a = await mapSheet([HEADER, row(7)]);
    const b = await mapSheet([HEADER, row(8), row(7)]);
    expect(b.dockets[1].rowHash).toBe(a.dockets[0].rowHash);
  });
});
