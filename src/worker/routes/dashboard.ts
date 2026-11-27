import { Hono } from "hono";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import { dashboardSummary } from "../dashboard/summary";

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use("/dashboard/*", requireAuth, requireLevel("admin", "manager"));

/** Main Dashboard header: the viewer's personal cards and the shop's open cards per area. */
dashboardRoutes.get("/dashboard/summary", async (c) => c.json(await dashboardSummary(c.env.DB, c.get("user").id, new Date())));
