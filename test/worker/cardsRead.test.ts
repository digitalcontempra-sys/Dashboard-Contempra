import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BoardDTO, CardDTO, CardEventDTO, MyCardsSummary } from "../../src/shared/types";
import { cardsOf, newDocket, post, put, route, setupCards, step, teardownCards } from "./cardHelpers";
import { api } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
});
afterEach(teardownCards);

const getJson = async <T>(path: string, cookie: string): Promise<T> => {
  const res = await api(path, { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
};
const myCards = (cookie: string) => getJson<CardDTO[]>("/api/my-cards", cookie);
const summary = (cookie: string) => getJson<MyCardsSummary>("/api/my-cards/summary", cookie);

describe("My Cards", () => {
  it("a team card shows for everyone with the role", async () => {
    const erin = await s.staffWith("erin", "printer_roll");
    const seb = await s.staffWith("seb", "printer_roll", "designer");
    const { workOrder } = await newDocket(s.manager, route("printer_roll", "laminate_roll"));
    for (const who of [erin, seb]) {
      const cards = await myCards(who);
      expect(cards.map((c) => [c.workOrder, c.roleId, c.status, c.team])).toEqual([[workOrder, "printer_roll", "active", true]]);
      expect(cards[0].header.customer).toBe("Encore Lounge");
      expect(cards[0].nextRoleId).toBe("laminate_roll");
    }
  });

  it("a card for specific people is hidden from the rest of the team", async () => {
    const erin = await s.staffWith("erin", "printer_roll");
    const seb = await s.staffWith("seb", "printer_roll");
    await newDocket(s.manager, [{ name: "Whole docket", steps: [step("printer_roll", [s.ids.erin])] }]);
    expect(await myCards(erin)).toHaveLength(1);
    expect(await myCards(seb)).toHaveLength(0);
  });

  it("shows each card once, even with two roles and two jobs", async () => {
    const seb = await s.staffWith("seb", "printer_roll", "designer");
    await newDocket(s.manager, [
      { name: "Banner", steps: [step("printer_roll")] },
      { name: "Decals", steps: [step("printer_roll")] },
    ]);
    const cards = await myCards(seb);
    expect(cards.filter((c) => c.status === "active")).toHaveLength(2);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it("lists waiting cards of the user's roles as Up next", async () => {
    const lam = await s.staffWith("lee", "laminate_roll");
    await newDocket(s.manager, route("printer_roll", "laminate_roll"));
    const cards = await myCards(lam);
    expect(cards.map((c) => c.status)).toEqual(["waiting"]);
  });

  it("a card is new until opened, and new again after a send-back", async () => {
    const erin = await s.staffWith("erin", "printer_roll");
    const d = await newDocket(s.manager, route("printer_roll", "laminate_roll"));
    let [card] = await myCards(erin);
    expect(card.isNew).toBe(true);
    expect((await summary(erin)).newCount).toBe(1);
    expect((await post(`/api/cards/${card.id}/seen`, erin)).status).toBe(200);
    [card] = await myCards(erin);
    expect(card.isNew).toBe(false);
    expect((await summary(erin)).newCount).toBe(0);

    await put(`/api/cards/${card.id}/fields`, erin, { fields: { printed: true, file: "ok" }, version: card.version });
    await post(`/api/cards/${card.id}/continue`, erin, { version: card.version + 1 });
    const lamCard = (await cardsOf(d.workOrder))[1];
    await new Promise((r) => setTimeout(r, 5));
    await post(`/api/cards/${lamCard.id}/send-back`, s.manager, { toStep: 0, reason: "Wrong size", version: lamCard.version });
    [card] = await myCards(erin);
    expect(card.isNew).toBe(true);
    expect(card.returned).toEqual({ reason: "Wrong size", by: "mgr" });
  });

  it("cancelled and trashed dockets drop out; restore brings them back", async () => {
    const erin = await s.staffWith("erin", "printer_roll");
    const a = await newDocket(s.manager, route("printer_roll"));
    const b = await newDocket(s.manager, route("printer_roll"));
    expect(await myCards(erin)).toHaveLength(2);
    expect((await post(`/api/virtual-dockets/${a.workOrder}/cancel`, s.manager)).status).toBe(200);
    expect((await api(`/api/virtual-dockets/${b.workOrder}`, { method: "DELETE", cookie: s.admin, json: { confirm: b.workOrder } })).status).toBe(200);
    expect(await myCards(erin)).toHaveLength(0);
    const board = await getJson<BoardDTO>("/api/production-board", s.manager);
    expect(board.columns.flatMap((c) => c.cards)).toHaveLength(0);
    expect((await post(`/api/virtual-dockets/${b.workOrder}/restore`, s.admin)).status).toBe(200);
    expect((await myCards(erin)).map((c) => c.workOrder)).toEqual([b.workOrder]);
  });

  it("the summary carries the sound setting", async () => {
    const erin = await s.staffWith("erin", "printer_roll");
    expect((await summary(erin)).soundOn).toBe(true);
    expect((await put("/api/me/sound", erin, { on: false })).status).toBe(200);
    expect((await summary(erin)).soundOn).toBe(false);
  });

  it("a card can be read by its team and managers only", async () => {
    const erin = await s.staffWith("erin", "printer_roll");
    const ira = await s.staffWith("ira", "designer");
    await newDocket(s.manager, route("printer_roll"));
    const [card] = await myCards(erin);
    expect((await api(`/api/cards/${card.id}`, { cookie: erin })).status).toBe(200);
    expect((await api(`/api/cards/${card.id}`, { cookie: s.manager })).status).toBe(200);
    expect((await api(`/api/cards/${card.id}`, { cookie: ira })).status).toBe(404);
  });
});

describe("Production Board", () => {
  it("groups active cards by area and flags roles with no one", async () => {
    await s.staffWith("erin", "printer_roll");
    await newDocket(s.manager, route("printer_roll"));
    await newDocket(s.manager, route("liquid_lam"));
    const board = await getJson<BoardDTO>("/api/production-board", s.manager);
    const col = (id: string) => board.columns.find((c) => c.roleId === id)!;
    expect(col("printer_roll").area).toBe("Print Roll");
    expect(col("printer_roll").cards).toHaveLength(1);
    expect(col("printer_roll").cards[0].noMembers).toBe(false);
    expect(col("liquid_lam").cards[0].noMembers).toBe(true);
    expect(board.columns.map((c) => c.roleId)[0]).toBe("designer");
    expect(board.productionColumnsReady).toBe(false);
  });

  it("filters by area and person, and is closed to Staff", async () => {
    const erin = await s.staffWith("erin", "printer_roll");
    await newDocket(s.manager, [{ name: "Whole docket", steps: [step("printer_roll", [s.ids.erin])] }]);
    await newDocket(s.manager, route("colex"));
    let board = await getJson<BoardDTO>("/api/production-board?area=colex", s.manager);
    expect(board.columns.flatMap((c) => c.cards).map((c) => c.roleId)).toEqual(["colex"]);
    board = await getJson<BoardDTO>(`/api/production-board?user=${s.ids.erin}`, s.manager);
    expect(board.columns.flatMap((c) => c.cards).map((c) => c.roleId)).toEqual(["printer_roll"]);
    expect((await api("/api/production-board", { cookie: erin })).status).toBe(403);
  });
});

describe("History", () => {
  it("managers see the docket's journey; Staff cannot", async () => {
    const erin = await s.staffWith("erin", "laminate_roll");
    const d = await newDocket(s.manager, route("designer", "laminate_roll"));
    const [c0] = await cardsOf(d.workOrder);
    await post(`/api/cards/${c0.id}/continue`, s.manager, { version: c0.version });
    const lam = (await cardsOf(d.workOrder))[1];
    await post(`/api/cards/${lam.id}/send-back`, erin, { toStep: 0, reason: "Cut file missing", version: lam.version });
    const h = await getJson<CardEventDTO[]>(`/api/virtual-dockets/${d.workOrder}/history`, s.manager);
    expect(h.map((e) => `${e.area} · ${e.user} · ${e.detail}`)).toEqual([
      "Design · mgr · Arrived",
      "Design · mgr · Send to production → Laminate",
      "Laminate · mgr · Arrived",
      "Laminate · erin · Sent back to Design · Cut file missing",
      "Design · erin · Arrived",
    ]);
    expect((await api(`/api/virtual-dockets/${d.workOrder}/history`, { cookie: erin })).status).toBe(403);
  });
});

void env;
