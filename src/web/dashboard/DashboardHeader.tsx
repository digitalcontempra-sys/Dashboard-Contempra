import type { ReactNode } from "react";
import { overdueDetail, riskDetail, waitingDetail } from "../../shared/dashboard";
import type { DashboardSummary } from "../../shared/types";
import { AreaMenu } from "./AreaMenu";
import { Clock } from "./Clock";
import { PersonalCard } from "./PersonalCard";

/**
 * Main Dashboard header (owner's composition): clock + selectors, three personal cards, the areas menu,
 * then the section chips. Placement per width lives in `.dash-head` (index.css).
 */
export function DashboardHeader({
  summary,
  selectors,
  chips,
  onRisk,
}: {
  summary?: DashboardSummary;
  selectors: ReactNode;
  chips: ReactNode;
  /** At risk is about my dockets: the page switches to My Dockets as well. */
  onRisk?: () => void;
}) {
  const t = summary?.overdueTasks;
  const r = summary?.atRisk;
  const w = summary?.waiting;
  return (
    <div className="dash-head">
      <div data-slot="clock">
        <Clock />
      </div>
      <div data-slot="sel" className="flex flex-col gap-3">
        {selectors}
      </div>
      <section data-slot="cards" aria-label="For you" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PersonalCard
          title="Overdue task cards"
          icon="note"
          hue="amber"
          value={t ? t.count : null}
          detail={t ? overdueDetail(t) : " "}
          to="/my-cards?show=task"
        />
        <PersonalCard
          title="At risk"
          icon="alertSquare"
          hue="red"
          value={r ? r.overdue + r.dueToday : null}
          detail={r ? riskDetail(r) : " "}
          to={{ search: "?focus=risk" }}
          onClick={onRisk}
        />
        <PersonalCard
          title="Waiting on you"
          icon="squareCheck"
          hue="blue"
          value={w ? w.dockets : null}
          detail={w ? waitingDetail(w) : " "}
          to={{ search: "?focus=waiting" }}
        />
      </section>
      <div data-slot="areas">
        <AreaMenu counts={summary?.areas} />
      </div>
      <div data-slot="chips">{chips}</div>
    </div>
  );
}
