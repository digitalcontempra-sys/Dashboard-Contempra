import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("schema", () => {
  it("seeds the seven production roles in order", async () => {
    const { results } = await env.DB.prepare("SELECT id FROM roles ORDER BY sort").all<{ id: string }>();
    expect(results.map((r) => r.id)).toEqual([
      "designer", "printer_roll", "printer_fb", "laminate_roll", "liquid_lam", "colex_finish", "finishing",
    ]);
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
