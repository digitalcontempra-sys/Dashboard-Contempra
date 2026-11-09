import { areaCellText, fieldsSummary, ROLE_ORDER, stageText, type CardFields } from "../../shared/cards";
import type { SessionUser } from "../../shared/types";
import { ServiceError } from "../dockets/errors";
import { withLock } from "../dockets/lock";
import { locateRow, readRow, SHEET_LOCK, upsertMirror } from "../dockets/service";
import type { Env } from "../env";
import { getGateways } from "../google/gateways";
import { tabRef, type RowCells } from "../google/sheets";

export const STAGE_HEADERS = ["Stage", "Design", "Print Roll", "Print FB", "Laminate", "Liquid Lam", "Colex", "Finishing", "Install", "Assigned"];
export const PRODUCTION_HEADERS = [
  "Work Order",
  "Job",
  "Step",
  "Role",
  "Assigned To",
  "Status",
  "Fields",
  "Returned Reason",
  "Updated By",
  "Updated At",
];
const PRODUCTION_TAB = "Production";
const LEGACY_TAB = "Legacy Q-Y";
/** Sheet columns R..Y, one per area, in role order. */
const AREA_COLS = ["R", "S", "T", "U", "V", "W", "X", "Y"];
const MAX_ATTEMPTS = 20;

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

async function columnsReady(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM app_settings WHERE key = 'production_columns'").first<{ value: string }>();
  return r?.value === "ready";
}

type SheetCard = {
  id: number;
  job_name: string;
  job_sort: number;
  step: number;
  role_id: string;
  role_label: string;
  status: "waiting" | "active" | "done";
  assignee_ids: string;
  fields_json: string;
  returned_reason: string | null;
  done_at: string | null;
  updated_at: string;
  claimed_name: string | null;
  done_name: string | null;
  last_actor: string | null;
};

async function sheetCards(db: D1Database, wo: string): Promise<SheetCard[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.job_name, c.job_sort, c.step, c.role_id, r.label AS role_label, c.status, c.assignee_ids, c.fields_json,
         c.returned_reason, c.done_at, c.updated_at, uc.full_name AS claimed_name, ud.full_name AS done_name,
         (SELECT u.full_name FROM card_events e JOIN users u ON u.id = e.user_id WHERE e.card_id = c.id ORDER BY e.id DESC LIMIT 1) AS last_actor
       FROM cards c JOIN roles r ON r.id = c.role_id
       LEFT JOIN users uc ON uc.id = c.claimed_by LEFT JOIN users ud ON ud.id = c.done_by
       WHERE c.work_order = ? ORDER BY c.job_sort, c.step`,
    )
    .bind(wo)
    .all<SheetCard>();
  return results;
}

async function userNames(db: D1Database, ids: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (!ids.length) return names;
  const { results } = await db
    .prepare(`SELECT id, full_name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: number; full_name: string }>();
  for (const u of results) names.set(u.id, u.full_name);
  return names;
}

const assigneeIds = (c: SheetCard) => JSON.parse(c.assignee_ids) as number[];

function assignedText(c: SheetCard, names: Map<number, string>): string {
  if (c.claimed_name) return c.claimed_name;
  const ids = assigneeIds(c);
  return ids.length ? ids.map((id) => names.get(id) ?? "?").join(", ") : "Team";
}

const AT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Winnipeg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Q–Z cells (plus D/E when the queue asks for COMP/HOLD). */
export function stageRowCells(cards: SheetCard[], names: Map<number, string>, q: { hold: number | null; comp: number | null }): RowCells {
  const cells: RowCells = {};
  const active = cards.filter((c) => c.status === "active");
  const allDone = cards.length > 0 && cards.every((c) => c.status === "done");
  cells.Q = stageText(active.map((c) => ({ roleId: c.role_id })), allDone);
  ROLE_ORDER.forEach((roleId, i) => {
    const mine = cards.filter((c) => c.role_id === roleId);
    cells[AREA_COLS[i]] = mine.length
      ? mine
          .map((c) =>
            areaCellText({
              status: c.status,
              returnedReason: c.returned_reason,
              claimedByName: c.claimed_name,
              doneByName: c.done_name,
              doneAt: c.done_at,
              fields: JSON.parse(c.fields_json) as CardFields,
              roleId: c.role_id,
            }),
          )
          .join(" | ")
      : "—";
  });
  cells.Z = active.length ? [...new Set(active.map((c) => assignedText(c, names)))].join(", ") : "";
  if (q.comp === 1) cells.D = true;
  if (q.hold !== null) cells.E = q.hold === 1;
  return cells;
}

function productionRow(wo: string, c: SheetCard, names: Map<number, string>): unknown[] {
  const status = c.status === "done" ? "Done" : c.status === "waiting" ? "Waiting" : c.returned_reason ? "Returned" : "Active";
  return [
    wo,
    c.job_name,
    c.step + 1,
    c.role_label,
    assignedText(c, names),
    status,
    fieldsSummary(c.role_id, JSON.parse(c.fields_json) as CardFields),
    c.returned_reason ?? "",
    c.last_actor ?? "",
    AT.format(new Date(c.updated_at)),
  ];
}

/** Writes the queued docket to the Google Sheet. Never throws: failures stay queued for the cron. */
export async function flushCardSheet(env: Env, wo: string): Promise<void> {
  const db = env.DB;
  const q = await db
    .prepare("SELECT hold, comp, queued_at FROM card_sheet_queue WHERE work_order = ?")
    .bind(wo)
    .first<{ hold: number | null; comp: number | null; queued_at: string }>();
  if (!q || !(await columnsReady(db))) return;
  try {
    const cards = await sheetCards(db, wo);
    const names = await userNames(db, [...new Set(cards.flatMap(assigneeIds))]);
    const sheet = getGateways(env).sheet;
    await withLock(db, SHEET_LOCK, async () => {
      const { row } = await locateRow(env, wo);
      await sheet.updateCells(row, stageRowCells(cards, names, q));

      // Production tab: one row per (Work Order, Job, Step), updated in place.
      const existing = await sheet.readRange(`${tabRef(PRODUCTION_TAB)}!A2:F`);
      const fresh: unknown[][] = [];
      const seen = new Set<number>();
      for (const c of cards) {
        const values = productionRow(wo, c, names);
        const i = existing.findIndex((r) => String(r?.[0] ?? "") === wo && String(r?.[1] ?? "") === c.job_name && Number(r?.[2]) === c.step + 1);
        if (i >= 0) {
          seen.add(i);
          await sheet.writeRange(`${tabRef(PRODUCTION_TAB)}!A${i + 2}`, [values]);
        } else fresh.push(values);
      }
      // Rows of this docket that no longer match a card were removed from the route.
      for (const [i, r] of existing.entries()) {
        if (String(r?.[0] ?? "") === wo && !seen.has(i) && r?.[5] !== "Removed") {
          await sheet.writeRange(`${tabRef(PRODUCTION_TAB)}!F${i + 2}`, [["Removed"]]);
        }
      }
      if (fresh.length) await sheet.appendRows(PRODUCTION_TAB, fresh);
      await upsertMirror(db, await readRow(env, row), row).catch(() => undefined);
    });
    // A change queued while we were writing keeps its row for the next flush.
    await db.prepare("DELETE FROM card_sheet_queue WHERE work_order = ? AND queued_at = ?").bind(wo, q.queued_at).run();
  } catch (e) {
    await db
      .prepare("UPDATE card_sheet_queue SET attempts = attempts + 1, last_error = ? WHERE work_order = ?")
      .bind(String((e as Error).message ?? e).slice(0, 300), wo)
      .run();
  }
}

/** Cron: retries queued dockets, oldest first. */
export async function retryCardSheet(env: Env): Promise<void> {
  if (!(await columnsReady(env.DB))) return;
  const { results } = await env.DB.prepare(
    "SELECT work_order FROM card_sheet_queue WHERE attempts < ? ORDER BY queued_at LIMIT 20",
  )
    .bind(MAX_ATTEMPTS)
    .all<{ work_order: string }>();
  for (const r of results) await flushCardSheet(env, r.work_order);
}

/** One-time: archives Q–Y to "Legacy Q-Y", clears them, and writes the production headers. */
export async function setupProductionColumns(env: Env, _user: SessionUser): Promise<{ archivedRows: number }> {
  const db = env.DB;
  const sheet = getGateways(env).sheet;
  const archivedRows = await withLock(db, SHEET_LOCK, async () => {
    const head = await sheet.readRange("Contempra!Q1:Z1");
    if (String(head[0]?.[0] ?? "").trim() === "Stage") throw new ServiceError(409, "Production columns are already set up.");
    const wos = await sheet.readRange("Contempra!C1:C");
    const old = await sheet.readRange("Contempra!Q1:Y");
    const pad = (r: unknown[] | undefined) => Array.from({ length: 9 }, (_, i) => r?.[i] ?? "");
    const legacy: unknown[][] = [["Work Order", ...pad(old[0])]];
    for (let i = 1; i < old.length; i++) {
      const vals = pad(old[i]);
      if (vals.some((v) => String(v).trim() !== "")) legacy.push([wos[i]?.[0] ?? "", ...vals]);
    }
    await sheet.ensureTab(LEGACY_TAB);
    await sheet.writeRange(`${tabRef(LEGACY_TAB)}!A1`, legacy);
    await sheet.clearColumns("Q", "Z", 2);
    await sheet.writeRange("Contempra!Q1", [STAGE_HEADERS]);
    await sheet.ensureTab(PRODUCTION_TAB);
    await sheet.writeRange(`${tabRef(PRODUCTION_TAB)}!A1`, [PRODUCTION_HEADERS]);
    return legacy.length - 1;
  });
  await db
    .prepare("INSERT INTO app_settings (key, value) VALUES ('production_columns', 'ready') ON CONFLICT (key) DO UPDATE SET value = 'ready'")
    .run();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO card_sheet_queue (work_order, queued_at) SELECT DISTINCT work_order, ? FROM cards WHERE true
       ON CONFLICT (work_order) DO NOTHING`,
    )
    .bind(now)
    .run();
  return { archivedRows };
}
