import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AREA_LABEL } from "../../shared/cards";
import { STAGE_STATUS } from "../../shared/handoff";
import type { AssigneeDTO, BoardDTO, CardDTO, CardEventDTO } from "../../shared/types";
import { api, withQuery } from "../api";
import { useAuth } from "../auth";
import { AreaChip } from "./AreaChip";

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
  c.status === "done"
    ? "Done ✓"
    : c.status === "waiting"
      ? c.handoff
        ? "Sent back"
        : "Pending"
      : c.returned
        ? "Returned"
        : c.stage
          ? STAGE_STATUS[c.stage]
          : "Active";

/** Managers: every card of the docket with its state. Admins can reopen a finished one. */
export function DocketProduction({ workOrder }: { workOrder: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restore = useMutation({
    mutationFn: (id: number) => api<CardDTO>(`/api/cards/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      setRestoreError(null);
      void qc.invalidateQueries({ queryKey: ["board"] });
      void qc.invalidateQueries({ queryKey: ["history", workOrder] });
    },
    onError: (e) => setRestoreError((e as Error).message),
  });
  const { data, isPending, error } = useQuery({
    queryKey: ["board", "wo", workOrder],
    queryFn: () => api<BoardDTO>(withQuery("/api/production-board", { wo: workOrder })),
  });
  // Installer photos live in one Drive folder per docket.
  const photos = useQuery({
    queryKey: ["docket-photos", workOrder],
    queryFn: () => api<{ count: number; folderLink: string | null }>(`/api/virtual-dockets/${encodeURIComponent(workOrder)}/photos`),
    retry: false,
  });
  const people = useQuery({ queryKey: ["assignees"], queryFn: () => api<AssigneeDTO[]>("/api/assignees"), staleTime: 60_000 });
  if (error) return <p className="py-4 text-danger">{(error as Error).message}</p>;
  if (isPending) return <p className="py-4 text-text-3">Loading…</p>;
  const names = new Map((people.data ?? []).map((p) => [p.id, p.fullName]));
  /** Whoever started the card, else the team or people it was sent to. */
  const who = (c: CardDTO) => c.claimedBy?.name ?? c.teamName ?? c.assigneeIds.map((id) => names.get(id)).filter(Boolean).join(", ");
  const cards = data.columns.flatMap((c) => c.cards);
  if (cards.length === 0) return <p className="py-4 text-text-2">No production route yet.</p>;
  const jobs = [...new Set(cards.map((c) => c.jobName))];
  return (
    <div className="mt-4 space-y-4">
      {restoreError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2 text-sm font-medium text-danger">
          {restoreError}
        </p>
      )}
      {photos.data && photos.data.count > 0 && photos.data.folderLink && (
        <a href={photos.data.folderLink} target="_blank" rel="noreferrer" className="btn-ghost text-sm">
          Photos ({photos.data.count})
        </a>
      )}
      {jobs.map((job) => (
        <section key={job}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-3">{job}</h3>
          <ol className="space-y-1.5">
            {cards
              .filter((c) => c.jobName === job)
              .sort((a, b) => a.step - b.step)
              .map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <AreaChip roleId={c.roleId} size="md" />
                    {who(c) && <span className="truncate text-[13px] font-semibold text-text-2">{who(c)}</span>}
                  </span>
                  <span className={`text-xs font-bold ${c.returned ? "text-danger" : c.status === "done" ? "text-ok" : "text-text-2"}`}>
                    {STEP_STATUS(c)}
                  </span>
                  {user?.accessLevel === "admin" && c.status === "done" && (
                    <button
                      type="button"
                      className="btn-ghost min-h-9 px-3 text-xs"
                      aria-label={`Restore ${AREA_LABEL[c.roleId] ?? c.roleId} card`}
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(c.id)}
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
