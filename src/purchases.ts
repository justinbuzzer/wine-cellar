// The "Purchases" log: one row per wine per purchase, on its own sheet, created
// automatically the first time. Written after the bottles are in the cellar, so
// the Overview can show what you bought each month.

import { toTable, type Cell, type Wine } from "./data";
import { withSession, type TableSnapshot, type Workbook } from "./graph";
import { appendLogs, readLog, type LogSpec } from "./logtable";
import { excelSerial } from "./notesmodel";
import { PURCHASE_COLUMNS, toPurchase, type Purchase } from "./purchasemodel";

export const PURCHASE_SPEC: LogSpec = {
  table: "Purchases",
  columns: PURCHASE_COLUMNS,
  idHeader: "PurchaseID",
  idPrefix: "P",
  idWidth: 5,
  formats: { "Date Bought": "d mmm yyyy", Price: "#,##0.00" },
  numeric: ["Bottles"],
  what: "purchase log",
};

export function readPurchases(wb: Workbook): Promise<TableSnapshot | null> {
  return readLog(wb, PURCHASE_SPEC.table);
}

async function allPurchases(wb: Workbook): Promise<Purchase[]> {
  const snap = await readPurchases(wb);
  return snap ? toTable(snap.values).rows.map(toPurchase).filter((p) => p.purchaseId) : [];
}

/** One log row: `bottles` of `wine` bought on `date` ("YYYY-MM-DD"). */
export function purchaseRow(
  wine: Pick<Wine, "wineId" | "producer" | "name" | "vintage" | "type">,
  p: { date: string; bottles: number; price: number | null; source?: string | null; to?: string | null; groupBuy?: string | null },
): Record<string, Cell> {
  return {
    "Date Bought": excelSerial(p.date),
    WineID: wine.wineId ?? "",
    Producer: wine.producer ?? "",
    Name: wine.name ?? "",
    Vintage: wine.vintage ?? "",
    Type: wine.type ?? "",
    Bottles: p.bottles,
    Price: p.price ?? "",
    Source: (p.source ?? "").trim(),
    To: p.to ?? "",
    "Group Buy": (p.groupBuy ?? "").trim(),
  };
}

/** Adds purchase rows. Returns every purchase afterwards. */
export function logPurchases(itemId: string, rows: Record<string, Cell>[]): Promise<Purchase[]> {
  return withSession(itemId, async (wb) => {
    await appendLogs(wb, PURCHASE_SPEC, rows);
    return allPurchases(wb);
  });
}
