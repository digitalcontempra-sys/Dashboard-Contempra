import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskCardDTO, TaskHistoryPage } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { BucketTag } from "../components/BucketChip";
import { DocketDetail } from "../components/DocketDetail";
import { Icon } from "../components/Icon";
import { isTopDialog } from "../components/topDialog";

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const NARROW_SPACE = new RegExp(String.fromCharCode(0x202f), "g");
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Winnipeg", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const taskTime = (iso: string) => TIME.format(new Date(iso)).replace(NARROW_SPACE, " ");

const TASK_STYLE = { background: "var(--task-bg)", borderColor: "var(--task-border)", color: "var(--task-ink)" };

/** A task I wrote for myself: a personal note. */
export const isSelf = (t: TaskCardDTO) => t.from.id === t.to.id;

/** Light-yellow sticky-note tile, unlike docket cards. */
export function TaskTile({ task, onOpen }: { task: TaskCardDTO; onOpen: () => void }) {
  const self = isSelf(task);
  const who = self ? "Note to self" : `Task from ${firstName(task.from.name)}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={TASK_STYLE}
      className={`tile force-light group border ${task.isNew ? "ring-2 ring-accent" : ""}`}
      aria-label={`${who}: ${task.note.slice(0, 60)}${task.isNew ? ", new" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="rounded-md bg-black/10 px-1.5 py-px text-[10px] font-black uppercase tracking-wide">{self ? "Note" : "Task"}</span>
        {task.isNew && <span className="rounded-md bg-accent px-1.5 py-px text-[10px] font-black text-accent-ink">NEW</span>}
        {task.workOrder && <span className="ml-auto font-mono text-[11px] font-bold tabular-nums">#{task.workOrder}</span>}
      </div>
      <p className="mt-2 text-[12px] font-semibold opacity-80">{self ? "Note to self" : `From ${firstName(task.from.name)}`}</p>
      <p className="mt-1 line-clamp-3 text-[14px] leading-snug font-semibold">{task.note}</p>
      <div className="mt-auto">
        <BucketTag bucket={task.bucket} />
      </div>
    </button>
  );
}

/** A received task, opened: the full note and Done. */
export function TaskView({ task, onClose }: { task: TaskCardDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [docket, setDocket] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Once per task: a refresh behind the dialog must not re-mark it seen or move focus.
  useEffect(() => {
    void api(`/api/task-cards/${task.id}/seen`, { method: "POST" })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["my-cards-summary"] });
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      })
      .catch(() => undefined);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && isTopDialog(dialogRef.current) && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [task.id, qc]);

  const self = isSelf(task);

  async function done(remove = false) {
    if (remove && !window.confirm("Delete this note?")) return;
    setBusy(true);
    try {
      await api(remove ? `/api/task-cards/${task.id}` : `/api/task-cards/${task.id}/done`, { method: remove ? "DELETE" : "POST" });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["my-cards-summary"] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <div className="animate-fade-in absolute inset-0 bg-black/25 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={self ? "Note to self" : `Task from ${task.from.name}`}
        style={TASK_STYLE}
        className="animate-sheet-in relative w-full rounded-t-[var(--radius-panel)] border p-5 shadow-[var(--shadow-lift)] sm:max-w-md sm:rounded-[var(--radius-panel)]"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className="rounded-md bg-black/10 px-1.5 py-px text-[10px] font-black uppercase tracking-wide">{self ? "Note" : "Task"}</span>
            <p className="mt-2 text-sm font-semibold opacity-80">
              {self ? "Note to self" : `From ${task.from.name}`} · {taskTime(task.createdAt)}
            </p>
          </div>
          <button ref={closeRef} type="button" aria-label="Close" className="grid size-11 place-items-center rounded-full bg-black/10" onClick={onClose}>
            <Icon name="close" className="size-4" />
          </button>
        </div>
        <p className="mt-3 text-[16px] leading-relaxed whitespace-pre-wrap">{task.note}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BucketTag bucket={task.bucket} />
          {task.workOrder && (
            <button type="button" className="flex min-h-9 items-center gap-1.5 rounded-full bg-black/10 px-3 text-sm font-bold" onClick={() => setDocket(true)}>
              <Icon name="doc" className="size-4" />
              Docket #{task.workOrder}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {self && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void done(true)}>
              Delete
            </button>
          )}
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void done()}>
            Done
          </button>
        </div>
        {/* Portal: this sheet animates with a transform, which would trap a fixed overlay inside it. */}
        {docket && task.workOrder && createPortal(<DocketDetail workOrder={task.workOrder} onClose={() => setDocket(false)} />, document.body)}
      </section>
    </div>
  );
}

/** Finished tasks I sent or received (and my own notes), newest first, 50 at a time. */
export function HistoryList() {
  const { user } = useAuth();
  const history = useInfiniteQuery({
    queryKey: ["tasks", "history"],
    queryFn: ({ pageParam }) => api<TaskHistoryPage>(`/api/task-cards?box=history&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
  });

  if (history.error) return <p className="py-6 text-danger">{(history.error as Error).message}</p>;
  if (!history.data) return null;
  const items = history.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <div className="card px-6 py-14 text-center text-text-2">No finished task cards yet.</div>;
  const kind = (t: TaskCardDTO) =>
    isSelf(t)
      ? { label: "Note to self", cls: "bg-surface-2 text-text-2", who: null }
      : t.from.id === user?.id
        ? { label: "Sent by me", cls: "bg-info-soft text-info", who: `To ${t.to.name}` }
        : { label: `Sent by ${t.from.name}`, cls: "bg-accent-soft text-accent", who: null };
  return (
    <>
      <ul aria-label="Task history" className="card divide-y divide-border overflow-hidden">
        {items.map((t) => {
          const k = kind(t);
          return (
            <li key={t.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${k.cls}`}>{k.label}</span>
                {k.who && <span className="text-sm font-semibold">{k.who}</span>}
                {t.workOrder && <span className="font-mono text-xs font-bold text-text-2 tabular-nums">#{t.workOrder}</span>}
              </div>
              <p className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-text-2">{t.note}</p>
              <span className="text-xs font-semibold text-ok">{`Done ✓ · ${taskTime(t.doneAt ?? t.createdAt)}`}</span>
            </li>
          );
        })}
      </ul>
      {history.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <button type="button" className="btn-ghost" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
            Show more
          </button>
        </div>
      )}
    </>
  );
}

/** Tasks I sent, newest first, with their status. Showing it clears the "done" alerts. */
export function SentList() {
  const qc = useQueryClient();
  const sent = useQuery({ queryKey: ["tasks", "sent"], queryFn: () => api<TaskCardDTO[]>("/api/task-cards?box=sent") });

  useEffect(() => {
    void api("/api/task-cards/sent/seen", { method: "POST" })
      .then(() => qc.invalidateQueries({ queryKey: ["my-cards-summary"] }))
      .catch(() => undefined);
  }, [qc]);

  async function remove(t: TaskCardDTO) {
    if (!window.confirm(`Delete this task for ${firstName(t.to.name)}?`)) return;
    try {
      await api(`/api/task-cards/${t.id}`, { method: "DELETE" });
    } finally {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    }
  }

  if (sent.error) return <p className="py-6 text-danger">{(sent.error as Error).message}</p>;
  if (!sent.data) return null;
  if (sent.data.length === 0) return <div className="card px-6 py-14 text-center text-text-2">You haven't sent any task cards.</div>;
  return (
    <ul className="card divide-y divide-border overflow-hidden">
      {sent.data.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">To {t.to.name}</p>
            <p className="line-clamp-2 text-sm text-text-2">{t.note}</p>
          </div>
          {t.status === "done" ? (
            <span className={`text-xs font-semibold text-ok ${t.isNew ? "rounded-md bg-ok-soft px-1.5 py-0.5" : ""}`}>
              {`Done ✓ · ${firstName(t.to.name)} · ${taskTime(t.doneAt ?? t.createdAt)}`}
            </span>
          ) : (
            <>
              <span className="text-xs font-semibold text-text-2">Open</span>
              <button type="button" className="btn-ghost text-xs" onClick={() => void remove(t)}>
                Delete
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
