import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { AREA_LABEL, AREA_TOKEN, ROLE_ORDER } from "../../shared/cards";
import { areaColor } from "../components/AreaChip";
import { Icon } from "../components/Icon";

const OPEN_KEY = "dashboard.areasOpen";
const TITLE = "Areas · Open board";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Tertiary menu: one button per production area with its open cards, opening the Production Board
 * on that column. Also the color legend. On a phone it folds away (closed by default, remembered).
 */
export function AreaMenu({ counts }: { counts?: { roleId: string; count: number }[] }) {
  const [open, setOpen] = useState(readOpen);
  const listId = useId();
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      // Blocked storage: the choice lasts for this visit only.
    }
  };
  const byArea = new Map(counts?.map((a) => [a.roleId, a.count]));
  return (
    <section aria-label={TITLE} className="glass h-full rounded-[20px] p-3 md:p-4">
      <h2 className="mb-2.5 hidden text-[12px] font-semibold tracking-wider text-text-3 uppercase md:block">{TITLE}</h2>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        className="flex min-h-9 w-full items-center justify-between rounded-[10px] px-1 text-[12px] font-semibold tracking-wider text-text-3 uppercase md:hidden"
      >
        {TITLE}
        <Icon name="chevron" className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <ul id={listId} className={`${open ? "grid" : "hidden"} mt-2 grid-cols-2 gap-1.5 sm:grid-cols-3 md:mt-0 md:grid md:grid-cols-6 min-[1400px]:grid-cols-3`}>
        {ROLE_ORDER.map((roleId) => {
          const color = areaColor(roleId);
          const count = byArea.get(roleId);
          return (
            <li key={roleId} className="min-w-0">
              <Link
                to={`/production?area=${roleId}`}
                data-area={roleId}
                title={`${AREA_LABEL[roleId]}: open the Production Board`}
                className="flex min-h-9 items-center justify-between gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold transition-[filter,transform] duration-200 hover:brightness-95 active:scale-[0.98] dark:hover:brightness-125"
                style={{
                  color: `var(--${AREA_TOKEN[roleId]}-ink, ${color})`,
                  background: `color-mix(in srgb, ${color} calc(var(--area-soft-alpha) * 100%), transparent)`,
                }}
              >
                <span className="truncate">{AREA_LABEL[roleId]}</span>
                <span className="shrink-0 font-bold tabular-nums">{count ?? "–"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
