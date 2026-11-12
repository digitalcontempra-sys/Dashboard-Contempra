import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { DocketDetail as Detail } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { DocketHistory, DocketProduction } from "./DocketHistory";
import { dueLabel, longDate } from "../format";
import { BucketTag } from "./BucketChip";
import { Icon } from "./Icon";
import { DocketActions } from "../docket/DocketActions";

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

const empty = <span className="text-text-3">—</span>;

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3.5 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold">{value ?? empty}</dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2.5 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="text-[13px] text-text-3">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value ?? empty}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-3">{title}</h3>
      <dl className="divide-y divide-border rounded-2xl bg-surface-2 px-4">{children}</dl>
    </section>
  );
}

export function DocketDetail({ workOrder, onClose }: { workOrder: string; onClose: () => void }) {
  const { data: d, isPending, error } = useQuery({
    queryKey: ["docket", workOrder],
    queryFn: () => api<Detail>(`/api/dockets/${encodeURIComponent(workOrder)}`),
  });
  const { user } = useAuth();
  const managers = user?.accessLevel === "admin" || user?.accessLevel === "manager";
  const [tab, setTab] = useState<"details" | "production" | "history">("details");
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus, Escape and scroll lock run once per open dialog, not on every parent refresh.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  const live = d && (d.status === "active" || d.status === "on_hold");

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <div className="animate-fade-in absolute inset-0 bg-black/25 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Work order ${workOrder}`}
        className="glass-strong animate-sheet-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-panel)] sm:max-w-2xl sm:rounded-[var(--radius-panel)]"
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-4 sm:px-7 sm:pt-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-text-3">Work Order #{workOrder}</span>
              {d && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[d.status].cls}`}>
                  {STATUS[d.status].label}
                </span>
              )}
              {live && <BucketTag bucket={d.bucket} overdue={d.overdue} />}
            </div>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight">{d?.customer ?? (isPending ? "Loading…" : "—")}</h2>
            {d?.project && <p className="mt-1 text-[15px] leading-snug text-text-2">{d.project}</p>}
          </div>
          <button
            ref={closeRef}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-text-2 transition hover:bg-border hover:text-text"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" className="size-4" />
          </button>
        </header>

        <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-7 sm:px-7">
          {error && <p className="py-6 text-danger">{(error as Error).message}</p>}
          {d && managers && (
            <div role="tablist" aria-label="Docket sections" className="mb-4 flex gap-1 rounded-full bg-surface-2 p-1">
              {(
                [
                  ["details", "Details"],
                  ["production", "Production"],
                  ["history", "History"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`min-h-10 flex-1 rounded-full text-sm font-semibold transition ${
                    tab === id ? "bg-surface-strong text-text shadow-card" : "text-text-2"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {d && managers && tab === "production" && <DocketProduction workOrder={workOrder} />}
          {d && managers && tab === "history" && <DocketHistory workOrder={workOrder} />}
          {d && tab === "details" && (
            <>
              <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Fact label="Account Manager" value={d.accountManager} />
                <Fact label="Due Date" value={d.dueIso || d.dueRaw ? dueLabel(d.dueIso, d.dueRaw) : null} />
                <Fact label="Date" value={d.dateIso ? longDate(d.dateIso) : d.dateRaw} />
                <Fact label="Billing" value={BILLING[d.billing]} />
              </dl>

              <Section title="Job">
                <Field label="Address" value={d.address} />
                <Field label="Notes" value={d.notes && <span className="whitespace-pre-wrap">{d.notes}</span>} />
                <Field label="Quote / PO / Deposit" value={d.quotePo} />
                <Field label="Link" value={d.link} />
              </Section>

              <Section title="Billing">
                <Field label="Invoiced" value={d.inv ? "Yes" : "No"} />
                <Field label="Inv / Date" value={d.invDateRaw} />
              </Section>

              <Section title="Sheet">
                <Field label="Role" value={d.roleNote} />
                <Field label="#" value={d.seq} />
                <Field label="Sheet Row" value={d.sheetRow} />
              </Section>

              <div className="mt-6">
                <DocketActions workOrder={workOrder} onDone={onClose} />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
