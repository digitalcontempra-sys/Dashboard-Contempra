export const HEADER = [
  "Date", "Due Date", "Work Order", "COMP", "HOLD", "#", "Customer", "Project", "Address", " ",
  "ROLE", "Inv", "Inv/Date", "Quote  /  PO    DEPOSIT", "Notes", "LINK",
];

/** Column indexes: 0 Date, 1 Due, 2 WO, 3 COMP, 4 HOLD, 6 Customer, 7 Project, 9 AM, 12 Inv/Date, 14 Notes. */
export function row(wo: unknown, extra: Partial<Record<number, unknown>> = {}): unknown[] {
  const r: unknown[] = [46314, "", wo, false, false, 1, "Acme", "Sign", "", "JB", "", false, "", "", "", ""];
  for (const [i, v] of Object.entries(extra)) r[Number(i)] = v;
  return r;
}
