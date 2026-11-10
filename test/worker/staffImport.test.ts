import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { STAFF_ROSTER } from "../../src/shared/staffRoster";
import { api, createUser, login, resetAuthTables } from "./helpers";

let admin = "";
beforeEach(async () => {
  await resetAuthTables();
  await createUser("boss", "admin");
  admin = await login("boss");
});

const post = (path: string, cookie: string, json: unknown = {}) => api(path, { method: "POST", cookie, json });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("staff roster", () => {
  it("has unique usernames and only known roles", async () => {
    const names = STAFF_ROSTER.map((p) => p.username);
    expect(new Set(names).size).toBe(names.length);
    const { results } = await env.DB.prepare("SELECT id FROM roles").all<{ id: string }>();
    const known = new Set(results.map((r) => r.id));
    for (const p of STAFF_ROSTER) for (const r of p.roles) expect(known.has(r)).toBe(true);
  });
});

describe("Import staff", () => {
  it("previews who is new and who already exists", async () => {
    await createUser("erin", "staff");
    const res = await api("/api/admin/import-staff", { cookie: admin });
    expect(res.status).toBe(200);
    const list = (await res.json()) as { username: string; exists: boolean }[];
    expect(list).toHaveLength(STAFF_ROSTER.length);
    expect(list.find((p) => p.username === "erin")?.exists).toBe(true);
    expect(list.find((p) => p.username === "kharash")?.exists).toBe(false);
  });

  it("creates the missing accounts with their level and roles, and they must change the password", async () => {
    await createUser("erin", "staff");
    const res = await post("/api/admin/import-staff", admin, { tempPassword: "Welcome2026" });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { created: string[]; skipped: string[] };
    expect(out.skipped).toEqual(["erin"]);
    expect(out.created).toHaveLength(STAFF_ROSTER.length - 1);

    const u = await env.DB.prepare("SELECT access_level, must_change_password FROM users WHERE username = 'kharash'").first();
    expect(u).toEqual({ access_level: "staff", must_change_password: 1 });
    const { results } = await env.DB.prepare(
      "SELECT ur.role_id FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.username = 'kharash' ORDER BY ur.role_id",
    ).all<{ role_id: string }>();
    expect(results.map((r) => r.role_id)).toEqual(["finishing", "installer", "laminate_roll"]);
    const jeff = await env.DB.prepare("SELECT access_level FROM users WHERE username = 'jeff.b'").first();
    expect(jeff).toEqual({ access_level: "admin" });

    // Running it again creates nobody.
    const again = (await (await post("/api/admin/import-staff", admin, { tempPassword: "Welcome2026" })).json()) as { created: string[] };
    expect(again.created).toEqual([]);
  });

  it("needs a valid temporary password and an admin", async () => {
    expect((await post("/api/admin/import-staff", admin, { tempPassword: "short" })).status).toBe(400);
    await createUser("mgr", "manager");
    expect((await post("/api/admin/import-staff", await login("mgr"), { tempPassword: "Welcome2026" })).status).toBe(403);
  });
});

describe("Forced password change", () => {
  async function imported() {
    await post("/api/admin/import-staff", admin, { tempPassword: "Welcome2026" });
    return login("erin", "Welcome2026");
  }

  it("a new account can only change its password until it does", async () => {
    const erin = await imported();
    const me = (await (await api("/api/auth/me", { cookie: erin })).json()) as { mustChangePassword: boolean };
    expect(me.mustChangePassword).toBe(true);
    const blocked = await api("/api/my-cards", { cookie: erin });
    expect(blocked.status).toBe(403);
    expect(await errorOf(blocked)).toBe("Change your password first.");

    const res = await post("/api/auth/change-password", erin, { currentPassword: "Welcome2026", newPassword: "erin-own-pass" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
    expect((await api("/api/my-cards", { cookie: erin })).status).toBe(200);
    expect((await api("/api/auth/login", { method: "POST", json: { username: "erin", password: "erin-own-pass" } })).status).toBe(200);
  });

  it("rejects a wrong current password, a short one, or keeping the temporary one", async () => {
    const erin = await imported();
    let res = await post("/api/auth/change-password", erin, { currentPassword: "nope-nope", newPassword: "erin-own-pass" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Current password is wrong");
    res = await post("/api/auth/change-password", erin, { currentPassword: "Welcome2026", newPassword: "short" });
    expect(res.status).toBe(400);
    res = await post("/api/auth/change-password", erin, { currentPassword: "Welcome2026", newPassword: "Welcome2026" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Choose a new password, different from the current one");
  });

  it("an admin password reset makes the person choose a new one", async () => {
    const id = await createUser("ana", "staff");
    const res = await post(`/api/users/${id}/reset-password`, admin, { password: "Temp-12345" });
    expect(res.status).toBe(200);
    const u = await env.DB.prepare("SELECT must_change_password FROM users WHERE id = ?").bind(id).first();
    expect(u).toEqual({ must_change_password: 1 });
  });
});
