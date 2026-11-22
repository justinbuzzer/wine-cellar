// Stocktake: the rules, kept pure (type-only imports) so they can be unit-tested
// without a browser.
//
// While counting, each wine you tick records what the app *expected* at that
// location at that moment and what you *counted*. Nothing touches the workbook
// until you apply, and applying works from a fixed plan so it can be retried
// safely (see stocktake.ts).

import { shortName, type Wine } from "./data";
import type { BaseEntry, BoxCheck } from "./boxcount";
import { formatSpots, parseSpots } from "./spots";
import type { Location } from "./locations";

export const LOCS: readonly Location[] = ["K Cellars", "Home"];
export const other = (l: Location): Location => (l === "Home" ? "K Cellars" : "Home");
/** Short route names: #/stocktake/count/kc */
export const LOC_SLUG: Record<Location, string> = { "K Cellars": "kc", Home: "home" };
export const locFromSlug = (s: string | undefined): Location | null => (s === "kc" ? "K Cellars" : s === "home" ? "Home" : null);

export interface CountEntry {
  /** Bottles the app expected here when you counted this wine. */
  expected: number;
  counted: number;
  /** When you counted it (ms). */
  at: number;
}

export type Reason = "drunk" | "sold" | "gift" | "broken" | "moved" | "bought" | "unknown";

export interface Choice {
  reason: Reason | null;
  /** Sale price per bottle as typed (only for "sold"; blank = unknown). */
  price: string;
}

export interface Stocktake {
  /** e.g. "ST-20261122-1430" */
  id: string;
  started: number;
  /** Last change on this device (ms). */
  updated: number;
  /** key `${location}|${wineId}` */
  counts: Record<string, CountEntry>;
  /** Reasons for differences, same keys as counts. */
  choices: Record<string, Choice>;
  /** Set once Apply has started: the exact changes, so a retry finishes the same job. */
  plan: Plan | null;
  /** Box-by-box counting (see boxcount.ts): key `${location}|${spot}`. */
  boxes?: Record<string, BoxCheck>;
  /** How each wine stood when first seen in a box count: key `${location}|${wineId}`. */
  base?: Record<string, BaseEntry>;
}

export const keyOf = (loc: Location, wineId: string) => `${loc}|${wineId}`;
export function parseKey(k: string): { loc: Location; wineId: string } {
  const i = k.indexOf("|");
  return { loc: k.slice(0, i) as Location, wineId: k.slice(i + 1) };
}

export function newStocktake(now = new Date()): Stocktake {
  const p = (n: number) => String(n).padStart(2, "0");
  const id = `ST-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return { id, started: now.getTime(), updated: now.getTime(), counts: {}, choices: {}, plan: null };
}

/** Bottles the list says are at this location. */
export function expectedAt(w: Pick<Wine, "kc" | "home">, loc: Location): number {
  return Math.max(0, (loc === "Home" ? w.home : w.kc) ?? 0);
}

export const isNya = (w: Pick<Wine, "status">) => (w.status ?? "").trim().toUpperCase() === "NYA";

/** Wines you'd expect to find at a location, and wines on order there. */
export function countList(wines: Wine[], loc: Location): { expected: Wine[]; onOrder: Wine[] } {
  const here = wines.filter((w) => w.wineId && expectedAt(w, loc) > 0);
  return { expected: here.filter((w) => !isNya(w)), onOrder: here.filter(isNya) };
}

export interface LocProgress {
  /** Wines expected here (not on order). */
  total: number;
  /** Of those, how many you've checked. */
  checked: number;
  /** Checked wines (including found ones) whose count differs. */
  differences: number;
}

export function progress(st: Stocktake, wines: Wine[], loc: Location): LocProgress {
  const { expected } = countList(wines, loc);
  const checked = expected.filter((w) => st.counts[keyOf(loc, w.wineId!)]).length;
  const byId = new Map(wines.map((w) => [w.wineId, w]));
  const differences = Object.entries(st.counts).filter(([k, e]) => {
    const { loc: l, wineId } = parseKey(k);
    const w = byId.get(wineId);
    return l === loc && e.counted !== e.expected && !(w && isNya(w) && e.counted === 0);
  }).length;
  return { total: expected.length, checked, differences };
}

// ---- Differences ------------------------------------------------------------------

export interface Diff {
  key: string;
  wineId: string;
  loc: Location;
  expected: number;
  counted: number;
  /** counted − expected (never 0). */
  change: number;
  /** Bottles explained by the opposite difference at the other location (a move). */
  moved: number;
  /** What's still unexplained after moves, signed like `change` (may be 0). */
  rest: number;
  /** The other location was counted too (so "moved" isn't offered for the rest). */
  otherCounted: boolean;
}

export interface Arrival {
  key: string;
  wineId: string;
  loc: Location;
  counted: number;
}

/**
 * Counted wines whose numbers differ, with moves between the two locations
 * matched up: 1 missing at K Cellars and 1 extra at Home = 1 bottle moved.
 * Wines on order that you found are "arrivals" (their status gets cleared).
 */
export function differences(st: Stocktake, wines: Wine[]): { diffs: Diff[]; arrivals: Arrival[] } {
  const byId = new Map(wines.map((w) => [w.wineId, w]));
  const diffs: Diff[] = [];
  const arrivals: Arrival[] = [];
  for (const [key, e] of Object.entries(st.counts)) {
    const { loc, wineId } = parseKey(key);
    const w = byId.get(wineId);
    const nya = !!w && isNya(w);
    if (nya && e.counted > 0) arrivals.push({ key, wineId, loc, counted: e.counted });
    // Still on order and not found: nothing to explain.
    if (nya && e.counted === 0) continue;
    const change = e.counted - e.expected;
    if (change === 0) continue;
    const o = st.counts[keyOf(other(loc), wineId)];
    diffs.push({ key, wineId, loc, expected: e.expected, counted: e.counted, change, moved: 0, rest: change, otherCounted: !!o });
  }
  // Match moves: opposite signs at the two locations of the same wine.
  for (const d of diffs) {
    if (d.loc !== "K Cellars") continue;
    const h = diffs.find((x) => x.wineId === d.wineId && x.loc === "Home");
    if (!h || Math.sign(h.change) === Math.sign(d.change)) continue;
    const m = Math.min(Math.abs(d.change), Math.abs(h.change));
    d.moved = h.moved = m;
    d.rest = d.change - Math.sign(d.change) * m;
    h.rest = h.change - Math.sign(h.change) * m;
  }
  return { diffs, arrivals };
}

export const REASONS_FEWER: Reason[] = ["drunk", "sold", "gift", "broken", "moved", "unknown"];
export const REASONS_MORE: Reason[] = ["bought", "moved", "unknown"];

export function reasonLabel(r: Reason, d: Pick<Diff, "loc" | "rest">): string {
  switch (r) {
    case "drunk": return "Drunk";
    case "sold": return "Sold";
    case "gift": return "Gift";
    case "broken": return "Broken";
    case "bought": return "Bought, not keyed in";
    case "unknown": return "Don't know";
    case "moved": return d.rest < 0 ? `Moved to ${other(d.loc)}` : `Moved from ${other(d.loc)}`;
  }
}

/** Reasons that make sense for this difference. */
export function reasonsFor(d: Diff, wine: Pick<Wine, "kc" | "home"> | undefined): Reason[] {
  const base = d.rest < 0 ? REASONS_FEWER : REASONS_MORE;
  return base.filter((r) => {
    if (r !== "moved") return true;
    // If the other location was counted, its own count already says where bottles are.
    if (d.otherCounted) return false;
    // "Moved from Home" needs the bottles to be listed at Home.
    return d.rest < 0 || (!!wine && expectedAt(wine, other(d.loc)) >= d.rest);
  });
}

/** Differences that still need a reason. */
export function missingReasons(st: Stocktake, diffs: Diff[]): Diff[] {
  return diffs.filter((d) => d.rest !== 0 && !st.choices[d.key]?.reason);
}

// ---- Plan -------------------------------------------------------------------------

export interface PlanLog {
  wineId: string;
  loc: Location;
  expected: number | null;
  counted: number | null;
  before: number;
  after: number;
  reason: string;
}

export interface PlanWine {
  wineId: string;
  label: string;
  /** The spreadsheet's counts when the plan was made. */
  before: Partial<Record<Location, number>>;
  /** Counts to write. */
  set: Partial<Record<Location, number>>;
  clearNya: boolean;
  logs: PlanLog[];
  /** Bottles to add to the Opened table. */
  drunk: { loc: Location; n: number }[];
  /** Rows to add to the Sold table. */
  sold: { loc: Location; n: number; price: number | null }[];
  /** New box/rack lists from a box-by-box count (text written as is when the count is unchanged). */
  spotText?: Partial<Record<Location, { text: string; counted: number }>>;
}

export interface Drift {
  wineId: string;
  label: string;
  loc: Location;
  expected: number;
  counted: number;
  now: number;
  /** What will be written: your count, adjusted by what changed since. */
  target: number;
}

export interface Plan {
  /** "YYYY-MM-DD" */
  date: string;
  wines: PlanWine[];
  /** Wines whose spreadsheet count changed between counting and now. */
  drift: Drift[];
}

export function wineLabel(w: Pick<Wine, "producer" | "name" | "vintage"> | undefined, wineId: string): string {
  if (!w) return wineId;
  return [w.producer, shortName(w), w.vintage].filter((x) => x !== null && x !== "").join(" ");
}

export function parsePrice(s: string): number | null {
  const t = s.replace(/[^0-9.]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * The exact changes to make, from the counts and reasons plus the spreadsheet as
 * it is *now* (`fresh`). If a count changed since you counted it (say you opened
 * a bottle through the app afterwards), that change is added on top of your
 * count instead of being overwritten, and listed in `drift`.
 */
export function buildPlan(st: Stocktake, fresh: Wine[], date: string, placements: Record<string, { text: string; counted: number }> = {}): Plan {
  const { diffs, arrivals } = differences(st, fresh);
  const byId = new Map(fresh.map((w) => [w.wineId, w]));
  const plans = new Map<string, PlanWine>();
  const drift: Drift[] = [];
  const planFor = (wineId: string): PlanWine => {
    let p = plans.get(wineId);
    if (!p) {
      p = { wineId, label: wineLabel(byId.get(wineId), wineId), before: {}, set: {}, clearNya: false, logs: [], drunk: [], sold: [] };
      plans.set(wineId, p);
    }
    return p;
  };
  const now = (wineId: string, loc: Location) => {
    const w = byId.get(wineId);
    return w ? expectedAt(w, loc) : 0;
  };
  const reasonParts = new Map<string, string[]>();
  const addReason = (wineId: string, loc: Location, text: string) => {
    const k = keyOf(loc, wineId);
    reasonParts.set(k, [...(reasonParts.get(k) ?? []), text]);
  };
  /** Extra change at a location that wasn't counted (from "moved"). */
  const uncountedDelta = new Map<string, number>();

  for (const d of diffs) {
    if (!byId.has(d.wineId)) continue;
    const p = planFor(d.wineId);
    if (d.moved) addReason(d.wineId, d.loc, `${d.change < 0 ? `Moved to ${other(d.loc)}` : `Moved from ${other(d.loc)}`} (${d.moved})`);
    if (d.rest !== 0) {
      const c = st.choices[d.key];
      const r = c?.reason ?? "unknown";
      const n = Math.abs(d.rest);
      addReason(d.wineId, d.loc, `${reasonLabel(r, d)} (${n})`);
      if (r === "drunk") p.drunk.push({ loc: d.loc, n });
      if (r === "sold") p.sold.push({ loc: d.loc, n, price: parsePrice(c?.price ?? "") });
      if (r === "moved") {
        const ok = keyOf(other(d.loc), d.wineId);
        uncountedDelta.set(ok, (uncountedDelta.get(ok) ?? 0) - d.rest);
        addReason(d.wineId, other(d.loc), `${d.rest < 0 ? `Moved from ${d.loc}` : `Moved to ${d.loc}`} (${n})`);
      }
    }
  }
  for (const a of arrivals) {
    if (!byId.has(a.wineId)) continue;
    planFor(a.wineId).clearNya = true;
    addReason(a.wineId, a.loc, "Arrived");
  }

  for (const p of plans.values()) {
    for (const loc of LOCS) {
      const k = keyOf(loc, p.wineId);
      const e = st.counts[k];
      const parts = reasonParts.get(k);
      if (!parts) continue;
      const before = now(p.wineId, loc);
      let after = before;
      if (e) {
        const target = e.counted + (before - e.expected);
        after = Math.max(0, target);
        if (before !== e.expected) {
          drift.push({ wineId: p.wineId, label: p.label, loc, expected: e.expected, counted: e.counted, now: before, target: after });
        }
      } else {
        after = Math.max(0, before + (uncountedDelta.get(k) ?? 0));
      }
      p.before[loc] = before;
      if (after !== before) p.set[loc] = after;
      p.logs.push({ wineId: p.wineId, loc, expected: e ? e.expected : null, counted: e ? e.counted : null, before, after, reason: parts.join(", ") });
    }
  }
  // Box lists from a box-by-box count: for changed wines, and for any wine whose boxes changed.
  for (const [k, pl] of Object.entries(placements)) {
    const { loc, wineId } = parseKey(k);
    const w = byId.get(wineId);
    if (!w) continue;
    const now = loc === "Home" ? w.homeSpots : w.kcSpots;
    const nowText = formatSpots(parseSpots(now, expectedAt(w, loc)).spots, expectedAt(w, loc));
    if (!plans.has(wineId) && nowText === pl.text) continue;
    const p = planFor(wineId);
    p.spotText = { ...(p.spotText ?? {}), [loc]: pl };
  }
  return { date, wines: [...plans.values()].sort((a, b) => a.label.localeCompare(b.label)), drift };
}

export interface PlanTotals {
  wines: number;
  /** Wines whose box/rack list changes. */
  placed: number;
  added: number;
  removed: number;
  drunk: number;
  sold: number;
  arrived: number;
}

export function planTotals(p: Plan): PlanTotals {
  let added = 0, removed = 0, drunk = 0, sold = 0, arrived = 0, placed = 0;
  for (const w of p.wines) {
    for (const loc of LOCS) {
      const d = (w.set[loc] ?? w.before[loc] ?? 0) - (w.before[loc] ?? 0);
      if (d > 0) added += d;
      else removed -= d;
    }
    drunk += w.drunk.reduce((s, x) => s + x.n, 0);
    sold += w.sold.reduce((s, x) => s + x.n, 0);
    if (w.clearNya) arrived++;
    // Only wines whose box list is the sole change (count changes are listed already).
    if (w.spotText && !w.logs.length) placed++;
  }
  return { wines: p.wines.filter((w) => w.logs.length || w.clearNya).length, placed, added, removed, drunk, sold, arrived };
}
