import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../../src/worker/google/crypto";
import {
  __setGoogleFetch,
  _resetAccessTokenCache,
  buildAuthUrl,
  getAccessToken,
  GoogleDisconnectedError,
  isSheetConfigured,
} from "../../src/worker/google/oauth";
import { api, clearConnection, createUser, login, resetAuthTables, seedConnection, TEST_TOKEN_KEY } from "./helpers";

const OTHER_KEY = "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY=";

beforeEach(() => _resetAccessTokenCache());
afterEach(() => __setGoogleFetch(null));

describe("token encryption", () => {
  it("round-trips and hides the plaintext", async () => {
    const enc = await encryptSecret("1//refresh-token-xyz", TEST_TOKEN_KEY);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain("refresh-token-xyz");
    expect(await decryptSecret(enc, TEST_TOKEN_KEY)).toBe("1//refresh-token-xyz");
  });
  it("fails with the wrong key", async () => {
    const enc = await encryptSecret("secret", TEST_TOKEN_KEY);
    await expect(decryptSecret(enc, OTHER_KEY)).rejects.toThrow();
  });
});

describe("oauth", () => {
  it("builds an offline consent URL with both scopes", () => {
    const url = new URL(buildAuthUrl(env, "st4te", "https://dash.test/api/google/callback"));
    const scope = url.searchParams.get("scope")!;
    expect(scope).toContain("https://www.googleapis.com/auth/spreadsheets");
    expect(scope).toContain("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st4te");
  });

  it("refreshes an access token with the stored refresh token", async () => {
    await seedConnection();
    let body = "";
    __setGoogleFetch(async (_u, init) => {
      body = String(init?.body);
      return Response.json({ access_token: "ya29.token", expires_in: 3600 });
    });
    expect(await getAccessToken(env)).toBe("ya29.token");
    expect(body).toContain("refresh_token=refresh-1");
    expect(body).toContain("grant_type=refresh_token");
  });

  it("marks the connection disconnected on invalid_grant", async () => {
    await seedConnection();
    __setGoogleFetch(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    const err = await getAccessToken(env).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleDisconnectedError);
    expect(err.message).toBe("Google is disconnected. Ask an admin to reconnect.");
    const row = await env.DB.prepare("SELECT status FROM google_connection").first<{ status: string }>();
    expect(row?.status).toBe("disconnected");
    expect(await isSheetConfigured(env)).toBe(false);
  });

  it("is configured only with a connected account and a sheet", async () => {
    await clearConnection();
    expect(await isSheetConfigured(env)).toBe(false);
    await seedConnection({ sheetId: null });
    expect(await isSheetConfigured(env)).toBe(false);
    await seedConnection();
    expect(await isSheetConfigured(env)).toBe(true);
  });
});

describe("google routes", () => {
  beforeEach(async () => {
    await resetAuthTables();
    await createUser("boss", "admin");
  });

  it("connect redirects an admin to Google", async () => {
    const res = await api("/api/google/connect", { cookie: await login("boss"), redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("accounts.google.com");
  });

  it("callback rejects an unknown state", async () => {
    const res = await api("/api/google/callback?code=abc&state=nope", { redirect: "manual" });
    expect(res.status).toBe(400);
  });

  it("saves the sheet id from a URL when the Contempra tab exists", async () => {
    await seedConnection({ sheetId: null });
    __setGoogleFetch(async (u) => {
      const url = String(u);
      if (url.includes("oauth2")) return Response.json({ access_token: "t", expires_in: 3600 });
      expect(url).toContain("/spreadsheets/abc123?fields=sheets.properties");
      return Response.json({ sheets: [{ properties: { title: "Contempra", sheetId: 777 } }] });
    });
    const res = await api("/api/google/sheet", {
      method: "PUT",
      cookie: await login("boss"),
      json: { url: "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0" },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT sheet_id, sheet_gid FROM google_connection").first();
    expect(row).toEqual({ sheet_id: "abc123", sheet_gid: 777 });
  });

  it("rejects a non-sheet URL and a sheet without the Contempra tab", async () => {
    await seedConnection({ sheetId: null });
    const cookie = await login("boss");
    const bad = await api("/api/google/sheet", { method: "PUT", cookie, json: { url: "https://example.com" } });
    expect(await bad.json()).toEqual({ error: "That doesn't look like a Google Sheet link" });
    __setGoogleFetch(async (u) =>
      String(u).includes("oauth2")
        ? Response.json({ access_token: "t", expires_in: 3600 })
        : Response.json({ sheets: [{ properties: { title: "Other", sheetId: 1 } }] }),
    );
    const noTab = await api("/api/google/sheet", {
      method: "PUT",
      cookie,
      json: { url: "https://docs.google.com/spreadsheets/d/xyz/edit" },
    });
    expect(await noTab.json()).toEqual({ error: "This sheet has no 'Contempra' tab" });
  });

  it("status reports the connected email", async () => {
    await seedConnection();
    const res = await api("/api/google/status", { cookie: await login("boss") });
    expect(await res.json()).toMatchObject({ connected: true, email: "owner@gmail.com" });
  });
});
