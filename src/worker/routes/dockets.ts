import { Hono } from "hono";
import type { TimeBucket } from "../../shared/rules";
import type { DocketView, HistoryFilter, NonBilledTab } from "../../shared/types";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import { getDocket, listAccountManagers, listDockets, listNonBilled, listReview } from "../db/dockets";

const VIEWS: DocketView[] = ["active", "on_hold", "history"];
const HISTORY: HistoryFilter[] = ["all", "completed", "cancelled"];
const BUCKETS: TimeBucket[] = ["rush_today", "this_week", "coming", "no_due_date"];
const TABS: NonBilledTab[] = ["ready", "open"];

function pick<T extends string>(value: string | undefined, allowed: T[], fallback?: T): T | undefined {
  if (value === undefined || value === "") return fallback;
  return allowed.includes(value as T) ? (value as T) : (null as unknown as T);
}

export const docketRoutes = new Hono<AppEnv>();
for (const p of ["/dockets", "/dockets/*", "/non-billed", "/needs-review", "/account-managers"]) {
  docketRoutes.use(p, requireAuth, requireLevel("admin", "manager"));
}

docketRoutes.get("/dockets", async (c) => {
  const q = c.req.query();
  const view = pick(q.view, VIEWS, "active");
  const history = pick(q.history, HISTORY, "all");
  const bucket = pick(q.bucket, BUCKETS);
  if (view === null || history === null || bucket === null) return c.json({ error: "Invalid filter" }, 400);
  return c.json(
    await listDockets(c.env.DB, { view: view!, history, bucket, am: q.am, q: q.q, page: Number(q.page) || 1 }, new Date()),
  );
});

docketRoutes.get("/dockets/:wo", async (c) => {
  const d = await getDocket(c.env.DB, c.req.param("wo"), new Date());
  return d ? c.json(d) : c.json({ error: "Work order not found" }, 404);
});

docketRoutes.get("/non-billed", async (c) => {
  const q = c.req.query();
  const tab = pick(q.tab, TABS, "ready");
  if (tab === null) return c.json({ error: "Invalid filter" }, 400);
  return c.json(await listNonBilled(c.env.DB, { tab: tab!, am: q.am, q: q.q, page: Number(q.page) || 1 }, new Date()));
});

docketRoutes.get("/needs-review", async (c) => c.json(await listReview(c.env.DB)));

docketRoutes.get("/account-managers", async (c) => c.json(await listAccountManagers(c.env.DB)));
