import type { DocketForm } from "../../shared/docketForm";
import type { Env } from "../env";
import { DriveFileNotFoundError } from "../google/drive";
import { getGateways } from "../google/gateways";
import { withLock } from "./lock";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
const CLAIM_TIMEOUT_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;
/** One Drive copy at a time: the first upload creates the folders, and parallel uploads would duplicate them. */
const DRIVE_LOCK = "drive";
export const pdfKey = (wo: string) => `dockets/${wo}.pdf`;

/**
 * Stores the browser-rendered PDF in R2. `version` is the docket version it was rendered from.
 * Each upload bumps pdf_generation; a Drive copy already running keeps its claim and is re-queued
 * when it finishes, so the newest bytes always reach Drive (into the same file).
 */
export async function storeDocketPdf(env: Env, wo: string, bytes: ArrayBuffer, version: number | null): Promise<void> {
  await env.DOCKETS_BUCKET.put(pdfKey(wo), bytes, { httpMetadata: { contentType: "application/pdf" } });
  await env.DB.prepare(
    `UPDATE virtual_dockets SET pdf_key = ?, pdf_version = ?, pdf_generation = pdf_generation + 1, drive_attempts = 0,
       drive_status = CASE WHEN drive_status = 'syncing' THEN 'syncing' ELSE 'pending' END
     WHERE work_order = ?`,
  )
    .bind(pdfKey(wo), version, wo)
    .run();
}

/** Copies the stored PDF to Drive (replacing the earlier copy) and writes its link to column P. */
export async function syncDocketPdfToDrive(env: Env, wo: string): Promise<void> {
  // Claim the copy so a background upload and a cron retry never upload the same docket twice.
  const now = new Date();
  const claimedAt = now.toISOString();
  const stale = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE virtual_dockets SET drive_status = 'syncing', drive_claimed_at = ?, drive_generation = pdf_generation
     WHERE work_order = ? AND (drive_status IN ('pending', 'failed') OR (drive_status = 'syncing' AND drive_claimed_at < ?))`,
  )
    .bind(claimedAt, wo, stale)
    .run();
  if (claim.meta.changes === 0) return;

  const row = await env.DB.prepare(
    "SELECT form_json, pdf_key, drive_file_id, created_at FROM virtual_dockets WHERE work_order = ?",
  )
    .bind(wo)
    .first<{ form_json: string; pdf_key: string | null; drive_file_id: string | null; created_at: string }>();
  if (!row?.pdf_key) return;
  try {
    const obj = await env.DOCKETS_BUCKET.get(row.pdf_key);
    if (!obj) throw new Error("PDF missing in storage");
    const bytes = await obj.arrayBuffer();
    const form = JSON.parse(row.form_json) as DocketForm;
    const year = Number((form.date || row.created_at).slice(0, 4));
    const { sheet, drive } = getGateways(env);
    const file = await withLock(env.DB, DRIVE_LOCK, async () => {
      try {
        return await drive.upload(wo, form.forName, year, bytes, row.drive_file_id);
      } catch (e) {
        // Someone deleted the Drive copy by hand: make a new one.
        if (e instanceof DriveFileNotFoundError) return drive.upload(wo, form.forName, year, bytes, null);
        throw e;
      }
    });
    // Commit only our own claim; if a newer PDF arrived meanwhile, queue it for the same file.
    await env.DB.prepare(
      `UPDATE virtual_dockets SET drive_file_id = ?, drive_link = ?, drive_attempts = 0,
         drive_status = CASE WHEN pdf_generation = drive_generation THEN 'done' ELSE 'pending' END
       WHERE work_order = ? AND drive_claimed_at = ?`,
    )
      .bind(file.id, file.link, wo, claimedAt)
      .run();
    const sheetRow = await sheet.findRow(wo);
    if (sheetRow !== null) await sheet.updateCells(sheetRow, { P: file.link });
  } catch {
    await env.DB.prepare(
      "UPDATE virtual_dockets SET drive_status = 'failed', drive_attempts = drive_attempts + 1 WHERE work_order = ? AND drive_claimed_at = ?",
    )
      .bind(wo, claimedAt)
      .run();
  }
}

/** Called by the 5-minute cron: retries a few Drive copies, oldest first, giving up after 10 attempts. */
export async function retryPendingDrive(env: Env, limit = 5): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT work_order FROM virtual_dockets WHERE deleted_at IS NULL AND drive_attempts < ?
     AND (drive_status IN ('pending', 'failed') OR (drive_status = 'syncing' AND drive_claimed_at < ?))
     ORDER BY drive_claimed_at IS NOT NULL, drive_claimed_at LIMIT ?`,
  )
    .bind(MAX_ATTEMPTS, new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString(), limit)
    .all<{ work_order: string }>();
  for (const r of results) await syncDocketPdfToDrive(env, r.work_order);
}
