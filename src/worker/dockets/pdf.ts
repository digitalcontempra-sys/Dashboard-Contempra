import type { DocketForm } from "../../shared/docketForm";
import type { Env } from "../env";
import { getGateways } from "../google/gateways";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
const CLAIM_TIMEOUT_MS = 10 * 60_000;
export const pdfKey = (wo: string) => `dockets/${wo}.pdf`;

/** Stores the browser-rendered PDF in R2 and marks the Drive copy as pending. */
export async function storeDocketPdf(env: Env, wo: string, bytes: ArrayBuffer): Promise<void> {
  await env.DOCKETS_BUCKET.put(pdfKey(wo), bytes, { httpMetadata: { contentType: "application/pdf" } });
  await env.DB.prepare("UPDATE virtual_dockets SET pdf_key = ?, drive_status = 'pending' WHERE work_order = ?")
    .bind(pdfKey(wo), wo)
    .run();
}

/** Copies the stored PDF to Drive (replacing the earlier copy) and writes its link to column P. */
export async function syncDocketPdfToDrive(env: Env, wo: string): Promise<void> {
  // Claim the copy so a background upload and a cron retry never create two Drive files.
  const now = new Date();
  const stale = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE virtual_dockets SET drive_status = 'syncing', drive_claimed_at = ?
     WHERE work_order = ? AND (drive_status IN ('pending', 'failed') OR (drive_status = 'syncing' AND drive_claimed_at < ?))`,
  )
    .bind(now.toISOString(), wo, stale)
    .run();
  if (claim.meta.changes === 0) return;
  const row = await env.DB.prepare("SELECT form_json, pdf_key, drive_file_id, created_at FROM virtual_dockets WHERE work_order = ?")
    .bind(wo)
    .first<{ form_json: string; pdf_key: string | null; drive_file_id: string | null; created_at: string }>();
  if (!row?.pdf_key) return;
  try {
    const obj = await env.DOCKETS_BUCKET.get(row.pdf_key);
    if (!obj) throw new Error("PDF missing in storage");
    const form = JSON.parse(row.form_json) as DocketForm;
    const year = Number((form.date || row.created_at).slice(0, 4));
    const { sheet, drive } = getGateways(env);
    const file = await drive.upload(wo, form.forName, year, await obj.arrayBuffer(), row.drive_file_id);
    await env.DB.prepare("UPDATE virtual_dockets SET drive_file_id = ?, drive_link = ?, drive_status = 'done' WHERE work_order = ?")
      .bind(file.id, file.link, wo)
      .run();
    const sheetRow = await sheet.findRow(wo);
    if (sheetRow !== null) await sheet.updateCells(sheetRow, { P: file.link });
  } catch {
    await env.DB.prepare("UPDATE virtual_dockets SET drive_status = 'failed' WHERE work_order = ?").bind(wo).run();
  }
}

/** Called by the 5-minute cron: retries a few Drive copies that are pending or failed. */
export async function retryPendingDrive(env: Env, limit = 5): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT work_order FROM virtual_dockets WHERE deleted_at IS NULL
     AND (drive_status IN ('pending', 'failed') OR (drive_status = 'syncing' AND drive_claimed_at < ?)) LIMIT ?`,
  )
    .bind(new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString(), limit)
    .all<{ work_order: string }>();
  for (const r of results) await syncDocketPdfToDrive(env, r.work_order);
}
