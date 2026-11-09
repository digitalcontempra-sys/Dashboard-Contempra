import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardDTO, CardEventDTO } from "../../src/shared/types";
import { DocketDetail } from "../../src/web/components/DocketDetail";
import { ProductionPanel } from "../../src/web/docket/ProductionPanel";
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
    "GET /api/production-board": () =>
      board({ columns: [{ roleId: "printer_roll", area: "Print Roll", cards: [{ ...makeCard({ roleId: "printer_roll", status: "done" }), noMembers: false }] }] }),
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

  it("managers see each step in the Production tab", async () => {
    const { calls } = showDetail(managerUser);
    await userEvent.click(await screen.findByRole("tab", { name: "Production" }));
    expect(await screen.findByText("Print Roll")).toBeInTheDocument();
    expect(screen.getByText("Done ✓")).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname === "/api/production-board")!.url.searchParams.get("wo")).toBe("91488");
  });

  it("Staff get no tabs", async () => {
    showDetail(staffUser);
    await screen.findByText("Encore Lounge");
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
  });
});

describe("Route chips", () => {
  it("say Team when no one is picked, or the names", () => {
    const roles = [{ id: "printer_roll", label: "Printer Roll" }];
    const assignees = [{ id: 5, fullName: "Erin Lee", roles: ["printer_roll"] }];
    const { rerender } = render(
      <ProductionPanel jobs={[{ name: "Whole docket", steps: [{ roleId: "printer_roll", assigneeIds: [] }] }]} onChange={() => undefined} roles={roles} assignees={assignees} />,
    );
    expect(screen.getByText("Printer Roll · Team")).toBeInTheDocument();
    rerender(
      <ProductionPanel jobs={[{ name: "Whole docket", steps: [{ roleId: "printer_roll", assigneeIds: [5] }] }]} onChange={() => undefined} roles={roles} assignees={assignees} />,
    );
    expect(screen.getByText("Printer Roll · Erin")).toBeInTheDocument();
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
      "GET /api/production-board": () => board({ productionColumnsReady: false }),
      "POST /api/admin/production-columns": () => ({ archivedRows: 12 }),
    });
    renderApp("/admin/users");
    await userEvent.click(await screen.findByRole("button", { name: "Set up production columns" }));
    const go = screen.getByRole("button", { name: "Set up" });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Type SET UP to continue"), "SET UP");
    await userEvent.click(go);
    expect(await screen.findByText("Done. 12 rows archived.")).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname === "/api/admin/production-columns")!.body).toEqual({ confirm: "SET UP" });
  });
});
