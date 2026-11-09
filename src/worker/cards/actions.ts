import { AREA_LABEL, continueBlocker, normalizeJob, sanitizeFields, type CardFields } from "../../shared/cards";
import type { CardDTO, SessionUser } from "../../shared/types";
import { ServiceError } from "../dockets/errors";
import type { Env } from "../env";
import { cardDTO } from "./dto";
import { eventStmt, loadCards, type CardRow } from "./service";
import { queueCardSheet } from "./sheetSync";

export function canAct(card: Pick<CardRow, "role_id" | "assignee_ids">, user: SessionUser): boolean {
  if (user.accessLevel === "admin" || user.accessLevel === "manager") return true;
  if (!user.roles.includes(card.role_id)) return false;
  const assignees = JSON.parse(card.assignee_ids) as number[];
  return assignees.length === 0 || assignees.includes(user.id);
}

async function loadForAction(db: D1Database, user: SessionUser, id: number): Promise<CardRow> {
  const card = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
  if (!card) throw new ServiceError(404, "Card not found");
  if (!canAct(card, user)) throw new ServiceError(403, "You can't work on this card.");
  return card;
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
async function assertFresh(db: D1Database, card: CardRow, version: unknown): Promise<void> {
  if (card.status !== "active" || card.version !== version) throw await movedError(db, card.id);
}

/** Atomically moves the card from (active, version) to its next state; a concurrent move loses here. */
async function guardedUpdate(db: D1Database, card: CardRow, sql: string, ...params: unknown[]): Promise<void> {
  const r = await db
    .prepare(`UPDATE cards SET ${sql}, version = version + 1 WHERE id = ? AND version = ? AND status = 'active'`)
    .bind(...params, card.id, card.version)
    .run();
  if (r.meta.changes === 0) throw await movedError(db, card.id);
}

async function proofRequired(db: D1Database, wo: string): Promise<boolean> {
  const v = await db.prepare("SELECT form_json FROM virtual_dockets WHERE work_order = ?").bind(wo).first<{ form_json: string }>();
  return v ? (JSON.parse(v.form_json) as { proofRequired?: boolean }).proofRequired === true : false;
}

/** Re-applies the done → active → waiting order to one job after a move, and logs newly active cards. */
async function settleJob(db: D1Database, wo: string, jobSort: number, actorId: number, now: string): Promise<void> {
  const job = (await loadCards(db, wo)).filter((c) => c.job_sort === jobSort);
  const stmts: D1PreparedStatement[] = [];
  for (const c of normalizeJob(job)) {
    if (job.includes(c)) continue;
    const activating = c.status === "active";
    stmts.push(
      db
        .prepare(
          `UPDATE cards SET status = ?, activated_at = CASE WHEN ? THEN ? ELSE activated_at END, claimed_by = NULL,
             version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .bind(c.status, activating ? 1 : 0, now, now, c.id),
    );
    if (activating) stmts.push(eventStmt(db, c, wo, "activated", actorId, now));
  }
  if (stmts.length) await db.batch(stmts);
}

export async function claimCard(env: Env, user: SessionUser, id: number): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  if (card.status !== "active") throw await movedError(db, id);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE cards SET claimed_by = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(user.id, now, id),
    eventStmt(db, card, card.work_order, "claimed", user.id, now),
  ]);
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

export async function continueCard(env: Env, user: SessionUser, id: number, version: unknown): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  await assertFresh(db, card, version);
  const blocker = continueBlocker(card.role_id, JSON.parse(card.fields_json) as CardFields, {
    proofRequired: await proofRequired(db, card.work_order),
  });
  if (blocker) throw new ServiceError(409, blocker.message);
  const next = await db
    .prepare("SELECT role_id FROM cards WHERE work_order = ? AND job_sort = ? AND step = ?")
    .bind(card.work_order, card.job_sort, card.step + 1)
    .first<{ role_id: string }>();
  const now = new Date().toISOString();
  await guardedUpdate(
    db,
    card,
    "status = 'done', done_by = ?, done_at = ?, returned_reason = NULL, returned_by = NULL, updated_at = ?",
    user.id,
    now,
    now,
  );
  await eventStmt(db, card, card.work_order, "continued", user.id, now, { to: next ? AREA_LABEL[next.role_id] : "Done" }).run();
  await settleJob(db, card.work_order, card.job_sort, user.id, now);
  const open = await db
    .prepare("SELECT count(*) AS n FROM cards WHERE work_order = ? AND status != 'done'")
    .bind(card.work_order)
    .first<{ n: number }>();
  if (open!.n === 0) {
    await eventStmt(db, card, card.work_order, "completed", user.id, now).run();
    await queueCardSheet(db, card.work_order, { comp: 1 });
  } else await queueCardSheet(db, card.work_order);
  return cardDTO(db, user.id, id);
}

export async function sendBackCard(
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
    eventStmt(db, target, card.work_order, "activated", user.id, now),
  ]);
  await queueCardSheet(db, card.work_order);
  return cardDTO(db, user.id, id);
}
