// One-off spreadsheet upgrade: split Qty into "Qty K Cellars" + "Qty Home" using the
// old Loc column, then make Qty a formula that sums the two.

import { config } from "./config";
import { headersOf, type Cell, type Wine } from "./data";
import { withSession } from "./graph";
import { COL_HOME, COL_KC, QTY_FORMULA, splitFromLoc, type SplitRule } from "./locations";
import { colLetter } from "./sheet";

const TABLE = config.tables.inventory;

export interface PlannedRow {
  wine: Wine;
  kc: number;
  home: number;
  rule: SplitRule;
}

export function planUpgrade(wines: Wine[]): PlannedRow[] {
  return wines.map((wine) => ({ wine, ...splitFromLoc(wine.qty, wine.loc) }));
}

export interface UpgradeResult {
  rows: number;
  kcBottles: number;
  homeBottles: number;
  /** WineIDs whose total changed — should always be empty. */
  mismatches: string[];
}

const n = (v: Cell) => (typeof v === "number" ? v : Number(v) || 0);

export function runUpgrade(itemId: string): Promise<UpgradeResult> {
  return withSession(itemId, async (wb) => {
    // Work from the spreadsheet as it is now, not the app's copy.
    const before = await wb.readTable(TABLE);
    const headers = headersOf(before.values[0]);
    const hasKc = headers.includes(COL_KC);
    const hasHome = headers.includes(COL_HOME);
    if (hasKc && hasHome) throw new Error("This spreadsheet has already been upgraded.");

    const qtyCol = headers.indexOf("Qty");
    const locCol = headers.indexOf("Loc");
    const idCol = headers.indexOf("WineID");
    if (qtyCol < 0 || idCol < 0) throw new Error("The Inventory table needs Qty and WineID columns.");

    const body = before.values.slice(1);
    const oldQty = body.map((r) => n(r[qtyCol]));
    const splits = body.map((r, i) =>
      splitFromLoc(oldQty[i], locCol >= 0 ? (r[locCol] === "" ? null : String(r[locCol])) : null),
    );

    if (!hasKc) await wb.addColumn(TABLE, [COL_KC, ...splits.map((s) => s.kc)]);
    if (!hasHome) await wb.addColumn(TABLE, [COL_HOME, ...splits.map((s) => s.home)]);

    // Qty = K Cellars + Home, for every data row.
    const mid = await wb.readTable(TABLE);
    const col = colLetter(mid.address.firstCol + qtyCol);
    const first = mid.address.firstRow + 1;
    const last = mid.address.lastRow;
    await wb.writeFormulas(
      mid.address.sheet,
      `${col}${first}:${col}${last}`,
      Array.from({ length: last - first + 1 }, () => [QTY_FORMULA]),
    );

    // Verify: every row's total must be unchanged.
    const after = await wb.readTable(TABLE);
    const h2 = headersOf(after.values[0]);
    const kcCol = h2.indexOf(COL_KC);
    const homeCol = h2.indexOf(COL_HOME);
    const mismatches: string[] = [];
    let kcBottles = 0;
    let homeBottles = 0;
    after.values.slice(1).forEach((r, i) => {
      kcBottles += n(r[kcCol]);
      homeBottles += n(r[homeCol]);
      if (n(r[qtyCol]) !== oldQty[i]) mismatches.push(String(r[idCol] ?? `row ${i + 2}`));
    });
    return { rows: body.length, kcBottles, homeBottles, mismatches };
  });
}
