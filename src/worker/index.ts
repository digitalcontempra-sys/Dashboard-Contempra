import { Hono } from "hono";
import type { Env } from "./env";
import { runSync } from "./sync/syncDockets";

export const app = new Hono<{ Bindings: Env }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
} satisfies ExportedHandler<Env>;
