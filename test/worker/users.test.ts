import { beforeEach, describe, expect, it } from "vitest";
import { api, createUser, login, resetAuthTables } from "./helpers";

let admin = "";
let adminId = 0;

beforeEach(async () => {
  await resetAuthTables();
  adminId = await createUser("boss", "admin");
  admin = await login("boss");
});

const newUser = (over: Record<string, unknown> = {}) => ({
  username: "ana",
  fullName: "Ana Lopez",
  accessLevel: "staff",
  roles: ["printer_roll", "laminate_roll"],
  password: "password123",
  ...over,
});

describe("users API", () => {
  it("lists roles in production order for any signed-in user", async () => {
    await createUser("ana", "staff");
    const res = await api("/api/roles", { cookie: await login("ana") });
    const roles = (await res.json()) as { id: string; label: string }[];
    expect(roles[0]).toEqual({ id: "designer", label: "Designer" });
    expect(roles).toHaveLength(7);
  });

  it("creates a user with multiple roles", async () => {
    const res = await api("/api/users", { method: "POST", cookie: admin, json: newUser() });
    expect(res.status).toBe(200);
    const list = (await (await api("/api/users", { cookie: admin })).json()) as { username: string; roles: string[] }[];
    expect(list.find((u) => u.username === "ana")?.roles).toEqual(["printer_roll", "laminate_roll"]);
  });

  it("rejects a duplicate username", async () => {
    await api("/api/users", { method: "POST", cookie: admin, json: newUser() });
    const res = await api("/api/users", { method: "POST", cookie: admin, json: newUser({ username: "ANA" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Username already exists" });
  });

  it("rejects an unknown role", async () => {
    const res = await api("/api/users", { method: "POST", cookie: admin, json: newUser({ roles: ["x"] }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown role: x" });
  });

  it("forbids staff from listing users", async () => {
    await createUser("ana", "staff");
    expect((await api("/api/users", { cookie: await login("ana") })).status).toBe(403);
  });

  it("deactivating a user ends their sessions", async () => {
    const id = await createUser("ana", "staff");
    const staff = await login("ana");
    const res = await api(`/api/users/${id}`, { method: "PATCH", cookie: admin, json: { active: false } });
    expect(res.status).toBe(200);
    expect((await api("/api/auth/me", { cookie: staff })).status).toBe(401);
  });

  it("an admin cannot remove their own admin access", async () => {
    const res = await api(`/api/users/${adminId}`, { method: "PATCH", cookie: admin, json: { active: false } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "You cannot remove your own admin access" });
    const demote = await api(`/api/users/${adminId}`, { method: "PATCH", cookie: admin, json: { accessLevel: "staff" } });
    expect(demote.status).toBe(400);
  });

  it("updates roles and name", async () => {
    const id = await createUser("ana", "staff");
    const res = await api(`/api/users/${id}`, {
      method: "PATCH",
      cookie: admin,
      json: { fullName: "Ana L.", roles: ["designer"] },
    });
    expect(await res.json()).toMatchObject({ fullName: "Ana L.", roles: ["designer"] });
  });

  it("reset password logs the user out and the new password works", async () => {
    const id = await createUser("ana", "staff");
    const staff = await login("ana");
    const res = await api(`/api/users/${id}/reset-password`, {
      method: "POST",
      cookie: admin,
      json: { password: "brand-new-pass" },
    });
    expect(res.status).toBe(200);
    expect((await api("/api/auth/me", { cookie: staff })).status).toBe(401);
    await expect(login("ana", "brand-new-pass")).resolves.toContain("cd_session=");
  });

  it("unknown user id is 404", async () => {
    const res = await api("/api/users/9999", { method: "PATCH", cookie: admin, json: { fullName: "x" } });
    expect(res.status).toBe(404);
  });
});
