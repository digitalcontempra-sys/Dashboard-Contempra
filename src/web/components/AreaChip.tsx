import { AREA_LABEL, AREA_TOKEN, ROLE_ORDER } from "../../shared/cards";

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
      style={{ color, background: `color-mix(in srgb, ${color} calc(var(--area-soft-alpha) * 100%), transparent)` }}
    >
      {AREA_LABEL[roleId] ?? roleId}
    </span>
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
