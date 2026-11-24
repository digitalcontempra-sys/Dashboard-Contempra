import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getDocket, listDockets } from "../../src/worker/db/dockets";
import { runSync } from "../../src/worker/sync/syncDockets";
import { HEADER, row } from "./fixtures";

// 2026-10-19 (Monday) at noon Winnipeg time.
const NOW = new Date("2026-10-19T17:00:00Z");
const S = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000 + 25569;

async function virtual(wo: string, newOrder = 0) {
  await env.DB.prepare(
    `INSERT INTO virtual_dockets (work_order, state, form_json, created_at, updated_at, new_order)
     VALUES (?, 'saved', '{}', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', ?)`,
  )
    .bind(wo, newOrder)
    .run();
}

async function card(wo: string, step: number, o: { stage?: string; status?: string; returned?: string; activatedAt?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO cards (work_order, job_sort, job_name, step, role_id, status, stage, returned_reason, handoff, activated_at, updated_at)
     VALUES (?, 0, 'Whole docket', ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(wo, step, o.stage ? "general" : "designer", o.status ?? "active", o.stage ?? null, o.returned ?? null, o.activatedAt ?? null, "2026-10-18T00:00:00Z")
    .run();
}

beforeAll(async () => {
  for (const t of ["card_events", "cards", "docket_jobs", "virtual_dockets", "dockets"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
  await runSync(env, [
    HEADER,
    row(300, { 0: S("2026-10-10"), 1: S("2026-10-25"), 6: "New Dated" }),
    row(301, { 0: S("2026-10-12"), 6: "New Undated" }),
    row(302, { 0: S("2026-10-01"), 1: "RUSH", 6: "Done Rush" }),
    row(303, { 0: S("2026-10-02"), 6: "Done Undated" }),
    row(304, { 0: S("2026-10-03"), 1: S("2026-10-22"), 6: "Still Open" }),
    row(305, { 0: S("2026-10-04"), 6: "Waiting Approval" }),
    row(306, { 0: S("2026-10-06"), 6: "Returned To Creator" }),
    row(307, { 0: S("2026-10-05"), 6: "Old Undated" }),
    row(308, { 0: S("2026-10-15"), 6: "Recent Undated" }),
    row(309, { 0: S("2026-10-07"), 1: S("2026-10-30"), 6: "Later" }),
    row(310, { 0: S("2026-10-08"), 1: S("2026-10-21"), 6: "Sooner" }),
    row(311, { 0: S("2026-10-09"), 1: S("2026-10-15"), 6: "Overdue" }),
    row(312, { 0: S("2026-10-11"), 1: "RUSH", 6: "Rush Text" }),
    row(313, { 0: S("2026-10-13"), 1: S("2026-10-19"), 6: "Due Today" }),
  ]);
  await virtual("300", 1);
  await virtual("301", 1);
  for (const wo of ["302", "303", "304", "305", "306"]) await virtual(wo);
  await card("302", 0, { status: "done" });
  await card("302", 1, { stage: "ready_to_close", activatedAt: "2026-10-18T10:00:00Z" });
  await card("303", 0, { stage: "ready_to_close", activatedAt: "2026-10-17T10:00:00Z" });
  await card("304", 0, { stage: "ready_to_close", activatedAt: "2026-10-16T10:00:00Z" });
  await card("304", 1);
  await card("305", 0, { stage: "waiting_design", activatedAt: "2026-10-16T10:00:00Z" });
  await card("306", 0, { stage: "ready_to_close", returned: "Wrong size", activatedAt: "2026-10-16T10:00:00Z" });
});

const wos = async (bucket?: Parameters<typeof listDockets>[1]["bucket"]) =>
  (await listDockets(env.DB, { view: "active", bucket }, NOW)).items.map((i) => i.workOrder);

describe("Main Dashboard sections", () => {
  it("New Orders: flagged dockets, newest first, whatever their due date", async () => {
    expect(await wos("new_orders")).toEqual(["301", "300"]);
  });

  it("Daily Complete: creator card Ready to close with nobody else on it, longest waiting first", async () => {
    expect(await wos("daily_complete")).toEqual(["303", "302"]);
    const r = await listDockets(env.DB, { view: "active", bucket: "daily_complete" }, NOW);
    expect(r.items[0]).toMatchObject({ section: "daily_complete", readySince: "2026-10-17T10:00:00Z" });
  });

  it("Rush / Today: rush text first, then the earliest due date", async () => {
    expect(await wos("rush_today")).toEqual(["312", "311", "313"]);
  });

  it("Upcoming: every later due date, the soonest first", async () => {
    expect(await wos("upcoming")).toEqual(["310", "304", "309"]);
  });

  it("No Due Date: newest first; approvals and returns stay in their time section", async () => {
    expect(await wos("no_due_date")).toEqual(["308", "306", "307", "305"]);
  });

  it("All: every docket by creation date, newest first; counts partition the total", async () => {
    const r = await listDockets(env.DB, { view: "active" }, NOW);
    expect(r.items.map((i) => i.workOrder)).toEqual([
      "308", "313", "301", "312", "300", "311", "310", "309", "306", "307", "305", "304", "303", "302",
    ]);
    expect(r.counts).toEqual({ rush_today: 3, upcoming: 3, new_orders: 2, no_due_date: 4, daily_complete: 2 });
    expect(r.items.find((i) => i.workOrder === "300")?.section).toBe("new_orders");
    expect(r.items.find((i) => i.workOrder === "304")?.section).toBe("upcoming");
  });

  it("the docket detail carries its section too", async () => {
    expect((await getDocket(env.DB, "301", NOW))?.section).toBe("new_orders");
    expect((await getDocket(env.DB, "313", NOW))?.section).toBe("rush_today");
  });
});
