import type { Env } from "../env";
import { fetchContempraValues } from "../sheet/googleClient";
import { mapSheet, type DocketRecord } from "../sheet/mapRows";

export type SyncResult = {
  ok: boolean;
  rowsSeen: number;
  rowsChanged: number;
  rowsDeleted: number;
  error: string | null;
};

const CHUNK = 100;
/** Below this many stored dockets the shrink guard is skipped (fresh or tiny sheets). */
const SHRINK_GUARD_MIN = 100;

const UPSERT_SQL = `INSERT INTO dockets (
  work_order, sheet_row, date_iso, date_raw, due_iso, due_raw, due_rush, comp, hold, seq, customer, project,
  address, account_manager, role_note, inv, inv_date_raw, quote_po, notes, link, status, billing, row_hash, synced_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT (work_order) DO UPDATE SET
  sheet_row=excluded.sheet_row, date_iso=excluded.date_iso, date_raw=excluded.date_raw, due_iso=excluded.due_iso,
  due_raw=excluded.due_raw, due_rush=excluded.due_rush, comp=excluded.comp, hold=excluded.hold, seq=excluded.seq,
  customer=excluded.customer, project=excluded.project, address=excluded.address,
  account_manager=excluded.account_manager, role_note=excluded.role_note, inv=excluded.inv,
  inv_date_raw=excluded.inv_date_raw, quote_po=excluded.quote_po, notes=excluded.notes, link=excluded.link,
  status=excluded.status, billing=excluded.billing, row_hash=excluded.row_hash, synced_at=excluded.synced_at`;

function upsertParams(d: DocketRecord, now: string): unknown[] {
  return [
    d.workOrder, d.sheetRow, d.dateIso, d.dateRaw, d.dueIso, d.dueRaw, d.dueRush ? 1 : 0, d.comp ? 1 : 0,
    d.hold ? 1 : 0, d.seq, d.customer, d.project, d.address, d.accountManager, d.roleNote, d.inv ? 1 : 0,
    d.invDateRaw, d.quotePo, d.notes, d.link, d.status, d.billing, d.rowHash, now,
  ];
}

async function runBatches(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += CHUNK) await db.batch(stmts.slice(i, i + CHUNK));
}

async function recordFailure(db: D1Database, now: string, error: string): Promise<SyncResult> {
  await db.prepare("UPDATE sync_state SET last_run_at = ?, last_error = ? WHERE id = 1").bind(now, error).run();
  return { ok: false, rowsSeen: 0, rowsChanged: 0, rowsDeleted: 0, error };
}

export async function runSync(env: Env, values?: unknown[][]): Promise<SyncResult> {
  const db = env.DB;
  const now = new Date().toISOString();
  let mapped: Awaited<ReturnType<typeof mapSheet>>;
  try {
    mapped = await mapSheet(values ?? (await fetchContempraValues(env)));
  } catch (e) {
    return recordFailure(db, now, (e as Error).message || String(e));
  }
  const { dockets, review } = mapped;

  const { results: existing } = await db
    .prepare("SELECT work_order, row_hash FROM dockets")
    .all<{ work_order: string; row_hash: string }>();
  if (existing.length > SHRINK_GUARD_MIN && dockets.length < existing.length * 0.5) {
    return recordFailure(db, now, `Sheet returned too few rows (${dockets.length} of ${existing.length})`);
  }

  const known = new Map(existing.map((r) => [r.work_order, r.row_hash]));
  const seen = new Set<string>();
  const stmts: D1PreparedStatement[] = [];
  let rowsChanged = 0;
  for (const d of dockets) {
    seen.add(d.workOrder);
    if (known.get(d.workOrder) === d.rowHash) continue;
    rowsChanged++;
    stmts.push(db.prepare(UPSERT_SQL).bind(...upsertParams(d, now)));
  }
  const gone = existing.filter((r) => !seen.has(r.work_order));
  for (const r of gone) stmts.push(db.prepare("DELETE FROM dockets WHERE work_order = ?").bind(r.work_order));

  stmts.push(db.prepare("DELETE FROM review_items"));
  for (const r of review) {
    stmts.push(
      db
        .prepare("INSERT INTO review_items (kind, work_order, sheet_row, raw_json, detected_at) VALUES (?,?,?,?,?)")
        .bind(r.kind, r.workOrder, r.sheetRow, r.rawJson, now),
    );
  }
  stmts.push(
    db
      .prepare(
        `UPDATE sync_state SET last_run_at = ?, last_success_at = ?, last_error = NULL,
         rows_seen = ?, rows_changed = ?, rows_deleted = ? WHERE id = 1`,
      )
      .bind(now, now, dockets.length, rowsChanged, gone.length),
  );
  await runBatches(db, stmts);

  return { ok: true, rowsSeen: dockets.length, rowsChanged, rowsDeleted: gone.length, error: null };
}
