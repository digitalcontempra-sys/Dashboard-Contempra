import { env } from "cloudflare:workers";
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../../src/worker/index";

it("the cron trigger runs a sync and records its outcome", async () => {
  const ctx = createExecutionContext();
  await worker.scheduled!(createScheduledController({ cron: "* * * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
  const s = await env.DB.prepare("SELECT last_run_at, last_error FROM sync_state WHERE id = 1").first<{
    last_run_at: string | null;
    last_error: string | null;
  }>();
  expect(s?.last_run_at).toBeTruthy();
  expect(s?.last_error).toBeTruthy(); // test env has no real Google credentials
});
