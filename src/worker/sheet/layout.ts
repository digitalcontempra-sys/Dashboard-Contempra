import type { RowCells, SheetGateway } from "../google/sheets";

/**
 * The Contempra tab can have a real STATUS column inserted after ROLE (K). The code keeps using the
 * original letters (A–P, Q–AC: "logical" columns); this module moves them to where they really are
 * ("physical") once the column exists, so nothing else needs to know which layout a sheet has.
 *
 * Logical cell key for the STATUS column (written only when the column exists).
 */
export const STATUS_KEY = "STATUS";
export const STATUS_HEADER = "STATUS";
/** Physical position of STATUS (column L); logical columns from L on move one to the right. */
export const STATUS_INDEX = 11;
const SETTING = "status_column";

/** "A" -> 0, "Z" -> 25, "AA" -> 26. */
export const colIndex = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const shift = (col: string, on: boolean) => (on && colIndex(col) >= STATUS_INDEX ? colName(colIndex(col) + 1) : col);
const CONTEMPRA = /^(Contempra|'Contempra')!([A-Z]{1,2})(\d*)(?::([A-Z]{1,2})(\d*))?$/;

/** The physical A1 range of a logical one, and which column of its rows is STATUS (to drop on reads). */
export function physicalRange(a1: string, on: boolean): { range: string; drop: number | null } {
  const m = CONTEMPRA.exec(a1);
  if (!on || !m) return { range: a1, drop: null };
  const [, tab, c1, r1, c2, r2] = m;
  const range = `${tab}!${shift(c1, on)}${r1}${c2 ? `:${shift(c2, on)}${r2}` : ""}`;
  const spans = c2 !== undefined && colIndex(c1) < STATUS_INDEX && colIndex(c2) >= STATUS_INDEX;
  return { range, drop: spans ? STATUS_INDEX - colIndex(c1) : null };
}

const dropColumn = (rows: unknown[][], drop: number | null) =>
  drop === null ? rows : rows.map((r) => (r.length > drop ? [...r.slice(0, drop), ...r.slice(drop + 1)] : r));

/** Logical cells to physical ones. STATUS goes to L, or is dropped when the column does not exist. */
export function physicalCells(cells: RowCells, on: boolean): RowCells {
  const out: RowCells = {};
  for (const [k, v] of Object.entries(cells)) {
    if (k === STATUS_KEY) {
      if (on) out[colName(STATUS_INDEX)] = v;
    } else out[shift(k, on)] = v;
  }
  return out;
}

/** True when the connected sheet has had its STATUS column inserted. */
export async function statusColumnOn(db: D1Database): Promise<boolean> {
  const r = await db
    .prepare(
      `SELECT (SELECT value FROM app_settings WHERE key = '${SETTING}') AS v,
              (SELECT coalesce(sheet_id, '') FROM google_connection WHERE id = 1) AS sheet`,
    )
    .first<{ v: string | null; sheet: string | null }>();
  return r?.v != null && r.v === (r.sheet ?? "");
}

/** Remembers that the connected sheet now has the STATUS column. */
export async function markStatusColumn(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES ('${SETTING}', coalesce((SELECT sheet_id FROM google_connection WHERE id = 1), ''))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run();
}

type Reader = (range: string) => Promise<unknown[][]>;

/** A range reader that speaks logical columns. */
export function layoutReader(read: Reader, on: () => Promise<boolean>): Reader {
  return async (a1) => {
    const p = physicalRange(a1, await on());
    return dropColumn(await read(p.range), p.drop);
  };
}

/** A sheet gateway that speaks logical columns, whatever the sheet's layout. */
export function layoutAware(sheet: SheetGateway, isOn: () => Promise<boolean>): SheetGateway {
  let cached: Promise<boolean> | null = null;
  const on = () => (cached ??= isOn());
  const range = async (a1: string) => {
    const p = physicalRange(a1, await on());
    // A write spanning K..L would put its L value into STATUS: no caller does this; refuse it.
    if (p.drop !== null) throw new Error(`Write across the STATUS column is not supported: ${a1}`);
    return p.range;
  };
  return {
    readRange: layoutReader((r) => sheet.readRange(r), on),
    findRow: (wo) => sheet.findRow(wo),
    insertTopRow: async (cells) => sheet.insertTopRow(physicalCells(cells, await on())),
    updateCells: async (row, cells) => sheet.updateCells(row, physicalCells(cells, await on())),
    deleteRow: (row) => sheet.deleteRow(row),
    ensureTab: (title) => sheet.ensureTab(title),
    writeRange: async (a1, values) => sheet.writeRange(await range(a1), values),
    writeRanges: async (data, input) =>
      sheet.writeRanges(await Promise.all(data.map(async (d) => ({ range: await range(d.range), values: d.values }))), input),
    appendRows: (tab, values) => sheet.appendRows(tab, values),
    clearColumns: async (from, to, fromRow) => {
      const o = await on();
      return sheet.clearColumns(shift(from, o), shift(to, o), fromRow);
    },
    insertStatusColumn: () => sheet.insertStatusColumn(),
  };
}
