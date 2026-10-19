import { Hono } from "hono";
import type { AppEnv } from "./app";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { syncRoutes } from "./routes/sync";
import { runSync } from "./sync/syncDockets";

export const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);
app.route("/", syncRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
} satisfies ExportedHandler<Env>;
