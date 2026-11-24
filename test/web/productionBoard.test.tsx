import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardDTO, CardEventDTO } from "../../src/shared/types";
import { DocketDetail } from "../../src/web/components/DocketDetail";
import { Providers } from "../../src/web/providers";
import { makeCard } from "./cardFixtures";
import { adminUser, managerUser, mockApi, staffUser } from "./mockApi";
import { renderApp } from "./render";

afterEach(() => vi.unstubAllGlobals());

const board = (over: Partial<BoardDTO> = {}): BoardDTO => ({
  columns: [
    { roleId: "designer", area: "Design", cards: [] },
    {
      roleId: "laminate_roll",
      area: "Laminate",
      cards: [
        { ...makeCard({ id: 1, workOrder: "1" }), noMembers: false },
        { ...makeCard({ id: 2, workOrder: "2", roleId: "laminate_roll" }), noMembers: true },
      ],
    },
  ],
  productionColumnsReady: true,
  productionColumnsSetUp: true,
  ...over,
});
const base = {
  "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true }),
  "GET /api/assignees": () => [{ id: 5, fullName: "Erin Lee", roles: ["printer_roll"] }],
};

describe("Production Board", () => {
  it("shows a column per area with counts", async () => {
    mockApi({ ...base, "GET /api/auth/me": () => managerUser, "GET /api/production-board": () => board() });
    renderApp("/production");
    expect(await screen.findByRole("heading", { name: "Laminate (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Design (0)" })).toBeInTheDocument();
    expect(screen.getByText("No one has this role")).toBeInTheDocument();
  });

  it("filters by person", async () => {
    const { calls } = mockApi({ ...base, "GET /api/auth/me": () => managerUser, "GET /api/production-board": () => board() });
    renderApp("/production");
    await screen.findByRole("heading", { name: "Laminate (2)" });
    await userEvent.selectOptions(screen.getByLabelText("Person"), "5");
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/production-board" && c.url.searchParams.get("user") === "5")).toBe(true));
  });

  it("search narrows the cards by work order, customer or person", async () => {
    mockApi({
      ...base,
      "GET /api/auth/me": () => managerUser,
      "GET /api/production-board": () =>
        board({
          columns: [
            {
              roleId: "laminate_roll",
              area: "Laminate",
              cards: [
                { ...makeCard({ id: 1, workOrder: "91480" }), noMembers: false },
                { ...makeCard({ id: 2, workOrder: "91290", header: { ...makeCard().header, customer: "Central Display" }, assigneeIds: [5] }), noMembers: false },
              ],
            },
          ],
        }),
    });
    renderApp("/production");
    await screen.findByRole("heading", { name: "Laminate (2)" });
    const search = screen.getByRole("searchbox", { name: "Search" });
    await userEvent.type(search, "central");
    expect(screen.getByRole("heading", { name: "Laminate (1)" })).toBeInTheDocument();
    expect(screen.getByText("#91290")).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "9148");
    expect(screen.getByText("#91480")).toBeInTheDocument();
    expect(screen.queryByText("#91290")).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, "erin");
    expect(screen.getByText("#91290")).toBeInTheDocument();
    expect(screen.queryByText("#91480")).toBeNull();
  });

  it("has a scroll bar above the columns that moves the board sideways", async () => {
    mockApi({ ...base, "GET /api/auth/me": () => managerUser, "GET /api/production-board": () => board() });
    renderApp("/production");
    await screen.findByRole("heading", { name: "Laminate (2)" });
    const bar = screen.getByRole("scrollbar", { name: "Scroll areas" });
    const board_ = document.getElementById(bar.getAttribute("aria-controls")!)!;
    Object.defineProperty(board_, "scrollWidth", { configurable: true, value: 2000 });
    Object.defineProperty(board_, "clientWidth", { configurable: true, value: 1000 });
    bar.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(board_.scrollLeft).toBeGreaterThan(0);
    await userEvent.keyboard("{End}");
    expect(board_.scrollLeft).toBe(1000);
  });

  it("tells the admin when the sheet columns are not set up", async () => {
    mockApi({ ...base, "GET /api/auth/me": () => adminUser, "GET /api/production-board": () => board({ productionColumnsReady: false }) });
    renderApp("/production");
    expect(await screen.findByText("Production columns are not set up in the Google Sheet yet.")).toBeInTheDocument();
  });

  it("is not open to Staff", async () => {
    mockApi({ ...base, "GET /api/auth/me": () => staffUser, "GET /api/my-cards": () => [] });
    renderApp("/production");
    expect(await screen.findByRole("heading", { name: "My Cards" })).toBeInTheDocument();
  });
});

const detail = {
  workOrder: "91488", customer: "Encore Lounge", project: "letters", accountManager: "JB", dateIso: "2026-11-05",
  dueIso: null, dueRaw: null, status: "active", billing: "not_billed", bucket: "no_due_date", overdue: false,
  sheetRow: 2, dateRaw: null, comp: false, hold: false, seq: null, address: null, roleNote: null, inv: false,
  invDateRaw: null, quotePo: null, notes: null, link: null, syncedAt: "",
  holders: [{ roleId: "measure", names: ["Cory"] }],
};
const history: CardEventDTO[] = [
  { at: "2026-11-09T20:14:00Z", area: "Print Roll", user: "Seb", action: "continued", detail: "Continue → Laminate" },
  { at: "2026-11-09T21:00:00Z", area: "Laminate", user: "Erin", action: "sent_back", detail: "Sent back to Design · Cut file missing" },
];

function showDetail(user: object) {
  const api = mockApi({
    "GET /api/auth/me": () => user,
    "GET /api/dockets/91488": () => detail,
    "GET /api/virtual-dockets/91488/history": () => history,
    "GET /api/virtual-dockets/91488/photos": () => ({ count: 2, folderLink: "https://drive.google.com/drive/folders/p" }),
    "POST /api/cards/7/restore": () => makeCard(),
    "GET /api/assignees": () => [{ id: 5, fullName: "Erin Lee", roles: ["printer_roll"] }],
    "GET /api/production-board": () =>
      board({
        columns: [{ roleId: "printer_roll", area: "Print Roll", cards: [{ ...makeCard({ roleId: "printer_roll", status: "done", assigneeIds: [5] }), noMembers: false }] }],
      }),
  });
  render(
    <MemoryRouter>
      <Providers>
        <DocketDetail workOrder="91488" onClose={() => undefined} />
      </Providers>
    </MemoryRouter>,
  );
  return api;
}

describe("Docket detail tabs", () => {
  it("managers see the History timeline", async () => {
    showDetail(managerUser);
    await userEvent.click(await screen.findByRole("tab", { name: "History" }));
    const list = await screen.findByRole("list", { name: "History" });
    expect(within(list).getByText(/Nov 9, 2:14 PM · Print Roll · Seb · Continue → Laminate/)).toBeInTheDocument();
    expect(within(list).getByText(/Sent back to Design · Cut file missing/)).toBeInTheDocument();
  });

  it("the header says who has the docket now", async () => {
    showDetail(staffUser);
    const now = await screen.findByLabelText("Now with");
    expect(within(now).getByText("Measure")).toBeInTheDocument();
    expect(within(now).getByText("Cory")).toBeInTheDocument();
  });

  it("managers see each step in the Production tab, with who has it", async () => {
    const { calls } = showDetail(managerUser);
    await userEvent.click(await screen.findByRole("tab", { name: "Production" }));
    expect(await screen.findByText("Print Roll")).toBeInTheDocument();
    expect(screen.getByText("Done ✓")).toBeInTheDocument();
    expect(await screen.findByText("Erin Lee")).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname === "/api/production-board")!.url.searchParams.get("wo")).toBe("91488");
    expect(await screen.findByRole("link", { name: "Photos (2)" })).toHaveAttribute("href", "https://drive.google.com/drive/folders/p");
    expect(screen.queryByRole("button", { name: /Restore/ })).toBeNull();
  });

  it("an admin restores a finished card", async () => {
    const { calls } = showDetail(adminUser);
    await userEvent.click(await screen.findByRole("tab", { name: "Production" }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore Print Roll card" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.pathname === "/api/cards/7/restore")).toBe(true));
  });

  it("Staff get no tabs", async () => {
    showDetail(staffUser);
    await screen.findByText("Encore Lounge");
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
  });
});

describe("Set up production columns", () => {
  it("needs SET UP typed, then posts the confirmation", async () => {
    const { calls } = mockApi({
      ...base,
      "GET /api/auth/me": () => adminUser,
      "GET /api/roles": () => [],
      "GET /api/users": () => [],
      "GET /api/google/status": () => ({ status: "connected", email: "x@y.z", sheetId: "s", sheetTitle: "T", tabName: "Contempra", connectedAt: null }),
      "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, rowsSeen: 0, rowsChanged: 0, rowsDeleted: 0, configured: true }),
      "GET /api/production-board": () => board({ productionColumnsReady: false, productionColumnsSetUp: false }),
      "POST /api/admin/production-columns": () => ({ archivedRows: 12 }),
    });
    renderApp("/admin/users");
    await userEvent.click(await screen.findByRole("button", { name: "Set up production columns" }));
    expect(screen.getByText(/copies columns Q–Y to a new "Legacy Q-Y" tab/)).toBeInTheDocument();
    const go = screen.getByRole("button", { name: "Set up" });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Type SET UP to continue"), "SET UP");
    await userEvent.click(go);
    expect(await screen.findByText("Done. 12 rows archived.")).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname === "/api/admin/production-columns")!.body).toEqual({ confirm: "SET UP" });
  });

  it("a sheet set up before says it only updates, leaving Legacy Q-Y alone", async () => {
    mockApi({
      ...base,
      "GET /api/auth/me": () => adminUser,
      "GET /api/roles": () => [],
      "GET /api/users": () => [],
      "GET /api/google/status": () => ({ status: "connected", email: "x@y.z", sheetId: "s", sheetTitle: "T", tabName: "Contempra", connectedAt: null }),
      "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, rowsSeen: 0, rowsChanged: 0, rowsDeleted: 0, configured: true }),
      "GET /api/production-board": () => board({ productionColumnsReady: false, productionColumnsSetUp: true }),
    });
    renderApp("/admin/users");
    expect(await screen.findByText("The Google Sheet needs the latest production columns.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set up production columns" }));
    expect(screen.getByText(/updates the production headers and rewrites them from the cards\. The "Legacy Q-Y" tab is not touched\./)).toBeInTheDocument();
    expect(screen.queryByText(/copies columns Q–Y/)).not.toBeInTheDocument();
  });
});
