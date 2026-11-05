import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyForm, type DocketForm } from "../../src/shared/docketForm";
import { purgeTrash } from "../../src/worker/dockets/service";
import { __setTestGateways } from "../../src/worker/google/gateways";
import { GoogleDisconnectedError } from "../../src/worker/google/oauth";
import { fakeGateways } from "./fakeGoogle";
import { row } from "./fixtures";
import { api, createUser, login, resetAuthTables } from "./helpers";

let g: ReturnType<typeof fakeGateways>;
let manager = "";
let admin = "";
let staff = "";

const form = (over: Partial<DocketForm> = {}): DocketForm => {
  const f = emptyForm("2026-11-05", "Ana");
  f.forName = "Encore Lounge";
  f.body = "exterior letters?\ninterior sign";
  f.salesperson = "JB";
  f.materials[0] = { name: "IJ35", cost: "100" };
  return { ...f, ...over };
};
const jobs = [{ name: "Whole docket", steps: [{ roleId: "designer", assigneeIds: [] }] }];

const create = (cookie: string, f = form()) =>
  api("/api/virtual-dockets", { method: "POST", cookie, json: { form: f, jobs } });

beforeEach(async () => {
  g = fakeGateways();
  // Existing sheet rows: WO 91487 on top (sheet row 2).
  g.sheet.rows.push(row(91487, { 6: "Tartan Towing" }));
  __setTestGateways(g);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_steps"),
    env.DB.prepare("DELETE FROM docket_jobs"),
    env.DB.prepare("DELETE FROM virtual_dockets"),
    env.DB.prepare("DELETE FROM dockets"),
  ]);
  await resetAuthTables();
  await createUser("mgr", "manager");
  await createUser("boss", "admin");
  await createUser("ana", "staff");
  manager = await login("mgr");
  admin = await login("boss");
  staff = await login("ana");
});
afterEach(() => __setTestGateways(null));

describe("create", () => {
  it("writes the top sheet row, the mirror and the jobs", async () => {
    const res = await create(manager);
    expect(res.status).toBe(200);
    const dto = (await res.json()) as { workOrder: string; version: number };
    expect(dto.workOrder).toBe("91488");
    expect(g.sheet.rows[1][2]).toBe(91488);
    expect(g.sheet.rows[1][6]).toBe("Encore Lounge");
    const mirror = await env.DB.prepare("SELECT customer, status FROM dockets WHERE work_order = '91488'").first();
    expect(mirror).toEqual({ customer: "Encore Lounge", status: "active" });
    const job = await env.DB.prepare("SELECT name FROM docket_jobs WHERE work_order = '91488'").first();
    expect(job).toEqual({ name: "Whole docket" });
  });

  it("gives two simultaneous saves different work orders", async () => {
    const [a, b] = await Promise.all([create(manager), create(admin)]);
    const wos = [(await a.json()) as { workOrder: string }, (await b.json()) as { workOrder: string }].map((d) => d.workOrder);
    expect(new Set(wos).size).toBe(2);
    expect(g.sheet.rows.filter((r, i) => i > 0 && wos.includes(String(r[2])))).toHaveLength(2);
  });

  it("saves nothing when the sheet write fails", async () => {
    g.sheet.failNext("insertTopRow");
    const res = await create(manager);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not save to Google Sheet. Nothing was saved. Try again." });
    const n = await env.DB.prepare("SELECT count(*) AS n FROM virtual_dockets").first<{ n: number }>();
    expect(n?.n).toBe(0);
    expect(await env.DB.prepare("SELECT 1 FROM dockets WHERE work_order = '91488'").first()).toBeNull();
  });

  it("explains a disconnected Google account", async () => {
    g.sheet.insertTopRow = async () => {
      throw new GoogleDisconnectedError();
    };
    const res = await create(manager);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Google is disconnected. Ask an admin to reconnect." });
    const n = await env.DB.prepare("SELECT count(*) AS n FROM virtual_dockets").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("requires FOR", async () => {
    const res = await create(manager, form({ forName: "  " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FOR is required" });
  });

  it("forbids staff", async () => {
    expect((await create(staff)).status).toBe(403);
  });
});

describe("read", () => {
  it("hides prices from staff only", async () => {
    await create(manager);
    const s = (await (await api("/api/virtual-dockets/91488", { cookie: staff })).json()) as { form: DocketForm };
    expect(s.form.materials[0]).toEqual({ name: "IJ35", cost: "" });
    expect(s.form.gst).toBeNull();
    const m = (await (await api("/api/virtual-dockets/91488", { cookie: manager })).json()) as { form: DocketForm };
    expect(m.form.materials[0].cost).toBe("100");
  });

  it("prefills a docket that only exists in the sheet", async () => {
    await env.DB.prepare(
      "INSERT INTO dockets (work_order, sheet_row, customer, project, comp, hold, inv, due_rush, status, billing, row_hash, synced_at) VALUES ('91487', 2, 'Tartan Towing', 'Decals', 0, 0, 0, 0, 'active', 'not_billed', 'h', 't')",
    ).run();
    const dto = (await (await api("/api/virtual-dockets/91487", { cookie: manager })).json()) as {
      source: string;
      form: DocketForm;
    };
    expect(dto.source).toBe("sheet");
    expect(dto.form.forName).toBe("Tartan Towing");
  });

  it("404s an unknown work order", async () => {
    expect((await api("/api/virtual-dockets/1", { cookie: manager })).status).toBe(404);
  });
});

describe("edit", () => {
  it("updates the right row even after rows were inserted above", async () => {
    await create(manager);
    g.sheet.rows.splice(1, 0, row(99001), row(99002), row(99003));
    const res = await api("/api/virtual-dockets/91488", {
      method: "PUT",
      cookie: manager,
      json: { form: form({ forName: "Encore Lounge 2" }), jobs, version: 1 },
    });
    expect(res.status).toBe(200);
    expect(g.sheet.rowOf("91488")?.[6]).toBe("Encore Lounge 2");
    expect(g.sheet.rowOf("99001")?.[6]).toBe("Acme");
  });

  it("refuses when the row was removed from the sheet", async () => {
    await create(manager);
    g.sheet.rows = g.sheet.rows.filter((r) => String(r[2]) !== "91488");
    const res = await api("/api/virtual-dockets/91488", { method: "PUT", cookie: manager, json: { form: form(), jobs, version: 1 } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This work order is no longer in the Google Sheet" });
  });

  it("refuses a stale version", async () => {
    await create(manager);
    await api("/api/virtual-dockets/91488", { method: "PUT", cookie: admin, json: { form: form(), jobs, version: 1 } });
    const res = await api("/api/virtual-dockets/91488", { method: "PUT", cookie: manager, json: { form: form(), jobs, version: 1 } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("This docket was changed by boss");
  });

  it("keeps the accountant's Inv/Date when the form has no invoice number", async () => {
    await create(manager);
    const r = g.sheet.rowOf("91488")!;
    r[12] = "151409 8-AUG-25";
    await api("/api/virtual-dockets/91488", { method: "PUT", cookie: manager, json: { form: form(), jobs, version: 1 } });
    expect(g.sheet.rowOf("91488")?.[12]).toBe("151409 8-AUG-25");
  });
});

describe("cancel, delete, restore, purge", () => {
  it("cancel stamps Inv/Date and moves to cancelled", async () => {
    await create(manager);
    const res = await api("/api/virtual-dockets/91488/cancel", { method: "POST", cookie: manager });
    expect(res.status).toBe(200);
    expect(String(g.sheet.rowOf("91488")?.[12])).toMatch(/^CANCEL \d{1,2}-[A-Z]{3}-\d{2}$/);
    const m = await env.DB.prepare("SELECT status FROM dockets WHERE work_order = '91488'").first();
    expect(m).toEqual({ status: "cancelled" });
  });

  it("delete removes the row, lists it in Trash, and restore brings it back on top", async () => {
    await create(manager);
    expect((await api("/api/virtual-dockets/91488", { method: "DELETE", cookie: manager, json: { confirm: "91488" } })).status).toBe(403);
    expect((await api("/api/virtual-dockets/91488", { method: "DELETE", cookie: admin, json: { confirm: "nope" } })).status).toBe(400);
    const del = await api("/api/virtual-dockets/91488", { method: "DELETE", cookie: admin, json: { confirm: "91488" } });
    expect(del.status).toBe(200);
    expect(g.sheet.rowOf("91488")).toBeUndefined();
    const trash = (await (await api("/api/trash", { cookie: admin })).json()) as { workOrder: string; daysLeft: number }[];
    expect(trash).toEqual([expect.objectContaining({ workOrder: "91488", daysLeft: 30, forName: "Encore Lounge" })]);
    await api("/api/virtual-dockets/91488/restore", { method: "POST", cookie: admin });
    expect(g.sheet.rows[1][2]).toBe(91488);
    expect((await (await api("/api/trash", { cookie: admin })).json()) as unknown[]).toEqual([]);
  });

  it("purges trash older than 30 days only", async () => {
    await create(manager);
    await env.DB.prepare("UPDATE virtual_dockets SET pdf_key = 'dockets/91488.pdf', drive_file_id = 'file-9'").run();
    await env.DOCKETS_BUCKET.put("dockets/91488.pdf", "pdf");
    await g.drive.upload("91488", "x", 2026, new ArrayBuffer(1), "file-9");
    await api("/api/virtual-dockets/91488", { method: "DELETE", cookie: admin, json: { confirm: "91488" } });
    const deletedAt = Date.parse(
      (await env.DB.prepare("SELECT deleted_at FROM virtual_dockets").first<{ deleted_at: string }>())!.deleted_at,
    );
    await purgeTrash(env, new Date(deletedAt + 29 * 86_400_000));
    expect(await env.DB.prepare("SELECT 1 FROM virtual_dockets").first()).not.toBeNull();
    await purgeTrash(env, new Date(deletedAt + 31 * 86_400_000));
    expect(await env.DB.prepare("SELECT 1 FROM virtual_dockets").first()).toBeNull();
    expect(await env.DOCKETS_BUCKET.get("dockets/91488.pdf")).toBeNull();
    expect(g.drive.files.get("file-9")?.trashed).toBe(true);
  });
});
