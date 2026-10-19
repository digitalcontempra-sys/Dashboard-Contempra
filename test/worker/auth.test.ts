import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/worker/auth/password";
import { api, createUser, login, resetAuthTables } from "./helpers";

beforeEach(resetAuthTables);

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const h = await hashPassword("s3cret-pass");
    expect(h.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("s3cret-pass", h)).toBe(true);
    expect(await verifyPassword("wrong-pass", h)).toBe(false);
  });
});

describe("setup", () => {
  const body = { setupToken: "test-setup-token", username: "meinrad", fullName: "Meinrad", password: "password123" };
  it("creates the first admin once", async () => {
    expect((await api("/api/setup", { method: "POST", json: body })).status).toBe(200);
    expect((await api("/api/setup", { method: "POST", json: { ...body, username: "x" } })).status).toBe(403);
  });
  it("rejects a wrong setup token", async () => {
    expect((await api("/api/setup", { method: "POST", json: { ...body, setupToken: "nope" } })).status).toBe(403);
  });
  it("rejects a short password", async () => {
    const res = await api("/api/setup", { method: "POST", json: { ...body, password: "short" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Password must be at least 8 characters" });
  });
});

describe("login", () => {
  it("sets a secure session cookie and /me returns the user", async () => {
    await createUser("jeff", "admin");
    const res = await api("/api/auth/login", { method: "POST", json: { username: "JEFF", password: "password123" } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("cd_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
    const me = await api("/api/auth/me", { cookie: setCookie.split(";")[0] });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ username: "jeff", accessLevel: "admin", roles: [] });
  });

  it("rejects wrong credentials with a generic message", async () => {
    await createUser("jeff", "staff");
    const res = await api("/api/auth/login", { method: "POST", json: { username: "jeff", password: "nope-nope" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid username or password" });
  });

  it("rejects an inactive user", async () => {
    const id = await createUser("gone", "staff");
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(id).run();
    const res = await api("/api/auth/login", { method: "POST", json: { username: "gone", password: "password123" } });
    expect(res.status).toBe(401);
  });

  it("locks out after 5 failed attempts", async () => {
    await createUser("jeff", "staff");
    for (let i = 0; i < 5; i++) {
      await api("/api/auth/login", { method: "POST", json: { username: "jeff", password: "bad-pass!" } });
    }
    const res = await api("/api/auth/login", { method: "POST", json: { username: "jeff", password: "password123" } });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many attempts. Try again in 15 minutes." });
  });

  it("logout ends the session", async () => {
    await createUser("jeff", "staff");
    const cookie = await login("jeff");
    await api("/api/auth/logout", { method: "POST", cookie });
    expect((await api("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("stores only a hash of the session token", async () => {
    await createUser("jeff", "staff");
    const cookie = await login("jeff");
    const token = cookie.split("=")[1];
    const row = await env.DB.prepare("SELECT id FROM sessions").first<{ id: string }>();
    expect(row?.id).toBeTruthy();
    expect(row?.id).not.toBe(token);
  });

  it("/me without a cookie is 401", async () => {
    const res = await api("/api/auth/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in" });
  });
});
