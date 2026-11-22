// Inventory writes. Every operation opens a workbook session, re-reads the Inventory
// table, finds the wine by WineID, computes new values from what's in the spreadsheet
// *now*, and writes only the cells that change (see tableops.ts).

import { config } from "./config";
import { headersOf, recordFrom, toWine, type Cell, type Wine } from "./data";
import { withSession, type TableSnapshot, type Workbook } from "./graph";
import { COL_HOME, COL_KC, LOCATION_COLUMN, QTY_FORMULA, type Location } from "./locations";
import { appendRow, locateById, nextId, setCells, type Located } from "./tableops";
import { findQtyIssues, type QtyIssue } from "./bottlecheck";
import { colLetter } from "./sheet";
import { changeSpots, formatSpots, parseSpots, putIn, takeFrom, type Placement } from "./spots";

const TABLE = config.tables.inventory;

/** Which boxes / racks hold a location's bottles (see spots.ts). */
export const SPOT_COLUMN: Record<Location, string> = { "K Cellars": "K Cellars Box", Home: "Home Rack" };

/** Columns the app manages itself; edits never write these directly. */
const PROTECTED = new Set(["WineID", "Qty", COL_KC, COL_HOME, SPOT_COLUMN["K Cellars"], SPOT_COLUMN.Home]);

/** Adds the K Cellars Box / Home Rack columns at the end of Inventory if missing; returns a fresh read. */
export async function withSpotColumns(wb: Workbook, snap: TableSnapshot): Promise<TableSnapshot> {
  let s = snap;
  for (const h of [SPOT_COLUMN["K Cellars"], SPOT_COLUMN.Home]) {
    if (headersOf(s.values[0]).includes(h)) continue;
    await wb.addTableColumn(TABLE, [[h], ...s.values.slice(1).map(() => [""])]);
    s = await wb.readTable(TABLE);
  }
  return s;
}

/**
 * Cells to write when a location's bottle count becomes `next`, with its spot list
 * kept in step: bottles taken come out of `from` (else not-placed ones first),
 * bottles added go into `to` (else they're not placed).
 */
export function countCells(at: Located, loc: Location, next: number, opts: { from?: string | null; to?: string | null } = {}): Record<string, Cell> {
  const col = LOCATION_COLUMN[loc];
  const before = count(at.row[at.col(col)]);
  const cells: Record<string, Cell> = { [col]: next };
  const sc = SPOT_COLUMN[loc];
  if (at.headers.includes(sc)) {
    const text = String(at.row[at.col(sc)] ?? "");
    const updated = changeSpots(text, before, next, opts);
    if (updated !== text) cells[sc] = updated;
  }
  return cells;
}

function requireLocations(headers: string[]) {
  if (!headers.includes(COL_KC) || !headers.includes(COL_HOME)) {
    throw new Error(`The Inventory table needs "${COL_KC}" and "${COL_HOME}" columns.`);
  }
}

const count = (v: Cell) => (typeof v === "number" ? v : Number(v) || 0);

/** Year the wine was bought. Added to the end of the Inventory table the first time it's needed. */
export const COL_YEAR = "Year Purchased";

/** Makes sure the Inventory table has a Year Purchased column; returns a fresh read of the table. */
async function withYearColumn(wb: Workbook, snap: TableSnapshot): Promise<TableSnapshot> {
  if (headersOf(snap.values[0]).includes(COL_YEAR)) return snap;
  await wb.addTableColumn(TABLE, [[COL_YEAR], ...snap.values.slice(1).map(() => [""])]);
  return wb.readTable(TABLE);
}

export function result(at: Located): Wine {
  if (at.headers.includes(COL_KC) && at.headers.includes(COL_HOME)) {
    at.row[at.col("Qty")] = count(at.row[at.col(COL_KC)]) + count(at.row[at.col(COL_HOME)]);
  }
  return toWine(recordFrom(at.headers, at.row));
}

/**
 * Add/remove bottles per location, e.g. { Home: -1 }. `spots` says which box or
 * rack added bottles go into / removed ones come out of (default: not placed).
 */
export function adjustBottles(
  itemId: string,
  wineId: string,
  delta: Partial<Record<Location, number>>,
  spots: Partial<Record<Location, { from?: string | null; to?: string | null }>> = {},
): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    let snap = await wb.readTable(TABLE);
    if (Object.values(spots).some((s) => s?.to)) snap = await withSpotColumns(wb, snap);
    const at = locateById(snap, "WineID", wineId, "Wine");
    requireLocations(at.headers);
    const changes: Record<string, Cell> = {};
    for (const [loc, d] of Object.entries(delta) as [Location, number][]) {
      const colName = LOCATION_COLUMN[loc];
      const current = count(at.row[at.col(colName)]);
      const next = current + d;
      if (next < 0) {
        throw new Error(`There ${current === 1 ? "is" : "are"} only ${current} bottle${current === 1 ? "" : "s"} at ${loc}.`);
      }
      Object.assign(changes, countCells(at, loc, next, spots[loc]));
    }
    await setCells(wb, at, changes);
    return result(at);
  });
}

export interface Move {
  wineId: string;
  from: { loc: Location; spot: string | null };
  to: { loc: Location; spot: string | null };
  n: number;
}

/**
 * Moves bottles between spots and/or locations, several wines at once, in one
 * workbook session. Between Home and K Cellars the bottle counts change too.
 */
export function moveBottles(itemId: string, moves: Move[]): Promise<Wine[]> {
  return withSession(itemId, async (wb) => {
    let snap = await wb.readTable(TABLE);
    if (moves.some((m) => m.from.spot || m.to.spot)) snap = await withSpotColumns(wb, snap);
    const ids = [...new Set(moves.map((m) => m.wineId))];
    const out: Wine[] = [];
    for (const wineId of ids) {
      const at = locateById(snap, "WineID", wineId, "Wine");
      requireLocations(at.headers);
      const totals: Record<Location, number> = { "K Cellars": count(at.row[at.col(COL_KC)]), Home: count(at.row[at.col(COL_HOME)]) };
      const spotCol = (loc: Location) => (at.headers.includes(SPOT_COLUMN[loc]) ? at.col(SPOT_COLUMN[loc]) : -1);
      const places: Record<Location, Placement> = {
        "K Cellars": parseSpots(spotCol("K Cellars") >= 0 ? at.row[spotCol("K Cellars")] : "", totals["K Cellars"]),
        Home: parseSpots(spotCol("Home") >= 0 ? at.row[spotCol("Home")] : "", totals.Home),
      };
      for (const m of moves.filter((x) => x.wineId === wineId)) {
        const p = places[m.from.loc];
        const have = m.from.spot === null ? p.unplaced : p.spots.find((s) => s.spot === m.from.spot)?.n ?? 0;
        if (have < m.n) {
          throw new Error(`Only ${have} bottle${have === 1 ? "" : "s"} of ${wineId} in ${m.from.loc} · ${m.from.spot ?? "not placed"}. Reload and try again.`);
        }
        places[m.from.loc] = takeFrom(p, m.n, m.from.spot);
        totals[m.from.loc] -= m.n;
        places[m.to.loc] = putIn(places[m.to.loc], m.n, m.to.spot);
        totals[m.to.loc] += m.n;
      }
      const changes: Record<string, Cell> = { [COL_KC]: totals["K Cellars"], [COL_HOME]: totals.Home };
      for (const loc of ["K Cellars", "Home"] as Location[]) {
        if (spotCol(loc) >= 0) changes[SPOT_COLUMN[loc]] = formatSpots(places[loc].spots, totals[loc]);
      }
      await setCells(wb, at, changes);
      out.push(result(at));
    }
    return out;
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
  opts: { price?: number | null; notYetArrived?: boolean; yearPurchased?: number | null; spot?: string | null },
): Promise<{ wine: Wine; markedNya: boolean }> {
  return withSession(itemId, async (wb) => {
    let snap = await wb.readTable(TABLE);
    if (opts.yearPurchased) snap = await withYearColumn(wb, snap);
    if (opts.spot) snap = await withSpotColumns(wb, snap);
    const at = locateById(snap, "WineID", wineId, "Wine");
    requireLocations(at.headers);
    const kc = count(at.row[at.col(COL_KC)]);
    const home = count(at.row[at.col(COL_HOME)]);
    const changes: Record<string, Cell> = countCells(at, where, (where === "Home" ? home : kc) + bottles, { to: opts.spot ?? null });
    if (opts.price !== undefined && opts.price !== null) changes["Price"] = opts.price;
    const markedNya = !!opts.notYetArrived && kc + home === 0;
    if (markedNya) changes["Status"] = "NYA";
    // Keeps the year of the first purchase; fills it in only if it's blank.
    if (opts.yearPurchased && String(at.row[at.col(COL_YEAR)] ?? "").trim() === "") changes[COL_YEAR] = opts.yearPurchased;
    await setCells(wb, at, changes);
    return { wine: result(at), markedNya };
  });
}

/**
 * Clears "NYA". If the bottles went Home, moves them from K Cellars to Home.
 * With a `spot`, the not-placed bottles there (the ones that just arrived) go into it.
 */
export function markArrived(itemId: string, wineId: string, where: Location, spot: string | null = null): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    let snap = await wb.readTable(TABLE);
    if (spot) snap = await withSpotColumns(wb, snap);
    const at = locateById(snap, "WineID", wineId, "Wine");
    const changes: Record<string, Cell> = { Status: "" };
    if (at.headers.includes(COL_KC) && at.headers.includes(COL_HOME)) {
      const kc = count(at.row[at.col(COL_KC)]);
      const home = count(at.row[at.col(COL_HOME)]);
      if (where === "Home" && kc > 0) {
        Object.assign(changes, countCells(at, "K Cellars", 0), countCells(at, "Home", home + kc, { to: spot }));
      } else if (spot && at.headers.includes(SPOT_COLUMN[where])) {
        const total = where === "Home" ? home : kc;
        const p = parseSpots(at.row[at.col(SPOT_COLUMN[where])], total);
        changes[SPOT_COLUMN[where]] = formatSpots(putIn({ ...p, unplaced: 0 }, p.unplaced, spot).spots, total);
      }
    }
    await setCells(wb, at, changes);
    return result(at);
  });
}

/**
 * Saves researched details for one wine:
 *  - text goes into Remarks on a new line below anything already there (never replacing it);
 *  - alcohol (e.g. 13.5) fills Alcohol % only if that cell is blank right now.
 * Refuses if the row's producer, name or vintage no longer match what was researched,
 * so nothing lands on the wrong wine — unless `expect` is null, which you choose
 * on the review screen after confirming a renamed wine is still the same wine.
 */
export function applyResearch(
  itemId: string,
  wineId: string,
  add: { text: string; alcohol: number | null },
  expect: Pick<Wine, "producer" | "name" | "vintage"> | null,
): Promise<{ wine: Wine; alcoholFilled: boolean }> {
  return withSession(itemId, async (wb) => {
    const at = locateById(await wb.readTable(TABLE), "WineID", wineId, "Wine");
    const now = result(at);
    const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
    if (expect && (!same(now.producer, expect.producer) || !same(now.name, expect.name) || !same(now.vintage, expect.vintage))) {
      throw new Error(
        `${wineId} is now "${now.producer} ${now.name} ${now.vintage ?? ""}", not the wine that was researched. ` +
          `If you renamed it, reload the app, then tick "Same wine" on this card.`,
      );
    }
    const changes: Record<string, Cell> = {};
    const existing = String(at.row[at.col("Remarks")] ?? "").trim();
    const addition = add.text.trim();
    if (addition && !existing.includes(addition)) changes.Remarks = existing ? `${existing}\n${addition}` : addition;
    const alcoholBlank = String(at.row[at.col("Alcohol %")] ?? "").trim() === "";
    const alcoholFilled = add.alcohol !== null && alcoholBlank;
    // Stored as a fraction (13.5% -> 0.135), like the app's other forms.
    if (alcoholFilled) changes["Alcohol %"] = Math.round(add.alcohol! * 10) / 1000;
    if (Object.keys(changes).length) await setCells(wb, at, changes);
    return { wine: result(at), alcoholFilled };
  });
}

/** Edit descriptive fields. Only cells whose value actually changed are written. */
export function updateWine(itemId: string, wineId: string, changes: Record<string, Cell>): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    let snap = await wb.readTable(TABLE);
    if (String(changes[COL_YEAR] ?? "") !== "") snap = await withYearColumn(wb, snap);
    const headers = headersOf(snap.values[0]);
    const at = locateById(snap, "WineID", wineId, "Wine");
    // Clearing a column that doesn't exist yet is a no-op.
    const allowed = Object.fromEntries(Object.entries(changes).filter(([h]) => !PROTECTED.has(h) && headers.includes(h)));
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
  spots: { kc?: string | null; home?: string | null } = {},
): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    let snap = await wb.readTable(TABLE);
    if (String(fields[COL_YEAR] ?? "") !== "") snap = await withYearColumn(wb, snap);
    if ((spots.kc && bottles.kc > 0) || (spots.home && bottles.home > 0)) snap = await withSpotColumns(wb, snap);
    const headers = headersOf(snap.values[0]);
    const wineId = nextId(snap, "WineID", "W", 4);
    const hasLocations = headers.includes(COL_KC) && headers.includes(COL_HOME);
    const values: Record<string, Cell> = { ...fields, WineID: wineId };
    if (hasLocations) {
      values[COL_KC] = bottles.kc;
      values[COL_HOME] = bottles.home;
      if (spots.kc && bottles.kc > 0) values[SPOT_COLUMN["K Cellars"]] = spots.kc;
      if (spots.home && bottles.home > 0) values[SPOT_COLUMN.Home] = spots.home;
    } else {
      values["Qty"] = bottles.kc + bottles.home;
    }
    const row = await appendRow(
      wb,
      TABLE,
      snap,
      values,
      hasLocations ? { Qty: QTY_FORMULA } : {},
      hasLocations ? [COL_KC, COL_HOME, ...(values[COL_YEAR] ? [COL_YEAR] : [])] : ["Qty"],
    );
    const rec = recordFrom(headers, row);
    rec["Qty"] = bottles.kc + bottles.home;
    return toWine(rec);
  });
}
