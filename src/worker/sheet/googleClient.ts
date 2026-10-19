import type { Env } from "../env";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TIMEOUT_MS = 20_000;

export class SheetFetchError extends Error {
  constructor(message: string, public status: number | null) {
    super(message);
    this.name = "SheetFetchError";
  }
}

let cached: { token: string; expiresAt: number; email: string } | null = null;

/** Test hook: drop the module-scope token cache. */
export function _resetTokenCache(): void {
  cached = null;
}

const b64url = (bytes: Uint8Array | string) => {
  const s = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function withTimeout(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new SheetFetchError(`Google request failed: ${(e as Error).message}`, null);
  }
}

async function getAccessToken(saJson: string, fetchImpl: typeof fetch): Promise<string> {
  const sa = JSON.parse(saJson) as { client_email: string; private_key: string };
  const now = Date.now();
  if (cached && cached.email === sa.client_email && cached.expiresAt - 60_000 > now) return cached.token;

  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const key = await importKey(sa.private_key);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)),
  );
  const assertion = `${header}.${claims}.${b64url(sig)}`;

  const res = await withTimeout(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) throw new SheetFetchError(`Google token request failed (${res.status})`, res.status);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: now + json.expires_in * 1000, email: sa.client_email };
  return json.access_token;
}

export async function fetchContempraValues(
  env: Pick<Env, "GOOGLE_SA_JSON" | "SHEET_ID">,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[][]> {
  const token = await getAccessToken(env.GOOGLE_SA_JSON, fetchImpl);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/Contempra!A1:P` +
    `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const res = await withTimeout(fetchImpl, url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new SheetFetchError(`Google Sheets read failed (${res.status})`, res.status);
  const json = (await res.json()) as { values?: unknown[][] };
  return json.values ?? [];
}
