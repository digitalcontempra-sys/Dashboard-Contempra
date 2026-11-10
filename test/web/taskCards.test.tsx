import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskCardDTO } from "../../src/shared/types";
import { playChime } from "../../src/web/cards/chime";
import { makeCard } from "./cardFixtures";
import { managerUser, mockApi, staffUser } from "./mockApi";
import { renderApp } from "./render";

vi.mock("../../src/web/cards/chime", () => ({ playChime: vi.fn(), armChime: vi.fn(), isAudioReady: () => true, onAudioReady: () => () => undefined }));
beforeEach(() => vi.mocked(playChime).mockClear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const task = (over: Partial<TaskCardDTO> = {}): TaskCardDTO => ({
  id: 3,
  from: { id: 9, name: "Seb Bastian" },
  to: { id: staffUser.id, name: staffUser.fullName },
  note: "Call the vendor about the banner stand",
  due: { kind: "today" },
  bucket: "rush_today",
  status: "open",
  createdAt: "2026-11-10T15:00:00Z",
  doneAt: null,
  isNew: true,
  ...over,
});

type H = (u: URL, init?: RequestInit) => unknown;
function app(extra: Record<string, H> = {}, user: object = staffUser) {
  return mockApi({
    "GET /api/auth/me": () => user,
    "GET /api/my-cards": () => [makeCard({ id: 1, workOrder: "1", roleId: "printer_roll", header: { ...makeCard().header, customer: "Docket Co" } })],
    "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true, newTasks: 0, doneTasks: 0 }),
    "GET /api/task-cards": (u) => (u.searchParams.get("box") === "sent" ? [] : [task()]),
    "GET /api/assignees": () => [
      { id: 5, fullName: "Erin Lee", roles: ["printer_roll"] },
      { id: staffUser.id, fullName: staffUser.fullName, roles: [] },
    ],
    ...extra,
  });
}

describe("New Task Card", () => {
  it("needs a person and a note, then sends", async () => {
    const { calls } = app({ "POST /api/task-cards": () => task({ id: 4 }) });
    renderApp("/my-cards");
    await userEvent.click(await screen.findByRole("button", { name: "New Task Card" }));
    const dialog = screen.getByRole("dialog", { name: "New Task Card" });
    const send = within(dialog).getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("To"), "eri");
    expect(within(dialog).queryByRole("option", { name: staffUser.fullName })).toBeNull();
    await userEvent.click(within(dialog).getByRole("option", { name: "Erin Lee" }));
    await userEvent.type(within(dialog).getByLabelText("Note"), "Call the vendor");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Today" }));
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.pathname === "/api/task-cards")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.url.pathname === "/api/task-cards")!.body).toEqual({
      toUserId: 5,
      note: "Call the vendor",
      due: { kind: "today" },
    });
    expect(await screen.findByText("Task sent to Erin")).toBeInTheDocument();
  });

  it("managers also have it on the Main Dashboard", async () => {
    mockApi({
      "GET /api/auth/me": () => managerUser,
      "GET /api/dockets": () => ({ items: [], total: 0, page: 1, pageSize: 50, counts: { rush_today: 0, this_week: 0, coming: 0, no_due_date: 0 } }),
      "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true }),
    });
    renderApp("/dashboard");
    expect(await screen.findByRole("button", { name: "New Task Card" })).toBeInTheDocument();
  });
});

describe("Task cards in My Cards", () => {
  it("the filter separates docket cards and task cards", async () => {
    app();
    renderApp("/my-cards");
    expect(await screen.findByText("Call the vendor about the banner stand")).toBeInTheDocument();
    expect(screen.getByText("Docket Co")).toBeInTheDocument();
    const filter = screen.getByRole("tablist", { name: "Show" });
    expect(within(filter).getAllByRole("tab").map((t) => t.textContent)).toEqual(["All", "Docket cards", "Task cards", "Sent by me"]);
    await userEvent.click(within(filter).getByRole("tab", { name: "Task cards" }));
    expect(screen.queryByText("Docket Co")).toBeNull();
    expect(screen.getByRole("button", { name: /Task from Seb/ })).toBeInTheDocument();
    await userEvent.click(within(filter).getByRole("tab", { name: "Docket cards" }));
    expect(screen.queryByText("Call the vendor about the banner stand")).toBeNull();
  });

  it("opening a task marks it seen; Done completes it", async () => {
    const { calls } = app({
      "POST /api/task-cards/3/seen": () => ({ ok: true }),
      "POST /api/task-cards/3/done": () => ({ ok: true }),
    });
    renderApp("/my-cards");
    await userEvent.click(await screen.findByRole("button", { name: /Task from Seb/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Call the vendor about the banner stand")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/task-cards/3/seen")).toBe(true));
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/task-cards/3/done")).toBe(true));
  });

  it("Sent by me shows status and lets you delete open ones", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const sent = [
      task({ id: 7, to: { id: 5, name: "Erin Lee" }, status: "done", doneAt: "2026-11-10T21:40:00Z", note: "Order vinyl" }),
      task({ id: 8, to: { id: 5, name: "Erin Lee" }, note: "Check the plotter" }),
    ];
    const { calls } = app({
      "GET /api/task-cards": (u) => (u.searchParams.get("box") === "sent" ? sent : []),
      "POST /api/task-cards/sent/seen": () => ({ ok: true }),
      "DELETE /api/task-cards/8": () => ({ ok: true }),
    });
    renderApp("/my-cards");
    await userEvent.click(await screen.findByRole("tab", { name: "Sent by me" }));
    expect(await screen.findByText("Done ✓ · Erin · Nov 10, 3:40 PM")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/task-cards/sent/seen")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.pathname === "/api/task-cards/8")).toBe(true));
  });
});

describe("task alerts", () => {
  it("a finished task you sent raises the badge without the chime", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const summaries = [
      { newCount: 0, doneTasks: 1 },
      { newCount: 1, doneTasks: 1 },
    ];
    let n = 0;
    app({ "GET /api/my-cards/summary": () => ({ activeCount: 0, soundOn: true, newTasks: 0, ...summaries[Math.min(n++, 1)] }) });
    renderApp("/my-cards");
    expect((await screen.findAllByLabelText("1 new card")).length).toBeGreaterThan(0);
    expect(playChime).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect((await screen.findAllByLabelText("2 new cards")).length).toBeGreaterThan(0);
    expect(playChime).toHaveBeenCalledTimes(1);
  });
});
