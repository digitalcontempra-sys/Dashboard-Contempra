import { Hono, type Context } from "hono";
import type { AppEnv } from "../app";
import { requireAuth, requireLevel } from "../auth/sessions";
import { canAct } from "../cards/actions";
import type { CardRow } from "../cards/service";
import { queueCardSheet } from "../cards/sheetSync";
import { getGateways } from "../google/gateways";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_THUMB_BYTES = 300 * 1024;
export const MAX_PHOTOS = 20;
const thumbKey = (photoId: number) => `photo-thumbs/${photoId}.jpg`;

type PhotoRow = { id: number; card_id: number; work_order: string; drive_file_id: string; link: string; name: string };
export type PhotoDTO = { id: number; name: string; link: string; thumbUrl: string };

const STAMP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Winnipeg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
/** "2026-11-10 14-32" in Winnipeg time. */
function stamp(d: Date): string {
  const p = Object.fromEntries(STAMP.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}-${p.minute}`;
}

export const cardPhotoRoutes = new Hono<AppEnv>();
cardPhotoRoutes.use("/cards/:id/photos", requireAuth);
cardPhotoRoutes.use("/cards/:id/photos/*", requireAuth);

/** The card, if the signed-in person can work on it (its team, its assignees, managers and admins). */
async function cardFor(c: Context<AppEnv>): Promise<CardRow | null> {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return null;
  const card = await c.env.DB.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
  return card && canAct(card, c.get("user")) ? card : null;
}

async function list(db: D1Database, cardId: number): Promise<{ photos: PhotoDTO[]; folderLink: string | null }> {
  const { results } = await db.prepare("SELECT * FROM card_photos WHERE card_id = ? ORDER BY id").bind(cardId).all<PhotoRow>();
  const wo = results[0]?.work_order ?? (await db.prepare("SELECT work_order FROM cards WHERE id = ?").bind(cardId).first<{ work_order: string }>())?.work_order;
  const folder = wo ? await db.prepare("SELECT link FROM docket_photo_folders WHERE work_order = ?").bind(wo).first<{ link: string }>() : null;
  return {
    photos: results.map((r) => ({ id: r.id, name: r.name, link: r.link, thumbUrl: `/api/cards/${cardId}/photos/${r.id}/thumb` })),
    folderLink: folder?.link ?? null,
  };
}

/** Keeps the card's Photos field at the current count, so the sheet's Production tab shows it. */
async function syncCount(db: D1Database, card: CardRow): Promise<void> {
  const n = await db.prepare("SELECT count(*) AS n FROM card_photos WHERE card_id = ?").bind(card.id).first<{ n: number }>();
  await db
    .prepare("UPDATE cards SET fields_json = json_set(fields_json, '$.photos', ?), updated_at = ? WHERE id = ?")
    .bind(String(n?.n ?? 0), new Date().toISOString(), card.id)
    .run();
  await queueCardSheet(db, card.work_order);
}

async function photoFolder(c: Context<AppEnv>, wo: string): Promise<string> {
  const db = c.env.DB;
  const have = await db.prepare("SELECT folder_id FROM docket_photo_folders WHERE work_order = ?").bind(wo).first<{ folder_id: string }>();
  if (have) return have.folder_id;
  const v = await db.prepare("SELECT form_json FROM virtual_dockets WHERE work_order = ?").bind(wo).first<{ form_json: string }>();
  const form = v ? (JSON.parse(v.form_json) as { forName?: string; date?: string }) : {};
  const year = Number((form.date ?? "").slice(0, 4)) || new Date().getUTCFullYear();
  const folder = await getGateways(c.env).drive.createPhotoFolder(wo, form.forName ?? "", year);
  await db
    .prepare("INSERT INTO docket_photo_folders (work_order, folder_id, link) VALUES (?, ?, ?) ON CONFLICT (work_order) DO NOTHING")
    .bind(wo, folder.id, folder.link)
    .run();
  // Another upload may have created it at the same moment: use whichever row won.
  const row = await db.prepare("SELECT folder_id FROM docket_photo_folders WHERE work_order = ?").bind(wo).first<{ folder_id: string }>();
  return row!.folder_id;
}

cardPhotoRoutes.get("/cards/:id/photos", async (c) => {
  const card = await cardFor(c);
  if (!card) return c.json({ error: "Card not found" }, 404);
  return c.json(await list(c.env.DB, card.id));
});

cardPhotoRoutes.post("/cards/:id/photos", async (c) => {
  const card = await cardFor(c);
  if (!card) {
    const exists = await c.env.DB.prepare("SELECT 1 FROM cards WHERE id = ?").bind(Number(c.req.param("id"))).first();
    return exists ? c.json({ error: "You can't work on this card." }, 403) : c.json({ error: "Card not found" }, 404);
  }
  const form = await c.req.formData().catch(() => null);
  const photo = form?.get("photo");
  const thumb = form?.get("thumb");
  if (!(photo instanceof File) || !photo.type.startsWith("image/")) return c.json({ error: "Only photos can be uploaded." }, 400);
  if (photo.size > MAX_PHOTO_BYTES) return c.json({ error: "This photo is too large (max 10 MB)." }, 400);
  const count = await c.env.DB.prepare("SELECT count(*) AS n FROM card_photos WHERE card_id = ?").bind(card.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_PHOTOS) return c.json({ error: `This card already has ${MAX_PHOTOS} photos.` }, 409);

  const ext = photo.type === "image/png" ? "png" : "jpg";
  const name = `${card.work_order} Install ${stamp(new Date())}.${ext}`;
  const bytes = await photo.arrayBuffer();
  const mime = photo.type === "image/png" ? "image/png" : "image/jpeg";
  const drive = getGateways(c.env).drive;
  let uploaded: { id: string; link: string };
  try {
    const folderId = await photoFolder(c, card.work_order);
    try {
      uploaded = await drive.uploadImage(folderId, name, bytes, mime);
    } catch {
      // The saved folder may have been deleted in Drive by hand: start a new one and try once more.
      await c.env.DB.prepare("DELETE FROM docket_photo_folders WHERE work_order = ? AND folder_id = ?").bind(card.work_order, folderId).run();
      uploaded = await drive.uploadImage(await photoFolder(c, card.work_order), name, bytes, mime);
    }
  } catch {
    return c.json({ error: "Upload failed. Try again." }, 502);
  }
  const row = await c.env.DB.prepare(
    "INSERT INTO card_photos (card_id, work_order, drive_file_id, link, name, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(card.id, card.work_order, uploaded.id, uploaded.link, name, c.get("user").id, new Date().toISOString())
    .first<{ id: number }>();
  if (thumb instanceof File && thumb.type.startsWith("image/") && thumb.size <= MAX_THUMB_BYTES) {
    await c.env.DOCKETS_BUCKET.put(thumbKey(row!.id), await thumb.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
  }
  await syncCount(c.env.DB, card);
  return c.json(await list(c.env.DB, card.id));
});

cardPhotoRoutes.get("/cards/:id/photos/:photoId/thumb", async (c) => {
  const card = await cardFor(c);
  if (!card) return c.json({ error: "Card not found" }, 404);
  const photoId = Number(c.req.param("photoId"));
  const owned = await c.env.DB.prepare("SELECT 1 FROM card_photos WHERE id = ? AND card_id = ?").bind(photoId, card.id).first();
  const obj = owned ? await c.env.DOCKETS_BUCKET.get(thumbKey(photoId)) : null;
  if (!obj) return c.json({ error: "Photo not found" }, 404);
  return new Response(obj.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
});

cardPhotoRoutes.delete("/cards/:id/photos/:photoId", async (c) => {
  const card = await cardFor(c);
  if (!card) return c.json({ error: "Card not found" }, 404);
  const photoId = Number(c.req.param("photoId"));
  const photo = await c.env.DB.prepare("SELECT * FROM card_photos WHERE id = ? AND card_id = ?").bind(photoId, card.id).first<PhotoRow>();
  if (!photo) return c.json({ error: "Photo not found" }, 404);
  // Best effort in Drive: the photo leaves the card even if Drive is unreachable (it stays in the folder).
  await getGateways(c.env).drive.trash(photo.drive_file_id).catch(() => undefined);
  await c.env.DB.prepare("DELETE FROM card_photos WHERE id = ?").bind(photoId).run();
  await c.env.DOCKETS_BUCKET.delete(thumbKey(photoId));
  await syncCount(c.env.DB, card);
  return c.json(await list(c.env.DB, card.id));
});

/** Docket detail (managers): how many photos and where they are. Registered before /virtual-dockets/:wo. */
cardPhotoRoutes.get("/virtual-dockets/:wo/photos", requireAuth, requireLevel("admin", "manager"), async (c) => {
  const wo = c.req.param("wo");
  const n = await c.env.DB.prepare("SELECT count(*) AS n FROM card_photos WHERE work_order = ?").bind(wo).first<{ n: number }>();
  const folder = await c.env.DB.prepare("SELECT link FROM docket_photo_folders WHERE work_order = ?").bind(wo).first<{ link: string }>();
  return c.json({ count: n?.n ?? 0, folderLink: folder?.link ?? null });
});
