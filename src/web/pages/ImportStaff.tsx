import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RoleDTO } from "../../shared/types";
import type { RosterPerson } from "../../shared/staffRoster";
import { api } from "../api";

type Row = RosterPerson & { exists: boolean };

const LEVEL: Record<string, string> = { admin: "Admin", manager: "Manager", staff: "Staff" };

/** Admin: creates the approved Contributors roster accounts, all with one temporary password. */
export function ImportStaff() {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<RoleDTO[]>("/api/roles"), staleTime: Infinity });
  const roster = useQuery({ queryKey: ["import-staff"], queryFn: () => api<Row[]>("/api/admin/import-staff") });
  const run = useMutation({
    mutationFn: () => api<{ created: string[]; skipped: string[] }>("/api/admin/import-staff", { method: "POST", json: { tempPassword: password } }),
    onSuccess: () => {
      setPassword("");
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["import-staff"] });
    },
  });
  if (!roster.data) return null;

  const label = (id: string) => roles.data?.find((r) => r.id === id)?.label ?? id;
  const missing = roster.data.filter((p) => !p.exists).length;

  return (
    <section aria-label="Import staff" className="card p-4">
      <h2 className="font-semibold">Import staff</h2>
      <p className="text-sm text-text-2">
        Accounts for the people on the Contributors tab. Everyone gets the temporary password below and must choose their own the first
        time they sign in.
      </p>
      {run.data && (
        <p className="mt-2 text-sm font-medium text-ok">
          Created {run.data.created.length} accounts. Each person must choose their own password the first time they sign in.
        </p>
      )}
      <ul className="mt-3 max-h-80 divide-y divide-border overflow-y-auto rounded-2xl bg-surface-2">
        {roster.data.map((p) => (
          <li key={p.username} className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3.5 py-2 text-sm ${p.exists ? "opacity-60" : ""}`}>
            <span className="min-w-36 font-semibold">{p.fullName}</span>
            <span className="font-mono text-xs text-text-3">{p.username}</span>
            <span className="text-xs text-text-2">{LEVEL[p.accessLevel]}</span>
            <span className="flex-1 text-xs text-text-2">{p.roles.map(label).join(", ")}</span>
            {p.exists && <span className="text-xs font-semibold text-ok">Has an account</span>}
          </li>
        ))}
      </ul>
      {missing > 0 ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor="import-temp-password" className="mb-1 block text-[13px] font-medium text-text-2">
              Temporary password
            </label>
            <input
              id="import-temp-password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              placeholder="At least 8 characters"
            />
          </div>
          <button type="button" className="btn-primary" disabled={password.length < 8 || run.isPending} onClick={() => run.mutate()}>
            Create {missing} accounts
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-2">Everyone on the roster has an account.</p>
      )}
      {run.error && <p className="mt-2 text-sm text-danger">{(run.error as Error).message}</p>}
    </section>
  );
}
