import { DASH_SECTIONS, TIME_BUCKETS, type DashSection, type TimeBucket } from "../shared/rules";

const LABEL: Record<DashSection, string> = {
  rush_today: "Rush / Today",
  upcoming: "Upcoming",
  new_orders: "New Orders",
  no_due_date: "No Due Date",
  daily_complete: "Daily Complete",
};

/** Time groups (My Cards, Production Board, Task Cards). */
export const BUCKETS: { id: TimeBucket; label: string }[] = TIME_BUCKETS.map((id) => ({ id, label: LABEL[id] }));
/** Main Dashboard sections, in chip order. */
export const SECTIONS: { id: DashSection; label: string }[] = DASH_SECTIONS.map((id) => ({ id, label: LABEL[id] }));

/** The tag on a single tile ("New Order", not the section's plural). */
export const SECTION_TAG: Record<DashSection, string> = { ...LABEL, new_orders: "New Order" };

export const BUCKET_TONE: Record<DashSection, { fg: string; bg: string }> = {
  rush_today: { fg: "text-rush", bg: "bg-rush-soft" },
  upcoming: { fg: "text-week", bg: "bg-week-soft" },
  new_orders: { fg: "text-info", bg: "bg-info-soft" },
  no_due_date: { fg: "text-nodate", bg: "bg-nodate-soft" },
  daily_complete: { fg: "text-ok", bg: "bg-ok-soft" },
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
