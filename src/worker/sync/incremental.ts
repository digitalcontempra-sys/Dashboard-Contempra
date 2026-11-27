import { SHEET_LOCK, withLock } from "../dockets/lock";
import type { Env } from "../env";
import { readContempra } from "../sheet/googleClient";
import { forgetAccountManagersIfNew } from "../db/dockets";
import { mapSheet, sha256Hex, type DocketRecord } from "../sheet/mapRows";
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

export const googleReader = (env: Env): SheetReader => readContempra(env);

const message = (e: unknown) => (e as Error)?.message || String(e);

/**
 * Work orders per block. Blocks go by work-order number, not by sheet row: a new docket at the top
 * shifts every row down, and row blocks would all change. A block cut by the edge of the top rows
 * or of a page is seen in parts and gets looked up again; that costs at most a few blocks per run.
 */
export const BLOCK_SIZE = 50;

/** Block of a work order: its number / BLOCK_SIZE; a non-numeric one goes to a negative block by hash. */
export function blockOf(wo: string): number {
  if (/^\d+$/.test(wo)) return Math.floor(Number(wo) / BLOCK_SIZE);
  let h = 2166136261;
  for (let i = 0; i < wo.length; i++) h = Math.imul(h ^ wo.charCodeAt(i), 16777619) >>> 0;
  return -1 - (h % 100_000);
}

/**
 * Looks up the given work orders by primary key. CROSS JOIN keeps the list as the outer loop:
 * `work_order IN (SELECT value FROM json_each(?))` let the planner walk the whole dockets table.
 */
export const LOOKUP_SQL = `SELECT d.work_order, d.row_hash FROM json_each(?) j CROSS JOIN dockets d ON d.work_order = j.value`;
const BLOCKS_SQL = `SELECT b.block, b.hash FROM json_each(?) j CROSS JOIN sync_blocks b ON b.block = j.value`;

type Block = { hash: string; dockets: DocketRecord[] };

/** Groups the dockets read into work-order blocks and hashes each block's work orders, row hashes and duplicate flags. */
async function blockHashes(dockets: DocketRecord[], duplicates: Set<string>): Promise<Map<number, Block>> {
  const groups = new Map<number, DocketRecord[]>();
  for (const d of dockets) {
    const b = blockOf(d.workOrder);
    groups.set(b, [...(groups.get(b) ?? []), d]);
  }
  const out = new Map<number, Block>();
  for (const [b, ds] of groups) {
    const sorted = [...ds].sort((x, y) => (x.workOrder < y.workOrder ? -1 : 1));
    const text = sorted.map((d) => `${d.workOrder}:${d.rowHash}:${duplicates.has(d.workOrder) ? 1 : 0}`).join("|");
    out.set(b, { hash: await sha256Hex(text), dockets: ds });
  }
  return out;
}

export async function runIncrementalSync(
  env: Env,
  reader?: SheetReader,
  opts: IncrementalOptions = DEFAULT_INCREMENTAL,
): Promise<SyncResult> {
  const db = env.DB;
  const now = new Date().toISOString();
  if (!reader && !(await isSheetConfigured(env))) return recordFailure(db, now, "Google Sheet is not connected yet");
  const read = reader ?? googleReader(env);
  const firstPageRow = opts.topRows + 2;

  try {
    const state = await db
      .prepare("SELECT page_cursor FROM sync_state WHERE id = 1")
      .first<{ page_cursor: number | null }>();
    const cursor = state?.page_cursor && state.page_cursor >= firstPageRow ? state.page_cursor : firstPageRow;

    // Under the sheet lock: Set up inserting the STATUS column can never land between these reads.
    const [top, page] = await withLock(db, SHEET_LOCK, async () => [
      await read(`Contempra!A1:P${opts.topRows + 1}`),
      await read(`Contempra!A${cursor}:P${cursor + opts.pageRows - 1}`),
    ]);
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

    // D1 rows read: a block whose rows hash the same as when it was last synced is skipped
    // without reading its dockets. Only the dockets of changed blocks are looked up.
    const blocks = await blockHashes(dockets, duplicates);
    const { results: stored } = await db
      .prepare(BLOCKS_SQL)
      .bind(JSON.stringify([...blocks.keys()]))
      .all<{ block: number; hash: string }>();
    const storedHash = new Map(stored.map((r) => [Number(r.block), r.hash]));
    const changedBlocks = [...blocks].filter(([b, h]) => storedHash.get(b) !== h.hash);
    const toCheck = changedBlocks.flatMap(([, h]) => h.dockets);

    const { results: existing } = toCheck.length
      ? await db
          .prepare(LOOKUP_SQL)
          .bind(JSON.stringify(toCheck.map((d) => d.workOrder)))
          .all<{ work_order: string; row_hash: string }>()
      : { results: [] };
    const known = new Map(existing.map((r) => [r.work_order, r.row_hash]));

    const stmts: D1PreparedStatement[] = [];
    let rowsChanged = 0;
    const writtenAms: (string | null)[] = [];
    for (const d of toCheck) {
      // A duplicated work order stays frozen until someone fixes the sheet (see Needs Review):
      // a partial read cannot tell which copy is the topmost one.
      if (known.has(d.workOrder) && (duplicates.has(d.workOrder) || known.get(d.workOrder) === d.rowHash)) continue;
      rowsChanged++;
      writtenAms.push(d.accountManager);
      stmts.push(db.prepare(UPSERT_SQL).bind(...upsertParams(d, now)));
    }
    // After the docket writes: a block is remembered only once its rows are in D1.
    for (const [b, h] of changedBlocks)
      stmts.push(
        db
          .prepare("INSERT INTO sync_blocks (block, hash) VALUES (?, ?) ON CONFLICT (block) DO UPDATE SET hash = excluded.hash")
          .bind(b, h.hash),
      );
    stmts.push(
      db
        .prepare(
          `UPDATE sync_state SET last_run_at = ?, last_success_at = ?, last_error = NULL,
           rows_seen = ?, rows_changed = ?, rows_deleted = 0, page_cursor = ? WHERE id = 1`,
        )
        .bind(now, now, dockets.length, rowsChanged, nextCursor),
    );
    await runBatches(db, stmts);
    await forgetAccountManagersIfNew(db, writtenAms);
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
