import { Hono } from "hono";
import type { AppEnv } from "../app";
import { hashPassword, isValidPassword, PASSWORD_ERROR, verifyPassword } from "../auth/password";
import { createSession, destroySession, loadUser, requireAuth } from "../auth/sessions";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/setup", async (c) => {
  const b = await c.req.json<{ setupToken?: string; username?: string; fullName?: string; password?: string }>();
  const existing = await c.env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>();
  if (!c.env.SETUP_TOKEN || b.setupToken !== c.env.SETUP_TOKEN || existing!.n > 0) {
    return c.json({ error: "Not allowed" }, 403);
  }
  if (!b.username?.trim() || !b.fullName?.trim()) return c.json({ error: "Username and full name are required" }, 400);
  if (!isValidPassword(b.password)) return c.json({ error: PASSWORD_ERROR }, 400);
  await c.env.DB.prepare(
    "INSERT INTO users (username, full_name, access_level, password_hash, created_at) VALUES (?, ?, 'admin', ?, ?)",
  )
    .bind(b.username.trim(), b.fullName.trim(), await hashPassword(b.password), new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

authRoutes.post("/auth/login", async (c) => {
  const b = await c.req.json<{ username?: string; password?: string }>();
  const username = (b.username ?? "").trim();
  const db = c.env.DB;
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const fails = await db
    .prepare("SELECT count(*) AS n FROM login_attempts WHERE username = ? AND attempted_at > ?")
    .bind(username, since)
    .first<{ n: number }>();
  if (fails!.n >= MAX_FAILURES) return c.json({ error: "Too many attempts. Try again in 15 minutes." }, 429);

  const u = await db
    .prepare("SELECT id, password_hash FROM users WHERE username = ? AND active = 1")
    .bind(username)
    .first<{ id: number; password_hash: string }>();
  if (!u || !(await verifyPassword(b.password ?? "", u.password_hash))) {
    await db
      .prepare("INSERT INTO login_attempts (username, attempted_at) VALUES (?, ?)")
      .bind(username, new Date().toISOString())
      .run();
    return c.json({ error: "Invalid username or password" }, 401);
  }
  await db.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username).run();
  await createSession(c, u.id);
  return c.json(await loadUser(db, u.id));
});

authRoutes.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get("/auth/me", requireAuth, (c) => c.json(c.get("user")));
