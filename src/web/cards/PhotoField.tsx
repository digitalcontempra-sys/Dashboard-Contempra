import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { resizePhoto } from "./resizePhoto";

type Photo = { id: number; name: string; link: string; thumbUrl: string };
type PhotoList = { photos: Photo[]; folderLink: string | null };
type Pending = { key: number; preview: string; photo: Blob; thumb: Blob; failed: boolean };

let nextKey = 1;
/** A local preview of the photo while it uploads (empty where the browser cannot make one). */
function previewOf(b: Blob): string {
  try {
    return URL.createObjectURL(b);
  } catch {
    return "";
  }
}

/** Installer card: take photos with the phone camera; each one is uploaded to the docket's Drive folder. */
export function PhotoField({ cardId, disabled }: { cardId: number; disabled?: boolean }) {
  const qc = useQueryClient();
  const key = ["card-photos", cardId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<PhotoList>(`/api/cards/${cardId}/photos`) });
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function send(p: Pending) {
    setPending((list) => list.map((x) => (x.key === p.key ? { ...x, failed: false } : x)));
    const form = new FormData();
    form.append("photo", p.photo, "photo.jpg");
    form.append("thumb", p.thumb, "thumb.jpg");
    try {
      const out = await api<PhotoList>(`/api/cards/${cardId}/photos`, { method: "POST", body: form });
      qc.setQueryData(key, out);
      setPending((list) => list.filter((x) => x.key !== p.key));
      if (p.preview) URL.revokeObjectURL(p.preview);
    } catch {
      setPending((list) => list.map((x) => (x.key === p.key ? { ...x, failed: true } : x)));
    }
  }

  async function onFiles(files: FileList | null) {
    setError(null);
    for (const f of Array.from(files ?? [])) {
      try {
        const { photo, thumb } = await resizePhoto(f);
        const p: Pending = { key: nextKey++, preview: previewOf(thumb), photo, thumb, failed: false };
        setPending((list) => [...list, p]);
        await send(p);
      } catch {
        setError("Could not read this photo.");
      }
    }
  }

  async function remove(photo: Photo) {
    if (!window.confirm("Remove this photo? It also goes to the Drive trash.")) return;
    try {
      qc.setQueryData(key, await api<PhotoList>(`/api/cards/${cardId}/photos/${photo.id}`, { method: "DELETE" }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const photos = data?.photos ?? [];
  return (
    <div className="rounded-2xl bg-surface-2 px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-text-2">Photos ({photos.length})</p>
        {data?.folderLink && (
          <a href={data.folderLink} target="_blank" rel="noreferrer" className="text-xs font-semibold text-accent">
            Open folder in Drive
          </a>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p, i) => (
          <div key={p.id} className="relative">
            <a href={p.link} target="_blank" rel="noreferrer" aria-label={`Photo ${i + 1}, open in Drive`} className="block">
              <img src={p.thumbUrl} alt="" className="aspect-square w-full rounded-xl object-cover" loading="lazy" />
            </a>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-black/60 text-white"
                onClick={() => void remove(p)}
              >
                <Icon name="close" className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.key} className="relative">
            <img src={p.preview} alt="" className={`aspect-square w-full rounded-xl object-cover ${p.failed ? "" : "opacity-60"}`} />
            <div className="absolute inset-0 grid place-items-center rounded-xl text-center text-[11px] font-bold">
              {p.failed ? (
                <div className="rounded-lg bg-white/90 p-1 text-danger">
                  <p>Upload failed. Try again.</p>
                  <button type="button" className="mt-1 rounded-md bg-danger px-2 py-0.5 text-white" onClick={() => void send(p)}>
                    Retry
                  </button>
                </div>
              ) : (
                <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-text">Uploading…</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {!disabled && (
        <label className="btn-ghost mt-2 w-full cursor-pointer">
          <Icon name="plus" className="size-4" />
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            aria-label="Take photo"
            className="sr-only"
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
