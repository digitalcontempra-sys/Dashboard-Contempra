import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("schema", () => {
  it("seeds the eight production roles in order", async () => {
    const { results } = await env.DB.prepare("SELECT id, label FROM roles ORDER BY sort").all<{ id: string; label: string }>();
    expect(results.map((r) => r.id)).toEqual([
      "designer", "printer_roll", "printer_fb", "laminate_roll", "contour_cut", "liquid_lam", "colex", "finishing", "installer",
    ]);
    expect(results.find((r) => r.id === "colex")?.label).toBe("Colex");
    expect(results.find((r) => r.id === "installer")?.label).toBe("Installer");
    expect(results.find((r) => r.id === "contour_cut")?.label).toBe("Contour Cut");
  });
  it("card rows cascade away with their virtual docket", async () => {
    const now = new Date().toISOString();
    const u = await env.DB.prepare(
      "INSERT INTO users (username, full_name, access_level, password_hash, created_at) VALUES ('cx','cx','staff','h',?) RETURNING id, sound_on",
    ).bind(now).first<{ id: number; sound_on: number }>();
    expect(u!.sound_on).toBe(1);
    await env.DB.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, 'colex')").bind(u!.id).run();
    await env.DB.prepare(
      "INSERT INTO virtual_dockets (work_order, state, form_json, created_by, created_at, updated_by, updated_at) VALUES ('77001','saved','{}',?,?,?,?)",
    ).bind(u!.id, now, u!.id, now).run();
    const card = await env.DB.prepare(
      "INSERT INTO cards (work_order, job_sort, job_name, step, role_id, status, updated_at) VALUES ('77001',0,'Whole docket',0,'colex','active',?) RETURNING id",
    ).bind(now).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO card_events (card_id, role_id, work_order, action, user_id, at) VALUES (?, 'colex', '77001', 'activated', ?, ?)").bind(card!.id, u!.id, now).run();
    await env.DB.prepare("INSERT INTO card_seen (user_id, card_id, seen_at) VALUES (?, ?, ?)").bind(u!.id, card!.id, now).run();
    await env.DB.prepare("DELETE FROM virtual_dockets WHERE work_order = '77001'").run();
    for (const t of ["cards", "card_events", "card_seen"]) {
      const r = await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>();
      expect(r!.n).toBe(0);
    }
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(u!.id).run();
  });
  it("seeds the singleton sync_state row", async () => {
    const r = await env.DB.prepare("SELECT id FROM sync_state").first<{ id: number }>();
    expect(r?.id).toBe(1);
  });
  it("rejects an unknown docket status", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO dockets (work_order, sheet_row, comp, hold, inv, due_rush, status, billing, row_hash, synced_at) VALUES ('1',2,0,0,0,0,'weird','billed','h','t')",
      ).run(),
    ).rejects.toThrow();
  });
});
