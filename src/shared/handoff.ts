/** Pure rules of the hand-to-hand docket flow, shared by the Worker and the web app. */

/** Role of a card for a person without an area (notes only), and of the creator's card. */
export const GENERAL_ROLE = "general";

/** State of the creator's card, the one the docket returns to. */
export type CardStage = "ready_to_close" | "waiting_design" | "waiting_sample";

export const STAGE_STATUS: Record<CardStage, string> = {
  ready_to_close: "Ready to close",
  waiting_design: "Waiting for design approval",
  waiting_sample: "Waiting for sample approval",
};

const SAMPLE_ROLES = new Set(["printer_roll", "printer_fb", "laminate_roll", "liquid_lam"]);

/** Which approval a card can ask the creator for: a design proof or a sample. */
export function approvalKind(roleId: string): "proof" | "sample" | null {
  if (roleId === "designer") return "proof";
  return SAMPLE_ROLES.has(roleId) ? "sample" : null;
}

/** One person the docket goes to, the area they work it in, and what they must do. */
export type HandoffTarget = { userId: number; roleId: string; instruction: string };

export type Person = { id: number; name: string; roles: string[] };

const MAX_TARGETS = 10;
const MAX_NOTE = 300;

/**
 * Checks the people chosen for a hand-off. A person without areas gets a general card; a person
 * with one area gets it by default; with several, one of theirs must be chosen.
 */
export function parseTargets(raw: unknown, people: Person[]): HandoffTarget[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_TARGETS) : [];
  const out: HandoffTarget[] = [];
  for (const item of list) {
    const t = (item && typeof item === "object" ? item : {}) as { userId?: unknown; roleId?: unknown; instruction?: unknown };
    const person = people.find((p) => p.id === t.userId);
    if (!person) continue;
    let roleId = typeof t.roleId === "string" && t.roleId !== "" ? t.roleId : null;
    if (person.roles.length === 0) roleId = GENERAL_ROLE;
    else if (roleId === null && person.roles.length === 1) roleId = person.roles[0];
    if (roleId === null || (roleId !== GENERAL_ROLE && !person.roles.includes(roleId)) || (roleId === GENERAL_ROLE && person.roles.length > 0)) {
      throw new Error(`Choose an area for ${person.name}.`);
    }
    const instruction = typeof t.instruction === "string" ? t.instruction.trim().slice(0, MAX_NOTE) : "";
    if (!instruction) throw new Error(`Write what to do for ${person.name}.`);
    if (out.some((o) => o.userId === person.id && o.roleId === roleId)) continue;
    out.push({ userId: person.id, roleId, instruction });
  }
  if (out.length === 0) throw new Error("Choose at least one person.");
  return out;
}
