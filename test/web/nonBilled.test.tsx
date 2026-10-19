import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { managerUser, mockApi } from "./mockApi";
import { renderApp } from "./render";

afterEach(() => vi.unstubAllGlobals());

const page = (tab: string) => ({
  items: [
    {
      workOrder: tab === "ready" ? "106" : "100",
      customer: tab === "ready" ? "Done Unbilled" : "Still Working",
      project: "Signs",
      accountManager: "JB",
      dateIso: "2026-10-01",
      dueIso: null,
      dueRaw: null,
      status: tab === "ready" ? "completed" : "active",
      billing: "not_billed",
      bucket: "no_due_date",
      overdue: false,
      ageDays: 12,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
});

describe("Non Billed Jobs", () => {
  it("requests ready first, then open when switching tabs", async () => {
    const { calls } = mockApi({
      "GET /api/auth/me": () => managerUser,
      "GET /api/non-billed": (url) => page(url.searchParams.get("tab") ?? "ready"),
      "GET /api/account-managers": () => [],
    });
    renderApp("/non-billed");
    expect(await screen.findByText("Done Unbilled")).toBeInTheDocument();
    expect(screen.getByText("12 days")).toBeInTheDocument();
    expect(calls.some((c) => c.url.pathname === "/api/non-billed" && c.url.searchParams.get("tab") === "ready")).toBe(true);
    await userEvent.click(screen.getByRole("tab", { name: /Open – Not Billed/ }));
    expect(await screen.findByText("Still Working")).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === "/api/non-billed" && c.url.searchParams.get("tab") === "open")).toBe(true),
    );
  });
});

describe("Needs Review", () => {
  it("groups duplicates and lists invalid rows", async () => {
    mockApi({
      "GET /api/auth/me": () => managerUser,
      "GET /api/needs-review": () => [
        {
          kind: "duplicate_work_order",
          workOrder: "90919",
          rows: [
            { sheetRow: 120, values: [46000, "", 90919, true, false, 1, "Acme", "Banner"] },
            { sheetRow: 340, values: [46001, "", 90919, true, false, 2, "Acme", "Banner copy"] },
          ],
        },
        { kind: "invalid_work_order", workOrder: "abc", rows: [{ sheetRow: 1793, values: [] }] },
      ],
    });
    renderApp("/needs-review");
    expect(await screen.findByText("Duplicate work order 90919 (2 rows)")).toBeInTheDocument();
    expect(screen.getByText("Invalid work order on row 1793")).toBeInTheDocument();
  });
});
