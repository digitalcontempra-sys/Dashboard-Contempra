import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CardDTO, VirtualDocketDTO } from "../../src/shared/types";
import { cardsOf, docketForm, errorOf, post, put, route, setupCards, teardownCards } from "./cardHelpers";
import { api } from "./helpers";

let t: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  t = await setupCards();
});
afterEach(teardownCards);

type Target = { userId: number; roleId?: string | null; instruction: string };

export async function handDocket(cookie: string, handoff: Target[]) {
  const res = await api("/api/virtual-dockets", { method: "POST", cookie, json: { form: docketForm(), handoff } });
  expect(res.status).toBe(200);
  return (await res.json()) as VirtualDocketDTO;
}

const myCards = async (cookie: string) => (await (await api("/api/my-cards", { cookie })).json()) as CardDTO[];

describe("starting a docket", () => {
  it("gives each chosen person an active card with what to do", async () => {
    const ira = await t.staffWith("ira", "designer");
    await t.staffWith("seb", "printer_fb");
    const d = await handDocket(t.manager, [
      { userId: t.ids.ira, roleId: "designer", instruction: "Logo proof" },
      { userId: t.ids.seb, instruction: "Print 2 banners" },
    ]);
    const cards = await cardsOf(d.workOrder);
    expect(cards.map((c) => [c.role_id, c.status])).toEqual([
      ["designer", "active"],
      ["printer_fb", "active"],
    ]);
    const mine = await myCards(ira);
    expect(mine).toHaveLength(1);
    expect(mine[0].instruction).toBe("Logo proof");
    expect(mine[0].from?.name).toBe("mgr");
    const ev = await env.DB.prepare("SELECT action, detail_json FROM card_events WHERE work_order = ? ORDER BY id")
      .bind(d.workOrder)
      .all<{ action: string; detail_json: string }>();
    expect(ev.results.map((e) => e.action)).toEqual(["activated", "activated"]);
    expect(JSON.parse(ev.results[0].detail_json)).toEqual({ assignees: [t.ids.ira], from: t.ids.mgr });
  });

  it("a person without an area gets a general card and sees it", async () => {
    const kristy = await t.staffWith("kristy");
    const d = await handDocket(t.manager, [{ userId: t.ids.kristy, instruction: "Call the client" }]);
    expect((await cardsOf(d.workOrder))[0].role_id).toBe("general");
    expect((await myCards(kristy)).map((c) => c.roleId)).toEqual(["general"]);
  });

  it("refuses a missing note", async () => {
    await t.staffWith("seb", "printer_fb");
    const res = await api("/api/virtual-dockets", {
      method: "POST",
      cookie: t.manager,
      json: { form: docketForm(), handoff: [{ userId: t.ids.seb, instruction: "" }] },
    });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Write what to do for seb.");
  });

  it("a saved docket without cards can be handed over once; then it is in production", async () => {
    await t.staffWith("seb", "printer_fb");
    const res = await api("/api/virtual-dockets", { method: "POST", cookie: t.manager, json: { form: docketForm() } });
    const d = (await res.json()) as VirtualDocketDTO;
    expect(d.inProduction).toBe(false);
    const body = { form: docketForm(), version: d.version, handoff: [{ userId: t.ids.seb, instruction: "Cut" }] };
    const first = await put(`/api/virtual-dockets/${d.workOrder}`, t.manager, body);
    expect(first.status).toBe(200);
    expect(((await first.json()) as VirtualDocketDTO).inProduction).toBe(true);
    const again = await put(`/api/virtual-dockets/${d.workOrder}`, t.manager, { ...body, version: d.version + 1 });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("This docket is already in production.");
  });

  it("editing a docket without a route keeps its cards", async () => {
    await t.staffWith("seb", "printer_fb");
    const d = await handDocket(t.manager, [{ userId: t.ids.seb, instruction: "Cut" }]);
    const res = await put(`/api/virtual-dockets/${d.workOrder}`, t.manager, { form: docketForm({ forName: "New name" }), version: d.version });
    expect(res.status).toBe(200);
    expect(await cardsOf(d.workOrder)).toHaveLength(1);
  });

  it("an old route still makes route cards", async () => {
    await t.staffWith("pat", "printer_roll");
    const res = await post("/api/virtual-dockets", t.manager, { form: docketForm(), jobs: route("printer_roll", "finishing") });
    const d = (await res.json()) as VirtualDocketDTO;
    expect((await cardsOf(d.workOrder)).map((c) => c.status)).toEqual(["active", "waiting"]);
  });
});
