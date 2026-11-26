import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { DASH_SECTIONS, type DashSection } from "../../shared/rules";
import { SECTIONS } from "../format";
import type { DocketListResponse, DocketView, HistoryFilter } from "../../shared/types";
import { api, withQuery } from "../api";
import { useAuth } from "../auth";
import { BucketFilter } from "../components/BucketChip";
import { DocketDetail } from "../components/DocketDetail";
import { DocketList, EmptyState, ListSkeleton } from "../components/DocketList";
import { AccountManagerSelect, SearchBox, Tabs } from "../components/Filters";
import type { SegmentItem } from "../components/Segmented";
import { AreaLegend } from "../components/AreaChip";
import { NewTaskCardButton } from "../tasks/NewTaskCard";
import { PageHeader } from "../components/Layout";
import { SyncBadge } from "../components/SyncBadge";
import { useParam, useSetParams } from "../hooks";

const VIEWS: SegmentItem<DocketView>[] = [
  { id: "active", label: "Active", icon: "activity" },
  { id: "on_hold", label: "On Hold", icon: "pause" },
  { id: "history", label: "History", icon: "history" },
];
type Scope = "all" | "mine" | "list";
const SCOPES: SegmentItem<Scope>[] = [
  { id: "all", label: "All dockets", icon: "layers" },
  { id: "mine", label: "My Dockets", icon: "user" },
  { id: "list", label: "My List", icon: "bookmark" },
];
const scopeKey = (userId: number | undefined) => `dashboard.scope.${userId ?? "anon"}`;

/** All dockets | My Dockets | My List, remembered per user on this device. */
function useScope(userId: number | undefined): [Scope, (s: Scope) => void] {
  const [scope, setScope] = useState<Scope>(() => {
    try {
      const saved = localStorage.getItem(scopeKey(userId));
      return saved === "mine" || saved === "list" ? saved : "all";
    } catch {
      return "all";
    }
  });
  const change = (s: Scope) => {
    setScope(s);
    try {
      localStorage.setItem(scopeKey(userId), s);
    } catch {
      // Private mode or blocked storage: the choice lasts for this visit only.
    }
  };
  return [scope, change];
}

const HISTORY: SegmentItem<HistoryFilter>[] = [
  { id: "all", label: "All", icon: "layers" },
  { id: "completed", label: "Completed", icon: "check" },
  { id: "cancelled", label: "Cancelled", icon: "ban" },
];

export function Dashboard() {
  const [view] = useParam("view");
  const [history, setHistory] = useParam("history");
  const [bucket, setBucket] = useParam("bucket");
  const [am, setAm] = useParam("am");
  const [q, setQ] = useParam("q");
  const setParams = useSetParams();
  const { user } = useAuth();
  const [scope, setScope] = useScope(user?.id);
  // My Dockets = dockets whose Account Manager (sheet J) is one of my codes.
  const noCodes = scope === "mine" && !user?.codes?.length;
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

  const navigate = useNavigate();
  const v = (view || "active") as DocketView;
  // An old or unknown section in the URL (e.g. "coming") shows All.
  const section = DASH_SECTIONS.includes(bucket as DashSection) ? (bucket as DashSection) : undefined;
  const h = (history || "all") as HistoryFilter;
  const isHistory = v === "history";
  const params = { view: v, history: isHistory ? h : undefined, bucket: isHistory ? undefined : section, am, q, mine: scope === "mine" ? "1" : undefined, list: scope === "list" ? "1" : undefined };

  const list = useInfiniteQuery({
    queryKey: ["dockets", params],
    queryFn: ({ pageParam }) => api<DocketListResponse>(withQuery("/api/dockets", { ...params, page: pageParam })),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    refetchInterval: 30_000,
    enabled: !noCodes,
  });

  const first = list.data?.pages[0];
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Main Dashboard" subtitle={first && !noCodes ? `${first.total} work orders` : undefined} actions={
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
          <Tabs label="Whose dockets" tone="brand" tabs={SCOPES} value={scope} onChange={setScope} />
        </div>
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
          <BucketFilter options={SECTIONS} value={section ?? null} counts={first?.counts} onChange={(b) => setBucket(b)} />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox value={q} onChange={(t) => setQ(t || null)} />
          <AccountManagerSelect value={am} onChange={(a) => setAm(a || null)} />
        </div>

        {noCodes ? (
          <EmptyState text="Ask an admin to set your initials." />
        ) : list.isPending ? (
          <ListSkeleton />
        ) : list.error ? (
          <EmptyState text={(list.error as Error).message} />
        ) : items.length === 0 ? (
          <EmptyState
            text={
              scope === "list" && !q && !am && !section && !isHistory
                ? "Your list is empty. Tap the bookmark on a docket to add it."
                : "No work orders match these filters."
            }
          />
        ) : (
          <>
            <DocketList
              items={items}
              // A New Order is opened to be completed: straight to the editor.
              onOpen={(wo) => (!isHistory && items.find((i) => i.workOrder === wo)?.section === "new_orders" ? navigate(`/dockets/${wo}`) : setOpen(wo))}
              showStatus={isHistory}
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
