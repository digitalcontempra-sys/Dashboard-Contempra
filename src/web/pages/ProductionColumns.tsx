import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BoardDTO } from "../../shared/types";
import { api } from "../api";

/** Admin: one-time move of the sheet's old Q–Y columns to "Legacy Q-Y" and the new production headers. */
export function ProductionColumns() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const status = useQuery({ queryKey: ["board", "", "", null], queryFn: () => api<BoardDTO>("/api/production-board") });
  const run = useMutation({
    mutationFn: () => api<{ archivedRows: number }>("/api/admin/production-columns", { method: "POST", json: { confirm: "SET UP" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board"] }),
  });

  if (run.data) {
    return (
      <section className="card p-4">
        <h2 className="font-semibold">Production columns</h2>
        <p className="mt-1 text-sm text-ok">Done. {run.data.archivedRows} rows archived.</p>
      </section>
    );
  }
  if (!status.data || status.data.productionColumnsReady) return null;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Production columns</h2>
          <p className="text-sm text-text-2">The Google Sheet does not show the production stage yet.</p>
        </div>
        {!open && (
          <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
            Set up production columns
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 rounded-2xl bg-surface-2 p-3.5">
          <p className="text-sm">
            This copies columns Q–Y to a new "Legacy Q-Y" tab, clears them, and writes the new production headers. Type SET UP to continue.
          </p>
          <label htmlFor="setup-confirm" className="sr-only">
            Type SET UP to continue
          </label>
          <input id="setup-confirm" className="field mt-2" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          {run.error && <p className="mt-2 text-sm text-danger">{(run.error as Error).message}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={typed.trim() !== "SET UP" || run.isPending} onClick={() => run.mutate()}>
              Set up
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
