// Purchase records: one row per wine per purchase, written when bottles you
// bought go into the cellar (Add a purchase, Add a wine, your share of a Group
// Buy). Only your own bottles: friends' shares of a Group Buy aren't counted.
// Pure (type-only imports apart from date parsing), so it can be unit-tested.

import type { Cell } from "./data";
import { toIsoDate } from "./historymodel";
import type { MonthBar } from "./overview";

export const PURCHASE_COLUMNS = [
  "PurchaseID", "Date Bought", "WineID", "Producer", "Name", "Vintage", "Type",
  "Bottles", "Price", "Source", "To", "Group Buy",
] as const;

export interface Purchase {
  purchaseId: string;
  /** "YYYY-MM-DD" */
  date: string | null;
  wineId: string | null;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  type: string | null;
  /** Can be negative: a Group Buy share made smaller later. */
  bottles: number;
  /** Per bottle, after GST; null when not known. */
  price: number | null;
  source: string | null;
  to: string | null;
  /** The Group Buy's name (or ID) when this was your share of one. */
  groupBuy: string | null;
}

const str = (v: Cell | undefined): string | null => (v === null || v === undefined ? null : String(v).trim() || null);

const num = (v: Cell | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function toPurchase(r: Record<string, Cell>): Purchase {
  const v = r["Vintage"];
  return {
    purchaseId: str(r["PurchaseID"] ?? null) ?? "",
    date: toIsoDate(r["Date Bought"] ?? null),
    wineId: str(r["WineID"] ?? null),
    producer: str(r["Producer"] ?? null),
    name: str(r["Name"] ?? null),
    vintage: typeof v === "string" && v.trim().toUpperCase() === "NV" ? "NV" : num(v) === null ? null : Math.round(num(v)!),
    type: str(r["Type"] ?? null),
    bottles: Math.round(num(r["Bottles"] ?? null) ?? 0),
    price: num(r["Price"] ?? null),
    source: str(r["Source"] ?? null),
    to: str(r["To"] ?? null),
    groupBuy: str(r["Group Buy"] ?? null),
  };
}

export interface PurchaseTotals {
  bottles: number;
  /** What the priced bottles cost. */
  spend: number;
  /** Bottles with no price (left out of spend). */
  unpriced: number;
  /** Bottles that were your share of a Group Buy. */
  groupBottles: number;
}

export function purchaseTotals(xs: Purchase[]): PurchaseTotals {
  let bottles = 0, spend = 0, unpriced = 0, groupBottles = 0;
  for (const p of xs) {
    bottles += p.bottles;
    if (p.price === null) unpriced += p.bottles;
    else spend += p.price * p.bottles;
    if (p.groupBuy) groupBottles += p.bottles;
  }
  return { bottles, spend: Math.round(spend), unpriced, groupBottles };
}

/** "2026-10" -> "Oct 2026". */
export function monthName(key: string): string {
  return new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, 1)).toLocaleDateString("en-SG", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** The last 12 months, oldest first: key "YYYY-MM", short label ("Nov"). */
export function lastMonths(today: string, count = 12): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1));
    out.unshift({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-SG", { month: "short", timeZone: "UTC" }),
    });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Bottles bought per month for the last 12 months, oldest first (money = what they cost). */
export function purchasesByMonth(xs: Purchase[], today: string): MonthBar[] {
  return lastMonths(today).map(({ key, label }) => {
    const t = purchaseTotals(xs.filter((p) => p.date?.startsWith(key)));
    return { key, label, value: Math.max(0, t.bottles), money: t.spend };
  });
}
