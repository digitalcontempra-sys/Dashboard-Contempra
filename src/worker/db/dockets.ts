import { ROLE_ORDER } from "../../shared/cards";
import type { DashFocus } from "../../shared/dashboard";
import { AT_RISK_DUE, codesIn, personalParams, WAITING_WORK_ORDERS } from "../dashboard/rules";
import { deriveTimeBucket, todayInBusinessTz, type DashSection } from "../../shared/rules";
import {
  PAGE_SIZE,
  type AccountManagerCount,
  type DocketDetail,
  type DocketListResponse,
  type DocketSummary,
  type DocketView,
  type Holder,
  type HistoryFilter,
  type NonBilledItem,
  type NonBilledTab,
  type Page,
  type ReviewItemDTO,
} from "../../shared/types";

export type DocketQuery = {
  view: DocketView;
  history?: HistoryFilter;
  bucket?: DashSection;
  am?: string;
  q?: string;
  page?: number;
  /** My Dockets: only dockets whose J is one of these codes (upper case). An empty list matches nothing. */
  codes?: string[];
  /** Signed-in user: adds `followed` and `myOpenNotes` to each item. */
  viewerId?: number;
  /** My List: only dockets the viewer follows. */
  followed?: boolean;
  /**
   * Personal header filters (need `viewerId`): `risk` = my dockets (`codes`) overdue or due today;
   * `waiting` = dockets waiting on me. Same rules as GET /api/dashboard/summary.
   */
  focus?: DashFocus;
};

export type NonBilledQuery = { tab: NonBilledTab; am?: string; q?: string; page?: number };

type Row = Record<string, unknown> & { work_order: string };

/** Saved with "Save as New Order": waiting for more info until it is handed to people. */
const NEW_ORDER_SQL = `EXISTS (SELECT 1 FROM virtual_dockets v WHERE v.work_order = dockets.work_order AND v.new_order = 1)`;
/**
 * Daily Complete: since when the creator's card has been Ready to close with nobody else on the
 * docket (null otherwise). A send back to the creator is not "complete".
 */
const READY_SINCE_SQL = `(SELECT coalesce(c.activated_at, c.updated_at) FROM cards c
  WHERE c.work_order = dockets.work_order AND c.status = 'active' AND c.stage = 'ready_to_close' AND c.returned_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM cards o WHERE o.work_order = c.work_order AND o.status = 'active' AND o.id != c.id))`;
/** One section per docket: New Orders, then Daily Complete, then its time bucket. */
const SECTION_SQL = `CASE WHEN new_order_flag = 1 THEN 'new_orders' WHEN ready_since IS NOT NULL THEN 'daily_complete'
  WHEN due_rush = 1 OR due_iso <= :today THEN 'rush_today' WHEN due_iso IS NULL THEN 'no_due_date' ELSE 'upcoming' END`;

const WO_DESC = "CAST(work_order AS INTEGER) DESC";
const NEWEST_FIRST = `ORDER BY date_iso IS NULL, date_iso DESC, ${WO_DESC}`;
const SECTION_ORDER: Record<DashSection | "all", string> = {
  all: NEWEST_FIRST,
  rush_today: `ORDER BY due_rush DESC, due_iso ASC, ${WO_DESC}`,
  upcoming: `ORDER BY due_iso ASC, ${WO_DESC}`,
  new_orders: NEWEST_FIRST,
  no_due_date: NEWEST_FIRST,
  daily_complete: `ORDER BY ready_since ASC, ${WO_DESC}`,
};

const VIEW_SQL: Record<DocketView, string> = {
  active: "status = 'active'",
  on_hold: "status = 'on_hold'",
  history: "status IN ('completed', 'cancelled')",
};

/** A finishing card marked "Ready for vendor pickup" that has not shipped: the office calls the vendor. */
const VENDOR_PICKUP_SQL = `EXISTS (SELECT 1 FROM cards c WHERE c.work_order = dockets.work_order AND c.role_id = 'finishing'
  AND json_extract(c.fields_json, '$.vendorPickup') = 1 AND coalesce(json_extract(c.fields_json, '$.packaged'), '') != 'shipped')`;

/** Areas (role ids) with an active card, comma-separated. */
const AREAS_SQL = `(SELECT group_concat(DISTINCT c.role_id) FROM cards c WHERE c.work_order = dockets.work_order AND c.status = 'active')`;
/**
 * Who has the docket now: per active card, whoever started it, else the people it was sent to
 * (a team card with neither gives the area alone). role<US>name rows joined by <RS>.
 */
const HOLDERS_SQL = `(SELECT group_concat(c.role_id || char(31) || coalesce(u.full_name, ''), char(30))
  FROM cards c LEFT JOIN users u ON (c.claimed_by IS NOT NULL AND u.id = c.claimed_by)
    OR (c.claimed_by IS NULL AND u.id IN (SELECT value FROM json_each(c.assignee_ids)))
  WHERE c.work_order = dockets.work_order AND c.status = 'active')`;
/** Every card of the docket is done (and it has at least one). */
const PRODUCTION_DONE_SQL = `(EXISTS (SELECT 1 FROM cards c WHERE c.work_order = dockets.work_order)
  AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.work_order = dockets.work_order AND c.status != 'done'))`;

/** The viewer's My List flag and open pinned notes (`:me`). */
const MARKS_SQL = `EXISTS (SELECT 1 FROM docket_follows f WHERE f.user_id = :me AND f.work_order = dockets.work_order) AS followed,
  (SELECT count(*) FROM task_cards t WHERE t.to_user = :me AND t.work_order = dockets.work_order AND t.status = 'open') AS my_open_notes`;

const HISTORY_ORDER = `ORDER BY ${WO_DESC}`;

/** Tiny named-parameter builder: D1 only supports positional `?`. */
export class Sql {
  private params: unknown[] = [];
  constructor(private named: Record<string, unknown>) {}
  render(sql: string): string {
    return sql.replace(/:(\w+)/g, (_, k: string) => {
      this.params.push(this.named[k]);
      return "?";
    });
  }
  bind(db: D1Database, sql: string): D1PreparedStatement {
    this.params = [];
    const text = this.render(sql);
    return db.prepare(text).bind(...this.params);
  }
}

/** Production order; roles outside it (General) go last. */
const rank = (id: string) => {
  const i = ROLE_ORDER.indexOf(id as (typeof ROLE_ORDER)[number]);
  return i < 0 ? ROLE_ORDER.length : i;
};
const sortAreas = (ids: string[]) => ids.sort((a, b) => rank(a) - rank(b));

export function parseHolders(raw: unknown): Holder[] {
  if (typeof raw !== "string" || raw === "") return [];
  const by = new Map<string, string[]>();
  for (const row of raw.split("")) {
    const [roleId, name = ""] = row.split("");
    const names = by.get(roleId) ?? [];
    if (name && !names.includes(name)) names.push(name);
    by.set(roleId, names);
  }
  return sortAreas([...by.keys()]).map((roleId) => ({ roleId, names: by.get(roleId)! }));
}

function toSummary(r: Row, today: string): DocketSummary {
  const dueIso = (r.due_iso as string) ?? null;
  const { bucket, overdue } = deriveTimeBucket(dueIso, r.due_rush === 1, today);
  const readySince = (r.ready_since as string) ?? null;
  const section: DashSection = r.new_order_flag === 1 ? "new_orders" : readySince ? "daily_complete" : bucket;
  return {
    workOrder: r.work_order,
    customer: (r.customer as string) ?? null,
    project: (r.project as string) ?? null,
    accountManager: (r.account_manager as string) ?? null,
    dateIso: (r.date_iso as string) ?? null,
    dueIso,
    dueRaw: (r.due_raw as string) ?? null,
    status: r.status as DocketSummary["status"],
    billing: r.billing as DocketSummary["billing"],
    bucket,
    section,
    readySince,
    overdue,
    vendorPickup: r.vendor_pickup === 1,
    areas: typeof r.areas === "string" ? sortAreas(r.areas.split(",")) : [],
    productionDone: r.production_done === 1,
    holders: parseHolders(r.holders),
    ...(r.followed === undefined ? {} : { followed: r.followed === 1, myOpenNotes: Number(r.my_open_notes) || 0 }),
  };
}

function commonFilters(where: string[], named: Record<string, unknown>, am?: string, q?: string): void {
  if (am) {
    where.push("account_manager = :am");
    named.am = am.trim().toUpperCase();
  }
  const term = q?.trim();
  if (term) {
    where.push("(work_order LIKE :woPrefix OR customer LIKE :like OR project LIKE :like OR address LIKE :like)");
    named.woPrefix = `${term}%`;
    named.like = `%${term}%`;
  }
}

const pageOf = (p?: number) => (p && p > 0 ? Math.floor(p) : 1);

export async function listDockets(db: D1Database, p: DocketQuery, now: Date): Promise<DocketListResponse> {
  const today = todayInBusinessTz(now);
  const named: Record<string, unknown> = { today };
  const where = [VIEW_SQL[p.view]];
  if (p.view === "history" && p.history === "completed") where.push("status = 'completed'");
  if (p.view === "history" && p.history === "cancelled") where.push("status = 'cancelled'");
  commonFilters(where, named, p.am, p.q);
  // J is stored trimmed and upper case by the sync (normalizeAccountManager).
  if (p.codes) where.push(codesIn(p.codes, named));
  named.me = p.viewerId ?? null;
  if (p.followed) where.push("work_order IN (SELECT work_order FROM docket_follows WHERE user_id = :me)");
  if (p.focus && p.viewerId !== undefined) {
    Object.assign(named, personalParams(p.viewerId, now));
    where.push(p.focus === "risk" ? AT_RISK_DUE : `work_order IN (${WAITING_WORK_ORDERS})`);
  }
  // Each docket's section is computed once; the outer queries read it like a column.
  // History has no sections: it skips the per-docket subqueries (D1 rows read).
  const flags =
    p.view === "history" ? "0 AS new_order_flag, NULL AS ready_since" : `${NEW_ORDER_SQL} AS new_order_flag, ${READY_SINCE_SQL} AS ready_since`;
  const withSections = `WITH base AS (SELECT *, ${flags} FROM dockets WHERE ${where.join(" AND ")}),
    sec AS (SELECT *, ${SECTION_SQL} AS section FROM base)`;
  const listWhere = p.bucket ? "section = :section" : "1";
  named.section = p.bucket ?? null;
  const page = pageOf(p.page);
  named.limit = PAGE_SIZE;
  named.offset = (page - 1) * PAGE_SIZE;
  const order = p.view === "history" ? HISTORY_ORDER : SECTION_ORDER[p.bucket ?? "all"];

  const sql = new Sql(named);
  const [countsRes, totalRes, listRes] = await db.batch([
    sql.bind(db, `${withSections} SELECT section, count(*) AS n FROM sec GROUP BY section`),
    sql.bind(db, `${withSections} SELECT count(*) AS n FROM sec WHERE ${listWhere}`),
    sql.bind(
      db,
      `${withSections} SELECT *, ${VENDOR_PICKUP_SQL} AS vendor_pickup, ${AREAS_SQL} AS areas, ${HOLDERS_SQL} AS holders,
         ${PRODUCTION_DONE_SQL} AS production_done${p.viewerId === undefined ? "" : `, ${MARKS_SQL}`} FROM sec AS dockets WHERE ${listWhere} ${order} LIMIT :limit OFFSET :offset`,
    ),
  ]);
  const counts: Record<DashSection, number> = { rush_today: 0, upcoming: 0, new_orders: 0, no_due_date: 0, daily_complete: 0 };
  for (const r of countsRes.results as { section: DashSection; n: number }[]) counts[r.section] = Number(r.n);
  return {
    items: (listRes.results as Row[]).map((r) => toSummary(r, today)),
    total: Number((totalRes.results[0] as { n: number }).n),
    page,
    pageSize: PAGE_SIZE,
    counts,
  };
}

export async function listNonBilled(db: D1Database, p: NonBilledQuery, now: Date): Promise<Page<NonBilledItem>> {
  const today = todayInBusinessTz(now);
  const named: Record<string, unknown> = { today };
  const where = [
    "billing = 'not_billed'",
    p.tab === "ready" ? "status = 'completed'" : "status IN ('active', 'on_hold')",
  ];
  commonFilters(where, named, p.am, p.q);
  const page = pageOf(p.page);
  named.limit = PAGE_SIZE;
  named.offset = (page - 1) * PAGE_SIZE;
  const w = where.join(" AND ");
  const age = "CAST(julianday(:today) - julianday(date_iso) AS INTEGER)";
  const sql = new Sql(named);
  const [totalRes, listRes] = await db.batch([
    sql.bind(db, `SELECT count(*) AS n FROM dockets WHERE ${w}`),
    sql.bind(
      db,
      `SELECT *, ${age} AS age_days FROM dockets WHERE ${w}
       ORDER BY age_days IS NULL, age_days DESC, CAST(work_order AS INTEGER) DESC LIMIT :limit OFFSET :offset`,
    ),
  ]);
  return {
    items: (listRes.results as Row[]).map((r) => ({
      ...toSummary(r, today),
      ageDays: r.age_days == null ? null : Number(r.age_days),
    })),
    total: Number((totalRes.results[0] as { n: number }).n),
    page,
    pageSize: PAGE_SIZE,
  };
}

export async function getDocket(db: D1Database, wo: string, now: Date, viewerId?: number): Promise<DocketDetail | null> {
  const marks = viewerId === undefined ? "" : `, ${MARKS_SQL}`;
  const r = await new Sql({ me: viewerId ?? null, wo })
    .bind(
      db,
      `SELECT *, ${HOLDERS_SQL} AS holders, ${NEW_ORDER_SQL} AS new_order_flag, ${READY_SINCE_SQL} AS ready_since${marks}
       FROM dockets WHERE work_order = :wo`,
    )
    .first<Row>();
  if (!r) return null;
  const s = (k: string) => (r[k] as string) ?? null;
  return {
    ...toSummary(r, todayInBusinessTz(now)),
    sheetRow: Number(r.sheet_row),
    dateRaw: s("date_raw"),
    comp: r.comp === 1,
    hold: r.hold === 1,
    seq: s("seq"),
    address: s("address"),
    roleNote: s("role_note"),
    inv: r.inv === 1,
    invDateRaw: s("inv_date_raw"),
    quotePo: s("quote_po"),
    notes: s("notes"),
    link: s("link"),
    syncedAt: String(r.synced_at),
  };
}

export async function listReview(db: D1Database): Promise<ReviewItemDTO[]> {
  const { results } = await db
    .prepare("SELECT kind, work_order, sheet_row, raw_json FROM review_items ORDER BY kind, work_order, sheet_row")
    .all<{ kind: ReviewItemDTO["kind"]; work_order: string | null; sheet_row: number; raw_json: string }>();
  const groups = new Map<string, ReviewItemDTO>();
  for (const r of results) {
    const key = r.kind === "duplicate_work_order" ? `d:${r.work_order}` : `i:${r.sheet_row}`;
    const g = groups.get(key) ?? { kind: r.kind, workOrder: r.work_order, rows: [] };
    g.rows.push({ sheetRow: r.sheet_row, values: JSON.parse(r.raw_json) as unknown[] });
    groups.set(key, g);
  }
  return [...groups.values()];
}

export async function listAccountManagers(db: D1Database): Promise<AccountManagerCount[]> {
  const { results } = await db
    .prepare(
      `SELECT account_manager, count(*) AS n FROM dockets WHERE account_manager IS NOT NULL
       GROUP BY account_manager ORDER BY n DESC, account_manager`,
    )
    .all<{ account_manager: string; n: number }>();
  return results.map((r) => ({ accountManager: r.account_manager, count: Number(r.n) }));
}
