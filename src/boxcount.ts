// Box-by-box stocktake: the rules. Pure (no browser APIs), so it can be unit-tested.
//
// Where a location has boxes or racks (Settings), you count it one box at a time.
// Each checked box records what's in it. A wine's total at the location is only
// worked out once nothing about it is unknown:
//   - every box it was listed in has been checked, and either none of its bottles
//     were "not placed" (those could be in any box) or all of them have turned up, or
//   - every box at the location has been checked.
// Until then it's "waiting for other boxes". Once final, its total becomes an
// ordinary count (expected vs counted) for the normal review, and the boxes it
// was found in become its new box list.

import type { Wine } from "./data";
import type { Location } from "./locations";
import { countAt, formatSpots, parseSpots, placementOf, spotsFor, strays, type Layout, type SpotCount } from "./spots";
import { keyOf, type CountEntry, type Stocktake } from "./stocktakemodel";

export interface BoxCheck {
  /** When it was last changed (ms). */
  at: number;
  /** Ticked as checked ("Box checked" / "Still sealed" / empty). */
  done: boolean;
  sealed: boolean;
  /** Bottles of each wine found in the box (wineId → count). */
  items: Record<string, number>;
}

/** A wine's bottles at a location when the stocktake first looked at it. */
export interface BaseEntry {
  total: number;
  unplaced: number;
  spots: Record<string, number>;
}

export const boxKey = (loc: Location, spot: string) => `${loc}|${spot}`;

export function baseOf(w: Wine, loc: Location): BaseEntry {
  const p = placementOf(w, loc);
  return { total: p.spots.reduce((s, x) => s + x.n, 0) + p.unplaced, unplaced: p.unplaced, spots: Object.fromEntries(p.spots.map((s) => [s.spot, s.n])) };
}

/** Every spot to check at a location: the layout plus any spot outside it that holds bottles. */
export function allSpots(layout: Layout, wines: Wine[], loc: Location): string[] {
  return [...spotsFor(layout, loc), ...strays(wines, layout, loc).map(([s]) => s)];
}

/** Whether this location is being counted box by box in this stocktake. */
export const inBoxMode = (st: Stocktake, loc: Location) => Object.keys(st.boxes ?? {}).some((k) => k.startsWith(`${loc}|`));

export function doneSpots(st: Stocktake, loc: Location): Set<string> {
  const out = new Set<string>();
  for (const [k, b] of Object.entries(st.boxes ?? {})) if (b.done && k.startsWith(`${loc}|`)) out.add(k.slice(loc.length + 1));
  return out;
}

export function isComplete(st: Stocktake, layout: Layout, wines: Wine[], loc: Location): boolean {
  const done = doneSpots(st, loc);
  const spots = allSpots(layout, wines, loc);
  return spots.length > 0 && spots.every((s) => done.has(s));
}

/**
 * Records a box (draft or done) and remembers how the wines involved stood
 * before, the first time each is seen. When this completes the location, every
 * remaining wine there is remembered too (bottles not found anywhere are gone).
 */
export function recordBox(st: Stocktake, wines: Wine[], layout: Layout, loc: Location, spot: string, check: BoxCheck): Stocktake {
  const byId = new Map(wines.map((w) => [w.wineId, w]));
  const base = { ...(st.base ?? {}) };
  const remember = (w: Wine | undefined) => {
    if (w?.wineId && !base[keyOf(loc, w.wineId)]) base[keyOf(loc, w.wineId)] = baseOf(w, loc);
  };
  for (const id of Object.keys(check.items)) remember(byId.get(id));
  for (const w of wines) if (placementOf(w, loc).spots.some((s) => s.spot === spot)) remember(w);
  const next: Stocktake = { ...st, boxes: { ...(st.boxes ?? {}), [boxKey(loc, spot)]: check }, base };
  if (check.done && isComplete(next, layout, wines, loc)) {
    for (const w of wines) if ((loc === "Home" ? w.home : w.kc) ?? 0) remember(w);
  }
  return next;
}

/** Removes a box's check (to recount it). */
export function clearBox(st: Stocktake, loc: Location, spot: string): Stocktake {
  const boxes = { ...(st.boxes ?? {}) };
  delete boxes[boxKey(loc, spot)];
  return { ...st, boxes };
}

export interface BoxResult {
  /** Final wines: an ordinary count entry each (expected vs counted). */
  counts: Record<string, CountEntry>;
  /** Their new box lists, text as stored (e.g. "A2 (2), B3"). */
  placements: Record<string, { text: string; counted: number }>;
  /** Wines seen but waiting for other boxes, per location. */
  waiting: Record<string, number>;
}

export function boxResults(st: Stocktake, wines: Wine[], layout: Layout): BoxResult {
  const counts: Record<string, CountEntry> = {};
  const placements: Record<string, { text: string; counted: number }> = {};
  const waiting: Record<string, number> = {};
  for (const loc of ["K Cellars", "Home"] as Location[]) {
    if (!inBoxMode(st, loc)) continue;
    const done = doneSpots(st, loc);
    const complete = isComplete(st, layout, wines, loc);
    let wait = 0;
    for (const [k, b] of Object.entries(st.base ?? {})) {
      if (!k.startsWith(`${loc}|`)) continue;
      const wineId = k.slice(loc.length + 1);
      const found: SpotCount[] = [];
      let at = 0;
      for (const s of done) {
        const box = st.boxes![boxKey(loc, s)];
        const n = box.items[wineId] ?? 0;
        if (n > 0) found.push({ spot: s, n });
        if (n > 0 || b.spots[s]) at = Math.max(at, box.at);
      }
      const counted = found.reduce((s, x) => s + x.n, 0);
      // Settled once its listed boxes are checked and no bottle of it is unaccounted for.
      const final = complete || (Object.keys(b.spots).every((s) => done.has(s)) && (b.unplaced === 0 || counted >= b.total));
      if (!final) {
        wait++;
        continue;
      }
      counts[k] = { expected: b.total, counted, at: at || Date.now() };
      placements[k] = { text: formatSpots(found, counted), counted };
    }
    waiting[loc] = wait;
  }
  return { counts, placements, waiting };
}

/** The stocktake as the review sees it: box-counted locations replaced by their final totals. */
export function effective(st: Stocktake, wines: Wine[], layout: Layout): { st: Stocktake; boxes: BoxResult } {
  const boxes = boxResults(st, wines, layout);
  const counts: Record<string, CountEntry> = {};
  for (const [k, e] of Object.entries(st.counts)) {
    const loc = k.slice(0, k.indexOf("|")) as Location;
    if (!inBoxMode(st, loc)) counts[k] = e;
  }
  return { st: { ...st, counts: { ...counts, ...boxes.counts } }, boxes };
}

/** Final wines whose box list actually changes. */
export function changedPlacements(placements: BoxResult["placements"], wines: Wine[]): string[] {
  const byId = new Map(wines.map((w) => [w.wineId, w]));
  return Object.entries(placements)
    .filter(([k, pl]) => {
      const loc = k.slice(0, k.indexOf("|")) as Location;
      const w = byId.get(k.slice(loc.length + 1));
      if (!w) return false;
      const total = countAt(w, loc);
      return formatSpots(parseSpots(loc === "Home" ? w.homeSpots : w.kcSpots, total).spots, total) !== pl.text;
    })
    .map(([k]) => k);
}

export interface BoxProgress {
  spots: number;
  done: number;
  /** Boxes started but not ticked as checked. */
  started: number;
}

export function boxProgress(st: Stocktake, layout: Layout, wines: Wine[], loc: Location): BoxProgress {
  const spots = allSpots(layout, wines, loc);
  const done = doneSpots(st, loc);
  const started = spots.filter((s) => !done.has(s) && st.boxes?.[boxKey(loc, s)]).length;
  return { spots: spots.length, done: spots.filter((s) => done.has(s)).length, started };
}
