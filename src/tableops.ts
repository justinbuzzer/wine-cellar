// Shared, safe row operations for Excel tables:
//  - rows are found by their ID column in a fresh read, never by a cached row number
//  - only cells whose value actually changes are written (formulas elsewhere survive)
//  - new rows get the next free ID; formula columns are written as formulas

import { headersOf, type Cell } from "./data";
import type { TableSnapshot, Workbook } from "./graph";
import { cellAddress } from "./sheet";

export interface Located {
  sheet: string;
  headers: string[];
  row: Cell[];
  col(header: string): number;
  addressOf(header: string): string;
}

export function locateById(snap: TableSnapshot, idHeader: string, id: string, what: string): Located {
  const headers = headersOf(snap.values[0]);
  const idCol = headers.indexOf(idHeader);
  if (idCol < 0) throw new Error(`The table has no ${idHeader} column.`);
  const i = snap.values.findIndex((r, k) => k > 0 && String(r[idCol] ?? "") === id);
  if (i < 0) throw new Error(`${what} ${id} is no longer in the spreadsheet. Reload and try again.`);
  const col = (h: string) => {
    const c = headers.indexOf(h);
    if (c < 0) throw new Error(`The table has no "${h}" column.`);
    return c;
  };
  return {
    sheet: snap.address.sheet,
    headers,
    row: [...snap.values[i]],
    col,
    addressOf: (h) => cellAddress(snap.address.firstCol + col(h), snap.address.firstRow + i),
  };
}

/** Writes only the cells whose value differs from what's in the spreadsheet now. */
export async function setCells(wb: Workbook, at: Located, changes: Record<string, Cell>): Promise<void> {
  for (const [h, v] of Object.entries(changes)) {
    const c = at.col(h);
    const current = at.row[c];
    if (String(current ?? "") === String(v ?? "")) continue;
    await wb.writeCell(at.sheet, at.addressOf(h), v);
    at.row[c] = v ?? "";
  }
}

/** Next ID such as W0606 or T02679, based on the highest existing one. */
export function nextId(snap: TableSnapshot, idHeader: string, prefix: string, width: number): string {
  const headers = headersOf(snap.values[0]);
  const idCol = headers.indexOf(idHeader);
  if (idCol < 0) throw new Error(`The table has no ${idHeader} column.`);
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const max = snap.values.slice(1).reduce((m, r) => {
    const hit = re.exec(String(r[idCol] ?? ""));
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

/**
 * Appends a row.
 * - `formulas` maps header -> formula for calculated columns.
 * - `numeric` lists columns that must hold real numbers.
 * New table rows inherit the column's number format, and a column formatted as
 * Text would store numbers and formulas as plain text. So after adding the row,
 * those cells are set to "General" and their numbers and formulas are written
 * again explicitly.
 */
export async function appendRow(
  wb: Workbook,
  table: string,
  snap: TableSnapshot,
  values: Record<string, Cell>,
  formulas: Record<string, string> = {},
  numeric: string[] = [],
): Promise<Cell[]> {
  const headers = headersOf(snap.values[0]);
  const row: Cell[] = headers.map((h) => (h in formulas ? formulas[h] : values[h] ?? ""));
  const added = await wb.addRow(table, row);
  const index = typeof added.index === "number" ? added.index : snap.values.length - 1;
  const rowNumber = snap.address.firstRow + 1 + index;
  const at = (h: string) => cellAddress(snap.address.firstCol + headers.indexOf(h), rowNumber);
  const sheet = snap.address.sheet;

  for (const h of numeric) {
    if (!headers.includes(h)) continue;
    await wb.writeNumberFormat(sheet, at(h), [["General"]]);
    await wb.writeCell(sheet, at(h), values[h] ?? 0);
  }
  for (const [h, f] of Object.entries(formulas)) {
    if (!headers.includes(h)) continue;
    await wb.writeNumberFormat(sheet, at(h), [["General"]]);
    await wb.writeFormulas(sheet, at(h), [[f]]);
  }
  return row.map((v, c) => (headers[c] in formulas ? "" : v));
}
