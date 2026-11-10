/**
 * A short two-tone bell made with the Web Audio API (no audio files).
 *
 * Browsers (iPhone Safari above all) keep audio locked until the person touches the page, and
 * Safari does not always count the first touch. So armChime keeps listening to taps, clicks and
 * keys until the AudioContext is actually running, plays a silent sample inside that gesture to
 * unlock it, and tells subscribers (onAudioReady) so the app can stop asking and ring for cards
 * that were already waiting.
 */
let ctx: AudioContext | null = null;
let armed = false;
const readyListeners = new Set<() => void>();

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    // Safari 16.4+: play even when the iPhone's silent switch is on.
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** True when sound can play now, or when this browser has no Web Audio at all (nothing to ask for). */
export function isAudioReady(): boolean {
  const Ctor = typeof window !== "undefined" && (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
  if (!Ctor) return true;
  return ctx?.state === "running";
}

/** Calls fn once audio becomes available. Returns an unsubscribe function. */
export function onAudioReady(fn: () => void): () => void {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

export function armChime(): void {
  if (armed) return;
  armed = true;
  const events = ["pointerdown", "touchend", "click", "keydown"] as const;
  const unlock = () => {
    const ac = context();
    if (!ac) return;
    // A silent one-sample buffer played inside the gesture is what iOS needs to unlock audio.
    try {
      const src = ac.createBufferSource();
      src.buffer = ac.createBuffer(1, 1, 22050);
      src.connect(ac.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    void ac
      .resume()
      .then(() => {
        if (ac.state !== "running") return;
        for (const e of events) window.removeEventListener(e, unlock, true);
        for (const fn of readyListeners) fn();
      })
      .catch(() => undefined);
  };
  for (const e of events) window.addEventListener(e, unlock, true);
}

export function playChime(): void {
  const ac = context();
  if (!ac || ac.state !== "running") return;
  const tone = (freq: number, start: number) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + 0.65);
  };
  const t = ac.currentTime;
  tone(880, t);
  tone(1320, t + 0.15);
}
