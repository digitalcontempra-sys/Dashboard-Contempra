import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { emptyForm, type DocketForm } from "../../shared/docketForm";
import type { VirtualDocketDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { renderDocketPdf } from "./renderPdf";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "2026-11-21" -> "Nov 21, 2026"; anything else stays as typed. */
function day(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DAY.format(new Date(`${iso}T00:00:00Z`)) : iso;
}

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

type Row = [label: string, value: ReactNode];

/** The docket's rows, grouped; empty values are left out. Never any price (costs, totals, taxes, deposit). */
function sections(stored: Partial<DocketForm>, sheet: VirtualDocketDTO["sheet"]): [string, Row[]][] {
  // A form saved by an older version may lack fields; fill them with blanks.
  const f: DocketForm = { ...emptyForm("", ""), ...stored };
  const keep = (rows: [string, ReactNode | null | undefined | false][]) =>
    rows.filter((r): r is Row => r[1] !== null && r[1] !== undefined && r[1] !== false && r[1] !== "");
  const materials = f.materials.map((m) => m.name.trim()).filter(Boolean);
  const labour = f.labour
    .map((l) => [l.name.trim(), l.work.trim(), l.hrs.trim() && `${l.hrs.trim()} h`, l.date && day(l.date)].filter(Boolean).join(" · "))
    .filter(Boolean);
  const list = (items: string[]) =>
    items.length > 0 && (
      <ul className="space-y-0.5">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    );
  const link = sheet.link?.trim();
  return [
    ["Customer", keep([["Customer", f.forName.trim()], ["Contact", f.contact.trim()], ["Phone", f.phone.trim()], ["Email", f.email.trim()]])],
    [
      "Dates",
      keep([
        ["Date", f.date && day(f.date)],
        ["Required", f.required.kind === "date" ? day(f.required.date) : f.required.kind === "text" ? f.required.text : null],
        ["Proof required", f.proofRequired && "Yes"],
      ]),
    ],
    [
      "Work",
      keep([
        ["Description", f.body.trim() && <span className="whitespace-pre-wrap">{f.body.trim()}</span>],
        ["Materials", list(materials)],
        ["Labour", list(labour)],
      ]),
    ],
    [
      "Address & service",
      keep([
        ["Address", f.address.trim()],
        ["Service", f.service.map(title).join(", ")],
        ["Call when ready", f.callWhenReady && "Yes"],
      ]),
    ],
    [
      "Order",
      keep([
        ["Quote #", f.quoteNo.trim()],
        ["PO #", f.poNo.trim()],
        ["Order taken by", f.orderTakenBy.trim()],
        ["Account Manager", f.salesperson.trim()],
      ]),
    ],
    [
      "Notes",
      keep([
        ["Notes", sheet.notes?.trim() && <span className="whitespace-pre-wrap">{sheet.notes.trim()}</span>],
        [
          "Link",
          link && /^https?:\/\//i.test(link) ? (
            <a className="break-all text-accent underline" href={link} target="_blank" rel="noopener noreferrer">
              {link}
            </a>
          ) : (
            link
          ),
        ],
      ]),
    ],
  ];
}

/** Read-only docket for production cards: a simple grouped list plus View PDF. */
export function ReadDocket({ workOrder, onClose }: { workOrder: string; onClose: () => void }) {
  const { user } = useAuth();
  const canEdit = user?.accessLevel === "admin" || user?.accessLevel === "manager";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const docket = useQuery({
    queryKey: ["virtual-docket", workOrder],
    queryFn: () => api<VirtualDocketDTO>(`/api/virtual-dockets/${encodeURIComponent(workOrder)}`),
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    // Capture on window runs before the card's own Escape handler, so Escape closes only this panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  async function viewPdf() {
    const d = docket.data;
    if (!d) return;
    setBusy(true);
    setError(null);
    // Open the tab now, inside the tap: iPhone Safari blocks a window opened after an await.
    const win = window.open("", "_blank");
    if (!win) {
      setBusy(false);
      setError("Your browser blocked the PDF tab. Allow pop-ups for this site and try again.");
      return;
    }
    try {
      let url: string;
      if (canEdit && d.pdf.stored) url = `/api/virtual-dockets/${encodeURIComponent(workOrder)}/pdf`;
      else {
        // Staff (or a docket without a stored PDF) get a fresh copy; Staff never see prices.
        url = URL.createObjectURL(await renderDocketPdf(d.form, workOrder, canEdit));
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      win.location.href = url;
    } catch (e) {
      win.close();
      setError((e as Error).message || "Could not create the PDF");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="animate-fade-in absolute inset-0 bg-black/25 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Docket ${workOrder}`}
        className="glass-strong animate-sheet-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-panel)] sm:max-w-xl sm:rounded-[var(--radius-panel)]"
      >
        <header className="flex items-center gap-3 px-5 pt-5 pb-3 sm:px-7 sm:pt-6">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-semibold text-text-3">Work Order #{workOrder}</p>
            <h2 className="mt-0.5 text-xl font-bold tracking-tight">Docket</h2>
          </div>
          <button
            type="button"
            className="btn-ghost inline-flex shrink-0 items-center gap-1.5"
            disabled={busy || !docket.data}
            onClick={() => void viewPdf()}
          >
            <Icon name="doc" className="size-4" />
            {busy ? "Preparing…" : "View PDF"}
          </button>
          <button
            ref={closeRef}
            type="button"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-text-2 transition hover:bg-border hover:text-text"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" className="size-4" />
          </button>
        </header>

        <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-5 sm:px-7">
          {error && (
            <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-3.5 py-2 text-sm font-medium text-danger">
              {error}
            </p>
          )}
          {docket.isPending && <p className="text-sm text-text-2">Loading docket…</p>}
          {docket.isError && (
            <p role="alert" className="text-sm text-danger">
              {(docket.error as Error).message || "Could not load the docket"}
            </p>
          )}
          {docket.data &&
            sections(docket.data.form, docket.data.sheet ?? { notes: null, link: null })
              .filter(([, rows]) => rows.length > 0)
              .map(([heading, rows]) => (
                <section key={heading} className="mt-3 first:mt-0">
                  <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-text-3 uppercase">{heading}</h3>
                  <dl className="divide-y divide-border rounded-xl border border-border bg-surface">
                    {rows.map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-3.5 py-2 text-[15px]">
                        <dt className="text-[13px] text-text-3">{label}</dt>
                        <dd className="min-w-0 break-words">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
        </div>
      </section>
    </div>
  );
}
