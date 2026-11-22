// Selling bottles: takes them off their location (same safety rules as opening)
// and adds a row to the "Sold" table, on its own "Sold" sheet, created
// automatically the first time. Sales are kept apart from the bottle history.

import { config } from "./config";
import { type Cell, type Wine } from "./data";
import { withSession, type TableSnapshot, type Workbook } from "./graph";
import { type Location } from "./locations";
import { excelSerial } from "./notesmodel";
import { locateWine, returnBottles, takeBottles } from "./history";
import { appendLog, readLog, removeLog, type LogSpec } from "./logtable";
import { SALES_COLUMNS, toSale, type Sale } from "./salesmodel";

export const SOLD_SPEC: LogSpec = {
  table: config.tables.sales,
  columns: SALES_COLUMNS,
  idHeader: "SaleID",
  idPrefix: "S",
  idWidth: 5,
  formats: { "Date Sold": "d mmm yyyy", "Year Bought": "0", "Bought Price": "#,##0.00", "Sale Price": "#,##0.00" },
  numeric: ["Bottles", "Year Bought"],
  what: "sales record",
};

export function readSales(wb: Workbook): Promise<TableSnapshot | null> {
  return readLog(wb, SOLD_SPEC.table);
}

export interface SaleDetails {
  bottles: number;
  /** "YYYY-MM-DD" */
  date: string;
  salePrice: number;
  boughtPrice: number | null;
  /** The year bought, or null if unknown. */
  boughtYear: number | null;
  buyer: string;
  notes: string;
}

export interface SellResult {
  wine: Wine;
  sale: Sale | null;
  /** The bottles were taken off but the sale couldn't be recorded. */
  logError: unknown;
}

export function sellBottles(itemId: string, wineId: string, from: Location, d: SaleDetails): Promise<SellResult> {
  return withSession(itemId, async (wb) => {
    const wine = await takeBottles(wb, await locateWine(wb, wineId), from, d.bottles);
    const values: Record<string, Cell> = {
      "Date Sold": excelSerial(d.date),
      WineID: wine.wineId,
      Producer: wine.producer,
      Name: wine.name,
      Vintage: wine.vintage,
      Type: wine.type,
      From: from,
      Bottles: d.bottles,
      "Bought Price": d.boughtPrice ?? "",
      "Sale Price": d.salePrice,
      "Year Bought": d.boughtYear ?? "",
      Buyer: d.buyer.trim(),
      Notes: d.notes.trim(),
    };
    try {
      return { wine, sale: toSale(await appendLog(wb, SOLD_SPEC, values)), logError: null };
    } catch (e) {
      return { wine, sale: null, logError: e };
    }
  });
}

/** Undo: puts the bottles back and removes the sale. */
export function undoSale(itemId: string, wineId: string, from: Location, bottles: number, saleId: string | null): Promise<Wine> {
  return withSession(itemId, async (wb) => {
    const wine = await returnBottles(wb, wineId, from, bottles);
    if (saleId) await removeLog(wb, SOLD_SPEC, saleId);
    return wine;
  });
}

/** Removes one sale record (bottle counts are not changed). */
export function deleteSale(itemId: string, saleId: string): Promise<void> {
  return withSession(itemId, (wb) => removeLog(wb, SOLD_SPEC, saleId));
}
