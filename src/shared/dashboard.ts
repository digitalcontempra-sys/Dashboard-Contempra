import { BUSINESS_TZ } from "./rules";
import type { DashboardSummary } from "./types";

/** A Task Card sent to me counts as overdue after this long (or when its due date has passed). */
export const TASK_OVERDUE_HOURS = 24;
/** A New Order of mine waits on me when nobody has touched it for this long. */
export const NEW_ORDER_STALE_HOURS = 48;

/** Main Dashboard filters behind the personal cards ("At risk", "Waiting on you"). */
export type DashFocus = "risk" | "waiting";
export const DASH_FOCUS: DashFocus[] = ["risk", "waiting"];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const hoursAgoIso = (now: Date, hours: number): string => new Date(now.getTime() - hours * HOUR).toISOString();

export const wholeDaysSince = (iso: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY));

export const firstName = (full: string | null | undefined): string => (full ?? "").trim().split(/\s+/)[0] ?? "";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function overdueDetail(s: DashboardSummary["overdueTasks"]): string {
  if (s.count === 0 || s.oldestDays === null) return "All caught up";
  const age = s.oldestDays === 0 ? "today" : plural(s.oldestDays, "day");
  return s.oldestFrom ? `Oldest: ${age} · from ${s.oldestFrom}` : `Oldest: ${age}`;
}

export function riskDetail(s: DashboardSummary["atRisk"]): string {
  if (s.overdue + s.dueToday === 0) return "Nothing overdue";
  return `${s.overdue} overdue · ${s.dueToday} due today`;
}

export function waitingDetail(s: DashboardSummary["waiting"]): string {
  const parts = [
    s.newOrders ? plural(s.newOrders, "new order") : "",
    s.approvals ? plural(s.approvals, "approval") : "",
    s.sentBack ? `${s.sentBack} sent back` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing waiting";
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** Winnipeg wall clock for the dashboard header: `8:00 AM | FRIDAY Nov 27, 2026`. */
export function clockParts(now: Date): { time: string; weekday: string; date: string; label: string } {
  const p = Object.fromEntries(PARTS.formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>;
  const time = `${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
  return {
    time,
    weekday: p.weekday.toUpperCase(),
    date: `${p.month.slice(0, 3)} ${p.day}, ${p.year}`,
    label: `${p.weekday}, ${p.month} ${p.day}, ${p.year}, ${time}`,
  };
}
