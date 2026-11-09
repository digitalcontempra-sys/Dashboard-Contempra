import type { ProductionJob } from "../../shared/docketForm";
import type { AssigneeDTO, RoleDTO } from "../../shared/types";
import { Icon } from "../components/Icon";

type Props = {
  jobs: ProductionJob[];
  onChange?: (jobs: ProductionJob[]) => void;
  roles: RoleDTO[];
  assignees: AssigneeDTO[];
  readOnly?: boolean;
};

/** Production routing beside the paper: one or more jobs, each with an ordered role route and people per step. */
export function ProductionPanel({ jobs, onChange, roles, assignees, readOnly = false }: Props) {
  const update = (i: number, job: ProductionJob) => onChange?.(jobs.map((j, ji) => (ji === i ? job : j)));
  const roleLabel = (id: string) => roles.find((r) => r.id === id)?.label ?? id;

  return (
    <section className="card p-4" aria-label="Production">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold tracking-tight">Production</h2>
        {!readOnly && (
          <button
            type="button"
            className="btn-ghost min-h-11 px-3 text-xs"
            onClick={() => onChange?.([...jobs, { name: "", steps: [] }])}
          >
            <Icon name="plus" className="size-4" />
            Add job
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-text-3">Not printed on the docket. Choose the route each job follows.</p>

      <ol className="mt-3 space-y-3">
        {jobs.map((job, i) => (
          <li key={i} className="rounded-2xl bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <input
                aria-label={`Job name ${i + 1}`}
                className="field bg-surface-strong text-sm font-semibold"
                value={job.name}
                placeholder="Job name"
                readOnly={readOnly}
                onChange={(e) => update(i, { ...job, name: e.target.value })}
              />
              {!readOnly && jobs.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove job ${i + 1}`}
                  className="grid size-10 shrink-0 place-items-center rounded-full text-text-3 hover:bg-surface-strong hover:text-danger"
                  onClick={() => onChange?.(jobs.filter((_, ji) => ji !== i))}
                >
                  <Icon name="close" className="size-4" />
                </button>
              )}
            </div>

            {job.steps.length > 0 && (
              <ol className="mt-3 space-y-2">
                {job.steps.map((step, si) => {
                  const people = assignees.filter((a) => a.roles.includes(step.roleId));
                  return (
                    <li key={si} className="rounded-xl bg-surface-strong p-2.5 shadow-card">
                      <div className="flex items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-ink">{si + 1}</span>
                        <span className="flex-1 text-sm font-semibold">
                          {roleLabel(step.roleId)} ·{" "}
                          {step.assigneeIds.length === 0
                            ? "Team"
                            : step.assigneeIds
                                .map((id) => assignees.find((a) => a.id === id)?.fullName.split(/\s+/)[0] ?? "?")
                                .join(", ")}
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label={`Remove ${roleLabel(step.roleId)}`}
                            className="text-text-3 hover:text-danger"
                            onClick={() => update(i, { ...job, steps: job.steps.filter((_, x) => x !== si) })}
                          >
                            <Icon name="close" className="size-4" />
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {people.length === 0 && <span className="text-xs text-text-3">No one has this role yet</span>}
                        {people.map((p) => {
                          const on = step.assigneeIds.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              disabled={readOnly}
                              aria-pressed={on}
                              onClick={() =>
                                update(i, {
                                  ...job,
                                  steps: job.steps.map((s, x) =>
                                    x === si
                                      ? { ...s, assigneeIds: on ? s.assigneeIds.filter((id) => id !== p.id) : [...s.assigneeIds, p.id] }
                                      : s,
                                  ),
                                })
                              }
                              className={`min-h-11 rounded-full px-3 text-xs font-semibold transition ${on ? "bg-accent text-accent-ink" : "bg-surface-2 text-text-2 hover:text-text"}`}
                            >
                              {p.fullName}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {!readOnly && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-3">Add step</p>
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="min-h-11 rounded-full border border-border bg-surface-strong px-3 text-xs font-medium text-text-2 hover:text-text"
                      onClick={() => update(i, { ...job, steps: [...job.steps, { roleId: r.id, assigneeIds: [] }] })}
                    >
                      + {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
