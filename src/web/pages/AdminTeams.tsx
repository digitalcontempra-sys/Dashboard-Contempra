import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { AssigneeDTO, TeamDTO } from "../../shared/types";
import { api } from "../api";
import { Icon } from "../components/Icon";

/** Teams are Installer crews (spec 2026-11-24-subcontract-and-teams). */
const TEAM_ROLE = "installer";

type Draft = { id?: number; name: string; memberIds: number[] };

function TeamForm({ initial, installers, onClose }: { initial: Draft; installers: AssigneeDTO[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const label = initial.id === undefined ? "New team" : `Edit ${initial.name}`;
  const save = useMutation({
    mutationFn: (x: Draft) =>
      api<TeamDTO>(x.id === undefined ? "/api/teams" : `/api/teams/${x.id}`, {
        method: x.id === undefined ? "POST" : "PUT",
        json: { name: x.name.trim(), memberIds: x.memberIds },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["teams"] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });
  const toggle = (id: number) =>
    setD((x) => ({ ...x, memberIds: x.memberIds.includes(id) ? x.memberIds.filter((m) => m !== id) : [...x.memberIds, id] }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Members in list order, not click order.
    save.mutate({ ...d, memberIds: installers.map((p) => p.id).filter((id) => d.memberIds.includes(id)) });
  }

  return (
    <form aria-label={label} onSubmit={submit} className="mt-3 min-w-0 rounded-2xl bg-surface-2 p-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Team name</span>
        <input className="field bg-surface-strong" maxLength={40} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required />
      </label>
      <fieldset className="mt-3">
        <legend className="mb-2 text-sm font-medium">Members (installers)</legend>
        {installers.length === 0 && <p className="text-sm text-text-3">No one has the Installer role.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {installers.map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-strong px-3">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={d.memberIds.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="text-sm">{p.fullName}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={save.isPending || d.name.trim() === "" || d.memberIds.length === 0}>
          {save.isPending ? "Saving…" : "Save team"}
        </button>
      </div>
    </form>
  );
}

function DeleteTeam({ team }: { team: TeamDTO }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`/api/teams/${team.id}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
  return asking ? (
    <>
      <button className="btn bg-danger text-xs text-white" aria-label={`Confirm delete ${team.name}`} disabled={del.isPending} onClick={() => del.mutate()}>
        Delete
      </button>
      <button className="btn-ghost text-xs" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </>
  ) : (
    <button className="btn-ghost text-xs" aria-label={`Delete ${team.name}`} onClick={() => setAsking(true)}>
      Delete
    </button>
  );
}

/** Admin → Teams: Installer crews that "Send to" offers as one choice. */
export function TeamsPanel() {
  const [editing, setEditing] = useState<Draft | null>(null);
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api<TeamDTO[]>("/api/teams") });
  const people = useQuery({ queryKey: ["assignees"], queryFn: () => api<AssigneeDTO[]>("/api/assignees"), staleTime: 60_000 });
  const installers = (people.data ?? []).filter((p) => p.roles.includes(TEAM_ROLE));

  return (
    <section className="card min-w-0 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Teams</h2>
          <p className="text-sm text-text-2">Installer crews. Sending a docket to a team gives one card to all its members; the first to press I'm on it takes it.</p>
        </div>
        {!editing && (
          <button className="btn-ghost" onClick={() => setEditing({ name: "", memberIds: [] })}>
            <Icon name="plus" className="size-4" />
            New team
          </button>
        )}
      </div>
      {editing && <TeamForm key={editing.id ?? "new"} initial={editing} installers={installers} onClose={() => setEditing(null)} />}
      {teams.error && <p className="mt-2 text-sm text-danger">{(teams.error as Error).message}</p>}
      {teams.data && teams.data.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {teams.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.name}</p>
                <p className="text-sm text-text-2">{t.members.length ? t.members.map((m) => m.fullName).join(", ") : "No members"}</p>
              </div>
              <button
                className="btn-ghost text-xs"
                aria-label={`Edit ${t.name}`}
                onClick={() => setEditing({ id: t.id, name: t.name, memberIds: t.members.map((m) => m.id) })}
              >
                Edit
              </button>
              <DeleteTeam team={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
