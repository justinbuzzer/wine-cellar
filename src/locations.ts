// Storage locations and the one-off rule for converting the old "Loc" column.
// Pure module: safe to unit-test without a browser.

export const LOCATIONS = ["K Cellars", "Home"] as const;
export type Location = (typeof LOCATIONS)[number];

export const COL_KC = "Qty K Cellars";
export const COL_HOME = "Qty Home";
export const LOCATION_COLUMN: Record<Location, string> = {
  "K Cellars": COL_KC,
  Home: COL_HOME,
};

/** Qty becomes the sum of the two location columns. */
export const QTY_FORMULA = "=[@[Qty K Cellars]]+[@[Qty Home]]";

export type SplitRule = "kc" | "home" | "partial" | "unknown";

/**
 * Conversion rule agreed for the old Loc column ("Fridge" = Home):
 *   blank       -> all bottles at K Cellars
 *   Fridge      -> all bottles at Home
 *   Fridge (n)  -> n bottles at Home (capped at Qty), the rest at K Cellars
 *   anything else -> K Cellars, flagged as "unknown" in the preview
 */
export function splitFromLoc(qty: number | null, loc: string | null): { kc: number; home: number; rule: SplitRule } {
  const q = Math.max(0, Math.round(qty ?? 0));
  const l = (loc ?? "").trim();
  if (!l) return { kc: q, home: 0, rule: "kc" };
  const m = /^fridge\s*(?:\(\s*(\d+)\s*\))?$/i.exec(l);
  if (!m) return { kc: q, home: 0, rule: "unknown" };
  if (m[1] === undefined) return { kc: 0, home: q, rule: "home" };
  const home = Math.min(Number(m[1]), q);
  return { kc: q - home, home, rule: "partial" };
}
