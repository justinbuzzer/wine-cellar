// Inventory writes. Every operation opens a workbook session, re-reads the Inventory
// table, finds the wine by WineID, computes new values from what's in the spreadsheet
// *now*, and writes only the cells that change (see tableops.ts).

import { config } from "./config";
import { headersOf, recordFrom, toWine, type Cell, type Wine } from "./data";
import { withSession } from "./graph";
import { COL_HOME, COL_KC, LOCATION_COLUMN, QTY_FORMULA, type Location } from "./locations";
import { appendRow, locateById, nextId, setCells, type Located } from "./tableops";
import { findQtyIssues, type QtyIssue } from "./bottlecheck";
import { colLetter } from "./sheet";

const TABLE = config.tables.inventory;

/** Columns the app manages itself; edits never write these directly. */
const PROTECTED = new Set(["WineID", "Qty", COL_KC, COL_HOME]);

function requireLocations(headers: string[]) {
  if (!headers.includes(COL_KC) || !headers.includes(COL_HOME)) {
    throw new Error(`The Inventory table needs "${COL_KC}" and "${COL_HOME}" columns.`);
  }
}

const count = (v: Cell) => (typeof v === "number" ? v : Number(v) || 0);

export function result(at: Located): Wine {
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

/**
 * A purchase of a wine you already have: adds bottles at one location, optionally
 * updates its price, and marks it Not yet arrived only if it currently has no
 * bottles (Status is per wine, so bottles already in the cellar stay visible).
 */
export function receiveBottles(
  itemId: string,
  wineId: string,
  where: Location,
  bottles: number,
  opts: { price?: number | null; notYetArrived?: boolean },
): Promise<{ wine: Wine; markedNya: boolean }> {
  return withSession(itemId, async (wb) => {
    const at = locateById(await wb.readTable(TABLE), "WineID", wineId, "Wine");
    requireLocations(at.headers);
    const kc = count(at.row[at.col(COL_KC)]);
    const home = count(at.row[at.col(COL_HOME)]);
    const changes: Record<string, Cell> = {
      [LOCATION_COLUMN[where]]: (where === "Home" ? home : kc) + bottles,
    };
    if (opts.price !== undefined && opts.price !== null) changes["Price"] = opts.price;
    const markedNya = !!opts.notYetArrived && kc + home === 0;
    if (markedNya) changes["Status"] = "NYA";
    await setCells(wb, at, changes);
    return { wine: result(at), markedNya };
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

/**
 * Fixes bottle counts the app can't rely on:
 *  1. sets the Qty, Qty K Cellars and Qty Home columns to "General" number format
 *     (so new rows stop inheriting a Text format),
 *  2. for each affected row, rewrites text counts as numbers and the Qty formula,
 *  3. re-reads the table and reports anything still wrong.
 * Rows whose counts can't be read are left untouched and reported.
 */
export function repairBottleCounts(itemId: string): Promise<{ repaired: number; remaining: QtyIssue[] }> {
  return withSession(itemId, async (wb) => {
    const snap = await wb.readTable(TABLE);
    const headers = headersOf(snap.values[0]);
    requireLocations(headers);
    const body = snap.values.slice(1);
    const issues = findQtyIssues(headers, body);
    const { sheet, firstCol, firstRow, lastRow } = snap.address;
    const col = (h: string) => colLetter(firstCol + headers.indexOf(h));

    if (body.length) {
      for (const h of ["Qty", COL_KC, COL_HOME]) {
        await wb.writeNumberFormat(sheet, `${col(h)}${firstRow + 1}:${col(h)}${lastRow}`, body.map(() => ["General"]));
      }
    }

    let repaired = 0;
    for (const issue of issues) {
      if (issue.kc === null || issue.home === null) continue;
      const row = firstRow + 1 + issue.index;
      if (issue.kcIsText) await wb.writeCell(sheet, `${col(COL_KC)}${row}`, issue.kc);
      if (issue.homeIsText) await wb.writeCell(sheet, `${col(COL_HOME)}${row}`, issue.home);
      await wb.writeFormulas(sheet, `${col("Qty")}${row}`, [[QTY_FORMULA]]);
      repaired++;
    }

    const after = await wb.readTable(TABLE);
    return { repaired, remaining: findQtyIssues(headersOf(after.values[0]), after.values.slice(1)) };
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
    const row = await appendRow(
      wb,
      TABLE,
      snap,
      values,
      hasLocations ? { Qty: QTY_FORMULA } : {},
      hasLocations ? [COL_KC, COL_HOME] : ["Qty"],
    );
    const rec = recordFrom(headers, row);
    rec["Qty"] = bottles.kc + bottles.home;
    return toWine(rec);
  });
}
