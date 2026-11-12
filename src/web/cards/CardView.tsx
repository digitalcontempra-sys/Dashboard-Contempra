import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AREA_LABEL, CARD_FIELDS, continueBlocker, continueLabel, type CardFields } from "../../shared/cards";
import type { CardDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { AreaChip } from "../components/AreaChip";
import { BucketTag } from "../components/BucketChip";
import { Icon } from "../components/Icon";
import { CardFieldsEditor } from "./fields";

const SAVE_DELAY_MS = 1000;
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** The full production card: header, role fields, and Continue / Send back. */
export function CardView({ card: initial, onClose }: { card: CardDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [card, setCard] = useState(initial);
  const [fields, setFields] = useState<CardFields>(initial.fields);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [back, setBack] = useState<{ open: boolean; step: number | null; reason: string }>({ open: false, step: null, reason: "" });
  // Edits not yet sent, and the version the next request must carry.
  const pending = useRef<CardFields | null>(null);
  const version = useRef(initial.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const active = card.status === "active";
  const blocker = continueBlocker(card.roleId, fields, { proofRequired: card.header.proofRequired });

  useEffect(() => {
    void api(`/api/cards/${initial.id}/seen`, { method: "POST" })
      .then(() => qc.invalidateQueries({ queryKey: ["my-cards-summary"] }))
      .catch(() => undefined);
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Closing within the save delay must not lose the last edits.
      if (pending.current) void flushRef.current();
      else if (timer.current) clearTimeout(timer.current);
      opener?.focus?.();
    };
  }, [initial.id, qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["my-cards"] });
    void qc.invalidateQueries({ queryKey: ["my-cards-summary"] });
    void qc.invalidateQueries({ queryKey: ["board"] });
  };

  const fail = (e: unknown) => {
    setError((e as Error).message);
    refresh();
  };

  /**
   * Sends the edits made so far; resolves once the server has them. Waits for a save already in
   * flight first, so every request carries the version the previous one returned.
   */
  async function flush(): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current && !(await inFlight.current)) return false;
    const changes = pending.current;
    if (!changes) return true;
    pending.current = null;
    const save = (async () => {
      try {
        const dto = await api<CardDTO>(`/api/cards/${card.id}/fields`, { method: "PUT", json: { fields: changes, version: version.current } });
        version.current = dto.version;
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    })();
    inFlight.current = save;
    const ok = await save;
    if (inFlight.current === save) inFlight.current = null;
    return ok;
  }
  flushRef.current = flush;

  function change(key: string, value: string | boolean | null) {
    setError(null);
    setFields((f) => ({ ...f, [key]: value }));
    pending.current = { ...(pending.current ?? {}), [key]: value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  async function act(path: string, json: Record<string, unknown>, close = true) {
    setBusy(true);
    setError(null);
    try {
      if (!(await flush())) return;
      const dto = await api<CardDTO>(`/api/cards/${card.id}/${path}`, { method: "POST", json: { ...json, version: version.current } });
      version.current = dto.version;
      setCard(dto);
      refresh();
      if (close) onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    setBusy(true);
    try {
      const dto = await api<CardDTO>(`/api/cards/${card.id}/claim`, { method: "POST" });
      setCard(dto);
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function openSendBack(toDesign: boolean) {
    const design = card.earlier.find((e) => e.roleId === "designer") ?? card.earlier[0];
    const reason = toDesign
      ? card.roleId === "colex" || card.roleId === "contour_cut"
        ? "Cut file missing"
        : "File missing"
      : "";
    setBack({ open: true, step: toDesign ? (design?.step ?? null) : null, reason });
  }

  const claimedByOther = card.claimedBy && card.claimedBy.id !== user?.id;
  const canSendBack = active && card.earlier.length > 0;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <div className="animate-fade-in absolute inset-0 bg-black/25 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${AREA_LABEL[card.roleId] ?? card.roleId} card for work order ${card.workOrder}`}
        className="glass-strong animate-sheet-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-panel)] sm:max-w-xl sm:rounded-[var(--radius-panel)]"
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-3 sm:px-7 sm:pt-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-text-3">Work Order #{card.workOrder}</span>
              <AreaChip roleId={card.roleId} size="md" />
              <BucketTag bucket={card.header.bucket} />
              {card.status === "waiting" && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-2">Up next</span>
              )}
            </div>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight">{card.header.customer ?? "—"}</h2>
            <p className="mt-0.5 text-[15px] text-text-2">
              {card.jobName}
              {card.header.project ? ` · ${card.header.project}` : ""}
            </p>
            {card.header.accountManager && <p className="mt-0.5 text-[13px] text-text-3">Account Manager: {card.header.accountManager}</p>}
          </div>
          <button
            ref={closeRef}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-text-2 transition hover:bg-border hover:text-text"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" className="size-4" />
          </button>
        </header>

        {card.returned && (
          <p className="mx-5 mb-2 rounded-xl bg-danger px-3.5 py-2 text-sm font-semibold text-white sm:mx-7">
            Returned by {card.returned.by} · {card.returned.reason}
          </p>
        )}
        {claimedByOther && (
          <p className="mx-5 mb-2 text-sm font-medium text-text-2 sm:mx-7">{firstName(card.claimedBy!.name)} is working on it</p>
        )}
        {card.claimedBy && !claimedByOther && <p className="mx-5 mb-2 text-sm font-medium text-ok sm:mx-7">You're on it</p>}

        <div className="flex-1 overflow-y-auto px-5 pb-4 sm:px-7">
          {(CARD_FIELDS[card.roleId] ?? []).length > 0 && (
            <CardFieldsEditor
              roleId={card.roleId}
              values={fields}
              onChange={change}
              disabled={!active || busy}
              placeholders={{ address: card.header.address ?? "" }}
              cardId={card.id}
            />
          )}

          {back.open && (
            <div className="mt-4 rounded-2xl border border-danger/30 bg-danger-soft p-3.5">
              <div role="radiogroup" aria-label="Send back to" className="flex flex-wrap gap-2">
                {card.earlier.map((e) => (
                  <label
                    key={e.step}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold ${
                      back.step === e.step ? "border-danger bg-surface text-danger" : "border-border bg-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name="send-back-step"
                      className="sr-only"
                      checked={back.step === e.step}
                      onChange={() => setBack((b) => ({ ...b, step: e.step }))}
                    />
                    {AREA_LABEL[e.roleId] ?? e.roleId}
                  </label>
                ))}
              </div>
              <label htmlFor="send-back-reason" className="mt-3 mb-1 block text-[13px] font-medium text-text-2">
                Reason
              </label>
              <textarea
                id="send-back-reason"
                className="field min-h-20 py-2"
                value={back.reason}
                onChange={(e) => setBack((b) => ({ ...b, reason: e.target.value }))}
              />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setBack({ open: false, step: null, reason: "" })}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn bg-danger text-white"
                  disabled={busy || back.step === null || back.reason.trim().length < 3}
                  onClick={() => void act("send-back", { toStep: back.step, reason: back.reason.trim() })}
                >
                  Send back
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3.5 py-2 text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>

        {active && (
          <footer className="border-t border-border px-5 py-4 sm:px-7">
            <div className="flex flex-wrap items-center gap-2">
              {canSendBack && !back.open && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => openSendBack(false)}>
                  ← Send back
                </button>
              )}
              {(!card.claimedBy || claimedByOther) && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => void claim()}>
                  I'm on it
                </button>
              )}
              <button
                type="button"
                className="btn-primary ml-auto"
                disabled={busy || blocker !== null}
                onClick={() => void act("continue", {})}
              >
                {continueLabel(card.roleId, card.nextRoleId)}
              </button>
            </div>
            {blocker && (
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <p role="status" className="text-sm text-text-2">
                  {blocker.message}
                </p>
                {blocker.sendBackToDesign && canSendBack && (
                  <button type="button" className="btn bg-danger-soft text-danger" onClick={() => openSendBack(true)}>
                    Send back to Design
                  </button>
                )}
              </div>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
