import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AccessLevel, SessionUser } from "../../shared/types";
import type { AppEnv } from "../app";

export const COOKIE = "cd_session";
const SESSION_DAYS = 30;

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function sha256Hex(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

export async function createSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)")
    .bind(await sha256Hex(token), userId, expires.toISOString(), now.toISOString())
    .run();
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", expires });
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, COOKIE, { path: "/", secure: true });
}

export async function deleteUserSessions(db: D1Database, userId: number): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

export async function loadUser(db: D1Database, userId: number): Promise<SessionUser | null> {
  const u = await db
    .prepare("SELECT id, username, full_name, access_level FROM users WHERE id = ? AND active = 1")
    .bind(userId)
    .first<{ id: number; username: string; full_name: string; access_level: AccessLevel }>();
  if (!u) return null;
  const { results } = await db
    .prepare(
      "SELECT ur.role_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.sort",
    )
    .bind(userId)
    .all<{ role_id: string }>();
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    accessLevel: u.access_level,
    roles: results.map((r) => r.role_id),
  };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (token) {
    const s = await c.env.DB.prepare("SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?")
      .bind(await sha256Hex(token), new Date().toISOString())
      .first<{ user_id: number }>();
    const user = s ? await loadUser(c.env.DB, s.user_id) : null;
    if (user) {
      c.set("user", user);
      return next();
    }
  }
  return c.json({ error: "Not signed in" }, 401);
};

export const requireLevel =
  (...levels: AccessLevel[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!levels.includes(c.get("user").accessLevel)) return c.json({ error: "Not allowed" }, 403);
    return next();
  };
