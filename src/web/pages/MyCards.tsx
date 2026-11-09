import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ROLE_LABEL, ROLE_ORDER } from "../../shared/cards";
import type { CardDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { CardTile } from "../cards/CardTile";
import { CardView } from "../cards/CardView";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/Layout";
import { BUCKETS } from "../format";

export const CARD_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/** Returned first (red), then active cards by time group, then Up next (waiting). */
export function groupCards(cards: CardDTO[]): { label: string; cards: CardDTO[] }[] {
  const active = cards.filter((c) => c.status === "active");
  const groups = [
    { label: "Returned", cards: active.filter((c) => c.returned) },
    ...BUCKETS.map((b) => ({ label: b.label, cards: active.filter((c) => !c.returned && c.header.bucket === b.id) })),
    { label: "Up next", cards: cards.filter((c) => c.status === "waiting") },
  ];
  return groups.filter((g) => g.cards.length > 0);
}

export function MyCards() {
  const { user } = useAuth();
  const [role, setRole] = useState<string | null>(null);
  const [open, setOpen] = useState<CardDTO | null>(null);
  const { data, isPending, error } = useQuery({ queryKey: ["my-cards"], queryFn: () => api<CardDTO[]>("/api/my-cards") });

  const roles = ROLE_ORDER.filter((r) => user?.roles.includes(r));
  const shown = (data ?? []).filter((c) => !role || c.roleId === role);
  const groups = groupCards(shown);

  return (
    <>
      <PageHeader title="My Cards" />
      <div className="px-4 md:px-6">
        {roles.length > 1 && (
          <div role="tablist" aria-label="Roles" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
            {[null, ...roles].map((r) => (
              <button
                key={r ?? "all"}
                role="tab"
                type="button"
                aria-selected={role === r}
                onClick={() => setRole(r)}
                className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition ${
                  role === r ? "border-transparent bg-text text-[var(--bg)]" : "border-border bg-surface text-text-2 shadow-card"
                }`}
              >
                {r ? ROLE_LABEL[r] : "All"}
              </button>
            ))}
          </div>
        )}

        {error && <p className="py-6 text-danger">{(error as Error).message}</p>}
        {!isPending && !error && groups.length === 0 && (
          <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon name="cards" className="size-6" />
            </span>
            <p className="max-w-xs text-text-2">No cards right now.</p>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.label} aria-label={g.label} className="mb-6">
            <h2 className={`mb-2.5 text-xs font-semibold uppercase tracking-wide ${g.label === "Returned" ? "text-danger" : "text-text-3"}`}>
              {g.label} <span className="tabular-nums">({g.cards.length})</span>
            </h2>
            <div className={CARD_GRID}>
              {g.cards.map((c) => (
                <CardTile key={c.id} card={c} onOpen={() => setOpen(c)} />
              ))}
            </div>
          </section>
        ))}
      </div>
      {open && <CardView key={open.id} card={open} onClose={() => setOpen(null)} />}
    </>
  );
}
