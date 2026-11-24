import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyForm, type DocketForm } from "../../src/shared/docketForm";
import { CardView } from "../../src/web/cards/CardView";
import { renderDocketPdf } from "../../src/web/docket/renderPdf";
import { Providers } from "../../src/web/providers";
import { makeCard } from "./cardFixtures";
import { managerUser, mockApi, staffUser } from "./mockApi";

vi.mock("../../src/web/docket/renderPdf", () => ({ renderDocketPdf: vi.fn(async () => new Blob(["%PDF-1.7"])) }));

const form = (): DocketForm => {
  const f = emptyForm("2026-11-05", "Kristy");
  f.forName = "Encore Lounge";
  f.contact = "Dana";
  f.phone = "204-555-0101";
  f.required = { kind: "date", date: "2026-11-20" };
  f.body = "Exterior letters\nInterior sign";
  f.address = "123 Main St";
  f.salesperson = "JB";
  f.quoteNo = "1234";
  f.materials[0] = { name: "IJ35 vinyl", cost: "" };
  f.labour[0] = { name: "Pat", work: "Install", hrs: "3", date: "2026-11-21" };
  f.service = ["INSTALLATION"];
  return f;
};
const dto = (over: Record<string, unknown> = {}) => ({
  workOrder: "91488",
  form: form(),
  jobs: [],
  inProduction: true,
  version: 2,
  source: "virtual",
  pdf: { stored: true, driveLink: null, driveStatus: "done" },
  deletedAt: null,
  sheet: { notes: "Call before going" },
  ...over,
});

let opened: { location: { href: string }; close: () => void };
beforeEach(() => {
  vi.mocked(renderDocketPdf).mockClear();
  opened = { location: { href: "" }, close: vi.fn() };
  vi.spyOn(window, "open").mockImplementation(() => opened as unknown as Window);
  URL.createObjectURL = vi.fn(() => "blob:pdf");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function show(user = staffUser, docket = dto()) {
  mockApi({
    "GET /api/auth/me": () => user,
    "POST /api/cards/7/seen": () => ({ ok: true }),
    "GET /api/virtual-dockets/91488": () => docket,
  });
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <Providers>
        <CardView card={makeCard()} onClose={onClose} />
      </Providers>
    </MemoryRouter>,
  );
  return { onClose };
}

async function openPanel() {
  await userEvent.click(screen.getByRole("button", { name: "Read Docket" }));
  return screen.findByRole("dialog", { name: "Docket 91488" });
}

describe("Read Docket", () => {
  it("the card keeps only a Read Docket button; the panel lists the docket grouped and read-only", async () => {
    show();
    expect(screen.queryByText("Exterior letters")).toBeNull();
    const panel = await openPanel();
    const p = within(panel);
    expect(await p.findByText("Encore Lounge")).toBeInTheDocument();
    for (const h of ["Customer", "Dates", "Work", "Address & service", "Order", "Notes"]) expect(p.getByRole("heading", { name: h })).toBeInTheDocument();
    expect(p.getByText(/Exterior letters/)).toHaveTextContent("Exterior letters Interior sign");
    expect(p.getByText("IJ35 vinyl")).toBeInTheDocument();
    expect(p.getByText(/Pat · Install · 3 h · Nov 21, 2026/)).toBeInTheDocument();
    expect(p.getByText("123 Main St")).toBeInTheDocument();
    expect(p.getByText("Nov 20, 2026")).toBeInTheDocument();
    expect(p.getByText("Installation")).toBeInTheDocument();
    expect(p.getByText("Call before going")).toBeInTheDocument();
    expect(p.queryByText("Link")).toBeNull();
    expect(p.queryByRole("textbox")).toBeNull();
    expect(panel.textContent).not.toMatch(/\$|Total|GST|PST|Deposit/);
  });

  it("never shows prices, even to a manager whose docket has them", async () => {
    const priced = form();
    priced.materials[0] = { name: "IJ35 vinyl", cost: "$100.00" };
    priced.deposit = "$50.00";
    priced.delivery = "$20.00";
    show(managerUser, dto({ form: priced }));
    const panel = await openPanel();
    await within(panel).findByText("IJ35 vinyl");
    // No Drive link in the dashboard: the sheet's LINK column keeps it.
    expect(within(panel).queryByText("Link")).toBeNull();
    expect(within(panel).queryByRole("link")).toBeNull();
    expect(panel.textContent).not.toMatch(/\$|100|Deposit/);
  });

  it("an incomplete stored form still opens", async () => {
    show(staffUser, dto({ form: { forName: "Tartan Towing", proofRequired: true } }));
    const panel = await openPanel();
    expect(await within(panel).findByText("Tartan Towing")).toBeInTheDocument();
    expect(within(panel).getByText("Yes")).toBeInTheDocument();
  });

  it("Escape closes the panel but not the card", async () => {
    const { onClose } = show();
    await openPanel();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Docket 91488" })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Read Docket" })).toBeInTheDocument();
  });

  it("View PDF gives Staff a fresh copy without prices", async () => {
    show();
    const panel = await openPanel();
    await within(panel).findByText("Encore Lounge");
    await userEvent.click(within(panel).getByRole("button", { name: "View PDF" }));
    await waitFor(() => expect(opened.location.href).toBe("blob:pdf"));
    expect(renderDocketPdf).toHaveBeenCalledWith(expect.objectContaining({ forName: "Encore Lounge" }), "91488", false);
  });

  it("a blocked PDF tab shows a message and keeps the card open", async () => {
    vi.mocked(window.open).mockImplementation(() => null);
    const { onClose } = show();
    const panel = await openPanel();
    await within(panel).findByText("Encore Lounge");
    await userEvent.click(within(panel).getByRole("button", { name: "View PDF" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("blocked the PDF tab");
    expect(renderDocketPdf).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("View PDF opens the stored PDF for a manager", async () => {
    show(managerUser);
    const panel = await openPanel();
    await within(panel).findByText("Encore Lounge");
    await userEvent.click(within(panel).getByRole("button", { name: "View PDF" }));
    await waitFor(() => expect(opened.location.href).toBe("/api/virtual-dockets/91488/pdf"));
    expect(renderDocketPdf).not.toHaveBeenCalled();
  });
});
