import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ROLE_LABEL, ROLE_ORDER } from "../../shared/cards";
import type { CardDTO, TaskCardDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { CardTile } from "../cards/CardTile";
import { CardView } from "../cards/CardView";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/Layout";
import { Segmented, type SegmentItem } from "../components/Segmented";
import { BUCKETS } from "../format";
import { NewTaskCardButton } from "../tasks/NewTaskCard";
import { HistoryList, SentList, TaskTile, TaskView } from "../tasks/TaskCards";

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

type Show = "all" | "docket" | "task" | "sent" | "history";
const SHOW: SegmentItem<Show>[] = [
  { id: "all", label: "All", icon: "layers" },
  { id: "docket", label: "Docket cards", icon: "doc" },
  { id: "task", label: "Task cards", icon: "note" },
  { id: "sent", label: "Sent by me", icon: "send" },
  { id: "history", label: "History", icon: "history" },
];

function Tabs<T extends string | null>({ label, items, value, onChange }: { label: string; items: SegmentItem<T>[]; value: T; onChange: (v: T) => void }) {
  // Wraps instead of scrolling sideways, so every segment (History included) is visible on a phone.
  return (
    <div className="mb-3 w-fit max-w-full">
      <Segmented label={label} items={items} value={value} onChange={onChange} wrap />
    </div>
  );
}

export function MyCards() {
  const { user } = useAuth();
  // ?show=task opens on that filter (the dashboard's "Overdue task cards").
  const [params] = useSearchParams();
  const [show, setShow] = useState<Show>(() => SHOW.find((s) => s.id === params.get("show"))?.id ?? "all");
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
        ) : show === "history" ? (
          <HistoryList />
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
