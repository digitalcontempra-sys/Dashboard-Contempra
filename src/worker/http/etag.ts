import type { Context } from "hono";
import type { AppEnv } from "../app";

/**
 * D1 free plan: the dashboard polls its list and summaries every 20-30 s. A polled JSON response
 * carries a weak ETag built from data_version (bumped by triggers on every table those views read,
 * migration 0015), the deploy, the viewer and the URL. The browser revalidates on its own
 * (`Cache-Control: private, no-cache`); while nothing changed the answer is a 304 that costs one
 * row read instead of running the queries again.
 *
 * `extra` adds anything else the response depends on: the Winnipeg date, or a time slot for rules
 * that age with the clock ("untouched for 24 h").
 */
export async function cachedJson<T>(c: Context<AppEnv>, extra: (string | number)[], compute: () => Promise<T>): Promise<Response> {
  const row = await c.env.DB.prepare("SELECT v FROM data_version WHERE id = 1").first<{ v: number }>();
  const deploy = c.env.CF_VERSION_METADATA?.id ?? "dev";
  const url = new URL(c.req.url);
  const key = [row?.v ?? 0, deploy, c.get("user").id, url.pathname + url.search, ...extra].join("|");
  const tag = `W/"${await shortHash(key)}"`;
  const headers = { ETag: tag, "Cache-Control": "private, no-cache" };
  const sent = c.req.header("if-none-match");
  if (sent && sent.split(",").some((t) => t.trim() === tag)) return new Response(null, { status: 304, headers });
  return c.json(await compute(), 200, headers);
}

/** Five-minute slot of `now`: summaries with rules that age with the clock are recomputed at most this often. */
export const timeSlot = (now: Date, minutes = 5) => Math.floor(now.getTime() / (minutes * 60_000));

async function shortHash(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
