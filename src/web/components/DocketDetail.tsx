import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { DocketDetail as Detail } from "../../shared/types";
import { api } from "../api";
import { dueLabel, longDate } from "../format";
import { BucketTag } from "./BucketChip";
import { Icon } from "./Icon";

const STATUS: Record<Detail["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-coming-soft text-coming" },
  on_hold: { label: "On Hold", cls: "bg-warn-soft text-warn" },
  completed: { label: "Completed", cls: "bg-ok-soft text-ok" },
  cancelled: { label: "Cancelled", cls: "bg-nodate-soft text-nodate" },
};

const BILLING: Record<Detail["billing"], string> = {
  billed: "Billed",
  no_charge: "No Charge",
  not_billed: "Not Billed",
  cancelled: "Cancelled",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-3">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{value ?? <span className="text-text-3">—</span>}</dd>
    </div>
  );
}

export function DocketDetail({ workOrder, onClose }: { workOrder: string; onClose: () => void }) {
  const { data: d, isPending, error } = useQuery({
    queryKey: ["docket", workOrder],
    queryFn: () => api<Detail>(`/api/dockets/${encodeURIComponent(workOrder)}`),
  });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Work order ${workOrder}`}
        className="relative flex h-full w-full flex-col bg-surface shadow-xl md:max-w-md md:border-l md:border-border"
      >
        <header className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-semibold text-text-3">Work Order #{workOrder}</p>
            <h2 className="truncate text-lg font-bold">{d?.customer ?? (isPending ? "Loading…" : "—")}</h2>
            {d && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[d.status].cls}`}>
                  {STATUS[d.status].label}
                </span>
                {(d.status === "active" || d.status === "on_hold") && <BucketTag bucket={d.bucket} overdue={d.overdue} />}
              </div>
            )}
          </div>
          <button ref={closeRef} className="btn-ghost px-2" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 pb-8 md:px-6">
          {error && <p className="py-6 text-danger">{(error as Error).message}</p>}
          {d && (
            <dl className="divide-y divide-border">
              <Field label="Project" value={d.project} />
              <Field label="Account Manager" value={d.accountManager} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Date" value={d.dateIso ? longDate(d.dateIso) : d.dateRaw} />
                <Field label="Due Date" value={d.dueIso || d.dueRaw ? dueLabel(d.dueIso, d.dueRaw) : null} />
              </div>
              <Field label="Address" value={d.address} />
              <Field label="Notes" value={d.notes && <span className="whitespace-pre-wrap">{d.notes}</span>} />
              <Field label="Quote / PO / Deposit" value={d.quotePo} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Billing" value={BILLING[d.billing]} />
                <Field label="Inv / Date" value={d.invDateRaw} />
              </div>
              <Field label="Link" value={d.link} />
              <Field label="Role" value={d.roleNote} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="#" value={d.seq} />
                <Field label="Sheet Row" value={d.sheetRow} />
              </div>
            </dl>
          )}
        </div>
      </section>
    </div>
  );
}
