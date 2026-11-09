import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardDTO } from "../../src/shared/types";
import { playChime } from "../../src/web/cards/chime";
import { makeCard } from "./cardFixtures";
import { managerUser, mockApi, staffUser } from "./mockApi";
import { renderApp } from "./render";

vi.mock("../../src/web/cards/chime", () => ({ playChime: vi.fn(), armChime: vi.fn() }));

beforeEach(() => vi.mocked(playChime).mockClear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.title = "Contempra Dashboard";
});

function app(opts: { user?: object; cards?: CardDTO[]; summaries?: { newCount: number; soundOn?: boolean }[] } = {}) {
  const summaries = opts.summaries ?? [{ newCount: 0 }];
  let n = 0;
  return mockApi({
    "GET /api/auth/me": () => opts.user ?? staffUser,
    "GET /api/my-cards": () => opts.cards ?? [],
    "GET /api/my-cards/summary": () => {
      const s = summaries[Math.min(n++, summaries.length - 1)];
      return { activeCount: s.newCount, soundOn: true, ...s };
    },
    "POST /api/cards/7/seen": () => ({ ok: true }),
    "PUT /api/me/sound": () => ({ ok: true }),
  });
}

describe("card alerts", () => {
  it("rings, shows a badge and changes the tab title when cards arrive", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    app({ summaries: [{ newCount: 0 }, { newCount: 2 }] });
    renderApp("/my-cards");
    await screen.findByRole("heading", { name: "My Cards" });
    expect(playChime).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    const badges = await screen.findAllByLabelText("2 new cards");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].className).toContain("animate-pulse-badge");
    expect(playChime).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("(2) New cards · Contempra");
  });

  it("stays silent when sound is off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    app({ summaries: [{ newCount: 0, soundOn: false }, { newCount: 1, soundOn: false }] });
    renderApp("/my-cards");
    await screen.findByRole("heading", { name: "My Cards" });
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    await screen.findAllByLabelText("1 new card");
    expect(playChime).not.toHaveBeenCalled();
  });

  it("the sound toggle saves the setting", async () => {
    const { calls } = app();
    renderApp("/my-cards");
    const toggle = (await screen.findAllByRole("button", { name: "Sound on" }))[0];
    await userEvent.click(toggle);
    expect(calls.find((c) => c.url.pathname === "/api/me/sound")?.body).toEqual({ on: false });
  });
});

describe("My Cards page", () => {
  const cards = [
    makeCard({ id: 1, workOrder: "1", roleId: "printer_roll", header: { ...makeCard().header, bucket: "coming", customer: "Coming Co" } }),
    makeCard({ id: 2, workOrder: "2", roleId: "designer", returned: { reason: "Wrong size", by: "Erin" }, header: { ...makeCard().header, customer: "Back Co" } }),
    makeCard({ id: 3, workOrder: "3", roleId: "printer_roll", header: { ...makeCard().header, bucket: "rush_today", customer: "Rush Co" } }),
    makeCard({ id: 4, workOrder: "4", roleId: "printer_roll", status: "waiting", isNew: false, header: { ...makeCard().header, customer: "Later Co" } }),
  ];
  const seb = { ...staffUser, roles: ["printer_roll", "designer"] };

  it("groups cards: Returned first, then by time, then Up next", async () => {
    app({ user: seb, cards });
    renderApp("/my-cards");
    const groups = await screen.findAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Returned", "Rush / Today", "Coming", "Up next"]);
    expect(within(groups[0]).getByText("Back Co")).toBeInTheDocument();
    expect(within(groups[3]).getByText("Later Co")).toBeInTheDocument();
  });

  it("filters by role when the user has several", async () => {
    app({ user: seb, cards });
    renderApp("/my-cards");
    const tabs = await screen.findByRole("tablist");
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["All", "Designer", "Printer Roll"]);
    await userEvent.click(within(tabs).getByRole("tab", { name: "Designer" }));
    expect(screen.getByText("Back Co")).toBeInTheDocument();
    expect(screen.queryByText("Rush Co")).toBeNull();
  });

  it("opens a card", async () => {
    app({ cards: [makeCard()] });
    renderApp("/my-cards");
    await userEvent.click(await screen.findByRole("button", { name: /Laminate card, work order 91488/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("says so when there is nothing", async () => {
    app();
    renderApp("/my-cards");
    expect(await screen.findByText("No cards right now.")).toBeInTheDocument();
  });

  it("only managers see the Production Board link", async () => {
    app();
    renderApp("/my-cards");
    await screen.findByRole("heading", { name: "My Cards" });
    expect(screen.queryAllByRole("link", { name: "Production Board" })).toHaveLength(0);
  });

  it("managers get the Production Board link", async () => {
    mockApi({
      "GET /api/auth/me": () => managerUser,
      "GET /api/my-cards": () => [],
      "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true }),
    });
    renderApp("/my-cards");
    await screen.findByRole("heading", { name: "My Cards" });
    expect(screen.getAllByRole("link", { name: "Production Board" }).length).toBeGreaterThan(0);
  });
});
