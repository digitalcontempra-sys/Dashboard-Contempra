import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyForm } from "../../src/shared/docketForm";
import { managerUser, mockApi } from "./mockApi";
import { renderApp } from "./render";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const item = (over: Record<string, unknown> = {}) => ({
  workOrder: "91487",
  customer: "Tartan Towing",
  project: "500pc Blockout Decals",
  accountManager: "MB",
  dateIso: "2026-10-19",
  dueIso: "2026-10-21",
  dueRaw: null,
  status: "active",
  billing: "not_billed",
  bucket: "upcoming",
  section: "upcoming",
  readySince: null,
  overdue: false,
  ...over,
});

function setup(syncOver: Record<string, unknown> = {}) {
  return mockApi({
    "GET /api/auth/me": () => managerUser,
    "GET /api/dockets": () => ({
      items: [item({ areas: ["laminate_roll"], holders: [{ roleId: "laminate_roll", names: ["Cory"] }] }), item({ workOrder: "91480", customer: "Kelly Ryback", dueIso: null, dueRaw: "in production", bucket: "no_due_date", productionDone: true })],
      total: 2,
      page: 1,
      pageSize: 50,
      counts: { rush_today: 3, upcoming: 1, new_orders: 0, no_due_date: 1, daily_complete: 0 },
    }),
    "GET /api/account-managers": () => [{ accountManager: "MB", count: 10 }],
    "GET /api/sync/status": () => ({
      lastRunAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      rowsSeen: 2,
      rowsChanged: 0,
      rowsDeleted: 0,
      configured: true,
      ...syncOver,
    }),
    "GET /api/virtual-dockets/91487": () => Response.json({ error: "Work order not found" }, { status: 404 }),
    "GET /api/dockets/91487": () => ({
      ...item(),
      sheetRow: 2,
      dateRaw: null,
      comp: false,
      hold: false,
      seq: "7",
      address: "202 Donna Wyatt",
      roleNote: null,
      inv: false,
      invDateRaw: null,
      quotePo: "PO 30451",
      notes: "Call before pickup",
      link: null,
      syncedAt: new Date().toISOString(),
    }),
  });
}

describe("Main Dashboard", () => {
  it("shows the sections in order, without Coming", async () => {
    setup();
    renderApp("/dashboard");
    await screen.findByRole("button", { name: "Rush / Today (3)" });
    const chips = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((n) => /\(\d+\)$/.test(n));
    expect(chips).toEqual(["All (5)", "Rush / Today (3)", "Upcoming (1)", "New Orders (0)", "No Due Date (1)", "Daily Complete (0)"]);
    expect(screen.queryByRole("button", { name: /Coming/ })).toBeNull();
  });

  it("an old section in the URL falls back to All", async () => {
    const { calls } = setup();
    renderApp("/dashboard?bucket=coming");
    expect(await screen.findByRole("button", { name: "All (5)" })).toHaveAttribute("aria-pressed", "true");
    expect(calls.filter((c) => c.url.pathname === "/api/dockets").every((c) => !c.url.searchParams.has("bucket"))).toBe(true);
  });

  it("a New Order tile opens the docket editor; a Daily Complete tile says since when it is ready", async () => {
    mockApi({
      "GET /api/auth/me": () => managerUser,
      "GET /api/dockets": () => ({
        items: [
          item({ workOrder: "91490", customer: "New Co", project: "Waiting for measurements", section: "new_orders" }),
          item({ workOrder: "91470", customer: "Done Co", section: "daily_complete", readySince: "2026-11-23T15:00:00Z" }),
        ],
        total: 2,
        page: 1,
        pageSize: 50,
        counts: { rush_today: 0, upcoming: 0, new_orders: 1, no_due_date: 0, daily_complete: 1 },
      }),
      "GET /api/account-managers": () => [],
      "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, configured: true }),
      "GET /api/roles": () => [],
      "GET /api/assignees": () => [],
      "GET /api/virtual-dockets/91490": () => ({
        workOrder: "91490",
        form: { ...emptyForm("2026-11-24", "mgr"), forName: "New Co", body: "Waiting for measurements" },
        jobs: [],
        inProduction: false,
        newOrder: true,
        version: 1,
        source: "virtual",
        pdf: { stored: true, driveLink: null, driveStatus: "done" },
        deletedAt: null,
        sheet: { notes: null },
      }),
    });
    renderApp("/dashboard");
    const done = (await screen.findByText("Done Co")).closest("li")!;
    expect(within(done).getByText("Daily Complete")).toBeInTheDocument();
    expect(within(done).getByText("Ready since Nov 23")).toBeInTheDocument();
    const tile = screen.getByText("New Co").closest("li")!;
    expect(within(tile).getByText("New Order")).toBeInTheDocument();
    await userEvent.click(within(tile).getByRole("button"));
    expect(await screen.findByRole("heading", { name: "Docket #91490" })).toBeInTheDocument();
    expect(screen.getByText("New order · waiting for more info")).toBeInTheDocument();
  });

  it("shows bucket counts", async () => {
    setup();
    renderApp("/dashboard");
    expect(await screen.findByRole("button", { name: "Rush / Today (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upcoming (1)" })).toBeInTheDocument();
  });

  it("filters by bucket through the request URL", async () => {
    const { calls } = setup();
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: "Upcoming (1)" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === "/api/dockets" && c.url.searchParams.get("bucket") === "upcoming")).toBe(
        true,
      ),
    );
  });

  it("switching to On Hold and History requests those views", async () => {
    const { calls } = setup();
    renderApp("/dashboard?bucket=upcoming");
    await userEvent.click(await screen.findByRole("tab", { name: "On Hold" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === "/api/dockets" && c.url.searchParams.get("view") === "on_hold")).toBe(true),
    );
    const onHold = calls.filter((c) => c.url.searchParams.get("view") === "on_hold");
    expect(onHold.every((c) => !c.url.searchParams.has("bucket"))).toBe(true);
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Cancelled" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.searchParams.get("view") === "history" && c.url.searchParams.get("history") === "cancelled"),
      ).toBe(true),
    );
  });

  it("shows raw due text when the due date is not a date", async () => {
    setup();
    renderApp("/dashboard");
    const row = (await screen.findByText("Kelly Ryback")).closest("li")!;
    expect(within(row).getByText("in production")).toBeInTheDocument();
  });

  it("opens docket detail with the Account Manager label", async () => {
    setup();
    renderApp("/dashboard");
    await userEvent.click(await screen.findByText("Tartan Towing"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Account Manager")).toBeInTheDocument();
    expect(await within(dialog).findByText("Call before pickup")).toBeInTheDocument();
  });

  it("warns when the last sync is stale", async () => {
    setup({ lastSuccessAt: new Date(Date.now() - 7 * 60_000).toISOString() });
    renderApp("/dashboard");
    const badge = await screen.findByText("Last synced 7 min ago");
    expect(badge.closest("[data-tone]")).toHaveAttribute("data-tone", "warn");
  });

  it("shows a sync problem message when the last run failed", async () => {
    setup({ lastError: "Header mismatch: G" });
    renderApp("/dashboard");
    expect(await screen.findByText("Sync problem — showing last saved data")).toBeInTheDocument();
  });

  it("shows a neutral badge when no Google Sheet is connected", async () => {
    setup({ configured: false, lastSuccessAt: null, lastError: "Google Sheet is not connected yet" });
    renderApp("/dashboard");
    const badge = await screen.findByText("Google Sheet not connected");
    expect(badge.closest("[data-tone]")).toHaveAttribute("data-tone", "neutral");
  });

  it("keeps showing data age while sync is failing", async () => {
    setup({ lastError: "Google Sheets read failed (503)", lastSuccessAt: new Date(Date.now() - 12 * 60_000).toISOString() });
    renderApp("/dashboard");
    expect(await screen.findByText("Last synced 12 min ago")).toBeInTheDocument();
    expect(screen.getByText("Sync problem — showing last saved data")).toBeInTheDocument();
  });
});

describe("areas on the Main Dashboard", () => {
  it("shows each docket's current area, Done, and the color legend", async () => {
    setup();
    renderApp("/dashboard");
    const tile = await screen.findByRole("button", { name: /Work order 91487/ });
    expect(within(tile).getByText("Laminate")).toHaveAttribute("data-area", "laminate_roll");
    // Who has it in that area.
    expect(within(tile).getByText("Cory")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Work order 91480/ })).getByText("Done")).toBeInTheDocument();
    // The legend is the Areas menu: each area's name on its own color.
    const legend = screen.getByRole("region", { name: "Areas · Open board" });
    expect(within(legend).getByRole("link", { name: /^Laminate/ })).toHaveAttribute("data-area", "laminate_roll");
  });
});
