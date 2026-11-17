// Bottle history records: one row per bottle opened. Pure (type-only imports),
// so it can be unit-tested without a browser.

import type { Cell, Tasting } from "./data";

export const HISTORY_COLUMNS = [
  "OpenID", "Date Opened", "WineID", "Producer", "Name", "Vintage", "Type", "From", "Price", "Occasion",
] as const;

export interface Opening {
  openId: string;
  /** "YYYY-MM-DD" */
  date: string | null;
  wineId: string | null;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  type: string | null;
  from: string | null;
  price: number | null;
  occasion: string | null;
}

const str = (v: Cell | undefined): string | null => (v === null || v === undefined ? null : String(v).trim() || null);

const num = (v: Cell | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Excel date serial or text -> "YYYY-MM-DD" (null if unreadable). */
export function toIsoDate(v: Cell | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function toOpening(r: Record<string, Cell>): Opening {
  const v = r["Vintage"];
  return {
    openId: str(r["OpenID"]) ?? "",
    date: toIsoDate(r["Date Opened"]),
    wineId: str(r["WineID"]),
    producer: str(r["Producer"]),
    name: str(r["Name"]),
    vintage: typeof v === "string" && v.trim().toUpperCase() === "NV" ? "NV" : num(v) === null ? null : Math.round(num(v)!),
    type: str(r["Type"]),
    from: str(r["From"]),
    price: num(r["Price"]),
    occasion: str(r["Occasion"]),
  };
}

/** Newest first; undated entries last. */
export function newestOpenings(xs: Opening[]): Opening[] {
  return [...xs].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.openId.localeCompare(a.openId));
}

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

/** The tasting note written for this bottle: same wine, tasted within a day of opening. */
export function noteFor(o: Opening, tastings: Tasting[]): Tasting | null {
  if (!o.wineId || !o.date) return null;
  const day = dayNumber(o.date);
  return (
    tastings.find((t) => t.wineId === o.wineId && t.dateTasted && /^\d{4}-\d{2}-\d{2}/.test(t.dateTasted) && Math.abs(dayNumber(t.dateTasted) - day) <= 1) ??
    null
  );
}

export interface MonthGroup {
  key: string; // "2026-11"
  label: string; // "November 2026"
  entries: Opening[];
}

/** Groups (already sorted) openings by calendar month. */
export function byMonth(xs: Opening[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const o of xs) {
    const key = o.date ? o.date.slice(0, 7) : "undated";
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const label = o.date
        ? new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, 1)).toLocaleDateString("en-SG", { month: "long", year: "numeric", timeZone: "UTC" })
        : "No date";
      g = { key, label, entries: [] };
      groups.push(g);
    }
    g.entries.push(o);
  }
  return groups;
}
