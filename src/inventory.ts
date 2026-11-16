// Inventory writes. Every operation:
//  1. opens a workbook session,
//  2. re-reads the Inventory table and finds the wine by WineID (never by a cached row number),
//  3. computes new values from what's in the spreadsheet *now*, not from the app's copy,
//  4. writes only the cells that change.

import { config } from "./config";
import { headersOf, recordFrom, toWine, type Cell, type Wine } from "./data";
import { withSession, type TableSnapshot, type Workbook } from "./graph";
import { COL_HOME, COL_KC, LOCATION_COLUMN, QTY_FORMULA, type Location } from "./locations";
import { cellAddress } from "./sheet";

const TABLE = config.tables.inventory;

/** Columns the app manages itself; edits never write these directly. */
const PROTECTED = new Set(["WineID", "Qty", COL_KC, COL_HOME]);

interface Located {
  sheet: string;
  headers: string[];
  row: Cell[];
  addressOf(header: string): string;
  col(header: string): number;
}

function locate(snap: TableSnapshot, wineId: string): Located {
  const headers = headersOf(snap.values[0]);
  const idCol = headers.indexOf("WineID");
  if (idCol < 0) throw new Error("The Inventory table has no WineID column.");
  const i = snap.values.findIndex((r, k) => k > 0 && String(r[idCol] ?? "") === wineId);
  if (i < 0) throw new Error(`Wine ${wineId} is no longer in the spreadsheet. Reload and try again.`);
  const col = (h: string) => {
    const c = headers.indexOf(h);
    if (c < 0) throw new Error(`The Inventory table has no "${h}" column.`);
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

function requireLocations(headers: string[]) {
  if (!headers.includes(COL_KC) || !headers.includes(COL_HOME)) {
    throw new Error(`The Inventory table needs "${COL_KC}" and "${COL_HOME}" columns.`);
  }
}

const count = (v: Cell) => (typeof v === "number" ? v : Number(v) || 0);

async function setCells(wb: Workbook, at: Located, changes: Record<string, Cell>): Promise<void> {
  for (const [h, v] of Object.entries(changes)) {
    const c = at.col(h);
    const current = at.row[c];
    const same = (current ?? "") === (v ?? "") || String(current ?? "") === String(v ?? "");
    if (same) continue;
    await wb.writeCell(at.sheet, at.addressOf(h), v);
    at.row[c] = v ?? "";
  }
}

function result(at: Located): Wine {
  if (at.headers.includes(COL_KC) && at.headers.includes(COL_HOME)) {
    at.row[at.col("Qty")] = count(at.row[at.col(COL_KC)]) + count(at.row[at.col(COL_HOME)]);
  }
  return toWine(recordFrom(at.headers, at.row));
}

/** Add/remove bottles per location, e.g. { Home: -1 } or { "K Cellars": -2, Home: 2 }. */
export function adjustBottles(itemId: string, wineId: string, delta: Partial<Record<Location, number>>): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    const at = locate(await wb.readTable(TABLE), wineId);
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
    const at = locate(await wb.readTable(TABLE), wineId);
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
    const at = locate(await wb.readTable(TABLE), wineId);
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
    const idCol = headers.indexOf("WineID");
    if (idCol < 0) throw new Error("The Inventory table has no WineID column.");
    const maxId = snap.values.slice(1).reduce((m, r) => {
      const hit = /^W(\d+)$/.exec(String(r[idCol] ?? ""));
      return hit ? Math.max(m, Number(hit[1])) : m;
    }, 0);
    const wineId = `W${String(maxId + 1).padStart(4, "0")}`;
    const hasLocations = headers.includes(COL_KC) && headers.includes(COL_HOME);

    const row: Cell[] = headers.map((h) => {
      if (h === "WineID") return wineId;
      if (h === "Qty") return hasLocations ? QTY_FORMULA : bottles.kc + bottles.home;
      if (h === COL_KC) return bottles.kc;
      if (h === COL_HOME) return bottles.home;
      return fields[h] ?? "";
    });

    const added = await wb.addRow(TABLE, row);
    const qtyCol = headers.indexOf("Qty");
    const written = added.values?.[0];
    // If Excel stored the Qty formula as text, write it again explicitly as a formula.
    if (hasLocations && qtyCol >= 0 && typeof written?.[qtyCol] !== "number") {
      const rowNumber = snap.address.firstRow + 1 + added.index;
      await wb.writeFormulas(snap.address.sheet, cellAddress(snap.address.firstCol + qtyCol, rowNumber), [[QTY_FORMULA]]);
    }
    const final = [...row];
    if (qtyCol >= 0) final[qtyCol] = bottles.kc + bottles.home;
    return toWine(recordFrom(headers, final));
  });
}
