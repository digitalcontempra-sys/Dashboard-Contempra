import type { Env } from "../env";
import { HeaderMismatchError, parseWorkOrder, type ReviewItem } from "../sheet/mapRows";
import { googleReader, type SheetReader } from "./incremental";
import { isSheetConfigured, recordFailure, runBatches, SHRINK_GUARD_MIN, type SyncResult } from "./syncDockets";

const message = (e: unknown) => (e as Error)?.message || String(e);

/**
 * Nightly reconcile: reads ONLY the Work Order column (cheap on the free plan) to
 * remove dockets deleted from the sheet and rebuild Needs Review.
 */
export async function runNightlyReconcile(env: Env, reader?: SheetReader): Promise<SyncResult> {
  const db = env.DB;
  const now = new Date().toISOString();
  if (!reader && !(await isSheetConfigured(env))) return recordFailure(db, now, "Google Sheet is not connected yet");
  const read = reader ?? googleReader(env);

  try {
    const column = await read("Contempra!C1:C");
    if (String(column[0]?.[0] ?? "").trim() !== "Work Order") throw new HeaderMismatchError("C");

    const rowsByWo = new Map<string, number[]>();
    const review: ReviewItem[] = [];
    for (let i = 1; i < column.length; i++) {
      const raw = column[i]?.[0];
      if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) continue;
      const sheetRow = i + 1;
      const wo = parseWorkOrder(raw);
      if (!wo) {
        review.push({ kind: "invalid_work_order", workOrder: String(raw).trim(), sheetRow, rawJson: "[]" });
        continue;
      }
      rowsByWo.set(wo, [...(rowsByWo.get(wo) ?? []), sheetRow]);
    }
    for (const [wo, rows] of rowsByWo) {
      if (rows.length > 1) {
        for (const sheetRow of rows) review.push({ kind: "duplicate_work_order", workOrder: wo, sheetRow, rawJson: "[]" });
      }
    }

    const { results: existing } = await db.prepare("SELECT work_order FROM dockets").all<{ work_order: string }>();
    if (existing.length > SHRINK_GUARD_MIN && rowsByWo.size < existing.length * 0.5) {
      return recordFailure(db, now, `Sheet returned too few rows (${rowsByWo.size} of ${existing.length})`);
    }
    const gone = existing.filter((r) => !rowsByWo.has(r.work_order));
    await runBatches(
      db,
      gone.map((r) => db.prepare("DELETE FROM dockets WHERE work_order = ?").bind(r.work_order)),
    );
    await db.batch([
      db.prepare("DELETE FROM review_items"),
      ...review.map((r) =>
        db
          .prepare("INSERT INTO review_items (kind, work_order, sheet_row, raw_json, detected_at) VALUES (?,?,?,?,?)")
          .bind(r.kind, r.workOrder, r.sheetRow, r.rawJson, now),
      ),
      db
        .prepare(
          `UPDATE sync_state SET last_run_at = ?, last_success_at = ?, last_full_at = ?, last_error = NULL,
           rows_deleted = ? WHERE id = 1`,
        )
        .bind(now, now, now, gone.length),
    ]);
    return { ok: true, rowsSeen: rowsByWo.size, rowsChanged: 0, rowsDeleted: gone.length, error: null };
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
