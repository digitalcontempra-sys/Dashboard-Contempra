import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardsOf, newDocket, route, setupCards, teardownCards } from "./cardHelpers";
import { api } from "./helpers";

let s: Awaited<ReturnType<typeof setupCards>>;
beforeEach(async () => {
  s = await setupCards();
  await env.DB.batch([env.DB.prepare("DELETE FROM card_photos"), env.DB.prepare("DELETE FROM docket_photo_folders")]);
});
afterEach(teardownCards);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const THUMB = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

function upload(cardId: number, cookie: string, photo: Uint8Array = JPEG, type = "image/jpeg") {
  const form = new FormData();
  form.append("photo", new File([photo], "IMG_0001.jpg", { type }));
  form.append("thumb", new File([THUMB], "thumb.jpg", { type: "image/jpeg" }));
  return api(`/api/cards/${cardId}/photos`, { method: "POST", cookie, body: form });
}
type PhotoList = { photos: { id: number; name: string; link: string; thumbUrl: string }[]; folderLink: string | null };

async function installerCard() {
  const d = await newDocket(s.manager, route("installer"));
  const [c] = await cardsOf(d.workOrder);
  return { wo: d.workOrder, id: c.id };
}

describe("installer photos", () => {
  it("uploads to the docket's Drive photo folder and lists them with thumbnails", async () => {
    const gary = await s.staffWith("gary", "installer");
    const { wo, id } = await installerCard();
    const res = await upload(id, gary);
    expect(res.status).toBe(200);
    const list = (await res.json()) as PhotoList;
    expect(list.photos).toHaveLength(1);
    expect(list.photos[0].link).toMatch(/^https:\/\/drive\.google\.com\//);
    expect(list.photos[0].name).toMatch(new RegExp(`^${wo} Install \\d{4}-\\d{2}-\\d{2} \\d{2}-\\d{2}\\.jpg$`));
    expect(list.folderLink).toMatch(/^https:\/\/drive\.google\.com\//);

    // One folder per docket, named after the docket, reused by later uploads.
    const folders = [...s.g.drive.folders.values()];
    expect(folders).toEqual([{ name: `${wo} - Encore Lounge Photos`, year: 2026 }]);
    await upload(id, gary);
    expect(s.g.drive.folders.size).toBe(1);
    const files = [...s.g.drive.files.values()].filter((f) => f.name.endsWith(".jpg"));
    expect(files).toHaveLength(2);

    // The thumbnail is served from R2 to anyone who can see the card.
    const thumb = await api(list.photos[0].thumbUrl, { cookie: gary });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(THUMB);

    // The card's Photos field shows the count, so the sheet's Production tab reads "Photos: 2".
    const card = await env.DB.prepare("SELECT fields_json FROM cards WHERE id = ?").bind(id).first<{ fields_json: string }>();
    expect(JSON.parse(card!.fields_json).photos).toBe("2");
  });

  it("only the card's team or managers can add, see or remove photos", async () => {
    const ira = await s.staffWith("ira", "designer");
    const { id } = await installerCard();
    expect((await upload(id, ira)).status).toBe(403);
    expect((await upload(id, s.manager)).status).toBe(200);
    expect((await api(`/api/cards/${id}/photos`, { cookie: ira })).status).toBe(404);
  });

  it("rejects files that are not images, too big, or past the 20-photo limit", async () => {
    const { id } = await installerCard();
    let res = await upload(id, s.manager, new Uint8Array([1, 2, 3]), "application/pdf");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Only photos can be uploaded.");
    res = await upload(id, s.manager, new Uint8Array(10 * 1024 * 1024 + 1));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("This photo is too large (max 10 MB).");
    for (let i = 0; i < 20; i++) {
      await env.DB.prepare(
        "INSERT INTO card_photos (card_id, work_order, drive_file_id, link, name, uploaded_by, created_at) VALUES (?, '0', 'x', 'l', 'n', NULL, 't')",
      )
        .bind(id)
        .run();
    }
    res = await upload(id, s.manager);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("This card already has 20 photos.");
  });

  it("a Drive failure keeps nothing and says so", async () => {
    const { id } = await installerCard();
    s.g.drive.failNext();
    const res = await upload(id, s.manager);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("Upload failed. Try again.");
    const n = await env.DB.prepare("SELECT count(*) AS n FROM card_photos").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("removing a photo trashes it in Drive and updates the count", async () => {
    const { id } = await installerCard();
    const list = (await (await upload(id, s.manager)).json()) as PhotoList;
    const res = await api(`/api/cards/${id}/photos/${list.photos[0].id}`, { method: "DELETE", cookie: s.manager });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PhotoList).photos).toEqual([]);
    expect([...s.g.drive.files.values()].find((f) => f.name.endsWith(".jpg"))?.trashed).toBe(true);
    const card = await env.DB.prepare("SELECT fields_json FROM cards WHERE id = ?").bind(id).first<{ fields_json: string }>();
    expect(JSON.parse(card!.fields_json).photos).toBe("0");
  });

  it("a photo folder deleted in Drive by hand is replaced on the next upload", async () => {
    const { wo, id } = await installerCard();
    await env.DB.prepare("INSERT INTO docket_photo_folders (work_order, folder_id, link) VALUES (?, 'gone', 'https://drive.google.com/x')").bind(wo).run();
    const res = await upload(id, s.manager);
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT folder_id FROM docket_photo_folders WHERE work_order = ?").bind(wo).first<{ folder_id: string }>();
    expect(row!.folder_id).not.toBe("gone");
  });

  it("the docket detail can link the photo folder", async () => {
    const { wo, id } = await installerCard();
    await upload(id, s.manager);
    const res = await api(`/api/virtual-dockets/${wo}/photos`, { cookie: s.manager });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { count: number; folderLink: string | null };
    expect(out.count).toBe(1);
    expect(out.folderLink).toMatch(/^https:\/\/drive\.google\.com\//);
  });
});
