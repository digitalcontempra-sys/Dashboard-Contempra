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

/** Reads/writes one URL query param; empty values are removed. */
export function useParam(key: string): [string, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? "";
  const set = (v: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(key, v);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  return [value, set];
}

export function useAccountManagers() {
  return useQuery({
    queryKey: ["account-managers"],
    queryFn: () => api<AccountManagerCount[]>("/api/account-managers"),
    staleTime: 10 * 60_000,
  });
}
