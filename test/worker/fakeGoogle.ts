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

  async readRange(a1: string) {
    this.check("readRange");
    const m = /!([A-Z])(\d+):([A-Z])(\d*)$/.exec(a1)!;
    const c1 = m[1].charCodeAt(0) - 65;
    const c2 = m[3].charCodeAt(0) - 65;
    const r2 = m[4] ? Number(m[4]) : this.rows.length;
    return this.rows.slice(Number(m[2]) - 1, r2).map((r) => r.slice(c1, c2 + 1));
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
