import type { DocketSummary } from "../../shared/types";
import { BUCKET_TONE, dueLabel } from "../format";
import { BucketTag } from "./BucketChip";

const STATUS_LABEL: Record<DocketSummary["status"], string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

type Item = DocketSummary & { ageDays?: number | null };

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

function DocketTile({ d, onOpen, extra, showStatus }: { d: Item; onOpen: (wo: string) => void; extra?: (d: Item) => React.ReactNode; showStatus?: boolean }) {
  const live = d.status === "active" || d.status === "on_hold";
  const tone = d.overdue ? "bg-danger" : `${BUCKET_TONE[d.bucket].fg} bg-current`;
  return (
    <button
      type="button"
      onClick={() => onOpen(d.workOrder)}
      className="tile group"
      aria-label={`Work order ${d.workOrder}, ${d.customer ?? "no customer"}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-tight text-text-3 tabular-nums">#{d.workOrder}</span>
        {d.accountManager && (
          <span className="rounded-md bg-surface-2 px-1.5 py-px text-[10px] font-bold text-text-2" title="Account Manager">
            {d.accountManager}
          </span>
        )}
        {live && <span className={`ml-auto size-2 shrink-0 rounded-full ${tone}`} aria-hidden="true" />}
        {showStatus && !live && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-text-3">{STATUS_LABEL[d.status]}</span>
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-semibold tracking-tight">{d.customer ?? "—"}</p>
      <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-text-2 sm:line-clamp-3">{d.project ?? ""}</p>

      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tabular-nums">{dueLabel(d.dueIso, d.dueRaw)}</p>
          {extra?.(d)}
        </div>
        {live && <BucketTag bucket={d.bucket} overdue={d.overdue} />}
      </div>
    </button>
  );
}

export function DocketList({
  items,
  onOpen,
  extra,
  showStatus,
}: {
  items: Item[];
  onOpen: (wo: string) => void;
  extra?: (d: Item) => React.ReactNode;
  showStatus?: boolean;
}) {
  return (
    <ul className={GRID}>
      {items.map((d) => (
        <li key={d.workOrder}>
          <DocketTile d={d} onOpen={onOpen} extra={extra} showStatus={showStatus} />
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="card px-6 py-14 text-center text-text-2">{text}</div>;
}

export function ListSkeleton() {
  return (
    <div className={GRID} aria-label="Loading" role="status">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="glass flex aspect-square flex-col gap-3 rounded-[var(--radius-tile)] p-4">
          <div className="h-3 w-16 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
          <div className="mt-auto h-4 w-12 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
