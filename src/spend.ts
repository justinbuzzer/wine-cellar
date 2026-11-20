// What you've spent on a set of wines: bottles still held plus bottles opened
// (bottle history) and sold, each at what you paid. Pure, for unit testing.

import type { Wine } from "./data";
import type { Opening } from "./historymodel";
import type { Sale } from "./salesmodel";

export interface Spend {
  /** Total paid, in the workbook's currency. */
  total: number;
  /** Bottles counted (held + opened + sold). */
  bottles: number;
  /** Bottles counted that have no price, so aren't in `total`. */
  unpriced: number;
}

export function spendOn(wines: Wine[], history: Opening[], sales: Sale[]): Spend {
  const ids = new Map(wines.filter((w) => w.wineId).map((w) => [w.wineId!, w]));
  let total = 0;
  let bottles = 0;
  let unpriced = 0;
  const add = (n: number, price: number | null) => {
    if (n <= 0) return;
    bottles += n;
    if (price === null) unpriced += n;
    else total += n * price;
  };
  for (const w of wines) add(Math.max(0, w.qty), w.price);
  for (const o of history) {
    const w = o.wineId ? ids.get(o.wineId) : undefined;
    if (w) add(1, o.price ?? w.price);
  }
  for (const s of sales) {
    const w = s.wineId ? ids.get(s.wineId) : undefined;
    if (w) add(s.bottles, s.boughtPrice ?? w.price);
  }
  return { total: Math.round(total), bottles, unpriced };
}
