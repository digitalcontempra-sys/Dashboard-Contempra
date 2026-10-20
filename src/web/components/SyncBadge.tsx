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
  if (data.configured === false) {
    return (
      <div
        role="status"
        data-tone="neutral"
        className="inline-flex items-center gap-2 rounded-full bg-nodate-soft px-3 py-1 text-xs font-medium text-nodate"
        title="Data was loaded from an export. Live sync starts once the Google Sheet is connected."
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        <span>Google Sheet not connected</span>
      </div>
    );
  }
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
      <span>{syncedLabel(mins)}</span>
      {data.lastError && (
        <>
          <span aria-hidden="true">·</span>
          <span>Sync problem — showing last saved data</span>
        </>
      )}
    </div>
  );
}
