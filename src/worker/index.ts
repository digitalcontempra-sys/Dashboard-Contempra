import { Hono } from "hono";
import type { AppEnv } from "./app";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { cardRoutes } from "./routes/cards";
import { docketRoutes } from "./routes/dockets";
import { googleRoutes } from "./routes/google";
import { staffImportRoutes } from "./routes/staffImport";
import { syncRoutes } from "./routes/sync";
import { taskCardRoutes } from "./routes/taskCards";
import { userRoutes } from "./routes/users";
import { virtualDocketRoutes } from "./routes/virtualDockets";
import { purgeTrash } from "./dockets/service";
import { retryPendingDrive } from "./dockets/pdf";
import { retryCardSheet } from "./cards/sheetSync";
import { runIncrementalSync } from "./sync/incremental";
import { runNightlyReconcile } from "./sync/nightly";
import { isSheetConfigured, recordFailure } from "./sync/syncDockets";
import { getConnection, GoogleDisconnectedError } from "./google/oauth";

/** 08:00 UTC = 3 AM Winnipeg (CDT). Must match wrangler.jsonc triggers. */
export const NIGHTLY_CRON = "0 8 * * *";

export const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);
app.route("/", syncRoutes);
app.route("/", userRoutes);
app.route("/", staffImportRoutes);
app.route("/", taskCardRoutes);
app.route("/", docketRoutes);
app.route("/", googleRoutes);
app.route("/", cardRoutes);
app.route("/", virtualDocketRoutes);

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    // No sheet configured yet (e.g. a trial deploy loaded from an export): nothing to sync.
    if (controller.cron === NIGHTLY_CRON) ctx.waitUntil(purgeTrash(env));
    if (!(await isSheetConfigured(env))) {
      // Say why sync stopped, so the dashboard banner explains it.
      const conn = await getConnection(env.DB);
      if (conn?.status === "disconnected") {
        await recordFailure(env.DB, new Date().toISOString(), new GoogleDisconnectedError().message);
      }
      return;
    }
    ctx.waitUntil(
      controller.cron === NIGHTLY_CRON
        ? runNightlyReconcile(env)
        : runIncrementalSync(env)
            .then(() => retryPendingDrive(env))
            .then(() => retryCardSheet(env)),
    );
  },
} satisfies ExportedHandler<Env>;
