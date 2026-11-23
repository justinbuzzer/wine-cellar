// Taking bottles off a wine when they weren't opened or sold: added by mistake,
// broken, given away. The bottles come off their location (and box), the change
// goes into the adjustments log (the "Stocktake" table, StocktakeID "Correction",
// so it isn't listed as a stocktake), and "added by mistake" can also take them
// off the purchase they were recorded with, so the Purchased card stays right.

import { toTable, type Cell, type Wine } from "./data";
import { withSession, type Workbook } from "./graph";
import { locateWine, returnBottles, takeBottles } from "./history";
import { LOCATION_COLUMN, type Location } from "./locations";
import { appendLog, readLog, removeLog } from "./logtable";
import { excelSerial, todayIso } from "./notesmodel";
import { PURCHASE_SPEC, purchaseRow } from "./purchases";
import { toPurchase, type Purchase } from "./purchasemodel";
import { CORRECTION_ID, STOCKTAKE_SPEC } from "./stocktake";

export type RemoveReason = "mistake" | "broken" | "gift" | "other";
export const REMOVE_REASONS: { key: RemoveReason; label: string }[] = [
  { key: "mistake", label: "Added by mistake" },
  { key: "broken", label: "Broken or lost" },
  { key: "gift", label: "Gave away" },
  { key: "other", label: "Other" },
];
export { CORRECTION_ID };

/** The latest purchase of this wine (bottles bought, not a correction), to take a mistake off. */
export function lastPurchaseOf(purchases: Purchase[], wineId: string): Purchase | null {
  return (
    purchases
      .filter((p) => p.wineId === wineId && p.bottles > 0 && p.date)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.purchaseId.localeCompare(a.purchaseId))[0] ?? null
  );
}

export interface RemoveRequest {
  loc: Location;
  n: number;
  /** The box or rack they come out of (null: unplaced bottles). */
  spot: string | null;
  reason: RemoveReason;
  note: string;
  /** "Added by mistake": take them off this purchase too. */
  purchase: Purchase | null;
}

export interface RemoveResult {
  wine: Wine;
  adjustId: string | null;
  /** The negative purchase row written (null if none). */
  purchaseId: string | null;
  /** Every purchase afterwards, when the purchase log was changed. */
  purchases: Purchase[] | null;
  /** The bottles came off, but recording it failed. */
  logError: unknown;
}

export function removeBottles(itemId: string, wineId: string, r: RemoveRequest): Promise<RemoveResult> {
  return withSession(itemId, async (wb) => {
    const at = await locateWine(wb, wineId);
    const raw = at.row[at.col(LOCATION_COLUMN[r.loc])];
    const before = typeof raw === "number" ? raw : Number(raw) || 0;
    const wine = await takeBottles(wb, at, r.loc, r.n, r.spot);
    const label = REMOVE_REASONS.find((x) => x.key === r.reason)?.label ?? "Other";
    let adjustId: string | null = null;
    let purchaseId: string | null = null;
    let purchases: Purchase[] | null = null;
    try {
      const row = await appendLog(wb, STOCKTAKE_SPEC, {
        StocktakeID: CORRECTION_ID,
        Date: excelSerial(todayIso()),
        WineID: wineId,
        Producer: wine.producer ?? "",
        Name: wine.name ?? "",
        Vintage: wine.vintage ?? "",
        Location: r.loc,
        Expected: "",
        Counted: "",
        Before: before,
        After: before - r.n,
        Change: -r.n,
        Reason: [label, r.note.trim()].filter(Boolean).join(": "),
      } as Record<string, Cell>);
      adjustId = String(row["AdjustID"] ?? "") || null;
      if (r.reason === "mistake" && r.purchase?.date) {
        const p = await appendLog(
          wb,
          PURCHASE_SPEC,
          purchaseRow(wine, {
            date: r.purchase.date,
            bottles: -r.n,
            price: r.purchase.price,
            source: r.purchase.source,
            to: r.loc,
            groupBuy: r.purchase.groupBuy,
          }),
        );
        purchaseId = String(p["PurchaseID"] ?? "") || null;
        purchases = await allPurchases(wb);
      }
      return { wine, adjustId, purchaseId, purchases, logError: null };
    } catch (e) {
      return { wine, adjustId, purchaseId, purchases, logError: e };
    }
  });
}

/** Undo: puts the bottles back and removes what was recorded. */
export function undoRemove(
  itemId: string,
  wineId: string,
  r: Pick<RemoveRequest, "loc" | "n" | "spot">,
  ids: Pick<RemoveResult, "adjustId" | "purchaseId">,
): Promise<{ wine: Wine; purchases: Purchase[] | null }> {
  return withSession(itemId, async (wb) => {
    const wine = await returnBottles(wb, wineId, r.loc, r.n, r.spot);
    if (ids.adjustId) await removeLog(wb, STOCKTAKE_SPEC, ids.adjustId);
    let purchases: Purchase[] | null = null;
    if (ids.purchaseId) {
      await removeLog(wb, PURCHASE_SPEC, ids.purchaseId);
      purchases = await allPurchases(wb);
    }
    return { wine, purchases };
  });
}

async function allPurchases(wb: Workbook): Promise<Purchase[]> {
  const snap = await readLog(wb, PURCHASE_SPEC.table);
  return snap ? toTable(snap.values).rows.map(toPurchase).filter((p) => p.purchaseId) : [];
}
