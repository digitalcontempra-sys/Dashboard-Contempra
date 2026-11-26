import { Hono } from "hono";
import { DASH_SECTIONS } from "../../shared/rules";
import type { DocketView, HistoryFilter, NonBilledTab } from "../../shared/types";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import { userCodes } from "../users/codes";
import { getDocket, listAccountManagers, listDockets, listNonBilled, listReview } from "../db/dockets";

const VIEWS: DocketView[] = ["active", "on_hold", "history"];
const HISTORY: HistoryFilter[] = ["all", "completed", "cancelled"];
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
  const bucket = pick(q.bucket, DASH_SECTIONS);
  if (view === null || history === null || bucket === null) return c.json({ error: "Invalid filter" }, 400);
  // My Dockets: the dockets whose J is one of my codes.
  const me = c.get("user").id;
  const codes = q.mine === "1" ? await userCodes(c.env.DB, me) : undefined;
  // My List: the dockets I follow.
  const followed = q.list === "1";
  return c.json(
    await listDockets(
      c.env.DB,
      { view: view!, history, bucket, am: q.am, q: q.q, page: Number(q.page) || 1, codes, viewerId: me, followed },
      new Date(),
    ),
  );
});

docketRoutes.get("/dockets/:wo", async (c) => {
  const d = await getDocket(c.env.DB, c.req.param("wo"), new Date(), c.get("user").id);
  return d ? c.json(d) : c.json({ error: "Work order not found" }, 404);
});

// My List: follow or unfollow a docket. Personal; nothing else changes on the docket.
docketRoutes.put("/dockets/:wo/follow", async (c) => {
  const wo = c.req.param("wo");
  const exists = await c.env.DB.prepare("SELECT 1 FROM dockets WHERE work_order = ?").bind(wo).first();
  if (!exists) return c.json({ error: "Work order not found" }, 404);
  await c.env.DB.prepare("INSERT OR IGNORE INTO docket_follows (user_id, work_order, added_at) VALUES (?, ?, ?)")
    .bind(c.get("user").id, wo, new Date().toISOString())
    .run();
  return c.json({ followed: true });
});

docketRoutes.delete("/dockets/:wo/follow", async (c) => {
  await c.env.DB.prepare("DELETE FROM docket_follows WHERE user_id = ? AND work_order = ?").bind(c.get("user").id, c.req.param("wo")).run();
  return c.json({ followed: false });
});

docketRoutes.get("/non-billed", async (c) => {
  const q = c.req.query();
  const tab = pick(q.tab, TABS, "ready");
  if (tab === null) return c.json({ error: "Invalid filter" }, 400);
  return c.json(await listNonBilled(c.env.DB, { tab: tab!, am: q.am, q: q.q, page: Number(q.page) || 1 }, new Date()));
});

docketRoutes.get("/needs-review", async (c) => c.json(await listReview(c.env.DB)));

docketRoutes.get("/account-managers", async (c) => c.json(await listAccountManagers(c.env.DB)));
