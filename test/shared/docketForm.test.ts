import { describe, expect, it } from "vitest";
import {
  cancelStamp,
  computeTotals,
  emptyForm,
  formFromDocket,
  stripPrices,
  summarizeBody,
  toSheetCells,
  type DocketForm,
} from "../../src/shared/docketForm";

const base = (): DocketForm => ({
  ...emptyForm("2026-10-19", "Ana"),
  forName: "Encore Lounge",
  address: "123 Main St",
  salesperson: "JB",
  body: "exterior letters?\ninterior sign",
});

describe("emptyForm", () => {
  it("prefills date, order taker and fixed table sizes", () => {
    const f = emptyForm("2026-10-19", "Ana");
    expect(f.date).toBe("2026-10-19");
    expect(f.orderTakenBy).toBe("Ana");
    expect(f.labour).toHaveLength(8);
    expect(f.materials).toHaveLength(7);
    expect(f.required).toEqual({ kind: "none" });
    expect(f.gst).toBeNull();
  });
});

describe("computeTotals", () => {
  it("adds costs, delivery, GST 5% and PST 7%", () => {
    const f = base();
    f.materials[0].cost = "100";
    f.materials[1].cost = "50.5";
    f.delivery = "10";
    f.deposit = "50";
    expect(computeTotals(f)).toEqual({
      total: 150.5,
      subtotal: 160.5,
      gst: 8.03,
      pst: 11.24,
      grandTotal: 179.77,
      balanceDue: 129.77,
    });
  });
  it("uses a GST override", () => {
    const f = base();
    f.materials[0].cost = "$1,000";
    f.gst = "0";
    expect(computeTotals(f)).toMatchObject({ total: 1000, gst: 0, pst: 70, grandTotal: 1070 });
  });
});

describe("summarizeBody", () => {
  it("joins non-empty lines", () => {
    expect(summarizeBody("exterior letters?\n\n  interior sign\nawning decal")).toBe(
      "exterior letters? / interior sign / awning decal",
    );
  });
  it("cuts long bodies at 200 characters with an ellipsis", () => {
    const s = summarizeBody("word ".repeat(100));
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("toSheetCells", () => {
  it("create writes the full row with flags off", () => {
    const f = base();
    f.required = { kind: "text", text: "RUSH" };
    const c = toSheetCells(f, "91488", "create");
    expect(c).toMatchObject({
      A: 46314,
      B: "RUSH",
      C: 91488,
      D: false,
      E: false,
      G: "Encore Lounge",
      H: "exterior letters? / interior sign",
      I: "123 Main St",
      J: "JB",
      L: false,
    });
    expect(c).not.toHaveProperty("M");
  });
  it("writes a required date as a serial", () => {
    const f = base();
    f.required = { kind: "date", date: "2026-10-21" };
    expect(toSheetCells(f, "1", "create").B).toBe(46316);
  });
  it("edit never touches C, D, E, L and skips empty M and N", () => {
    const c = toSheetCells(base(), "91488", "edit");
    for (const k of ["C", "D", "E", "L", "M", "N"]) expect(c).not.toHaveProperty(k);
  });
  it("joins quote and PO into N", () => {
    const f = base();
    f.quoteNo = "1234";
    f.poNo = "5678";
    f.invoiceNo = "151409";
    const c = toSheetCells(f, "1", "edit");
    expect(c.N).toBe("Q 1234 / PO 5678");
    expect(c.M).toBe("151409");
  });
});

describe("cancelStamp", () => {
  it("formats like the sheet", () => {
    expect(cancelStamp(new Date("2026-11-05T18:00:00Z"))).toBe("CANCEL 5-NOV-26");
  });
});

describe("stripPrices", () => {
  it("removes every price but keeps the rest", () => {
    const f = base();
    f.materials[0] = { name: "IJ35", cost: "100" };
    f.delivery = "10";
    f.deposit = "5";
    f.gst = "3";
    const s = stripPrices(f);
    expect(s.materials[0]).toEqual({ name: "IJ35", cost: "" });
    expect([s.delivery, s.deposit, s.gst, s.pst]).toEqual(["", "", null, null]);
    expect(s.forName).toBe("Encore Lounge");
  });
});

describe("formFromDocket", () => {
  it("prefills from sheet data", () => {
    const f = formFromDocket(
      {
        workOrder: "91376", customer: "Encore Lounge", project: "4x exterior letters", accountManager: "JB",
        dateIso: "2026-10-13", dueIso: null, dueRaw: "RUSH", status: "active", billing: "not_billed",
        bucket: "rush_today", overdue: false, sheetRow: 5, dateRaw: null, comp: false, hold: false, seq: null,
        address: "Portage Ave", roleNote: null, inv: false, invDateRaw: null, quotePo: "PO 30451", notes: null,
        link: null, syncedAt: "",
      },
    );
    expect(f).toMatchObject({
      forName: "Encore Lounge",
      address: "Portage Ave",
      date: "2026-10-13",
      salesperson: "JB",
      body: "4x exterior letters",
      poNo: "30451",
      orderTakenBy: "",
      required: { kind: "text", text: "RUSH" },
    });
  });
});
