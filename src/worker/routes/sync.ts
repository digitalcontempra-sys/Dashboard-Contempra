import { Hono } from "hono";
import type { SyncStatus } from "../../shared/types";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import { isSheetConfigured, runSync } from "../sync/syncDockets";

export const syncRoutes = new Hono<AppEnv>();

// Registered before auth so production never reveals the route exists.
syncRoutes.use("/dev/*", async (c, next) => (c.env.ENVIRONMENT === "development" ? next() : c.notFound()));
syncRoutes.use("/dev/*", requireAuth, requireLevel("admin"));
syncRoutes.use("/sync/*", requireAuth);

syncRoutes.post("/dev/import", async (c) => {
  const { values } = await c.req.json<{ values: unknown[][] }>();
  return c.json(await runSync(c.env, values));
});

syncRoutes.get("/sync/status", requireLevel("admin", "manager"), async (c) => {
  const s = await c.env.DB.prepare("SELECT * FROM sync_state WHERE id = 1").first<Record<string, string | number | null>>();
  const status: SyncStatus = {
    lastRunAt: (s?.last_run_at as string) ?? null,
    lastSuccessAt: (s?.last_success_at as string) ?? null,
    lastError: (s?.last_error as string) ?? null,
    rowsSeen: Number(s?.rows_seen ?? 0),
    rowsChanged: Number(s?.rows_changed ?? 0),
    rowsDeleted: Number(s?.rows_deleted ?? 0),
    configured: isSheetConfigured(c.env),
  };
  return c.json(status);
});

syncRoutes.post("/sync/run", requireLevel("admin"), async (c) => c.json(await runSync(c.env)));
