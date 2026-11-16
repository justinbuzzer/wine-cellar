// Inventory writes. Every operation opens a workbook session, re-reads the Inventory
// table, finds the wine by WineID, computes new values from what's in the spreadsheet
// *now*, and writes only the cells that change (see tableops.ts).

import { config } from "./config";
import { headersOf, recordFrom, toWine, type Cell, type Wine } from "./data";
import { withSession } from "./graph";
import { COL_HOME, COL_KC, LOCATION_COLUMN, QTY_FORMULA, type Location } from "./locations";
import { appendRow, locateById, nextId, setCells, type Located } from "./tableops";

const TABLE = config.tables.inventory;

/** Columns the app manages itself; edits never write these directly. */
const PROTECTED = new Set(["WineID", "Qty", COL_KC, COL_HOME]);

function requireLocations(headers: string[]) {
  if (!headers.includes(COL_KC) || !headers.includes(COL_HOME)) {
    throw new Error(`The Inventory table needs "${COL_KC}" and "${COL_HOME}" columns.`);
  }
}

const count = (v: Cell) => (typeof v === "number" ? v : Number(v) || 0);

function result(at: Located): Wine {
  if (at.headers.includes(COL_KC) && at.headers.includes(COL_HOME)) {
    at.row[at.col("Qty")] = count(at.row[at.col(COL_KC)]) + count(at.row[at.col(COL_HOME)]);
  }
  return toWine(recordFrom(at.headers, at.row));
}

/** Add/remove bottles per location, e.g. { Home: -1 } or { "K Cellars": -2, Home: 2 }. */
export function adjustBottles(itemId: string, wineId: string, delta: Partial<Record<Location, number>>): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    const at = locateById(await wb.readTable(TABLE), "WineID", wineId, "Wine");
    requireLocations(at.headers);
    const changes: Record<string, Cell> = {};
    for (const [loc, d] of Object.entries(delta) as [Location, number][]) {
      const colName = LOCATION_COLUMN[loc];
      const current = count(at.row[at.col(colName)]);
      const next = current + d;
      if (next < 0) {
        throw new Error(`There ${current === 1 ? "is" : "are"} only ${current} bottle${current === 1 ? "" : "s"} at ${loc}.`);
      }
      changes[colName] = next;
    }
    await setCells(wb, at, changes);
    return result(at);
  });
}

/** Clears "NYA". If the bottles went Home, moves them from K Cellars to Home. */
export function markArrived(itemId: string, wineId: string, where: Location): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    const at = locateById(await wb.readTable(TABLE), "WineID", wineId, "Wine");
    const changes: Record<string, Cell> = { Status: "" };
    if (where === "Home" && at.headers.includes(COL_KC) && at.headers.includes(COL_HOME)) {
      const kc = count(at.row[at.col(COL_KC)]);
      changes[COL_KC] = 0;
      changes[COL_HOME] = count(at.row[at.col(COL_HOME)]) + kc;
    }
    await setCells(wb, at, changes);
    return result(at);
  });
}

/** Edit descriptive fields. Only cells whose value actually changed are written. */
export function updateWine(itemId: string, wineId: string, changes: Record<string, Cell>): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    const at = locateById(await wb.readTable(TABLE), "WineID", wineId, "Wine");
    const allowed = Object.fromEntries(Object.entries(changes).filter(([h]) => !PROTECTED.has(h)));
    await setCells(wb, at, allowed);
    return result(at);
  });
}

/** Append a new wine with the next free WineID. */
export function addWine(
  itemId: string,
  fields: Record<string, Cell>,
  bottles: { kc: number; home: number },
): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    const snap = await wb.readTable(TABLE);
    const headers = headersOf(snap.values[0]);
    const wineId = nextId(snap, "WineID", "W", 4);
    const hasLocations = headers.includes(COL_KC) && headers.includes(COL_HOME);
    const values: Record<string, Cell> = { ...fields, WineID: wineId };
    if (hasLocations) {
      values[COL_KC] = bottles.kc;
      values[COL_HOME] = bottles.home;
    } else {
      values["Qty"] = bottles.kc + bottles.home;
    }
    const row = await appendRow(wb, TABLE, snap, values, hasLocations ? { Qty: QTY_FORMULA } : {});
    const rec = recordFrom(headers, row);
    rec["Qty"] = bottles.kc + bottles.home;
    return toWine(rec);
  });
}
