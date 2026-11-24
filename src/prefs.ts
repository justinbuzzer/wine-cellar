// Preferences kept in the workbook's "App Settings" table (Setting / Value), next
// to the storage layout, so every device uses the same: purchase defaults and the
// stocktake reminder. You can change the values there in Excel too.
// Pure (type-only imports), so it can be unit-tested.

import type { Cell } from "./data";
import type { Location } from "./locations";

export interface AppPrefs {
  /** GST added to "before GST" prices and by the invoice reader, in %. */
  gstRate: number;
  /** Where Add a purchase sends bottles unless you choose. */
  defaultWhere: Location;
  /** Add a purchase starts with "Not yet arrived" ticked. */
  defaultNya: boolean;
  /** Remind me to do a stocktake every N months (0 = never). */
  stocktakeMonths: number;
}

export const DEFAULT_PREFS: AppPrefs = { gstRate: 9, defaultWhere: "K Cellars", defaultNya: true, stocktakeMonths: 6 };

const KEYS: Record<keyof AppPrefs, string> = {
  gstRate: "GST rate %",
  defaultWhere: "Purchases go to",
  defaultNya: "Purchases not yet arrived",
  stocktakeMonths: "Stocktake reminder months",
};

export const STOCKTAKE_EVERY = [0, 3, 6, 12] as const;

export function prefsFromRows(rows: Record<string, Cell>[]): AppPrefs {
  const v = new Map(rows.map((r) => [String(r["Setting"] ?? "").trim().toLowerCase(), r["Value"]]));
  const get = (k: keyof AppPrefs) => v.get(KEYS[k].toLowerCase());
  const num = (c: Cell | undefined, min: number, max: number, dflt: number) => {
    const n = typeof c === "number" ? c : Number(String(c ?? "").replace(/[^0-9.]/g, ""));
    return String(c ?? "").trim() !== "" && Number.isFinite(n) && n >= min && n <= max ? n : dflt;
  };
  const where = String(get("defaultWhere") ?? "").trim().toLowerCase();
  const nya = String(get("defaultNya") ?? "").trim();
  return {
    gstRate: num(get("gstRate"), 0, 50, DEFAULT_PREFS.gstRate),
    defaultWhere: where === "home" ? "Home" : where === "k cellars" ? "K Cellars" : DEFAULT_PREFS.defaultWhere,
    defaultNya: nya ? /^(yes|y|true|1)$/i.test(nya) : DEFAULT_PREFS.defaultNya,
    stocktakeMonths: Math.round(num(get("stocktakeMonths"), 0, 60, DEFAULT_PREFS.stocktakeMonths)),
  };
}

/** Rows to write to the settings table. */
export function prefsRows(p: AppPrefs): [string, Cell][] {
  return [
    [KEYS.gstRate, p.gstRate],
    [KEYS.defaultWhere, p.defaultWhere],
    [KEYS.defaultNya, p.defaultNya ? "Yes" : "No"],
    [KEYS.stocktakeMonths, p.stocktakeMonths],
  ];
}

/** Whole months from one "YYYY-MM-DD" to another. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}
