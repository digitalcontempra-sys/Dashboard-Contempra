import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

type Status = { connected: boolean; email: string | null; sheetUrl: string | null };

/** Admin panel: connect the sheet owner's Google account and choose the Workorder Books sheet. */
export function GoogleConnection() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [url, setUrl] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const status = useQuery({ queryKey: ["google-status"], queryFn: () => api<Status>("/api/google/status") });

  useEffect(() => {
    const result = params.get("google");
    if (!result) return;
    setToast(
      result === "connected"
        ? "Google connected"
        : result === "missing_permissions"
          ? "Google was not connected: allow both Google Sheets and Google Drive access, then try again."
          : `Google sign-in was not completed (${result})`,
    );
    const next = new URLSearchParams(params);
    next.delete("google");
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (status.data?.sheetUrl) setUrl(status.data.sheetUrl);
  }, [status.data?.sheetUrl]);

  const save = useMutation({
    mutationFn: () => api("/api/google/sheet", { method: "PUT", json: { url } }),
    onSuccess: () => {
      setToast("Google Sheet saved");
      qc.invalidateQueries();
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api("/api/google/disconnect", { method: "POST" }),
    onSettled: () => qc.invalidateQueries(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  const s = status.data;
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Google Connection</h2>
          {s?.connected ? (
            <p className="text-sm text-ok">Connected as {s.email}</p>
          ) : (
            <p className="text-sm text-text-2">Connect the Google account that owns the Workorder Books sheet.</p>
          )}
        </div>
        {s?.connected ? (
          <button
            className="btn-ghost text-xs"
            onClick={() => window.confirm("Disconnect Google? Sync and new dockets stop until you connect again.") && disconnect.mutate()}
          >
            Disconnect
          </button>
        ) : (
          <a className="btn-primary" href="/api/google/connect">
            Connect Google
          </a>
        )}
      </div>

      {s?.connected && (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1">
            <span className="mb-1.5 block text-sm font-medium">Google Sheet URL</span>
            <input
              className="field"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              inputMode="url"
            />
          </label>
          <button type="submit" className="btn-primary" disabled={!url.trim() || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      )}
      {save.error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {(save.error as Error).message}
        </p>
      )}
      {toast && (
        <p role="status" className="mt-3 text-sm text-ok">
          {toast}
        </p>
      )}
    </section>
  );
}
