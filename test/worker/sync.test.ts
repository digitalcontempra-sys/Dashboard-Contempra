import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { runSync } from "../../src/worker/sync/syncDockets";
import { HEADER, row } from "./fixtures";

const count = async () =>
  (await env.DB.prepare("SELECT count(*) AS n FROM dockets").first<{ n: number }>())!.n;
const state = () => env.DB.prepare("SELECT * FROM sync_state WHERE id = 1").first<Record<string, unknown>>();

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM dockets"), env.DB.prepare("DELETE FROM review_items")]);
});

describe("runSync", () => {
  it("inserts new dockets on first sync", async () => {
    const r = await runSync(env, [HEADER, row(1), row(2), row(3)]);
    expect(r).toMatchObject({ ok: true, rowsSeen: 3, rowsChanged: 3, rowsDeleted: 0 });
    expect(await count()).toBe(3);
  });

  it("writes nothing when nothing changed", async () => {
    await runSync(env, [HEADER, row(1), row(2), row(3)]);
    const r = await runSync(env, [HEADER, row(1), row(2), row(3)]);
    expect(r.rowsChanged).toBe(0);
  });

  it("upserts only the edited row", async () => {
    await runSync(env, [HEADER, row(1), row(2), row(3)]);
    const r = await runSync(env, [HEADER, row(1), row(2, { 14: "edited" }), row(3)]);
    expect(r.rowsChanged).toBe(1);
    const d = await env.DB.prepare("SELECT notes FROM dockets WHERE work_order = '2'").first<{ notes: string }>();
    expect(d?.notes).toBe("edited");
  });

  it("deletes dockets removed from the sheet", async () => {
    await runSync(env, [HEADER, row(1), row(2), row(3)]);
    const r = await runSync(env, [HEADER, row(1), row(3)]);
    expect(r.rowsDeleted).toBe(1);
    expect(await count()).toBe(2);
  });

  it("aborts on header mismatch without writing", async () => {
    await runSync(env, [HEADER, row(1)]);
    const bad = [...HEADER];
    bad[6] = "Client";
    const r = await runSync(env, [bad, row(9)]);
    expect(r.ok).toBe(false);
    expect(String((await state())?.last_error)).toMatch(/^Header mismatch: G/);
    expect(await count()).toBe(1);
  });

  it("aborts when the sheet returns far fewer rows than stored", async () => {
    const many = [HEADER, ...Array.from({ length: 200 }, (_, i) => row(i + 1))];
    await runSync(env, many);
    const r = await runSync(env, [HEADER, ...Array.from({ length: 50 }, (_, i) => row(i + 1))]);
    expect(r).toMatchObject({ ok: false, error: "Sheet returned too few rows (50 of 200)" });
    expect(await count()).toBe(200);
  });

  it("replaces review items each run", async () => {
    await runSync(env, [HEADER, row(5), row(5)]);
    await runSync(env, [HEADER, row(5), row(5)]);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM review_items").first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it("records success time and keeps data when the fetch fails", async () => {
    await runSync(env, [HEADER, row(1)]);
    const okState = await state();
    expect(okState?.last_success_at).toBeTruthy();
    const r = await runSync({ ...env, GOOGLE_SA_JSON: "not json" });
    expect(r.ok).toBe(false);
    expect(await count()).toBe(1);
    expect((await state())?.last_success_at).toBe(okState?.last_success_at);
  });

  it("records a database failure during the write phase", async () => {
    const failingDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "batch") return async () => { throw new Error("D1 overloaded"); };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const r = await runSync({ ...env, DB: failingDb }, [HEADER, row(1)]);
    expect(r).toMatchObject({ ok: false, error: "D1 overloaded" });
    expect((await state())?.last_error).toBe("D1 overloaded");
  });
});
