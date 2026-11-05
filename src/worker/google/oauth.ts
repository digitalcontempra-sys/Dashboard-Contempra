import type { Env } from "../env";
import { decryptSecret } from "./crypto";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DISCONNECTED = "Google is disconnected. Ask an admin to reconnect.";

export class GoogleDisconnectedError extends Error {
  constructor() {
    super(DISCONNECTED);
    this.name = "GoogleDisconnectedError";
  }
}

export type GoogleConnection = {
  email: string;
  refreshTokenEnc: string;
  sheetId: string | null;
  sheetGid: number | null;
  driveFolderId: string | null;
  status: "connected" | "disconnected";
};

// Every Google HTTP call goes through this so tests can replace the network.
let fetchOverride: typeof fetch | null = null;
/** Test-only: replace the fetch used for Google calls (null restores the real one). */
export function __setGoogleFetch(f: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null) {
  fetchOverride = f as typeof fetch | null;
}
export const googleFetch: typeof fetch = (input, init) => (fetchOverride ?? fetch)(input, init);

let cached: { token: string; expiresAt: number; key: string } | null = null;
export function _resetAccessTokenCache(): void {
  cached = null;
}

export function buildAuthUrl(env: Pick<Env, "GOOGLE_CLIENT_ID">, state: string, redirectUri: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return u.toString();
}

/** Email claim of a Google id_token (received directly from Google over TLS, so not re-verified). */
function emailFromIdToken(idToken: string): string {
  const payload = idToken.split(".")[1] ?? "";
  const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  return String(json.email ?? "");
}

export async function exchangeCode(
  env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; email: string }> {
  const res = await googleFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; error?: string };
  if (!res.ok || !json.refresh_token) throw new Error(`Google sign-in failed (${json.error ?? res.status})`);
  return { refreshToken: json.refresh_token, email: json.id_token ? emailFromIdToken(json.id_token) : "" };
}

export async function getConnection(db: D1Database): Promise<GoogleConnection | null> {
  const r = await db.prepare("SELECT * FROM google_connection WHERE id = 1").first<Record<string, unknown>>();
  if (!r) return null;
  return {
    email: String(r.email),
    refreshTokenEnc: String(r.refresh_token_enc),
    sheetId: (r.sheet_id as string) ?? null,
    sheetGid: r.sheet_gid == null ? null : Number(r.sheet_gid),
    driveFolderId: (r.drive_folder_id as string) ?? null,
    status: r.status as GoogleConnection["status"],
  };
}

export async function isSheetConfigured(env: Pick<Env, "DB">): Promise<boolean> {
  const c = await getConnection(env.DB);
  return Boolean(c && c.status === "connected" && c.sheetId);
}

/** Returns a valid access token, refreshing it when needed. Marks the connection disconnected on invalid_grant. */
export async function getAccessToken(env: Pick<Env, "DB" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "TOKEN_KEY">): Promise<string> {
  const conn = await getConnection(env.DB);
  if (!conn || conn.status !== "connected") throw new GoogleDisconnectedError();
  const now = Date.now();
  if (cached && cached.key === conn.refreshTokenEnc && cached.expiresAt - 60_000 > now) return cached.token;

  const refreshToken = await decryptSecret(conn.refreshTokenEnc, env.TOKEN_KEY);
  const res = await googleFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (json.error === "invalid_grant") {
    await env.DB.prepare("UPDATE google_connection SET status = 'disconnected' WHERE id = 1").run();
    cached = null;
    throw new GoogleDisconnectedError();
  }
  if (!res.ok || !json.access_token) throw new Error(`Google token refresh failed (${json.error ?? res.status})`);
  cached = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000, key: conn.refreshTokenEnc };
  return json.access_token;
}

/** Tabs of a spreadsheet: title and numeric sheetId (gid). */
export async function fetchSheetTabs(
  env: Parameters<typeof getAccessToken>[0],
  spreadsheetId: string,
): Promise<{ title: string; sheetId: number }[]> {
  const token = await getAccessToken(env);
  const res = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Could not open that Google Sheet (${res.status})`);
  const json = (await res.json()) as { sheets?: { properties: { title: string; sheetId: number } }[] };
  return (json.sheets ?? []).map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
}
