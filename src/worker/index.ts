import { Hono } from "hono";
import type { AppEnv } from "./app";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { docketRoutes } from "./routes/dockets";
import { syncRoutes } from "./routes/sync";
import { userRoutes } from "./routes/users";
import { runSync } from "./sync/syncDockets";

export const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);
app.route("/", syncRoutes);
app.route("/", userRoutes);
app.route("/", docketRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    // No sheet configured yet (e.g. a trial deploy loaded from an export): nothing to sync.
    if (!env.SHEET_ID?.trim()) return;
    ctx.waitUntil(runSync(env));
  },
} satisfies ExportedHandler<Env>;
