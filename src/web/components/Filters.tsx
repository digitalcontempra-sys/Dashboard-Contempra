import { useEffect, useState } from "react";
import { useAccountManagers, useDebounced } from "../hooks";
import { Icon } from "./Icon";

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <label className="relative block min-w-0 flex-1">
      <span className="sr-only">Search</span>
      <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3" />
      <input
        type="search"
        className="field pl-9"
        placeholder="Search work order, customer, project…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </label>
  );
}

export function AccountManagerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useAccountManagers();
  return (
    <label className="block shrink-0">
      <span className="sr-only">Account Manager</span>
      <select className="field w-auto pr-8" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Account Manager">
        <option value="">All Account Managers</option>
        {data?.map((a) => (
          <option key={a.accountManager} value={a.accountManager}>
            {a.accountManager}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-xl bg-surface-2 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap ${
            value === t.id ? "bg-surface text-text shadow-card" : "text-text-2 hover:text-text"
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="tabular-nums text-text-3">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
