import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { emptyForm, type DocketForm, type ProductionJob } from "../../src/shared/docketForm";
import { __setTestGateways } from "../../src/worker/google/gateways";
import { fakeGateways } from "./fakeGoogle";
import { row } from "./fixtures";
import { api, createUser, login, resetAuthTables } from "./helpers";

export const step = (roleId: string, assigneeIds: number[] = []) => ({ roleId, assigneeIds });
export const route = (...roles: string[]): ProductionJob[] => [{ name: "Whole docket", steps: roles.map((r) => step(r)) }];

export const docketForm = (over: Partial<DocketForm> = {}): DocketForm => {
  const f = emptyForm("2026-11-05", "Ana");
  f.forName = "Encore Lounge";
  f.salesperson = "JB";
  return { ...f, ...over };
};

export type CardRowT = { id: number; job_sort: number; step: number; role_id: string; status: string; fields_json: string; version: number };

export async function cardsOf(wo: string): Promise<CardRowT[]> {
  const { results } = await env.DB.prepare("SELECT * FROM cards WHERE work_order = ? ORDER BY job_sort, step").bind(wo).all<CardRowT>();
  return results;
}

export async function newDocket(cookie: string, jobs: ProductionJob[], f = docketForm()) {
  const res = await api("/api/virtual-dockets", { method: "POST", cookie, json: { form: f, jobs } });
  expect(res.status).toBe(200);
  return (await res.json()) as { workOrder: string; version: number };
}

export type Target = { userId: number; roleId?: string | null; instruction: string };

/** Creates a docket handed to the given people. */
export async function handDocket(cookie: string, handoff: Target[], f = docketForm()) {
  const res = await api("/api/virtual-dockets", { method: "POST", cookie, json: { form: f, handoff } });
  expect(res.status).toBe(200);
  return (await res.json()) as { workOrder: string; version: number; inProduction: boolean };
}

export type HandoffCard = {
  id: number;
  role_id: string;
  status: string;
  version: number;
  stage: string | null;
  assignee_ids: string;
  instruction: string | null;
  from_user_id: number | null;
  returned_reason: string | null;
  fields_json: string;
};

export const allCards = async (wo: string) =>
  (await env.DB.prepare("SELECT * FROM cards WHERE work_order = ? ORDER BY id").bind(wo).all<HandoffCard>()).results;

/** The open card of one person (the creator's card is the one with a stage). */
export const cardOf = async (wo: string, userId: number, opts: { creator?: boolean } = {}) =>
  (await allCards(wo)).find(
    (c) => c.status === "active" && JSON.parse(c.assignee_ids).includes(userId) && (opts.creator ? c.stage !== null : c.stage === null),
  )!;

/** POSTs a card action with the card's current version. */
export const move = (c: { id: number; version: number }, action: string, cookie: string, json: Record<string, unknown> = {}) =>
  api(`/api/cards/${c.id}/${action}`, { method: "POST", cookie, json: { version: c.version, ...json } });

export const post = (path: string, cookie: string, json: unknown = {}) => api(path, { method: "POST", cookie, json });
export const put = (path: string, cookie: string, json: unknown) => api(path, { method: "PUT", cookie, json });
export const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

/** Fresh fake Google, empty card tables and a signed-in manager. Returns the fake and a user factory. */
export async function setupCards() {
  const g = fakeGateways();
  g.sheet.rows.push(row(91487, { 6: "Tartan Towing" }));
  __setTestGateways(g);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM card_sheet_queue"),
    env.DB.prepare("DELETE FROM docket_photo_folders"),
    env.DB.prepare("DELETE FROM app_settings"),
    env.DB.prepare("DELETE FROM job_steps"),
    env.DB.prepare("DELETE FROM docket_jobs"),
    env.DB.prepare("DELETE FROM virtual_dockets"),
    env.DB.prepare("DELETE FROM dockets"),
  ]);
  await resetAuthTables();
  const ids: Record<string, number> = {};
  ids.mgr = await createUser("mgr", "manager");
  const manager = await login("mgr");
  ids.boss = await createUser("boss", "admin");
  const admin = await login("boss");
  async function staffWith(username: string, ...roles: string[]) {
    const id = await createUser(username, "staff");
    for (const r of roles) await env.DB.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, r).run();
    ids[username] = id;
    return login(username);
  }
  return { g, ids, manager, admin, staffWith };
}

export const teardownCards = () => __setTestGateways(null);
