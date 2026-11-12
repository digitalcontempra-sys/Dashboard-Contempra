import type { GoogleEnv } from "../sheet/googleClient";
import { getAccessToken, getConnection, googleFetch } from "./oauth";

/** PDF copies in the owner's Drive: `Contempra Dockets/<year>/<WO> - <FOR>.pdf`. */
export interface DriveGateway {
  ensureRootFolder(): Promise<string>;
  upload(wo: string, title: string, year: number, pdf: ArrayBuffer, existingId?: string | null): Promise<{ id: string; link: string }>;
  trash(fileId: string): Promise<void>;
  /** Creates `Contempra Dockets/<year>/<WO> - <FOR> Photos`. */
  createPhotoFolder(wo: string, title: string, year: number): Promise<{ id: string; link: string }>;
  uploadImage(folderId: string, name: string, image: ArrayBuffer, mime: string): Promise<{ id: string; link: string }>;
}

/** The Drive file this docket pointed to no longer exists (deleted by hand). */
export class DriveFileNotFoundError extends Error {
  constructor(public fileId: string) {
    super(`Drive file ${fileId} not found`);
    this.name = "DriveFileNotFoundError";
  }
}

const ROOT_NAME = "Contempra Dockets";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

export function realDriveGateway(env: GoogleEnv): DriveGateway {
  async function request(url: string, init: RequestInit = {}, notFoundId?: string): Promise<Record<string, unknown>> {
    const token = await getAccessToken(env);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    const res = await googleFetch(url, { ...init, headers });
    if (res.status === 404 && notFoundId) throw new DriveFileNotFoundError(notFoundId);
    if (!res.ok) throw new Error(`Google Drive request failed (${res.status})`);
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  async function createFolder(name: string, parent?: string): Promise<string> {
    const json = await request(`${API}?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
    });
    return String(json.id);
  }

  async function ensureRootFolder(): Promise<string> {
    const conn = await getConnection(env.DB);
    if (conn?.driveFolderId) return conn.driveFolderId;
    const id = await createFolder(ROOT_NAME);
    await env.DB.prepare("UPDATE google_connection SET drive_folder_id = ? WHERE id = 1").bind(id).run();
    return id;
  }

  async function yearFolder(year: number): Promise<string> {
    const root = await ensureRootFolder();
    // drive.file scope: the app only sees folders it created, so this finds our own year folder.
    const q = `name = '${year}' and '${root}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const found = await request(`${API}?q=${encodeURIComponent(q)}&fields=files(id)`);
    const files = (found.files as { id: string }[] | undefined) ?? [];
    return files[0]?.id ?? createFolder(String(year), root);
  }

  return {
    ensureRootFolder,

    async upload(wo, title, year, pdf, existingId) {
      if (existingId) {
        // Media update keeps Drive's version history of the same file.
        const json = await request(`${UPLOAD}/${existingId}?uploadType=media&fields=id,webViewLink`, {
          method: "PATCH",
          headers: { "content-type": "application/pdf" },
          body: pdf,
        }, existingId);
        return { id: String(json.id), link: String(json.webViewLink) };
      }
      const parent = await yearFolder(year);
      const boundary = `contempra${crypto.randomUUID()}`;
      const meta = JSON.stringify({ name: `${wo} - ${safeName(title) || "Docket"}.pdf`, parents: [parent], mimeType: "application/pdf" });
      const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/pdf\r\n\r\n`;
      const body = new Blob([head, pdf, `\r\n--${boundary}--`]);
      const json = await request(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
        method: "POST",
        headers: { "content-type": `multipart/related; boundary=${boundary}` },
        body: await body.arrayBuffer(),
      });
      return { id: String(json.id), link: String(json.webViewLink) };
    },

    async createPhotoFolder(wo, title, year) {
      const parent = await yearFolder(year);
      const json = await request(`${API}?fields=id,webViewLink`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `${wo} - ${safeName(title) || "Docket"} Photos`, mimeType: FOLDER_MIME, parents: [parent] }),
      });
      return { id: String(json.id), link: String(json.webViewLink) };
    },

    async uploadImage(folderId, name, image, mime) {
      const boundary = `contempra${crypto.randomUUID()}`;
      const meta = JSON.stringify({ name: safeName(name), parents: [folderId], mimeType: mime });
      const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`;
      const body = new Blob([head, image, `\r\n--${boundary}--`]);
      const json = await request(`${UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
        method: "POST",
        headers: { "content-type": `multipart/related; boundary=${boundary}` },
        body: await body.arrayBuffer(),
      });
      return { id: String(json.id), link: String(json.webViewLink) };
    },

    async trash(fileId) {
      await request(`${API}/${fileId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
    },
  };
}
