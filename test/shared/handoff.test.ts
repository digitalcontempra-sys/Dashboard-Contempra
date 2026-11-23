import { describe, expect, it } from "vitest";
import { AREA_LABEL, ROLE_LABEL } from "../../src/shared/cards";
import { approvalKind, GENERAL_ROLE, parseTargets, STAGE_STATUS } from "../../src/shared/handoff";

const people = [
  { id: 1, name: "Ira Doe", roles: ["designer", "printer_roll"] },
  { id: 2, name: "Sebastian", roles: ["printer_fb"] },
  { id: 3, name: "Mike", roles: [] },
];

describe("approvalKind", () => {
  it("designer sends proofs; printers and laminators send samples", () => {
    expect(approvalKind("designer")).toBe("proof");
    for (const r of ["printer_roll", "printer_fb", "laminate_roll", "liquid_lam"]) expect(approvalKind(r)).toBe("sample");
    expect(approvalKind("finishing")).toBeNull();
    expect(approvalKind(GENERAL_ROLE)).toBeNull();
  });
});

describe("STAGE_STATUS", () => {
  it("names each creator state as the sheet shows it", () => {
    expect(STAGE_STATUS).toEqual({
      ready_to_close: "Ready to close",
      waiting_design: "Waiting for design approval",
      waiting_sample: "Waiting for sample approval",
    });
  });
});

describe("general area", () => {
  it("has a label", () => {
    expect(ROLE_LABEL.general).toBe("General");
    expect(AREA_LABEL.general).toBe("General");
  });
});

describe("parseTargets", () => {
  it("keeps a chosen area and trims the note", () => {
    expect(parseTargets([{ userId: 1, roleId: "printer_roll", instruction: "  Print 2 banners " }], people)).toEqual([
      { userId: 1, roleId: "printer_roll", instruction: "Print 2 banners" },
    ]);
  });

  it("gives a person without areas a general card", () => {
    expect(parseTargets([{ userId: 3, roleId: null, instruction: "Call client" }], people)[0].roleId).toBe("general");
  });

  it("a person with one area gets it when none is chosen", () => {
    expect(parseTargets([{ userId: 2, instruction: "Cut" }], people)[0].roleId).toBe("printer_fb");
  });

  it("refuses an area the person does not have, or none for a person with several", () => {
    expect(() => parseTargets([{ userId: 2, roleId: "designer", instruction: "x" }], people)).toThrow("Choose an area for Sebastian.");
    expect(() => parseTargets([{ userId: 1, instruction: "x" }], people)).toThrow("Choose an area for Ira Doe.");
  });

  it("requires a note for each person", () => {
    expect(() => parseTargets([{ userId: 2, roleId: "printer_fb", instruction: "  " }], people)).toThrow("Write what to do for Sebastian.");
  });

  it("requires at least one known person", () => {
    expect(() => parseTargets([], people)).toThrow("Choose at least one person.");
    expect(() => parseTargets("x", people)).toThrow("Choose at least one person.");
    expect(() => parseTargets([{ userId: 99, roleId: null, instruction: "x" }], people)).toThrow("Choose at least one person.");
  });

  it("drops a repeated person and area", () => {
    const t = { userId: 2, roleId: "printer_fb", instruction: "a" };
    expect(parseTargets([t, { ...t, instruction: "b" }], people)).toHaveLength(1);
  });

  it("caps the note at 300 characters", () => {
    expect(parseTargets([{ userId: 2, instruction: "x".repeat(400) }], people)[0].instruction).toHaveLength(300);
  });
});
