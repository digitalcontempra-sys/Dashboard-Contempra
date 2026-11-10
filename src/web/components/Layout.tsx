import { NavLink, Outlet } from "react-router-dom";
import type { AccessLevel } from "../../shared/types";
import { useAuth } from "../auth";
import { useCardAlerts } from "../cards/useCardAlerts";
import { BrandLogo } from "./BrandLogo";
import { Icon, type IconName } from "./Icon";

type NavItem = { to: string; label: string; short: string; icon: IconName; levels: AccessLevel[] };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Main Dashboard", short: "Dashboard", icon: "dashboard", levels: ["admin", "manager"] },
  { to: "/my-cards", label: "My Cards", short: "My Cards", icon: "cards", levels: ["admin", "manager", "staff"] },
  { to: "/production", label: "Production Board", short: "Board", icon: "board", levels: ["admin", "manager"] },
  { to: "/non-billed", label: "Non Billed Jobs", short: "Billing", icon: "billing", levels: ["admin", "manager"] },
  { to: "/needs-review", label: "Needs Review", short: "Review", icon: "review", levels: ["admin", "manager"] },
  { to: "/admin/users", label: "Admin", short: "Admin", icon: "users", levels: ["admin"] },
  { to: "/admin/trash", label: "Trash", short: "Trash", icon: "trash", levels: ["admin"] },
];

/** Bold red count that pulses while there are unopened cards. */
function NewBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} new card${count === 1 ? "" : "s"}`}
      className={`animate-pulse-badge grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] leading-5 font-black text-accent-ink ${className}`}
    >
      {count}
    </span>
  );
}

function SoundToggle({ on, onChange, className = "" }: { on: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      className={`grid size-11 place-items-center rounded-full text-text-2 transition hover:bg-surface-strong hover:text-text ${className}`}
      onClick={() => onChange(!on)}
      aria-label={on ? "Sound on" : "Sound off"}
      aria-pressed={on}
      title={on ? "Sound on" : "Sound off"}
    >
      <Icon name={on ? "bell" : "bellOff"} className="size-[18px]" />
    </button>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  // Anyone can receive task cards, so everyone signed in polls.
  const alerts = useCardAlerts(Boolean(user));
  if (!user) return null;
  const items = NAV.filter((n) => n.levels.includes(user.accessLevel));
  const initials = user.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-dvh md:flex md:gap-2 md:p-3">
      <aside className="glass sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-64 shrink-0 flex-col rounded-[var(--radius-panel)] md:flex">
        <div className="flex flex-col items-center gap-2 px-5 pt-6 pb-6">
          <BrandLogo className="h-auto w-[168px]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">Production Dashboard</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex min-h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors ${
                  isActive ? "bg-surface-strong text-accent shadow-card" : "text-text-2 hover:bg-surface-2 hover:text-text"
                }`
              }
            >
              <Icon name={n.icon} className="size-[18px]" />
              <span className="flex-1">{n.label}</span>
              {n.to === "/my-cards" && <NewBadge count={alerts.badge} />}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <span className="grid size-9 place-items-center rounded-full bg-surface-strong text-xs font-bold shadow-card">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.fullName}</p>
            <p className="text-xs capitalize text-text-3">{user.accessLevel}</p>
          </div>
          <SoundToggle on={alerts.soundOn} onChange={alerts.setSoundOn} />
          <button
            className="grid size-9 place-items-center rounded-full text-text-2 transition hover:bg-surface-strong hover:text-text"
            onClick={logout}
            aria-label="Sign out"
            title="Sign out"
          >
            <Icon name="logout" className="size-[18px]" />
          </button>
        </div>
      </aside>

      <header className="glass sticky top-0 z-20 flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-3 md:hidden">
        <BrandLogo className="h-10 w-auto" />
        <SoundToggle on={alerts.soundOn} onChange={alerts.setSoundOn} className="ml-auto" />
        <button className="flex items-center gap-2 text-sm text-text-2" onClick={logout} aria-label="Sign out">
          <span className="grid size-8 place-items-center rounded-full bg-surface-strong text-xs font-bold text-text shadow-card">
            {initials}
          </span>
          <Icon name="logout" className="size-4" />
        </button>
      </header>

      <main className="min-w-0 flex-1 pb-28 md:pb-8">
        <Outlet />
      </main>

      <nav
        className="glass-strong fixed inset-x-3 bottom-3 z-20 flex rounded-[22px] pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Main"
      >
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            aria-label={n.label}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium ${
                isActive ? "text-accent" : "text-text-3"
              }`
            }
          >
            <span className="relative">
              <Icon name={n.icon} />
              {n.to === "/my-cards" && <NewBadge count={alerts.badge} className="absolute -top-2 -right-3" />}
            </span>
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-6 pb-4 md:px-6 md:pt-5">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-text-2">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
