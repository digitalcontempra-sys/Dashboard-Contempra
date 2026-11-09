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
