import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { AccessLevel, RoleDTO, SyncStatus, UserDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { EmptyState, ListSkeleton } from "../components/DocketList";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/Layout";
import { SyncBadge } from "../components/SyncBadge";

const LEVELS: { id: AccessLevel; label: string; hint: string }[] = [
  { id: "staff", label: "Staff", hint: "Sees only their own cards" },
  { id: "manager", label: "Manager", hint: "Sees all work orders and billing" },
  { id: "admin", label: "Admin", hint: "Everything, including users" },
];

type Draft = { id?: number; username: string; fullName: string; accessLevel: AccessLevel; roles: string[]; password: string };

function UserForm({ initial, roles, onClose }: { initial: Draft; roles: RoleDTO[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const isNew = initial.id === undefined;
  const save = useMutation({
    mutationFn: (payload: Draft) =>
      isNew
        ? api<UserDTO>("/api/users", { method: "POST", json: payload })
        : api<UserDTO>(`/api/users/${initial.id}`, {
            method: "PATCH",
            json: { fullName: payload.fullName, accessLevel: payload.accessLevel, roles: payload.roles },
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  const toggleRole = (id: string) =>
    setD((x) => ({ ...x, roles: x.roles.includes(id) ? x.roles.filter((r) => r !== id) : [...x.roles, id] }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Keep role order as the production order, not click order.
    save.mutate({ ...d, roles: roles.map((r) => r.id).filter((id) => d.roles.includes(id)) });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "Add user" : "Edit user"}
        onSubmit={submit}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isNew ? "Add user" : `Edit ${initial.fullName}`}</h2>
          <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Username</span>
            <input
              className="field"
              value={d.username}
              disabled={!isNew}
              autoCapitalize="none"
              onChange={(e) => setD({ ...d, username: e.target.value })}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Full name</span>
            <input className="field" value={d.fullName} onChange={(e) => setD({ ...d, fullName: e.target.value })} required />
          </label>
        </div>

        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-medium">Access level</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {LEVELS.map((l) => (
              <label
                key={l.id}
                className={`flex cursor-pointer flex-col rounded-lg border p-3 ${
                  d.accessLevel === l.id ? "border-accent bg-accent-soft" : "border-border"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    name="level"
                    className="accent-[var(--accent)]"
                    checked={d.accessLevel === l.id}
                    onChange={() => setD({ ...d, accessLevel: l.id })}
                  />
                  {l.label}
                </span>
                <span className="mt-0.5 text-xs text-text-2">{l.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-medium">Roles</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={d.roles.includes(r.id)}
                  onChange={() => toggleRole(r.id)}
                />
                <span className="text-sm">{r.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {isNew && (
          <div className="mt-5">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Password</span>
              <input
                type="password"
                className="field"
                autoComplete="new-password"
                value={d.password}
                onChange={(e) => setD({ ...d, password: e.target.value })}
                required
              />
            </label>
            <p className="mt-1 text-xs text-text-3">At least 8 characters.</p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SyncPanel() {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api<{ ok: boolean; rowsSeen: number; rowsChanged: number; error: string | null }>("/api/sync/run", { method: "POST" }),
    onSettled: () => qc.invalidateQueries(),
  });
  return (
    <section className="card flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">Google Sheet sync</h2>
        <p className="text-sm text-text-2">Runs every minute. Use this to pull changes right now.</p>
        {run.data && (
          <p className={`mt-1 text-sm ${run.data.ok ? "text-ok" : "text-danger"}`}>
            {run.data.ok ? `Synced ${run.data.rowsSeen} work orders, ${run.data.rowsChanged} changed.` : run.data.error}
          </p>
        )}
        {run.error && <p className="mt-1 text-sm text-danger">{(run.error as Error).message}</p>}
      </div>
      <SyncBadge />
      <button className="btn-ghost" onClick={() => run.mutate()} disabled={run.isPending}>
        <Icon name="sync" className={`size-4 ${run.isPending ? "animate-spin" : ""}`} />
        {run.isPending ? "Syncing…" : "Sync now"}
      </button>
    </section>
  );
}

function ResetPassword({ user }: { user: UserDTO }) {
  const [msg, setMsg] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: (password: string) => api(`/api/users/${user.id}/reset-password`, { method: "POST", json: { password } }),
    onSuccess: () => setMsg("Password reset. They were signed out."),
    onError: (e) => setMsg((e as Error).message),
  });
  return (
    <>
      <button
        className="btn-ghost text-xs"
        onClick={() => {
          const pw = window.prompt(`New password for ${user.fullName} (at least 8 characters)`);
          if (pw) reset.mutate(pw);
        }}
      >
        Reset password
      </button>
      {msg && <span className="text-xs text-text-2">{msg}</span>}
    </>
  );
}

export function AdminUsers() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<RoleDTO[]>("/api/roles"), staleTime: Infinity });
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<UserDTO[]>("/api/users") });
  const toggleActive = useMutation({
    mutationFn: (u: UserDTO) => api(`/api/users/${u.id}`, { method: "PATCH", json: { active: !u.active } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  const roleLabel = (id: string) => roles.data?.find((r) => r.id === id)?.label ?? id;

  return (
    <>
      <PageHeader
        title="Admin"
        subtitle="Users, roles and access"
        actions={
          <button
            className="btn-primary"
            onClick={() => setEditing({ username: "", fullName: "", accessLevel: "staff", roles: [], password: "" })}
          >
            <Icon name="plus" className="size-4" />
            Add user
          </button>
        }
      />
      <div className="space-y-4 px-4 md:px-8">
        <SyncPanel />
        {users.isPending ? (
          <ListSkeleton />
        ) : users.error ? (
          <EmptyState text={(users.error as Error).message} />
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {users.data.map((u) => (
              <li key={u.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${u.active ? "" : "opacity-60"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{u.fullName}</p>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold capitalize text-text-2">
                      {u.accessLevel}
                    </span>
                    {!u.active && <span className="text-[11px] font-semibold uppercase text-danger">Inactive</span>}
                  </div>
                  <p className="text-xs text-text-3">@{u.username}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {u.roles.length === 0 && <span className="text-xs text-text-3">No production roles</span>}
                    {u.roles.map((r) => (
                      <span key={r} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                        {roleLabel(r)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setEditing({ ...u, password: "" })}
                    aria-label={`Edit ${u.fullName}`}
                  >
                    Edit
                  </button>
                  <ResetPassword user={u} />
                  {u.id !== me?.id && (
                    <button className="btn-ghost text-xs" onClick={() => toggleActive.mutate(u)}>
                      {u.active ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && roles.data && <UserForm initial={editing} roles={roles.data} onClose={() => setEditing(null)} />}
    </>
  );
}
