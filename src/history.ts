// Bottle history writes. Opening a bottle takes one off its location (same safety
// rules as inventory.ts) and adds a row to the "Opened" table. The table — on its
// own "Opened" sheet — is created automatically the first time.

import { config } from "./config";
import { headersOf, recordFrom, type Cell, type Wine } from "./data";
import { GraphError, withSession, type TableSnapshot, type Workbook } from "./graph";
import { COL_HOME, COL_KC, LOCATION_COLUMN, type Location } from "./locations";
import { excelSerial } from "./notesmodel";
import { HISTORY_COLUMNS, toOpening, type Opening } from "./historymodel";
import { result } from "./inventory";
import { cellAddress, colLetter } from "./sheet";
import { appendRow, locateById, nextId, setCells } from "./tableops";

const TABLE = config.tables.history;
const SHEET = config.tables.history;
const DATE_FORMAT = "d mmm yyyy";

const count = (v: Cell) => (typeof v === "number" ? v : Number(v) || 0);

/** The history table, or null if it hasn't been created yet. */
export async function readHistory(wb: Workbook): Promise<TableSnapshot | null> {
  try {
    return await wb.readTable(TABLE);
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

async function logOpening(wb: Workbook, wine: Wine, from: Location, date: string, occasion: string): Promise<Opening> {
  const values: Record<string, Cell> = {
    "Date Opened": excelSerial(date),
    WineID: wine.wineId,
    Producer: wine.producer,
    Name: wine.name,
    Vintage: wine.vintage,
    Type: wine.type,
    From: from,
    Price: wine.price,
    Occasion: occasion.trim(),
  };

  const snap = await readHistory(wb);
  if (!snap) {
    values["OpenID"] = "O00001";
    try {
      await wb.addWorksheet(SHEET);
    } catch (e) {
      throw new Error(
        `Couldn't add an "${SHEET}" sheet for bottle history. If a sheet with that name already exists, rename it and try again. (${e instanceof Error ? e.message : e})`,
      );
    }
    const last = colLetter(HISTORY_COLUMNS.length - 1);
    await wb.writeValues(SHEET, `A1:${last}2`, [[...HISTORY_COLUMNS], HISTORY_COLUMNS.map((h) => values[h] ?? "")]);
    await wb.writeNumberFormat(SHEET, "B2", [[DATE_FORMAT]]);
    await wb.addTable(SHEET, `A1:${last}2`, TABLE);
    return toOpening(values);
  }

  const headers = headersOf(snap.values[0]);
  values["OpenID"] = nextId(snap, "OpenID", "O", 5);
  // A table emptied by Undo keeps one blank row: fill that instead of adding below it.
  const blank = snap.values.findIndex((r, k) => k > 0 && isBlank(r));
  if (blank > 0) {
    const row = headers.map((h) => values[h] ?? "");
    await wb.writeValues(snap.address.sheet, rowRange(snap, blank - 1), [row]);
    return toOpening(recordFrom(headers, row));
  }
  const row = await appendRow(wb, TABLE, snap, values);
  return toOpening(recordFrom(headers, row));
}

export interface OpenResult {
  wine: Wine;
  opening: Opening | null;
  /** The bottle was taken off but couldn't be recorded in the history. */
  logError: unknown;
}

/** Takes one bottle off `from` and records it in the bottle history. */
export function openBottle(
  itemId: string,
  wineId: string,
  from: Location,
  opts: { date: string; occasion: string },
): Promise<OpenResult> {
  return withSession(itemId, async (wb) => {
    const at = locateById(await wb.readTable(config.tables.inventory), "WineID", wineId, "Wine");
    if (!at.headers.includes(COL_KC) || !at.headers.includes(COL_HOME)) {
      throw new Error(`The Inventory table needs "${COL_KC}" and "${COL_HOME}" columns.`);
    }
    const col = LOCATION_COLUMN[from];
    const current = count(at.row[at.col(col)]);
    if (current < 1) throw new Error(`There are no bottles at ${from}.`);
    await setCells(wb, at, { [col]: current - 1 });
    const wine = result(at);
    try {
      return { wine, opening: await logOpening(wb, wine, from, opts.date, opts.occasion), logError: null };
    } catch (e) {
      return { wine, opening: null, logError: e };
    }
  });
}

/** Undo: puts the bottle back and removes its history row. */
export function undoOpen(itemId: string, wineId: string, from: Location, openId: string | null): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    const at = locateById(await wb.readTable(config.tables.inventory), "WineID", wineId, "Wine");
    const col = LOCATION_COLUMN[from];
    await setCells(wb, at, { [col]: count(at.row[at.col(col)]) + 1 });
    if (openId) await removeRow(wb, openId);
    return result(at);
  });
}

/** Removes one history entry (bottle counts are not changed). */
export function deleteOpening(itemId: string, openId: string): Promise<void> {
  return withSession(itemId, (wb) => removeRow(wb, openId));
}

async function removeRow(wb: Workbook, openId: string): Promise<void> {
  const snap = await readHistory(wb);
  if (!snap) return;
  const idCol = headersOf(snap.values[0]).indexOf("OpenID");
  const i = snap.values.findIndex((r, k) => k > 0 && String(r[idCol] ?? "") === openId);
  if (i < 0) return;
  const body = snap.values.length - 1;
  if (body === 1) {
    // A table must keep at least one row: blank it instead of deleting it.
    await wb.writeValues(snap.address.sheet, rowRange(snap, 0), [snap.values[0].map(() => "")]);
  } else {
    await wb.deleteRange(snap.address.sheet, rowRange(snap, i - 1));
  }
}
