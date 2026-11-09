import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocketListResponse } from "../../src/shared/types";
import { cardsOf, newDocket, route, setupCards, teardownCards } from "./cardHelpers";
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
