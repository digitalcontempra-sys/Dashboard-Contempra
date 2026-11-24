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

/** Area only admins and managers can send work to. */
export const SUBCONTRACT_ROLE = "subcontract";

/** A crew the docket can be sent to as a whole (its members as of the hand-off). */
export type TeamTarget = { id: number; name: string; memberIds: number[] };

/**
 * One person (or one team: userId 0) the docket goes to, the area they work it in, and what they
 * must do. A team target gives one card to all its members.
 */
export type HandoffTarget = { userId: number; roleId: string; instruction: string; team?: TeamTarget };

export type Person = { id: number; name: string; roles: string[] };
export type Team = { id: number; name: string; roleId: string; memberIds: number[] };

const MAX_TARGETS = 10;
const MAX_NOTE = 300;

/**
 * Checks the people chosen for a hand-off. A person without areas gets a general card; a person
 * with one area gets it by default; with several, one of theirs must be chosen.
 */
export function parseTargets(raw: unknown, people: Person[], teams: Team[] = []): HandoffTarget[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_TARGETS) : [];
  const out: HandoffTarget[] = [];
  for (const item of list) {
    const t = (item && typeof item === "object" ? item : {}) as { userId?: unknown; roleId?: unknown; instruction?: unknown; teamId?: unknown };
    if (t.teamId !== undefined) {
      const team = teams.find((x) => x.id === t.teamId);
      // Only active members get the card; a team with none is skipped.
      const memberIds = team ? team.memberIds.filter((id) => people.some((p) => p.id === id)).sort((a, b) => a - b) : [];
      if (!team || memberIds.length === 0 || out.some((o) => o.team?.id === team.id)) continue;
      const instruction = typeof t.instruction === "string" ? t.instruction.trim().slice(0, MAX_NOTE) : "";
      out.push({ userId: 0, roleId: team.roleId, instruction, team: { id: team.id, name: team.name, memberIds } });
      continue;
    }
    const person = people.find((p) => p.id === t.userId);
    if (!person) continue;
    let roleId = typeof t.roleId === "string" && t.roleId !== "" ? t.roleId : null;
    // Sub Contract is never someone's own area: a manager who only has it still gets a General card.
    const areas = homeAreas(person.roles);
    if (roleId === null) roleId = areas.length === 0 ? GENERAL_ROLE : areas.length === 1 ? areas[0] : null;
    if (roleId === null || (roleId !== GENERAL_ROLE && !person.roles.includes(roleId)) || (roleId === GENERAL_ROLE && areas.length > 0)) {
      throw new Error(`Choose an area for ${person.name}.`);
    }
    // What to do is optional.
    const instruction = typeof t.instruction === "string" ? t.instruction.trim().slice(0, MAX_NOTE) : "";
    if (out.some((o) => !o.team && o.userId === person.id && o.roleId === roleId)) continue;
    out.push({ userId: person.id, roleId, instruction });
  }
  if (out.length === 0) throw new Error("Choose at least one person.");
  // One person would get two cards for the same area.
  for (const o of out) {
    const team = !o.team && out.find((x) => x.team && x.roleId === o.roleId && x.team.memberIds.includes(o.userId))?.team;
    if (team) throw new Error(`${people.find((p) => p.id === o.userId)?.name ?? "Someone"} is already in ${team.name}.`);
  }
  return out;
}

/** A person's own areas (Sub Contract is an area people are sent work in, not one they belong to). */
export const homeAreas = (roles: string[]) => roles.filter((r) => r !== SUBCONTRACT_ROLE);
