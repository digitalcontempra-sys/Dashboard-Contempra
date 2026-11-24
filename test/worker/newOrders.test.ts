import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VirtualDocketDTO } from "../../src/shared/types";
import { flushCardSheet } from "../../src/worker/cards/sheetSync";
import { listDockets } from "../../src/worker/db/dockets";
import { cardsOf, docketForm, errorOf, handDocket, post, put, setupCards, teardownCards } from "./cardHelpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
});
afterEach(teardownCards);

const NOTE = "Waiting for measurements";
const newOrder = async (body = NOTE) => post("/api/virtual-dockets", s.manager, { form: docketForm({ body }), newOrder: true });
const flag = async (wo: string) =>
  (await env.DB.prepare("SELECT new_order FROM virtual_dockets WHERE work_order = ?").bind(wo).first<{ new_order: number }>())?.new_order;
const newOrderWos = async () => (await listDockets(env.DB, { view: "active", bucket: "new_orders" }, new Date())).items.map((i) => i.workOrder);

describe("Save as New Order", () => {
  it("saves with the customer and a note, and lands in New Orders", async () => {
    const res = await newOrder();
    expect(res.status).toBe(200);
    const d = (await res.json()) as VirtualDocketDTO;
    expect(d).toMatchObject({ newOrder: true, inProduction: false });
    expect(await flag(d.workOrder)).toBe(1);
    expect(await newOrderWos()).toEqual([d.workOrder]);
  });

  it("needs a note in the description", async () => {
    const res = await newOrder("  ");
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("Write what's missing in the description (for example, waiting for measurements).");
  });

  it("is not handed to people at the same time", async () => {
    await s.staffWith("seb", "printer_fb");
    const res = await post("/api/virtual-dockets", s.manager, {
      form: docketForm({ body: NOTE }),
      newOrder: true,
      handoff: [{ userId: s.ids.seb, instruction: "Cut" }],
    });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("A new order is saved without Send to.");
  });

  it("is not combined with an old route either (API only)", async () => {
    const res = await post("/api/virtual-dockets", s.manager, {
      form: docketForm({ body: NOTE }),
      newOrder: true,
      jobs: [{ name: "Whole docket", steps: [{ roleId: "designer", assigneeIds: [] }] }],
    });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("A new order is saved without Send to.");
  });

  it("a plain Save keeps it a New Order; handing it to people takes it out", async () => {
    await s.staffWith("seb", "printer_fb");
    const d = (await (await newOrder()).json()) as VirtualDocketDTO;
    const plain = await put(`/api/virtual-dockets/${d.workOrder}`, s.manager, { form: docketForm({ body: `${NOTE}, called` }), version: d.version });
    expect(plain.status).toBe(200);
    const saved = (await plain.json()) as VirtualDocketDTO;
    expect(saved.newOrder).toBe(true);
    const handed = await put(`/api/virtual-dockets/${d.workOrder}`, s.manager, {
      form: docketForm({ body: "2 banners" }),
      version: saved.version,
      handoff: [{ userId: s.ids.seb, instruction: "Cut" }],
    });
    expect(handed.status).toBe(200);
    expect(((await handed.json()) as VirtualDocketDTO).newOrder).toBe(false);
    expect(await flag(d.workOrder)).toBe(0);
    expect(await newOrderWos()).toEqual([]);
  });

  it("a saved docket without cards can become a New Order; one in production cannot", async () => {
    await s.staffWith("seb", "printer_fb");
    const plain = (await (await post("/api/virtual-dockets", s.manager, { form: docketForm({ body: NOTE }) })).json()) as VirtualDocketDTO;
    expect(plain.newOrder).toBe(false);
    const res = await put(`/api/virtual-dockets/${plain.workOrder}`, s.manager, { form: docketForm({ body: NOTE }), version: plain.version, newOrder: true });
    expect(((await res.json()) as VirtualDocketDTO).newOrder).toBe(true);

    const busy = await handDocket(s.manager, [{ userId: s.ids.seb, instruction: "Cut" }]);
    const no = await put(`/api/virtual-dockets/${busy.workOrder}`, s.manager, { form: docketForm({ body: NOTE }), version: busy.version, newOrder: true });
    expect(no.status).toBe(409);
    expect(await errorOf(no)).toBe("This docket is already in production.");
    expect(await cardsOf(busy.workOrder)).toHaveLength(1);
  });

  it("the sheet shows the creator in ROLE and Waiting for more info in STATUS, until it is handed over", async () => {
    await post("/api/admin/production-columns", s.admin, { confirm: "SET UP" });
    await s.staffWith("seb", "printer_fb");
    const d = (await (await newOrder()).json()) as VirtualDocketDTO;
    await flushCardSheet(env, d.workOrder);
    expect(s.g.sheet.rows[0][11]).toBe("STATUS");
    let r = s.g.sheet.rowOf(d.workOrder)!;
    expect([r[10], r[11]]).toEqual(["mgr", "Waiting for more info"]);

    await put(`/api/virtual-dockets/${d.workOrder}`, s.manager, {
      form: docketForm({ body: NOTE }),
      version: d.version,
      handoff: [{ userId: s.ids.seb, instruction: "Cut" }],
    });
    await flushCardSheet(env, d.workOrder);
    r = s.g.sheet.rowOf(d.workOrder)!;
    expect([r[10], r[11]]).toEqual(["seb", "Starting"]);
  });
});
