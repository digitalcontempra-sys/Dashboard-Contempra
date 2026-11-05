import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setGoogleFetch, _resetAccessTokenCache } from "../../src/worker/google/oauth";
import { readSheetRange, SheetFetchError } from "../../src/worker/sheet/googleClient";
import { clearConnection, seedConnection } from "./helpers";

beforeEach(() => _resetAccessTokenCache());
afterEach(() => __setGoogleFetch(null));

function fakeGoogle(valuesStatus = 200) {
  const urls: string[] = [];
  __setGoogleFetch(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
    if (valuesStatus !== 200) return new Response("unavailable", { status: valuesStatus });
    return Response.json({ values: [["Date"], [46314]] });
  });
  return urls;
}

describe("readSheetRange", () => {
  it("reads the connected sheet with the OAuth token", async () => {
    await seedConnection();
    const urls = fakeGoogle();
    expect(await readSheetRange(env, "Contempra!A1:P601")).toEqual([["Date"], [46314]]);
    expect(urls).toContain(
      "https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values/Contempra!A1%3AP601?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER",
    );
  });

  it("caches the access token between reads", async () => {
    await seedConnection();
    const urls = fakeGoogle();
    await readSheetRange(env, "Contempra!A1:P2");
    await readSheetRange(env, "Contempra!A1:P2");
    expect(urls.filter((u) => u.includes("oauth2"))).toHaveLength(1);
  });

  it("throws SheetFetchError with the HTTP status", async () => {
    await seedConnection();
    fakeGoogle(503);
    const err = await readSheetRange(env, "Contempra!A1:P2").catch((e) => e);
    expect(err).toBeInstanceOf(SheetFetchError);
    expect(err.status).toBe(503);
  });

  it("explains when no sheet is connected", async () => {
    await clearConnection();
    await expect(readSheetRange(env, "Contempra!A1:P2")).rejects.toThrow("Google Sheet is not connected yet");
  });
});
