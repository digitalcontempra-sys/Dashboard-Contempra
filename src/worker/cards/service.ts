import { AREA_LABEL, normalizeJob, type CardStatus } from "../../shared/cards";
import type { ProductionJob } from "../../shared/docketForm";
import { queueCardSheet } from "./sheetSync";

export type CardRow = {
  id: number;
  work_order: string;
  job_sort: number;
  job_name: string;
  step: number;
  role_id: string;
  assignee_ids: string;
  status: CardStatus;
  claimed_by: number | null;
  fields_json: string;
  returned_reason: string | null;
  returned_by: number | null;
  version: number;
  activated_at: string | null;
  done_at: string | null;
  done_by: number | null;
  updated_at: string;
};

export async function loadCards(db: D1Database, wo: string): Promise<CardRow[]> {
  const { results } = await db.prepare("SELECT * FROM cards WHERE work_order = ? ORDER BY job_sort, step").bind(wo).all<CardRow>();
  return results;
}

export function eventStmt(
  db: D1Database,
  card: { id: number; role_id: string },
  wo: string,
  action: string,
  userId: number | null,
  at: string,
  detail: Record<string, unknown> = {},
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO card_events (card_id, role_id, work_order, action, detail_json, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(card.id, card.role_id, wo, action, JSON.stringify(detail), userId, at);
}

type Planned = { existing: CardRow | null; jobSort: number; jobName: string; step: number; roleId: string; assignees: number[]; status: CardStatus };

/**
 * Which old job each new job continues. A job keeps its cards when its name is unchanged, even if
 * another job before it was removed or they were reordered; a renamed job keeps the cards of the
 * job that was at its position, when that job's name is no longer used.
 */
function matchJobs(jobs: ProductionJob[], before: CardRow[]): (number | null)[] {
  const old = new Map<number, string>();
  for (const c of before) old.set(c.job_sort, c.job_name);
  const names = new Set(jobs.map((j) => j.name.trim()));
  const taken = new Set<number>();
  const result: (number | null)[] = jobs.map(() => null);
  const take = (i: number, sort: number | undefined) => {
    if (sort === undefined) return;
    taken.add(sort);
    result[i] = sort;
  };
  // 1. Same name at the same position.
  jobs.forEach((j, i) => {
    if (old.get(i) === j.name.trim() && !taken.has(i)) take(i, i);
  });
  // 2. Same name anywhere.
  jobs.forEach((j, i) => {
    if (result[i] !== null) return;
    take(i, [...old].find(([sort, name]) => name === j.name.trim() && !taken.has(sort))?.[0]);
  });
  // 3. Renamed: same position, and the old name is no longer used.
  jobs.forEach((_, i) => {
    if (result[i] !== null || taken.has(i) || !old.has(i) || names.has(old.get(i)!)) return;
    take(i, i);
  });
  return result;
}

/**
 * Makes the docket's cards match its route. Within a job, existing cards are matched by role and
 * occurrence (the 2nd Laminate step matches the 2nd Laminate card), so inserting or removing a step
 * keeps the work already done on the others. Returns the ids of cards that just became active.
 */
export async function reconcileCards(db: D1Database, wo: string, jobs: ProductionJob[], actorId: number, now: string): Promise<number[]> {
  const before = await loadCards(db, wo);
  const used = new Set<number>();
  const planned: Planned[] = [];
  const oldJob = matchJobs(jobs, before);

  jobs.forEach((job, jobSort) => {
    const pool = oldJob[jobSort] === null ? [] : before.filter((c) => c.job_sort === oldJob[jobSort]);
    const rows: Planned[] = job.steps.map((s, step) => {
      const match = pool.find((c) => c.role_id === s.roleId && !used.has(c.id)) ?? null;
      if (match) used.add(match.id);
      return {
        existing: match,
        jobSort,
        jobName: job.name.trim(),
        step,
        roleId: s.roleId,
        assignees: s.assigneeIds ?? [],
        status: match?.status ?? "waiting",
      };
    });
    planned.push(...normalizeJob(rows));
  });

  const stmts: D1PreparedStatement[] = [];
  // Removed cards: log on the card itself (events outlive their card), then delete it.
  for (const c of before) {
    if (used.has(c.id)) continue;
    stmts.push(eventStmt(db, c, wo, "removed", actorId, now, { removedArea: AREA_LABEL[c.role_id] ?? c.role_id }));
    stmts.push(db.prepare("DELETE FROM cards WHERE id = ?").bind(c.id));
  }
  // Park kept cards on unique negative steps so the (work_order, job_sort, step) key never collides mid-batch.
  for (const p of planned) {
    if (p.existing) stmts.push(db.prepare("UPDATE cards SET step = ? WHERE id = ?").bind(-1 - p.existing.id, p.existing.id));
  }
  for (const p of planned) {
    const activating = p.status === "active" && p.existing?.status !== "active";
    if (p.existing) {
      const leaving = p.status !== p.existing.status;
      // A card that changes status or position gets a new version, so an open card view must reload.
      const moved = leaving || p.step !== p.existing.step || p.jobSort !== p.existing.job_sort;
      stmts.push(
        db
          .prepare(
            `UPDATE cards SET job_sort = ?, step = ?, job_name = ?, assignee_ids = ?, status = ?,
               activated_at = CASE WHEN ? THEN ? ELSE activated_at END,
               claimed_by = CASE WHEN ? THEN NULL ELSE claimed_by END,
               version = version + ?, updated_at = ? WHERE id = ?`,
          )
          .bind(
            p.jobSort,
            p.step,
            p.jobName,
            JSON.stringify(p.assignees),
            p.status,
            activating ? 1 : 0,
            now,
            leaving ? 1 : 0,
            moved ? 1 : 0,
            now,
            p.existing.id,
          ),
      );
    } else {
      stmts.push(
        db
          .prepare(
            `INSERT INTO cards (work_order, job_sort, job_name, step, role_id, assignee_ids, status, activated_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(wo, p.jobSort, p.jobName, p.step, p.roleId, JSON.stringify(p.assignees), p.status, activating ? now : null, now),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);

  const after = await loadCards(db, wo);
  const activated: number[] = [];
  const events: D1PreparedStatement[] = [];
  for (const p of planned) {
    if (p.status === "active" && p.existing?.status !== "active") {
      const c = after.find((x) => x.job_sort === p.jobSort && x.step === p.step)!;
      activated.push(c.id);
      events.push(eventStmt(db, c, wo, "activated", actorId, now));
    }
  }
  if (events.length) await db.batch(events);
  if (before.length || after.length) await queueCardSheet(db, wo);
  return activated;
}
