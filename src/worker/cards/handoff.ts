import { WHOLE_DOCKET } from "../../shared/docketForm";
import { parseTargets, type HandoffTarget, type Person } from "../../shared/handoff";
import { ServiceError } from "../dockets/errors";
import { eventStmt } from "./service";
import { queueCardSheet } from "./sheetSync";

/** Hand-to-hand flow: each card belongs to one person, who got it from someone, with a note on what to do. */

export async function loadPeople(db: D1Database): Promise<Person[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.full_name, group_concat(ur.role_id) AS roles FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id WHERE u.active = 1 GROUP BY u.id`,
    )
    .all<{ id: number; full_name: string; roles: string | null }>();
  return results.map((r) => ({ id: r.id, name: r.full_name, roles: r.roles ? r.roles.split(",") : [] }));
}

/** The people a docket goes to, checked against the active staff. */
export async function parseHandoff(db: D1Database, raw: unknown): Promise<HandoffTarget[]> {
  try {
    return parseTargets(raw, await loadPeople(db));
  } catch (e) {
    throw new ServiceError(400, (e as Error).message);
  }
}

export async function hasCards(db: D1Database, wo: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM cards WHERE work_order = ? LIMIT 1").bind(wo).first()) !== null;
}

/**
 * Gives one person a card: reuses the card they had parked in this docket and area (after a send
 * back), keeping its fields, else creates a new one. Logs that they received it. Returns its id.
 */
export async function giveCard(
  db: D1Database,
  wo: string,
  t: HandoffTarget,
  from: { userId: number; cardId: number | null },
  now: string,
): Promise<number> {
  const assignees = JSON.stringify([t.userId]);
  const parked = await db
    .prepare(
      `SELECT id FROM cards WHERE work_order = ? AND handoff = 1 AND stage IS NULL AND status = 'waiting'
         AND role_id = ? AND assignee_ids = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(wo, t.roleId, assignees)
    .first<{ id: number }>();
  let id: number;
  if (parked) {
    id = parked.id;
    await db
      .prepare(
        `UPDATE cards SET status = 'active', instruction = ?, from_user_id = ?, from_card_id = ?, claimed_by = NULL,
           returned_reason = NULL, returned_by = NULL, activated_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      )
      .bind(t.instruction, from.userId, from.cardId, now, now, id)
      .run();
  } else {
    const row = await db
      .prepare(
        `INSERT INTO cards (work_order, job_sort, job_name, step, role_id, assignee_ids, status, instruction, from_user_id,
           from_card_id, handoff, activated_at, updated_at)
         VALUES (?1, 0, ?2, (SELECT coalesce(max(step), -1) + 1 FROM cards WHERE work_order = ?1 AND job_sort = 0),
           ?3, ?4, 'active', ?5, ?6, ?7, 1, ?8, ?8) RETURNING id`,
      )
      .bind(wo, WHOLE_DOCKET, t.roleId, assignees, t.instruction, from.userId, from.cardId, now)
      .first<{ id: number }>();
    id = row!.id;
  }
  await eventStmt(db, { id, role_id: t.roleId }, wo, "activated", from.userId, now, { assignees: [t.userId], from: from.userId }).run();
  return id;
}

/** First hand-off of a docket: the people chosen when it is created (or first sent to production). */
export async function startHandoff(db: D1Database, wo: string, actorId: number, targets: HandoffTarget[], now: string): Promise<void> {
  for (const t of targets) await giveCard(db, wo, t, { userId: actorId, cardId: null }, now);
  await queueCardSheet(db, wo);
}
