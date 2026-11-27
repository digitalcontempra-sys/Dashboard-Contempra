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
  // Sized by its own box (container query): one line when it fits, else the date drops below the time.
  return (
    <div className="@container h-full">
      <div
        role="group"
        aria-label={p.label}
        className="glass flex h-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[20px] px-5 py-4 @[22rem]:items-center"
      >
        <span aria-hidden="true" className="text-[30px] leading-none font-bold tracking-tight whitespace-nowrap @[24rem]:text-[34px]">
          {p.time}
        </span>
        <span aria-hidden="true" className="flex items-baseline gap-3 whitespace-nowrap">
          <span className="hidden text-[24px] leading-none font-light text-text-3 @[22rem]:inline">|</span>
          <span className="text-[15px] font-bold tracking-wide text-accent @[24rem]:text-[17px]">{p.weekday}</span>
          <span className="text-[15px] text-text-2 @[24rem]:text-[17px]">{p.date}</span>
        </span>
      </div>
    </div>
  );
}
