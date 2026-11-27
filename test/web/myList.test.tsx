import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskCardDTO } from "../../src/shared/types";
import { managerUser, mockApi } from "./mockApi";
import { renderApp } from "./render";

vi.mock("../../src/web/cards/chime", () => ({ playChime: vi.fn(), armChime: vi.fn(), isAudioReady: () => true, onAudioReady: () => () => undefined }));
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const item = (over: Record<string, unknown> = {}) => ({
  workOrder: "91487",
  customer: "Tartan Towing",
  project: "Decals",
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
  followed: false,
  myOpenNotes: 0,
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  ...item(over),
  sheetRow: 2,
  dateRaw: null,
  comp: false,
  hold: false,
  seq: "7",
  address: null,
  roleNote: null,
  inv: false,
  invDateRaw: null,
  quotePo: null,
  notes: null,
  link: null,
  syncedAt: "2026-11-01T00:00:00Z",
});
const note = (over: Partial<TaskCardDTO> = {}): TaskCardDTO => ({
  id: 7,
  from: { id: managerUser.id, name: managerUser.fullName },
  to: { id: managerUser.id, name: managerUser.fullName },
  note: "Ask about the vinyl colour",
  due: { kind: "none" },
  bucket: "no_due_date",
  status: "open",
  createdAt: "2026-11-20T15:00:00Z",
  doneAt: null,
  isNew: false,
  workOrder: "91487",
  ...over,
});

type H = (u: URL, init?: RequestInit) => unknown;
function dashboard(items: object[], extra: Record<string, H> = {}) {
  return mockApi({
    "GET /api/auth/me": () => managerUser,
    "GET /api/dockets": () => ({
      items,
      total: items.length,
      page: 1,
      pageSize: 50,
      counts: { rush_today: 0, upcoming: items.length, new_orders: 0, no_due_date: 0, daily_complete: 0 },
    }),
    "GET /api/account-managers": () => [],
    "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, configured: true }),
    "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true, newTasks: 0, doneTasks: 0 }),
    "GET /api/assignees": () => [],
    ...extra,
  });
}
const docketCalls = (calls: { url: URL }[]) => calls.filter((c) => c.url.pathname === "/api/dockets");

describe("My List", () => {
  it("is a third scope that lists followed dockets, remembered per user", async () => {
    const { calls } = dashboard([]);
    const { unmount } = renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("tab", { name: "My List" }));
    await waitFor(() => expect(docketCalls(calls).at(-1)!.url.searchParams.get("list")).toBe("1"));
    expect(docketCalls(calls).at(-1)!.url.searchParams.has("mine")).toBe(false);
    expect(await screen.findByText("Your list is empty. Tap the bookmark on a docket to add it.")).toBeInTheDocument();
    unmount();
    dashboard([]);
    renderApp("/dashboard");
    expect(await screen.findByRole("tab", { name: "My List" })).toHaveAttribute("aria-selected", "true");
  });

  it("the bookmark on a tile adds and removes the docket in one tap", async () => {
    const { calls } = dashboard([item()], {
      "PUT /api/dockets/91487/follow": () => ({ followed: true }),
      "DELETE /api/dockets/91487/follow": () => ({ followed: false }),
    });
    renderApp("/dashboard");
    const add = await screen.findByRole("button", { name: "Add to My List" });
    await userEvent.click(add);
    const remove = await screen.findByRole("button", { name: "Remove from My List" });
    expect(calls.some((c) => c.method === "PUT" && c.url.pathname === "/api/dockets/91487/follow")).toBe(true);
    await userEvent.click(remove);
    await screen.findByRole("button", { name: "Add to My List" });
    expect(calls.some((c) => c.method === "DELETE" && c.url.pathname === "/api/dockets/91487/follow")).toBe(true);
    // The tile itself was not opened.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the docket detail has the bookmark too", async () => {
    dashboard([item({ followed: true })], { "GET /api/dockets/91487": () => detail({ followed: true }), "GET /api/task-cards": () => [] });
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: /Work order 91487/ }));
    const dialog = await screen.findByRole("dialog", { name: "Work order 91487" });
    expect(await within(dialog).findByRole("button", { name: "Remove from My List" })).toBeInTheDocument();
  });
});

describe("Notes pinned to a docket", () => {
  it("the note button opens New Task Card to Me with the docket linked", async () => {
    const { calls } = dashboard([item()], { "POST /api/task-cards": () => note() });
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: "Add a note to #91487" }));
    const dialog = screen.getByRole("dialog", { name: "New Task Card" });
    expect(within(dialog).getByText(`Me (${managerUser.fullName})`)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Change" })).toBeNull();
    expect(within(dialog).getByText("Docket #91487")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Note"), "Ask about vinyl");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const sent = calls.find((c) => c.method === "POST" && c.url.pathname === "/api/task-cards")!;
    expect(sent.body).toMatchObject({ toUserId: managerUser.id, note: "Ask about vinyl", workOrder: "91487" });
  });

  it("a tile with my open notes shows the yellow mark with the count", async () => {
    dashboard([item({ myOpenNotes: 2 })]);
    renderApp("/dashboard");
    const btn = await screen.findByRole("button", { name: "Add a note to #91487 (2 open notes)" });
    expect(btn).toHaveTextContent("2");
  });

  it("the detail shows my notes as stickies with Done", async () => {
    const { calls } = dashboard([item({ myOpenNotes: 1 })], {
      "GET /api/dockets/91487": () => detail({ myOpenNotes: 1 }),
      "GET /api/task-cards": (u) => (u.searchParams.get("workOrder") === "91487" ? [note()] : []),
      "POST /api/task-cards/7/done": () => ({ ok: true }),
    });
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("button", { name: /Work order 91487/ }));
    const dialog = await screen.findByRole("dialog", { name: "Work order 91487" });
    const notes = await within(dialog).findByRole("list", { name: "My notes" });
    expect(within(notes).getByText("Ask about the vinyl colour")).toBeInTheDocument();
    await userEvent.click(within(notes).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.pathname === "/api/task-cards/7/done")).toBe(true));
  });
});

describe("Pinned notes in My Cards", () => {
  it("show the work order and open the docket", async () => {
    mockApi({
      "GET /api/auth/me": () => managerUser,
      "GET /api/my-cards": () => [],
      "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true, newTasks: 0, doneTasks: 0 }),
      "GET /api/task-cards": (u) => (u.searchParams.get("workOrder") ? [] : [note()]),
      "POST /api/task-cards/7/seen": () => ({ ok: true }),
      "GET /api/dockets/91487": () => detail(),
    });
    renderApp("/my-cards");
    const tile = await screen.findByRole("button", { name: /Note to self/ });
    expect(within(tile).getByText("#91487")).toBeInTheDocument();
    await userEvent.click(tile);
    const view = screen.getByRole("dialog", { name: "Note to self" });
    await userEvent.click(within(view).getByRole("button", { name: "Docket #91487" }));
    expect(await screen.findByRole("dialog", { name: "Work order 91487" })).toBeInTheDocument();
  });
});
