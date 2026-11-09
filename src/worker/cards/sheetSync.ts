import type { Env } from "../env";

/** Marks a docket's sheet columns as needing a rewrite. hold/comp: a later non-null value wins. */
export async function queueCardSheet(db: D1Database, wo: string, patch: { hold?: 0 | 1; comp?: 1 } = {}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO card_sheet_queue (work_order, hold, comp, queued_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (work_order) DO UPDATE SET hold = coalesce(excluded.hold, hold), comp = coalesce(excluded.comp, comp),
         queued_at = excluded.queued_at`,
    )
    .bind(wo, patch.hold ?? null, patch.comp ?? null, new Date().toISOString())
    .run();
}

/** Writes the queued docket to the Google Sheet. Never throws. (Implemented in Task 6.) */
export async function flushCardSheet(_env: Env, _wo: string): Promise<void> {}
