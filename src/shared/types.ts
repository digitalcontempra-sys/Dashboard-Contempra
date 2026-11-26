import type { Billing, DashSection, DocketStatus, TimeBucket } from "./rules";
export type { Billing, DashSection, DocketStatus, TimeBucket };

export type VirtualDocketDTO = {
  workOrder: string;
  form: import("./docketForm").DocketForm;
  jobs: import("./docketForm").ProductionJob[];
  /** The docket has cards: it was handed to someone (it cannot be handed over again from the editor). */
  inProduction: boolean;
  /** Saved with "Save as New Order": waiting for more info until it is handed to people. */
  newOrder: boolean;
  version: number;
  source: "virtual" | "sheet";
  pdf: { stored: boolean; driveLink: string | null; driveStatus: string };
  deletedAt: string | null;
  /** Notes (O) from the sheet mirror; null when empty or not in the mirror. Link (P, the PDF in Drive) stays in the sheet only. */
  sheet: { notes: string | null };
};

export type TrashItem = { workOrder: string; forName: string; deletedAt: string; deletedBy: string | null; daysLeft: number };

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
  /** Main Dashboard section: New Orders, Daily Complete, or the time bucket. */
  section: DashSection;
  /** Daily Complete: when the creator's card became Ready to close. */
  readySince: string | null;
  overdue: boolean;
  /** Finishing marked it ready for vendor pickup (list endpoint only). */
  vendorPickup?: boolean;
  /** Areas (role ids) the docket is in right now, in production order (list endpoint only). */
  areas?: string[];
  /** Every production card is done (list endpoint only). */
  productionDone?: boolean;
  /** Who has the docket now, per area in production order (names empty for a team card nobody started). */
  holders?: Holder[];
  /** In the viewer's My List (dashboard list and detail only). */
  followed?: boolean;
  /** The viewer's open notes pinned to this docket (dashboard list and detail only). */
  myOpenNotes?: number;
};

export type Holder = { roleId: string; names: string[] };

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

export type DocketListResponse = Page<DocketSummary> & { counts: Record<DashSection, number> };

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
  /** False until a Google Sheet id and service account are set on the Worker. */
  configured: boolean;
};

export type AccessLevel = "admin" | "manager" | "staff";

export type AssigneeDTO = { id: number; fullName: string; roles: string[] };

export type RoleDTO = { id: string; label: string };

/** An Installer crew: sending the docket to it gives one card to all its members. */
export type TeamDTO = { id: number; name: string; roleId: string; members: { id: number; fullName: string }[] };

export type UserDTO = {
  id: number;
  username: string;
  fullName: string;
  accessLevel: AccessLevel;
  roles: string[];
  active: boolean;
  /** Codes in sheet column J (Account Manager); the first is the main one. */
  codes: string[];
};

export type SessionUser = {
  id: number;
  username: string;
  fullName: string;
  accessLevel: AccessLevel;
  roles: string[];
  /** Set on imported or reset accounts until the person chooses their own password. */
  mustChangePassword?: boolean;
  /** Codes in sheet column J (Account Manager); the first is the main one. Sent by /auth/me and login. */
  codes?: string[];
};

export type CardDTO = {
  id: number;
  workOrder: string;
  jobName: string;
  step: number;
  roleId: string;
  status: import("./cards").CardStatus;
  assigneeIds: number[];
  team: boolean;
  /** Installer crew the card was sent to ("Team B"); null for a card sent to one person. */
  teamName: string | null;
  claimedBy: { id: number; name: string } | null;
  fields: import("./cards").CardFields;
  returned: { reason: string; by: string } | null;
  version: number;
  activatedAt: string | null;
  isNew: boolean;
  nextRoleId: string | null;
  earlier: { step: number; roleId: string }[];
  /** Hand-off card (1 person, from someone); false for a card of an old fixed route. */
  handoff: boolean;
  /** "What to do", written by whoever handed the docket over. */
  instruction: string | null;
  /** Who handed it over: Send back returns the docket to them. */
  from: { id: number; name: string } | null;
  /** Set on the creator's card: why the docket came back. */
  stage: import("./handoff").CardStage | null;
  /** Which approval this card can ask for (Proof sent / Sample sent). */
  approval: "proof" | "sample" | null;
  header: {
    customer: string | null;
    accountManager: string | null;
    project: string | null;
    address: string | null;
    bucket: TimeBucket;
    dueIso: string | null;
    dueRaw: string | null;
    proofRequired: boolean;
  };
};

export type CardEventDTO = { at: string; area: string; user: string | null; action: string; detail: string };

/** newCount includes newTasks (they ring); doneTasks are the sender's soft alerts (no chime). */
export type MyCardsSummary = { newCount: number; activeCount: number; soundOn: boolean; newTasks?: number; doneTasks?: number };

export type TaskCardDTO = {
  id: number;
  from: { id: number; name: string };
  to: { id: number; name: string };
  note: string;
  due: import("./taskCards").TaskDue;
  bucket: TimeBucket;
  status: "open" | "done";
  createdAt: string;
  doneAt: string | null;
  isNew: boolean;
  /** A note to self pinned to this docket, or null. */
  workOrder: string | null;
};

/** One page of finished Task Cards I sent or received, newest first. */
export type TaskHistoryPage = { items: TaskCardDTO[]; hasMore: boolean };

export type BoardCard = CardDTO & { noMembers: boolean };

export type BoardDTO = {
  columns: { roleId: string; area: string; cards: BoardCard[] }[];
  productionColumnsReady: boolean;
  /** The sheet was set up once before (an older layout): the next setup only updates it. */
  productionColumnsSetUp: boolean;
};
