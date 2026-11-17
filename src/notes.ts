// Tasting-note writes to the "Tasted" table, using the same safety rules as inventory
// (fresh read, locate by TastingID, write only changed cells).

import { config } from "./config";
import { recordFrom, toTasting, type Cell, type Tasting } from "./data";
import { withSession } from "./graph";
import { AGE_FORMULA } from "./notesmodel";
import { appendRow, locateById, nextId, setCells } from "./tableops";

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
    const snap = await wb.readTable(TABLE);
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
    const at = locateById(await wb.readTable(TABLE), "TastingID", tastingId, "Tasting note");
    const allowed = Object.fromEntries(Object.entries(changes).filter(([h]) => !PROTECTED.has(h)));
    await setCells(wb, at, allowed);
    return toTasting(withAge(recordFrom(at.headers, at.row)));
  });
}
