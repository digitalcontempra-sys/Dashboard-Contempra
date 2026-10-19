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
