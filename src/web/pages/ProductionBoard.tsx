import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AREA_LABEL, ROLE_ORDER } from "../../shared/cards";
import type { TimeBucket } from "../../shared/rules";
import type { AssigneeDTO, BoardDTO, CardDTO } from "../../shared/types";
import { api, withQuery } from "../api";
import { useAuth } from "../auth";
import { CardTile } from "../cards/CardTile";
import { CardView } from "../cards/CardView";
import { areaColor } from "../components/AreaChip";
import { BucketFilter } from "../components/BucketChip";
import { PageHeader } from "../components/Layout";

/** Managers: every active card, one column per area. */
export function ProductionBoard() {
  const { user } = useAuth();
  const [area, setArea] = useState("");
  const [person, setPerson] = useState("");
  const [bucket, setBucket] = useState<TimeBucket | null>(null);
  const [open, setOpen] = useState<CardDTO | null>(null);
  const people = useQuery({ queryKey: ["assignees"], queryFn: () => api<AssigneeDTO[]>("/api/assignees"), staleTime: 60_000 });
  const { data, error } = useQuery({
    queryKey: ["board", area, person, bucket],
    queryFn: () => api<BoardDTO>(withQuery("/api/production-board", { area, user: person, bucket })),
    refetchInterval: 20_000,
  });

  return (
    <>
      <PageHeader title="Production Board" subtitle="Every active card, by area" />
      <div className="space-y-4 px-4 md:px-6">
        {data && !data.productionColumnsReady && user?.accessLevel === "admin" && (
          <p className="card px-4 py-3 text-sm">
            Production columns are not set up in the Google Sheet yet.{" "}
            <Link to="/admin/users" className="font-semibold text-accent underline">
              Set them up in Admin
            </Link>
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium text-text-2">
            Area
            <select className="field min-w-40" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">All areas</option>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {AREA_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-text-2">
            Person
            <select className="field min-w-40" value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Everyone</option>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <BucketFilter value={bucket} onChange={setBucket} />
        {error && <p className="text-danger">{(error as Error).message}</p>}

        {/* The board scrolls sideways inside itself, never the page. */}
        <div className="-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
          <div className="flex gap-3">
            {(data?.columns ?? []).map((col) => (
              <section key={col.roleId} aria-label={col.area} className="card flex w-64 shrink-0 flex-col gap-2.5 p-3">
                <h2 className="flex items-center gap-2 text-sm font-bold">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: areaColor(col.roleId) }} aria-hidden="true" />
                  {col.area} ({col.cards.length})
                </h2>
                {col.cards.map((c) => (
                  <CardTile key={c.id} card={c} noMembers={c.noMembers} onOpen={() => setOpen(c)} />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
      {open && <CardView key={open.id} card={open} onClose={() => setOpen(null)} />}
    </>
  );
}
