import type { DocketSummary } from "../../shared/types";
import { dueLabel } from "../format";
import { BucketTag } from "./BucketChip";
import { Icon } from "./Icon";

const STATUS_LABEL: Record<DocketSummary["status"], string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function DocketList({
  items,
  onOpen,
  extra,
  showStatus,
}: {
  items: (DocketSummary & { ageDays?: number | null })[];
  onOpen: (wo: string) => void;
  extra?: (d: DocketSummary & { ageDays?: number | null }) => React.ReactNode;
  showStatus?: boolean;
}) {
  return (
    <ul className="card divide-y divide-border overflow-hidden">
      {items.map((d) => (
        <li key={d.workOrder}>
          <button
            type="button"
            onClick={() => onOpen(d.workOrder)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-text-3 tabular-nums">#{d.workOrder}</span>
                {d.accountManager && (
                  <span
                    className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold text-text-2"
                    title="Account Manager"
                  >
                    {d.accountManager}
                  </span>
                )}
                {showStatus && d.status !== "active" && (
                  <span className="text-[11px] font-semibold uppercase text-text-3">{STATUS_LABEL[d.status]}</span>
                )}
              </div>
              <p className="mt-0.5 truncate font-semibold">{d.customer ?? "—"}</p>
              <p className="truncate text-sm text-text-2">{d.project ?? ""}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-right">
              <span className="text-sm font-semibold tabular-nums">{dueLabel(d.dueIso, d.dueRaw)}</span>
              {d.status === "active" || d.status === "on_hold" ? <BucketTag bucket={d.bucket} overdue={d.overdue} /> : null}
              {extra?.(d)}
            </div>
            <Icon name="chevron" className="size-4 shrink-0 text-text-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="card px-6 py-12 text-center text-text-2">{text}</div>;
}

export function ListSkeleton() {
  return (
    <div className="card divide-y divide-border" aria-label="Loading" role="status">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-3 px-4 py-4">
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-48 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="h-4 w-12 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
