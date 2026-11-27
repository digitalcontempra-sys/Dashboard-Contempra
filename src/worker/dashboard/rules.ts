/**
 * Personal rules behind the Main Dashboard header cards. The counts (summary) and the list filters
 * (`/api/dockets?focus=`) use these same fragments, so a card's number always matches its list.
 * Named parameters: `:me` (user id), `:today` (Winnipeg YYYY-MM-DD), `:staleBefore` / `:staleTask` (ISO times).
 */
import { hoursAgoIso, NEW_ORDER_STALE_HOURS, TASK_OVERDUE_HOURS } from "../../shared/dashboard";
import { todayInBusinessTz } from "../../shared/rules";

/** Named parameters shared by the summary and the `focus` list filters. */
export function personalParams(userId: number, now: Date): Record<string, unknown> {
  return {
    me: userId,
    today: todayInBusinessTz(now),
    staleBefore: hoursAgoIso(now, NEW_ORDER_STALE_HOURS),
    staleTask: hoursAgoIso(now, TASK_OVERDUE_HOURS),
  };
}

/** `account_manager IN (:code0, …)` for the given codes, or `0` (matches nothing) without codes. */
export function codesIn(codes: string[], named: Record<string, unknown>): string {
  codes.forEach((c, i) => (named[`code${i}`] = c.toUpperCase()));
  return codes.length ? `account_manager IN (${codes.map((_, i) => `:code${i}`).join(", ")})` : "0";
}

/** Cards of live dockets only: saved, not in the Trash and not cancelled (same rule as My Cards and the Board). */
export const LIVE_CARD = `EXISTS (
  SELECT 1 FROM virtual_dockets v LEFT JOIN dockets d ON d.work_order = v.work_order
  WHERE v.work_order = c.work_order AND v.state = 'saved' AND v.deleted_at IS NULL AND coalesce(d.status, '') != 'cancelled')`;

const NAMES_ME = `EXISTS (SELECT 1 FROM json_each(c.assignee_ids) WHERE value = :me)`;

/** At risk (on `dockets`): overdue or due today; a RUSH due date counts as today. */
export const AT_RISK_DUE = `(due_rush = 1 OR due_iso <= :today)`;

/** Waiting (a): my New Orders nobody has touched since :staleBefore. Rows of virtual_dockets `v`. */
// EXISTS, not a join: a join lets the planner walk every active docket (D1 rows read).
export const STALE_NEW_ORDERS_FROM = `virtual_dockets v
  WHERE v.new_order = 1 AND v.created_by = :me AND v.state = 'saved' AND v.deleted_at IS NULL
    AND v.updated_at < :staleBefore
    AND EXISTS (SELECT 1 FROM dockets d WHERE d.work_order = v.work_order AND d.status = 'active')`;

/** Waiting (b): my creator card waits for the client's approval of a proof or a sample. */
export const APPROVAL_CARDS_FROM = `cards c WHERE c.status = 'active' AND c.stage IN ('waiting_design', 'waiting_sample')
  AND ${NAMES_ME} AND ${LIVE_CARD}`;

/** Waiting (c): a card of mine that was sent back to me and is still open. */
export const SENT_BACK_CARDS_FROM = `cards c WHERE c.status = 'active' AND c.returned_reason IS NOT NULL
  AND (${NAMES_ME} OR c.claimed_by = :me) AND ${LIVE_CARD}`;

/** Work orders of every docket waiting on me. */
export const WAITING_WORK_ORDERS = `SELECT v.work_order FROM ${STALE_NEW_ORDERS_FROM}
  UNION SELECT c.work_order FROM ${APPROVAL_CARDS_FROM}
  UNION SELECT c.work_order FROM ${SENT_BACK_CARDS_FROM}`;

/** Overdue Task Cards: sent to me by someone else, open, older than :staleTask or past their due date. */
export const OVERDUE_TASKS_WHERE = `t.to_user = :me AND t.from_user != :me AND t.status = 'open'
  AND (t.created_at < :staleTask OR (t.due_kind = 'date' AND t.due_date < :today))`;
