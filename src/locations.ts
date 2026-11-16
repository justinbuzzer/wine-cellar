// Storage locations. Bottles are tracked per location in the Inventory table's
// "Qty K Cellars" and "Qty Home" columns; "Qty" is a formula summing the two.

export const LOCATIONS = ["K Cellars", "Home"] as const;
export type Location = (typeof LOCATIONS)[number];

export const COL_KC = "Qty K Cellars";
export const COL_HOME = "Qty Home";
export const LOCATION_COLUMN: Record<Location, string> = {
  "K Cellars": COL_KC,
  Home: COL_HOME,
};

/** Formula written into Qty for new wines. */
export const QTY_FORMULA = "=[@[Qty K Cellars]]+[@[Qty Home]]";
