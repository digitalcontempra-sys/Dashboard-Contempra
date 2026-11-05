import { BUSINESS_TZ, isRushText } from "./rules";
import type { DocketDetail } from "./types";

/** The paper Contempra docket, field by field (spec §3). Money and hours stay strings as typed. */
export type DocketForm = {
  quoteNo: string;
  date: string; // YYYY-MM-DD
  required: { kind: "date"; date: string } | { kind: "text"; text: RequiredText } | { kind: "none" };
  forName: string;
  address: string;
  contact: string;
  phone: string;
  fax: string;
  email: string;
  poNo: string;
  invoiceNo: string;
  orderTakenBy: string;
  salesperson: string;
  cod: boolean;
  charge: boolean;
  newAccount: boolean;
  repeat: boolean;
  body: string;
  proofRequired: boolean;
  labour: { name: string; work: string; hrs: string; date: string }[];
  materials: { name: string; cost: string }[];
  savedAs: string;
  delivery: string;
  gst: string | null; // null = automatic 5%
  pst: string | null; // null = automatic 7%
  deposit: string;
  service: ServiceKind[];
  callWhenReady: boolean;
  goodsReceivedBy: string;
};

export type RequiredText = "RUSH" | "ASAP" | "NOW";
export type ServiceKind = "INSTALLATION" | "DELIVERY" | "SERVICE" | "PICKUP";
export const REQUIRED_TEXTS: RequiredText[] = ["RUSH", "ASAP", "NOW"];
export const SERVICE_KINDS: ServiceKind[] = ["INSTALLATION", "DELIVERY", "SERVICE", "PICKUP"];
export const LABOUR_ROWS = 8;
export const MATERIAL_ROWS = 7;
export const GST_RATE = 0.05;
export const PST_RATE = 0.07;
export const WHOLE_DOCKET = "Whole docket";

export type ProductionJob = { name: string; steps: { roleId: string; assigneeIds: number[] }[] };

export type SheetColumn = "A" | "B" | "C" | "D" | "E" | "G" | "H" | "I" | "J" | "L" | "M" | "N";

export function emptyForm(todayIso: string, orderTakenBy: string): DocketForm {
  return {
    quoteNo: "",
    date: todayIso,
    required: { kind: "none" },
    forName: "",
    address: "",
    contact: "",
    phone: "",
    fax: "",
    email: "",
    poNo: "",
    invoiceNo: "",
    orderTakenBy,
    salesperson: "",
    cod: false,
    charge: false,
    newAccount: false,
    repeat: false,
    body: "",
    proofRequired: false,
    labour: Array.from({ length: LABOUR_ROWS }, () => ({ name: "", work: "", hrs: "", date: "" })),
    materials: Array.from({ length: MATERIAL_ROWS }, () => ({ name: "", cost: "" })),
    savedAs: "",
    delivery: "",
    gst: null,
    pst: null,
    deposit: "",
    service: [],
    callWhenReady: false,
    goodsReceivedBy: "",
  };
}

/** "$1,000.50" -> 100050 cents; anything unparsable counts as 0. */
export function toCents(s: string | null | undefined): number {
  const n = Number.parseFloat(String(s ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const dollars = (cents: number) => cents / 100;

export function computeTotals(f: DocketForm): {
  total: number;
  delivery: number;
  deposit: number;
  subtotal: number;
  gst: number;
  pst: number;
  grandTotal: number;
  balanceDue: number;
} {
  // All math in integer cents so 5% of $160.50 is $8.03, not $8.02.
  const total = f.materials.reduce((sum, m) => sum + toCents(m.cost), 0);
  const subtotal = total + toCents(f.delivery);
  const gst = f.gst === null ? Math.round(subtotal * GST_RATE) : toCents(f.gst);
  const pst = f.pst === null ? Math.round(subtotal * PST_RATE) : toCents(f.pst);
  const grand = subtotal + gst + pst;
  return {
    total: dollars(total),
    delivery: dollars(toCents(f.delivery)),
    deposit: dollars(toCents(f.deposit)),
    subtotal: dollars(subtotal),
    gst: dollars(gst),
    pst: dollars(pst),
    grandTotal: dollars(grand),
    balanceDue: dollars(grand - toCents(f.deposit)),
  };
}

const SUMMARY_MAX = 200;

/** Project column (H): the body's non-empty lines joined with " / ", at most 200 characters. */
export function summarizeBody(body: string): string {
  const joined = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" / ");
  if (joined.length <= SUMMARY_MAX) return joined;
  const cut = joined.slice(0, SUMMARY_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 100 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** YYYY-MM-DD -> Sheets serial (days since 1899-12-30). Inverse of parseSheetDate. */
export function isoToSerial(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000) + 25569;
}

/** Cells to write for this docket (spec §4). Edit mode never sends C/D/E/L, and M/N only when filled. */
export function toSheetCells(f: DocketForm, wo: string, mode: "create" | "edit"): Partial<Record<SheetColumn, string | number | boolean>> {
  const cells: Partial<Record<SheetColumn, string | number | boolean>> = {
    A: f.date ? isoToSerial(f.date) : "",
    B: f.required.kind === "date" ? isoToSerial(f.required.date) : f.required.kind === "text" ? f.required.text : "",
    G: f.forName.trim(),
    H: summarizeBody(f.body),
    I: f.address.trim(),
    J: f.salesperson.trim().toUpperCase(),
  };
  if (mode === "create") Object.assign(cells, { C: Number(wo), D: false, E: false, L: false });
  if (f.invoiceNo.trim()) cells.M = f.invoiceNo.trim();
  const qp = [f.quoteNo.trim() && `Q ${f.quoteNo.trim()}`, f.poNo.trim() && `PO ${f.poNo.trim()}`].filter(Boolean).join(" / ");
  if (qp) cells.N = qp;
  return cells;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "CANCEL 5-NOV-26": the format already used in the Inv/Date column. */
export function cancelStamp(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `CANCEL ${Number(parts.day)}-${MONTHS[Number(parts.month) - 1]}-${parts.year.slice(-2)}`;
}

/** Copy without any price (for Staff). */
export function stripPrices(f: DocketForm): DocketForm {
  return {
    ...f,
    materials: f.materials.map((m) => ({ ...m, cost: "" })),
    delivery: "",
    deposit: "",
    gst: null,
    pst: null,
  };
}

/** A form prefilled from a docket that was created directly in the sheet. */
/** Splits column N ("Q 1234 / PO 5678", as toSheetCells writes it) back into quote and PO; other text goes to PO. */
export function parseQuotePo(raw: string | null): { quoteNo: string; poNo: string } {
  const s = (raw ?? "").trim();
  const part = (tag: string) =>
    s
      .split("/")
      .map((p) => p.trim())
      .find((p) => p.toUpperCase().startsWith(`${tag} `))
      ?.slice(tag.length)
      .trim() ?? "";
  const quoteNo = part("Q");
  const poNo = part("PO");
  return quoteNo || poNo ? { quoteNo, poNo } : { quoteNo: "", poNo: s };
}

/** A form prefilled from a docket created directly in the sheet. ORDER TAKEN BY stays blank: nobody knows who took it. */
export function formFromDocket(d: DocketDetail): DocketForm {
  const f = emptyForm(d.dateIso ?? new Date().toISOString().slice(0, 10), "");
  const rushText = REQUIRED_TEXTS.find((t) => d.dueRaw?.trim().toUpperCase().startsWith(t));
  return {
    ...f,
    required: d.dueIso
      ? { kind: "date", date: d.dueIso }
      : rushText && isRushText(d.dueRaw)
        ? { kind: "text", text: rushText }
        : { kind: "none" },
    forName: d.customer ?? "",
    address: d.address ?? "",
    salesperson: d.accountManager ?? "",
    body: d.project ?? "",
    ...parseQuotePo(d.quotePo),
    invoiceNo: d.status === "cancelled" ? "" : (d.invDateRaw ?? ""),
  };
}
