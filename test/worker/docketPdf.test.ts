import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyForm } from "../../src/shared/docketForm";
import { retryPendingDrive, storeDocketPdf, syncDocketPdfToDrive } from "../../src/worker/dockets/pdf";
import { __setTestGateways } from "../../src/worker/google/gateways";
import { fakeGateways } from "./fakeGoogle";
import { row } from "./fixtures";
import { api, BASE, createUser, login, resetAuthTables } from "./helpers";
import { SELF } from "cloudflare:test";

let g: ReturnType<typeof fakeGateways>;
let manager = "";
let staff = "";
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]); // "%PDF-1.7"

const putPdf = (wo: string, body: BodyInit, cookie = manager) =>
  SELF.fetch(`${BASE}/api/virtual-dockets/${wo}/pdf`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/pdf" },
    body,
  });

/** Waits for the background Drive copy the route started (waitUntil) to settle. */
async function settled(wo: string) {
  for (let i = 0; i < 50; i++) {
    const s = await state(wo);
    if (s && !["pending", "syncing"].includes(String(s.drive_status))) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  return state(wo);
}

const state = (wo: string) =>
  env.DB.prepare("SELECT pdf_key, drive_status, drive_file_id, drive_link FROM virtual_dockets WHERE work_order = ?")
    .bind(wo)
    .first<Record<string, string | null>>();

beforeEach(async () => {
  g = fakeGateways();
  g.sheet.rows.push(row(91487));
  __setTestGateways(g);
  await env.DB.batch([env.DB.prepare("DELETE FROM docket_jobs"), env.DB.prepare("DELETE FROM virtual_dockets"), env.DB.prepare("DELETE FROM dockets")]);
  await resetAuthTables();
  await createUser("mgr", "manager");
  await createUser("ana", "staff");
  manager = await login("mgr");
  staff = await login("ana");
  const f = { ...emptyForm("2026-11-05", "Mgr"), forName: "Encore Lounge" };
  await api("/api/virtual-dockets", { method: "POST", cookie: manager, json: { form: f, jobs: [] } });
});
afterEach(() => __setTestGateways(null));

describe("docket PDF", () => {
  it("stores the PDF in R2, copies it to Drive and links it in column P", async () => {
    const res = await putPdf("91488", PDF);
    expect(res.status).toBe(200);
    expect(await (await env.DOCKETS_BUCKET.get("dockets/91488.pdf"))?.text()).toBe("%PDF-1.7");
    const s = await settled("91488");
    expect(s).toMatchObject({ pdf_key: "dockets/91488.pdf", drive_status: "done" });
    expect(g.sheet.rowOf("91488")?.[15]).toBe(s?.drive_link);
  });

  it("retries a failed Drive copy", async () => {
    g.drive.failNext();
    await putPdf("91488", PDF);
    expect((await settled("91488"))?.drive_status).toBe("failed");
    await retryPendingDrive(env);
    expect((await state("91488"))?.drive_status).toBe("done");
  });

  it("replaces the same Drive file on a second upload", async () => {
    await putPdf("91488", PDF);
    const first = (await settled("91488"))?.drive_file_id;
    await putPdf("91488", PDF);
    await syncDocketPdfToDrive(env, "91488"); // a concurrent retry must not create a second file
    expect((await settled("91488"))?.drive_file_id).toBe(first);
    expect(g.drive.files.size).toBe(1);
  });

  it("never uploads twice when two copies race", async () => {
    await env.DOCKETS_BUCKET.put("dockets/91488.pdf", PDF);
    await env.DB.prepare("UPDATE virtual_dockets SET pdf_key = 'dockets/91488.pdf', drive_status = 'pending'").run();
    await Promise.all([syncDocketPdfToDrive(env, "91488"), syncDocketPdfToDrive(env, "91488")]);
    expect(g.drive.files.size).toBe(1);
  });

  it("rejects files over 5 MB", async () => {
    expect((await putPdf("91488", new Uint8Array(6 * 1024 * 1024))).status).toBe(413);
  });

  it("serves the stored PDF to managers but not to staff", async () => {
    await putPdf("91488", PDF);
    const m = await api("/api/virtual-dockets/91488/pdf", { cookie: manager });
    expect(m.status).toBe(200);
    expect(m.headers.get("content-type")).toBe("application/pdf");
    expect((await api("/api/virtual-dockets/91488/pdf", { cookie: staff })).status).toBe(403);
    expect((await putPdf("91488", PDF, staff)).status).toBe(403);
  });

  it("404s a PDF for an unknown docket", async () => {
    expect((await putPdf("1", PDF)).status).toBe(404);
  });

  it("an upload during an in-flight Drive copy ends with one file holding the newest PDF", async () => {
    let release!: () => void;
    g.drive.gate = new Promise<void>((r) => (release = r));
    await storeDocketPdf(env, "91488", PDF.buffer, 1);
    const first = syncDocketPdfToDrive(env, "91488"); // held at the Drive upload
    await new Promise((r) => setTimeout(r, 20));
    await storeDocketPdf(env, "91488", PDF.buffer, 1); // a second save renders a newer PDF
    expect((await state("91488"))?.drive_status).toBe("syncing");
    release();
    await first;
    expect((await state("91488"))?.drive_status).toBe("pending"); // newer bytes still need copying
    g.drive.gate = null;
    await syncDocketPdfToDrive(env, "91488");
    expect((await state("91488"))?.drive_status).toBe("done");
    expect(g.drive.files.size).toBe(1);
  });

  it("reports the PDF as stored only for the docket version it was rendered from", async () => {
    await SELF.fetch(`${BASE}/api/virtual-dockets/91488/pdf?version=1`, {
      method: "PUT",
      headers: { cookie: manager, "content-type": "application/pdf" },
      body: PDF,
    });
    const dto = async () => ((await (await api("/api/virtual-dockets/91488", { cookie: manager })).json()) as { pdf: { stored: boolean } }).pdf;
    expect((await dto()).stored).toBe(true);
    await env.DB.prepare("UPDATE virtual_dockets SET version = 2").run();
    expect((await dto()).stored).toBe(false);
  });

  it("stops retrying a Drive copy after 10 failed attempts", async () => {
    await env.DOCKETS_BUCKET.put("dockets/91488.pdf", PDF);
    await env.DB.prepare("UPDATE virtual_dockets SET pdf_key = 'dockets/91488.pdf', drive_status = 'failed', drive_attempts = 10").run();
    const before = g.drive.uploads;
    await retryPendingDrive(env);
    expect(g.drive.uploads).toBe(before);
  });

  it("creates a new Drive file when the old one was deleted in Drive", async () => {
    await env.DOCKETS_BUCKET.put("dockets/91488.pdf", PDF);
    await env.DB.prepare("UPDATE virtual_dockets SET pdf_key = 'dockets/91488.pdf', drive_status = 'pending', drive_file_id = 'gone'").run();
    await syncDocketPdfToDrive(env, "91488");
    const s = await state("91488");
    expect(s?.drive_status).toBe("done");
    expect(s?.drive_file_id).not.toBe("gone");
  });

  it("copies one PDF to Drive at a time (no duplicate folders on the first upload)", async () => {
    const f = { ...emptyForm("2026-11-05", "Mgr"), forName: "Second Co" };
    await api("/api/virtual-dockets", { method: "POST", cookie: manager, json: { form: f, jobs: [] } });
    for (const wo of ["91488", "91489"]) await storeDocketPdf(env, wo, PDF.buffer, 1);
    let release!: () => void;
    g.drive.gate = new Promise<void>((r) => (release = r));
    const both = Promise.all([syncDocketPdfToDrive(env, "91488"), syncDocketPdfToDrive(env, "91489")]);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await both;
    expect(g.drive.maxActive).toBe(1);
    expect(g.drive.uploads).toBe(2);
  });
});
