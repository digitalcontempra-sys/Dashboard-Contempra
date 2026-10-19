import { deriveTimeBucket, todayInBusinessTz, weekEnd, type TimeBucket } from "../../shared/rules";
import {
  PAGE_SIZE,
  type AccountManagerCount,
  type DocketDetail,
  type DocketListResponse,
  type DocketSummary,
  type DocketView,
  type HistoryFilter,
  type NonBilledItem,
  type NonBilledTab,
  type Page,
  type ReviewItemDTO,
} from "../../shared/types";

export type DocketQuery = {
  view: DocketView;
  history?: HistoryFilter;
  bucket?: TimeBucket;
  am?: string;
  q?: string;
  page?: number;
};

export type NonBilledQuery = { tab: NonBilledTab; am?: string; q?: string; page?: number };

type Row = Record<string, unknown> & { work_order: string };

const BUCKET_SQL: Record<TimeBucket, string> = {
  rush_today: "(due_rush = 1 OR due_iso <= :today)",
  this_week: "(due_rush = 0 AND due_iso > :today AND due_iso <= :weekEnd)",
  coming: "(due_rush = 0 AND due_iso > :weekEnd)",
  no_due_date: "(due_rush = 0 AND due_iso IS NULL)",
};

const VIEW_SQL: Record<DocketView, string> = {
  active: "status = 'active'",
  on_hold: "status = 'on_hold'",
  history: "status IN ('completed', 'cancelled')",
};

const ACTIVE_ORDER =
  "ORDER BY (due_rush = 1 OR due_iso <= :today) DESC, due_rush DESC, due_iso IS NULL, due_iso ASC, CAST(work_order AS INTEGER) DESC";
const HISTORY_ORDER = "ORDER BY CAST(work_order AS INTEGER) DESC";

/** Tiny named-parameter builder: D1 only supports positional `?`. */
class Sql {
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

function toSummary(r: Row, today: string): DocketSummary {
  const dueIso = (r.due_iso as string) ?? null;
  const { bucket, overdue } = deriveTimeBucket(dueIso, r.due_rush === 1, today);
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
    overdue,
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
  const named: Record<string, unknown> = { today, weekEnd: weekEnd(today) };
  const where = [VIEW_SQL[p.view]];
  if (p.view === "history" && p.history === "completed") where.push("status = 'completed'");
  if (p.view === "history" && p.history === "cancelled") where.push("status = 'cancelled'");
  commonFilters(where, named, p.am, p.q);
  const baseWhere = where.join(" AND ");

  const countsSql = `SELECT
    ${(Object.keys(BUCKET_SQL) as TimeBucket[]).map((b) => `SUM(CASE WHEN ${BUCKET_SQL[b]} THEN 1 ELSE 0 END) AS ${b}`).join(", ")}
    FROM dockets WHERE ${baseWhere}`;
  const listWhere = p.bucket ? `${baseWhere} AND ${BUCKET_SQL[p.bucket]}` : baseWhere;
  const page = pageOf(p.page);
  named.limit = PAGE_SIZE;
  named.offset = (page - 1) * PAGE_SIZE;
  const order = p.view === "history" ? HISTORY_ORDER : ACTIVE_ORDER;

  const sql = new Sql(named);
  const [countsRes, totalRes, listRes] = await db.batch([
    sql.bind(db, countsSql),
    sql.bind(db, `SELECT count(*) AS n FROM dockets WHERE ${listWhere}`),
    sql.bind(db, `SELECT * FROM dockets WHERE ${listWhere} ${order} LIMIT :limit OFFSET :offset`),
  ]);
  const c = (countsRes.results[0] ?? {}) as Record<TimeBucket, number | null>;
  return {
    items: (listRes.results as Row[]).map((r) => toSummary(r, today)),
    total: Number((totalRes.results[0] as { n: number }).n),
    page,
    pageSize: PAGE_SIZE,
    counts: {
      rush_today: Number(c.rush_today ?? 0),
      this_week: Number(c.this_week ?? 0),
      coming: Number(c.coming ?? 0),
      no_due_date: Number(c.no_due_date ?? 0),
    },
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

export async function getDocket(db: D1Database, wo: string, now: Date): Promise<DocketDetail | null> {
  const r = await db.prepare("SELECT * FROM dockets WHERE work_order = ?").bind(wo).first<Row>();
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
