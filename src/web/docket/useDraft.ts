import { useCallback, useEffect, useRef } from "react";
import type { DocketForm, ProductionJob } from "../../shared/docketForm";

export type Draft = { form: DocketForm; jobs: ProductionJob[]; version: number; savedAt: number };

const SAVE_EVERY_MS = 5_000;

function read(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

/**
 * Autosaves the docket being typed to this device every 5 s, so an iPad that sleeps or loses
 * Wi-Fi does not lose the work. Storage failures (private mode) are ignored.
 */
export function useDraft(key: string, value: { form: DocketForm; jobs: ProductionJob[]; version: number }, enabled: boolean) {
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ ...latest.current, savedAt: Date.now() } satisfies Draft));
      } catch {
        /* storage unavailable */
      }
    }, SAVE_EVERY_MS);
    return () => clearInterval(t);
  }, [key, enabled]);

  const restore = useCallback(() => read(key), [key]);
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }, [key]);

  return { restore, clear };
}

export const draftKey = (wo: string | undefined) => `docket-draft:${wo ?? "new"}`;
