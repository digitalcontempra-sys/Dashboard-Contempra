import { Hono } from "hono";
import { STAFF_ROSTER } from "../../shared/staffRoster";
import type { AppEnv } from "../app";
import { hashPassword, isValidPassword, PASSWORD_ERROR } from "../auth/password";
import { requireAuth, requireLevel } from "../auth/sessions";

export type ImportPreviewRow = (typeof STAFF_ROSTER)[number] & { exists: boolean };

export const staffImportRoutes = new Hono<AppEnv>();
staffImportRoutes.use("/admin/import-staff", requireAuth, requireLevel("admin"));

async function existing(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT username FROM users").all<{ username: string }>();
  return new Set(results.map((r) => r.username.toLowerCase()));
}

staffImportRoutes.get("/admin/import-staff", async (c) => {
  const have = await existing(c.env.DB);
  const rows: ImportPreviewRow[] = STAFF_ROSTER.map((p) => ({ ...p, exists: have.has(p.username) }));
  return c.json(rows);
});

/**
 * Creates every roster account that does not exist yet, all with the same temporary password,
 * which each person must replace at first sign-in. The password is hashed once (PBKDF2 is costly
 * and the free plan limits CPU per request).
 */
staffImportRoutes.post("/admin/import-staff", async (c) => {
  const db = c.env.DB;
  const b = await c.req.json<{ tempPassword?: unknown }>().catch(() => ({}) as { tempPassword?: unknown });
  if (!isValidPassword(b.tempPassword)) return c.json({ error: PASSWORD_ERROR }, 400);
  const have = await existing(db);
  const todo = STAFF_ROSTER.filter((p) => !have.has(p.username));
  const skipped = STAFF_ROSTER.filter((p) => have.has(p.username)).map((p) => p.username);
  if (todo.length === 0) return c.json({ created: [], skipped });

  const hash = await hashPassword(b.tempPassword);
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const p of todo) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO users (username, full_name, access_level, password_hash, created_at, must_change_password)
           VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT (username) DO NOTHING`,
        )
        .bind(p.username, p.fullName, p.accessLevel, hash, now),
    );
    for (const r of p.roles) {
      stmts.push(
        db
          .prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT id, ? FROM users WHERE username = ?")
          .bind(r, p.username),
      );
    }
  }
  await db.batch(stmts);
  return c.json({ created: todo.map((p) => p.username), skipped });
});
