import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CardDTO, VirtualDocketDTO } from "../../src/shared/types";
import {
  allCards as all,
  cardOf,
  cardsOf,
  docketForm,
  errorOf,
  handDocket,
  move,
  post,
  put,
  route,
  setupCards,
  teardownCards,
  type HandoffCard as Card,
} from "./cardHelpers";
import { api } from "./helpers";

let t: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  t = await setupCards();
});
afterEach(teardownCards);

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

  it("an old route still makes route cards (API only)", async () => {
    await t.staffWith("pat", "printer_roll");
    const res = await post("/api/virtual-dockets", t.manager, { form: docketForm(), jobs: route("printer_roll", "finishing") });
    const d = (await res.json()) as VirtualDocketDTO;
    expect((await cardsOf(d.workOrder)).map((c) => c.status)).toEqual(["active", "waiting"]);
  });
});

const actions = async (wo: string) =>
  (await env.DB.prepare("SELECT action FROM card_events WHERE work_order = ? ORDER BY id").bind(wo).all<{ action: string }>()).results.map(
    (e) => e.action,
  );
const queued = (wo: string) => env.DB.prepare("SELECT comp FROM card_sheet_queue WHERE work_order = ?").bind(wo).first<{ comp: number | null }>();

/** Continues a card to one person and returns that person's new card. */
async function giveTo(c: Card, cookie: string, userId: number): Promise<Card> {
  const res = await move(c, "continue", cookie, { to: [{ userId, instruction: "Do it" }] });
  expect(res.status).toBe(200);
  const wo = ((await res.json()) as CardDTO).workOrder;
  return cardOf(wo, userId);
}

describe("card moves", () => {
  let ira: string, seb: string, pat: string, wo: string;
  beforeEach(async () => {
    ira = await t.staffWith("ira", "designer");
    seb = await t.staffWith("seb", "printer_fb");
    pat = await t.staffWith("pat", "finishing");
    wo = (await handDocket(t.manager, [{ userId: t.ids.ira, roleId: "designer", instruction: "Logo" }])).workOrder;
  });

  it("Continue hands the docket to one or more people with what to do", async () => {
    const mine = await cardOf(wo, t.ids.ira);
    const res = await move(mine, "continue", ira, {
      to: [
        { userId: t.ids.seb, instruction: "Print 2 banners 3x6" },
        { userId: t.ids.pat, instruction: "Grommets" },
      ],
    });
    expect(res.status).toBe(200);
    expect((await all(wo)).find((c) => c.id === mine.id)!.status).toBe("done");
    const s = await cardOf(wo, t.ids.seb);
    expect([s.role_id, s.instruction, s.from_user_id]).toEqual(["printer_fb", "Print 2 banners 3x6", t.ids.ira]);
    expect((await cardOf(wo, t.ids.pat)).instruction).toBe("Grommets");
    expect(await actions(wo)).toEqual(["activated", "continued", "activated", "activated"]);
  });

  it("Continue needs someone to send to, the area's required fields, and a fresh version", async () => {
    const mine = await cardOf(wo, t.ids.ira);
    expect(await errorOf(await move(mine, "continue", ira, { to: [] }))).toBe("Choose at least one person.");
    const s = await giveTo(mine, ira, t.ids.seb);
    const blocked = await move(s, "continue", seb, { to: [{ userId: t.ids.pat, instruction: "x" }] });
    expect(blocked.status).toBe(409);
    expect(await errorOf(blocked)).toBe('Mark "Printed" to continue');
    const stale = await move({ ...s, version: s.version - 1 }, "done", seb);
    expect(stale.status).toBe(409);
    expect(await errorOf(stale)).toMatch(/^This card was already moved by /);
  });

  it("Done ends only my part and sends the docket back to its creator, Ready to close", async () => {
    expect((await move(await cardOf(wo, t.ids.ira), "done", ira)).status).toBe(200);
    const creator = await cardOf(wo, t.ids.mgr, { creator: true });
    expect([creator.role_id, creator.stage, creator.from_user_id]).toEqual(["general", "ready_to_close", t.ids.ira]);
    expect(await actions(wo)).toEqual(["activated", "done", "activated"]);
  });

  it("Proof sent waits for the client; Approved → Continue moves on", async () => {
    await move(await cardOf(wo, t.ids.ira), "proof-sent", ira);
    const creator = await cardOf(wo, t.ids.mgr, { creator: true });
    expect(creator.stage).toBe("waiting_design");
    expect((await move(creator, "continue", t.manager, { to: [{ userId: t.ids.seb, instruction: "Print" }] })).status).toBe(200);
    expect((await cardOf(wo, t.ids.seb)).from_user_id).toBe(t.ids.mgr);
    expect((await actions(wo)).slice(-3)).toEqual(["approved", "continued", "activated"]);
  });

  it("only some areas send proofs or samples, and the creator's card cannot be Done", async () => {
    const s = await giveTo(await cardOf(wo, t.ids.ira), ira, t.ids.seb);
    expect(await errorOf(await move(s, "proof-sent", seb))).toBe("This card can't send a proof.");
    expect((await move(s, "sample-sent", seb)).status).toBe(200);
    const creator = await cardOf(wo, t.ids.mgr, { creator: true });
    expect(creator.stage).toBe("waiting_sample");
    expect(await errorOf(await move(creator, "done", t.manager))).toBe("Use Close docket or Continue.");
  });

  it("the creator sends a proof back; the designer's card reopens with the reason", async () => {
    const designer = await cardOf(wo, t.ids.ira);
    await move(designer, "proof-sent", ira);
    expect((await move(await cardOf(wo, t.ids.mgr, { creator: true }), "send-back", t.manager, { reason: "Logo bigger" })).status).toBe(200);
    const again = await cardOf(wo, t.ids.ira);
    expect([again.id, again.returned_reason]).toEqual([designer.id, "Logo bigger"]);
    expect((await all(wo)).find((c) => c.stage)!.status).toBe("waiting");
  });

  it("a card sent back is parked and comes back with its fields when handed over again", async () => {
    const s = await giveTo(await cardOf(wo, t.ids.ira), ira, t.ids.seb);
    await put(`/api/cards/${s.id}/fields`, seb, { fields: { sheetSize: "4x8" }, version: s.version });
    const fresh = (await all(wo)).find((c) => c.id === s.id)!;
    expect((await move(fresh, "send-back", seb, { reason: "Wrong size" })).status).toBe(200);
    expect((await all(wo)).find((c) => c.id === s.id)!.status).toBe("waiting");
    const back = await cardOf(wo, t.ids.ira);
    expect(back.returned_reason).toBe("Wrong size");
    await move(back, "continue", ira, { to: [{ userId: t.ids.seb, instruction: "Fixed size" }] });
    const reused = await cardOf(wo, t.ids.seb);
    expect(reused.id).toBe(s.id);
    expect(JSON.parse(reused.fields_json).sheetSize).toBe("4x8");
    expect(reused.instruction).toBe("Fixed size");
  });

  it("Close docket waits for every branch, then sets COMP", async () => {
    await move(await cardOf(wo, t.ids.ira), "continue", ira, {
      to: [
        { userId: t.ids.seb, instruction: "a" },
        { userId: t.ids.pat, instruction: "b" },
      ],
    });
    await env.DB.prepare("UPDATE cards SET fields_json = ? WHERE role_id = 'finishing'")
      .bind(JSON.stringify({ packaged: "ready", leftAt: "Shelf 2" }))
      .run();
    expect((await move(await cardOf(wo, t.ids.pat), "done", pat)).status).toBe(200);
    const blocked = await move(await cardOf(wo, t.ids.mgr, { creator: true }), "close", t.manager);
    expect(blocked.status).toBe(409);
    expect(await errorOf(blocked)).toBe("Other people still have this docket open.");
    await env.DB.prepare("UPDATE cards SET fields_json = ? WHERE role_id = 'printer_fb'")
      .bind(JSON.stringify({ printed: true, sheetKind: "new", sheetSize: "4x8", sheetQty: "2", file: "ok" }))
      .run();
    expect((await move(await cardOf(wo, t.ids.seb), "done", seb)).status).toBe(200);
    expect((await move(await cardOf(wo, t.ids.mgr, { creator: true }), "close", t.manager)).status).toBe(200);
    expect((await all(wo)).every((c) => c.status === "done")).toBe(true);
    expect((await queued(wo))?.comp).toBe(1);
    expect((await actions(wo)).at(-1)).toBe("closed");
  });

  it("Close is only for a docket that is Ready to close", async () => {
    await move(await cardOf(wo, t.ids.ira), "proof-sent", ira);
    const res = await move(await cardOf(wo, t.ids.mgr, { creator: true }), "close", t.manager);
    expect(await errorOf(res)).toBe("This docket is not ready to close.");
  });

  it("an admin restores a closed docket as Ready to close, and clears COMP", async () => {
    await move(await cardOf(wo, t.ids.ira), "done", ira);
    const creator = await cardOf(wo, t.ids.mgr, { creator: true });
    await move(creator, "close", t.manager);
    expect((await post(`/api/cards/${creator.id}/restore`, t.manager)).status).toBe(403);
    expect((await post(`/api/cards/${creator.id}/restore`, t.admin)).status).toBe(200);
    expect((await cardOf(wo, t.ids.mgr, { creator: true })).stage).toBe("ready_to_close");
    expect((await queued(wo))?.comp).toBe(0);
    expect((await actions(wo)).at(-1)).toBe("restored");
  });

  it("an admin reopens a card finished by mistake for its person", async () => {
    const mine = await cardOf(wo, t.ids.ira);
    await giveTo(mine, ira, t.ids.seb);
    expect((await post(`/api/cards/${mine.id}/restore`, t.admin)).status).toBe(200);
    expect((await cardOf(wo, t.ids.ira)).id).toBe(mine.id);
    expect(await errorOf(await post(`/api/cards/${mine.id}/restore`, t.admin))).toBe("Only a finished card can be restored.");
  });

  it("a cancelled or trashed docket's cards cannot move or be restored", async () => {
    const mine = await cardOf(wo, t.ids.ira);
    expect((await post(`/api/virtual-dockets/${wo}/cancel`, t.manager)).status).toBe(200);
    const res = await move(mine, "done", ira);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("This docket is cancelled or in the Trash.");
    await env.DB.prepare("UPDATE cards SET status = 'done' WHERE id = ?").bind(mine.id).run();
    expect(await errorOf(await post(`/api/cards/${mine.id}/restore`, t.admin))).toBe("This docket is cancelled or in the Trash.");
  });

  it("a docket without a creator refuses Done and keeps the card open", async () => {
    const mine = await cardOf(wo, t.ids.ira);
    await env.DB.prepare("UPDATE virtual_dockets SET created_by = NULL, updated_by = NULL WHERE work_order = ?").bind(wo).run();
    expect(await errorOf(await move(mine, "done", ira))).toBe("This docket has no creator to return to.");
    expect((await all(wo)).find((c) => c.id === mine.id)!.status).toBe("active");
  });

  it("an old route card continues with the new buttons; its waiting cards are dropped", async () => {
    const res = await post("/api/virtual-dockets", t.manager, { form: docketForm(), jobs: route("designer", "finishing") });
    const old = ((await res.json()) as VirtualDocketDTO).workOrder;
    const [first] = await all(old);
    expect((await move(first, "continue", ira, { to: [{ userId: t.ids.seb, instruction: "Print" }] })).status).toBe(200);
    expect((await all(old)).map((c) => [c.role_id, c.status])).toEqual([
      ["designer", "done"],
      ["printer_fb", "active"],
    ]);
  });
});
