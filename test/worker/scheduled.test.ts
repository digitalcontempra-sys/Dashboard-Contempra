import { env } from "cloudflare:workers";
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import { __setGoogleFetch, _resetAccessTokenCache } from "../../src/worker/google/oauth";
import worker from "../../src/worker/index";
import { clearConnection, seedConnection } from "./helpers";

afterEach(() => __setGoogleFetch(null));

const state = () =>
  env.DB.prepare("SELECT last_run_at, last_error FROM sync_state WHERE id = 1").first<{
    last_run_at: string | null;
    last_error: string | null;
  }>();

it("the cron trigger runs a sync and records its outcome", async () => {
  await seedConnection();
  _resetAccessTokenCache();
  __setGoogleFetch(async () => new Response("down", { status: 503 }));
  const ctx = createExecutionContext();
  await worker.scheduled!(createScheduledController({ cron: "*/5 * * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
  const s = await state();
  expect(s?.last_run_at).toBeTruthy();
  expect(s?.last_error).toBeTruthy();
});

it("the cron trigger does nothing while no Google Sheet is configured", async () => {
  await clearConnection();
  await env.DB.prepare("UPDATE sync_state SET last_run_at = NULL, last_error = NULL WHERE id = 1").run();
  const ctx = createExecutionContext();
  await worker.scheduled!(createScheduledController({ cron: "*/5 * * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
  expect((await state())?.last_run_at).toBeNull();
});

it("the cron records why sync stopped when Google is disconnected", async () => {
  await seedConnection({ status: "disconnected" });
  await env.DB.prepare("UPDATE sync_state SET last_error = NULL WHERE id = 1").run();
  const ctx = createExecutionContext();
  await worker.scheduled!(createScheduledController({ cron: "*/5 * * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
  expect((await state())?.last_error).toBe("Google is disconnected. Ask an admin to reconnect.");
});
