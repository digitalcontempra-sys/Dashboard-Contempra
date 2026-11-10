import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocketListResponse } from "../../src/shared/types";
import { cardsOf, newDocket, route, setupCards, step, teardownCards } from "./cardHelpers";
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
