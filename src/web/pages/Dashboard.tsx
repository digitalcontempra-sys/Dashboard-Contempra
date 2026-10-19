import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { TimeBucket } from "../../shared/rules";
import type { DocketListResponse, DocketView, HistoryFilter } from "../../shared/types";
import { api, withQuery } from "../api";
import { BucketFilter } from "../components/BucketChip";
import { DocketDetail } from "../components/DocketDetail";
import { DocketList, EmptyState, ListSkeleton } from "../components/DocketList";
import { AccountManagerSelect, SearchBox, Tabs } from "../components/Filters";
import { PageHeader } from "../components/Layout";
import { SyncBadge } from "../components/SyncBadge";
import { useParam } from "../hooks";

const VIEWS: { id: DocketView; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "on_hold", label: "On Hold" },
  { id: "history", label: "History" },
];
const HISTORY: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

export function Dashboard() {
  const [view, setView] = useParam("view");
  const [history, setHistory] = useParam("history");
  const [bucket, setBucket] = useParam("bucket");
  const [am, setAm] = useParam("am");
  const [q, setQ] = useParam("q");
  const [open, setOpen] = useState<string | null>(null);

  const v = (view || "active") as DocketView;
  const h = (history || "all") as HistoryFilter;
  const isHistory = v === "history";
  const params = { view: v, history: isHistory ? h : undefined, bucket: isHistory ? undefined : bucket, am, q };

  const list = useInfiniteQuery({
    queryKey: ["dockets", params],
    queryFn: ({ pageParam }) => api<DocketListResponse>(withQuery("/api/dockets", { ...params, page: pageParam })),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    refetchInterval: 30_000,
  });

  const first = list.data?.pages[0];
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Main Dashboard" subtitle={first ? `${first.total} work orders` : undefined} actions={<SyncBadge />} />
      <div className="space-y-3 px-4 md:px-8">
        <div className="max-w-md">
          <Tabs
            label="View"
            tabs={VIEWS}
            value={v}
            onChange={(id) => {
              setView(id === "active" ? null : id);
              setBucket(null);
            }}
          />
        </div>
        {isHistory ? (
          <div className="max-w-sm">
            <Tabs label="History filter" tabs={HISTORY} value={h} onChange={(id) => setHistory(id === "all" ? null : id)} />
          </div>
        ) : (
          <BucketFilter value={(bucket || null) as TimeBucket | null} counts={first?.counts} onChange={(b) => setBucket(b)} />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox value={q} onChange={(t) => setQ(t || null)} />
          <AccountManagerSelect value={am} onChange={(a) => setAm(a || null)} />
        </div>

        {list.isPending ? (
          <ListSkeleton />
        ) : list.error ? (
          <EmptyState text={(list.error as Error).message} />
        ) : items.length === 0 ? (
          <EmptyState text="No work orders match these filters." />
        ) : (
          <>
            <DocketList items={items} onOpen={setOpen} showStatus={isHistory} />
            {list.hasNextPage && (
              <div className="flex justify-center pt-2">
                <button className="btn-ghost" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {open && <DocketDetail workOrder={open} onClose={() => setOpen(null)} />}
    </>
  );
}
