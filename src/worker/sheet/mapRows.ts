import {
  deriveBilling,
  deriveStatus,
  isRushText,
  normalizeAccountManager,
  parseSheetDate,
  type Billing,
  type DocketStatus,
} from "../../shared/rules";

/** Expected headers for columns A–P, compared after trim + whitespace collapse. */
export const EXPECTED_HEADERS = [
  "Date", "Due Date", "Work Order", "COMP", "HOLD", "#", "Customer", "Project", "Address", "",
  "ROLE", "Inv", "Inv/Date", "Quote / PO DEPOSIT", "Notes", "LINK",
];
const COL_J_ALIASES = ["", "Account Manager"];
const WIDTH = EXPECTED_HEADERS.length;

export type DocketRecord = {
  workOrder: string;
  sheetRow: number;
  dateIso: string | null;
  dateRaw: string | null;
  dueIso: string | null;
  dueRaw: string | null;
  dueRush: boolean;
  comp: boolean;
  hold: boolean;
  seq: string | null;
  customer: string | null;
  project: string | null;
  address: string | null;
  accountManager: string | null;
  roleNote: string | null;
  inv: boolean;
  invDateRaw: string | null;
  quotePo: string | null;
  notes: string | null;
  link: string | null;
  status: DocketStatus;
  billing: Billing;
  rowHash: string;
};

export type ReviewItem = {
  kind: "duplicate_work_order" | "invalid_work_order";
  workOrder: string | null;
  sheetRow: number;
  rawJson: string;
};

export class HeaderMismatchError extends Error {
  constructor(public column: string) {
    super(`Header mismatch: ${column}`);
    this.name = "HeaderMismatchError";
  }
}

const colLetter = (i: number) => String.fromCharCode(65 + i);
const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

function text(v: unknown): string | null {
  if (v == null || typeof v === "boolean") return null;
  const s = String(v).trim();
  return s || null;
}

const bool = (v: unknown) => v === true || (typeof v === "string" && v.trim().toUpperCase() === "TRUE");

function isEmptyRow(r: unknown[]): boolean {
  return r.every((v) => v == null || v === false || (typeof v === "string" && v.trim() === ""));
}

function parseWorkOrder(v: unknown): string | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim()) && Number(v) > 0) return String(Number(v));
  return null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function checkHeaders(header: unknown[] | undefined): void {
  for (let i = 0; i < WIDTH; i++) {
    const got = norm(header?.[i]);
    const ok = i === 9 ? COL_J_ALIASES.includes(got) : got === EXPECTED_HEADERS[i];
    if (!ok) throw new HeaderMismatchError(colLetter(i));
  }
}

export async function mapSheet(values: unknown[][]): Promise<{ dockets: DocketRecord[]; review: ReviewItem[] }> {
  checkHeaders(values[0]);
  const byWo = new Map<string, DocketRecord[]>();
  const review: ReviewItem[] = [];

  for (let i = 1; i < values.length; i++) {
    const r = [...(values[i] ?? [])];
    while (r.length < WIDTH) r.push("");
    if (isEmptyRow(r.slice(0, WIDTH))) continue;
    const sheetRow = i + 1;
    const rawJson = JSON.stringify(r.slice(0, WIDTH));

    const workOrder = parseWorkOrder(r[2]);
    if (!workOrder) {
      review.push({ kind: "invalid_work_order", workOrder: text(r[2]), sheetRow, rawJson });
      continue;
    }

    const date = parseSheetDate(r[0]);
    const due = parseSheetDate(r[1]);
    const comp = bool(r[3]);
    const hold = bool(r[4]);
    const invDateRaw = text(r[12]);
    const fields = {
      workOrder,
      dateIso: date.iso,
      dateRaw: date.raw,
      dueIso: due.iso,
      dueRaw: due.raw,
      dueRush: isRushText(due.raw),
      comp,
      hold,
      seq: text(r[5]),
      customer: text(r[6]),
      project: text(r[7]),
      address: text(r[8]),
      accountManager: normalizeAccountManager(r[9]),
      roleNote: text(r[10]),
      inv: bool(r[11]),
      invDateRaw,
      quotePo: text(r[13]),
      notes: text(r[14]),
      link: text(r[15]),
      status: deriveStatus({ comp, hold, dueRaw: due.raw, invDateRaw }),
      billing: deriveBilling(invDateRaw),
    };
    const rec: DocketRecord = { ...fields, sheetRow, rowHash: await sha256Hex(JSON.stringify(fields)) };
    const list = byWo.get(workOrder) ?? [];
    list.push(rec);
    byWo.set(workOrder, list);
  }

  const dockets: DocketRecord[] = [];
  for (const [wo, list] of byWo) {
    dockets.push(list[0]);
    if (list.length > 1) {
      for (const d of list) {
        review.push({
          kind: "duplicate_work_order",
          workOrder: wo,
          sheetRow: d.sheetRow,
          rawJson: JSON.stringify(values[d.sheetRow - 1]?.slice(0, WIDTH) ?? []),
        });
      }
    }
  }
  review.sort((a, b) => a.sheetRow - b.sheetRow);
  return { dockets, review };
}
