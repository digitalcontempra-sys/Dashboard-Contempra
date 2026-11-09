import { readSheetRange, SheetFetchError, type GoogleEnv } from "../sheet/googleClient";
import { getAccessToken, getConnection, googleFetch } from "./oauth";

export type CellValue = string | number | boolean | null | undefined;
export type RowCells = Partial<Record<string, CellValue>>;

/** The write path to the `Contempra` tab. Rows are always located by Work Order (column C). */
export interface SheetGateway {
  readRange(a1: string): Promise<unknown[][]>;
  findRow(wo: string): Promise<number | null>;
  insertTopRow(cells: RowCells): Promise<void>;
  updateCells(row: number, cells: RowCells): Promise<void>;
  deleteRow(row: number): Promise<void>;
  /** Adds the tab when it does not exist yet. */
  ensureTab(title: string): Promise<void>;
  /** Writes raw values starting at the range's top-left cell (any tab). */
  writeRange(a1: string, values: unknown[][]): Promise<void>;
  /** Appends raw rows after the last row of a tab. */
  appendRows(tab: string, values: unknown[][]): Promise<void>;
  /** Clears values and data validation (old checkboxes) of the Contempra tab's columns, from a row down. */
  clearColumns(fromCol: string, toCol: string, fromRow: number): Promise<void>;
}

/** A1 tab prefix, quoted so names with spaces or dashes work: 'Legacy Q-Y'!A1. */
export const tabRef = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

const TAB = "Contempra";
const WIDTH = 16; // A..P
const colIndex = (col: string) => col.charCodeAt(0) - 65;

function cellData(v: CellValue) {
  if (v === null || v === undefined || v === "") return {};
  if (typeof v === "boolean") return { userEnteredValue: { boolValue: v } };
  if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
  return { userEnteredValue: { stringValue: v } };
}

export function realSheetGateway(env: GoogleEnv): SheetGateway {
  async function target() {
    const conn = await getConnection(env.DB);
    if (!conn?.sheetId || conn.sheetGid === null) throw new SheetFetchError("Google Sheet is not connected yet", null);
    return { id: conn.sheetId, gid: conn.sheetGid };
  }

  async function call(url: string, body: unknown): Promise<void> {
    const token = await getAccessToken(env);
    const res = await googleFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new SheetFetchError(`Google Sheets write failed (${res.status})`, res.status);
  }

  async function batchUpdate(requests: unknown[]) {
    const { id } = await target();
    await call(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { requests });
  }

  return {
    readRange: (a1) => readSheetRange(env, a1),

    async findRow(wo) {
      const column = await readSheetRange(env, `${TAB}!C1:C`);
      const i = column.findIndex((r, idx) => idx > 0 && String(r?.[0] ?? "").trim() === wo);
      return i < 0 ? null : i + 1;
    },

    async insertTopRow(cells) {
      const { gid } = await target();
      const values = Array.from({ length: WIDTH }, (_, i) => cellData(cells[String.fromCharCode(65 + i)]));
      await batchUpdate([
        // Insert below the header; the new row takes formats/checkboxes from the row under it.
        { insertDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: 1, endIndex: 2 }, inheritFromBefore: false } },
        {
          updateCells: {
            start: { sheetId: gid, rowIndex: 1, columnIndex: 0 },
            rows: [{ values }],
            fields: "userEnteredValue",
          },
        },
      ]);
    },

    async updateCells(row, cells) {
      const { id } = await target();
      const data = Object.entries(cells)
        .filter(([col]) => colIndex(col) >= 0 && colIndex(col) < 26)
        .map(([col, v]) => ({ range: `${TAB}!${col}${row}`, values: [[v ?? ""]] }));
      if (data.length === 0) return;
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, { valueInputOption: "RAW", data });
    },

    async ensureTab(title) {
      const { id } = await target();
      const token = await getAccessToken(env);
      const res = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new SheetFetchError(`Google Sheets read failed (${res.status})`, res.status);
      const json = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
      if ((json.sheets ?? []).some((s) => s.properties?.title === title)) return;
      await batchUpdate([{ addSheet: { properties: { title } } }]);
    },

    async writeRange(a1, values) {
      const { id } = await target();
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
        valueInputOption: "RAW",
        data: [{ range: a1, values }],
      });
    },

    async appendRows(tab, values) {
      const { id } = await target();
      const range = encodeURIComponent(`${tabRef(tab)}!A1`);
      await call(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values },
      );
    },

    async clearColumns(fromCol, toCol, fromRow) {
      const { gid } = await target();
      await batchUpdate([
        {
          repeatCell: {
            range: { sheetId: gid, startRowIndex: fromRow - 1, startColumnIndex: colIndex(fromCol), endColumnIndex: colIndex(toCol) + 1 },
            cell: {},
            fields: "userEnteredValue,dataValidation",
          },
        },
      ]);
    },

    async deleteRow(row) {
      const { gid } = await target();
      await batchUpdate([{ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: row - 1, endIndex: row } } }]);
    },
  };
}
