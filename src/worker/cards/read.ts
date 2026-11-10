import { AREA_LABEL, CARD_FIELDS, ROLE_ORDER } from "../../shared/cards";
import type { TimeBucket } from "../../shared/rules";
import type { BoardDTO, CardDTO, CardEventDTO, MyCardsSummary, SessionUser } from "../../shared/types";
import { ServiceError } from "../dockets/errors";
import type { Env } from "../env";
import { canAct } from "./actions";
import { toCardDTOs } from "./dto";
import { PRODUCTION_COLUMNS_VERSION } from "./sheetSync";
import type { CardRow } from "./service";

/** Cards of live dockets only: not in the Trash and not cancelled. */
const LIVE = `EXISTS (
  SELECT 1 FROM virtual_dockets v LEFT JOIN dockets d ON d.work_order = v.work_order
  WHERE v.work_order = c.work_order AND v.state = 'saved' AND v.deleted_at IS NULL AND coalesce(d.status, '') != 'cancelled')`;

/** The user has the card's role, and the card is a team card or names the user. */
const VISIBLE_TO = `c.role_id IN (SELECT role_id FROM user_roles WHERE user_id = ?1)
  AND (c.assignee_ids = '[]' OR EXISTS (SELECT 1 FROM json_each(c.assignee_ids) WHERE value = ?1))`;

export async function listMyCards(env: Env, user: SessionUser): Promise<CardDTO[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.* FROM cards c WHERE c.status IN ('active', 'waiting') AND ${VISIBLE_TO} AND ${LIVE}
     ORDER BY c.status, c.activated_at, c.work_order, c.job_sort, c.step`,
  )
    .bind(user.id)
    .all<CardRow>();
  return toCardDTOs(env.DB, user.id, results);
}

export async function myCardsSummary(env: Env, user: SessionUser): Promise<MyCardsSummary> {
  const counts = await env.DB.prepare(
    `SELECT count(*) AS active,
       sum(CASE WHEN NOT EXISTS (SELECT 1 FROM card_seen s WHERE s.user_id = ?1 AND s.card_id = c.id AND s.seen_at >= c.activated_at)
           THEN 1 ELSE 0 END) AS fresh
     FROM cards c WHERE c.status = 'active' AND ${VISIBLE_TO} AND ${LIVE}`,
  )
    .bind(user.id)
    .first<{ active: number; fresh: number | null }>();
  const u = await env.DB.prepare("SELECT sound_on FROM users WHERE id = ?").bind(user.id).first<{ sound_on: number }>();
  const tasks = await env.DB.prepare(
    `SELECT sum(CASE WHEN to_user = ?1 AND status = 'open' AND seen_at IS NULL THEN 1 ELSE 0 END) AS fresh,
            sum(CASE WHEN to_user = ?1 AND status = 'open' THEN 1 ELSE 0 END) AS open,
            sum(CASE WHEN from_user = ?1 AND status = 'done' AND done_seen_at IS NULL THEN 1 ELSE 0 END) AS done
     FROM task_cards WHERE to_user = ?1 OR from_user = ?1`,
  )
    .bind(user.id)
    .first<{ fresh: number | null; open: number | null; done: number | null }>();
  const newTasks = tasks?.fresh ?? 0;
  return {
    newCount: (counts?.fresh ?? 0) + newTasks,
    activeCount: (counts?.active ?? 0) + (tasks?.open ?? 0),
    soundOn: u?.sound_on !== 0,
    newTasks,
    doneTasks: tasks?.done ?? 0,
  };
}

export async function getCard(env: Env, user: SessionUser, id: number): Promise<CardDTO> {
  const row = await env.DB.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
  if (!row || !canAct(row, user)) throw new ServiceError(404, "Card not found");
  return (await toCardDTOs(env.DB, user.id, [row]))[0];
}

export async function markSeen(env: Env, user: SessionUser, id: number): Promise<void> {
  await getCard(env, user, id);
  await env.DB.prepare(
    `INSERT INTO card_seen (user_id, card_id, seen_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id, card_id) DO UPDATE SET seen_at = excluded.seen_at`,
  )
    .bind(user.id, id, new Date().toISOString())
    .run();
}

export async function setSound(env: Env, user: SessionUser, on: unknown): Promise<void> {
  if (typeof on !== "boolean") throw new ServiceError(400, "on must be true or false");
  await env.DB.prepare("UPDATE users SET sound_on = ? WHERE id = ?").bind(on ? 1 : 0, user.id).run();
}

export async function productionColumnsReady(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM app_settings WHERE key = 'production_columns'").first<{ value: string }>();
  return r?.value === PRODUCTION_COLUMNS_VERSION;
}

export async function board(
  env: Env,
  viewer: SessionUser,
  f: { area?: string; userId?: number; bucket?: TimeBucket; wo?: string },
): Promise<BoardDTO> {
  const db = env.DB;
  const where = [LIVE];
  const params: unknown[] = [];
  if (f.wo) {
    where.push("c.work_order = ?");
    params.push(f.wo);
  } else where.push("c.status = 'active'");
  if (f.area) {
    where.push("c.role_id = ?");
    params.push(f.area);
  }
  if (f.userId) {
    where.push(`c.role_id IN (SELECT role_id FROM user_roles WHERE user_id = ?)
      AND (c.assignee_ids = '[]' OR EXISTS (SELECT 1 FROM json_each(c.assignee_ids) WHERE value = ?))`);
    params.push(f.userId, f.userId);
  }
  const { results } = await db
    .prepare(`SELECT c.* FROM cards c WHERE ${where.join(" AND ")} ORDER BY c.activated_at, c.work_order, c.job_sort, c.step`)
    .bind(...params)
    .all<CardRow>();
  const { results: staffed } = await db
    .prepare("SELECT DISTINCT r.role_id FROM user_roles r JOIN users u ON u.id = r.user_id WHERE u.active = 1")
    .all<{ role_id: string }>();
  const hasMembers = new Set(staffed.map((r) => r.role_id));
  let cards = await toCardDTOs(db, viewer.id, results);
  if (f.bucket) cards = cards.filter((c) => c.header.bucket === f.bucket);
  return {
    columns: ROLE_ORDER.map((roleId) => ({
      roleId,
      area: AREA_LABEL[roleId],
      cards: cards.filter((c) => c.roleId === roleId).map((c) => ({ ...c, noMembers: c.team && !hasMembers.has(roleId) })),
    })),
    productionColumnsReady: await productionColumnsReady(db),
  };
}

const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Winnipeg", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatEventTime = (iso: string) => TIME.format(new Date(iso));

function describe(action: string, roleId: string, d: Record<string, unknown>): string {
  switch (action) {
    case "activated":
      return "Arrived";
    case "claimed":
      return "I'm on it";
    case "continued":
      return `${roleId === "designer" ? "Send to production →" : "Continue →"} ${String(d.to ?? "")}`;
    case "sent_back":
      return `Sent back to ${String(d.to ?? "")} · ${String(d.reason ?? "")}`;
    case "completed":
      return "Docket completed";
    case "removed":
      return `Removed ${String(d.removedArea ?? "")} from the route`;
    case "field": {
      const keys = Array.isArray(d.keys) ? (d.keys as string[]) : [];
      const labels = keys.map((k) => CARD_FIELDS[roleId]?.find((f) => f.key === k)?.label ?? k);
      return `Updated ${labels.join(", ")}`;
    }
    default:
      return action;
  }
}

export async function docketHistory(env: Env, wo: string): Promise<CardEventDTO[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.action, e.detail_json, e.at, e.role_id, u.full_name FROM card_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.work_order = ? ORDER BY e.at, e.id`,
  )
    .bind(wo)
    .all<{ action: string; detail_json: string; at: string; role_id: string; full_name: string | null }>();
  return results.map((r) => ({
    at: r.at,
    area: AREA_LABEL[r.role_id] ?? r.role_id,
    user: r.full_name,
    action: r.action,
    detail: describe(r.action, r.role_id, JSON.parse(r.detail_json) as Record<string, unknown>),
  }));
}
