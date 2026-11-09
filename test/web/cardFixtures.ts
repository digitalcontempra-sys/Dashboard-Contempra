import type { CardDTO } from "../../src/shared/types";

export const makeCard = (over: Partial<CardDTO> = {}): CardDTO => ({
  id: 7,
  workOrder: "91488",
  jobName: "Whole docket",
  step: 2,
  roleId: "laminate_roll",
  status: "active",
  assigneeIds: [],
  team: true,
  claimedBy: null,
  fields: {},
  returned: null,
  version: 0,
  activatedAt: "2026-11-09T18:00:00Z",
  isNew: true,
  nextRoleId: "finishing",
  earlier: [
    { step: 0, roleId: "designer" },
    { step: 1, roleId: "printer_roll" },
  ],
  header: {
    customer: "Encore Lounge",
    accountManager: "JB",
    project: "Window letters",
    address: "12 Main St",
    bucket: "this_week",
    dueIso: "2026-11-12",
    dueRaw: null,
    proofRequired: false,
  },
  ...over,
});
