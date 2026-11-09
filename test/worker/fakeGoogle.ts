import { DriveFileNotFoundError, type DriveGateway } from "../../src/worker/google/drive";
import type { Gateways } from "../../src/worker/google/gateways";
import type { RowCells, SheetGateway } from "../../src/worker/google/sheets";
import { HEADER } from "./fixtures";

type SheetOp = "readRange" | "findRow" | "insertTopRow" | "updateCells" | "deleteRow";

/** In-memory `Contempra` tab. rows[0] is the header (sheet row 1). */
export class FakeSheet implements SheetGateway {
  rows: unknown[][] = [[...HEADER]];
  private failing = new Set<SheetOp>();
  private applyThenFailing = new Set<SheetOp>();
  /** Runs once right after the next findRow (simulates someone inserting rows meanwhile). */
  afterFind: (() => void) | null = null;

  /** The next `op` is applied by Google but the response is lost (timeout / 5xx after commit). */
  applyThenFail(op: SheetOp) {
    this.applyThenFailing.add(op);
  }
  private lost(op: SheetOp) {
    if (this.applyThenFailing.delete(op)) throw new Error("Google request failed: timeout");
  }

  failNext(op: SheetOp) {
    this.failing.add(op);
  }
  private check(op: SheetOp) {
    if (this.failing.delete(op)) throw new Error(`Google Sheets write failed (503)`);
  }
  /** Row values of a work order (A..P), or undefined. */
  rowOf(wo: string) {
    return this.rows.find((r, i) => i > 0 && String(r[2] ?? "") === wo);
  }

  /** Other tabs by title ("Production", "Legacy Q-Y"). */
  tabs: Record<string, unknown[][]> = {};
  private grid(a1: string, create = false): unknown[][] {
    const name = a1.split("!")[0].replace(/^'|'$/g, "").replace(/''/g, "'");
    if (name === "Contempra") return this.rows;
    if (!this.tabs[name]) {
      if (!create) throw new Error(`Unable to parse range: ${a1}`);
      this.tabs[name] = [];
    }
    return this.tabs[name];
  }

  async readRange(a1: string) {
    this.check("readRange");
    const rows = this.grid(a1);
    const m = /!([A-Z])(\d+):([A-Z])(\d*)$/.exec(a1)!;
    const c1 = m[1].charCodeAt(0) - 65;
    const c2 = m[3].charCodeAt(0) - 65;
    const r2 = m[4] ? Number(m[4]) : rows.length;
    return rows.slice(Number(m[2]) - 1, r2).map((r) => r.slice(c1, c2 + 1));
  }
  async ensureTab(title: string) {
    this.grid(`'${title}'!A1`, true);
  }
  async writeRange(a1: string, values: unknown[][]) {
    this.check("updateCells");
    await this.write(a1, values);
  }
  private async write(a1: string, values: unknown[][]) {
    const rows = this.grid(a1);
    const m = /!([A-Z])(\d+)/.exec(a1)!;
    const c0 = m[1].charCodeAt(0) - 65;
    const r0 = Number(m[2]) - 1;
    values.forEach((vals, i) => {
      while (rows.length <= r0 + i) rows.push([]);
      const row = rows[r0 + i];
      while (row.length < c0) row.push("");
      vals.forEach((v, j) => (row[c0 + j] = v));
    });
  }
  async writeRanges(data: { range: string; values: unknown[][] }[]) {
    this.check("updateCells");
    for (const d of data) await this.write(d.range, d.values);
  }
  async appendRows(tab: string, values: unknown[][]) {
    this.check("updateCells");
    this.grid(`'${tab}'!A1`).push(...values.map((v) => [...v]));
  }
  async clearColumns(fromCol: string, toCol: string, fromRow: number) {
    const c1 = fromCol.charCodeAt(0) - 65;
    const c2 = toCol.charCodeAt(0) - 65;
    this.rows.forEach((r, i) => {
      if (i < fromRow - 1) return;
      for (let c = c1; c <= c2 && c < r.length; c++) r[c] = "";
    });
  }
  async findRow(wo: string) {
    this.check("findRow");
    const i = this.rows.findIndex((r, idx) => idx > 0 && String(r[2] ?? "") === wo);
    const hook = this.afterFind;
    this.afterFind = null;
    hook?.();
    return i < 0 ? null : i + 1;
  }
  async insertTopRow(cells: RowCells) {
    this.check("insertTopRow");
    const row = Array.from({ length: 16 }, (_, i) => cells[String.fromCharCode(65 + i)] ?? "");
    this.rows.splice(1, 0, row);
    this.lost("insertTopRow");
  }
  async updateCells(row: number, cells: RowCells) {
    this.check("updateCells");
    for (const [col, v] of Object.entries(cells)) this.rows[row - 1][col.charCodeAt(0) - 65] = v ?? "";
  }
  async deleteRow(row: number) {
    this.check("deleteRow");
    this.rows.splice(row - 1, 1);
  }
}

export class FakeDrive implements DriveGateway {
  files = new Map<string, { name: string; bytes: number; trashed: boolean }>();
  private fail = false;
  private n = 0;
  uploads = 0;
  active = 0;
  maxActive = 0;
  /** When set, uploads wait on it (lets a test hold an upload "in flight"). */
  gate: Promise<void> | null = null;
  failNext() {
    this.fail = true;
  }
  async ensureRootFolder() {
    return "root";
  }
  async upload(wo: string, title: string, _year: number, pdf: ArrayBuffer, existingId?: string | null) {
    this.uploads++;
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.gate) await this.gate;
    } finally {
      this.active--;
    }
    if (this.fail) {
      this.fail = false;
      throw new Error("Google Drive request failed (503)");
    }
    if (existingId && !this.files.has(existingId)) throw new DriveFileNotFoundError(existingId);
    const id = existingId ?? `file-${++this.n}`;
    this.files.set(id, { name: `${wo} - ${title}.pdf`, bytes: pdf.byteLength, trashed: false });
    return { id, link: `https://drive.google.com/file/d/${id}/view` };
  }
  async trash(fileId: string) {
    const f = this.files.get(fileId);
    if (f) f.trashed = true;
  }
}

export function fakeGateways(): Gateways & { sheet: FakeSheet; drive: FakeDrive } {
  return { sheet: new FakeSheet(), drive: new FakeDrive() };
}
