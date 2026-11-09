import { AREA_LABEL, normalizeJob, type CardStatus } from "../../shared/cards";
import type { ProductionJob } from "../../shared/docketForm";

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
  cardId: number,
  wo: string,
  action: string,
  userId: number | null,
  at: string,
  detail: Record<string, unknown> = {},
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO card_events (card_id, work_order, action, detail_json, user_id, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(cardId, wo, action, JSON.stringify(detail), userId, at);
}

type Planned = { existing: CardRow | null; jobSort: number; jobName: string; step: number; roleId: string; assignees: number[]; status: CardStatus };

/**
 * Makes the docket's cards match its route. Existing cards are matched within each job by role and
 * occurrence (the 2nd Laminate step matches the 2nd Laminate card), so inserting or removing a step
 * keeps the work already done on the others. Returns the ids of cards that just became active.
 */
export async function reconcileCards(db: D1Database, wo: string, jobs: ProductionJob[], actorId: number, now: string): Promise<number[]> {
  const before = await loadCards(db, wo);
  const used = new Set<number>();
  const planned: Planned[] = [];
  const removedByJob = new Map<number, string[]>();

  jobs.forEach((job, jobSort) => {
    const pool = before.filter((c) => c.job_sort === jobSort);
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
  for (const c of before) {
    if (used.has(c.id)) continue;
    removedByJob.set(c.job_sort, [...(removedByJob.get(c.job_sort) ?? []), AREA_LABEL[c.role_id] ?? c.role_id]);
  }

  const stmts: D1PreparedStatement[] = [];
  // Park kept cards on unique negative steps so the (work_order, job_sort, step) key never collides mid-batch.
  for (const p of planned) if (p.existing) stmts.push(db.prepare("UPDATE cards SET step = ? WHERE id = ?").bind(-1 - p.existing.id, p.existing.id));
  for (const c of before) if (!used.has(c.id)) stmts.push(db.prepare("DELETE FROM cards WHERE id = ?").bind(c.id));
  for (const p of planned) {
    const activating = p.status === "active" && p.existing?.status !== "active";
    if (p.existing) {
      const leaving = p.status !== p.existing.status;
      stmts.push(
        db
          .prepare(
            `UPDATE cards SET step = ?, job_name = ?, assignee_ids = ?, status = ?,
               activated_at = CASE WHEN ? THEN ? ELSE activated_at END,
               claimed_by = CASE WHEN ? THEN NULL ELSE claimed_by END,
               version = version + ?, updated_at = ? WHERE id = ?`,
          )
          .bind(p.step, p.jobName, JSON.stringify(p.assignees), p.status, activating ? 1 : 0, now, leaving ? 1 : 0, leaving ? 1 : 0, now, p.existing.id),
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
  const key = (jobSort: number, step: number) => after.find((c) => c.job_sort === jobSort && c.step === step)!;
  const activated: number[] = [];
  const events: D1PreparedStatement[] = [];
  for (const p of planned) {
    if (p.status === "active" && p.existing?.status !== "active") {
      const c = key(p.jobSort, p.step);
      activated.push(c.id);
      events.push(eventStmt(db, c.id, wo, "activated", actorId, now));
    }
  }
  for (const [jobSort, areas] of removedByJob) {
    const first = after.find((c) => c.job_sort === jobSort);
    if (!first) continue;
    for (const area of areas) events.push(eventStmt(db, first.id, wo, "removed", actorId, now, { removedArea: area }));
  }
  if (events.length) await db.batch(events);
  return activated;
}
