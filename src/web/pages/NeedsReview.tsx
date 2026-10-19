import { useQuery } from "@tanstack/react-query";
import type { ReviewItemDTO } from "../../shared/types";
import { api } from "../api";
import { EmptyState, ListSkeleton } from "../components/DocketList";
import { PageHeader } from "../components/Layout";
import { parseSheetDate } from "../../shared/rules";
import { shortDate } from "../format";

const cell = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));

function RowPreview({ sheetRow, values }: { sheetRow: number; values: unknown[] }) {
  const date = parseSheetDate(values[0]);
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-4 py-3 text-sm">
      <span className="font-mono text-xs font-semibold text-text-3">Row {sheetRow}</span>
      <span className="truncate font-medium">{cell(values[6])}</span>
      <span className="text-xs text-text-3">{date.iso ? shortDate(date.iso) : cell(date.raw)}</span>
      <span className="truncate text-text-2">{cell(values[7])}</span>
    </li>
  );
}

export function NeedsReview() {
  const { data, isPending, error } = useQuery({
    queryKey: ["needs-review"],
    queryFn: () => api<ReviewItemDTO[]>("/api/needs-review"),
  });

  return (
    <>
      <PageHeader title="Needs Review" subtitle="Rows in the sheet that need a person to fix them" />
      <div className="space-y-3 px-4 md:px-8">
        {isPending ? (
          <ListSkeleton />
        ) : error ? (
          <EmptyState text={(error as Error).message} />
        ) : data.length === 0 ? (
          <EmptyState text="Nothing to review. Every work order number is unique." />
        ) : (
          <>
            <p className="text-sm text-text-2">
              Fix these directly in the Google Sheet. The dashboard shows the topmost row of a duplicate until it is fixed.
            </p>
            {data.map((g) => (
              <section key={`${g.kind}-${g.workOrder}-${g.rows[0]?.sheetRow}`} className="card overflow-hidden">
                <header className="flex items-center gap-2 border-b border-border bg-warn-soft px-4 py-2.5">
                  <span className="size-2 rounded-full bg-warn" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-warn">
                    {g.kind === "duplicate_work_order"
                      ? `Duplicate work order ${g.workOrder} (${g.rows.length} rows)`
                      : `Invalid work order on row ${g.rows[0]?.sheetRow}`}
                  </h2>
                </header>
                <ul className="divide-y divide-border">
                  {g.rows.map((r) => (
                    <RowPreview key={r.sheetRow} {...r} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}
