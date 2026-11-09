import { useQuery } from "@tanstack/react-query";
import type { BoardDTO, CardDTO, CardEventDTO } from "../../shared/types";
import { AREA_LABEL } from "../../shared/cards";
import { api, withQuery } from "../api";

/** Some ICU versions put a narrow no-break space before AM/PM. */
const NARROW_SPACE = new RegExp(String.fromCharCode(0x202f), "g");
const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Winnipeg",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Managers: the docket's journey through the areas, oldest first. */
export function DocketHistory({ workOrder }: { workOrder: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["history", workOrder],
    queryFn: () => api<CardEventDTO[]>(`/api/virtual-dockets/${encodeURIComponent(workOrder)}/history`),
  });
  if (error) return <p className="py-4 text-danger">{(error as Error).message}</p>;
  if (isPending) return <p className="py-4 text-text-3">Loading…</p>;
  if (data.length === 0) return <p className="py-4 text-text-2">No production history yet.</p>;
  return (
    <ol aria-label="History" className="mt-4 space-y-1.5 border-l-2 border-border pl-4">
      {data.map((e, i) => (
        <li key={i} className={`text-sm ${e.action === "sent_back" ? "font-semibold text-danger" : ""}`}>
          {TIME.format(new Date(e.at)).replace(NARROW_SPACE, " ")} · {e.area} · {e.user ?? "—"} · {e.detail}
        </li>
      ))}
    </ol>
  );
}

const STEP_STATUS = (c: CardDTO) =>
  c.status === "done" ? "Done ✓" : c.status === "waiting" ? "Pending" : c.returned ? "Returned" : "Active";

/** Managers: each job's route with the state of every step. */
export function DocketProduction({ workOrder }: { workOrder: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["board", "wo", workOrder],
    queryFn: () => api<BoardDTO>(withQuery("/api/production-board", { wo: workOrder })),
  });
  if (error) return <p className="py-4 text-danger">{(error as Error).message}</p>;
  if (isPending) return <p className="py-4 text-text-3">Loading…</p>;
  const cards = data.columns.flatMap((c) => c.cards);
  if (cards.length === 0) return <p className="py-4 text-text-2">No production route yet.</p>;
  const jobs = [...new Set(cards.map((c) => c.jobName))];
  return (
    <div className="mt-4 space-y-4">
      {jobs.map((job) => (
        <section key={job}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-3">{job}</h3>
          <ol className="space-y-1.5">
            {cards
              .filter((c) => c.jobName === job)
              .sort((a, b) => a.step - b.step)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
                  <span className="flex-1 text-sm font-semibold">{AREA_LABEL[c.roleId]}</span>
                  <span className={`text-xs font-bold ${c.returned ? "text-danger" : c.status === "done" ? "text-ok" : "text-text-2"}`}>
                    {STEP_STATUS(c)}
                  </span>
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
