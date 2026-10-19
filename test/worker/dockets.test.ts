import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getDocket,
  listAccountManagers,
  listDockets,
  listNonBilled,
  listReview,
} from "../../src/worker/db/dockets";
import { runSync } from "../../src/worker/sync/syncDockets";
import { HEADER, row } from "./fixtures";
import { api, createUser, login, resetAuthTables } from "./helpers";

// 2026-10-19 (Monday) at noon Winnipeg time. Serial 46314 = 2026-10-19.
const NOW = new Date("2026-10-19T17:00:00Z");
const S = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) / 86_400_000) + 25569;

beforeAll(async () => {
  await env.DB.prepare("DELETE FROM dockets").run();
  await runSync(env, [
    HEADER,
    row(100, { 1: "RUSH", 6: "Rush Co", 9: "MB" }),
    row(101, { 1: S("2026-10-15"), 6: "Late Co", 9: "JB" }),
    row(102, { 1: S("2026-10-22"), 6: "Week Co", 9: "JB" }),
    row(103, { 1: S("2026-10-26"), 6: "Next Monday Co", 9: "JB" }),
    row(104, { 1: "in production", 6: "No Date Co", 9: "DB" }),
    row(105, { 4: true, 6: "Held Co" }),
    row(106, { 3: true, 0: S("2026-10-01"), 6: "Done Unbilled" }),
    row(107, { 3: true, 12: "151409 8-AUG-25", 6: "Done Billed" }),
    row(108, { 3: true, 12: "NO CHARGE 6-OCT-26", 6: "No Charge Co" }),
    row(109, { 1: "CANCEL 1-DEC-25", 6: "Cancelled Co" }),
    row(91487, { 6: "Tartan Towing", 7: "Blockout Decals" }),
    row(200, { 6: "Dup A" }),
    row(200, { 6: "Dup B" }),
  ]);
});

const ids = (items: { workOrder: string }[]) => items.map((i) => i.workOrder).sort();

describe("listDockets", () => {
  it("rush_today has RUSH text and overdue rows, not next week", async () => {
    const r = await listDockets(env.DB, { view: "active", bucket: "rush_today" }, NOW);
    expect(ids(r.items)).toEqual(["100", "101"]);
    expect(r.items.find((i) => i.workOrder === "101")?.overdue).toBe(true);
    expect(r.items[0].workOrder).toBe("100"); // rush first
  });

  it("this_week, coming and no_due_date split correctly", async () => {
    expect(ids((await listDockets(env.DB, { view: "active", bucket: "this_week" }, NOW)).items)).toEqual(["102"]);
    expect(ids((await listDockets(env.DB, { view: "active", bucket: "coming" }, NOW)).items)).toEqual(["103"]);
    const none = await listDockets(env.DB, { view: "active", bucket: "no_due_date" }, NOW);
    expect(ids(none.items)).toEqual(["104", "200", "91487"]);
    expect(none.items.find((i) => i.workOrder === "104")?.dueRaw).toBe("in production");
  });

  it("counts cover all buckets and sum to the unfiltered total", async () => {
    const r = await listDockets(env.DB, { view: "active" }, NOW);
    const sum = Object.values(r.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(r.total);
    expect(r.counts).toEqual({ rush_today: 2, this_week: 1, coming: 1, no_due_date: 3 });
  });

  it("on_hold and history views", async () => {
    expect(ids((await listDockets(env.DB, { view: "on_hold" }, NOW)).items)).toEqual(["105"]);
    expect(ids((await listDockets(env.DB, { view: "history", history: "cancelled" }, NOW)).items)).toEqual(["109"]);
    expect(ids((await listDockets(env.DB, { view: "history", history: "completed" }, NOW)).items)).toEqual([
      "106", "107", "108",
    ]);
    const all = await listDockets(env.DB, { view: "history" }, NOW);
    expect(all.items.map((i) => i.workOrder)).toEqual(["109", "108", "107", "106"]); // WO desc
  });

  it("filters by account manager and search", async () => {
    expect(ids((await listDockets(env.DB, { view: "active", am: "jb" }, NOW)).items)).toEqual(["101", "102", "103", "200", "91487"]);
    expect(ids((await listDockets(env.DB, { view: "active", q: "914" }, NOW)).items)).toEqual(["91487"]);
    expect(ids((await listDockets(env.DB, { view: "active", q: "blockout" }, NOW)).items)).toEqual(["91487"]);
  });
});

describe("listNonBilled", () => {
  it("ready = completed and not billed; excludes billed, no charge and cancelled", async () => {
    const r = await listNonBilled(env.DB, { tab: "ready" }, NOW);
    expect(ids(r.items)).toEqual(["106"]);
    expect(r.items[0].ageDays).toBe(18);
  });
  it("open = active or on hold and not billed", async () => {
    const r = await listNonBilled(env.DB, { tab: "open" }, NOW);
    expect(ids(r.items)).toEqual(["100", "101", "102", "103", "104", "105", "200", "91487"]);
  });
});

describe("detail, review, account managers", () => {
  it("returns full detail or null", async () => {
    const d = await getDocket(env.DB, "91487", NOW);
    expect(d).toMatchObject({ workOrder: "91487", project: "Blockout Decals", bucket: "no_due_date", comp: false });
    expect(await getDocket(env.DB, "nope", NOW)).toBeNull();
  });
  it("groups review rows by work order", async () => {
    const r = await listReview(env.DB);
    expect(r).toEqual([
      expect.objectContaining({ kind: "duplicate_work_order", workOrder: "200", rows: expect.any(Array) }),
    ]);
    expect(r[0].rows.map((x) => x.sheetRow)).toEqual([13, 14]);
  });
  it("lists account managers by count", async () => {
    const r = await listAccountManagers(env.DB);
    expect(r[0]).toEqual({ accountManager: "JB", count: 10 });
  });
});

describe("docket routes", () => {
  it("staff are forbidden, managers allowed", async () => {
    await resetAuthTables();
    await createUser("ana", "staff");
    await createUser("mgr", "manager");
    expect((await api("/api/dockets?view=active", { cookie: await login("ana") })).status).toBe(403);
    const mgr = await login("mgr");
    const res = await api("/api/dockets?view=active&bucket=coming", { cookie: mgr });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ page: 1, pageSize: 50 });
    expect((await api("/api/dockets/nope", { cookie: mgr })).status).toBe(404);
    expect((await api("/api/non-billed?tab=ready", { cookie: mgr })).status).toBe(200);
    expect((await api("/api/needs-review", { cookie: mgr })).status).toBe(200);
    expect((await api("/api/account-managers", { cookie: mgr })).status).toBe(200);
  });
  it("rejects an unknown view", async () => {
    await resetAuthTables();
    await createUser("mgr", "manager");
    const res = await api("/api/dockets?view=weird", { cookie: await login("mgr") });
    expect(res.status).toBe(400);
  });
});
