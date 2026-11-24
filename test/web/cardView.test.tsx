import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardDTO } from "../../src/shared/types";
import { CardView } from "../../src/web/cards/CardView";
import { Providers } from "../../src/web/providers";
import { makeCard } from "./cardFixtures";
import { mockApi, staffUser } from "./mockApi";

afterEach(() => vi.unstubAllGlobals());

function show(card: CardDTO, extra: Record<string, (u: URL, init?: RequestInit) => unknown> = {}) {
  const api = mockApi({
    "GET /api/auth/me": () => staffUser,
    "POST /api/cards/7/seen": () => ({ ok: true }),
    "PUT /api/cards/7/fields": (_u, init) => ({ ...card, fields: JSON.parse(String(init?.body)).fields, version: card.version + 1 }),
    ...extra,
  });
  const onClose = vi.fn();
  const { unmount } = render(
    <MemoryRouter>
      <Providers>
        <CardView card={card} onClose={onClose} />
      </Providers>
    </MemoryRouter>,
  );
  return { ...api, onClose, unmount };
}

const people = () => [
  { id: 4, fullName: "Pat", roles: ["finishing"] },
  { id: 5, fullName: "Kristy", roles: [] },
];
const handed = (over: Partial<CardDTO> = {}) =>
  makeCard({ handoff: true, earlier: [], nextRoleId: null, instruction: "Laminate 2 banners", from: { id: 3, name: "Mike" }, ...over });

describe("CardView", () => {
  it("Continue and Done wait for the area's required fields", async () => {
    const { calls } = show(makeCard());
    const next = screen.getByRole("button", { name: "Continue →" });
    const done = screen.getByRole("button", { name: "Done" });
    expect(next).toBeDisabled();
    expect(done).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent('Mark "Laminated" to continue');
    await userEvent.click(screen.getByRole("checkbox", { name: "Laminated" }));
    expect(next).toBeEnabled();
    expect(done).toBeEnabled();
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true), { timeout: 2500 });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url.pathname).toBe("/api/cards/7/fields");
    expect(put.body).toEqual({ fields: { laminated: true }, version: 0 });
  });

  it("closing right after an edit still saves it", async () => {
    const { calls, unmount } = show(makeCard());
    await userEvent.click(screen.getByRole("checkbox", { name: "Laminated" }));
    unmount(); // the parent closes the card before the 1 s save timer fires
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.pathname === "/api/cards/7/fields")).toBe(true));
  });

  it("Continue hands the docket to chosen people, after a save in flight, with its new version", async () => {
    let finishPut!: () => void;
    const card = makeCard();
    const { calls, onClose } = show(card, {
      "GET /api/assignees": people,
      "PUT /api/cards/7/fields": (_u, init) =>
        new Promise((resolve) => {
          finishPut = () => resolve({ ...card, fields: JSON.parse(String(init?.body)).fields, version: 5 });
        }),
      "POST /api/cards/7/continue": () => makeCard({ status: "done", version: 6 }),
    });
    await userEvent.click(screen.getByRole("checkbox", { name: "Laminated" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true), { timeout: 2500 });
    await userEvent.click(screen.getByRole("button", { name: "Continue →" }));
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Person 1" }), "4:finishing");
    expect(send).toBeEnabled(); // What to do is optional
    await userEvent.type(screen.getByRole("textbox", { name: "What to do 1" }), "Grommets");
    await userEvent.click(send);
    finishPut();
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/cards/7/continue")).toBe(true));
    expect(calls.find((c) => c.url.pathname === "/api/cards/7/continue")!.body).toEqual({
      to: [{ userId: 4, roleId: "finishing", instruction: "Grommets" }],
      version: 5,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Done ends my part", async () => {
    const { calls } = show(makeCard({ fields: { laminated: true } }), { "POST /api/cards/7/done": () => makeCard({ status: "done" }) });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname === "/api/cards/7/done")?.body).toEqual({ version: 0 }));
  });

  it("shows what to do and who sent it; Send back goes to that person", async () => {
    const { calls } = show(handed(), { "POST /api/cards/7/send-back": () => handed({ status: "waiting" }) });
    expect(screen.getByText("Laminate 2 banners")).toBeInTheDocument();
    expect(screen.getByText("From Mike")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "← Send back" }));
    expect(screen.queryByRole("radio")).toBeNull();
    await userEvent.type(screen.getByLabelText("Reason"), "Wrong size");
    await userEvent.click(screen.getByRole("button", { name: "Send back to Mike" }));
    await waitFor(() => expect(calls.find((c) => c.url.pathname === "/api/cards/7/send-back")?.body).toEqual({ reason: "Wrong size", version: 0 }));
  });

  it("the designer can send a proof; a printer a sample", async () => {
    const { calls, unmount } = show(handed({ roleId: "designer", approval: "proof" }), { "POST /api/cards/7/proof-sent": () => handed({ status: "done" }) });
    expect(screen.queryByRole("button", { name: "Send to production →" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Proof sent" }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/cards/7/proof-sent")).toBe(true));
    unmount();
    show(handed({ roleId: "printer_fb", approval: "sample" }));
    expect(screen.getByRole("button", { name: "Sample sent" })).toBeEnabled();
  });

  it("the creator closes a docket that is Ready to close", async () => {
    const card = handed({ roleId: "general", stage: "ready_to_close", instruction: null, from: { id: 9, name: "Seb" } });
    const { calls } = show(card, { "POST /api/cards/7/close": () => ({ ...card, status: "done" }) });
    expect(screen.getByText("Ready to close")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue →" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Close docket" }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/cards/7/close")).toBe(true));
  });

  it("while waiting for the client, the creator approves or sends back", () => {
    show(handed({ roleId: "general", stage: "waiting_design", instruction: null, from: { id: 9, name: "Ira" } }));
    expect(screen.getByText("Waiting for design approval")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approved → Continue" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "← Send back" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Close docket" })).toBeNull();
  });

  it("marks the card seen when it opens", async () => {
    const { calls } = show(makeCard());
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.pathname === "/api/cards/7/seen")).toBe(true));
  });

  it("an old route card sent back needs an area and a reason", async () => {
    const { calls } = show(makeCard(), { "POST /api/cards/7/send-back": () => makeCard({ status: "waiting" }) });
    await userEvent.click(screen.getByRole("button", { name: "← Send back" }));
    const send = screen.getByRole("button", { name: "Send back" });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Design" }));
    await userEvent.type(screen.getByLabelText("Reason"), "Wrong size");
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/cards/7/send-back")).toBe(true));
    expect(calls.find((c) => c.url.pathname === "/api/cards/7/send-back")!.body).toEqual({ toStep: 0, reason: "Wrong size", version: 0 });
  });

  it("a missing file offers Send back to Design with the reason filled in", async () => {
    show(makeCard({ roleId: "printer_roll", step: 1, nextRoleId: "laminate_roll", earlier: [{ step: 0, roleId: "designer" }], fields: { printed: true, file: "missing" } }));
    expect(screen.getByRole("status")).toHaveTextContent("File is missing. Send it back to Design.");
    await userEvent.click(screen.getByRole("button", { name: "Send back to Design" }));
    expect(screen.getByRole("radio", { name: "Design" })).toBeChecked();
    expect(screen.getByLabelText("Reason")).toHaveValue("File missing");
  });

  it("Laminate Roll suggests the laminate list", () => {
    const optionValues = () => [...document.querySelectorAll("#card-field-material-list option")].map((o) => (o as HTMLOptionElement).value);
    show(makeCard({ roleId: "laminate_roll", nextRoleId: null }));
    expect(optionValues()).toEqual([
      "Gloss Lam",
      "Matte Lam",
      "1360 Lam",
      "Weed And Mask",
      "Sand UV",
      "Scuff",
      "Coat",
      "Back in white",
      "Double side decals",
    ]);
  });

  it("Print FB suggests flatbed materials; Print Roll keeps the roll list", () => {
    const optionValues = () => [...document.querySelectorAll("#card-field-material-list option")].map((o) => (o as HTMLOptionElement).value);
    const { unmount } = show(makeCard({ roleId: "printer_fb", nextRoleId: null }));
    expect(optionValues()).toEqual([
      "Coroplast",
      "Foamcore",
      "Dibond",
      "Styrene",
      "Sintra",
      "Acrylic",
      "Paper",
      "Lamacoid",
      "Magnetic",
      "Aluminum Blanks",
      "Mesh",
      "Lexan",
      "Crezon",
    ]);
    unmount();
    show(makeCard({ roleId: "printer_roll", nextRoleId: null }));
    expect(optionValues()).toContain("1105 (Vehicle Wrap)");
    expect(optionValues()).not.toContain("Coroplast");
  });

  it("the installer Date is picked from a calendar", () => {
    show(makeCard({ roleId: "installer", nextRoleId: null }));
    expect(screen.getByLabelText("Date")).toHaveAttribute("type", "date");
  });

  it("shows who returned it and why", () => {
    show(makeCard({ returned: { reason: "Cut file missing", by: "Seb" } }));
    expect(screen.getByText("Returned by Seb · Cut file missing")).toBeInTheDocument();
  });

  it("shows the server's message when the card already moved", async () => {
    show(makeCard({ fields: { laminated: true } }), {
      "POST /api/cards/7/done": () => Response.json({ error: "This card was already moved by Erin." }, { status: 409 }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This card was already moved by Erin.");
  });

  it("I'm on it claims the card", async () => {
    const { calls } = show(makeCard(), { "POST /api/cards/7/claim": () => makeCard({ claimedBy: { id: 2, name: "Ana Lopez" } }) });
    await userEvent.click(screen.getByRole("button", { name: "I'm on it" }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/cards/7/claim")).toBe(true));
    expect(await screen.findByText("You're on it")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I'm on it" })).toBeNull();
  });

  it("others see who is working on it", () => {
    show(makeCard({ claimedBy: { id: 9, name: "Seb Bastian" } }));
    expect(screen.getByText("Seb is working on it")).toBeInTheDocument();
  });

  it("a waiting card is read-only", () => {
    show(makeCard({ status: "waiting" }));
    expect(screen.getByText("Up next")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Laminated" })).toBeDisabled();
  });
});
