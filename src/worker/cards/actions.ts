import { AREA_LABEL, continueBlocker, sanitizeFields, type CardFields } from "../../shared/cards";
import type { CardDTO, SessionUser } from "../../shared/types";
import { ServiceError } from "../dockets/errors";
import type { Env } from "../env";
import { cardDTO } from "./dto";
import { eventStmt, receivedDetail, type CardRow } from "./service";
import { queueCardSheet } from "./sheetSync";

export function canAct(card: Pick<CardRow, "role_id" | "assignee_ids">, user: SessionUser): boolean {
  if (user.accessLevel === "admin" || user.accessLevel === "manager") return true;
  const assignees = JSON.parse(card.assignee_ids) as number[];
  // A card that names people is theirs (whatever their areas); a team card is for the area's people.
  return assignees.length ? assignees.includes(user.id) : user.roles.includes(card.role_id);
}

export async function loadForAction(db: D1Database, user: SessionUser, id: number): Promise<CardRow> {
  const card = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
  if (!card) throw new ServiceError(404, "Card not found");
  if (!canAct(card, user)) throw new ServiceError(403, "You can't work on this card.");
  await assertTaken(db, card, user);
  await assertLive(db, card.work_order);
  return card;
}

/** A team card is taken by whoever started it first: the other members can no longer move it. */
export async function assertTaken(db: D1Database, card: CardRow, user: SessionUser): Promise<void> {
  if (card.team_id === null || card.claimed_by === null || card.claimed_by === user.id) return;
  if (user.accessLevel === "admin" || user.accessLevel === "manager") return;
  const who = await db.prepare("SELECT full_name FROM users WHERE id = ?").bind(card.claimed_by).first<{ full_name: string }>();
  throw new ServiceError(409, `${who?.full_name ?? "Someone else"} is already on it.`);
}

/** Cards of a cancelled docket, or one in the Trash, stay as they are (same rule as the card lists). */
export async function assertLive(db: D1Database, wo: string): Promise<void> {
  const live = await db
    .prepare(
      `SELECT 1 FROM virtual_dockets v LEFT JOIN dockets d ON d.work_order = v.work_order
       WHERE v.work_order = ? AND v.state = 'saved' AND v.deleted_at IS NULL AND coalesce(d.status, '') != 'cancelled'`,
    )
    .bind(wo)
    .first();
  if (!live) throw new ServiceError(409, "This docket is cancelled or in the Trash.");
}

async function movedError(db: D1Database, cardId: number): Promise<ServiceError> {
  const who = await db
    .prepare(
      `SELECT u.full_name FROM card_events e JOIN users u ON u.id = e.user_id
       WHERE e.card_id = ? AND e.action IN ('continued', 'sent_back', 'field', 'activated') ORDER BY e.id DESC LIMIT 1`,
    )
    .bind(cardId)
    .first<{ full_name: string }>();
  return new ServiceError(409, `This card was already moved by ${who?.full_name ?? "someone else"}.`);
}

/** The card must still be the one the user saw: active and at the same version. */
export async function assertFresh(db: D1Database, card: CardRow, version: unknown): Promise<void> {
  if (card.status !== "active" || card.version !== version) throw await movedError(db, card.id);
}

/** Atomically moves the card from (active, version) to its next state; a concurrent move loses here. */
export async function guardedUpdate(db: D1Database, card: CardRow, sql: string, ...params: unknown[]): Promise<void> {
  const r = await db
    .prepare(`UPDATE cards SET ${sql}, version = version + 1 WHERE id = ? AND version = ? AND status = 'active'`)
    .bind(...params, card.id, card.version)
    .run();
  if (r.meta.changes === 0) throw await movedError(db, card.id);
}

/** Blocks a move while the area's required (★) fields are missing. The creator's card has none. */
export async function assertComplete(db: D1Database, card: CardRow): Promise<void> {
  if (card.stage) return;
  const v = await db.prepare("SELECT form_json FROM virtual_dockets WHERE work_order = ?").bind(card.work_order).first<{ form_json: string }>();
  const proofRequired = v ? (JSON.parse(v.form_json) as { proofRequired?: boolean }).proofRequired === true : false;
  const blocker = continueBlocker(card.role_id, JSON.parse(card.fields_json) as CardFields, { proofRequired });
  if (blocker) throw new ServiceError(409, blocker.message);
}

export async function claimCard(env: Env, user: SessionUser, id: number): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  if (card.status !== "active") throw await movedError(db, id);
  const now = new Date().toISOString();
  // Two members of a team pressing at once: only the first one takes the card.
  const staff = user.accessLevel === "staff" ? 1 : 0;
  const r = await db
    .prepare(
      `UPDATE cards SET claimed_by = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'active'
         AND (?4 = 0 OR team_id IS NULL OR claimed_by IS NULL OR claimed_by = ?1)`,
    )
    .bind(user.id, now, id, staff)
    .run();
  if (r.meta.changes === 0) {
    const fresh = (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>())!;
    await assertTaken(db, fresh, user);
    throw await movedError(db, id);
  }
  await eventStmt(db, card, card.work_order, "claimed", user.id, now).run();
  await queueCardSheet(db, card.work_order);
  return cardDTO(db, user.id, id);
}

export async function saveCardFields(env: Env, user: SessionUser, id: number, fields: unknown, version: unknown): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  await assertFresh(db, card, version);
  const before = JSON.parse(card.fields_json) as CardFields;
  const merged = { ...before, ...sanitizeFields(card.role_id, fields) };
  const changed = Object.keys(merged).filter((k) => merged[k] !== before[k]);
  const now = new Date().toISOString();
  await guardedUpdate(db, card, "fields_json = ?, updated_at = ?", JSON.stringify(merged), now);
  if (changed.length) await eventStmt(db, card, card.work_order, "field", user.id, now, { keys: changed }).run();
  const holdChanged = card.role_id === "designer" && changed.includes("onHold");
  await queueCardSheet(db, card.work_order, holdChanged ? { hold: merged.onHold === true ? 1 : 0 } : {});
  return cardDTO(db, user.id, id);
}

/** Send back on a card of an old fixed route: to an earlier step of its job. */
export async function sendBackRouteCard(
  env: Env,
  user: SessionUser,
  id: number,
  toStep: unknown,
  reason: unknown,
  version: unknown,
): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  const why = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  if (why.length < 3) throw new ServiceError(400, "Write a reason (at least 3 characters).");
  const target = Number.isInteger(toStep)
    ? await db
        .prepare("SELECT * FROM cards WHERE work_order = ? AND job_sort = ? AND step = ?")
        .bind(card.work_order, card.job_sort, toStep)
        .first<CardRow>()
    : null;
  if (!target || target.step >= card.step) throw new ServiceError(400, "Choose an earlier area.");
  await assertFresh(db, card, version);
  const now = new Date().toISOString();
  await guardedUpdate(db, card, "status = 'waiting', claimed_by = NULL, updated_at = ?", now);
  await db.batch([
    db
      .prepare(
        `UPDATE cards SET status = 'waiting', done_by = NULL, done_at = NULL, claimed_by = NULL, version = version + 1, updated_at = ?
         WHERE work_order = ? AND job_sort = ? AND step > ? AND step < ?`,
      )
      .bind(now, card.work_order, card.job_sort, target.step, card.step),
    db
      .prepare(
        `UPDATE cards SET status = 'active', returned_reason = ?, returned_by = ?, done_by = NULL, done_at = NULL,
           claimed_by = NULL, activated_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      )
      .bind(why, user.id, now, now, target.id),
    eventStmt(db, card, card.work_order, "sent_back", user.id, now, { to: AREA_LABEL[target.role_id], reason: why }),
    eventStmt(db, target, card.work_order, "activated", user.id, now, receivedDetail(target)),
  ]);
  await queueCardSheet(db, card.work_order);
  return cardDTO(db, user.id, id);
}
