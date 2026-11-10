import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminUser, mockApi, staffUser } from "./mockApi";
import { renderApp } from "./render";

afterEach(() => vi.unstubAllGlobals());

describe("Choose your password", () => {
  it("blocks the app until the person sets their own password", async () => {
    const { calls } = mockApi({
      "GET /api/auth/me": () => ({ ...staffUser, mustChangePassword: true }),
      "POST /api/auth/change-password": () => ({ ...staffUser, mustChangePassword: false }),
      "GET /api/my-cards": () => [],
      "GET /api/my-cards/summary": () => ({ newCount: 0, activeCount: 0, soundOn: true }),
    });
    renderApp("/my-cards");
    expect(await screen.findByRole("heading", { name: "Choose your password" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Cards" })).toBeNull();

    await userEvent.type(screen.getByLabelText("Current password"), "Welcome2026");
    await userEvent.type(screen.getByLabelText("New password"), "erin-own-pass");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "erin-own-pas");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");

    await userEvent.type(screen.getByLabelText("Confirm new password"), "s");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("heading", { name: "My Cards" })).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname === "/api/auth/change-password")!.body).toEqual({
      currentPassword: "Welcome2026",
      newPassword: "erin-own-pass",
    });
  });
});

describe("Import staff", () => {
  const roster = [
    { username: "erin", fullName: "Erin", accessLevel: "staff", roles: ["printer_roll"], exists: true },
    { username: "kharash", fullName: "Kharash Ibrahim", accessLevel: "staff", roles: ["laminate_roll", "finishing"], exists: false },
    { username: "danni", fullName: "Danni", accessLevel: "manager", roles: [], exists: false },
  ];
  const admin = {
    "GET /api/auth/me": () => adminUser,
    "GET /api/roles": () => [
      { id: "printer_roll", label: "Printer Roll" },
      { id: "laminate_roll", label: "Laminate Roll" },
      { id: "finishing", label: "Finishing / Packaging" },
    ],
    "GET /api/users": () => [],
    "GET /api/google/status": () => ({ status: "connected", email: "x@y.z", sheetId: "s", sheetTitle: "T", tabName: "Contempra", connectedAt: null }),
    "GET /api/sync/status": () => ({ lastRunAt: null, lastSuccessAt: null, lastError: null, rowsSeen: 0, rowsChanged: 0, rowsDeleted: 0, configured: true }),
    "GET /api/production-board": () => ({ columns: [], productionColumnsReady: true }),
    "GET /api/admin/import-staff": () => roster,
    "POST /api/admin/import-staff": () => ({ created: ["kharash", "danni"], skipped: ["erin"] }),
  };

  it("previews the roster and creates the missing accounts with a temporary password", async () => {
    const { calls } = mockApi(admin);
    renderApp("/admin/users");
    const panel = await screen.findByRole("region", { name: "Import staff" });
    expect(within(panel).getByText("Kharash Ibrahim")).toBeInTheDocument();
    expect(within(panel).getByText("Laminate Roll, Finishing / Packaging")).toBeInTheDocument();
    expect(within(panel).getByText("Has an account")).toBeInTheDocument();
    const go = within(panel).getByRole("button", { name: "Create 2 accounts" });
    expect(go).toBeDisabled();
    await userEvent.type(within(panel).getByLabelText("Temporary password"), "Welcome2026");
    await userEvent.click(go);
    expect(await within(panel).findByText(/Created 2 accounts/)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST" && c.url.pathname === "/api/admin/import-staff")!.body).toEqual({ tempPassword: "Welcome2026" }),
    );
  });
});
