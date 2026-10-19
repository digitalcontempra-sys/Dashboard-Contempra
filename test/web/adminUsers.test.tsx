import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminUser, mockApi } from "./mockApi";
import { renderApp } from "./render";

afterEach(() => vi.unstubAllGlobals());

const roles = [
  { id: "designer", label: "Designer" },
  { id: "printer_roll", label: "Printer Roll" },
  { id: "laminate_roll", label: "Laminate Roll" },
];

function setup(postResponse?: Response) {
  return mockApi({
    "GET /api/auth/me": () => adminUser,
    "GET /api/roles": () => roles,
    "GET /api/users": () => [
      { id: 1, username: "boss", fullName: "Jeff Baumer", accessLevel: "admin", roles: [], active: true },
      { id: 2, username: "ana", fullName: "Ana Lopez", accessLevel: "staff", roles: ["printer_roll"], active: true },
    ],
    "POST /api/users": () =>
      postResponse ?? { id: 3, username: "luis", fullName: "Luis", accessLevel: "staff", roles: [], active: true },
    "GET /api/sync/status": () => ({
      lastRunAt: null, lastSuccessAt: new Date().toISOString(), lastError: null, rowsSeen: 0, rowsChanged: 0, rowsDeleted: 0,
    }),
  });
}

async function fillNewUser() {
  await userEvent.click(await screen.findByRole("button", { name: "Add user" }));
  const form = await screen.findByRole("dialog");
  await userEvent.type(within(form).getByLabelText("Username"), "luis");
  await userEvent.type(within(form).getByLabelText("Full name"), "Luis Perez");
  await userEvent.type(within(form).getByLabelText("Password"), "password123");
  await userEvent.click(within(form).getByLabelText("Printer Roll"));
  await userEvent.click(within(form).getByLabelText("Laminate Roll"));
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  return form;
}

describe("Admin Users", () => {
  it("lists users with role chips", async () => {
    setup();
    renderApp("/admin/users");
    const row = (await screen.findByText("Ana Lopez")).closest("li")!;
    expect(within(row).getByText("Printer Roll")).toBeInTheDocument();
  });

  it("posts the selected roles when adding a user", async () => {
    const { calls } = setup();
    renderApp("/admin/users");
    await fillNewUser();
    const post = calls.find((c) => c.method === "POST" && c.url.pathname === "/api/users");
    expect(post?.body).toMatchObject({
      username: "luis",
      fullName: "Luis Perez",
      accessLevel: "staff",
      roles: ["printer_roll", "laminate_roll"],
    });
  });

  it("shows the server error on a duplicate username", async () => {
    setup(Response.json({ error: "Username already exists" }, { status: 409 }));
    renderApp("/admin/users");
    const form = await fillNewUser();
    expect(await within(form).findByText("Username already exists")).toBeInTheDocument();
  });
});
