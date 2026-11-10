import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TASK_NOTE_MAX, type TaskDueKind } from "../../shared/taskCards";
import type { AssigneeDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const WHEN: { kind: TaskDueKind; label: string }[] = [
  { kind: "none", label: "No date" },
  { kind: "rush", label: "Rush" },
  { kind: "today", label: "Today" },
  { kind: "date", label: "Date" },
];

/** "New Task Card" button plus its form: a note for one person. */
export function NewTaskCardButton({ className = "btn-ghost" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  useEffect(() => {
    if (!sentTo) return;
    const t = setTimeout(() => setSentTo(null), 4000);
    return () => clearTimeout(t);
  }, [sentTo]);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon name="plus" className="size-4" />
        New Task Card
      </button>
      {sentTo && (
        <p role="status" className="text-sm font-medium text-ok">
          Task sent to {sentTo}
        </p>
      )}
      {open && (
        <NewTaskCardDialog
          onClose={() => setOpen(false)}
          onSent={(name) => {
            setOpen(false);
            setSentTo(firstName(name));
          }}
        />
      )}
    </>
  );
}

function NewTaskCardDialog({ onClose, onSent }: { onClose: () => void; onSent: (name: string) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const people = useQuery({ queryKey: ["assignees"], queryFn: () => api<AssigneeDTO[]>("/api/assignees"), staleTime: 60_000 });
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<AssigneeDTO | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<TaskDueKind>("none");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Once per open dialog: a refresh behind it must not move the cursor while someone types.
  useEffect(() => {
    toRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (people.data ?? []).filter((p) => p.id !== user?.id && (!q || p.fullName.toLowerCase().includes(q)));
  const ready = to !== null && note.trim().length > 0 && (kind !== "date" || date !== "");

  async function send() {
    if (!to) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/task-cards", {
        method: "POST",
        json: { toUserId: to.id, note: note.trim(), due: kind === "date" ? { kind, date } : { kind } },
      });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      onSent(to.fullName);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <div className="animate-fade-in absolute inset-0 bg-black/25 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="New Task Card"
        className="glass-strong animate-sheet-in relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[var(--radius-panel)] p-5 sm:max-w-md sm:rounded-[var(--radius-panel)]"
      >
        <h2 className="mb-4 text-lg font-bold">New Task Card</h2>

        <label htmlFor="task-to" className="mb-1 block text-[13px] font-medium text-text-2">
          To
        </label>
        {to ? (
          <div className="flex min-h-11 items-center justify-between rounded-[var(--radius-control)] bg-surface-2 px-3">
            <span className="font-semibold">{to.fullName}</span>
            <button type="button" className="text-sm text-accent" onClick={() => setTo(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              id="task-to"
              ref={toRef}
              className="field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="task-to-list"
            />
            <ul id="task-to-list" role="listbox" aria-label="People" className="mt-1 max-h-44 overflow-y-auto rounded-xl bg-surface-2">
              {matches.map((p) => (
                <li
                  key={p.id}
                  role="option"
                  aria-selected="false"
                  tabIndex={0}
                  className="flex min-h-11 cursor-pointer items-center px-3 text-sm hover:bg-surface-strong"
                  onClick={() => setTo(p)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setTo(p)}
                >
                  {p.fullName}
                </li>
              ))}
            </ul>
          </>
        )}

        <label htmlFor="task-note" className="mt-4 mb-1 block text-[13px] font-medium text-text-2">
          Note
        </label>
        <textarea
          id="task-note"
          className="field min-h-24 py-2"
          maxLength={TASK_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div role="radiogroup" aria-label="When" className="mt-4">
          <p className="mb-1.5 text-[13px] font-medium text-text-2">When</p>
          <div className="flex flex-wrap gap-2">
            {WHEN.map((w) => (
              <label
                key={w.kind}
                className={`flex min-h-11 cursor-pointer items-center rounded-xl border px-3.5 text-sm font-semibold ${
                  kind === w.kind ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface"
                }`}
              >
                <input type="radio" name="task-when" className="sr-only" checked={kind === w.kind} onChange={() => setKind(w.kind)} />
                {w.label}
              </label>
            ))}
          </div>
          {kind === "date" && (
            <input type="date" aria-label="Due date" className="field mt-2" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!ready || busy} onClick={() => void send()}>
            Send
          </button>
        </div>
      </section>
    </div>
  );
}
