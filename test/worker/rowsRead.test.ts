/**
 * D1 free plan: 5M rows read per day. These tests seed a production-sized mirror (11,648 dockets,
 * 533 active, one account manager with about 45% of them) and check what the hot paths read:
 * the dashboard list, the header summary and the account managers. Before migration 0015 the
 * list read about 2.7k rows per call, My Dockets 17.7k, the summary 6.8k, the account managers 11.6k.
 */
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dashboardSummary } from "../../src/worker/dashboard/summary";
import { listAccountManagers, listDockets, type DocketQuery } from "../../src/worker/db/dockets";
import { meter, queryPlan } from "./d1Meter";

const NOW = new Date("2026-11-27T18:00:00Z");
const AMS = ["JS", "KL", "RT", "AP", "DW", "SC", "LM", "TG", "HN", "PB", "EF", "QZ"];
let userId = 0;

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM dockets"),
    env.DB.prepare("DELETE FROM app_settings"),
    env.DB.prepare("DELETE FROM user_codes"),
    env.DB.prepare("DELETE FROM users"),
  ]);
  // The first 533 rows active, then 120 on hold, 384 cancelled, the rest completed; every tenth has a due date.
  await env.DB.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 11648)
     INSERT INTO dockets (work_order, sheet_row, date_iso, due_iso, due_rush, comp, hold, account_manager, customer, inv,
       status, billing, row_hash, synced_at)
     SELECT CAST(100000 - i AS TEXT), i + 1, date('2026-11-27', '-' || (i / 20) || ' days'),
       CASE WHEN i % 10 = 0 THEN '2026-11-2' || (i % 9) ELSE NULL END, 0, 0, 0,
       CASE WHEN i % 20 < 9 THEN 'MB' ELSE (SELECT value FROM json_each(?1) WHERE key = i % 12) END, 'Customer ' || i, 0,
       CASE WHEN i <= 533 THEN 'active' WHEN i <= 653 THEN 'on_hold' WHEN i <= 1037 THEN 'cancelled' ELSE 'completed' END,
       'billed', 'h' || i, 't' FROM n`,
  )
    .bind(JSON.stringify(AMS))
    .run();
  const u = await env.DB.prepare(
    "INSERT INTO users (username, full_name, access_level, password_hash, created_at) VALUES ('mb', 'MB', 'manager', 'x', 't') RETURNING id",
  ).first<{ id: number }>();
  userId = u!.id;
  await env.DB.prepare("INSERT INTO user_codes (code, user_id, sort) VALUES ('MB', ?, 0)").bind(userId).run();
});

afterAll(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM dockets"),
    env.DB.prepare("DELETE FROM app_settings"),
    env.DB.prepare("DELETE FROM user_codes"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

async function measureList(q: Omit<DocketQuery, "viewerId">) {
  const m = meter(env.DB);
  const r = await listDockets(m.db, { ...q, viewerId: userId }, NOW);
  return { rows: m.read(), sqls: [...m.sqls], r };
}

/** The plan of every statement must search dockets through an index, never walk the table. */
async function expectNoDocketScan(sqls: string[]) {
  for (const q of sqls) {
    const plan = await queryPlan(q);
    expect(plan, q).not.toMatch(/^SCAN (dockets|d)$/m);
    expect(plan, q).not.toMatch(/^SCAN (dockets|d) USING (?!COVERING )/m);
  }
}

describe("D1 rows read on the hot paths", () => {
  it("All dockets (the default view): one index entry per active docket, full rows for one page", async () => {
    const { rows, sqls, r } = await measureList({ view: "active" });
    expect(r.total).toBe(533);
    expect(r.items).toHaveLength(50);
    expect(rows).toBeLessThan(900);
    await expectNoDocketScan(sqls);
  });

  it("My Dockets reads only my active dockets", async () => {
    const { rows, sqls, r } = await measureList({ view: "active", codes: ["MB"] });
    expect(r.total).toBe(242);
    expect(rows).toBeLessThan(600);
    await expectNoDocketScan(sqls);
  });

  it("a section, an account manager, On Hold", async () => {
    expect((await measureList({ view: "active", bucket: "upcoming" })).rows).toBeLessThan(1300);
    expect((await measureList({ view: "active", am: "JS" })).rows).toBeLessThan(300);
    expect((await measureList({ view: "on_hold" })).rows).toBeLessThan(400);
  });

  it("History walks the newest work orders instead of sorting every closed docket", async () => {
    const { rows, r } = await measureList({ view: "history" });
    expect(r.items.map((i) => i.workOrder).slice(0, 2)).toEqual(["99346", "99345"]);
    expect(r.total).toBe(10995);
    expect(rows).toBeLessThan(12_500); // the count still reads one index entry per closed docket
  });

  it("the header summary", async () => {
    const m = meter(env.DB);
    await dashboardSummary(m.db, userId, NOW);
    expect(m.read()).toBeLessThan(400);
    await expectNoDocketScan(m.sqls);
  });

  it("account managers come from the cache after the first call", async () => {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = 'account_managers'").run();
    const first = await listAccountManagers(env.DB, NOW);
    expect(first[0]).toEqual({ accountManager: "MB", count: 5246 });
    const m = meter(env.DB);
    expect(await listAccountManagers(m.db, NOW)).toEqual(first);
    expect(m.read()).toBeLessThanOrEqual(1);
    // A day later it is counted again.
    const m2 = meter(env.DB);
    await listAccountManagers(m2.db, new Date(NOW.getTime() + 25 * 3_600_000));
    expect(m2.read()).toBeGreaterThan(10_000);
  });
});
