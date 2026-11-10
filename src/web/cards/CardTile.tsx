import { AREA_LABEL } from "../../shared/cards";
import type { CardDTO } from "../../shared/types";
import { useAuth } from "../auth";
import { AreaChip, areaColor } from "../components/AreaChip";
import { BucketTag } from "../components/BucketChip";

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Square card tile: NEW glow, red returned strip, who is on it, dimmed when waiting. */
export function CardTile({ card, onOpen, noMembers }: { card: CardDTO; onOpen: () => void; noMembers?: boolean }) {
  const { user } = useAuth();
  const waiting = card.status === "waiting";
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ borderLeftColor: areaColor(card.roleId) }}
      className={`tile group border-l-4 ${card.isNew ? "ring-2 ring-accent shadow-[0_0_24px_var(--accent-soft)]" : ""} ${waiting ? "opacity-60" : ""}`}
      aria-label={`${AREA_LABEL[card.roleId]} card, work order ${card.workOrder}, ${card.header.customer ?? "no customer"}${card.isNew ? ", new" : ""}`}
    >
      {card.returned && (
        <span className="absolute inset-x-0 top-0 truncate bg-danger px-3 py-1 text-[11px] font-bold text-white">
          Returned by {card.returned.by} · {card.returned.reason}
        </span>
      )}
      <div className={`flex items-center gap-1.5 ${card.returned ? "mt-5" : ""}`}>
        <span className="font-mono text-[11px] font-semibold text-text-3 tabular-nums">#{card.workOrder}</span>
        {card.isNew && <span className="rounded-md bg-accent px-1.5 py-px text-[10px] font-black text-accent-ink">NEW</span>}
        <span className="ml-auto">
          <AreaChip roleId={card.roleId} />
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[15px] font-bold leading-tight">{card.header.customer ?? "—"}</p>
      <p className="mt-1 line-clamp-2 text-[13px] text-text-2">{card.jobName}</p>
      <div className="mt-auto flex flex-col items-start gap-1">
        {waiting ? (
          <span className="text-[11px] font-semibold text-text-3">Up next</span>
        ) : (
          <BucketTag bucket={card.header.bucket} />
        )}
        {card.claimedBy && (
          <span className="text-[11px] text-text-2">
            {card.claimedBy.id === user?.id ? "You're on it" : `${firstName(card.claimedBy.name)} is working on it`}
          </span>
        )}
        {noMembers && <span className="text-[11px] font-semibold text-warn">No one has this role</span>}
      </div>
    </button>
  );
}
