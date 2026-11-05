import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { VirtualDocketDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { downloadBlob, renderDocketPdf } from "./renderPdf";

/**
 * Actions for one docket, filtered by access level:
 * Open Docket · Download PDF · Open in Drive · Cancel docket (admin/manager) · Delete (admin).
 */
export function DocketActions({ workOrder, showOpen = true, onDone }: { workOrder: string; showOpen?: boolean; onDone?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canEdit = user?.accessLevel === "admin" || user?.accessLevel === "manager";
  const isAdmin = user?.accessLevel === "admin";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docket = useQuery({
    queryKey: ["virtual-docket", workOrder],
    queryFn: () => api<VirtualDocketDTO>(`/api/virtual-dockets/${encodeURIComponent(workOrder)}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["dockets"] });
    qc.invalidateQueries({ queryKey: ["docket", workOrder] });
    qc.invalidateQueries({ queryKey: ["virtual-docket", workOrder] });
  };

  const cancel = useMutation({
    mutationFn: () => api(`/api/virtual-dockets/${workOrder}/cancel`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      onDone?.();
    },
    onError: (e) => setError((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/virtual-dockets/${workOrder}`, { method: "DELETE", json: { confirm: typed } }),
    onSuccess: () => {
      refresh();
      onDone?.();
      navigate("/dashboard");
    },
    onError: (e) => setError((e as Error).message),
  });

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const d = docket.data;
      if (canEdit && d?.pdf.stored) {
        window.open(`/api/virtual-dockets/${encodeURIComponent(workOrder)}/pdf`, "_blank", "noopener");
      } else if (d) {
        // Staff (or a docket without a stored PDF) get a fresh copy; Staff never see prices.
        downloadBlob(await renderDocketPdf(d.form, workOrder, canEdit), `Docket ${workOrder}.pdf`);
      }
    } catch (e) {
      setError((e as Error).message || "Could not create the PDF");
    } finally {
      setBusy(false);
    }
  }

  const driveLink = docket.data?.pdf.driveLink;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {showOpen && (
          <Link to={`/dockets/${workOrder}`} className="btn-primary">
            Open Docket
          </Link>
        )}
        <button type="button" className="btn-ghost" onClick={download} disabled={busy || !docket.data}>
          {busy ? "Preparing…" : "Download PDF"}
        </button>
        {driveLink && (
          <a className="btn-ghost" href={driveLink} target="_blank" rel="noopener noreferrer">
            Open in Drive
          </a>
        )}
        {canEdit && (
          <button
            type="button"
            className="btn-ghost text-danger"
            disabled={cancel.isPending}
            onClick={() => window.confirm(`Cancel work order ${workOrder}? It will move to History.`) && cancel.mutate()}
          >
            Cancel docket
          </button>
        )}
        {isAdmin && (
          <button type="button" className="btn-ghost text-danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>

      {confirmDelete && (
        <div className="rounded-2xl bg-danger-soft p-3">
          <p className="text-sm font-semibold text-danger">Delete work order {workOrder}?</p>
          <p className="mt-0.5 text-xs text-text-2">It is removed from the Google Sheet and kept in the Trash for 30 days.</p>
          <label className="mt-2 block">
            <span className="sr-only">Type {workOrder} to confirm</span>
            <input
              aria-label={`Type ${workOrder} to confirm`}
              className="field min-h-10"
              value={typed}
              placeholder={workOrder}
              inputMode="numeric"
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-ghost min-h-10" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn-primary min-h-10 bg-danger"
              disabled={typed.trim() !== workOrder || remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete permanently
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
