import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyForm } from "../../src/shared/docketForm";
import { managerUser, mockApi, staffUser } from "./mockApi";
import { renderApp } from "./render";

vi.mock("../../src/web/docket/renderPdf", () => ({ renderDocketPdf: vi.fn(async () => new Blob(["%PDF"])) }));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const lists = {
  "GET /api/roles": () => [
    { id: "designer", label: "Designer" },
    { id: "printer_roll", label: "Printer Roll" },
  ],
  "GET /api/assignees": () => [{ id: 7, fullName: "Ana Lopez", roles: ["designer"] }],
  "GET /api/account-managers": () => [{ accountManager: "JB", count: 3 }],
};

const saved = (form: unknown) => ({
  workOrder: "91488",
  form,
  jobs: [{ name: "Whole docket", steps: [] }],
  version: 1,
  source: "virtual",
  pdf: { stored: false, driveLink: null, driveStatus: "none" },
  deletedAt: null,
});

describe("New Docket", () => {
  it("posts what was typed on the paper and the default job", async () => {
    const { calls } = mockApi({
      ...lists,
      "GET /api/auth/me": () => managerUser,
      "POST /api/virtual-dockets": (_u, init) => saved(JSON.parse(String(init?.body)).form),
      "GET /api/virtual-dockets/91488": () => saved(emptyForm("2026-11-05", "x")),
      "PUT /api/virtual-dockets/91488/pdf": () => ({ ok: true }),
    });
    renderApp("/dockets/new");
    await userEvent.type(await screen.findByLabelText("FOR"), "Encore Lounge");
    await userEvent.type(screen.getByLabelText("Job details"), "exterior letters?");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const body = calls.find((c) => c.method === "POST")!.body as { form: { forName: string; body: string }; jobs: { name: string }[] };
    expect(body.form.forName).toBe("Encore Lounge");
    expect(body.form.body).toBe("exterior letters?");
    expect(body.jobs[0].name).toBe("Whole docket");
  });

  it("adds up the grand total with GST and PST", async () => {
    mockApi({ ...lists, "GET /api/auth/me": () => managerUser });
    renderApp("/dockets/new");
    await userEvent.type(await screen.findByLabelText("COST 1"), "100");
    await userEvent.type(screen.getByLabelText("COST 2"), "50.50");
    await userEvent.type(screen.getByLabelText("DELIVERY"), "10");
    expect(screen.getByTestId("grand-total")).toHaveTextContent("$179.77");
  });

  it("offers to restore a local draft", async () => {
    localStorage.setItem(
      "docket-draft:new",
      JSON.stringify({ form: { ...emptyForm("2026-11-05", "x"), forName: "Draft Co" }, jobs: [], savedAt: Date.now() }),
    );
    mockApi({ ...lists, "GET /api/auth/me": () => managerUser });
    renderApp("/dockets/new");
    expect(await screen.findByText("Restore draft?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByLabelText("FOR")).toHaveValue("Draft Co");
  });

  it("keeps the form when the sheet write fails", async () => {
    mockApi({
      ...lists,
      "GET /api/auth/me": () => managerUser,
      "POST /api/virtual-dockets": () =>
        Response.json({ error: "Could not save to Google Sheet. Nothing was saved. Try again." }, { status: 502 }),
    });
    renderApp("/dockets/new");
    await userEvent.type(await screen.findByLabelText("FOR"), "Encore Lounge");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not save to Google Sheet. Nothing was saved. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("FOR")).toHaveValue("Encore Lounge");
  });
});

describe("Staff view", () => {
  it("shows the docket read-only with no prices", async () => {
    mockApi({
      ...lists,
      "GET /api/auth/me": () => staffUser,
      "GET /api/virtual-dockets/91488": () => saved({ ...emptyForm("2026-11-05", "x"), forName: "Encore Lounge" }),
    });
    renderApp("/dockets/91488");
    expect(await screen.findByLabelText("FOR")).toHaveValue("Encore Lounge");
    expect(screen.getByLabelText("FOR")).toHaveAttribute("readonly");
    expect(screen.queryByLabelText("COST 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

describe("drafts and leaving", () => {
  it("a restored draft keeps the version it was written against", async () => {
    localStorage.setItem(
      "docket-draft:91488",
      JSON.stringify({ form: { ...emptyForm("2026-11-05", "x"), forName: "Old Draft" }, jobs: [], version: 3, savedAt: Date.now() }),
    );
    const { calls } = mockApi({
      ...lists,
      "GET /api/auth/me": () => managerUser,
      "GET /api/virtual-dockets/91488": () => ({ ...saved({ ...emptyForm("2026-11-05", "x"), forName: "Newer" }), version: 4 }),
      "PUT /api/virtual-dockets/91488": () => Response.json({ error: "This docket was changed by boss. Reload to see the latest version." }, { status: 409 }),
    });
    renderApp("/dockets/91488");
    await userEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT" && c.url.pathname === "/api/virtual-dockets/91488")?.body).toMatchObject({ version: 3 }),
    );
  });

  it("asks before leaving with unsaved changes", async () => {
    mockApi({ ...lists, "GET /api/auth/me": () => managerUser });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp("/dockets/new");
    await userEvent.type(await screen.findByLabelText("FOR"), "Half typed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalledWith("Leave without saving? Your changes will be lost.");
    expect(screen.getByLabelText("FOR")).toHaveValue("Half typed");
    confirm.mockRestore();
  });
});
});

describe("number preview and totals", () => {
  it("shows the next work order number before saving", async () => {
    mockApi({ ...lists, "GET /api/auth/me": () => managerUser, "GET /api/virtual-dockets/next-number": () => ({ workOrder: "91488" }) });
    renderApp("/dockets/new");
    await waitFor(() => expect(screen.getByTestId("work-order")).toHaveTextContent("91488"));
  });

  it("lets editors type the TOTAL", async () => {
    mockApi({ ...lists, "GET /api/auth/me": () => managerUser });
    renderApp("/dockets/new");
    await userEvent.type(await screen.findByLabelText("TOTAL"), "500");
    expect(screen.getByTestId("grand-total")).toHaveTextContent("$560.00");
  });
});

describe("money formatting", () => {
  it("shows typed amounts as $ with two decimals when leaving the field", async () => {
    mockApi({ ...lists, "GET /api/auth/me": () => managerUser });
    renderApp("/dockets/new");
    const total = await screen.findByLabelText("TOTAL");
    await userEvent.type(total, "1222");
    await userEvent.tab();
    expect(total).toHaveValue("$1,222.00");
    await userEvent.type(screen.getByLabelText("COST 1"), "50.5");
    await userEvent.tab();
    expect(screen.getByLabelText("COST 1")).toHaveValue("$50.50");
  });
});
