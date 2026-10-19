import { Hono } from "hono";
import type { AccessLevel, RoleDTO, UserDTO } from "../../shared/types";
import type { AppEnv } from "../app";
import { hashPassword, isValidPassword, PASSWORD_ERROR } from "../auth/password";
import { deleteUserSessions, requireAuth, requireLevel } from "../auth/sessions";

const LEVELS: AccessLevel[] = ["admin", "manager", "staff"];

export const userRoutes = new Hono<AppEnv>();
userRoutes.use("/roles", requireAuth);
userRoutes.use("/users", requireAuth, requireLevel("admin"));
userRoutes.use("/users/*", requireAuth, requireLevel("admin"));

class BadRequest extends Error {}

async function listRoles(db: D1Database): Promise<RoleDTO[]> {
  const { results } = await db.prepare("SELECT id, label FROM roles ORDER BY sort").all<RoleDTO>();
  return results;
}

async function validateRoles(db: D1Database, roles: unknown): Promise<string[]> {
  if (!Array.isArray(roles)) throw new BadRequest("Roles must be a list");
  const known = new Set((await listRoles(db)).map((r) => r.id));
  for (const r of roles) if (!known.has(r)) throw new BadRequest(`Unknown role: ${r}`);
  return [...new Set(roles as string[])];
}

function validateLevel(level: unknown): AccessLevel {
  if (!LEVELS.includes(level as AccessLevel)) throw new BadRequest("Access level must be admin, manager or staff");
  return level as AccessLevel;
}

async function getUser(db: D1Database, id: number): Promise<UserDTO | null> {
  const u = await db
    .prepare("SELECT id, username, full_name, access_level, active FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: number; username: string; full_name: string; access_level: AccessLevel; active: number }>();
  if (!u) return null;
  const { results } = await db
    .prepare("SELECT ur.role_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.sort")
    .bind(id)
    .all<{ role_id: string }>();
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    accessLevel: u.access_level,
    roles: results.map((r) => r.role_id),
    active: u.active === 1,
  };
}

function roleStatements(db: D1Database, userId: number, roles: string[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(userId),
    ...roles.map((r) => db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, r)),
  ];
}

userRoutes.onError((e, c) => {
  if (e instanceof BadRequest) return c.json({ error: e.message }, 400);
  throw e;
});

userRoutes.get("/roles", async (c) => c.json(await listRoles(c.env.DB)));

userRoutes.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id FROM users ORDER BY active DESC, full_name COLLATE NOCASE").all<{
    id: number;
  }>();
  const users = await Promise.all(results.map((r) => getUser(c.env.DB, r.id)));
  return c.json(users.filter(Boolean));
});

userRoutes.post("/users", async (c) => {
  const db = c.env.DB;
  const b = await c.req.json<Record<string, unknown>>();
  const username = String(b.username ?? "").trim();
  const fullName = String(b.fullName ?? "").trim();
  if (!username || !fullName) throw new BadRequest("Username and full name are required");
  const level = validateLevel(b.accessLevel);
  const roles = await validateRoles(db, b.roles ?? []);
  if (!isValidPassword(b.password)) throw new BadRequest(PASSWORD_ERROR);
  const dup = await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first();
  if (dup) return c.json({ error: "Username already exists" }, 409);
  const created = await db
    .prepare(
      "INSERT INTO users (username, full_name, access_level, password_hash, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(username, fullName, level, await hashPassword(b.password), new Date().toISOString())
    .first<{ id: number }>();
  await db.batch(roleStatements(db, created!.id, roles));
  return c.json(await getUser(db, created!.id));
});

userRoutes.patch("/users/:id", async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const current = await getUser(db, id);
  if (!current) return c.json({ error: "User not found" }, 404);
  const b = await c.req.json<Record<string, unknown>>();
  const isSelf = id === c.get("user").id;
  if (isSelf && (b.active === false || (b.accessLevel !== undefined && b.accessLevel !== "admin"))) {
    throw new BadRequest("You cannot remove your own admin access");
  }
  const stmts: D1PreparedStatement[] = [];
  if (b.fullName !== undefined) {
    const fullName = String(b.fullName).trim();
    if (!fullName) throw new BadRequest("Full name is required");
    stmts.push(db.prepare("UPDATE users SET full_name = ? WHERE id = ?").bind(fullName, id));
  }
  if (b.accessLevel !== undefined) {
    stmts.push(db.prepare("UPDATE users SET access_level = ? WHERE id = ?").bind(validateLevel(b.accessLevel), id));
  }
  if (b.roles !== undefined) stmts.push(...roleStatements(db, id, await validateRoles(db, b.roles)));
  if (b.active !== undefined) {
    stmts.push(db.prepare("UPDATE users SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, id));
    if (!b.active) stmts.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  }
  if (stmts.length) await db.batch(stmts);
  return c.json(await getUser(db, id));
});

userRoutes.post("/users/:id/reset-password", async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  if (!(await getUser(db, id))) return c.json({ error: "User not found" }, 404);
  const { password } = await c.req.json<{ password?: unknown }>();
  if (!isValidPassword(password)) throw new BadRequest(PASSWORD_ERROR);
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), id).run();
  await deleteUserSessions(db, id);
  return c.json({ ok: true });
});
