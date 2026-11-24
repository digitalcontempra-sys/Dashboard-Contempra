import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamsPanel } from "../../src/web/pages/AdminTeams";
import { Providers } from "../../src/web/providers";
import { adminUser, mockApi } from "./mockApi";

afterEach(() => vi.unstubAllGlobals());

const people = [
  { id: 3, fullName: "Gary", roles: ["installer", "measure"] },
  { id: 4, fullName: "Dennis", roles: ["installer"] },
  { id: 5, fullName: "Ira", roles: ["designer"] },
];

function show(teams: unknown[]) {
  const api = mockApi({
    "GET /api/auth/me": () => adminUser,
    "GET /api/assignees": () => people,
    "GET /api/teams": () => teams,
    "POST /api/teams": (_u, init) => ({ id: 9, roleId: "installer", members: [], ...JSON.parse(String(init?.body)) }),
    "PUT /api/teams/7": (_u, init) => ({ id: 7, roleId: "installer", members: [], ...JSON.parse(String(init?.body)) }),
    "DELETE /api/teams/7": () => ({ ok: true }),
  });
  render(
    <Providers>
      <TeamsPanel />
    </Providers>,
  );
  return api;
}

const teamB = { id: 7, name: "Team B", roleId: "installer", members: [{ id: 4, fullName: "Dennis" }, { id: 3, fullName: "Gary" }] };

describe("Admin → Teams", () => {
  it("lists the teams with their members", async () => {
    show([teamB]);
    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent("Team B");
    expect(item).toHaveTextContent("Dennis, Gary");
  });

  it("creates a team from the installers only", async () => {
    const { calls } = show([]);
    await userEvent.click(await screen.findByRole("button", { name: "New team" }));
    const form = screen.getByRole("form", { name: "New team" });
    // Only installers can be members.
    expect(within(form).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label") ?? c.closest("label")?.textContent)).toEqual(["Gary", "Dennis"]);
    await userEvent.type(within(form).getByRole("textbox", { name: "Team name" }), "Team A");
    await userEvent.click(within(form).getByRole("checkbox", { name: "Gary" }));
    await userEvent.click(within(form).getByRole("button", { name: "Save team" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Team A", memberIds: [3] });
  });

  it("edits and deletes a team (delete asks to confirm)", async () => {
    const { calls } = show([teamB]);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Team B" }));
    const form = screen.getByRole("form", { name: "Edit Team B" });
    expect(within(form).getByRole("checkbox", { name: "Dennis" })).toBeChecked();
    await userEvent.click(within(form).getByRole("checkbox", { name: "Dennis" }));
    await userEvent.click(within(form).getByRole("button", { name: "Save team" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ name: "Team B", memberIds: [3] });

    await userEvent.click(await screen.findByRole("button", { name: "Delete Team B" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete Team B" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});
