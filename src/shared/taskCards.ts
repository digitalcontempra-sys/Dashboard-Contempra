import { deriveTimeBucket, type TimeBucket } from "./rules";

export type TaskDueKind = "none" | "rush" | "today" | "date";
export type TaskDue = { kind: TaskDueKind; date?: string };

export const TASK_NOTE_MAX = 1000;

/**
 * Time group of a task card. "Today" means the day it was sent, so an unfinished one stays in
 * Rush / Today (overdue) on later days; a date follows the usual due-date rules.
 */
export function taskBucket(due: { kind: TaskDueKind; date: string | null }, _createdAt: string, todayIso: string): TimeBucket {
  if (due.kind === "rush" || due.kind === "today") return "rush_today";
  if (due.kind === "date" && due.date) return deriveTimeBucket(due.date, false, todayIso).bucket;
  return "no_due_date";
}
