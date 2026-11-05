import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { hashPassword } from "../../src/worker/auth/password";

export const BASE = "https://dash.test";

export async function resetAuthTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM user_roles"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM login_attempts"),
  ]);
}

export async function createUser(
  username: string,
  accessLevel: "admin" | "manager" | "staff",
  password = "password123",
): Promise<number> {
  const r = await env.DB.prepare(
    "INSERT INTO users (username, full_name, access_level, password_hash, created_at) VALUES (?,?,?,?,?) RETURNING id",
  )
    .bind(username, username, accessLevel, await hashPassword(password), new Date().toISOString())
    .first<{ id: number }>();
  return r!.id;
}

export function api(path: string, init: RequestInit & { cookie?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${BASE}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

/** Logs in and returns the `cd_session=...` cookie pair. */
export async function login(username: string, password = "password123"): Promise<string> {
  const res = await api("/api/auth/login", { method: "POST", json: { username, password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** A fixed 32-byte test key (base64) matching vitest.config.ts TOKEN_KEY. */
export const TEST_TOKEN_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

/** Stores a connected Google account for the sheet `test-sheet`. */
export async function seedConnection(opts: { status?: "connected" | "disconnected"; sheetId?: string | null } = {}) {
  const { encryptSecret } = await import("../../src/worker/google/crypto");
  await env.DB.prepare("DELETE FROM google_connection").run();
  await env.DB.prepare(
    `INSERT INTO google_connection (id, email, refresh_token_enc, sheet_id, sheet_gid, status, connected_at, connected_by)
     VALUES (1, 'owner@gmail.com', ?, ?, 0, ?, ?, 1)`,
  )
    .bind(
      await encryptSecret("refresh-1", TEST_TOKEN_KEY),
      opts.sheetId === undefined ? "test-sheet" : opts.sheetId,
      opts.status ?? "connected",
      new Date().toISOString(),
    )
    .run();
}

export async function clearConnection() {
  await env.DB.prepare("DELETE FROM google_connection").run();
}
