import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  bucket: "this_week",
  overdue: false,
  ...over,
});

function setup(syncOver: Record<string, unknown> = {}) {
  return mockApi({
    "GET /api/auth/me": () => managerUser,
    "GET /api/dockets": () => ({
      items: [item(), item({ workOrder: "91480", customer: "Kelly Ryback", dueIso: null, dueRaw: "in production", bucket: "no_due_date" })],
      total: 2,
      page: 1,
      pageSize: 50,
      counts: { rush_today: 3, this_week: 1, coming: 0, no_due_date: 1 },
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
  it("shows bucket counts", async () => {
    setup();
    renderApp("/dashboard");
    expect(await screen.findByRole("button", { name: "Rush / Today (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "This Week (1)" })).toBeInTheDocument();
  });

  it("filters by bucket through the request URL", async () => {
    const { calls } = setup();
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: "This Week (1)" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === "/api/dockets" && c.url.searchParams.get("bucket") === "this_week")).toBe(
        true,
      ),
    );
  });

  it("switching to On Hold and History requests those views", async () => {
    const { calls } = setup();
    renderApp("/dashboard?bucket=this_week");
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
