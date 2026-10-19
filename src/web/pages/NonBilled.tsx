import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { NonBilledItem, NonBilledTab, Page } from "../../shared/types";
import { api, withQuery } from "../api";
import { DocketDetail } from "../components/DocketDetail";
import { DocketList, EmptyState, ListSkeleton } from "../components/DocketList";
import { AccountManagerSelect, SearchBox, Tabs } from "../components/Filters";
import { PageHeader } from "../components/Layout";
import { useParam } from "../hooks";

const fetchPage = (tab: NonBilledTab, am: string, q: string, page: number) =>
  api<Page<NonBilledItem>>(withQuery("/api/non-billed", { tab, am, q, page }));

export function NonBilled() {
  const [tabParam, setTab] = useParam("tab");
  const [am, setAm] = useParam("am");
  const [q, setQ] = useParam("q");
  const [open, setOpen] = useState<string | null>(null);
  const tab = (tabParam || "ready") as NonBilledTab;
  const other: NonBilledTab = tab === "ready" ? "open" : "ready";

  const list = useInfiniteQuery({
    queryKey: ["non-billed", tab, am, q],
    queryFn: ({ pageParam }) => fetchPage(tab, am, q, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    refetchInterval: 60_000,
  });
  const otherCount = useQuery({
    queryKey: ["non-billed", other, am, q, "count"],
    queryFn: () => fetchPage(other, am, q, 1),
    select: (p) => p.total,
  });

  const total = list.data?.pages[0]?.total;
  const counts = { [tab]: total, [other]: otherCount.data } as Record<NonBilledTab, number | undefined>;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Non Billed Jobs" subtitle="Work orders with no invoice yet" />
      <div className="space-y-3 px-4 md:px-8">
        <div className="max-w-md">
          <Tabs
            label="Billing"
            value={tab}
            onChange={(t) => setTab(t === "ready" ? null : t)}
            tabs={[
              { id: "ready", label: "Ready to Bill", count: counts.ready },
              { id: "open", label: "Open – Not Billed", count: counts.open },
            ]}
          />
        </div>
        <p className="text-sm text-text-2">
          {tab === "ready"
            ? "Completed jobs that still need an invoice. Oldest first."
            : "Jobs in production or on hold that have not been invoiced yet."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox value={q} onChange={(t) => setQ(t || null)} />
          <AccountManagerSelect value={am} onChange={(a) => setAm(a || null)} />
        </div>
        {list.isPending ? (
          <ListSkeleton />
        ) : list.error ? (
          <EmptyState text={(list.error as Error).message} />
        ) : items.length === 0 ? (
          <EmptyState text={tab === "ready" ? "Everything completed has been billed." : "No open unbilled jobs."} />
        ) : (
          <>
            <DocketList
              items={items}
              onOpen={setOpen}
              showStatus
              extra={(d) =>
                d.ageDays != null ? (
                  <span className={`text-xs tabular-nums ${d.ageDays > 30 ? "font-semibold text-danger" : "text-text-3"}`}>
                    {d.ageDays} {d.ageDays === 1 ? "day" : "days"}
                  </span>
                ) : null
              }
            />
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
