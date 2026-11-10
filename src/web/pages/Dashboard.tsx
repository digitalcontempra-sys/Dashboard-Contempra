import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "../components/Icon";
import type { TimeBucket } from "../../shared/rules";
import type { DocketListResponse, DocketView, HistoryFilter } from "../../shared/types";
import { api, withQuery } from "../api";
import { BucketFilter } from "../components/BucketChip";
import { DocketDetail } from "../components/DocketDetail";
import { DocketList, EmptyState, ListSkeleton } from "../components/DocketList";
import { AccountManagerSelect, SearchBox, Tabs } from "../components/Filters";
import { AreaLegend } from "../components/AreaChip";
import { NewTaskCardButton } from "../tasks/NewTaskCard";
import { PageHeader } from "../components/Layout";
import { SyncBadge } from "../components/SyncBadge";
import { useParam, useSetParams } from "../hooks";

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
  const [view] = useParam("view");
  const [history, setHistory] = useParam("history");
  const [bucket, setBucket] = useParam("bucket");
  const [am, setAm] = useParam("am");
  const [q, setQ] = useParam("q");
  const setParams = useSetParams();
  const [open, setOpen] = useState<string | null>(null);
  // Set by the docket editor after Save: confirm it here, then fade out.
  const location = useLocation();
  const [saved, setSaved] = useState<string | null>((location.state as { savedWorkOrder?: string } | null)?.savedWorkOrder ?? null);
  useEffect(() => {
    if (!saved) return;
    window.history.replaceState({ ...window.history.state, usr: null }, "");
    const t = setTimeout(() => setSaved(null), 5000);
    return () => clearTimeout(t);
  }, [saved]);

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
      <PageHeader title="Main Dashboard" subtitle={first ? `${first.total} work orders` : undefined} actions={
          <div className="flex w-full flex-col items-stretch gap-3 md:w-auto md:items-end">
            <div className="flex items-center gap-3 md:justify-end">
              <SyncBadge />
              <Link to="/dockets/new" className="btn-primary">
                <Icon name="plus" className="size-4" />
                New Docket
              </Link>
            </div>
            <div className="flex flex-col items-stretch gap-1 md:items-end">
              <NewTaskCardButton />
            </div>
            <div className="md:max-w-sm">
              <AreaLegend />
            </div>
          </div>
        }
      />
      <div className="space-y-3 px-4 md:px-6">
        {saved && (
          <p role="status" className="animate-fade-in rounded-2xl bg-ok-soft px-4 py-2.5 text-sm font-semibold text-ok">
            Docket #{saved} saved.
          </p>
        )}
        <div className="max-w-md">
          <Tabs
            label="View"
            tabs={VIEWS}
            value={v}
            onChange={(id) => setParams({ view: id === "active" ? null : id, bucket: null, history: null })}
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
