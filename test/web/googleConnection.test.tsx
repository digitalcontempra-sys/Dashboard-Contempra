import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminUser, mockApi } from "./mockApi";
import { renderApp } from "./render";

afterEach(() => vi.unstubAllGlobals());

const common = {
  "GET /api/auth/me": () => adminUser,
  "GET /api/roles": () => [],
  "GET /api/users": () => [],
  "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, rowsSeen: 0, rowsChanged: 0, rowsDeleted: 0, configured: false }),
};

describe("Google Connection panel", () => {
  it("offers to connect when disconnected", async () => {
    mockApi({ ...common, "GET /api/google/status": () => ({ connected: false, email: null, sheetUrl: null }) });
    renderApp("/admin/users");
    expect(await screen.findByText("Connect the Google account that owns the Workorder Books sheet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute("href", "/api/google/connect");
  });

  it("saves the sheet URL and shows server errors", async () => {
    let bad = true;
    const { calls } = mockApi({
      ...common,
      "GET /api/google/status": () => ({ connected: true, email: "owner@gmail.com", sheetUrl: null }),
      "PUT /api/google/sheet": () => (bad ? Response.json({ error: "This sheet has no 'Contempra' tab" }, { status: 400 }) : { ok: true }),
    });
    renderApp("/admin/users");
    expect(await screen.findByText("Connected as owner@gmail.com")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Google Sheet URL"), "https://docs.google.com/spreadsheets/d/abc/edit");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This sheet has no 'Contempra' tab")).toBeInTheDocument();
    bad = false;
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PUT")[1]?.body).toEqual({ url: "https://docs.google.com/spreadsheets/d/abc/edit" }),
    );
  });
});
