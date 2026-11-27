import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ORDER } from "../../src/shared/cards";
import type { DashboardSummary } from "../../src/shared/types";
import { Clock } from "../../src/web/dashboard/Clock";
import { managerUser, mockApi } from "./mockApi";
import { renderApp } from "./render";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const summary = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  overdueTasks: { count: 3, oldestDays: 4, oldestFrom: "Jeff" },
  atRisk: { overdue: 5, dueToday: 2 },
  waiting: { newOrders: 2, approvals: 1, sentBack: 1, dockets: 4 },
  areas: ROLE_ORDER.map((roleId, i) => ({ roleId, count: i })),
  ...over,
});
const emptyList = { items: [], total: 0, page: 1, pageSize: 50, counts: { rush_today: 0, upcoming: 0, new_orders: 0, no_due_date: 0, daily_complete: 0 } };

function setup(s = summary()) {
  return mockApi({
    "GET /api/auth/me": () => managerUser,
    "GET /api/dockets": () => emptyList,
    "GET /api/dashboard/summary": () => s,
    "GET /api/account-managers": () => [],
    "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true }),
  });
}

describe("Clock", () => {
  it("shows Winnipeg time, weekday and date, and moves on the minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T14:00:30.000Z"));
    render(<Clock />);
    const clock = screen.getByRole("group", { name: "Friday, November 27, 2026, 8:00 AM" });
    expect(within(clock).getByText("8:00 AM")).toBeInTheDocument();
    expect(within(clock).getByText("FRIDAY")).toBeInTheDocument();
    expect(within(clock).getByText("Nov 27, 2026")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(30_100));
    expect(screen.getByText("8:01 AM")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("8:02 AM")).toBeInTheDocument();
  });
});

describe("Main Dashboard header", () => {
  it("shows the three personal cards as links with their numbers and detail lines", async () => {
    setup();
    renderApp("/dashboard");
    const overdue = await screen.findByRole("link", { name: /Overdue task cards/ });
    expect(overdue).toHaveAttribute("href", "/my-cards?show=task");
    await waitFor(() => expect(within(overdue).getByText("3")).toBeInTheDocument());
    expect(within(overdue).getByText("Oldest: 4 days · from Jeff")).toBeInTheDocument();

    const risk = screen.getByRole("link", { name: /At risk/ });
    expect(risk).toHaveAttribute("href", "/dashboard?focus=risk");
    expect(within(risk).getByText("7")).toBeInTheDocument();
    expect(within(risk).getByText("5 overdue · 2 due today")).toBeInTheDocument();

    const waiting = screen.getByRole("link", { name: /Waiting on you/ });
    expect(waiting).toHaveAttribute("href", "/dashboard?focus=waiting");
    expect(within(waiting).getByText("4")).toBeInTheDocument();
    expect(within(waiting).getByText("2 new orders · 1 approval · 1 sent back")).toBeInTheDocument();
  });

  it("keeps a card with zero in a calm state", async () => {
    setup(summary({ overdueTasks: { count: 0, oldestDays: null, oldestFrom: null } }));
    renderApp("/dashboard");
    const overdue = await screen.findByRole("link", { name: /Overdue task cards/ });
    await waitFor(() => expect(within(overdue).getByText("All caught up")).toBeInTheDocument());
    expect(overdue).toHaveAttribute("data-calm", "true");
  });

  it("At risk filters the list to my dockets at risk, with a chip to clear it", async () => {
    const { calls } = setup();
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("link", { name: /At risk/ }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/dockets" && c.url.searchParams.get("focus") === "risk")).toBe(true));
    const last = calls.filter((c) => c.url.pathname === "/api/dockets").at(-1)!;
    expect(last.url.searchParams.get("mine")).toBeNull();
    expect(await screen.findByText("Nothing at risk. Nice work.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filter: At risk" }));
    await waitFor(() => expect(calls.filter((c) => c.url.pathname === "/api/dockets").at(-1)!.url.searchParams.get("focus")).toBeNull());
    expect(screen.queryByRole("button", { name: "Clear filter: At risk" })).not.toBeInTheDocument();
  });

  it("changing the scope clears a header filter", async () => {
    const { calls } = setup();
    renderApp("/dashboard?focus=waiting");
    expect(await screen.findByRole("button", { name: "Clear filter: Waiting on you" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "My List" }));
    await waitFor(() => expect(calls.filter((c) => c.url.pathname === "/api/dockets").at(-1)!.url.searchParams.get("list")).toBe("1"));
    expect(calls.filter((c) => c.url.pathname === "/api/dockets").at(-1)!.url.searchParams.get("focus")).toBeNull();
  });

  it("lists every area with its open cards, each opening the Production Board on it", async () => {
    setup();
    renderApp("/dashboard");
    const areas = await screen.findByRole("region", { name: "Areas · Open board" });
    const links = within(areas).getAllByRole("link");
    expect(links).toHaveLength(ROLE_ORDER.length);
    const lam = within(areas).getByRole("link", { name: /^Laminate/ });
    expect(lam).toHaveAttribute("href", "/production?area=laminate_roll");
    await waitFor(() => expect(lam).toHaveTextContent("Laminate3"));
  });

  it("the areas panel is collapsible on a phone, collapsed by default and remembered", async () => {
    setup();
    renderApp("/dashboard");
    const toggle = await screen.findByRole("button", { name: "Areas · Open board" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const list = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(list.className).toMatch(/(^| )hidden( |$)/);
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(list.className).not.toMatch(/(^| )hidden( |$)/);
    expect(localStorage.getItem("dashboard.areasOpen")).toBe("1");
  });
});

describe("links into other pages", () => {
  it("My Cards opens on Task cards with ?show=task", async () => {
    mockApi({
      "GET /api/auth/me": () => managerUser,
      "GET /api/my-cards": () => [],
      "GET /api/task-cards": () => [],
      "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true }),
    });
    renderApp("/my-cards?show=task");
    expect(await screen.findByRole("tab", { name: "Task cards" })).toHaveAttribute("aria-selected", "true");
  });

  it("the Production Board scrolls to and highlights ?area=", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mockApi({
      "GET /api/auth/me": () => managerUser,
      "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true }),
      "GET /api/assignees": () => [],
      "GET /api/production-board": () => ({
        columns: [
          { roleId: "designer", area: "Design", cards: [] },
          { roleId: "laminate_roll", area: "Laminate", cards: [] },
        ],
        productionColumnsReady: true,
        productionColumnsSetUp: true,
      }),
    });
    renderApp("/production?area=laminate_roll");
    const col = await screen.findByRole("region", { name: "Laminate" });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(col);
    expect(col).toHaveAttribute("data-highlight", "true");
    expect(screen.getByRole("region", { name: "Design" })).not.toHaveAttribute("data-highlight");
  });
});
