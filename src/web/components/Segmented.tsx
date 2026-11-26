import { useRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "./Icon";

export type SegmentItem<T> = { id: T; label: string; icon?: IconName; count?: number };

/**
 * One segmented control for the whole app. The active segment is a solid pill
 * (tone "brand" = Contempra red, "ink" = the "All" chip's color); idle segments are grey text.
 * Colors come from the --seg-* tokens in index.css and follow aria-selected.
 */
export function Segmented<T extends string | null>({
  items,
  value,
  onChange,
  label,
  tone = "ink",
  wrap = false,
  compact = false,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  tone?: "brand" | "ink";
  /** Many segments: wrap onto new lines instead of sharing one row (never scroll sideways). */
  wrap?: boolean;
  /** Long labels: icons only from the sm breakpoint, so phone labels are not cut. */
  compact?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : step ? (i + step + items.length) % items.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(items[to].id);
    refs.current[to]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      data-tone={tone}
      className={`glass flex gap-1 rounded-[16px] p-1 ${wrap ? "flex-wrap" : ""}`}
    >
      {items.map((it, i) => {
        const on = value === it.id;
        return (
          <button
            key={String(it.id)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={on}
            tabIndex={on || (i === 0 && !items.some((x) => x.id === value)) ? 0 : -1}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`seg ${wrap ? "shrink-0" : "min-w-0 flex-1"}`}
          >
            {it.icon && <Icon name={it.icon} className={`size-4 shrink-0 ${compact ? "max-sm:hidden" : ""}`} />}
            <span className={wrap ? "" : "truncate"}>{it.label}</span>
            {it.count !== undefined && <span className="tabular-nums opacity-80">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
