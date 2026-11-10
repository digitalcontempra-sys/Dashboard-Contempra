import { Hono, type Context } from "hono";
import { TASK_NOTE_MAX, taskBucket, type TaskDue, type TaskDueKind } from "../../shared/taskCards";
import { todayInBusinessTz } from "../../shared/rules";
import type { TaskCardDTO } from "../../shared/types";
import type { AppEnv } from "../app";
import { requireAuth } from "../auth/sessions";

type Row = {
  id: number;
  from_user: number;
  to_user: number;
  from_name: string;
  to_name: string;
  note: string;
  due_kind: TaskDueKind;
  due_date: string | null;
  status: "open" | "done";
  created_at: string;
  seen_at: string | null;
  done_at: string | null;
  done_seen_at: string | null;
};

const SELECT = `SELECT t.*, uf.full_name AS from_name, ut.full_name AS to_name FROM task_cards t
  JOIN users uf ON uf.id = t.from_user JOIN users ut ON ut.id = t.to_user`;
const SENT_DAYS = 30;
const KINDS: TaskDueKind[] = ["none", "rush", "today", "date"];

function toDto(r: Row, viewerId: number, today: string): TaskCardDTO {
  const due: TaskDue = r.due_kind === "date" ? { kind: "date", date: r.due_date ?? undefined } : { kind: r.due_kind };
  const inbox = r.to_user === viewerId;
  return {
    id: r.id,
    from: { id: r.from_user, name: r.from_name },
    to: { id: r.to_user, name: r.to_name },
    note: r.note,
    due,
    bucket: taskBucket({ kind: r.due_kind, date: r.due_date }, r.created_at, today),
    status: r.status,
    createdAt: r.created_at,
    doneAt: r.done_at,
    isNew: inbox ? r.status === "open" && !r.seen_at : r.status === "done" && !r.done_seen_at,
  };
}

const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

export const taskCardRoutes = new Hono<AppEnv>();
taskCardRoutes.use("/task-cards", requireAuth);
taskCardRoutes.use("/task-cards/*", requireAuth);

const bad = (c: Context<AppEnv>, msg: string) => c.json({ error: msg }, 400);

taskCardRoutes.post("/task-cards", async (c) => {
  const me = c.get("user");
  const b = await c.req.json<{ toUserId?: unknown; note?: unknown; due?: { kind?: unknown; date?: unknown } }>().catch(() => ({}) as Record<string, never>);
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (!note || note.length > TASK_NOTE_MAX) return bad(c, "Write a note (up to 1000 characters).");
  if (b.toUserId === me.id) return bad(c, "You can't send a task to yourself.");
  const to = Number.isInteger(b.toUserId)
    ? await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND active = 1").bind(b.toUserId).first<{ id: number }>()
    : null;
  if (!to) return bad(c, "Choose someone to send it to.");
  const kind = KINDS.includes(b.due?.kind as TaskDueKind) ? (b.due!.kind as TaskDueKind) : "none";
  if (kind === "date" && !isIsoDate(b.due?.date)) return bad(c, "Choose a valid date.");
  const row = await c.env.DB.prepare(
    `INSERT INTO task_cards (from_user, to_user, note, due_kind, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(me.id, to.id, note, kind, kind === "date" ? b.due!.date : null, new Date().toISOString())
    .first<{ id: number }>();
  const full = await c.env.DB.prepare(`${SELECT} WHERE t.id = ?`).bind(row!.id).first<Row>();
  return c.json(toDto(full!, me.id, todayInBusinessTz(new Date())));
});

taskCardRoutes.get("/task-cards", async (c) => {
  const me = c.get("user");
  const today = todayInBusinessTz(new Date());
  if (c.req.query("box") === "sent") {
    const since = new Date(Date.now() - SENT_DAYS * 86_400_000).toISOString();
    const { results } = await c.env.DB.prepare(
      `${SELECT} WHERE t.from_user = ? AND (t.status = 'open' OR t.done_at >= ?) ORDER BY t.created_at DESC`,
    )
      .bind(me.id, since)
      .all<Row>();
    return c.json(results.map((r) => toDto(r, me.id, today)));
  }
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE t.to_user = ? AND t.status = 'open' ORDER BY t.created_at`)
    .bind(me.id)
    .all<Row>();
  return c.json(results.map((r) => toDto(r, me.id, today)));
});

// Registered before /:id routes so "sent" is never read as an id.
taskCardRoutes.post("/task-cards/sent/seen", async (c) => {
  await c.env.DB.prepare("UPDATE task_cards SET done_seen_at = ? WHERE from_user = ? AND status = 'done' AND done_seen_at IS NULL")
    .bind(new Date().toISOString(), c.get("user").id)
    .run();
  return c.json({ ok: true });
});

async function load(c: Context<AppEnv>): Promise<Row | null> {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return null;
  return c.env.DB.prepare("SELECT * FROM task_cards WHERE id = ?").bind(id).first<Row>();
}

taskCardRoutes.post("/task-cards/:id/seen", async (c) => {
  const t = await load(c);
  if (!t) return c.json({ error: "Task not found" }, 404);
  if (t.to_user !== c.get("user").id) return c.json({ error: "This task is not yours." }, 403);
  await c.env.DB.prepare("UPDATE task_cards SET seen_at = coalesce(seen_at, ?) WHERE id = ?").bind(new Date().toISOString(), t.id).run();
  return c.json({ ok: true });
});

taskCardRoutes.post("/task-cards/:id/done", async (c) => {
  const t = await load(c);
  if (!t) return c.json({ error: "Task not found" }, 404);
  if (t.to_user !== c.get("user").id) return c.json({ error: "This task is not yours." }, 403);
  const now = new Date().toISOString();
  const r = await c.env.DB.prepare(
    "UPDATE task_cards SET status = 'done', done_at = ?, seen_at = coalesce(seen_at, ?) WHERE id = ? AND status = 'open'",
  )
    .bind(now, now, t.id)
    .run();
  if (r.meta.changes === 0) return c.json({ error: "This task is already done." }, 409);
  return c.json({ ok: true });
});

taskCardRoutes.delete("/task-cards/:id", async (c) => {
  const t = await load(c);
  if (!t) return c.json({ error: "Task not found" }, 404);
  if (t.from_user !== c.get("user").id) return c.json({ error: "This task is not yours." }, 403);
  const r = await c.env.DB.prepare("DELETE FROM task_cards WHERE id = ? AND status = 'open'").bind(t.id).run();
  if (r.meta.changes === 0) return c.json({ error: "Only open tasks can be deleted." }, 409);
  return c.json({ ok: true });
});
