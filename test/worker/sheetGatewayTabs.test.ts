import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setGoogleFetch, _resetAccessTokenCache } from "../../src/worker/google/oauth";
import { realSheetGateway } from "../../src/worker/google/sheets";
import { seedConnection } from "./helpers";

type Call = { method: string; url: string; body: string };
let calls: Call[] = [];

function google(handler: (c: Call) => Response | unknown) {
  calls = [];
  __setGoogleFetch(async (input, init) => {
    const c = { method: init?.method ?? "GET", url: String(input), body: init?.body ? String(init.body) : "" };
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

describe("SheetGateway tabs and ranges", () => {
  it("clearColumns removes values and checkboxes on the Contempra tab", async () => {
    google(() => ({}));
    await realSheetGateway(env).clearColumns("Q", "Z", 2);
    const body = JSON.parse(calls[0].body);
    expect(calls[0].url).toContain(":batchUpdate");
    expect(body.requests[0].repeatCell).toEqual({
      range: { sheetId: 42, startRowIndex: 1, startColumnIndex: 16, endColumnIndex: 26 },
      cell: {},
      fields: "userEnteredValue,dataValidation",
    });
  });

  it("updateCells reaches column AA", async () => {
    google(() => ({}));
    await realSheetGateway(env).updateCells(7, { Z: "Install", AA: "Team" });
    expect(JSON.parse(calls[0].body).data).toEqual([
      { range: "Contempra!Z7", values: [["Install"]] },
      { range: "Contempra!AA7", values: [["Team"]] },
    ]);
  });

  it("appendRows appends raw rows to a tab", async () => {
    google(() => ({}));
    await realSheetGateway(env).appendRows("Production", [["91488", "Whole docket"]]);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain(`/values/${encodeURIComponent("'Production'!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`);
    expect(JSON.parse(calls[0].body)).toEqual({ values: [["91488", "Whole docket"]] });
  });

  it("writeRange writes raw values from a start cell", async () => {
    google(() => ({}));
    await realSheetGateway(env).writeRange("'Legacy Q-Y'!A1", [["Work Order"], ["91488"]]);
    expect(calls[0].url).toContain("/values:batchUpdate");
    expect(JSON.parse(calls[0].body)).toEqual({ valueInputOption: "RAW", data: [{ range: "'Legacy Q-Y'!A1", values: [["Work Order"], ["91488"]] }] });
  });

  it("writeRanges sends many ranges in one request", async () => {
    google(() => ({}));
    await realSheetGateway(env).writeRanges([
      { range: "'Production'!A2", values: [["1"]] },
      { range: "'Production'!A3", values: [["2"]] },
    ]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body).data).toHaveLength(2);
  });

  it("ensureTab adds a missing tab only", async () => {
    google((c) => (c.method === "GET" ? { sheets: [{ properties: { title: "Contempra" } }, { properties: { title: "Production" } }] } : {}));
    await realSheetGateway(env).ensureTab("Production");
    expect(calls).toHaveLength(1);
    await realSheetGateway(env).ensureTab("Legacy Q-Y");
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2].body)).toEqual({ requests: [{ addSheet: { properties: { title: "Legacy Q-Y" } } }] });
  });
});
