import { AREA_LABEL } from "../../shared/cards";
import { WHOLE_DOCKET } from "../../shared/docketForm";
import { approvalKind, GENERAL_ROLE, parseTargets, type CardStage, type HandoffTarget, type Person } from "../../shared/handoff";
import type { CardDTO, SessionUser } from "../../shared/types";
import { ServiceError } from "../dockets/errors";
import type { Env } from "../env";
import { assertComplete, assertFresh, assertLive, guardedUpdate, loadForAction, sendBackRouteCard } from "./actions";
import { cardDTO } from "./dto";
import { eventStmt, receivedDetail, type CardRow } from "./service";
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

const DONE_SQL = "status = 'done', done_by = ?, done_at = ?, claimed_by = NULL, returned_reason = NULL, returned_by = NULL, updated_at = ?";

/** Who the docket returns to: whoever created it (or, for a docket born in the sheet, first saved it). */
async function creatorOf(db: D1Database, wo: string): Promise<number> {
  const v = await db
    .prepare("SELECT created_by, updated_by FROM virtual_dockets WHERE work_order = ?")
    .bind(wo)
    .first<{ created_by: number | null; updated_by: number | null }>();
  const id = v?.created_by ?? v?.updated_by;
  if (!id) throw new ServiceError(409, "This docket has no creator to return to.");
  return id;
}

const creatorCard = (db: D1Database, wo: string) =>
  db.prepare("SELECT * FROM cards WHERE work_order = ? AND stage IS NOT NULL LIMIT 1").bind(wo).first<CardRow>();

/** Cards still waiting in an old fixed route are dropped once the docket moves by hand-off. */
async function dropRouteWaiting(db: D1Database, wo: string, actorId: number, now: string): Promise<void> {
  const { results } = await db.prepare("SELECT * FROM cards WHERE work_order = ? AND handoff = 0 AND status = 'waiting'").bind(wo).all<CardRow>();
  if (!results.length) return;
  await db.batch(
    results.flatMap((c) => [
      eventStmt(db, c, wo, "removed", actorId, now, { removedArea: AREA_LABEL[c.role_id] ?? c.role_id }),
      db.prepare("DELETE FROM cards WHERE id = ?").bind(c.id),
    ]),
  );
}

async function insertCreatorCard(
  db: D1Database,
  wo: string,
  creatorId: number,
  status: "active" | "waiting",
  stage: CardStage,
  from: { userId: number; cardId: number },
  now: string,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO cards (work_order, job_sort, job_name, step, role_id, assignee_ids, status, stage, from_user_id, from_card_id,
         handoff, activated_at, updated_at)
       VALUES (?1, 0, ?2, (SELECT coalesce(max(step), -1) + 1 FROM cards WHERE work_order = ?1 AND job_sort = 0),
         ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9) RETURNING id`,
    )
    .bind(wo, WHOLE_DOCKET, GENERAL_ROLE, JSON.stringify([creatorId]), status, stage, from.userId, from.cardId, now)
    .first<{ id: number }>();
  return row!.id;
}

/**
 * The docket comes back to its creator, in their one card (created the first time). A waiting
 * approval is not hidden by a branch that only finished.
 */
async function returnToCreator(db: D1Database, wo: string, stage: CardStage, from: { userId: number; cardId: number }, now: string): Promise<void> {
  const creatorId = await creatorOf(db, wo);
  const existing = await creatorCard(db, wo);
  let id: number;
  if (existing) {
    id = existing.id;
    const keep = stage === "ready_to_close" && existing.status === "active" && existing.stage !== "ready_to_close";
    await db
      .prepare(
        `UPDATE cards SET status = 'active', stage = ?, from_user_id = ?, from_card_id = ?, claimed_by = NULL, returned_reason = NULL,
           returned_by = NULL, done_by = NULL, done_at = NULL, activated_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      )
      .bind(keep ? existing.stage : stage, from.userId, from.cardId, now, now, id)
      .run();
  } else id = await insertCreatorCard(db, wo, creatorId, "active", stage, from, now);
  // toCreator: the "done, back to <creator>" line already says it (no separate "received" line).
  await eventStmt(db, { id, role_id: GENERAL_ROLE }, wo, "activated", from.userId, now, {
    assignees: [creatorId],
    from: from.userId,
    toCreator: true,
  }).run();
}

/** Continue → (or Approved → Continue on the creator's card): my card is done, each chosen person gets one. */
export async function continueTo(env: Env, user: SessionUser, id: number, to: unknown, version: unknown): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  await assertFresh(db, card, version);
  const targets = await parseHandoff(db, to);
  await assertComplete(db, card);
  const now = new Date().toISOString();
  await guardedUpdate(db, card, DONE_SQL, user.id, now, now);
  if (card.stage === "waiting_design" || card.stage === "waiting_sample") {
    await eventStmt(db, card, card.work_order, "approved", user.id, now).run();
  }
  await eventStmt(db, card, card.work_order, "continued", user.id, now, { to: targets }).run();
  for (const t of targets) await giveCard(db, card.work_order, t, { userId: user.id, cardId: card.id }, now);
  await dropRouteWaiting(db, card.work_order, user.id, now);
  await queueCardSheet(db, card.work_order);
  return cardDTO(db, user.id, id);
}

const FINISH = {
  done: { action: "done", stage: "ready_to_close" },
  proof: { action: "proof_sent", stage: "waiting_design" },
  sample: { action: "sample_sent", stage: "waiting_sample" },
} as const;

/** Done, Proof sent or Sample sent: my part ends and the docket goes back to its creator. */
export async function finishCard(env: Env, user: SessionUser, id: number, kind: keyof typeof FINISH, version: unknown): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  await assertFresh(db, card, version);
  if (card.stage) throw new ServiceError(400, "Use Close docket or Continue.");
  if (kind !== "done" && approvalKind(card.role_id) !== kind) throw new ServiceError(400, `This card can't send a ${kind}.`);
  // A proof or sample goes out before it is approved, so only Done needs the area's fields.
  if (kind === "done") await assertComplete(db, card);
  // Before the card is marked done: without someone to return to, it must stay open.
  const creatorId = await creatorOf(db, card.work_order);
  const now = new Date().toISOString();
  await guardedUpdate(db, card, DONE_SQL, user.id, now, now);
  await eventStmt(db, card, card.work_order, FINISH[kind].action, user.id, now, { back: creatorId }).run();
  await returnToCreator(db, card.work_order, FINISH[kind].stage, { userId: user.id, cardId: card.id }, now);
  await dropRouteWaiting(db, card.work_order, user.id, now);
  await queueCardSheet(db, card.work_order);
  return cardDTO(db, user.id, id);
}

/**
 * ← Send back: the docket returns to whoever handed it to me (their card reopens as Returned).
 * My card is parked, and comes back with its fields if the docket is handed to me again.
 */
export async function sendBackCard(env: Env, user: SessionUser, id: number, toStep: unknown, reason: unknown, version: unknown): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  if (!card.handoff) return sendBackRouteCard(env, user, id, toStep, reason, version);
  const why = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  if (why.length < 3) throw new ServiceError(400, "Write a reason (at least 3 characters).");
  await assertFresh(db, card, version);
  const wo = card.work_order;
  const fromCard = card.from_card_id ? await db.prepare("SELECT * FROM cards WHERE id = ?").bind(card.from_card_id).first<CardRow>() : null;
  const now = new Date().toISOString();
  let target = fromCard ?? (await creatorCard(db, wo));
  if (!target) {
    // The first people got the docket from its creator, who has no card yet.
    const cid = await insertCreatorCard(db, wo, await creatorOf(db, wo), "waiting", "ready_to_close", { userId: user.id, cardId: card.id }, now);
    target = (await db.prepare("SELECT * FROM cards WHERE id = ?").bind(cid).first<CardRow>())!;
  }
  await guardedUpdate(db, card, "status = 'waiting', claimed_by = NULL, updated_at = ?", now);
  const toUser = (JSON.parse(target.assignee_ids) as number[])[0] ?? card.from_user_id;
  await db.batch([
    db
      .prepare(
        `UPDATE cards SET status = 'active', returned_reason = ?, returned_by = ?, done_by = NULL, done_at = NULL, claimed_by = NULL,
           stage = CASE WHEN stage IS NULL THEN NULL ELSE 'ready_to_close' END, activated_at = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(why, user.id, now, now, target.id),
    eventStmt(db, card, wo, "sent_back", user.id, now, { toUser, reason: why }),
    eventStmt(db, target, wo, "activated", user.id, now, { ...receivedDetail(target), returned: true }),
  ]);
  await queueCardSheet(db, wo);
  return cardDTO(db, user.id, id);
}

/** Close docket: only from the creator's card once it is Ready to close and nobody else has it open. */
export async function closeDocket(env: Env, user: SessionUser, id: number, version: unknown): Promise<CardDTO> {
  const db = env.DB;
  const card = await loadForAction(db, user, id);
  await assertFresh(db, card, version);
  if (card.stage !== "ready_to_close") throw new ServiceError(409, "This docket is not ready to close.");
  const open = await db
    .prepare("SELECT count(*) AS n FROM cards WHERE work_order = ? AND status = 'active' AND id != ?")
    .bind(card.work_order, id)
    .first<{ n: number }>();
  if (open!.n > 0) throw new ServiceError(409, "Other people still have this docket open.");
  const now = new Date().toISOString();
  await guardedUpdate(db, card, DONE_SQL, user.id, now, now);
  // Parked cards will not come back: the docket is finished.
  const { results: parked } = await db.prepare("SELECT * FROM cards WHERE work_order = ? AND status = 'waiting'").bind(card.work_order).all<CardRow>();
  await db.batch([
    ...parked.flatMap((c) => [
      eventStmt(db, c, card.work_order, "removed", user.id, now, { removedArea: AREA_LABEL[c.role_id] ?? c.role_id }),
      db.prepare("DELETE FROM cards WHERE id = ?").bind(c.id),
    ]),
    eventStmt(db, card, card.work_order, "closed", user.id, now),
  ]);
  await queueCardSheet(db, card.work_order, { comp: 1 });
  return cardDTO(db, user.id, id);
}

/** Restore (Admin): a finished card reopens for its person; the creator's card reopens a closed docket. */
export async function restoreCard(env: Env, user: SessionUser, id: number): Promise<CardDTO> {
  const db = env.DB;
  if (user.accessLevel !== "admin") throw new ServiceError(403, "Only an admin can restore a card.");
  const card = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
  if (!card) throw new ServiceError(404, "Card not found");
  await assertLive(db, card.work_order);
  if (card.status !== "done") throw new ServiceError(409, "Only a finished card can be restored.");
  const open = await db
    .prepare("SELECT count(*) AS n FROM cards WHERE work_order = ? AND status = 'active'")
    .bind(card.work_order)
    .first<{ n: number }>();
  const now = new Date().toISOString();
  const r = await db
    .prepare(
      `UPDATE cards SET status = 'active', done_by = NULL, done_at = NULL, claimed_by = NULL, returned_reason = NULL, returned_by = NULL,
         stage = CASE WHEN stage IS NULL THEN NULL ELSE 'ready_to_close' END, activated_at = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND status = 'done'`,
    )
    .bind(now, now, id)
    .run();
  if (r.meta.changes === 0) throw new ServiceError(409, "Only a finished card can be restored.");
  await eventStmt(db, card, card.work_order, "restored", user.id, now).run();
  // Nothing was open: the docket was finished, so it is no longer complete.
  await queueCardSheet(db, card.work_order, open!.n === 0 ? { comp: 0 } : {});
  return cardDTO(db, user.id, id);
}
