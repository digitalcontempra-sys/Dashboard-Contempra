import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/** One column (w-64) plus the gap: what the arrows and arrow keys move. */
const STEP = 268;
const MIN_THUMB = 48;

type Metrics = { left: number; max: number; ratio: number };

/**
 * A slim scroll bar placed above a sideways-scrolling area, so people can move
 * it without first scrolling down to the native bar at the bottom.
 */
export function BoardScrollbar({
  target,
  controls,
  label,
  deps,
}: {
  target: RefObject<HTMLElement | null>;
  /** id of the scrolling element. */
  controls: string;
  label: string;
  /** Re-measure when this changes (e.g. new data). */
  deps?: unknown;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Metrics>({ left: 0, max: 0, ratio: 1 });

  const measure = useCallback(() => {
    const el = target.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    setM({ left: el.scrollLeft, max, ratio: el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1 });
  }, [target]);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [target, measure]);

  useEffect(measure, [deps, measure]);

  const scrollTo = (left: number, smooth = false) => {
    const el = target.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const next = Math.min(max, Math.max(0, left));
    if (smooth && typeof el.scrollTo === "function") el.scrollTo({ left: next, behavior: "smooth" });
    else el.scrollLeft = next;
    measure();
  };

  const trackWidth = () => track.current?.clientWidth ?? 0;
  const thumbWidth = () => Math.max(MIN_THUMB, trackWidth() * m.ratio);
  /** Scroll pixels per pixel of thumb travel. */
  const scale = () => {
    const travel = trackWidth() - thumbWidth();
    return travel > 0 ? m.max / travel : 0;
  };

  const onThumbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = target.current?.scrollLeft ?? 0;
    const k = scale();
    const thumb = e.currentTarget;
    thumb.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => scrollTo(start + (ev.clientX - startX) * k);
    const up = () => {
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", up);
      thumb.removeEventListener("pointercancel", up);
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", up);
    thumb.addEventListener("pointercancel", up);
  };

  /** A tap on the track centres the thumb there. */
  const onTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left - thumbWidth() / 2;
    scrollTo(x * scale(), true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const el = target.current;
    if (!el) return;
    const moves: Record<string, number> = {
      ArrowRight: el.scrollLeft + STEP,
      ArrowLeft: el.scrollLeft - STEP,
      PageDown: el.scrollLeft + el.clientWidth,
      PageUp: el.scrollLeft - el.clientWidth,
      Home: 0,
      End: el.scrollWidth,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    scrollTo(moves[e.key]);
  };

  const overflow = m.max > 0;
  const pct = overflow ? Math.round((m.left / m.max) * 100) : 0;
  const thumbLeft = overflow ? (m.left / m.max) * (trackWidth() - thumbWidth()) : 0;
  const arrow = "grid size-8 shrink-0 place-items-center rounded-full text-text-2 transition-colors hover:bg-surface-strong hover:text-text disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className={`flex items-center gap-2 ${overflow ? "" : "invisible"}`}>
      <button type="button" className={arrow} aria-label="Scroll left" disabled={m.left <= 0} onClick={() => scrollTo(m.left - STEP, true)}>
        <Icon name="chevron" className="size-4 rotate-180" />
      </button>
      <div
        ref={track}
        role="scrollbar"
        aria-label={label}
        aria-controls={controls}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onTrackDown}
        className="relative h-2.5 flex-1 cursor-pointer touch-none rounded-full bg-text/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div
          onPointerDown={onThumbDown}
          className="absolute inset-y-0 cursor-grab rounded-full bg-text-3/70 transition-colors hover:bg-text-2 active:cursor-grabbing active:bg-text-2"
          style={{ left: thumbLeft, width: thumbWidth() }}
        />
      </div>
      <button type="button" className={arrow} aria-label="Scroll right" disabled={m.left >= m.max} onClick={() => scrollTo(m.left + STEP, true)}>
        <Icon name="chevron" className="size-4" />
      </button>
    </div>
  );
}
