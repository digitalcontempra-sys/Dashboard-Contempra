import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { MyCardsSummary } from "../../shared/types";
import { api } from "../api";
import { armChime, playChime } from "./chime";

export const POLL_MS = 20_000;

/** Polls for new cards; rings and retitles the tab when more arrive. */
export function useCardAlerts(enabled: boolean): { newCount: number; soundOn: boolean; setSoundOn: (on: boolean) => void } {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["my-cards-summary"],
    queryFn: () => api<MyCardsSummary>("/api/my-cards/summary"),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    enabled,
  });
  const newCount = data?.newCount ?? 0;
  const soundOn = data?.soundOn ?? true;
  const prev = useRef<number | null>(null);
  const baseTitle = useRef(document.title);

  useEffect(() => armChime(), []);

  useEffect(() => {
    if (!data) return;
    const before = prev.current;
    prev.current = data.newCount;
    if (before !== null && data.newCount > before) {
      if (data.soundOn) playChime();
      void qc.invalidateQueries({ queryKey: ["my-cards"] });
    }
  }, [data, qc]);

  useEffect(() => {
    document.title = newCount > 0 ? `(${newCount}) New cards · Contempra` : baseTitle.current;
  }, [newCount]);

  useEffect(() => {
    const title = baseTitle.current;
    return () => {
      document.title = title;
    };
  }, []);

  const setSoundOn = (on: boolean) => {
    qc.setQueryData<MyCardsSummary>(["my-cards-summary"], (s) => (s ? { ...s, soundOn: on } : s));
    void api("/api/me/sound", { method: "PUT", json: { on } }).catch(() =>
      qc.invalidateQueries({ queryKey: ["my-cards-summary"] }),
    );
  };

  return { newCount, soundOn, setSoundOn };
}
