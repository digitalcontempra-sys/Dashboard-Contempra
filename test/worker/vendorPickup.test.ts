import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocketDetail, DocketListResponse } from "../../src/shared/types";
import { cardsOf, handDocket, newDocket, route, setupCards, step, teardownCards } from "./cardHelpers";
import { api } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
});
afterEach(teardownCards);

describe("Vendor pickup ready", () => {
  it("flags dockets whose finishing card is ready for vendor pickup and not shipped", async () => {
    const a = await newDocket(s.manager, route("finishing"));
    const b = await newDocket(s.manager, route("finishing"));
    const [ca] = await cardsOf(a.workOrder);
    const [cb] = await cardsOf(b.workOrder);
    await env.DB.batch([
      env.DB.prepare(`UPDATE cards SET fields_json = '{"vendorPickup":true}' WHERE id = ?`).bind(ca.id),
      env.DB.prepare(`UPDATE cards SET fields_json = '{"vendorPickup":true,"packaged":"shipped"}' WHERE id = ?`).bind(cb.id),
    ]);
    const res = await api("/api/dockets?view=active", { cookie: s.manager });
    const list = (await res.json()) as DocketListResponse;
    const flag = (wo: string) => list.items.find((d) => d.workOrder === wo)?.vendorPickup;
    expect(flag(a.workOrder)).toBe(true);
    expect(flag(b.workOrder)).toBe(false);
  });
});

describe("current area on the Main Dashboard", () => {
  const list = async () => ((await (await api("/api/dockets?view=active", { cookie: s.manager })).json()) as DocketListResponse).items;

  it("lists each active area once, in production order", async () => {
    const d = await newDocket(s.manager, [
      { name: "Banner", steps: [step("colex")] },
      { name: "Decals", steps: [step("printer_roll")] },
      { name: "Signs", steps: [step("printer_roll")] },
    ]);
    const item = (await list()).find((x) => x.workOrder === d.workOrder)!;
    expect(item.areas).toEqual(["printer_roll", "colex"]);
    expect(item.productionDone).toBe(false);
  });

  it("says who has the docket now, per area (whoever started it, else who it was sent to)", async () => {
    await s.staffWith("gary", "measure");
    await s.staffWith("ira", "designer");
    const d = await handDocket(s.manager, [
      { userId: s.ids.ira, instruction: "Logo" },
      { userId: s.ids.gary, instruction: "Measure" },
    ]);
    const item = (await list()).find((x) => x.workOrder === d.workOrder)!;
    expect(item.holders).toEqual([
      { roleId: "designer", names: ["ira"] },
      { roleId: "measure", names: ["gary"] },
    ]);
    const team = await newDocket(s.manager, route("colex"));
    expect((await list()).find((x) => x.workOrder === team.workOrder)!.holders).toEqual([{ roleId: "colex", names: [] }]);
    const [c] = await cardsOf(team.workOrder);
    await env.DB.prepare("UPDATE cards SET claimed_by = ? WHERE id = ?").bind(s.ids.gary, c.id).run();
    expect((await list()).find((x) => x.workOrder === team.workOrder)!.holders).toEqual([{ roleId: "colex", names: ["gary"] }]);
    // The docket detail says it too.
    const detail = (await (await api(`/api/dockets/${d.workOrder}`, { cookie: s.manager })).json()) as DocketDetail;
    expect(detail.holders).toEqual([
      { roleId: "designer", names: ["ira"] },
      { roleId: "measure", names: ["gary"] },
    ]);
  });

  it("says done when every card is done, and nothing without a route", async () => {
    const a = await newDocket(s.manager, route("colex"));
    const [c] = await cardsOf(a.workOrder);
    await env.DB.prepare("UPDATE cards SET status = 'done' WHERE id = ?").bind(c.id).run();
    const b = await newDocket(s.manager, [{ name: "Whole docket", steps: [] }]);
    const items = await list();
    expect(items.find((x) => x.workOrder === a.workOrder)).toMatchObject({ areas: [], productionDone: true });
    expect(items.find((x) => x.workOrder === b.workOrder)).toMatchObject({ areas: [], productionDone: false });
  });
});
