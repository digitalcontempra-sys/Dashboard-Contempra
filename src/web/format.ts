import type { TimeBucket } from "../shared/rules";

export const BUCKETS: { id: TimeBucket; label: string }[] = [
  { id: "rush_today", label: "Rush / Today" },
  { id: "this_week", label: "This Week" },
  { id: "coming", label: "Coming" },
  { id: "no_due_date", label: "No Due Date" },
];

export const BUCKET_TONE: Record<TimeBucket, { fg: string; bg: string }> = {
  rush_today: { fg: "text-rush", bg: "bg-rush-soft" },
  this_week: { fg: "text-week", bg: "bg-week-soft" },
  coming: { fg: "text-coming", bg: "bg-coming-soft" },
  no_due_date: { fg: "text-nodate", bg: "bg-nodate-soft" },
};

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const FULL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const shortDate = (iso: string) => MONTH.format(new Date(`${iso}T00:00:00Z`));
export const longDate = (iso: string) => FULL.format(new Date(`${iso}T00:00:00Z`));

/** Due label: a date, the raw sheet text, or the explicit no-date label. */
export function dueLabel(dueIso: string | null, dueRaw: string | null): string {
  if (dueIso) return shortDate(dueIso);
  return dueRaw ?? "No Due Date";
}

export function minutesSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

export function syncedLabel(mins: number | null): string {
  if (mins == null) return "Never synced";
  if (mins < 1) return "Synced just now";
  return `Last synced ${mins} min ago`;
}
