import type { CardFields } from "../../shared/cards";
import { deriveTimeBucket, todayInBusinessTz } from "../../shared/rules";
import type { CardDTO } from "../../shared/types";
import { ServiceError } from "../dockets/errors";
import type { CardRow } from "./service";

type HeaderRow = {
  work_order: string;
  customer: string | null;
  account_manager: string | null;
  project: string | null;
  address: string | null;
  due_iso: string | null;
  due_raw: string | null;
  due_rush: number | null;
  form_json: string | null;
};

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** Builds DTOs for cards, with the docket header from the mirror and the virtual docket. */
export async function toCardDTOs(db: D1Database, userId: number, rows: CardRow[], now = new Date()): Promise<CardDTO[]> {
  if (rows.length === 0) return [];
  const wos = [...new Set(rows.map((r) => r.work_order))];
  const { results: headers } = await db
    .prepare(
      `SELECT v.work_order, d.customer, d.account_manager, d.project, d.address, d.due_iso, d.due_raw, d.due_rush, v.form_json
       FROM virtual_dockets v LEFT JOIN dockets d ON d.work_order = v.work_order WHERE v.work_order IN (${marks(wos.length)})`,
    )
    .bind(...wos)
    .all<HeaderRow>();
  const { results: siblings } = await db
    .prepare(`SELECT work_order, job_sort, step, role_id FROM cards WHERE work_order IN (${marks(wos.length)}) ORDER BY step`)
    .bind(...wos)
    .all<{ work_order: string; job_sort: number; step: number; role_id: string }>();
  const userIds = [...new Set(rows.flatMap((r) => [r.claimed_by, r.returned_by]).filter((x): x is number => x !== null))];
  const names = new Map<number, string>();
  if (userIds.length) {
    const { results } = await db
      .prepare(`SELECT id, full_name FROM users WHERE id IN (${marks(userIds.length)})`)
      .bind(...userIds)
      .all<{ id: number; full_name: string }>();
    for (const u of results) names.set(u.id, u.full_name);
  }
  const seen = new Map<number, string>();
  const { results: seenRows } = await db
    .prepare(`SELECT card_id, seen_at FROM card_seen WHERE user_id = ? AND card_id IN (${marks(rows.length)})`)
    .bind(userId, ...rows.map((r) => r.id))
    .all<{ card_id: number; seen_at: string }>();
  for (const s of seenRows) seen.set(s.card_id, s.seen_at);
  const today = todayInBusinessTz(now);

  return rows.map((r) => {
    const h = headers.find((x) => x.work_order === r.work_order);
    const job = siblings.filter((s) => s.work_order === r.work_order && s.job_sort === r.job_sort);
    const assignees = JSON.parse(r.assignee_ids) as number[];
    const form = h?.form_json ? (JSON.parse(h.form_json) as { proofRequired?: boolean }) : {};
    const seenAt = seen.get(r.id);
    return {
      id: r.id,
      workOrder: r.work_order,
      jobName: r.job_name,
      step: r.step,
      roleId: r.role_id,
      status: r.status,
      assigneeIds: assignees,
      team: assignees.length === 0,
      claimedBy: r.claimed_by ? { id: r.claimed_by, name: names.get(r.claimed_by) ?? "Someone" } : null,
      fields: JSON.parse(r.fields_json) as CardFields,
      returned: r.returned_reason ? { reason: r.returned_reason, by: names.get(r.returned_by ?? -1) ?? "Someone" } : null,
      version: r.version,
      activatedAt: r.activated_at,
      isNew: r.status === "active" && (!seenAt || (r.activated_at !== null && seenAt < r.activated_at)),
      nextRoleId: job.find((s) => s.step === r.step + 1)?.role_id ?? null,
      earlier: job.filter((s) => s.step < r.step).map((s) => ({ step: s.step, roleId: s.role_id })),
      header: {
        customer: h?.customer ?? null,
        accountManager: h?.account_manager ?? null,
        project: h?.project ?? null,
        address: h?.address ?? null,
        bucket: deriveTimeBucket(h?.due_iso ?? null, h?.due_rush === 1, today).bucket,
        dueIso: h?.due_iso ?? null,
        dueRaw: h?.due_raw ?? null,
        proofRequired: form.proofRequired === true,
      },
    };
  });
}

export async function cardDTO(db: D1Database, userId: number, id: number): Promise<CardDTO> {
  const row = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
  if (!row) throw new ServiceError(404, "Card not found");
  return (await toCardDTOs(db, userId, [row]))[0];
}
