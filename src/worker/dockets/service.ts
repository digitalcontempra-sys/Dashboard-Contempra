import {
  cancelStamp,
  emptyForm,
  formFromDocket,
  stripPrices,
  toSheetCells,
  WHOLE_DOCKET,
  type DocketForm,
  type ProductionJob,
} from "../../shared/docketForm";
import type { SessionUser, VirtualDocketDTO } from "../../shared/types";
import { getDocket } from "../db/dockets";
import type { Env } from "../env";
import { getGateways } from "../google/gateways";
import { GoogleDisconnectedError } from "../google/oauth";
import type { RowCells } from "../google/sheets";
import { EXPECTED_HEADERS, mapSheet } from "../sheet/mapRows";
import { UPSERT_SQL, upsertParams } from "../sync/syncDockets";

export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_WO_ATTEMPTS = 5;
const COLUMNS = "ABCDEFGHIJKLMNOP".split("");
export const SAVE_FAILED = "Could not save to Google Sheet. Nothing was saved. Try again.";
const UPDATE_FAILED = "Could not update the Google Sheet. Try again.";
const ROW_GONE = "This work order is no longer in the Google Sheet";

export class ServiceError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 502 | 503, message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

type VirtualRow = {
  work_order: string;
  state: string;
  form_json: string;
  version: number;
  pdf_key: string | null;
  drive_file_id: string | null;
  drive_link: string | null;
  drive_status: string;
  updated_by: number | null;
  deleted_at: string | null;
  deleted_row_json: string | null;
};

/** Google failures become user-facing errors; a disconnected account says so. */
function googleError(e: unknown, message: string): ServiceError {
  if (e instanceof ServiceError) return e;
  if (e instanceof GoogleDisconnectedError) return new ServiceError(503, e.message);
  return new ServiceError(502, message);
}

const toRowValues = (cells: RowCells): unknown[] => COLUMNS.map((c) => cells[c] ?? "");
const toCells = (values: unknown[]): RowCells => Object.fromEntries(COLUMNS.map((c, i) => [c, (values[i] ?? "") as never]));

/** Refreshes the D1 mirror from one sheet row so the dashboard updates without waiting for the sync. */
async function upsertMirror(db: D1Database, values: unknown[], sheetRow: number): Promise<void> {
  const { dockets } = await mapSheet([EXPECTED_HEADERS, values], sheetRow);
  const d = dockets[0];
  if (d) await db.prepare(UPSERT_SQL).bind(...upsertParams(d, new Date().toISOString())).run();
}

async function readRow(env: Env, row: number): Promise<unknown[]> {
  const values = await getGateways(env).sheet.readRange(`Contempra!A${row}:P${row}`);
  return values[0] ?? [];
}

async function loadVirtual(db: D1Database, wo: string): Promise<VirtualRow | null> {
  return db.prepare("SELECT * FROM virtual_dockets WHERE work_order = ?").bind(wo).first<VirtualRow>();
}

async function loadJobs(db: D1Database, wo: string): Promise<ProductionJob[]> {
  const { results } = await db
    .prepare(
      `SELECT j.id, j.name, s.role_id, s.assignee_ids FROM docket_jobs j
       LEFT JOIN job_steps s ON s.job_id = j.id WHERE j.work_order = ? ORDER BY j.sort, s.step`,
    )
    .bind(wo)
    .all<{ id: number; name: string; role_id: string | null; assignee_ids: string | null }>();
  const jobs = new Map<number, ProductionJob>();
  for (const r of results) {
    const job = jobs.get(r.id) ?? { name: r.name, steps: [] };
    if (r.role_id) job.steps.push({ roleId: r.role_id, assigneeIds: JSON.parse(r.assignee_ids ?? "[]") });
    jobs.set(r.id, job);
  }
  return jobs.size ? [...jobs.values()] : [{ name: WHOLE_DOCKET, steps: [] }];
}

async function validateJobs(db: D1Database, jobs: ProductionJob[] | undefined): Promise<ProductionJob[]> {
  const list = jobs?.length ? jobs : [{ name: WHOLE_DOCKET, steps: [] }];
  const { results } = await db.prepare("SELECT id FROM roles").all<{ id: string }>();
  const known = new Set(results.map((r) => r.id));
  for (const j of list) {
    if (!j.name?.trim()) throw new ServiceError(400, "Every job needs a name");
    for (const s of j.steps) if (!known.has(s.roleId)) throw new ServiceError(400, `Unknown role: ${s.roleId}`);
  }
  return list;
}

function jobStatements(db: D1Database, wo: string, jobs: ProductionJob[]): D1PreparedStatement[] {
  const stmts = [db.prepare("DELETE FROM docket_jobs WHERE work_order = ?").bind(wo)];
  jobs.forEach((j, i) => {
    // Job ids are derived so steps can reference them inside the same batch.
    const id = `(SELECT id FROM docket_jobs WHERE work_order = ? AND sort = ${i})`;
    stmts.push(db.prepare("INSERT INTO docket_jobs (work_order, name, sort) VALUES (?, ?, ?)").bind(wo, j.name.trim(), i));
    j.steps.forEach((s, step) =>
      stmts.push(
        db
          .prepare(`INSERT INTO job_steps (job_id, step, role_id, assignee_ids) VALUES (${id}, ?, ?, ?)`)
          .bind(wo, step, s.roleId, JSON.stringify(s.assigneeIds ?? [])),
      ),
    );
  });
  return stmts;
}

function validateForm(form: DocketForm | undefined): DocketForm {
  if (!form || !form.forName?.trim()) throw new ServiceError(400, "FOR is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date ?? "")) throw new ServiceError(400, "DATE is not valid");
  return form;
}

function toDto(row: VirtualRow, jobs: ProductionJob[], actor: SessionUser): VirtualDocketDTO {
  const form = JSON.parse(row.form_json) as DocketForm;
  return {
    workOrder: row.work_order,
    form: actor.accessLevel === "staff" ? stripPrices(form) : form,
    jobs,
    version: row.version,
    source: "virtual",
    pdf: { stored: Boolean(row.pdf_key), driveLink: row.drive_link, driveStatus: row.drive_status },
    deletedAt: row.deleted_at,
  };
}

async function nextWorkOrder(env: Env): Promise<number> {
  const db = env.DB;
  const mirror = await db.prepare("SELECT max(CAST(work_order AS INTEGER)) AS n FROM dockets").first<{ n: number | null }>();
  const virt = await db.prepare("SELECT max(CAST(work_order AS INTEGER)) AS n FROM virtual_dockets").first<{ n: number | null }>();
  const top = await getGateways(env).sheet.readRange("Contempra!C2:C51");
  const sheetMax = Math.max(0, ...top.map((r) => Number(r?.[0])).filter((n) => Number.isInteger(n)));
  return Math.max(mirror?.n ?? 0, virt?.n ?? 0, sheetMax) + 1;
}

export async function createDocket(
  env: Env,
  actor: SessionUser,
  input: { form?: DocketForm; jobs?: ProductionJob[] },
): Promise<VirtualDocketDTO> {
  const db = env.DB;
  const form = validateForm(input.form);
  const jobs = await validateJobs(db, input.jobs);
  const now = new Date().toISOString();

  // Reserve the number in D1 first: the primary key makes two saves at once pick different numbers.
  let wo = "";
  try {
    let candidate = await nextWorkOrder(env);
    for (let attempt = 0; attempt < MAX_WO_ATTEMPTS && !wo; attempt++, candidate++) {
      const ok = await db
        .prepare(
          `INSERT INTO virtual_dockets (work_order, state, form_json, created_by, created_at, updated_by, updated_at)
           VALUES (?, 'saving', ?, ?, ?, ?, ?) ON CONFLICT (work_order) DO NOTHING`,
        )
        .bind(String(candidate), JSON.stringify(form), actor.id, now, actor.id, now)
        .run();
      if (ok.meta.changes > 0) wo = String(candidate);
    }
  } catch (e) {
    throw googleError(e, SAVE_FAILED);
  }
  if (!wo) throw new ServiceError(409, "Could not reserve a work order number. Try again.");

  const cells = toSheetCells(form, wo, "create");
  try {
    await getGateways(env).sheet.insertTopRow(cells);
  } catch (e) {
    await db.prepare("DELETE FROM virtual_dockets WHERE work_order = ? AND state = 'saving'").bind(wo).run();
    throw googleError(e, SAVE_FAILED);
  }
  await db.batch([
    db.prepare("UPDATE virtual_dockets SET state = 'saved' WHERE work_order = ?").bind(wo),
    ...jobStatements(db, wo, jobs),
  ]);
  await upsertMirror(db, toRowValues(cells), 2);
  return toDto((await loadVirtual(db, wo))!, jobs, actor);
}

export async function getVirtualDocket(env: Env, actor: SessionUser, wo: string): Promise<VirtualDocketDTO> {
  const db = env.DB;
  const row = await loadVirtual(db, wo);
  if (row && row.state === "saved") return toDto(row, await loadJobs(db, wo), actor);
  const detail = await getDocket(db, wo, new Date());
  if (!detail) throw new ServiceError(404, "Work order not found");
  const form = formFromDocket(detail, actor.fullName);
  return {
    workOrder: wo,
    form: actor.accessLevel === "staff" ? stripPrices(form) : form,
    jobs: [{ name: WHOLE_DOCKET, steps: [] }],
    version: 0,
    source: "sheet",
    pdf: { stored: false, driveLink: null, driveStatus: "none" },
    deletedAt: null,
  };
}

async function requireRow(env: Env, wo: string): Promise<number> {
  let row: number | null;
  try {
    row = await getGateways(env).sheet.findRow(wo);
  } catch (e) {
    throw googleError(e, UPDATE_FAILED);
  }
  if (row === null) throw new ServiceError(409, ROW_GONE);
  return row;
}

export async function updateDocket(
  env: Env,
  actor: SessionUser,
  wo: string,
  input: { form?: DocketForm; jobs?: ProductionJob[]; version?: number },
): Promise<VirtualDocketDTO> {
  const db = env.DB;
  const form = validateForm(input.form);
  const jobs = await validateJobs(db, input.jobs);
  const existing = await loadVirtual(db, wo);
  if (existing?.deleted_at) throw new ServiceError(409, "This docket is in the Trash");
  const current = existing?.version ?? 0;
  if ((input.version ?? 0) !== current) {
    const who = existing?.updated_by
      ? await db.prepare("SELECT full_name FROM users WHERE id = ?").bind(existing.updated_by).first<{ full_name: string }>()
      : null;
    throw new ServiceError(409, `This docket was changed by ${who?.full_name ?? "someone else"}. Reload to see the latest version.`);
  }
  const row = await requireRow(env, wo);
  try {
    await getGateways(env).sheet.updateCells(row, toSheetCells(form, wo, "edit"));
  } catch (e) {
    throw googleError(e, UPDATE_FAILED);
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO virtual_dockets (work_order, state, form_json, version, created_by, created_at, updated_by, updated_at)
         VALUES (?, 'saved', ?, ?, ?, ?, ?, ?)
         ON CONFLICT (work_order) DO UPDATE SET form_json = excluded.form_json, version = excluded.version,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at, state = 'saved'`,
      )
      .bind(wo, JSON.stringify(form), current + 1, actor.id, now, actor.id, now),
    ...jobStatements(db, wo, jobs),
  ]);
  await upsertMirror(db, await readRow(env, row), row).catch(() => undefined);
  return toDto((await loadVirtual(db, wo))!, jobs, actor);
}

export async function cancelDocket(env: Env, wo: string, now = new Date()): Promise<void> {
  const row = await requireRow(env, wo);
  try {
    await getGateways(env).sheet.updateCells(row, { M: cancelStamp(now) });
  } catch (e) {
    throw googleError(e, UPDATE_FAILED);
  }
  await upsertMirror(env.DB, await readRow(env, row), row).catch(() => undefined);
}

export async function deleteDocket(env: Env, actor: SessionUser, wo: string, confirm: unknown): Promise<void> {
  if (confirm !== wo) throw new ServiceError(400, "Type the work order number to confirm");
  const db = env.DB;
  const row = await requireRow(env, wo);
  const values = await readRow(env, row);
  try {
    await getGateways(env).sheet.deleteRow(row);
  } catch (e) {
    throw googleError(e, UPDATE_FAILED);
  }
  const now = new Date().toISOString();
  const existing = await loadVirtual(db, wo);
  // A docket born in the sheet gets a virtual row now, so the Trash can hold its copy.
  let formJson = existing?.form_json;
  if (!formJson) {
    const detail = await getDocket(db, wo, new Date());
    const form = detail ? formFromDocket(detail, actor.fullName) : { ...emptyForm(now.slice(0, 10), actor.fullName), forName: String(values[6] ?? "") };
    formJson = JSON.stringify(form);
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO virtual_dockets (work_order, state, form_json, created_by, created_at, updated_by, updated_at,
           deleted_at, deleted_by, deleted_row_json)
         VALUES (?, 'saved', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (work_order) DO UPDATE SET deleted_at = excluded.deleted_at, deleted_by = excluded.deleted_by,
           deleted_row_json = excluded.deleted_row_json`,
      )
      .bind(wo, formJson, actor.id, now, actor.id, now, now, actor.id, JSON.stringify(values)),
    db.prepare("DELETE FROM dockets WHERE work_order = ?").bind(wo),
  ]);
}

export async function restoreDocket(env: Env, wo: string): Promise<void> {
  const db = env.DB;
  const row = await loadVirtual(db, wo);
  if (!row?.deleted_at || !row.deleted_row_json) throw new ServiceError(404, "This docket is not in the Trash");
  const values = JSON.parse(row.deleted_row_json) as unknown[];
  try {
    await getGateways(env).sheet.insertTopRow(toCells(values));
  } catch (e) {
    throw googleError(e, UPDATE_FAILED);
  }
  await db
    .prepare("UPDATE virtual_dockets SET deleted_at = NULL, deleted_by = NULL, deleted_row_json = NULL WHERE work_order = ?")
    .bind(wo)
    .run();
  await upsertMirror(db, values, 2);
}

export async function listTrash(env: Env, now = new Date()) {
  const { results } = await env.DB.prepare(
    `SELECT v.work_order, v.form_json, v.deleted_at, u.full_name AS deleted_by
     FROM virtual_dockets v LEFT JOIN users u ON u.id = v.deleted_by
     WHERE v.deleted_at IS NOT NULL ORDER BY v.deleted_at DESC`,
  ).all<{ work_order: string; form_json: string; deleted_at: string; deleted_by: string | null }>();
  return results.map((r) => ({
    workOrder: r.work_order,
    forName: (JSON.parse(r.form_json) as DocketForm).forName,
    deletedAt: r.deleted_at,
    deletedBy: r.deleted_by,
    daysLeft: Math.max(0, TRASH_DAYS - Math.floor((now.getTime() - Date.parse(r.deleted_at)) / DAY_MS)),
  }));
}

/** Nightly: permanently removes dockets that stayed in the Trash for more than 30 days. */
export async function purgeTrash(env: Env, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * DAY_MS).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT work_order, pdf_key, drive_file_id FROM virtual_dockets WHERE deleted_at IS NOT NULL AND deleted_at < ?",
  )
    .bind(cutoff)
    .all<{ work_order: string; pdf_key: string | null; drive_file_id: string | null }>();
  for (const r of results) {
    if (r.pdf_key) await env.DOCKETS_BUCKET.delete(r.pdf_key);
    if (r.drive_file_id) await getGateways(env).drive.trash(r.drive_file_id).catch(() => undefined);
    await env.DB.prepare("DELETE FROM virtual_dockets WHERE work_order = ?").bind(r.work_order).run();
  }
  return results.length;
}
