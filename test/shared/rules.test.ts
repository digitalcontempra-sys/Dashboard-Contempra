import { describe, expect, it } from "vitest";
import {
  deriveBilling,
  deriveStatus,
  deriveTimeBucket,
  normalizeAccountManager,
  parseSheetDate,
  todayInBusinessTz,
  weekEnd,
} from "../../src/shared/rules";

const base = { comp: false, hold: false, dueRaw: null, invDateRaw: null };

describe("parseSheetDate", () => {
  it("converts a Sheets serial number", () => {
    expect(parseSheetDate(46314)).toEqual({ iso: "2026-10-19", raw: null });
  });
  it("parses 'Mon DD-YYYY' text", () => {
    expect(parseSheetDate("Apr 20-2026")).toEqual({ iso: "2026-04-20", raw: "Apr 20-2026" });
  });
  it("rejects a year outside 2000-2100 and keeps raw", () => {
    expect(parseSheetDate("Sep 23, 0202")).toEqual({ iso: null, raw: "Sep 23, 0202" });
  });
  it("keeps non-date text as raw", () => {
    expect(parseSheetDate("in production")).toEqual({ iso: null, raw: "in production" });
  });
  it("keeps an out-of-range serial visible as raw text", () => {
    expect(parseSheetDate(6697092)).toEqual({ iso: null, raw: "6697092" });
  });
  it("treats empty input as no date", () => {
    expect(parseSheetDate("")).toEqual({ iso: null, raw: null });
    expect(parseSheetDate(undefined)).toEqual({ iso: null, raw: null });
  });
});

describe("normalizeAccountManager", () => {
  it("trims and uppercases", () => {
    expect(normalizeAccountManager(" mb ")).toBe("MB");
    expect(normalizeAccountManager("JB ")).toBe("JB");
  });
  it("returns null for blanks", () => {
    expect(normalizeAccountManager("  ")).toBeNull();
  });
});

describe("deriveStatus", () => {
  it("cancel text in Due Date wins over COMP", () => {
    expect(deriveStatus({ ...base, comp: true, dueRaw: "CANCEL 1-DEC-25" })).toBe("cancelled");
  });
  it("cancel text in Inv/Date means cancelled", () => {
    expect(deriveStatus({ ...base, invDateRaw: "cancel 24-aug-25" })).toBe("cancelled");
  });
  it("COMP wins over HOLD", () => {
    expect(deriveStatus({ ...base, comp: true, hold: true })).toBe("completed");
  });
  it("HOLD alone is on_hold", () => {
    expect(deriveStatus({ ...base, hold: true })).toBe("on_hold");
  });
  it("otherwise active", () => {
    expect(deriveStatus(base)).toBe("active");
  });
});

describe("deriveBilling", () => {
  it("classifies Inv/Date values", () => {
    expect(deriveBilling("151409 8-AUG-25")).toBe("billed");
    expect(deriveBilling("NO CHARGE 6-OCT-26")).toBe("no_charge");
    expect(deriveBilling("  ")).toBe("not_billed");
    expect(deriveBilling(null)).toBe("not_billed");
    expect(deriveBilling("CANCEL DEC-8-25")).toBe("cancelled");
  });
});

describe("business dates", () => {
  it("today is computed in Winnipeg time", () => {
    expect(todayInBusinessTz(new Date("2026-10-20T04:30:00Z"))).toBe("2026-10-19");
  });
  it("week ends on Sunday", () => {
    expect(weekEnd("2026-10-19")).toBe("2026-10-25");
    expect(weekEnd("2026-10-25")).toBe("2026-10-25");
  });
});

describe("deriveTimeBucket", () => {
  const today = "2026-10-19";
  it("rush text goes to rush_today", () => {
    expect(deriveTimeBucket(null, true, today)).toEqual({ bucket: "rush_today", overdue: false });
  });
  it("past dates are rush_today and overdue", () => {
    expect(deriveTimeBucket("2026-10-15", false, today)).toEqual({ bucket: "rush_today", overdue: true });
  });
  it("today is rush_today, not overdue", () => {
    expect(deriveTimeBucket("2026-10-19", false, today)).toEqual({ bucket: "rush_today", overdue: false });
  });
  it("through Sunday is this_week, after is coming", () => {
    expect(deriveTimeBucket("2026-10-25", false, today).bucket).toBe("this_week");
    expect(deriveTimeBucket("2026-10-26", false, today).bucket).toBe("coming");
  });
  it("no date is no_due_date", () => {
    expect(deriveTimeBucket(null, false, today).bucket).toBe("no_due_date");
  });
});
