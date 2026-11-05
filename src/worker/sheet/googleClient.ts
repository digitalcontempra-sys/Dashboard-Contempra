import type { Env } from "../env";
import { getAccessToken, getConnection, googleFetch } from "../google/oauth";

const TIMEOUT_MS = 20_000;

export class SheetFetchError extends Error {
  constructor(message: string, public status: number | null) {
    super(message);
    this.name = "SheetFetchError";
  }
}

export type GoogleEnv = Pick<Env, "DB" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "TOKEN_KEY">;

export async function fetchContempraValues(env: GoogleEnv): Promise<unknown[][]> {
  return readSheetRange(env, "Contempra!A1:P");
}

/** Reads one A1 range (e.g. `Contempra!A1:P601`) of the connected sheet as unformatted values with date serials. */
export async function readSheetRange(env: GoogleEnv, range: string): Promise<unknown[][]> {
  const conn = await getConnection(env.DB);
  if (!conn?.sheetId) throw new SheetFetchError("Google Sheet is not connected yet", null);
  const token = await getAccessToken(env);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${conn.sheetId}/values/${encodeURIComponent(range)}` +
    `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  let res: Response;
  try {
    res = await googleFetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new SheetFetchError(`Google request failed: ${(e as Error).message}`, null);
  }
  if (!res.ok) throw new SheetFetchError(`Google Sheets read failed (${res.status})`, res.status);
  const json = (await res.json()) as { values?: unknown[][] };
  return json.values ?? [];
}
