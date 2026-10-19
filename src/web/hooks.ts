import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AccountManagerCount } from "../shared/types";
import { api } from "./api";

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Updates several URL query params in ONE navigation; empty values are removed.
 * React Router's setSearchParams does not queue updates, so two calls in one
 * handler would make the second overwrite the first.
 */
export function useSetParams(): (updates: Record<string, string | null>) => void {
  const [, setParams] = useSearchParams();
  return (updates) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
}

/** Reads/writes one URL query param; empty values are removed. */
export function useParam(key: string): [string, (v: string | null) => void] {
  const [params] = useSearchParams();
  const setMany = useSetParams();
  return [params.get(key) ?? "", (v) => setMany({ [key]: v })];
}

export function useAccountManagers() {
  return useQuery({
    queryKey: ["account-managers"],
    queryFn: () => api<AccountManagerCount[]>("/api/account-managers"),
    staleTime: 10 * 60_000,
  });
}
