import type { TimeBucket } from "../../shared/rules";
import { BUCKET_TONE, BUCKETS } from "../format";

export function BucketTag({ bucket, overdue }: { bucket: TimeBucket; overdue?: boolean }) {
  if (overdue) {
    return <span className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-bold uppercase text-danger">Overdue</span>;
  }
  const t = BUCKET_TONE[bucket];
  const label = BUCKETS.find((b) => b.id === bucket)!.label;
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${t.bg} ${t.fg}`}>{label}</span>;
}

export function BucketFilter({
  value,
  counts,
  onChange,
}: {
  value: TimeBucket | null;
  counts?: Record<TimeBucket, number>;
  onChange: (b: TimeBucket | null) => void;
}) {
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  const chip = (active: boolean, tone?: string) =>
    `flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${
      active ? `border-transparent ${tone ?? "bg-text text-bg"}` : "border-border bg-surface text-text-2 hover:text-text"
    }`;
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
      <button
        type="button"
        aria-pressed={value === null}
        aria-label={total === undefined ? "All" : `All (${total})`}
        className={chip(value === null)}
        onClick={() => onChange(null)}
      >
        All {total !== undefined && <span className="tabular-nums opacity-70">{total}</span>}
      </button>
      {BUCKETS.map((b) => {
        const n = counts?.[b.id];
        const t = BUCKET_TONE[b.id];
        return (
          <button
            key={b.id}
            type="button"
            aria-pressed={value === b.id}
            aria-label={n === undefined ? b.label : `${b.label} (${n})`}
            className={chip(value === b.id, `${t.bg} ${t.fg}`)}
            onClick={() => onChange(value === b.id ? null : b.id)}
          >
            <span className={`size-2 rounded-full ${t.fg} bg-current`} aria-hidden="true" />
            {b.label}
            {n !== undefined && <span className="tabular-nums opacity-70">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
