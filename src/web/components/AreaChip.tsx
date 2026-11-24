import { AREA_LABEL, AREA_TOKEN, ROLE_ORDER } from "../../shared/cards";
import type { Holder } from "../../shared/types";

/** var(--area-…) for a role id, for borders and dots. */
export const areaColor = (roleId: string) => `var(--${AREA_TOKEN[roleId] ?? "text-3"})`;

/** The area's name on its own color: the same everywhere, so each area is recognized at a glance. */
export function AreaChip({ roleId, size = "sm" }: { roleId: string; size?: "sm" | "md" }) {
  const color = areaColor(roleId);
  return (
    <span
      data-area={roleId}
      className={`inline-flex shrink-0 items-center rounded-md font-bold whitespace-nowrap ${
        size === "md" ? "px-2 py-0.5 text-[12px]" : "px-1.5 py-px text-[10.5px]"
      }`}
      style={{
        color: `var(--${AREA_TOKEN[roleId] ?? "text-3"}-ink, ${color})`,
        background: `color-mix(in srgb, ${color} calc(var(--area-soft-alpha) * 100%), transparent)`,
      }}
    >
      {AREA_LABEL[roleId] ?? roleId}
    </span>
  );
}

/** Who has the docket now: each area's chip followed by the people working on it there. */
export function HolderList({ holders, size = "sm", label }: { holders: Holder[]; size?: "sm" | "md"; label?: string }) {
  return (
    <div aria-label={label} className={`flex flex-wrap items-center ${size === "md" ? "gap-x-3 gap-y-1.5" : "gap-x-2 gap-y-1"}`}>
      {holders.map((h) => (
        <span key={h.roleId} className="inline-flex min-w-0 items-center gap-1">
          <AreaChip roleId={h.roleId} size={size} />
          {h.names.length > 0 && (
            <span className={`truncate font-semibold text-text-2 ${size === "md" ? "text-[13px]" : "text-[11px]"}`}>{h.names.join(", ")}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/** Which color is which area (Main Dashboard). */
export function AreaLegend() {
  return (
    <section aria-label="Areas" className="min-w-0">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">Areas</h2>
      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] md:flex-wrap md:justify-end md:overflow-visible">
        {ROLE_ORDER.map((r) => (
          <AreaChip key={r} roleId={r} />
        ))}
      </div>
    </section>
  );
}
