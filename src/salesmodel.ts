// Sales records and the numbers worked out from them. One row per sale (which
// may be several bottles of one wine). Pure (type-only imports), so it can be
// unit-tested without a browser.

import { yearCell, type Cell } from "./data";
import { toIsoDate } from "./historymodel";
import type { Bar } from "./overview";

export const SALES_COLUMNS = [
  "SaleID", "Date Sold", "WineID", "Producer", "Name", "Vintage", "Type", "From",
  "Bottles", "Bought Price", "Sale Price", "Year Bought", "Buyer", "Notes",
] as const;

export interface Sale {
  saleId: string;
  /** "YYYY-MM-DD" */
  date: string | null;
  wineId: string | null;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  type: string | null;
  from: string | null;
  bottles: number;
  /** Per bottle, what it cost you. */
  boughtPrice: number | null;
  /** Per bottle, what you sold it for. */
  salePrice: number | null;
  /** The year you bought it, e.g. 2016. */
  boughtYear: number | null;
  buyer: string | null;
  notes: string | null;
}

const str = (v: Cell | undefined): string | null => (v === null || v === undefined ? null : String(v).trim() || null);

const num = (v: Cell | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** A plausible year (1900–2200), or null. */
export const yearOf = yearCell;

export function toSale(r: Record<string, Cell>): Sale {
  const v = r["Vintage"];
  const b = num(r["Bottles"]);
  return {
    saleId: str(r["SaleID"]) ?? "",
    date: toIsoDate(r["Date Sold"]),
    wineId: str(r["WineID"]),
    producer: str(r["Producer"]),
    name: str(r["Name"]),
    vintage: typeof v === "string" && v.trim().toUpperCase() === "NV" ? "NV" : num(v) === null ? null : Math.round(num(v)!),
    type: str(r["Type"]),
    from: str(r["From"]),
    bottles: b !== null && b > 0 ? Math.round(b) : 1,
    boughtPrice: num(r["Bought Price"]),
    salePrice: num(r["Sale Price"]),
    boughtYear: yearOf(r["Year Bought"]),
    buyer: str(r["Buyer"]),
    notes: str(r["Notes"]),
  };
}

/** Newest first; undated entries last. */
export function newestSales(xs: Sale[]): Sale[] {
  return [...xs].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.saleId.localeCompare(a.saleId));
}

/** Whole years between the year bought and the year sold, or null if unknown (or the order is wrong). */
export function heldYears(s: Pick<Sale, "date" | "boughtYear">): number | null {
  if (!s.date || s.boughtYear === null) return null;
  const y = Number(s.date.slice(0, 4)) - s.boughtYear;
  return y >= 0 ? y : null;
}

/** "Under a year", "1 year", "7 years", "7.4 years" (averages). */
export function formatHeld(years: number | null): string {
  if (years === null) return "–";
  if (years < 0.95) return Number.isInteger(years) ? "Under a year" : `${Math.round(years * 10) / 10} years`;
  const r = years < 10 ? Math.round(years * 10) / 10 : Math.round(years);
  return `${r} year${r === 1 ? "" : "s"}`;
}

export interface SaleMoney {
  revenue: number;
  /** Purchase cost of the bottles sold; null when the purchase price isn't known. */
  cost: number | null;
  gain: number | null;
  /** Gain as a fraction of cost (0.25 = +25%). */
  pct: number | null;
  /** Yearly return (compound), only when kept at least a year. */
  annual: number | null;
}

export function saleMoney(s: Sale): SaleMoney {
  const revenue = (s.salePrice ?? 0) * s.bottles;
  const cost = s.boughtPrice !== null ? s.boughtPrice * s.bottles : null;
  const gain = cost !== null && s.salePrice !== null ? revenue - cost : null;
  const pct = gain !== null && cost ? gain / cost : null;
  const years = heldYears(s);
  const annual = pct !== null && years !== null && years >= 1 ? Math.pow(1 + pct, 1 / years) - 1 : null;
  return { revenue, cost, gain, pct, annual };
}

export interface SalesTotals {
  sales: number;
  bottles: number;
  revenue: number;
  /** Only sales where both prices are known count towards cost / gain. */
  cost: number;
  gain: number;
  pct: number | null;
  /** Revenue of sales with no purchase price (left out of cost and gain). */
  unpricedRevenue: number;
  unpricedBottles: number;
  /** Average years kept, weighted by bottles; null when no year bought is known. */
  avgHeldYears: number | null;
  /** Bottles with a known year bought. */
  datedBottles: number;
  /** Yearly return over sales with a year bought and prices: total gain vs cost, over the average years kept. */
  annual: number | null;
}

export function salesTotals(xs: Sale[]): SalesTotals {
  let bottles = 0, revenue = 0, cost = 0, gain = 0, unpricedRevenue = 0, unpricedBottles = 0;
  let heldSum = 0, datedBottles = 0;
  let aCost = 0, aGain = 0, aYears = 0;
  for (const s of xs) {
    const m = saleMoney(s);
    bottles += s.bottles;
    revenue += m.revenue;
    if (m.gain !== null && m.cost !== null) {
      cost += m.cost;
      gain += m.gain;
    } else {
      unpricedRevenue += m.revenue;
      unpricedBottles += s.bottles;
    }
    const y = heldYears(s);
    if (y !== null) {
      heldSum += y * s.bottles;
      datedBottles += s.bottles;
      if (m.gain !== null && m.cost) {
        aCost += m.cost;
        aGain += m.gain;
        aYears += y * m.cost;
      }
    }
  }
  const avgCostYears = aCost ? aYears / aCost : 0;
  return {
    sales: xs.length,
    bottles,
    revenue,
    cost,
    gain,
    pct: cost ? gain / cost : null,
    unpricedRevenue,
    unpricedBottles,
    avgHeldYears: datedBottles ? heldSum / datedBottles : null,
    datedBottles,
    annual: aCost && avgCostYears >= 1 ? Math.pow(1 + aGain / aCost, 1 / avgCostYears) - 1 : null,
  };
}

/** Bottles sold per month for the last 12 months, oldest first (sub = money taken). */
export function salesByMonth(xs: Sale[], today: string): (Bar & { revenue: number })[] {
  const out: (Bar & { revenue: number })[] = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", { month: "short", timeZone: "UTC" });
    const hits = xs.filter((s) => s.date?.startsWith(key));
    out.unshift({
      key,
      label,
      value: hits.reduce((n, s) => n + s.bottles, 0),
      revenue: hits.reduce((n, s) => n + saleMoney(s).revenue, 0),
    });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export const HELD_BUCKETS = ["Under a year", "1–2 years", "3–4 years", "5–9 years", "10+ years"] as const;

function heldBucket(y: number): (typeof HELD_BUCKETS)[number] {
  return y < 1 ? HELD_BUCKETS[0] : y < 3 ? HELD_BUCKETS[1] : y < 5 ? HELD_BUCKETS[2] : y < 10 ? HELD_BUCKETS[3] : HELD_BUCKETS[4];
}

export interface Group {
  key: string;
  totals: SalesTotals;
}

/** Sales grouped by how many years the bottles were kept (only sales with a year bought). */
export function byHeld(xs: Sale[]): Group[] {
  return HELD_BUCKETS.map((k) => ({ key: k, totals: salesTotals(xs.filter((s) => heldYears(s) !== null && heldBucket(heldYears(s)!) === k)) })).filter(
    (g) => g.totals.sales > 0,
  );
}

/** Sales grouped by a text field (e.g. buyer or type), biggest revenue first. */
export function byField(xs: Sale[], field: (s: Sale) => string | null, empty: string): Group[] {
  const m = new Map<string, Sale[]>();
  for (const s of xs) {
    const k = field(s) ?? empty;
    m.set(k, [...(m.get(k) ?? []), s]);
  }
  return [...m].map(([key, g]) => ({ key, totals: salesTotals(g) })).sort((a, b) => b.totals.revenue - a.totals.revenue);
}

/** Groups (already sorted) sales by calendar month. */
export function byMonthKey(xs: Sale[]): { key: string; label: string; entries: Sale[] }[] {
  const groups: { key: string; label: string; entries: Sale[] }[] = [];
  for (const s of xs) {
    const key = s.date ? s.date.slice(0, 7) : "undated";
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const label = s.date
        ? new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, 1)).toLocaleDateString("en-SG", { month: "long", year: "numeric", timeZone: "UTC" })
        : "No date";
      g = { key, label, entries: [] };
      groups.push(g);
    }
    g.entries.push(s);
  }
  return groups;
}

/** The most recent year bought recorded for this wine in earlier sales, to pre-fill the next one. */
export function lastBoughtYear(xs: Sale[], wineId: string): number | null {
  return newestSales(xs.filter((s) => s.wineId === wineId && s.boughtYear !== null))[0]?.boughtYear ?? null;
}

export function formatPct(p: number | null): string {
  if (p === null) return "–";
  const v = Math.round(p * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}
