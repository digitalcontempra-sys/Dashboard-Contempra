import type { Billing, DocketStatus, TimeBucket } from "./rules";
export type { Billing, DocketStatus, TimeBucket };

export type DocketView = "active" | "on_hold" | "history";
export type HistoryFilter = "all" | "completed" | "cancelled";
export type NonBilledTab = "ready" | "open";
export const PAGE_SIZE = 50;

export type DocketSummary = {
  workOrder: string;
  customer: string | null;
  project: string | null;
  accountManager: string | null;
  dateIso: string | null;
  dueIso: string | null;
  dueRaw: string | null;
  status: DocketStatus;
  billing: Billing;
  bucket: TimeBucket;
  overdue: boolean;
};

export type DocketDetail = DocketSummary & {
  sheetRow: number;
  dateRaw: string | null;
  comp: boolean;
  hold: boolean;
  seq: string | null;
  address: string | null;
  roleNote: string | null;
  inv: boolean;
  invDateRaw: string | null;
  quotePo: string | null;
  notes: string | null;
  link: string | null;
  syncedAt: string;
};

export type NonBilledItem = DocketSummary & { ageDays: number | null };

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export type DocketListResponse = Page<DocketSummary> & { counts: Record<TimeBucket, number> };

export type ReviewItemDTO = {
  kind: "duplicate_work_order" | "invalid_work_order";
  workOrder: string | null;
  rows: { sheetRow: number; values: unknown[] }[];
};

export type AccountManagerCount = { accountManager: string; count: number };

export type SyncStatus = {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  rowsSeen: number;
  rowsChanged: number;
  rowsDeleted: number;
};

export type AccessLevel = "admin" | "manager" | "staff";

export type RoleDTO = { id: string; label: string };

export type UserDTO = {
  id: number;
  username: string;
  fullName: string;
  accessLevel: AccessLevel;
  roles: string[];
  active: boolean;
};

export type SessionUser = {
  id: number;
  username: string;
  fullName: string;
  accessLevel: AccessLevel;
  roles: string[];
};
