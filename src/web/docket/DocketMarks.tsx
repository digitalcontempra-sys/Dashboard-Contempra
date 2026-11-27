import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskCardDTO } from "../../shared/types";
import { api } from "../api";
import { BucketTag } from "../components/BucketChip";
import { Icon } from "../components/Icon";
import { NewTaskCardDialog } from "../tasks/NewTaskCard";

const ROUND = "inline-flex shrink-0 items-center justify-center rounded-full transition";
const TASK_STYLE = { background: "var(--task-bg)", borderColor: "var(--task-border)", color: "var(--task-ink)" };

function refresh(qc: ReturnType<typeof useQueryClient>, workOrder: string) {
  void qc.invalidateQueries({ queryKey: ["dockets"] });
  void qc.invalidateQueries({ queryKey: ["docket", workOrder] });
}

/** My List bookmark: empty = not in my list, filled = in it. One tap, no confirmation. */
export function FollowButton({ workOrder, followed, size = "sm" }: { workOrder: string; followed: boolean; size?: "sm" | "md" }) {
  const qc = useQueryClient();
  const [on, setOn] = useState(followed);
  const busy = useRef(false);
  useEffect(() => setOn(followed), [followed]);
  const label = on ? "Remove from My List" : "Add to My List";

  async function toggle() {
    if (busy.current) return;
    busy.current = true;
    const next = !on;
    setOn(next);
    try {
      await api(`/api/dockets/${encodeURIComponent(workOrder)}/follow`, { method: next ? "PUT" : "DELETE" });
      refresh(qc, workOrder);
    } catch {
      setOn(!next);
    } finally {
      busy.current = false;
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => void toggle()}
      className={`${ROUND} ${size === "md" ? "size-9" : "size-7"} ${on ? "bg-accent-soft text-accent" :"bg-surface-2 text-text-3 hover:text-text"}`}
    >
      <Icon name="bookmark" filled={on} className={size === "md" ? "size-4" : "size-3.5"} />
    </button>
  );
}

/** Opens New Task Card as a note to self pinned to the docket. Yellow with a count when I have open notes on it. */
export function NoteButton({ workOrder, count, size = "sm" }: { workOrder: string; count: number; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const label = count > 0 ? `Add a note to #${workOrder} (${count} open note${count === 1 ? "" : "s"})` : `Add a note to #${workOrder}`;
  const dim = size === "md" ? "h-9 min-w-9" : "h-7 min-w-7";
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={count > 0 ? `${count} open note${count === 1 ? "" : "s"}. Add a note` : "Add a note"}
        onClick={() => setOpen(true)}
        style={count > 0 ? TASK_STYLE : undefined}
        className={`${ROUND} ${dim} gap-0.5 ${count > 0 ? "border px-1.5 text-[11px] font-black" : "bg-surface-2 text-text-3 hover:text-text"}`}
      >
        <Icon name="note" filled={false} className={size === "md" ? "size-4" : "size-3.5"} />
        {count > 0 && <span className="tabular-nums">{count}</span>}
      </button>
      {/* Portal: tiles and dialogs use transforms, which would trap a fixed overlay inside them. */}
      {open &&
        createPortal(<NewTaskCardDialog workOrder={workOrder} onClose={() => setOpen(false)} onSent={() => setOpen(false)} />, document.body)}
    </>
  );
}

/** My open notes on this docket, as yellow stickies with Done. Only mine; nobody else sees them. */
export function DocketNotes({ workOrder, count }: { workOrder: string; count: number }) {
  const qc = useQueryClient();
  const notes = useQuery({
    queryKey: ["tasks", "docket", workOrder],
    queryFn: () => api<TaskCardDTO[]>(`/api/task-cards?workOrder=${encodeURIComponent(workOrder)}`),
    enabled: count > 0,
  });
  const [error, setError] = useState<string | null>(null);
  const items = count > 0 ? (notes.data ?? []) : [];
  if (items.length === 0) return null;

  async function done(id: number) {
    setError(null);
    try {
      await api(`/api/task-cards/${id}/done`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["my-cards-summary"] });
      refresh(qc, workOrder);
    }
  }

  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-3">My notes</h3>
      <ul aria-label="My notes" className="grid gap-2 sm:grid-cols-2">
        {items.map((t) => (
          <li key={t.id} style={TASK_STYLE} className="force-light flex min-w-0 flex-col gap-2 rounded-2xl border p-3">
            <p className="text-[14px] leading-snug break-words whitespace-pre-wrap">{t.note}</p>
            <div className="mt-auto flex items-center justify-between gap-2">
              <BucketTag bucket={t.bucket} />
              <button type="button" className="btn-ghost min-h-9 px-3 text-sm" onClick={() => void done(t.id)}>
                Done
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
