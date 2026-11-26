import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyForm } from "../../src/shared/docketForm";
import { adminUser, managerUser, mockApi } from "./mockApi";
import { renderApp } from "./render";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const list = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 50,
  counts: { rush_today: 0, upcoming: 0, new_orders: 0, no_due_date: 0, daily_complete: 0 },
};
const dashboard = (me: object) =>
  mockApi({
    "GET /api/auth/me": () => me,
    "GET /api/dockets": () => list,
    "GET /api/account-managers": () => [],
    "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, configured: true }),
  });
const docketCalls = (calls: { url: URL }[]) => calls.filter((c) => c.url.pathname === "/api/dockets");

describe("My Dockets on the Main Dashboard", () => {
  it("switches between All dockets and My Dockets, and remembers it per user", async () => {
    const { calls } = dashboard(managerUser);
    const { unmount } = renderApp("/dashboard");
    const all = await screen.findByRole("tab", { name: "All dockets" });
    expect(all).toHaveAttribute("aria-selected", "true");
    expect(docketCalls(calls).every((c) => !c.url.searchParams.has("mine"))).toBe(true);
    await userEvent.click(screen.getByRole("tab", { name: "My Dockets" }));
    await waitFor(() => expect(docketCalls(calls).at(-1)!.url.searchParams.get("mine")).toBe("1"));
    unmount();

    const again = dashboard(managerUser);
    renderApp("/dashboard");
    expect(await screen.findByRole("tab", { name: "My Dockets" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(docketCalls(again.calls)[0].url.searchParams.get("mine")).toBe("1"));
  });

  it("without codes, My Dockets asks for initials", async () => {
    dashboard({ ...managerUser, codes: [] });
    renderApp("/dashboard");
    await userEvent.click(await screen.findByRole("tab", { name: "My Dockets" }));
    expect(await screen.findByText("Ask an admin to set your initials.")).toBeInTheDocument();
  });
});

const lists = {
  "GET /api/assignees": () => [],
  "GET /api/teams": () => [],
  "GET /api/virtual-dockets/next-number": () => ({ workOrder: "91500" }),
};

describe("Salesperson in the docket editor", () => {
  it("a new docket shows my main code, read-only", async () => {
    mockApi({ ...lists, "GET /api/auth/me": () => ({ ...managerUser, codes: ["DA", "DB"] }) });
    renderApp("/dockets/new");
    const sp = await screen.findByRole("textbox", { name: "SALESPERSON" });
    expect(sp).toHaveValue("DA");
    expect(sp).toHaveAttribute("readonly");
  });

  it("without codes the docket cannot be saved", async () => {
    mockApi({ ...lists, "GET /api/auth/me": () => ({ ...managerUser, codes: [] }) });
    renderApp("/dockets/new");
    expect(await screen.findByText("Ask an admin to set your initials first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("an existing docket keeps its salesperson, read-only", async () => {
    mockApi({
      ...lists,
      "GET /api/auth/me": () => managerUser,
      "GET /api/virtual-dockets/91488": () => ({
        workOrder: "91488",
        form: { ...emptyForm("2026-11-05", "x"), forName: "Co", salesperson: "CF" },
        jobs: [],
        inProduction: true,
        newOrder: false,
        version: 1,
        source: "virtual",
        pdf: { stored: true, driveLink: null, driveStatus: "done" },
        deletedAt: null,
        sheet: { notes: null },
      }),
    });
    renderApp("/dockets/91488");
    const sp = await screen.findByRole("textbox", { name: "SALESPERSON" });
    expect(sp).toHaveValue("CF");
    expect(sp).toHaveAttribute("readonly");
  });
});

describe("Initials in Admin → Users", () => {
  it("shows them and saves them from the Edit form", async () => {
    const { calls } = mockApi({
      "GET /api/auth/me": () => adminUser,
      "GET /api/roles": () => [],
      "GET /api/google/status": () => ({ connected: true, email: "o@x.com", sheetUrl: null }),
      "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null }),
      "GET /api/users": () => [{ id: 6, username: "ali", fullName: "Ali", accessLevel: "manager", roles: [], active: true, codes: ["AR", "ALI"] }],
      "PATCH /api/users/6": () => ({ id: 6, username: "ali", fullName: "Ali", accessLevel: "manager", roles: [], active: true, codes: ["AR"] }),
    });
    renderApp("/admin/users");
    const row = (await screen.findByText("Ali")).closest("li")!;
    expect(within(row).getByText("Initials: AR, ALI")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Edit Ali" }));
    const box = within(await screen.findByRole("dialog")).getByLabelText("Initials");
    expect(box).toHaveValue("AR, ALI");
    await userEvent.clear(box);
    await userEvent.type(box, "ar");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ codes: ["AR"] }));
  });
});
