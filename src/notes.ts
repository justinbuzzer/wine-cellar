// Tasting-note writes to the "Tasted" table, using the same safety rules as inventory
// (fresh read, locate by TastingID, write only changed cells).

import { config } from "./config";
import { recordFrom, toTasting, type Cell, type Tasting } from "./data";
import { withSession } from "./graph";
import { AGE_FORMULA } from "./notesmodel";
import { appendRow, ensureColumns, fillsAny, locateById, nextId, setCells } from "./tableops";
import { BLIND_COLUMNS } from "./blindmodel";

const TABLE = config.tables.tastings;

/** Age Tasted is a formula in Excel; compute it locally so the app shows it straight away. */
function withAge(rec: Record<string, Cell>): Record<string, Cell> {
  const year = Number(rec["Year Tasted"]);
  const vintage = Number(rec["Vintage"]);
  rec["Age Tasted"] = Number.isFinite(year) && Number.isFinite(vintage) && year > 0 && vintage > 0 ? year - vintage : null;
  return rec;
}

/** Columns the app manages itself. */
const PROTECTED = new Set(["TastingID", "Age Tasted"]);

export function addTasting(itemId: string, fields: Record<string, Cell>): Promise<Tasting> {
  return withSession(itemId, async (wb) => {
    let snap = await wb.readTable(TABLE);
    // A blind tasting's flag and guesses need their columns (added the first time).
    if (fillsAny(fields, BLIND_COLUMNS)) snap = await ensureColumns(wb, TABLE, snap, BLIND_COLUMNS);
    const tastingId = nextId(snap, "TastingID", "T", 5);
    const values = Object.fromEntries(Object.entries(fields).filter(([h]) => !PROTECTED.has(h)));
    values["TastingID"] = tastingId;
    const headers = (snap.values[0] ?? []).map((h) => String(h ?? "").trim());
    const row = await appendRow(wb, TABLE, snap, values, { "Age Tasted": AGE_FORMULA }, ["Score", "Year Tasted"]);
    return toTasting(withAge(recordFrom(headers, row)));
  });
}

export function updateTasting(itemId: string, tastingId: string, changes: Record<string, Cell>): Promise<Tasting> {
  return withSession(itemId, async (wb) => {
    let snap = await wb.readTable(TABLE);
    if (fillsAny(changes, BLIND_COLUMNS)) snap = await ensureColumns(wb, TABLE, snap, BLIND_COLUMNS);
    const at = locateById(snap, "TastingID", tastingId, "Tasting note");
    // Only columns the table has (blank blind columns on a table without them are left out).
    const allowed = Object.fromEntries(Object.entries(changes).filter(([h]) => !PROTECTED.has(h) && at.headers.includes(h)));
    await setCells(wb, at, allowed);
    return toTasting(withAge(recordFrom(at.headers, at.row)));
  });
}
