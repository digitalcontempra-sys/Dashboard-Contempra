export type DocketStatus = "active" | "on_hold" | "completed" | "cancelled";
export type Billing = "billed" | "no_charge" | "not_billed" | "cancelled";
export type TimeBucket = "rush_today" | "this_week" | "coming" | "no_due_date";

export const BUSINESS_TZ = "America/Winnipeg";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_MS = 86_400_000;
// Sheets/Excel serial 0 = 1899-12-30; 25569 = 1970-01-01.
const SERIAL_UNIX_EPOCH = 25569;

function toIso(y: number, m: number, d: number): string | null {
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function parseDateText(s: string): string | null {
  let m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*[-,]?\s*(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    return month ? toIso(Number(m[3]), month, Number(m[2])) : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

export function parseSheetDate(v: unknown): { iso: string | null; raw: string | null } {
  if (typeof v === "number" && Number.isFinite(v)) {
    const dt = new Date(Math.round((v - SERIAL_UNIX_EPOCH) * DAY_MS));
    const iso = Number.isNaN(dt.getTime()) ? null : toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    // An unusable serial is almost always a typo in the sheet: keep it visible instead of hiding it.
    return { iso, raw: iso ? null : String(v) };
  }
  if (typeof v !== "string") return { iso: null, raw: null };
  const raw = v.trim();
  if (!raw) return { iso: null, raw: null };
  return { iso: parseDateText(raw), raw };
}

export function isRushText(raw: string | null): boolean {
  return raw != null && /^\s*(rush|asap|now)\b/i.test(raw);
}

export function isCancelText(raw: string | null): boolean {
  return raw != null && /^\s*cancel/i.test(raw);
}

export function normalizeAccountManager(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  return s || null;
}

export function deriveStatus(d: {
  comp: boolean;
  hold: boolean;
  dueRaw: string | null;
  invDateRaw: string | null;
}): DocketStatus {
  if (isCancelText(d.dueRaw) || isCancelText(d.invDateRaw)) return "cancelled";
  if (d.comp) return "completed";
  if (d.hold) return "on_hold";
  return "active";
}

export function deriveBilling(invDateRaw: string | null): Billing {
  const s = invDateRaw?.trim() ?? "";
  if (!s) return "not_billed";
  if (/^no\s*charge/i.test(s)) return "no_charge";
  if (isCancelText(s)) return "cancelled";
  return "billed";
}

export function todayInBusinessTz(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function weekEnd(todayIso: string): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  const daysToSunday = (7 - d.getUTCDay()) % 7;
  return new Date(d.getTime() + daysToSunday * DAY_MS).toISOString().slice(0, 10);
}

export function deriveTimeBucket(
  dueIso: string | null,
  dueRush: boolean,
  todayIso: string,
): { bucket: TimeBucket; overdue: boolean } {
  const overdue = dueIso != null && dueIso < todayIso;
  if (dueRush || (dueIso != null && dueIso <= todayIso)) return { bucket: "rush_today", overdue };
  if (dueIso == null) return { bucket: "no_due_date", overdue: false };
  if (dueIso <= weekEnd(todayIso)) return { bucket: "this_week", overdue: false };
  return { bucket: "coming", overdue: false };
}
