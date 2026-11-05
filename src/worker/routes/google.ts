import { Hono } from "hono";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import { encryptSecret } from "../google/crypto";
import { _resetAccessTokenCache, buildAuthUrl, exchangeCode, fetchSheetTabs, getConnection } from "../google/oauth";

const STATE_TTL_MS = 10 * 60_000;
const SHEET_TAB = "Contempra";

export const googleRoutes = new Hono<AppEnv>();
const admin = [requireAuth, requireLevel("admin")] as const;
const callbackUrl = (reqUrl: string) => new URL("/api/google/callback", reqUrl).toString();

googleRoutes.get("/google/connect", ...admin, async (c) => {
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await c.env.DB.prepare("INSERT INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)")
    .bind(state, c.get("user").id, new Date().toISOString())
    .run();
  return c.redirect(buildAuthUrl(c.env, state, callbackUrl(c.req.url)), 302);
});

// Google redirects here; the one-time state proves an admin started the flow.
googleRoutes.get("/google/callback", async (c) => {
  const { code, state, error } = c.req.query();
  if (error) return c.redirect(`/admin/users?google=${encodeURIComponent(error)}`, 302);
  const db = c.env.DB;
  const row = state
    ? await db.prepare("SELECT user_id, created_at FROM oauth_states WHERE state = ?").bind(state).first<{ user_id: number; created_at: string }>()
    : null;
  if (!row || !code || Date.now() - Date.parse(row.created_at) > STATE_TTL_MS) {
    return c.json({ error: "This sign-in link expired. Start again from Admin." }, 400);
  }
  await db.prepare("DELETE FROM oauth_states WHERE state = ? OR created_at < ?")
    .bind(state, new Date(Date.now() - STATE_TTL_MS).toISOString())
    .run();
  const { refreshToken, email } = await exchangeCode(c.env, code, callbackUrl(c.req.url));
  const existing = await getConnection(db);
  await db.prepare(
    `INSERT INTO google_connection (id, email, refresh_token_enc, sheet_id, sheet_gid, drive_folder_id, status, connected_at, connected_by)
     VALUES (1, ?, ?, ?, ?, ?, 'connected', ?, ?)
     ON CONFLICT (id) DO UPDATE SET email = excluded.email, refresh_token_enc = excluded.refresh_token_enc,
       status = 'connected', connected_at = excluded.connected_at, connected_by = excluded.connected_by`,
  )
    .bind(
      email,
      await encryptSecret(refreshToken, c.env.TOKEN_KEY),
      existing?.sheetId ?? null,
      existing?.sheetGid ?? null,
      existing?.driveFolderId ?? null,
      new Date().toISOString(),
      row.user_id,
    )
    .run();
  _resetAccessTokenCache();
  return c.redirect("/admin/users?google=connected", 302);
});

googleRoutes.get("/google/status", ...admin, async (c) => {
  const conn = await getConnection(c.env.DB);
  return c.json({
    connected: conn?.status === "connected",
    email: conn?.email ?? null,
    sheetUrl: conn?.sheetId ? `https://docs.google.com/spreadsheets/d/${conn.sheetId}/edit` : null,
  });
});

googleRoutes.put("/google/sheet", ...admin, async (c) => {
  const { url } = await c.req.json<{ url?: string }>();
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url ?? "")?.[1];
  if (!id) return c.json({ error: "That doesn't look like a Google Sheet link" }, 400);
  const tab = (await fetchSheetTabs(c.env, id)).find((t) => t.title === SHEET_TAB);
  if (!tab) return c.json({ error: "This sheet has no 'Contempra' tab" }, 400);
  await c.env.DB.prepare("UPDATE google_connection SET sheet_id = ?, sheet_gid = ? WHERE id = 1").bind(id, tab.sheetId).run();
  return c.json({ ok: true });
});

googleRoutes.post("/google/disconnect", ...admin, async (c) => {
  await c.env.DB.prepare("DELETE FROM google_connection").run();
  _resetAccessTokenCache();
  return c.json({ ok: true });
});
