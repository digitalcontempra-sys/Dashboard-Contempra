import { describe, expect, it } from "vitest";
import { taskBucket } from "../../src/shared/taskCards";

const today = "2026-11-10";
const createdAt = "2026-11-09T15:00:00Z";

describe("taskBucket", () => {
  it("maps each kind to a time group", () => {
    expect(taskBucket({ kind: "rush", date: null }, createdAt, today)).toBe("rush_today");
    expect(taskBucket({ kind: "today", date: null }, createdAt, today)).toBe("rush_today");
    expect(taskBucket({ kind: "none", date: null }, createdAt, today)).toBe("no_due_date");
    expect(taskBucket({ kind: "date", date: "2026-12-15" }, createdAt, today)).toBe("coming");
    expect(taskBucket({ kind: "date", date: "2026-11-12" }, createdAt, today)).toBe("this_week");
    expect(taskBucket({ kind: "date", date: "2026-11-01" }, createdAt, today)).toBe("rush_today");
  });
});
