/**
 * D1 rows read: the dashboard polls (list every 30 s, summaries every 20-30 s). When nothing changed,
 * the server answers 304 from one data_version row instead of running the queries again.
 */
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupCards, teardownCards } from "./cardHelpers";
import { api, createUser, login } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
});
afterEach(teardownCards);

const version = async () => (await env.DB.prepare("SELECT v FROM data_version WHERE id = 1").first<{ v: number }>())!.v;

const insertDocket = (wo: string) =>
  env.DB.prepare(
    `INSERT INTO dockets (work_order, sheet_row, comp, hold, inv, status, billing, row_hash, synced_at)
     VALUES (?, 2, 0, 0, 0, 'active', 'not_billed', 'h', 't')`,
  )
    .bind(wo)
    .run();

const POLLED = ["/api/dockets?view=active", "/api/dashboard/summary", "/api/my-cards/summary"];

describe("polled endpoints answer 304 when nothing changed", () => {
  for (const path of POLLED) {
    it(`${path}: ETag, then 304 with If-None-Match, then 200 after a change`, async () => {
      const first = await api(path, { cookie: s.manager });
      expect(first.status).toBe(200);
      const tag = first.headers.get("etag");
      expect(tag).toMatch(/^W\/".+"$/);
      expect(first.headers.get("cache-control")).toBe("private, no-cache");

      const again = await api(path, { cookie: s.manager, headers: { "if-none-match": tag! } });
      expect(again.status).toBe(304);
      expect(again.headers.get("etag")).toBe(tag);

      await insertDocket("777");
      const after = await api(path, { cookie: s.manager, headers: { "if-none-match": tag! } });
      expect(after.status).toBe(200);
      expect(after.headers.get("etag")).not.toBe(tag);
    });
  }

  it("the ETag is per user and per query", async () => {
    await createUser("other", "manager");
    const other = await login("other");
    const a = (await api("/api/dockets?view=active", { cookie: s.manager })).headers.get("etag");
    const b = (await api("/api/dockets?view=active", { cookie: other })).headers.get("etag");
    const c = (await api("/api/dockets?view=on_hold", { cookie: s.manager })).headers.get("etag");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("a 403 or a bad request is never cached", async () => {
    const res = await api("/api/dockets?view=active&bucket=coming", { cookie: s.manager });
    expect(res.status).toBe(400);
    expect(res.headers.get("etag")).toBeNull();
  });
});

describe("data_version triggers", () => {
  it("every table the polled views read bumps the version", async () => {
    const steps: [string, string][] = [
      ["dockets", "INSERT INTO dockets (work_order, sheet_row, comp, hold, inv, status, billing, row_hash, synced_at) VALUES ('778', 2, 0, 0, 0, 'active', 'not_billed', 'h', 't')"],
      ["dockets update", "UPDATE dockets SET customer = 'X' WHERE work_order = '778'"],
      ["virtual_dockets", `INSERT INTO virtual_dockets (work_order, state, form_json, created_by, created_at, updated_by, updated_at) VALUES ('778', 'saved', '{}', ${s.ids.mgr}, 't', ${s.ids.mgr}, 't')`],
      ["cards", "INSERT INTO cards (work_order, job_sort, job_name, step, role_id, assignee_ids, status, fields_json, version, updated_at) VALUES ('778', 0, 'J', 1, 'designer', '[]', 'active', '{}', 1, 't')"],
      ["task_cards", `INSERT INTO task_cards (from_user, to_user, note, due_kind, status, created_at) VALUES (${s.ids.mgr}, ${s.ids.boss}, 'n', 'none', 'open', 't')`],
      ["docket_follows", `INSERT INTO docket_follows (user_id, work_order, added_at) VALUES (${s.ids.mgr}, '778', 't')`],
      ["users", `UPDATE users SET full_name = 'Mgr' WHERE id = ${s.ids.mgr}`],
      ["user_codes", `INSERT INTO user_codes (code, user_id, sort) VALUES ('QX', ${s.ids.mgr}, 1)`],
      ["user_roles", `INSERT INTO user_roles (user_id, role_id) VALUES (${s.ids.mgr}, 'designer')`],
      ["card_seen", `INSERT INTO card_seen (user_id, card_id, seen_at) VALUES (${s.ids.mgr}, (SELECT max(id) FROM cards), 't')`],
      ["dockets delete", "DELETE FROM dockets WHERE work_order = '778'"],
    ];
    for (const [name, sql] of steps) {
      const before = await version();
      await env.DB.prepare(sql).run();
      expect(await version(), name).toBeGreaterThan(before);
    }
  });

  it("a card field save that changes nothing the dashboard shows does not bump it", async () => {
    await env.DB.prepare(
      `INSERT INTO virtual_dockets (work_order, state, form_json, created_by, created_at, updated_by, updated_at) VALUES ('779', 'saved', '{}', ${s.ids.mgr}, 't', ${s.ids.mgr}, 't')`,
    ).run();
    await env.DB.prepare(
      "INSERT INTO cards (work_order, job_sort, job_name, step, role_id, assignee_ids, status, fields_json, version, updated_at) VALUES ('779', 0, 'J', 1, 'finishing', '[]', 'active', '{}', 1, 't')",
    ).run();
    const before = await version();
    await env.DB.prepare(
      "UPDATE cards SET fields_json = '{\"notes\":\"x\"}', version = version + 1, updated_at = 'u' WHERE work_order = '779'",
    ).run();
    expect(await version()).toBe(before);
    // Vendor pickup shows on the dashboard tile: that field does bump it.
    await env.DB.prepare("UPDATE cards SET fields_json = '{\"notes\":\"x\",\"vendorPickup\":1}' WHERE work_order = '779'").run();
    expect(await version()).toBeGreaterThan(before);
  });
});
