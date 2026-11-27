import { env } from "cloudflare:workers";

/** Wraps a D1Database and sums `meta.rows_read` of every statement it runs (D1 free plan budget). */
export function meter(db: D1Database, log = false) {
  let rows = 0;
  const sqls: string[] = [];
  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (s: D1PreparedStatement): D1PreparedStatement => {
    const p = new Proxy(s, {
      get(t, k) {
        if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
        if (k === "all" || k === "run")
          return async () => {
            const r = await t.all();
            rows += r.meta.rows_read ?? 0;
            if (log) console.log(r.meta.rows_read, sqls.at(-1)?.slice(0, 90));
            return r;
          };
        if (k === "first")
          return async (col?: string) => {
            const r = await t.all<Record<string, unknown>>();
            rows += r.meta.rows_read ?? 0;
            if (log) console.log(r.meta.rows_read, sqls.at(-1)?.slice(0, 90));
            const row = r.results[0] ?? null;
            return col ? (row?.[col] ?? null) : row;
          };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    real.set(p, s);
    return p;
  };
  const proxy = {
    prepare: (q: string) => {
      sqls.push(q);
      return wrap(db.prepare(q));
    },
    batch: async (stmts: D1PreparedStatement[]) => {
      const rs = await db.batch(stmts.map((s) => real.get(s) ?? s));
      for (const r of rs) rows += r.meta.rows_read ?? 0;
      if (log) console.log("batch", rs.map((r) => r.meta.rows_read));
      return rs;
    },
  } as unknown as D1Database;
  return {
    db: proxy,
    sqls,
    read: () => rows,
    reset: () => {
      rows = 0;
      sqls.length = 0;
    },
  };
}

/** EXPLAIN QUERY PLAN lines of a query (placeholders bound to 1). */
export async function queryPlan(sql: string): Promise<string> {
  const n = sql.split("?").length - 1;
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...Array.from({ length: n }, () => 1))
    .all<{ detail: string }>();
  return results.map((r) => r.detail).join("\n");
}
