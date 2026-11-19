// Log tables such as "Opened" and "Sold": one row per event, each on its own
// sheet, created automatically (sheet + header + first row + table) the first
// time something is recorded.

import { headersOf, recordFrom, type Cell } from "./data";
import { GraphError, type TableSnapshot, type Workbook } from "./graph";
import { cellAddress, colLetter } from "./sheet";
import { appendRow, nextId } from "./tableops";

export interface LogSpec {
  /** Table name; the sheet has the same name. */
  table: string;
  columns: readonly string[];
  idHeader: string;
  idPrefix: string;
  idWidth: number;
  /** Number formats for columns of the first row (later rows inherit them). */
  formats?: Record<string, string>;
  /** Columns that must be stored as numbers. */
  numeric?: string[];
  /** Shown if the sheet can't be added, e.g. "bottle history". */
  what: string;
}

/** The table, or null if it hasn't been created yet. */
export async function readLog(wb: Workbook, table: string): Promise<TableSnapshot | null> {
  try {
    return await wb.readTable(table);
  } catch (e) {
    if (e instanceof GraphError && (e.status === 404 || /notfound/i.test(e.code))) return null;
    throw e;
  }
}

const isBlank = (row: Cell[]) => row.every((v) => v === null || v === "");

/** Row address (table columns only) of body row `i` (0-based). */
function rowRange(snap: TableSnapshot, i: number): string {
  const r = snap.address.firstRow + 1 + i;
  return `${cellAddress(snap.address.firstCol, r)}:${cellAddress(snap.address.lastCol, r)}`;
}

/** Adds one row (with the next free ID) and returns it as a record. */
export async function appendLog(wb: Workbook, spec: LogSpec, values: Record<string, Cell>): Promise<Record<string, Cell>> {
  const snap = await readLog(wb, spec.table);
  if (!snap) {
    values[spec.idHeader] = `${spec.idPrefix}${"1".padStart(spec.idWidth, "0")}`;
    try {
      await wb.addWorksheet(spec.table);
    } catch (e) {
      throw new Error(
        `Couldn't add a "${spec.table}" sheet for the ${spec.what}. If a sheet with that name already exists, rename it and try again. (${e instanceof Error ? e.message : e})`,
      );
    }
    const last = colLetter(spec.columns.length - 1);
    await wb.writeValues(spec.table, `A1:${last}2`, [[...spec.columns], spec.columns.map((h) => values[h] ?? "")]);
    for (const [h, f] of Object.entries(spec.formats ?? {})) {
      const c = spec.columns.indexOf(h);
      if (c >= 0) await wb.writeNumberFormat(spec.table, `${colLetter(c)}2`, [[f]]);
    }
    await wb.addTable(spec.table, `A1:${last}2`, spec.table);
    return { ...values };
  }

  const headers = headersOf(snap.values[0]);
  values[spec.idHeader] = nextId(snap, spec.idHeader, spec.idPrefix, spec.idWidth);
  // A table emptied by Undo keeps one blank row: fill that instead of adding below it.
  const blank = snap.values.findIndex((r, k) => k > 0 && isBlank(r));
  if (blank > 0) {
    const row = headers.map((h) => values[h] ?? "");
    await wb.writeValues(snap.address.sheet, rowRange(snap, blank - 1), [row]);
    return recordFrom(headers, row);
  }
  const row = await appendRow(wb, spec.table, snap, values, {}, spec.numeric ?? []);
  return recordFrom(headers, row);
}

/** Removes the row with this ID (a table keeps its last row, blanked). */
export async function removeLog(wb: Workbook, spec: Pick<LogSpec, "table" | "idHeader">, id: string): Promise<void> {
  const snap = await readLog(wb, spec.table);
  if (!snap) return;
  const idCol = headersOf(snap.values[0]).indexOf(spec.idHeader);
  const i = snap.values.findIndex((r, k) => k > 0 && String(r[idCol] ?? "") === id);
  if (i < 0) return;
  if (snap.values.length - 1 === 1) {
    await wb.writeValues(snap.address.sheet, rowRange(snap, 0), [snap.values[0].map(() => "")]);
  } else {
    await wb.deleteRange(snap.address.sheet, rowRange(snap, i - 1));
  }
}
