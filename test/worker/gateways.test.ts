import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realDriveGateway } from "../../src/worker/google/drive";
import { __setGoogleFetch, _resetAccessTokenCache } from "../../src/worker/google/oauth";
import { realSheetGateway } from "../../src/worker/google/sheets";
import { seedConnection } from "./helpers";

type Call = { method: string; url: string; body: string };
let calls: Call[] = [];

function google(handler: (c: Call) => Response | unknown) {
  calls = [];
  __setGoogleFetch(async (input, init) => {
    const raw = init?.body;
    const body = raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : raw ? String(raw) : "";
    const c = { method: init?.method ?? "GET", url: String(input), body };
    if (c.url.includes("oauth2")) return Response.json({ access_token: "t", expires_in: 3600 });
    calls.push(c);
    const out = handler(c);
    return out instanceof Response ? out : Response.json(out ?? {});
  });
}

beforeEach(async () => {
  _resetAccessTokenCache();
  await seedConnection();
  await env.DB.prepare("UPDATE google_connection SET sheet_gid = 42").run();
});
afterEach(() => __setGoogleFetch(null));

describe("SheetGateway", () => {
  it("inserts a top row with one batchUpdate", async () => {
    google(() => ({}));
    await realSheetGateway(env).insertTopRow({ C: 91488, G: "Encore Lounge", D: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/spreadsheets/test-sheet:batchUpdate");
    const body = JSON.parse(calls[0].body);
    expect(body.requests[0].insertDimension.range).toMatchObject({ sheetId: 42, dimension: "ROWS", startIndex: 1, endIndex: 2 });
    const values = body.requests[1].updateCells.rows[0].values;
    expect(values[2]).toEqual({ userEnteredValue: { numberValue: 91488 } });
    expect(values[3]).toEqual({ userEnteredValue: { boolValue: false } });
    expect(values[6]).toEqual({ userEnteredValue: { stringValue: "Encore Lounge" } });
  });

  it("finds a row by work order", async () => {
    google(() => ({ values: [["Work Order"], [91488], [91377], ["91376"]] }));
    expect(await realSheetGateway(env).findRow("91376")).toBe(4);
    expect(await realSheetGateway(env).findRow("1")).toBeNull();
  });

  it("updates only the given cells of a row", async () => {
    google(() => ({}));
    await realSheetGateway(env).updateCells(7, { M: "CANCEL 5-NOV-26", G: "X" });
    const body = JSON.parse(calls[0].body);
    expect(calls[0].url).toContain("/values:batchUpdate");
    expect(body.valueInputOption).toBe("RAW");
    expect(body.data).toEqual([
      { range: "Contempra!M7", values: [["CANCEL 5-NOV-26"]] },
      { range: "Contempra!G7", values: [["X"]] },
    ]);
  });

  it("deletes a row by number", async () => {
    google(() => ({}));
    await realSheetGateway(env).deleteRow(9);
    const body = JSON.parse(calls[0].body);
    expect(body.requests[0].deleteDimension.range).toMatchObject({ sheetId: 42, startIndex: 8, endIndex: 9 });
  });
});

describe("DriveGateway", () => {
  it("replaces an existing file with a PATCH media upload", async () => {
    google(() => ({ id: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view" }));
    const r = await realDriveGateway(env).upload("91488", "Encore Lounge", 2026, new ArrayBuffer(8), "file-1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/upload/drive/v3/files/file-1");
    expect(r).toEqual({ id: "file-1", link: "https://drive.google.com/file/d/file-1/view" });
  });

  it("creates the root and year folders once, then uploads into the year", async () => {
    google((c) => {
      if (c.url.includes("/drive/v3/files?q=")) return { files: [] };
      if (c.url.endsWith("/drive/v3/files?fields=id") && c.body.includes("Contempra Dockets")) return { id: "root" };
      if (c.url.endsWith("/drive/v3/files?fields=id")) return { id: "y2026" };
      return { id: "new-file", webViewLink: "https://drive/new" };
    });
    const drive = realDriveGateway(env);
    const r = await drive.upload("91488", "Encore Lounge", 2026, new ArrayBuffer(8), null);
    expect(r.id).toBe("new-file");
    const upload = calls.find((c) => c.url.includes("uploadType=multipart"))!;
    expect(upload.body).toContain('"parents":["y2026"]');
    expect(upload.body).toContain("91488 - Encore Lounge.pdf");
    const row = await env.DB.prepare("SELECT drive_folder_id FROM google_connection").first<{ drive_folder_id: string }>();
    expect(row?.drive_folder_id).toBe("root");
  });
});
