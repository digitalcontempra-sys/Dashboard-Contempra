import { describe, expect, it } from "vitest";
import {
  areaCellText,
  continueBlocker,
  continueLabel,
  fieldsSummary,
  normalizeJob,
  sanitizeFields,
  stageText,
} from "../../src/shared/cards";

const ctx = { proofRequired: false };
const msg = (roleId: string, f: Record<string, string | boolean | null>, c = ctx) => continueBlocker(roleId, f, c)?.message ?? null;

describe("continueBlocker", () => {
  it("laminate needs Laminated", () => {
    expect(msg("laminate_roll", {})).toBe('Mark "Laminated" to continue');
    expect(msg("laminate_roll", { laminated: true })).toBeNull();
  });
  it("printer roll: missing file blocks and suggests Design", () => {
    const b = continueBlocker("printer_roll", { printed: true, file: "missing" }, ctx);
    expect(b).toEqual({ message: "File is missing. Send it back to Design.", sendBackToDesign: true });
    expect(msg("printer_roll", { printed: true })).toBe("Choose File: OK or Missing");
    expect(msg("printer_roll", { printed: true, file: "ok" })).toBeNull();
  });
  it("printer FB needs sheet kind, size and quantity", () => {
    expect(msg("printer_fb", { printed: true, file: "ok" })).toBe('Choose "New sheet" or "Cut off"');
    expect(msg("printer_fb", { printed: true, file: "ok", sheetKind: "cutoff" })).toBe("Enter the size and quantity");
    expect(msg("printer_fb", { printed: true, file: "ok", sheetKind: "cutoff", sheetSize: "4x8", sheetQty: "2" })).toBeNull();
  });
  it("colex: cut file missing blocks", () => {
    const b = continueBlocker("colex", { completed: true, cutFileMissing: true }, ctx);
    expect(b).toEqual({ message: "Cut file is missing. Send it back to Design.", sendBackToDesign: true });
    expect(msg("colex", {})).toBe('Mark "Completed" to continue');
  });
  it("finishing needs Ready/Shipped and where it was left", () => {
    expect(msg("finishing", { packaged: "almost", leftAt: "Rack 3" })).toBe('Set Packaged to "Ready" or "Shipped" to continue');
    expect(msg("finishing", { packaged: "ready", leftAt: "" })).toBe('Fill in "I left this job at…" to continue');
    expect(msg("finishing", { packaged: "shipped", leftAt: "Rack 3" })).toBeNull();
  });
  it("designer needs Proof approved only when proof is required", () => {
    expect(msg("designer", {})).toBeNull();
    expect(msg("designer", {}, { proofRequired: true })).toBe('Mark "Proof approved" to continue');
  });
  it("installer needs Installed", () => {
    expect(msg("installer", {})).toBe('Mark "Installed" to continue');
  });
});

describe("continueLabel", () => {
  it("names the next area", () => {
    expect(continueLabel("printer_roll", "laminate_roll")).toBe("Continue → Laminate");
    expect(continueLabel("finishing", null)).toBe("Continue → Done");
    expect(continueLabel("designer", "printer_roll")).toBe("Send to production →");
  });
});

describe("normalizeJob", () => {
  it("first non-done becomes active, the rest waiting", () => {
    const out = normalizeJob([
      { step: 0, status: "done" as const },
      { step: 1, status: "waiting" as const },
      { step: 2, status: "active" as const },
    ]);
    expect(out.map((c) => c.status)).toEqual(["done", "active", "waiting"]);
  });
  it("keeps a valid job unchanged (same objects)", () => {
    const input = [
      { step: 0, status: "active" as const },
      { step: 1, status: "waiting" as const },
      { step: 2, status: "waiting" as const },
    ];
    const out = normalizeJob(input);
    expect(out.map((c) => c.status)).toEqual(["active", "waiting", "waiting"]);
    out.forEach((c, i) => expect(c).toBe(input[i]));
  });
  it("done work stays done after a step is inserted before it", () => {
    const out = normalizeJob([
      { step: 0, status: "waiting" as const },
      { step: 1, status: "done" as const },
      { step: 2, status: "waiting" as const },
    ]);
    expect(out.map((c) => c.status)).toEqual(["active", "done", "waiting"]);
  });
  it("sorts by step", () => {
    const out = normalizeJob([
      { step: 1, status: "waiting" as const },
      { step: 0, status: "waiting" as const },
    ]);
    expect(out.map((c) => [c.step, c.status])).toEqual([
      [0, "active"],
      [1, "waiting"],
    ]);
  });
});

describe("sanitizeFields", () => {
  it("keeps known keys, coerces checks, caps text", () => {
    const f = sanitizeFields("colex", { completed: "yes", evil: 1, note: "x".repeat(600) });
    expect(f).toEqual({ completed: true, note: "x".repeat(500) });
  });
  it("drops choice values outside the options", () => {
    expect(sanitizeFields("printer_roll", { file: "maybe" })).toEqual({ file: null });
    expect(sanitizeFields("printer_roll", { file: "ok" })).toEqual({ file: "ok" });
  });
  it("unknown role gives empty fields", () => {
    expect(sanitizeFields("nope", { a: 1 })).toEqual({});
  });
});

describe("fieldsSummary", () => {
  it("joins set fields in order", () => {
    expect(
      fieldsSummary("printer_roll", { printed: true, machine: "HP Latex 800", material: "IJ35", lengthFt: "24", file: null }),
    ).toBe("Printed ✓ · Machine: HP Latex 800 · Material used: IJ35 · Material length (LN FT): 24");
  });
  it("uses option labels for choices", () => {
    expect(fieldsSummary("finishing", { packaged: "almost" })).toBe("Packaged: Almost Ready");
  });
});

describe("areaCellText", () => {
  const base = { returnedReason: null, claimedByName: null, doneByName: null, doneAt: null, fields: {}, roleId: "printer_roll" };
  it("covers every state", () => {
    expect(areaCellText(null)).toBe("—");
    expect(areaCellText({ ...base, status: "waiting" })).toBe("Pending");
    expect(areaCellText({ ...base, status: "active" })).toBe("Active · Team");
    expect(areaCellText({ ...base, status: "active", claimedByName: "Seb Bastian" })).toBe("Active · Seb");
    expect(areaCellText({ ...base, status: "active", returnedReason: "Cut file missing" })).toBe("Returned · Cut file missing");
    expect(
      areaCellText({ ...base, status: "done", doneByName: "Seb Bastian", doneAt: "2026-11-09T20:00:00Z", roleId: "finishing", fields: { packaged: "shipped" } }),
    ).toBe("✓ Seb 11/09 · Shipped");
  });
  it("uses the Winnipeg date", () => {
    expect(areaCellText({ ...base, status: "done", doneByName: "Erin", doneAt: "2026-11-10T03:00:00Z" })).toBe("✓ Erin 11/09");
  });
});

describe("stageText", () => {
  it("lists active areas in role order", () => {
    expect(stageText([{ roleId: "colex" }, { roleId: "printer_roll" }], false)).toBe("Print Roll, Colex");
    expect(stageText([{ roleId: "colex" }, { roleId: "colex" }], false)).toBe("Colex");
    expect(stageText([], true)).toBe("Done");
    expect(stageText([], false)).toBe("—");
  });
});
