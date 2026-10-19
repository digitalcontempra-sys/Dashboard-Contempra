export type { Billing, DocketStatus, TimeBucket } from "./rules";

export type SyncStatus = {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  rowsSeen: number;
  rowsChanged: number;
  rowsDeleted: number;
};

export type AccessLevel = "admin" | "manager" | "staff";

export type SessionUser = {
  id: number;
  username: string;
  fullName: string;
  accessLevel: AccessLevel;
  roles: string[];
};
