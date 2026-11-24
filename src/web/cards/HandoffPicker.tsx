import { AREA_LABEL, ROLE_ORDER } from "../../shared/cards";
import { GENERAL_ROLE, SUBCONTRACT_ROLE } from "../../shared/handoff";
import type { AssigneeDTO, TeamDTO } from "../../shared/types";
import { Icon } from "../components/Icon";

/** One person ("<userId>:<roleId>") or team ("team:<id>") the docket goes to, and what they must do. */
export type HandoffRow = { pick: string; instruction: string };

export const emptyRow = (): HandoffRow => ({ pick: "", instruction: "" });

/** Every row names a person or team; What to do is optional. */
export const rowsComplete = (rows: HandoffRow[]) => rows.length > 0 && rows.every((r) => r.pick !== "");

/** What the API takes: a person in an area, or a team. */
export type PickedTarget = { userId: number; roleId: string; instruction: string } | { teamId: number; instruction: string };

export function toTargets(rows: HandoffRow[]): PickedTarget[] {
  return rows.map((r) => {
    if (r.pick.startsWith("team:")) return { teamId: Number(r.pick.slice(5)), instruction: r.instruction.trim() };
    const [id, roleId] = r.pick.split(":");
    return { userId: Number(id), roleId, instruction: r.instruction.trim() };
  });
}

/**
 * Who gets the docket next, grouped by area. Installer teams come first (one card for the whole
 * crew). A person with several areas is listed in each (the choice also picks the area); people
 * without an area are under "Other" and get a general card. Only managers see Sub Contract.
 */
export function HandoffPicker({
  people,
  rows,
  onChange,
  disabled = false,
  teams = [],
  canSubcontract = false,
}: {
  people: AssigneeDTO[];
  rows: HandoffRow[];
  onChange: (rows: HandoffRow[]) => void;
  disabled?: boolean;
  teams?: TeamDTO[];
  canSubcontract?: boolean;
}) {
  const crews = teams.filter((t) => t.members.length > 0);
  const groups = [
    ...ROLE_ORDER.filter((roleId) => canSubcontract || roleId !== SUBCONTRACT_ROLE).map((roleId) => ({
      roleId: roleId as string,
      label: AREA_LABEL[roleId],
      people: people.filter((p) => p.roles.includes(roleId)),
    })),
    { roleId: GENERAL_ROLE, label: "Other", people: people.filter((p) => p.roles.length === 0) },
  ].filter((g) => g.people.length > 0);
  const set = (i: number, row: HandoffRow) => onChange(rows.map((r, ri) => (ri === i ? row : r)));

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="min-w-0 rounded-2xl bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <select
              aria-label={`Person ${i + 1}`}
              className="field min-w-0 flex-1 bg-surface-strong text-sm"
              value={row.pick}
              disabled={disabled}
              onChange={(e) => set(i, { ...row, pick: e.target.value })}
            >
              <option value="">Choose a person…</option>
              {crews.length > 0 && (
                <optgroup label="Teams">
                  {crews.map((t) => (
                    <option key={t.id} value={`team:${t.id}`}>
                      {`${t.name} — ${AREA_LABEL[t.roleId] ?? t.roleId} (${t.members.map((m) => m.fullName).join(", ")})`}
                    </option>
                  ))}
                </optgroup>
              )}
              {groups.map((g) => (
                <optgroup key={g.roleId} label={g.label}>
                  {g.people.map((p) => (
                    <option key={p.id} value={`${p.id}:${g.roleId}`}>
                      {p.fullName}
                      {g.roleId === GENERAL_ROLE ? "" : ` — ${g.label}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {rows.length > 1 && (
              <button
                type="button"
                aria-label={`Remove person ${i + 1}`}
                className="grid size-10 shrink-0 place-items-center rounded-full text-text-3 hover:bg-surface-strong hover:text-danger"
                disabled={disabled}
                onClick={() => onChange(rows.filter((_, ri) => ri !== i))}
              >
                <Icon name="close" className="size-4" />
              </button>
            )}
          </div>
          <label htmlFor={`handoff-note-${i}`} className="mt-2 mb-1 block text-[13px] font-medium text-text-2">
            What to do
          </label>
          <textarea
            id={`handoff-note-${i}`}
            aria-label={`What to do ${i + 1}`}
            className="field min-h-16 bg-surface-strong py-2 text-sm"
            maxLength={300}
            value={row.instruction}
            disabled={disabled}
            onChange={(e) => set(i, { ...row, instruction: e.target.value })}
          />
        </div>
      ))}
      <button type="button" className="btn-ghost min-h-11 px-3 text-xs" disabled={disabled} onClick={() => onChange([...rows, emptyRow()])}>
        <Icon name="plus" className="size-4" />
        Add person
      </button>
    </div>
  );
}
