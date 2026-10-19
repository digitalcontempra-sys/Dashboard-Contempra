import { NavLink, Outlet } from "react-router-dom";
import type { AccessLevel } from "../../shared/types";
import { useAuth } from "../auth";
import { Icon, type IconName } from "./Icon";

type NavItem = { to: string; label: string; short: string; icon: IconName; levels: AccessLevel[] };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Main Dashboard", short: "Dashboard", icon: "dashboard", levels: ["admin", "manager"] },
  { to: "/my-cards", label: "My Cards", short: "My Cards", icon: "cards", levels: ["admin", "manager", "staff"] },
  { to: "/non-billed", label: "Non Billed Jobs", short: "Billing", icon: "billing", levels: ["admin", "manager"] },
  { to: "/needs-review", label: "Needs Review", short: "Review", icon: "review", levels: ["admin", "manager"] },
  { to: "/admin/users", label: "Admin", short: "Admin", icon: "users", levels: ["admin"] },
];

export function Layout() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const items = NAV.filter((n) => n.levels.includes(user.accessLevel));
  const initials = user.fullName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm font-black text-accent-ink">C</span>
          <span className="text-sm font-bold tracking-tight">Contempra</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Main">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                  isActive ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-surface-2 hover:text-text"
                }`
              }
            >
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-border p-4">
          <span className="grid size-9 place-items-center rounded-full bg-surface-2 text-xs font-bold">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.fullName}</p>
            <p className="text-xs capitalize text-text-3">{user.accessLevel}</p>
          </div>
          <button className="btn-ghost px-2" onClick={logout} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-accent text-xs font-black text-accent-ink">C</span>
          <span className="text-sm font-bold">Contempra</span>
        </div>
        <button className="flex items-center gap-2 text-sm text-text-2" onClick={logout} aria-label="Sign out">
          <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-xs font-bold text-text">
            {initials}
          </span>
          <Icon name="logout" className="size-4" />
        </button>
      </header>

      <main className="min-w-0 flex-1 pb-24 md:pb-8">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            aria-label={n.label}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                isActive ? "text-accent" : "text-text-3"
              }`
            }
          >
            <Icon name={n.icon} />
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-5 pb-3 md:px-8 md:pt-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-text-2">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
