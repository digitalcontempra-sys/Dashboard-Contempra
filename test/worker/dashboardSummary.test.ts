import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROLE_ORDER } from "../../src/shared/cards";
import type { BoardDTO, DashboardSummary, DocketListResponse } from "../../src/shared/types";
import { cardOf, docketForm, errorOf, handDocket, move, post, setupCards, teardownCards } from "./cardHelpers";
import { api, createUser, login } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
  await env.DB.prepare("DELETE FROM task_cards").run();
});
afterEach(teardownCards);

const NOW = Date.now();
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
const ymd = (daysFromNow: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg" }).format(new Date(NOW + daysFromNow * 86_400_000));

const summary = async (cookie = s.manager) => {
  const res = await api("/api/dashboard/summary", { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as DashboardSummary;
};
const focusWos = async (focus: string, extra = "", cookie = s.manager) => {
  const res = await api(`/api/dockets?focus=${focus}${extra}`, { cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as DocketListResponse).items.map((i) => i.workOrder).sort();
};

const task = (from: number, to: number, createdHoursAgo: number, over: { status?: string; dueKind?: string; dueDate?: string | null } = {}) =>
  env.DB.prepare("INSERT INTO task_cards (from_user, to_user, note, due_kind, due_date, status, created_at) VALUES (?, ?, 'x', ?, ?, ?, ?)")
    .bind(from, to, over.dueKind ?? "none", over.dueDate ?? null, over.status ?? "open", iso(createdHoursAgo))
    .run();

const docket = (wo: string, over: { am?: string; dueIso?: string | null; rush?: boolean; status?: string } = {}) =>
  env.DB.prepare(
    `INSERT INTO dockets (work_order, sheet_row, customer, account_manager, due_iso, due_rush, comp, hold, inv, status, billing, row_hash, synced_at)
     VALUES (?, 2, 'C', ?, ?, ?, 0, 0, 0, ?, 'not_billed', 'h', 't')`,
  )
    .bind(wo, over.am ?? "MB", over.dueIso ?? null, over.rush ? 1 : 0, over.status ?? "active")
    .run();

/** Replaces the user's codes (the test users get their username as a code). */
const setCodes = async (userId: number, codes: string[]) => {
  await env.DB.prepare("DELETE FROM user_codes WHERE user_id = ?").bind(userId).run();
  for (const [i, c] of codes.entries()) await env.DB.prepare("INSERT INTO user_codes (code, user_id, sort) VALUES (?, ?, ?)").bind(c, userId, i).run();
};

describe("GET /api/dashboard/summary", () => {
  it("needs a manager or admin session", async () => {
    expect((await api("/api/dashboard/summary")).status).toBe(401);
    const staff = await s.staffWith("ana", "designer");
    expect((await api("/api/dashboard/summary", { cookie: staff })).status).toBe(403);
  });

  it("overdue task cards: sent to me by others, open, older than 24 h or past their due date", async () => {
    const jeff = await createUser("jeff", "manager");
    await env.DB.prepare("UPDATE users SET full_name = 'Jeff Baumer' WHERE id = ?").bind(jeff).run();
    const me = s.ids.mgr;
    await task(jeff, me, 25); // overdue by age
    await task(jeff, me, 2, { dueKind: "date", dueDate: ymd(-1) }); // overdue by date
    await task(jeff, me, 74); // oldest: 3 days
    await task(jeff, me, 2); // fresh
    await task(me, me, 72); // note to self
    await task(jeff, me, 80, { status: "done" }); // done
    await task(me, jeff, 80); // to someone else
    expect((await summary()).overdueTasks).toEqual({ count: 3, oldestDays: 3, oldestFrom: "Jeff" });
  });

  it("overdue task cards at zero", async () => {
    expect((await summary()).overdueTasks).toEqual({ count: 0, oldestDays: null, oldestFrom: null });
  });

  it("at risk: my active dockets overdue or due today (RUSH counts as today)", async () => {
    await setCodes(s.ids.mgr, ["MB", "MX"]);
    await docket("1001", { dueIso: ymd(-2) });
    await docket("1002", { am: "MX", dueIso: ymd(0) });
    await docket("1003", { rush: true });
    await docket("1004", { dueIso: ymd(1) }); // tomorrow
    await docket("1005", { dueIso: ymd(-2), status: "on_hold" });
    await docket("1006", { dueIso: ymd(-2), status: "completed" });
    await docket("1007", { am: "JB", dueIso: ymd(-2) }); // someone else's
    expect((await summary()).atRisk).toEqual({ overdue: 1, dueToday: 2 });
    expect(await focusWos("risk")).toEqual(["1001", "1002", "1003"]);
    // Focus is personal: the scope selector does not narrow or widen it.
    expect(await focusWos("risk", "&list=1")).toEqual(["1001", "1002", "1003"]);
  });

  it("at risk without codes is zero and the filter is empty", async () => {
    await setCodes(s.ids.mgr, []);
    await docket("1001", { am: "", dueIso: ymd(-2) });
    expect((await summary()).atRisk).toEqual({ overdue: 0, dueToday: 0 });
    expect(await focusWos("risk")).toEqual([]);
  });

  it("waiting on you: stale New Orders, approvals and sent-back cards on live dockets", async () => {
    const ira = await s.staffWith("ira", "designer");
    // (a) New Orders of mine: one untouched for 3 days, one touched yesterday.
    const stale = (await (await post("/api/virtual-dockets", s.manager, { form: docketForm({ body: "Wait" }), newOrder: true })).json()) as { workOrder: string };
    const fresh = (await (await post("/api/virtual-dockets", s.manager, { form: docketForm({ body: "Wait" }), newOrder: true })).json()) as { workOrder: string };
    await env.DB.prepare("UPDATE virtual_dockets SET created_at = ?, updated_at = ? WHERE work_order = ?").bind(iso(72), iso(72), stale.workOrder).run();
    await env.DB.prepare("UPDATE virtual_dockets SET created_at = ?, updated_at = ? WHERE work_order = ?").bind(iso(72), iso(20), fresh.workOrder).run();
    // (b) proof sent back to me (the creator): waiting for my approval.
    const proof = await handDocket(s.manager, [{ userId: s.ids.ira, roleId: "designer", instruction: "Logo" }]);
    expect((await move(await cardOf(proof.workOrder, s.ids.ira), "proof-sent", ira)).status).toBe(200);
    // (c) a card sent back to me: I hand to Ira, Ira sends it back.
    const back = await handDocket(s.manager, [{ userId: s.ids.ira, roleId: "designer", instruction: "Logo" }]);
    expect((await move(await cardOf(back.workOrder, s.ids.ira), "send-back", ira, { reason: "Need size" })).status).toBe(200);

    expect((await summary()).waiting).toEqual({ newOrders: 1, approvals: 1, sentBack: 1 });
    expect(await focusWos("waiting", "&mine=1")).toEqual([stale.workOrder, proof.workOrder, back.workOrder].sort());
    // Another manager has nothing waiting.
    await createUser("other", "manager");
    expect((await summary(await login("other"))).waiting).toEqual({ newOrders: 0, approvals: 0, sentBack: 0 });

    // Trash hides them all.
    for (const wo of [stale.workOrder, proof.workOrder, back.workOrder]) {
      await env.DB.prepare("UPDATE virtual_dockets SET deleted_at = ? WHERE work_order = ?").bind(iso(0), wo).run();
    }
    expect((await summary()).waiting).toEqual({ newOrders: 0, approvals: 0, sentBack: 0 });
    expect(await focusWos("waiting")).toEqual([]);
  });

  it("areas: every production area in order, counted like the Production Board", async () => {
    await s.staffWith("ira", "designer");
    await s.staffWith("seb", "printer_roll");
    await handDocket(s.manager, [
      { userId: s.ids.ira, roleId: "designer", instruction: "Logo" },
      { userId: s.ids.seb, roleId: "printer_roll", instruction: "Print" },
    ]);
    await handDocket(s.manager, [{ userId: s.ids.ira, roleId: "designer", instruction: "Logo" }]);
    const { areas } = await summary();
    expect(areas.map((a) => a.roleId)).toEqual([...ROLE_ORDER]);
    const board = (await (await api("/api/production-board", { cookie: s.manager })).json()) as BoardDTO;
    for (const a of areas) expect(a.count, a.roleId).toBe(board.columns.find((c) => c.roleId === a.roleId)!.cards.length);
    expect(areas.find((a) => a.roleId === "designer")!.count).toBe(2);
  });

  it("rejects an unknown focus", async () => {
    const res = await api("/api/dockets?focus=bogus", { cookie: s.manager });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Invalid filter");
  });
});
