// Bottle history writes. Opening a bottle takes one off its location (same safety
// rules as inventory.ts) and adds a row to the "Opened" table. The table — on its
// own "Opened" sheet — is created automatically the first time.

import { config } from "./config";
import { type Cell, type Wine } from "./data";
import { withSession, type TableSnapshot, type Workbook } from "./graph";
import { COL_HOME, COL_KC, LOCATION_COLUMN, type Location } from "./locations";
import { excelSerial } from "./notesmodel";
import { HISTORY_COLUMNS, toOpening, type Opening } from "./historymodel";
import { countCells, result } from "./inventory";
import { appendLog, readLog, removeLog, type LogSpec } from "./logtable";
import { locateById, setCells, type Located } from "./tableops";

export const OPENED_SPEC: LogSpec = {
  table: config.tables.history,
  columns: HISTORY_COLUMNS,
  idHeader: "OpenID",
  idPrefix: "O",
  idWidth: 5,
  formats: { "Date Opened": "d mmm yyyy" },
  what: "bottle history",
};

const count = (v: Cell) => (typeof v === "number" ? v : Number(v) || 0);

/** The history table, or null if it hasn't been created yet. */
export function readHistory(wb: Workbook): Promise<TableSnapshot | null> {
  return readLog(wb, OPENED_SPEC.table);
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
  return toOpening(await appendLog(wb, OPENED_SPEC, values));
}

/** Finds the wine and checks it has bottle counts per location. */
export async function locateWine(wb: Workbook, wineId: string): Promise<Located> {
  const at = locateById(await wb.readTable(config.tables.inventory), "WineID", wineId, "Wine");
  if (!at.headers.includes(COL_KC) || !at.headers.includes(COL_HOME)) {
    throw new Error(`The Inventory table needs "${COL_KC}" and "${COL_HOME}" columns.`);
  }
  return at;
}

/** Takes `n` bottles off `from` (fails if there aren't enough there), out of box/rack `spot` if given. */
export async function takeBottles(wb: Workbook, at: Located, from: Location, n: number, spot: string | null = null): Promise<Wine> {
  const col = LOCATION_COLUMN[from];
  const current = count(at.row[at.col(col)]);
  if (current < n) throw new Error(n === 1 ? `There are no bottles at ${from}.` : `There are only ${current} bottles at ${from}.`);
  await setCells(wb, at, countCells(at, from, current - n, { from: spot }));
  return result(at);
}

/** Puts `n` bottles back at `to` (into box/rack `spot` if given). */
export async function returnBottles(wb: Workbook, wineId: string, to: Location, n: number, spot: string | null = null): Promise<Wine> {
  const at = locateById(await wb.readTable(config.tables.inventory), "WineID", wineId, "Wine");
  const col = LOCATION_COLUMN[to];
  await setCells(wb, at, countCells(at, to, count(at.row[at.col(col)]) + n, { to: spot }));
  return result(at);
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
  opts: { date: string; occasion: string; spot?: string | null },
): Promise<OpenResult> {
  return withSession(itemId, async (wb) => {
    const wine = await takeBottles(wb, await locateWine(wb, wineId), from, 1, opts.spot ?? null);
    try {
      return { wine, opening: await logOpening(wb, wine, from, opts.date, opts.occasion), logError: null };
    } catch (e) {
      return { wine, opening: null, logError: e };
    }
  });
}

/** Undo: puts the bottle back and removes its history row. */
export function undoOpen(itemId: string, wineId: string, from: Location, openId: string | null, spot: string | null = null): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    const wine = await returnBottles(wb, wineId, from, 1, spot);
    if (openId) await removeLog(wb, OPENED_SPEC, openId);
    return wine;
  });
}

/** Removes one history entry (bottle counts are not changed). */
export function deleteOpening(itemId: string, openId: string): Promise<void> {
  return withSession(itemId, (wb) => removeLog(wb, OPENED_SPEC, openId));
}
