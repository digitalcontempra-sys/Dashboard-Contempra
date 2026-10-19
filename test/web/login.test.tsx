import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, staffUser } from "./mockApi";
import { renderApp } from "./render";

afterEach(() => vi.unstubAllGlobals());

describe("login", () => {
  it("shows the server error on wrong credentials", async () => {
    mockApi({
      "POST /api/auth/login": () => Response.json({ error: "Invalid username or password" }, { status: 401 }),
    });
    renderApp("/");
    await userEvent.type(await screen.findByLabelText("Username"), "ana");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-pass");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid username or password")).toBeInTheDocument();
  });

  it("sends staff to My Cards after signing in", async () => {
    let signedIn = false;
    mockApi({
      "GET /api/auth/me": () => (signedIn ? staffUser : Response.json({ error: "Not signed in" }, { status: 401 })),
      "POST /api/auth/login": () => {
        signedIn = true;
        return staffUser;
      },
    });
    renderApp("/");
    await userEvent.type(await screen.findByLabelText("Username"), "ana");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "My Cards" })).toBeInTheDocument();
  });

  it("hides manager navigation from staff", async () => {
    mockApi({ "GET /api/auth/me": () => staffUser });
    renderApp("/my-cards");
    await screen.findByRole("heading", { name: "My Cards" });
    expect(screen.queryByRole("link", { name: /Non Billed Jobs/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /My Cards/ }).length).toBeGreaterThan(0);
  });

  it("sends staff away from manager pages", async () => {
    mockApi({ "GET /api/auth/me": () => staffUser });
    renderApp("/non-billed");
    expect(await screen.findByRole("heading", { name: "My Cards" })).toBeInTheDocument();
  });
});

describe("expired session", () => {
  it("returns to the sign-in screen when an API call gets 401", async () => {
    mockApi({
      "GET /api/auth/me": () => ({ id: 3, username: "mb", fullName: "Meinrad", accessLevel: "manager", roles: [] }),
      "GET /api/dockets": () => Response.json({ error: "Not signed in" }, { status: 401 }),
      "GET /api/account-managers": () => [],
      "GET /api/sync/status": () => Response.json({ error: "Not signed in" }, { status: 401 }),
    });
    renderApp("/dashboard");
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
  });
});
