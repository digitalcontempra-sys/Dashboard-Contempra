import { Hono } from "hono";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import { dashboardSummary } from "../dashboard/summary";
import { cachedJson, timeSlot } from "../http/etag";

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use("/dashboard/*", requireAuth, requireLevel("admin", "manager"));

/** Main Dashboard header: the viewer's personal cards and the shop's open cards per area. */
dashboardRoutes.get("/dashboard/summary", async (c) => {
  const now = new Date();
  // Overdue and "untouched for" rules age with the clock: recompute at least every five minutes.
  return cachedJson(c, [timeSlot(now)], () => dashboardSummary(c.env.DB, c.get("user").id, now));
});
