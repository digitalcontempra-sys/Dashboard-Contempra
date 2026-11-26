import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocketListResponse, SessionUser, UserDTO, VirtualDocketDTO } from "../../src/shared/types";
import { listDockets } from "../../src/worker/db/dockets";
import { runSync } from "../../src/worker/sync/syncDockets";
import { docketForm, errorOf, post, put, setupCards, teardownCards } from "./cardHelpers";
import { HEADER, row } from "./fixtures";
import { api, createUser } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
});
afterEach(teardownCards);

const setCodes = async (userId: number, codes: string[]) => {
  await env.DB.prepare("DELETE FROM user_codes WHERE user_id = ?").bind(userId).run();
  for (const [i, c] of codes.entries()) {
    await env.DB.prepare("INSERT INTO user_codes (code, user_id, sort) VALUES (?, ?, ?)").bind(c, userId, i).run();
  }
};
const json = async <T>(res: Response) => (await res.json()) as T;

describe("user codes (Admin → Users)", () => {
  it("are saved upper-case without spaces, first is the main one, and listed", async () => {
    const id = await createUser("ali", "manager");
    const res = await api(`/api/users/${id}`, { method: "PATCH", cookie: s.admin, json: { codes: [" ar ", "a li"] } });
    expect(res.status).toBe(200);
    expect((await json<UserDTO>(res)).codes).toEqual(["AR", "ALI"]);
    const list = await json<UserDTO[]>(await api("/api/users", { cookie: s.admin }));
    expect(list.find((u) => u.id === id)?.codes).toEqual(["AR", "ALI"]);
  });

  it("are given when the user is created", async () => {
    const res = await api("/api/users", {
      method: "POST",
      cookie: s.admin,
      json: { username: "cory", fullName: "Cory", accessLevel: "manager", roles: [], password: "password123", codes: ["cb"] },
    });
    expect(res.status).toBe(200);
    expect((await json<UserDTO>(res)).codes).toEqual(["CB"]);
  });

  it("each code belongs to one user only", async () => {
    const ali = await createUser("ali", "manager");
    const cory = await createUser("cory", "manager");
    await env.DB.prepare("UPDATE users SET full_name = 'Ali' WHERE id = ?").bind(ali).run();
    await setCodes(ali, ["AR"]);
    const res = await api(`/api/users/${cory}`, { method: "PATCH", cookie: s.admin, json: { codes: ["CB", "ar"] } });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("Initials AR already belong to Ali.");
  });

  it("rejects codes that are not letters or numbers", async () => {
    const id = await createUser("ali", "manager");
    const res = await api(`/api/users/${id}`, { method: "PATCH", cookie: s.admin, json: { codes: ["A/R"] } });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Initials must be letters or numbers (up to 10).");
  });

  it("an empty list removes them", async () => {
    const id = await createUser("ali", "manager");
    await setCodes(id, ["AR"]);
    const res = await api(`/api/users/${id}`, { method: "PATCH", cookie: s.admin, json: { codes: [] } });
    expect((await json<UserDTO>(res)).codes).toEqual([]);
  });

  it("/auth/me returns my codes", async () => {
    await setCodes(s.ids.mgr, ["DA", "DB"]);
    const me = await json<SessionUser>(await api("/api/auth/me", { cookie: s.manager }));
    expect(me.codes).toEqual(["DA", "DB"]);
  });
});

describe("Salesperson on the docket", () => {
  it("a new docket gets the creator's main code, whatever the browser sent", async () => {
    await setCodes(s.ids.mgr, ["DA", "DB"]);
    const d = await json<VirtualDocketDTO>(await post("/api/virtual-dockets", s.manager, { form: docketForm({ salesperson: "XX" }) }));
    expect(d.form.salesperson).toBe("DA");
    const mirror = await env.DB.prepare("SELECT account_manager FROM dockets WHERE work_order = ?").bind(d.workOrder).first();
    expect(mirror?.account_manager).toBe("DA");
  });

  it("without codes the docket is not saved", async () => {
    await setCodes(s.ids.mgr, []);
    const res = await post("/api/virtual-dockets", s.manager, { form: docketForm() });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Ask an admin to set your initials first.");
  });

  it("editing keeps the salesperson it had", async () => {
    await setCodes(s.ids.mgr, ["DA"]);
    const d = await json<VirtualDocketDTO>(await post("/api/virtual-dockets", s.manager, { form: docketForm() }));
    await setCodes(s.ids.boss, ["MB"]);
    const res = await put(`/api/virtual-dockets/${d.workOrder}`, s.admin, {
      form: { ...d.form, salesperson: "MB", forName: "Renamed" },
      version: d.version,
    });
    expect(res.status).toBe(200);
    expect((await json<VirtualDocketDTO>(res)).form.salesperson).toBe("DA");
    expect(s.g.sheet.rows.find((r) => String(r[2]) === d.workOrder)?.[9]).toBe("DA");
  });

  it("editing a sheet-born docket keeps its J", async () => {
    await runSync(env, [HEADER, row(91490, { 6: "Sheet Co", 9: "CF" })]);
    s.g.sheet.rows.push(row(91490, { 6: "Sheet Co", 9: "CF" }));
    await setCodes(s.ids.mgr, ["DA"]);
    const d = await json<VirtualDocketDTO>(await api("/api/virtual-dockets/91490", { cookie: s.manager }));
    const res = await put("/api/virtual-dockets/91490", s.manager, { form: { ...d.form, salesperson: "DA" }, version: 0 });
    expect(res.status).toBe(200);
    expect(s.g.sheet.rows.find((r) => String(r[2]) === "91490")?.[9]).toBe("CF");
  });
});

describe("My Dockets", () => {
  beforeEach(async () => {
    await runSync(env, [
      HEADER,
      row(301, { 6: "Ali One", 9: "AR" }),
      row(302, { 6: "Ali Two", 9: "ALI" }),
      row(303, { 6: "Danni", 9: "DA" }),
      row(304, { 6: "Nobody", 9: "CF" }),
      row(305, { 6: "Ali Rush", 1: "RUSH", 9: "ar" }),
    ]);
  });
  const wos = (r: DocketListResponse) => r.items.map((i) => i.workOrder).sort();

  it("lists dockets whose J is any of my codes, with the same sections and counts", async () => {
    const r = await listDockets(env.DB, { view: "active", codes: ["AR", "ALI"] }, new Date());
    expect(wos(r)).toEqual(["301", "302", "305"]);
    expect(r.counts).toMatchObject({ rush_today: 1, no_due_date: 2 });
    const rush = await listDockets(env.DB, { view: "active", codes: ["AR", "ALI"], bucket: "rush_today" }, new Date());
    expect(wos(rush)).toEqual(["305"]);
  });

  it("mine=1 uses the signed-in user's codes", async () => {
    await setCodes(s.ids.mgr, ["DA"]);
    const r = await json<DocketListResponse>(await api("/api/dockets?mine=1", { cookie: s.manager }));
    expect(wos(r)).toEqual(["303"]);
  });

  it("mine=1 without codes lists nothing", async () => {
    await setCodes(s.ids.mgr, []);
    const r = await json<DocketListResponse>(await api("/api/dockets?mine=1", { cookie: s.manager }));
    expect(r.total).toBe(0);
  });
});

describe("code collisions", () => {
  it("a code taken at the same moment becomes a 409, not a 500", async () => {
    const { withCodeConflict, CodesError } = await import("../../src/worker/users/codes");
    const ali = await createUser("ali", "manager");
    await setCodes(ali, ["AR"]);
    const err = await withCodeConflict(["AR"], () =>
      env.DB.prepare("INSERT INTO user_codes (code, user_id, sort) VALUES ('AR', ?, 0)").bind(s.ids.mgr).run(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodesError);
    expect((err as InstanceType<typeof CodesError>).status).toBe(409);
  });
});
