/**
 * A short two-tone bell made with the Web Audio API (no audio files).
 * Browsers only allow sound after the person has touched the page, so the AudioContext is created
 * or resumed on the first pointer/key press (armChime) and reused after that.
 */
let ctx: AudioContext | null = null;
let armed = false;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function armChime(): void {
  if (armed) return;
  armed = true;
  const unlock = () => {
    void context()?.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
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
