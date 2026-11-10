import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ROLE_LABEL, ROLE_ORDER } from "../../shared/cards";
import type { CardDTO, TaskCardDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { CardTile } from "../cards/CardTile";
import { CardView } from "../cards/CardView";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/Layout";
import { BUCKETS } from "../format";
import { NewTaskCardButton } from "../tasks/NewTaskCard";
import { SentList, TaskTile, TaskView } from "../tasks/TaskCards";

export const CARD_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

type Group = { label: string; cards: CardDTO[]; tasks: TaskCardDTO[] };

/** Returned first (red), then active cards and tasks by time group (tasks first), then Up next (waiting). */
export function groupCards(cards: CardDTO[], tasks: TaskCardDTO[] = []): Group[] {
  const active = cards.filter((c) => c.status === "active");
  const groups: Group[] = [
    { label: "Returned", cards: active.filter((c) => c.returned), tasks: [] },
    ...BUCKETS.map((b) => ({
      label: b.label,
      cards: active.filter((c) => !c.returned && c.header.bucket === b.id),
      tasks: tasks.filter((t) => t.bucket === b.id),
    })),
    { label: "Up next", cards: cards.filter((c) => c.status === "waiting"), tasks: [] },
  ];
  return groups.filter((g) => g.cards.length + g.tasks.length > 0);
}

type Show = "all" | "docket" | "task" | "sent";
const SHOW: { id: Show; label: string }[] = [
  { id: "all", label: "All" },
  { id: "docket", label: "Docket cards" },
  { id: "task", label: "Task cards" },
  { id: "sent", label: "Sent by me" },
];

function Tabs<T extends string | null>({ label, items, value, onChange }: { label: string; items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
      {items.map((it) => (
        <button
          key={String(it.id)}
          role="tab"
          type="button"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition ${
            value === it.id ? "border-transparent bg-text text-[var(--bg)]" : "border-border bg-surface text-text-2 shadow-card"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function MyCards() {
  const { user } = useAuth();
  const [show, setShow] = useState<Show>("all");
  const [role, setRole] = useState<string | null>(null);
  const [open, setOpen] = useState<CardDTO | null>(null);
  const [openTask, setOpenTask] = useState<TaskCardDTO | null>(null);
  const cards = useQuery({ queryKey: ["my-cards"], queryFn: () => api<CardDTO[]>("/api/my-cards") });
  const tasks = useQuery({ queryKey: ["tasks", "inbox"], queryFn: () => api<TaskCardDTO[]>("/api/task-cards?box=inbox") });

  const roles = ROLE_ORDER.filter((r) => user?.roles.includes(r));
  const shownCards = show === "task" ? [] : (cards.data ?? []).filter((c) => !role || c.roleId === role);
  const shownTasks = show === "docket" ? [] : (tasks.data ?? []);
  const groups = groupCards(shownCards, shownTasks);
  const error = cards.error ?? tasks.error;
  const loading = cards.isPending || tasks.isPending;

  return (
    <>
      <PageHeader title="My Cards" actions={<NewTaskCardButton />} />
      <div className="px-4 md:px-6">
        <Tabs label="Show" items={SHOW} value={show} onChange={setShow} />
        {roles.length > 1 && (show === "all" || show === "docket") && (
          <Tabs
            label="Roles"
            items={[{ id: null, label: "All" }, ...roles.map((r) => ({ id: r as string | null, label: ROLE_LABEL[r] }))]}
            value={role}
            onChange={setRole}
          />
        )}

        {show === "sent" ? (
          <SentList />
        ) : (
          <>
            {error && <p className="py-6 text-danger">{(error as Error).message}</p>}
            {!loading && !error && groups.length === 0 && (
              <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
                  <Icon name="cards" className="size-6" />
                </span>
                <p className="max-w-xs text-text-2">No cards right now.</p>
              </div>
            )}
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label} className="mb-6">
                <h2 className={`mb-2.5 text-xs font-semibold uppercase tracking-wide ${g.label === "Returned" ? "text-danger" : "text-text-3"}`}>
                  {g.label} <span className="tabular-nums">({g.cards.length + g.tasks.length})</span>
                </h2>
                <div className={CARD_GRID}>
                  {g.tasks.map((t) => (
                    <TaskTile key={`t${t.id}`} task={t} onOpen={() => setOpenTask(t)} />
                  ))}
                  {g.cards.map((c) => (
                    <CardTile key={c.id} card={c} onOpen={() => setOpen(c)} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
      {open && <CardView key={open.id} card={open} onClose={() => setOpen(null)} />}
      {openTask && <TaskView key={openTask.id} task={openTask} onClose={() => setOpenTask(null)} />}
    </>
  );
}
