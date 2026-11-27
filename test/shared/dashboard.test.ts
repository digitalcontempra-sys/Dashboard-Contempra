import { describe, expect, it } from "vitest";
import {
  clockParts,
  firstName,
  hoursAgoIso,
  NEW_ORDER_STALE_HOURS,
  overdueDetail,
  riskDetail,
  TASK_OVERDUE_HOURS,
  waitingDetail,
  wholeDaysSince,
} from "../../src/shared/dashboard";

describe("dashboard header rules", () => {
  it("uses 24 h for task cards and 48 h for New Orders", () => {
    expect(TASK_OVERDUE_HOURS).toBe(24);
    expect(NEW_ORDER_STALE_HOURS).toBe(48);
  });

  it("hoursAgoIso goes back exactly that many hours", () => {
    expect(hoursAgoIso(new Date("2026-11-27T14:00:00.000Z"), 24)).toBe("2026-11-26T14:00:00.000Z");
  });

  it("wholeDaysSince counts full days only", () => {
    const now = new Date("2026-11-27T14:00:00.000Z");
    expect(wholeDaysSince("2026-11-24T13:00:00.000Z", now)).toBe(3);
    expect(wholeDaysSince("2026-11-26T15:00:00.000Z", now)).toBe(0);
  });

  it("firstName takes the first word, trimmed", () => {
    expect(firstName("  Jeff Baumer ")).toBe("Jeff");
    expect(firstName("")).toBe("");
    expect(firstName(null)).toBe("");
  });
});

describe("detail lines", () => {
  it("overdue task cards", () => {
    expect(overdueDetail({ count: 0, oldestDays: null, oldestFrom: null })).toBe("All caught up");
    expect(overdueDetail({ count: 3, oldestDays: 4, oldestFrom: "Jeff" })).toBe("Oldest: 4 days · from Jeff");
    expect(overdueDetail({ count: 1, oldestDays: 1, oldestFrom: "Ana" })).toBe("Oldest: 1 day · from Ana");
    expect(overdueDetail({ count: 1, oldestDays: 0, oldestFrom: "" })).toBe("Oldest: today");
  });

  it("at risk", () => {
    expect(riskDetail({ overdue: 0, dueToday: 0 })).toBe("Nothing overdue");
    expect(riskDetail({ overdue: 5, dueToday: 2 })).toBe("5 overdue · 2 due today");
    expect(riskDetail({ overdue: 0, dueToday: 1 })).toBe("0 overdue · 1 due today");
  });

  it("waiting on you omits zero parts", () => {
    expect(waitingDetail({ newOrders: 0, approvals: 0, sentBack: 0 })).toBe("Nothing waiting");
    expect(waitingDetail({ newOrders: 2, approvals: 1, sentBack: 1 })).toBe("2 new orders · 1 approval · 1 sent back");
    expect(waitingDetail({ newOrders: 1, approvals: 0, sentBack: 3 })).toBe("1 new order · 3 sent back");
    expect(waitingDetail({ newOrders: 0, approvals: 2, sentBack: 0 })).toBe("2 approvals");
  });
});

describe("clock", () => {
  it("shows Winnipeg time, weekday and date", () => {
    expect(clockParts(new Date("2026-11-27T14:00:00.000Z"))).toEqual({
      time: "8:00 AM",
      weekday: "FRIDAY",
      date: "Nov 27, 2026",
      label: "Friday, November 27, 2026, 8:00 AM",
    });
  });

  it("uses the Winnipeg day across UTC midnight", () => {
    const p = clockParts(new Date("2026-11-28T03:30:00.000Z"));
    expect(p.time).toBe("9:30 PM");
    expect(p.weekday).toBe("FRIDAY");
    expect(p.date).toBe("Nov 27, 2026");
  });
});
