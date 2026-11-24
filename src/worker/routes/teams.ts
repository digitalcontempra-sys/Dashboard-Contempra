import { Hono } from "hono";
import type { TeamDTO } from "../../shared/types";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";

/** Installer crews. Everyone reads them (the Send to list); only an Admin changes them. */
export const teamRoutes = new Hono<AppEnv>();
// "/teams/*" would also match "/teams", so the admin check is per method.
teamRoutes.use("/teams", requireAuth);
teamRoutes.use("/teams/*", requireAuth);
teamRoutes.on(["POST"], "/teams", requireLevel("admin"));
teamRoutes.on(["PUT", "DELETE"], "/teams/:id", requireLevel("admin"));

const TEAM_ROLE = "installer";

class TeamError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

async function listTeams(db: D1Database, id?: number): Promise<TeamDTO[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.role_id, u.id AS user_id, u.full_name FROM teams t
       LEFT JOIN team_members m ON m.team_id = t.id LEFT JOIN users u ON u.id = m.user_id AND u.active = 1
       WHERE ?1 IS NULL OR t.id = ?1
       ORDER BY t.name COLLATE NOCASE, u.full_name COLLATE NOCASE`,
    )
    .bind(id ?? null)
    .all<{ id: number; name: string; role_id: string; user_id: number | null; full_name: string | null }>();
  const teams = new Map<number, TeamDTO>();
  for (const r of results) {
    const t = teams.get(r.id) ?? { id: r.id, name: r.name, roleId: r.role_id, members: [] };
    if (r.user_id !== null) t.members.push({ id: r.user_id, fullName: r.full_name ?? "" });
    teams.set(r.id, t);
  }
  return [...teams.values()];
}

/** A name and at least one active installer. */
async function validate(db: D1Database, body: unknown): Promise<{ name: string; memberIds: number[] }> {
  const b = (body && typeof body === "object" ? body : {}) as { name?: unknown; memberIds?: unknown };
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : "";
  if (!name) throw new TeamError(400, "Enter a team name.");
  const ids = Array.isArray(b.memberIds) ? [...new Set(b.memberIds.filter((x): x is number => Number.isInteger(x)))] : [];
  if (ids.length === 0) throw new TeamError(400, "Choose at least one member.");
  const { results } = await db
    .prepare(
      `SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role_id = ?
       WHERE u.active = 1 AND u.id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(TEAM_ROLE, ...ids)
    .all<{ id: number }>();
  if (results.length !== ids.length) throw new TeamError(400, "Only installers can be in a team.");
  return { name, memberIds: ids };
}

async function assertNameFree(db: D1Database, name: string, exceptId: number | null): Promise<void> {
  const taken = await db
    .prepare("SELECT 1 FROM teams WHERE name = ? COLLATE NOCASE AND id != ?")
    .bind(name, exceptId ?? -1)
    .first();
  if (taken) throw new TeamError(409, "A team with that name already exists.");
}

const membersStmts = (db: D1Database, id: number, memberIds: number[]) => [
  db.prepare("DELETE FROM team_members WHERE team_id = ?").bind(id),
  ...memberIds.map((u) => db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").bind(id, u)),
];

teamRoutes.onError((e, c) => {
  if (e instanceof TeamError) return c.json({ error: e.message }, e.status);
  throw e;
});

teamRoutes.get("/teams", async (c) => c.json(await listTeams(c.env.DB)));

teamRoutes.post("/teams", async (c) => {
  const db = c.env.DB;
  const t = await validate(db, await c.req.json().catch(() => null));
  await assertNameFree(db, t.name, null);
  const row = await db
    .prepare("INSERT INTO teams (name, role_id, created_at) VALUES (?, ?, ?) RETURNING id")
    .bind(t.name, TEAM_ROLE, new Date().toISOString())
    .first<{ id: number }>();
  await db.batch(membersStmts(db, row!.id, t.memberIds));
  return c.json((await listTeams(db, row!.id))[0]);
});

const teamId = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw new TeamError(404, "Team not found");
  return id;
};

teamRoutes.put("/teams/:id", async (c) => {
  const db = c.env.DB;
  const id = teamId(c.req.param("id"));
  if (!(await db.prepare("SELECT 1 FROM teams WHERE id = ?").bind(id).first())) throw new TeamError(404, "Team not found");
  const t = await validate(db, await c.req.json().catch(() => null));
  await assertNameFree(db, t.name, id);
  await db.batch([db.prepare("UPDATE teams SET name = ? WHERE id = ?").bind(t.name, id), ...membersStmts(db, id, t.memberIds)]);
  return c.json((await listTeams(db, id))[0]);
});

/** Open cards of a deleted team keep their people; they only lose the team label. */
teamRoutes.delete("/teams/:id", async (c) => {
  const id = teamId(c.req.param("id"));
  const r = await c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(id).run();
  if (r.meta.changes === 0) throw new TeamError(404, "Team not found");
  return c.json({ ok: true });
});
