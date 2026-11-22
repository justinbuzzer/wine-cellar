// Where bottles are kept: the storage layout (Settings) and each wine's spots.
// Pure (type-only imports), so it can be unit-tested without a browser.
//
// Spots are written on the wine's own Inventory row, one cell per location:
//   K Cellars Box  "A2 (2), B3 (1)"   or just "A2" when every bottle there is in A2
//   Home Rack      "Rack 2"
// Bottles not covered by the list are "not placed". The bottle counts (Qty K
// Cellars / Qty Home) stay the source of truth; the spot list only says where.

import type { Cell, Wine } from "./data";
import type { Location } from "./locations";

// ---- Layout -----------------------------------------------------------------------

export interface Layout {
  kcCols: number;
  kcRows: number;
  /** Which end of the stack row 1 is (only changes how the grid is drawn). */
  kcRow1: "Top" | "Bottom";
  /** An overflow spot on top of each column ("A top"). */
  kcOverflow: boolean;
  /** Loose cardboard boxes L1, L2, … */
  kcLoose: number;
  homeRacks: number;
  /** A spot for bottles that don't fit on a rack. */
  homeOverflow: boolean;
}

export const DEFAULT_LAYOUT: Layout = {
  kcCols: 0, kcRows: 0, kcRow1: "Top", kcOverflow: true, kcLoose: 0, homeRacks: 0, homeOverflow: true,
};

/** Columns A–K: "L" is kept for loose boxes. */
export const MAX_COLS = 11;
export const MAX_ROWS = 20;
export const MAX_LOOSE = 60;
export const MAX_RACKS = 20;

const KEYS: Record<keyof Layout, string> = {
  kcCols: "K Cellars columns",
  kcRows: "K Cellars rows",
  kcRow1: "K Cellars row 1 is at the",
  kcOverflow: "K Cellars overflow on top",
  kcLoose: "K Cellars loose boxes",
  homeRacks: "Home fridge racks",
  homeOverflow: "Home fridge overflow",
};

const yes = (v: Cell | undefined) => /^(yes|y|true|1|on)$/i.test(String(v ?? "").trim());
const int = (v: Cell | undefined, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

/** Layout from the Settings table's rows (Setting / Value). Missing values use the defaults. */
export function layoutFromRows(rows: Record<string, Cell>[]): Layout {
  const v = new Map(rows.map((r) => [String(r["Setting"] ?? "").trim().toLowerCase(), r["Value"]]));
  const get = (k: keyof Layout) => v.get(KEYS[k].toLowerCase());
  const has = (k: keyof Layout) => v.has(KEYS[k].toLowerCase());
  return {
    kcCols: int(get("kcCols"), MAX_COLS),
    kcRows: int(get("kcRows"), MAX_ROWS),
    kcRow1: /^bottom$/i.test(String(get("kcRow1") ?? "").trim()) ? "Bottom" : "Top",
    kcOverflow: has("kcOverflow") ? yes(get("kcOverflow")) : DEFAULT_LAYOUT.kcOverflow,
    kcLoose: int(get("kcLoose"), MAX_LOOSE),
    homeRacks: int(get("homeRacks"), MAX_RACKS),
    homeOverflow: has("homeOverflow") ? yes(get("homeOverflow")) : DEFAULT_LAYOUT.homeOverflow,
  };
}

/** Rows to write to the Settings table. */
export function layoutRows(l: Layout): [string, Cell][] {
  return [
    [KEYS.kcCols, l.kcCols],
    [KEYS.kcRows, l.kcRows],
    [KEYS.kcRow1, l.kcRow1],
    [KEYS.kcOverflow, l.kcOverflow ? "Yes" : "No"],
    [KEYS.kcLoose, l.kcLoose],
    [KEYS.homeRacks, l.homeRacks],
    [KEYS.homeOverflow, l.homeOverflow ? "Yes" : "No"],
  ];
}

export const columnLetters = (n: number) => "ABCDEFGHIJK".slice(0, Math.max(0, Math.min(MAX_COLS, n))).split("");
export const topSpot = (col: string) => `${col} top`;
export const looseSpot = (i: number) => `L${i}`;
export const rackSpot = (i: number) => `Rack ${i}`;
export const HOME_OVERFLOW = "Overflow";

/** Row numbers in the order they're drawn, top of the stack first. */
export function drawnRows(l: Layout): number[] {
  const rows = Array.from({ length: l.kcRows }, (_, i) => i + 1);
  return l.kcRow1 === "Bottom" ? rows.reverse() : rows;
}

export const hasGrid = (l: Layout) => l.kcCols > 0 && l.kcRows > 0;

/** Whether a location has any spots set up. */
export function isSetUp(l: Layout, loc: Location): boolean {
  return loc === "Home" ? l.homeRacks > 0 : hasGrid(l) || l.kcLoose > 0;
}

/** Every spot in the layout, in drawing order. */
export function spotsFor(l: Layout, loc: Location): string[] {
  if (loc === "Home") {
    if (l.homeRacks === 0) return [];
    const racks = Array.from({ length: l.homeRacks }, (_, i) => rackSpot(i + 1));
    return l.homeOverflow ? [...racks, HOME_OVERFLOW] : racks;
  }
  const cols = columnLetters(l.kcCols);
  const out: string[] = [];
  if (hasGrid(l)) {
    if (l.kcOverflow) out.push(...cols.map(topSpot));
    for (const r of drawnRows(l)) out.push(...cols.map((c) => `${c}${r}`));
  }
  for (let i = 1; i <= l.kcLoose; i++) out.push(looseSpot(i));
  return out;
}

/** Tidies a spot as typed (e.g. in Excel): "a2" → "A2", "r3" → "Rack 3", "C-top" → "C top". */
export function normSpot(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  if ((m = /^([a-z])\s*-?\s*top$/i.exec(s))) return topSpot(m[1].toUpperCase());
  if ((m = /^r(?:ack)?\s*(\d+)$/i.exec(s))) return rackSpot(Number(m[1]));
  if (/^overflow$/i.test(s)) return HOME_OVERFLOW;
  if ((m = /^([a-z])\s*(\d+)$/i.exec(s))) return `${m[1].toUpperCase()}${Number(m[2])}`;
  return s;
}

// ---- A wine's spots ---------------------------------------------------------------

export interface SpotCount {
  spot: string;
  n: number;
}

export interface Placement {
  spots: SpotCount[];
  /** Bottles at the location not in any spot. */
  unplaced: number;
  /** Bottles the spot list mentions beyond the real count (typed in Excel); ignored. */
  over: number;
}

const ITEM = /^(.*?)\s*(?:\((\d+)\)|[×x]\s*(\d+))\s*$/i;

/**
 * Reads a spot list for a location holding `total` bottles. A spot without a
 * count holds whatever isn't listed elsewhere ("A2" alone = all of them there).
 */
export function parseSpots(text: Cell | undefined, total: number): Placement {
  const items: { spot: string; n: number | null }[] = [];
  for (const part of String(text ?? "").split(/[,;\n]/)) {
    const raw = part.trim();
    if (!raw) continue;
    const m = ITEM.exec(raw);
    const spot = normSpot(m ? m[1] : raw);
    if (!spot) continue;
    const n = m ? Number(m[2] ?? m[3]) : null;
    const same = items.find((i) => i.spot === spot);
    if (same) same.n = same.n === null && n === null ? null : (same.n ?? 1) + (n ?? 1);
    else items.push({ spot, n });
  }
  const counted = items.reduce((s, i) => s + (i.n ?? 0), 0);
  const open = items.filter((i) => i.n === null);
  if (open.length === 1) open[0].n = Math.max(0, total - counted);
  else for (const i of open) i.n = 1;
  let spots = items.map((i) => ({ spot: i.spot, n: i.n ?? 0 })).filter((s) => s.n > 0);
  let sum = spots.reduce((s, x) => s + x.n, 0);
  let over = 0;
  if (sum > total) {
    over = sum - total;
    for (let k = spots.length - 1; k >= 0 && sum > total; k--) {
      const cut = Math.min(spots[k].n, sum - total);
      spots[k].n -= cut;
      sum -= cut;
    }
    spots = spots.filter((s) => s.n > 0);
  }
  return { spots, unplaced: Math.max(0, total - sum), over };
}

/** The text to store: "A2" when one spot has every bottle, else "A2 (2), B3 (1)". */
export function formatSpots(spots: SpotCount[], total: number): string {
  const xs = spots.filter((s) => s.n > 0);
  if (xs.length === 1 && xs[0].n === total) return xs[0].spot;
  return xs.map((s) => `${s.spot} (${s.n})`).join(", ");
}

/**
 * Takes `n` bottles: from `spot` first (null or undefined = the not-placed ones),
 * then from not-placed bottles, then from the fullest spots.
 */
export function takeFrom(p: Placement, n: number, spot?: string | null): Placement {
  const spots = p.spots.map((s) => ({ ...s }));
  let unplaced = p.unplaced;
  let left = n;
  const from = (s: SpotCount) => {
    const k = Math.min(s.n, left);
    s.n -= k;
    left -= k;
  };
  if (spot) {
    const s = spots.find((x) => x.spot === spot);
    if (s) from(s);
  }
  const k = Math.min(unplaced, left);
  unplaced -= k;
  left -= k;
  for (const s of [...spots].sort((a, b) => b.n - a.n)) {
    if (left <= 0) break;
    from(s);
  }
  return { spots: spots.filter((s) => s.n > 0), unplaced, over: p.over };
}

/** Puts `n` bottles in `spot` (null = not placed). */
export function putIn(p: Placement, n: number, spot: string | null): Placement {
  if (!spot) return { ...p, unplaced: p.unplaced + n };
  const spots = p.spots.map((s) => ({ ...s }));
  const s = spots.find((x) => x.spot === spot);
  if (s) s.n += n;
  else spots.push({ spot, n });
  return { ...p, spots };
}

/**
 * The new spot list after a location's count changes from `before` to `after`:
 * removed bottles come out of `from` (else not-placed first), added ones go in `to`.
 */
export function changeSpots(text: Cell | undefined, before: number, after: number, opts: { from?: string | null; to?: string | null } = {}): string {
  let p = parseSpots(text, before);
  if (after < before) p = takeFrom(p, before - after, opts.from);
  else if (after > before) p = putIn(p, after - before, opts.to ?? null);
  return formatSpots(p.spots, after);
}

export const spotText = (w: Pick<Wine, "kcSpots" | "homeSpots">, loc: Location) => (loc === "Home" ? w.homeSpots : w.kcSpots);
export const countAt = (w: Pick<Wine, "kc" | "home">, loc: Location) => Math.max(0, (loc === "Home" ? w.home : w.kc) ?? 0);
const onOrder = (w: Pick<Wine, "status">) => (w.status ?? "").trim().toUpperCase() === "NYA";

export function placementOf(w: Wine, loc: Location): Placement {
  return parseSpots(spotText(w, loc), countAt(w, loc));
}

/** Where a wine's bottles can be taken from: each spot, and the not-placed ones. */
export interface Source {
  loc: Location;
  /** null = not placed */
  spot: string | null;
  n: number;
}

export function sourcesOf(w: Wine): Source[] {
  const out: Source[] = [];
  for (const loc of ["K Cellars", "Home"] as Location[]) {
    const p = placementOf(w, loc);
    for (const s of p.spots) out.push({ loc, spot: s.spot, n: s.n });
    if (p.unplaced > 0) out.push({ loc, spot: null, n: p.unplaced });
  }
  return out;
}

export const sourceKey = (s: { loc: Location; spot: string | null }) => `${s.loc}|${s.spot ?? ""}`;
export const spotName = (spot: string | null) => spot ?? "not placed";
export const sourceLabel = (s: { loc: Location; spot: string | null }) => `${s.loc} · ${spotName(s.spot)}`;

/** Bottles per spot at a location (wines on order aren't there yet, so they're left out). */
export function spotTotals(wines: Wine[], loc: Location): { bySpot: Map<string, number>; unplaced: number; unplacedWines: number } {
  const bySpot = new Map<string, number>();
  let unplaced = 0;
  let unplacedWines = 0;
  for (const w of wines) {
    if (onOrder(w) || countAt(w, loc) === 0) continue;
    const p = placementOf(w, loc);
    for (const s of p.spots) bySpot.set(s.spot, (bySpot.get(s.spot) ?? 0) + s.n);
    if (p.unplaced > 0) {
      unplaced += p.unplaced;
      unplacedWines++;
    }
  }
  return { bySpot, unplaced, unplacedWines };
}

/** The wines in one spot (null = not placed), with how many bottles of each. */
export function winesIn(wines: Wine[], loc: Location, spot: string | null): { wine: Wine; n: number }[] {
  const out: { wine: Wine; n: number }[] = [];
  for (const w of wines) {
    if (onOrder(w) || countAt(w, loc) === 0) continue;
    const p = placementOf(w, loc);
    const n = spot === null ? p.unplaced : p.spots.find((s) => s.spot === spot)?.n ?? 0;
    if (n > 0) out.push({ wine: w, n });
  }
  return out;
}

/** Spots holding bottles that aren't in the layout (removed from it, or typed in Excel). */
export function strays(wines: Wine[], l: Layout, loc: Location): [string, number][] {
  const valid = new Set(spotsFor(l, loc));
  return [...spotTotals(wines, loc).bySpot].filter(([s, n]) => n > 0 && !valid.has(s)).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}
