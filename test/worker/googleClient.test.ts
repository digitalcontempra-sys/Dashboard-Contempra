import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { _resetTokenCache, fetchContempraValues, SheetFetchError } from "../../src/worker/sheet/googleClient";

const VALUES_URL =
  "https://sheets.googleapis.com/v4/spreadsheets/sheet-123/values/Contempra!A1:P?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER";

let saJson = "";

beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
  const b64 = btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  saJson = JSON.stringify({ client_email: "sa@test.iam.gserviceaccount.com", private_key: pem });
});

beforeEach(() => _resetTokenCache());

function fakeFetch(valuesStatus = 200) {
  const calls: { url: string; body?: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "tok", expires_in: 3600 });
    }
    if (valuesStatus !== 200) return new Response("unavailable", { status: valuesStatus });
    return Response.json({ values: [["Date"], [46314]] });
  }) as typeof fetch;
  return { impl, calls };
}

const env = () => ({ GOOGLE_SA_JSON: saJson, SHEET_ID: "sheet-123" });

describe("fetchContempraValues", () => {
  it("exchanges a JWT bearer grant for a token", async () => {
    const f = fakeFetch();
    await fetchContempraValues(env(), f.impl);
    const tokenCall = f.calls.find((c) => c.url.includes("oauth2"));
    expect(tokenCall?.body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
  });

  it("requests the exact values URL and returns values", async () => {
    const f = fakeFetch();
    const values = await fetchContempraValues(env(), f.impl);
    expect(f.calls.map((c) => c.url)).toContain(VALUES_URL);
    expect(values).toEqual([["Date"], [46314]]);
  });

  it("caches the access token between calls", async () => {
    const f = fakeFetch();
    await fetchContempraValues(env(), f.impl);
    await fetchContempraValues(env(), f.impl);
    expect(f.calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });

  it("throws SheetFetchError with the HTTP status on failure", async () => {
    const f = fakeFetch(503);
    const err = await fetchContempraValues(env(), f.impl).catch((e) => e);
    expect(err).toBeInstanceOf(SheetFetchError);
    expect(err.status).toBe(503);
  });
});
