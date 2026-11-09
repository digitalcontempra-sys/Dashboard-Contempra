import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { emptyForm, WHOLE_DOCKET, type DocketForm, type ProductionJob } from "../../shared/docketForm";
import { todayInBusinessTz } from "../../shared/rules";
import type { AccountManagerCount, AssigneeDTO, RoleDTO, VirtualDocketDTO } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { DocketPaper } from "../docket/DocketPaper";
import { ProductionPanel } from "../docket/ProductionPanel";
import { draftKey, useDraft, type Draft } from "../docket/useDraft";
import { afterDocketSaved } from "../docket/afterSave";
import { DocketActions } from "../docket/DocketActions";

const DEFAULT_JOBS: ProductionJob[] = [{ name: WHOLE_DOCKET, steps: [] }];

export function DocketEditor() {
  const { wo } = useParams<{ wo: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = user?.accessLevel === "admin" || user?.accessLevel === "manager";
  const isNew = !wo;

  const [form, setForm] = useState<DocketForm>(() => emptyForm(todayInBusinessTz(new Date()), user?.fullName ?? ""));
  const [jobs, setJobs] = useState<ProductionJob[]>(DEFAULT_JOBS);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(isNew);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<RoleDTO[]>("/api/roles"), staleTime: Infinity });
  const assignees = useQuery({
    queryKey: ["assignees"],
    queryFn: () => api<AssigneeDTO[]>("/api/assignees"),
    enabled: canEdit,
  });
  const ams = useQuery({
    queryKey: ["account-managers"],
    queryFn: () => api<AccountManagerCount[]>("/api/account-managers"),
    enabled: canEdit,
  });
  const nextNumber = useQuery({
    queryKey: ["next-work-order"],
    queryFn: () => api<{ workOrder: string }>("/api/virtual-dockets/next-number"),
    enabled: isNew && canEdit,
    retry: false,
    refetchInterval: 60_000,
  });
  const existing = useQuery({
    queryKey: ["virtual-docket", wo],
    queryFn: () => api<VirtualDocketDTO>(`/api/virtual-dockets/${encodeURIComponent(wo!)}`),
    enabled: !isNew,
  });

  const { restore, clear } = useDraft(draftKey(wo), { form, jobs, version }, canEdit && dirty);

  useEffect(() => {
    if (existing.data && !loaded) {
      setForm(existing.data.form);
      setJobs(existing.data.jobs.length ? existing.data.jobs : DEFAULT_JOBS);
      setVersion(existing.data.version);
      setLoaded(true);
      // A saved docket without its PDF (e.g. the upload failed) gets one now.
      if (canEdit && existing.data.source === "virtual" && !existing.data.pdf.stored) void afterDocketSaved(existing.data, qc);
    }
  }, [existing.data, loaded, canEdit, qc]);

  useEffect(() => {
    if (canEdit) setDraft(restore());
  }, [canEdit, restore]);

  const change = (f: DocketForm) => {
    setForm(f);
    setDirty(true);
  };
  const changeJobs = (j: ProductionJob[]) => {
    setJobs(j);
    setDirty(true);
  };

  async function save(andNew: boolean) {
    setSaving(true);
    setError(null);
    try {
      const body = { form, jobs, version };
      const dto = isNew
        ? await api<VirtualDocketDTO>("/api/virtual-dockets", { method: "POST", json: body })
        : await api<VirtualDocketDTO>(`/api/virtual-dockets/${encodeURIComponent(wo!)}`, { method: "PUT", json: body });
      clear();
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["dockets"] });
      qc.invalidateQueries({ queryKey: ["next-work-order"] });
      qc.setQueryData(["virtual-docket", dto.workOrder], dto);
      void afterDocketSaved(dto, qc);
      if (andNew) {
        setForm(emptyForm(todayInBusinessTz(new Date()), user?.fullName ?? ""));
        setJobs(DEFAULT_JOBS);
        setVersion(0);
        navigate("/dockets/new");
      } else {
        setVersion(dto.version);
        navigate(`/dockets/${dto.workOrder}`, { replace: isNew });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && existing.isPending) {
    return <p className="p-8 text-text-2">Loading docket…</p>;
  }
  if (!isNew && existing.error) {
    return <p className="p-8 text-danger">{(existing.error as Error).message}</p>;
  }

  const workOrder = isNew ? null : wo!;
  return (
    <div className="pb-10">
      <div className="glass sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-none border-x-0 border-t-0 px-4 py-3 md:top-3 md:mx-6 md:rounded-[var(--radius-panel)] md:border">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold tracking-tight">{isNew ? "New Docket" : `Docket #${wo}`}</h1>
          <p className="text-xs text-text-3">
            {!canEdit ? "View only" : saving ? "Saving…" : dirty ? "Draft saved on this device" : isNew ? "Not saved yet" : "All changes saved"}
          </p>
        </div>
        {canEdit && (
          <>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => {
                if (dirty && !window.confirm("Leave without saving? Your changes will be lost.")) return;
                clear();
                navigate(-1);
              }}
            >
              Cancel
            </button>
            {isNew && (
              <button className="btn-ghost" type="button" disabled={saving} onClick={() => save(true)}>
                Save &amp; New
              </button>
            )}
            <button className="btn-primary" type="button" disabled={saving} onClick={() => save(false)}>
              Save
            </button>
          </>
        )}
      </div>

      {!isNew && (
        <div className="mx-4 mt-4 md:mx-6">
          <DocketActions workOrder={wo!} showOpen={false} />
        </div>
      )}

      {draft && canEdit && (
        <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm md:mx-6">
          <span className="flex-1 font-semibold text-warn">Restore draft?</span>
          <span className="text-text-2">Unsaved work from {new Date(draft.savedAt).toLocaleString()}</span>
          <button
            className="btn-ghost min-h-9"
            onClick={() => {
              setForm(draft.form);
              // Keep the version the draft was written against, so a stale draft still gets the conflict warning.
              if (typeof draft.version === "number") setVersion(draft.version);
              setJobs(draft.jobs.length ? draft.jobs : DEFAULT_JOBS);
              setDirty(true);
              setDraft(null);
            }}
          >
            Restore
          </button>
          <button
            className="btn-ghost min-h-9"
            onClick={() => {
              clear();
              setDraft(null);
            }}
          >
            Discard
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mx-4 mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger md:mx-6">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-4 px-4 md:px-6 min-[1180px]:grid-cols-[minmax(0,1fr)_340px] min-[1180px]:items-start">
        <DocketPaper
          form={form}
          onChange={change}
          readOnly={!canEdit}
          showPrices={canEdit}
          workOrder={workOrder}
          nextWorkOrder={nextNumber.data?.workOrder ?? null}
          salespeople={ams.data?.map((a) => a.accountManager) ?? []}
        />
        <div className="min-[1180px]:sticky min-[1180px]:top-24">
          <ProductionPanel
            jobs={jobs}
            onChange={changeJobs}
            roles={roles.data ?? []}
            assignees={assignees.data ?? []}
            readOnly={!canEdit}
          />
        </div>
      </div>
    </div>
  );
}
