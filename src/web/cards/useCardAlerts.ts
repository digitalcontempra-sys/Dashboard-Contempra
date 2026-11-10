import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { MyCardsSummary } from "../../shared/types";
import { api } from "../api";
import { armChime, isAudioReady, onAudioReady, playChime } from "./chime";

export const POLL_MS = 20_000;

/** Polls for new cards; rings and retitles the tab when more arrive. */
/** badge = new cards and tasks (they ring) + tasks you sent that were just finished (no chime). */
export function useCardAlerts(enabled: boolean): {
  newCount: number;
  badge: number;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** Sound is on but the browser has not unlocked audio yet: ask for a tap. */
  needsTap: boolean;
} {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["my-cards-summary"],
    queryFn: () => api<MyCardsSummary>("/api/my-cards/summary"),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    enabled,
  });
  const newCount = data?.newCount ?? 0;
  const badge = newCount + (data?.doneTasks ?? 0);
  const soundOn = data?.soundOn ?? true;
  const prev = useRef<number | null>(null);
  const baseTitle = useRef(document.title);

  const [audioReady, setAudioReady] = useState(isAudioReady);
  const latest = useRef({ loaded: false, newCount: 0, soundOn: true });
  latest.current = { loaded: data !== undefined, newCount, soundOn };
  // Audio unlocked before the first summary arrived: ring as soon as it does.
  const ringWhenLoaded = useRef(false);

  useEffect(() => {
    armChime();
    // Once a tap unlocks audio, ring for cards that were already waiting (they arrived while the app was closed).
    return onAudioReady(() => {
      setAudioReady(true);
      if (!latest.current.loaded) ringWhenLoaded.current = true;
      else if (latest.current.soundOn && latest.current.newCount > 0) playChime();
    });
  }, []);

  useEffect(() => {
    if (!data) return;
    if (ringWhenLoaded.current) {
      ringWhenLoaded.current = false;
      if (data.soundOn && data.newCount > 0) playChime();
    }
    const before = prev.current;
    prev.current = data.newCount;
    if (before !== null && data.newCount > before) {
      if (data.soundOn) playChime();
      void qc.invalidateQueries({ queryKey: ["my-cards"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    }
  }, [data, qc]);

  useEffect(() => {
    document.title = badge > 0 ? `(${badge}) New cards · Contempra` : baseTitle.current;
  }, [badge]);

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

  return { newCount, badge, soundOn, setSoundOn, needsTap: enabled && soundOn && !audioReady };
}
