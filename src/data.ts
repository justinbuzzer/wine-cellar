// Turns raw Excel table values into typed records. Columns are matched by header
// name, so the order of columns in the spreadsheet never matters.

import { COL_HOME, COL_KC } from "./locations";
import type { BlindGuess } from "./blindmodel";

export type Cell = string | number | boolean | null;

export interface Table {
  headers: string[];
  rows: Record<string, Cell>[];
}

export function headersOf(row: Cell[] | undefined): string[] {
  return (row ?? []).map((h) => String(h ?? "").trim());
}

export function recordFrom(headers: string[], row: Cell[]): Record<string, Cell> {
  const rec: Record<string, Cell> = {};
  headers.forEach((h, i) => {
    const v = row[i];
    rec[h] = v === "" || v === undefined ? null : v;
  });
  return rec;
}

export function toTable(values: Cell[][]): Table {
  const [headerRow, ...body] = values;
  const headers = headersOf(headerRow);
  return { headers, rows: body.map((r) => recordFrom(headers, r)) };
}

/** Loose text key for matching wine names: lower-case, no accents/punctuation. */
export function norm(s: Cell | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s).normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const INVENTORY_COLUMNS = [
  "WineID", "Country", "Region", "Location", "Producer", "Name", "Vintage",
  "Alcohol %", "Blend", "Varietal", "Price", "Type", "Source", "Status",
  "Remarks", "Qty", "Loc", "Qty K Cellars", "Qty Home",
] as const;

export const TASTING_COLUMNS = [
  "TastingID", "WineID", "Country", "Region", "Location", "Producer", "Name",
  "Vintage", "Alcohol %", "Blend", "Varietal", "Price", "Type", "Nose",
  "Nose Intensity", "Taste", "Palate Intensity", "Dryness", "Finish", "Acid",
  "Body", "Tannin", "Tannin Nature", "Colour", "Maturing/Fermenting Vessel",
  "Viniculture/Viticulture", "Note", "Score", "Source", "Year Tasted",
  "Age Tasted", "Date Tasted",
] as const;

export interface SchemaCheck {
  missing: string[];
  extra: string[];
}

export function checkSchema(headers: string[], expected: readonly string[]): SchemaCheck {
  return {
    missing: expected.filter((c) => !headers.includes(c)),
    extra: headers.filter((h) => !expected.includes(h)),
  };
}

// ---- value converters -------------------------------------------------------

const str = (v: Cell): string | null => (v === null ? null : String(v).trim() || null);

const num = (v: Cell): number | null => {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Bottle count: a number or numeric text; anything else counts as 0. */
const count = (v: Cell): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+(\.0+)?\s*$/.test(v) ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Vintage is a year number, or "NV". */
export function vintage(v: Cell): number | "NV" | null {
  if (v === null) return null;
  if (typeof v === "string" && v.trim().toUpperCase() === "NV") return "NV";
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/** Excel stores 13.5% as 0.135. Returns 13.5. */
export function alcoholPct(v: Cell): number | null {
  const n = num(v);
  if (n === null) return null;
  return Math.round((n <= 1 ? n * 100 : n) * 10) / 10;
}

/** Excel date serial (days since 1899-12-30) -> "YYYY-MM-DD". */
export function excelDate(v: Cell): string | null {
  if (v === null) return null;
  if (typeof v === "number") {
    const ms = Date.UTC(1899, 11, 30) + Math.round(v * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  return str(v);
}

// ---- typed records ----------------------------------------------------------

export interface Wine {
  wineId: string | null;
  country: string | null;
  region: string | null;
  location: string | null;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  alcohol: number | null;
  blend: string | null;
  varietal: string | null;
  price: number | null;
  type: string | null;
  source: string | null;
  status: string | null;
  remarks: string | null;
  qty: number;
  /** Bottles at K Cellars / Home; null if the table has no location columns. */
  kc: number | null;
  home: number | null;
  /** Legacy free-text location (replaced by kc/home). */
  loc: string | null;
  /** Year bought ("Year Purchased" column, filled in automatically for wines added in the app). */
  yearPurchased: number | null;
  /** Which K Cellars boxes / Home racks hold the bottles, e.g. "A2 (2), B3 (1)" (see spots.ts). */
  kcSpots: string | null;
  homeSpots: string | null;
}

/** A plausible year (1900–2200), or null. */
export function yearCell(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 1900 && n <= 2200 ? n : null;
}

export function toWine(r: Record<string, Cell>): Wine {
  return {
    wineId: str(r["WineID"]),
    country: str(r["Country"]),
    region: str(r["Region"]),
    location: str(r["Location"]),
    producer: str(r["Producer"]),
    name: str(r["Name"]),
    vintage: vintage(r["Vintage"]),
    alcohol: alcoholPct(r["Alcohol %"]),
    blend: str(r["Blend"]),
    varietal: str(r["Varietal"]),
    price: num(r["Price"]),
    type: str(r["Type"]),
    source: str(r["Source"]),
    status: str(r["Status"]),
    remarks: str(r["Remarks"]),
    // With location columns, K Cellars + Home is the source of truth; the Qty cell
    // is only a convenience formula for Excel and may not be calculating.
    // (A Qty typed directly in Excel with no location counts is still respected.)
    qty: COL_KC in r && COL_HOME in r ? count(r[COL_KC]) + count(r[COL_HOME]) || count(r["Qty"]) : num(r["Qty"]) ?? 0,
    kc: COL_KC in r ? count(r[COL_KC]) : null,
    home: COL_HOME in r ? count(r[COL_HOME]) : null,
    loc: str(r["Loc"]),
    yearPurchased: yearCell(r["Year Purchased"]),
    // These columns are added the first time a bottle is put in a box or rack.
    kcSpots: str(r["K Cellars Box"] ?? null),
    homeSpots: str(r["Home Rack"] ?? null),
  };
}

/** Name without a repeated producer prefix ("Torbreck RunRig" -> "RunRig"). */
export function shortName(w: Pick<Wine, "producer" | "name">): string {
  const name = w.name ?? "";
  const p = w.producer ?? "";
  if (p && norm(name).startsWith(norm(p)) && name.length > p.length) {
    const rest = name.slice(p.length).replace(/^[\s,\-–:]+/, "");
    if (rest) return rest;
  }
  return name;
}

export interface Tasting {
  tastingId: string | null;
  wineId: string | null;
  country: string | null;
  region: string | null;
  location: string | null;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  alcohol: number | null;
  blend: string | null;
  varietal: string | null;
  price: number | null;
  type: string | null;
  nose: string | null;
  noseIntensity: string | null;
  taste: string | null;
  palateIntensity: string | null;
  dryness: string | null;
  finish: string | null;
  acid: string | null;
  body: string | null;
  tannin: string | null;
  tanninNature: string | null;
  colour: string | null;
  vessel: string | null;
  viticulture: string | null;
  note: string | null;
  score: number | null;
  source: string | null;
  yearTasted: number | null;
  ageTasted: number | null;
  dateTasted: string | null;
  /** Tasted blind (the "Blind" column). */
  blind: boolean;
  /** What you guessed when tasting it blind. */
  guess: BlindGuess | null;
}

export function toTasting(r: Record<string, Cell>): Tasting {
  return {
    tastingId: str(r["TastingID"]),
    wineId: str(r["WineID"]),
    country: str(r["Country"]),
    region: str(r["Region"]),
    location: str(r["Location"]),
    producer: str(r["Producer"]),
    name: str(r["Name"]),
    vintage: vintage(r["Vintage"]),
    alcohol: alcoholPct(r["Alcohol %"]),
    blend: str(r["Blend"]),
    varietal: str(r["Varietal"]),
    price: num(r["Price"]),
    type: str(r["Type"]),
    nose: str(r["Nose"]),
    noseIntensity: str(r["Nose Intensity"]),
    taste: str(r["Taste"]),
    palateIntensity: str(r["Palate Intensity"]),
    dryness: str(r["Dryness"]),
    finish: str(r["Finish"]),
    acid: str(r["Acid"]),
    body: str(r["Body"]),
    tannin: str(r["Tannin"]),
    tanninNature: str(r["Tannin Nature"]),
    colour: str(r["Colour"]),
    vessel: str(r["Maturing/Fermenting Vessel"]),
    viticulture: str(r["Viniculture/Viticulture"]),
    note: str(r["Note"]),
    score: num(r["Score"]),
    source: str(r["Source"]),
    yearTasted: num(r["Year Tasted"]),
    ageTasted: num(r["Age Tasted"]),
    dateTasted: excelDate(r["Date Tasted"]),
    blind: /^(yes|y|true|1)$/i.test(String(r["Blind"] ?? "").trim()),
    guess: {
      grape: str(r["Guess Grape"] ?? null),
      country: str(r["Guess Country"] ?? null),
      region: str(r["Guess Region"] ?? null),
      vintage: str(r["Guess Vintage"] ?? null),
    },
  };
}

export function formatPrice(p: number | null, currency: string): string {
  if (p === null) return "";
  const amount = new Intl.NumberFormat("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(p);
  // en-SG renders SGD as a bare "$"; spell it out so it's unambiguous.
  if (currency === "SGD") return `S$${amount}`;
  return new Intl.NumberFormat("en-SG", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(p);
}
