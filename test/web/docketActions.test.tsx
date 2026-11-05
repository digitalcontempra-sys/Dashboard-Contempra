import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyForm } from "../../src/shared/docketForm";
import { renderDocketPdf } from "../../src/web/docket/renderPdf";
import { adminUser, managerUser, mockApi, staffUser } from "./mockApi";
import { renderApp } from "./render";

vi.mock("../../src/web/docket/renderPdf", () => ({ renderDocketPdf: vi.fn(async () => new Blob(["%PDF-1.7"])) }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(renderDocketPdf).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const form = { ...emptyForm("2026-11-05", "x"), forName: "Encore Lounge" };
const dto = (over: Record<string, unknown> = {}) => ({
  workOrder: "91488",
  form,
  jobs: [{ name: "Whole docket", steps: [] }],
  version: 1,
  source: "virtual",
  pdf: { stored: true, driveLink: "https://drive.google.com/file/d/f1/view", driveStatus: "done" },
  deletedAt: null,
  ...over,
});
const lists = {
  "GET /api/roles": () => [],
  "GET /api/assignees": () => [],
  "GET /api/account-managers": () => [],
};
const detail = {
  workOrder: "91488", customer: "Encore Lounge", project: "letters", accountManager: "JB", dateIso: "2026-11-05",
  dueIso: null, dueRaw: null, status: "active", billing: "not_billed", bucket: "no_due_date", overdue: false,
  sheetRow: 2, dateRaw: null, comp: false, hold: false, seq: null, address: null, roleNote: null, inv: false,
  invDateRaw: null, quotePo: null, notes: null, link: null, syncedAt: "",
};
const dashboard = {
  "GET /api/dockets": () => ({
    items: [detail],
    total: 1,
    page: 1,
    pageSize: 50,
    counts: { rush_today: 0, this_week: 0, coming: 0, no_due_date: 1 },
  }),
  "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, rowsSeen: 0, rowsChanged: 0, rowsDeleted: 0, configured: true }),
  "GET /api/dockets/91488": () => detail,
};

describe("PDF after save", () => {
  it("uploads the rendered PDF after a new docket is saved", async () => {
    const { calls } = mockApi({
      ...lists,
      "GET /api/auth/me": () => managerUser,
      "POST /api/virtual-dockets": () => dto({ pdf: { stored: false, driveLink: null, driveStatus: "none" } }),
      "GET /api/virtual-dockets/91488": () => dto(),
      "PUT /api/virtual-dockets/91488/pdf": () => ({ ok: true }),
    });
    renderApp("/dockets/new");
    await userEvent.type(await screen.findByLabelText("FOR"), "Encore Lounge");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.pathname === "/api/virtual-dockets/91488/pdf")).toBe(true));
    expect(renderDocketPdf).toHaveBeenCalledWith(expect.objectContaining({ forName: "Encore Lounge" }), "91488", true);
  });

  it("regenerates a missing PDF when a manager opens the docket", async () => {
    const { calls } = mockApi({
      ...lists,
      "GET /api/auth/me": () => managerUser,
      "GET /api/virtual-dockets/91488": () => dto({ pdf: { stored: false, driveLink: null, driveStatus: "none" } }),
      "PUT /api/virtual-dockets/91488/pdf": () => ({ ok: true }),
    });
    renderApp("/dockets/91488");
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  });
});

describe("Docket actions", () => {
  it("staff can download a PDF but not edit, cancel or delete", async () => {
    mockApi({ ...lists, "GET /api/auth/me": () => staffUser, "GET /api/virtual-dockets/91488": () => dto() });
    renderApp("/dockets/91488");
    expect(await screen.findByRole("button", { name: "Download PDF" })).toBeInTheDocument();
    for (const name of ["Edit", "Cancel docket", "Delete", "Save"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("the card detail offers Open Docket, Drive and Cancel to managers", async () => {
    mockApi({ ...lists, ...dashboard, "GET /api/auth/me": () => managerUser, "GET /api/virtual-dockets/91488": () => dto() });
    renderApp("/dashboard");
    await userEvent.click(await screen.findByText("Encore Lounge"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Open Docket" })).toHaveAttribute("href", "/dockets/91488");
    expect(await within(dialog).findByRole("link", { name: "Open in Drive" })).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/f1/view",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel docket" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("delete stays disabled until the work order is typed", async () => {
    const { calls } = mockApi({
      ...lists,
      ...dashboard,
      "GET /api/auth/me": () => adminUser,
      "GET /api/virtual-dockets/91488": () => dto(),
      "DELETE /api/virtual-dockets/91488": () => ({ ok: true }),
    });
    renderApp("/dashboard");
    await userEvent.click(await screen.findByText("Encore Lounge"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Type 91488 to confirm"), "91488");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ confirm: "91488" }));
  });
});

describe("Trash", () => {
  it("restores a docket", async () => {
    const { calls } = mockApi({
      "GET /api/auth/me": () => adminUser,
      "GET /api/trash": () => [{ workOrder: "91400", forName: "Old Co", deletedAt: "2026-11-01T10:00:00Z", deletedBy: "boss", daysLeft: 26 }],
      "POST /api/virtual-dockets/91400/restore": () => ({ ok: true }),
    });
    renderApp("/admin/trash");
    expect(await screen.findByText("26 days left")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/restore"))).toBe(true));
  });

  it("shows an empty state", async () => {
    mockApi({ "GET /api/auth/me": () => adminUser, "GET /api/trash": () => [] });
    renderApp("/admin/trash");
    expect(await screen.findByText("Trash is empty.")).toBeInTheDocument();
  });
});
