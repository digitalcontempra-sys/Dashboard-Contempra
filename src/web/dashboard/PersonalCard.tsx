import { Link, type To } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";

/**
 * One personal card of the dashboard header: a soft veil in its hue, the whole card is a link.
 * Phone: a compact row (number left). Wider: title on top, big number, detail line.
 */
export function PersonalCard({
  title,
  icon,
  hue,
  value,
  detail,
  to,
  onClick,
}: {
  title: string;
  icon: IconName;
  hue: "amber" | "red" | "blue";
  /** null while loading or on error: shows a dash. */
  value: number | null;
  detail: string;
  to: To;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      data-hue={hue}
      data-calm={value === 0 ? "true" : undefined}
      className="veil grid min-h-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 px-4 py-3 sm:flex sm:flex-col sm:items-stretch sm:gap-1 sm:px-5 sm:py-4"
    >
      <span className="row-span-2 text-[34px] leading-none font-bold tracking-tight tabular-nums text-[var(--veil-num)] sm:order-2 sm:mt-2 sm:text-[48px]">
        {value ?? "–"}
      </span>
      <span className="flex min-w-0 items-start gap-2 text-[15px] leading-snug font-semibold text-[var(--veil-title)] sm:order-1 sm:text-[16px]">
        <Icon name={icon} className="mt-0.5 size-[18px] shrink-0" />
        <span className="min-w-0">{title}</span>
      </span>
      <span className="min-w-0 text-[13px] leading-snug font-medium text-[var(--veil-detail)] sm:order-3 sm:mt-auto sm:text-[14px]">{detail}</span>
    </Link>
  );
}
