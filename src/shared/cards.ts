import { BUSINESS_TZ } from "./rules";

/** Pure rules for production cards, shared by the Worker and the web app. */

export type CardStatus = "waiting" | "active" | "done";
export type CardFields = Record<string, string | boolean | null>;

export type FieldSpec = {
  key: string;
  label: string;
  kind: "check" | "text" | "choice" | "catalog";
  options?: { value: string; label: string }[];
  required?: boolean;
};

/** Role order, used to sort areas (matches roles.sort). */
export const ROLE_ORDER = [
  "designer",
  "printer_roll",
  "printer_fb",
  "laminate_roll",
  "contour_cut",
  "liquid_lam",
  "colex",
  "finishing",
  "installer",
] as const;

/** Role names as in the roles table (used for role tabs). */
export const ROLE_LABEL: Record<string, string> = {
  designer: "Designer",
  printer_roll: "Printer Roll",
  printer_fb: "Printer FB",
  laminate_roll: "Laminate Roll",
  contour_cut: "Contour Cut",
  liquid_lam: "Liquid Lam",
  colex: "Colex",
  finishing: "Finishing / Packaging",
  installer: "Installer",
};

/** CSS color token (without "--") of each area; the light background is color-mix of it. */
export const AREA_TOKEN: Record<string, string> = {
  designer: "area-design",
  printer_roll: "area-print-roll",
  printer_fb: "area-print-fb",
  laminate_roll: "area-laminate",
  contour_cut: "area-contour-cut",
  liquid_lam: "area-liquid-lam",
  colex: "area-colex",
  finishing: "area-finishing",
  installer: "area-install",
};

/** Area name of each role, used in "Continue → <area>" and the sheet's Stage column. */
export const AREA_LABEL: Record<string, string> = {
  designer: "Design",
  printer_roll: "Print Roll",
  printer_fb: "Print FB",
  laminate_roll: "Laminate",
  contour_cut: "Contour Cut",
  liquid_lam: "Liquid Lam",
  colex: "Colex",
  finishing: "Finishing",
  installer: "Install",
};

const check = (key: string, label: string, required = false): FieldSpec => ({ key, label, kind: "check", required });
const text = (key: string, label: string, required = false): FieldSpec => ({ key, label, kind: "text", required });
const FILE: FieldSpec = {
  key: "file",
  label: "File",
  kind: "choice",
  options: [
    { value: "ok", label: "OK" },
    { value: "missing", label: "Missing" },
  ],
  required: true,
};

export const CARD_FIELDS: Record<string, FieldSpec[]> = {
  designer: [check("sentProof", "Sent proof"), check("proofApproved", "Proof approved"), check("onHold", "On hold"), text("note", "Note"), text("file", "File")],
  printer_roll: [
    check("printed", "Printed", true),
    { key: "machine", label: "Machine", kind: "catalog" },
    { key: "material", label: "Material used", kind: "catalog" },
    text("lengthFt", "Material length (LN FT)"),
    text("note", "Note"),
    FILE,
  ],
  printer_fb: [
    check("printed", "Printed", true),
    { key: "material", label: "Material", kind: "catalog" },
    {
      key: "sheetKind",
      label: "Sheet",
      kind: "choice",
      options: [
        { value: "new", label: "New sheet" },
        { value: "cutoff", label: "Cut off" },
      ],
      required: true,
    },
    text("sheetSize", "Size", true),
    text("sheetQty", "Qty", true),
    text("sheetsUsed", "# Sheets used"),
    text("note", "Notes"),
    FILE,
  ],
  laminate_roll: [
    check("laminated", "Laminated", true),
    { key: "material", label: "Material", kind: "catalog" },
    text("lengthFt", "Material length (LN FT)"),
    text("note", "Notes"),
  ],
  contour_cut: [check("cut", "Cut", true), check("cutFileMissing", "Cut file missing"), text("note", "Notes")],
  liquid_lam: [check("laminated", "Laminated", true), text("coating", "Coating"), text("note", "Notes")],
  colex: [check("completed", "Completed", true), check("cutFileMissing", "Cut file missing"), text("note", "Notes")],
  finishing: [
    check("grommets", "Grommets"),
    check("tape", "Tape"),
    text("tapeKind", "Kind"),
    check("trimmed", "Trimmed"),
    check("mounted", "Mounted"),
    check("vendorPickup", "Ready for vendor pickup"),
    {
      key: "packaged",
      label: "Packaged",
      kind: "choice",
      options: [
        { value: "almost", label: "Almost Ready" },
        { value: "ready", label: "Ready" },
        { value: "shipped", label: "Shipped" },
      ],
      required: true,
    },
    text("leftAt", "I left this job at…", true),
  ],
  installer: [
    check("siteChecked", "Site checked"),
    check("installed", "Installed", true),
    text("address", "Address"),
    text("date", "Date"),
    text("crew", "Crew"),
    text("photos", "Photos"),
    text("note", "Notes"),
  ],
};

const MAX_TEXT = 500;

export function sanitizeFields(roleId: string, input: unknown): CardFields {
  const specs = CARD_FIELDS[roleId] ?? [];
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: CardFields = {};
  for (const s of specs) {
    if (!(s.key in src)) continue;
    const v = src[s.key];
    if (s.kind === "check") out[s.key] = v === true || v === "true" || v === "yes" || v === 1;
    else if (s.kind === "choice") out[s.key] = typeof v === "string" && s.options!.some((o) => o.value === v) ? v : null;
    else out[s.key] = v === null || v === undefined ? null : String(v).trim().slice(0, MAX_TEXT);
  }
  return out;
}

const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";

export function continueBlocker(
  roleId: string,
  f: CardFields,
  ctx: { proofRequired: boolean },
): { message: string; sendBackToDesign: boolean } | null {
  const block = (message: string, sendBackToDesign = false) => ({ message, sendBackToDesign });
  const specs = CARD_FIELDS[roleId] ?? [];
  if (specs.some((s) => s.key === "file" && s.kind === "choice") && f.file === "missing") {
    return block("File is missing. Send it back to Design.", true);
  }
  if ((roleId === "colex" || roleId === "contour_cut") && f.cutFileMissing === true) return block("Cut file is missing. Send it back to Design.", true);
  for (const s of specs) {
    const required = s.required || (roleId === "designer" && s.key === "proofApproved" && ctx.proofRequired);
    if (required && s.kind === "check" && f[s.key] !== true) return block(`Mark "${s.label}" to continue`);
  }
  for (const s of specs) {
    if (!s.required || s.kind !== "choice") continue;
    if (s.key === "file" && !f.file) return block("Choose File: OK or Missing");
    if (s.key === "sheetKind" && !f.sheetKind) return block('Choose "New sheet" or "Cut off"');
    if (s.key === "packaged" && f.packaged !== "ready" && f.packaged !== "shipped") {
      return block('Set Packaged to "Ready" or "Shipped" to continue');
    }
  }
  if (roleId === "printer_fb" && (!filled(f.sheetSize) || !filled(f.sheetQty))) return block("Enter the size and quantity");
  if (roleId === "finishing" && !filled(f.leftAt)) return block('Fill in "I left this job at…" to continue');
  return null;
}

export function continueLabel(roleId: string, nextRoleId: string | null): string {
  if (roleId === "designer") return "Send to production →";
  return `Continue → ${nextRoleId ? (AREA_LABEL[nextRoleId] ?? nextRoleId) : "Done"}`;
}

/**
 * Within one job: done cards stay done; the first card that is not done is active and the other
 * open cards wait. (A step inserted before finished work does not undo that work.)
 * Unchanged cards keep their identity.
 */
export function normalizeJob<T extends { step: number; status: CardStatus }>(cards: T[]): T[] {
  const sorted = [...cards].sort((a, b) => a.step - b.step);
  let seenOpen = false;
  return sorted.map((c) => {
    let want: CardStatus;
    if (c.status === "done") want = "done";
    else if (!seenOpen) {
      want = "active";
      seenOpen = true;
    } else want = "waiting";
    return c.status === want ? c : { ...c, status: want };
  });
}

export function fieldsSummary(roleId: string, f: CardFields): string {
  const parts: string[] = [];
  for (const s of CARD_FIELDS[roleId] ?? []) {
    const v = f[s.key];
    if (s.kind === "check") {
      if (v === true) parts.push(`${s.label} ✓`);
    } else if (s.kind === "choice") {
      const opt = s.options!.find((o) => o.value === v);
      if (opt) parts.push(`${s.label}: ${opt.label}`);
    } else if (filled(v)) parts.push(`${s.label}: ${v}`);
  }
  return parts.join(" · ");
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

const MD = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, month: "2-digit", day: "2-digit" });

export function areaCellText(
  c: {
    status: CardStatus;
    returnedReason: string | null;
    claimedByName: string | null;
    doneByName: string | null;
    doneAt: string | null;
    fields: CardFields;
    roleId: string;
  } | null,
): string {
  if (!c) return "—";
  if (c.status === "waiting") return "Pending";
  if (c.status === "active") {
    if (c.returnedReason) return `Returned · ${c.returnedReason}`;
    return `Active · ${c.claimedByName ? firstName(c.claimedByName) : "Team"}`;
  }
  let s = `✓ ${c.doneByName ? firstName(c.doneByName) : ""}${c.doneAt ? ` ${MD.format(new Date(c.doneAt))}` : ""}`.replace("✓  ", "✓ ");
  if (c.roleId === "finishing" && (c.fields.packaged === "ready" || c.fields.packaged === "shipped")) {
    s += c.fields.packaged === "ready" ? " · Ready" : " · Shipped";
  }
  return s;
}

export function stageText(active: { roleId: string }[], allDone: boolean): string {
  if (allDone) return "Done";
  if (active.length === 0) return "—";
  const ids = [...new Set(active.map((a) => a.roleId))].sort(
    (a, b) => ROLE_ORDER.indexOf(a as (typeof ROLE_ORDER)[number]) - ROLE_ORDER.indexOf(b as (typeof ROLE_ORDER)[number]),
  );
  return ids.map((id) => AREA_LABEL[id] ?? id).join(", ");
}
