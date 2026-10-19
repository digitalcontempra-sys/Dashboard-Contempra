import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/index";
import { HEADER, row } from "./fixtures";
import { api, BASE, createUser, login, resetAuthTables } from "./helpers";

beforeEach(async () => {
  await resetAuthTables();
  await env.DB.prepare("DELETE FROM dockets").run();
});

describe("sync routes", () => {
  it("dev import runs a sync from posted values for an admin", async () => {
    await createUser("boss", "admin");
    const cookie = await login("boss");
    const res = await api("/api/dev/import", { method: "POST", cookie, json: { values: [HEADER, row(1), row(2)] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rowsSeen: 2 });
  });

  it("dev import is 404 in production", async () => {
    const req = new Request(`${BASE}/api/dev/import`, { method: "POST", body: "{}" });
    const res = await worker.fetch(req, { ...env, ENVIRONMENT: "production" }, createExecutionContext());
    expect(res.status).toBe(404);
  });

  it("sync status is visible to managers, not staff", async () => {
    await createUser("mgr", "manager");
    await createUser("ana", "staff");
    const m = await api("/api/sync/status", { cookie: await login("mgr") });
    expect(m.status).toBe(200);
    expect(await m.json()).toHaveProperty("lastSuccessAt");
    expect((await api("/api/sync/status", { cookie: await login("ana") })).status).toBe(403);
  });

  it("only admins can trigger a sync", async () => {
    await createUser("mgr", "manager");
    const res = await api("/api/sync/run", { method: "POST", cookie: await login("mgr") });
    expect(res.status).toBe(403);
  });
});
