import { useQuery } from "@tanstack/react-query";
import type { SyncStatus } from "../../shared/types";
import { api } from "../api";
import { minutesSince, syncedLabel } from "../format";

const STALE_MINUTES = 5;

export function useSyncStatus() {
  return useQuery({
    queryKey: ["sync-status"],
    queryFn: () => api<SyncStatus>("/api/sync/status"),
    refetchInterval: 30_000,
  });
}

export function SyncBadge() {
  const { data } = useSyncStatus();
  if (!data) return null;
  const mins = minutesSince(data.lastSuccessAt);
  const tone = data.lastError ? "danger" : mins == null || mins > STALE_MINUTES ? "warn" : "ok";
  const styles = {
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <div
      role="status"
      data-tone={tone}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${styles}`}
      title={data.lastError ?? undefined}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {data.lastError ? <span>Sync problem — showing last saved data</span> : <span>{syncedLabel(mins)}</span>}
    </div>
  );
}
