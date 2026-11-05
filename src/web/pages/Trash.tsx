import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrashItem } from "../../shared/types";
import { api } from "../api";
import { EmptyState, ListSkeleton } from "../components/DocketList";
import { PageHeader } from "../components/Layout";

export function Trash() {
  const qc = useQueryClient();
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => api<TrashItem[]>("/api/trash") });
  const restore = useMutation({
    mutationFn: (wo: string) => api(`/api/virtual-dockets/${wo}/restore`, { method: "POST" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["dockets"] });
    },
  });

  return (
    <>
      <PageHeader title="Trash" subtitle="Deleted dockets are kept for 30 days, then removed for good" />
      <div className="space-y-3 px-4 md:px-6">
        {trash.isPending ? (
          <ListSkeleton />
        ) : trash.error ? (
          <EmptyState text={(trash.error as Error).message} />
        ) : trash.data.length === 0 ? (
          <EmptyState text="Trash is empty." />
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {trash.data.map((t) => (
              <li key={t.workOrder} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold text-text-3">#{t.workOrder}</p>
                  <p className="truncate font-semibold">{t.forName || "—"}</p>
                  <p className="text-xs text-text-3">
                    Deleted {new Date(t.deletedAt).toLocaleDateString("en-CA")}
                    {t.deletedBy ? ` by ${t.deletedBy}` : ""}
                  </p>
                </div>
                <span className={`text-xs font-semibold ${t.daysLeft <= 3 ? "text-danger" : "text-text-2"}`}>
                  {t.daysLeft} {t.daysLeft === 1 ? "day" : "days"} left
                </span>
                <button className="btn-ghost" disabled={restore.isPending} onClick={() => restore.mutate(t.workOrder)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
        {restore.error && <p className="text-sm text-danger">{(restore.error as Error).message}</p>}
      </div>
    </>
  );
}
