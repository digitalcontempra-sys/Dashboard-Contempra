import { ROLE_ORDER } from "../../shared/cards";
import { firstName, wholeDaysSince } from "../../shared/dashboard";
import type { DashboardSummary } from "../../shared/types";
import { Sql } from "../db/dockets";
import { userCodes } from "../users/codes";
import {
  APPROVAL_CARDS_FROM,
  AT_RISK_DUE,
  codesIn,
  LIVE_CARD,
  personalParams,
  OVERDUE_TASKS_WHERE,
  SENT_BACK_CARDS_FROM,
  STALE_NEW_ORDERS_FROM,
  WAITING_WORK_ORDERS,
} from "./rules";

/** The signed-in user's three personal cards and the shop's open cards per area: one D1 batch. */
export async function dashboardSummary(db: D1Database, userId: number, now: Date): Promise<DashboardSummary> {
  const named = personalParams(userId, now);
  const mine = codesIn(await userCodes(db, userId), named);
  const sql = new Sql(named);
  const [tasks, oldest, risk, waiting, areas] = await db.batch([
    sql.bind(db, `SELECT count(*) AS n FROM task_cards t WHERE ${OVERDUE_TASKS_WHERE}`),
    sql.bind(
      db,
      `SELECT t.created_at, u.full_name, u.username FROM task_cards t LEFT JOIN users u ON u.id = t.from_user
       WHERE ${OVERDUE_TASKS_WHERE} ORDER BY t.created_at, t.id LIMIT 1`,
    ),
    sql.bind(
      db,
      `SELECT count(*) AS n, coalesce(sum(CASE WHEN due_iso < :today THEN 1 ELSE 0 END), 0) AS overdue
       FROM dockets WHERE status = 'active' AND ${mine} AND ${AT_RISK_DUE}`,
    ),
    sql.bind(
      db,
      `SELECT (SELECT count(*) FROM ${STALE_NEW_ORDERS_FROM}) AS new_orders,
              (SELECT count(*) FROM ${APPROVAL_CARDS_FROM}) AS approvals,
              (SELECT count(*) FROM ${SENT_BACK_CARDS_FROM}) AS sent_back,
              (SELECT count(*) FROM (${WAITING_WORK_ORDERS})) AS dockets`,
    ),
    db.prepare(`SELECT c.role_id, count(*) AS n FROM cards c WHERE c.status = 'active' AND ${LIVE_CARD} GROUP BY c.role_id`),
  ]);
  const count = Number((tasks.results[0] as { n: number }).n);
  const first = oldest.results[0] as { created_at: string; full_name: string | null; username: string | null } | undefined;
  const r = risk.results[0] as { n: number; overdue: number };
  const w = waiting.results[0] as { new_orders: number; approvals: number; sent_back: number; dockets: number };
  const byArea = new Map((areas.results as { role_id: string; n: number }[]).map((a) => [a.role_id, Number(a.n)]));
  return {
    overdueTasks: {
      count,
      oldestDays: first ? wholeDaysSince(first.created_at, now) : null,
      oldestFrom: first ? firstName(first.full_name || first.username) : null,
    },
    atRisk: { overdue: Number(r.overdue), dueToday: Number(r.n) - Number(r.overdue) },
    waiting: { newOrders: Number(w.new_orders), approvals: Number(w.approvals), sentBack: Number(w.sent_back), dockets: Number(w.dockets) },
    areas: ROLE_ORDER.map((roleId) => ({ roleId, count: byArea.get(roleId) ?? 0 })),
  };
}
