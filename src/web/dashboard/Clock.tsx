import { useEffect, useState } from "react";
import { clockParts } from "../../shared/dashboard";

/** Winnipeg wall clock. One timer, re-armed on each minute boundary; no seconds, no live region. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setTimeout(() => setNow(new Date()), 60_000 - (now.getTime() % 60_000) + 50);
    return () => clearTimeout(t);
  }, [now]);
  const p = clockParts(now);
  return (
    <div role="group" aria-label={p.label} className="glass flex h-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[20px] px-5 py-4">
      <span aria-hidden="true" className="text-[28px] leading-none font-bold tracking-tight whitespace-nowrap md:text-[34px]">
        {p.time}
      </span>
      <span aria-hidden="true" className="flex items-baseline gap-3 whitespace-nowrap">
        <span className="text-[22px] leading-none font-light text-text-3 md:text-[26px]">|</span>
        <span className="text-[15px] font-bold tracking-wide text-accent md:text-[17px]">{p.weekday}</span>
        <span className="text-[15px] text-text-2 md:text-[17px]">{p.date}</span>
      </span>
    </div>
  );
}
