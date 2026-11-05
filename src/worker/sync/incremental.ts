import type { Env } from "../env";
import { readSheetRange } from "../sheet/googleClient";
import { mapSheet, type DocketRecord } from "../sheet/mapRows";
import {
  isSheetConfigured,
  recordFailure,
  runBatches,
  UPSERT_SQL,
  upsertParams,
  type SyncResult,
} from "./syncDockets";

/** Reads one A1 range of the sheet; injectable for tests. */
export type SheetReader = (range: string) => Promise<unknown[][]>;

export type IncrementalOptions = { topRows: number; pageRows: number };

/**
 * Free-plan budget: every run reads the newest rows (top of the sheet, where active work lives)
 * plus one rotating page of older rows, so the whole sheet is revisited about once an hour.
 */
export const DEFAULT_INCREMENTAL: IncrementalOptions = { topRows: 600, pageRows: 600 };

export const googleReader =
  (env: Env): SheetReader =>
  (range) =>
    readSheetRange(env, range);

const message = (e: unknown) => (e as Error)?.message || String(e);

export async function runIncrementalSync(
  env: Env,
  reader?: SheetReader,
  opts: IncrementalOptions = DEFAULT_INCREMENTAL,
): Promise<SyncResult> {
  const db = env.DB;
  const now = new Date().toISOString();
  if (!reader && !isSheetConfigured(env)) return recordFailure(db, now, "Google Sheet is not connected yet");
  const read = reader ?? googleReader(env);
  const firstPageRow = opts.topRows + 2;

  try {
    const state = await db
      .prepare("SELECT page_cursor FROM sync_state WHERE id = 1")
      .first<{ page_cursor: number | null }>();
    const cursor = state?.page_cursor && state.page_cursor >= firstPageRow ? state.page_cursor : firstPageRow;

    const top = await read(`Contempra!A1:P${opts.topRows + 1}`);
    const page = await read(`Contempra!A${cursor}:P${cursor + opts.pageRows - 1}`);
    const header = top[0] ?? [];
    const topMapped = await mapSheet(top, 2);
    const pageMapped = await mapSheet([header, ...page], cursor);
    const nextCursor = page.length < opts.pageRows ? firstPageRow : cursor + opts.pageRows;

    // Top rows come first, so for a work order seen twice in one run the upper row wins.
    const byWo = new Map<string, DocketRecord>();
    for (const d of [...topMapped.dockets, ...pageMapped.dockets]) if (!byWo.has(d.workOrder)) byWo.set(d.workOrder, d);
    const dockets = [...byWo.values()];

    const { results: dupRows } = await db
      .prepare("SELECT DISTINCT work_order FROM review_items WHERE kind = 'duplicate_work_order'")
      .all<{ work_order: string }>();
    const duplicates = new Set(dupRows.map((r) => r.work_order));
    for (const r of [...topMapped.review, ...pageMapped.review]) {
      if (r.kind === "duplicate_work_order" && r.workOrder) duplicates.add(r.workOrder);
    }

    const { results: existing } = await db
      .prepare("SELECT work_order, row_hash FROM dockets WHERE work_order IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(dockets.map((d) => d.workOrder)))
      .all<{ work_order: string; row_hash: string }>();
    const known = new Map(existing.map((r) => [r.work_order, r.row_hash]));

    const stmts: D1PreparedStatement[] = [];
    let rowsChanged = 0;
    for (const d of dockets) {
      if (!known.has(d.workOrder)) {
        rowsChanged++;
        stmts.push(db.prepare(UPSERT_SQL).bind(...upsertParams(d, now)));
        continue;
      }
      // A duplicated work order stays frozen until someone fixes the sheet (see Needs Review):
      // a partial read cannot tell which copy is the topmost one.
      if (duplicates.has(d.workOrder) || known.get(d.workOrder) === d.rowHash) continue;
      rowsChanged++;
      stmts.push(db.prepare(UPSERT_SQL).bind(...upsertParams(d, now)));
    }
    stmts.push(
      db
        .prepare(
          `UPDATE sync_state SET last_run_at = ?, last_success_at = ?, last_error = NULL,
           rows_seen = ?, rows_changed = ?, rows_deleted = 0, page_cursor = ? WHERE id = 1`,
        )
        .bind(now, now, dockets.length, rowsChanged, nextCursor),
    );
    await runBatches(db, stmts);
    return { ok: true, rowsSeen: dockets.length, rowsChanged, rowsDeleted: 0, error: null };
  } catch (e) {
    return recordFailure(db, now, message(e)).catch(() => ({
      ok: false,
      rowsSeen: 0,
      rowsChanged: 0,
      rowsDeleted: 0,
      error: message(e),
    }));
  }
}
