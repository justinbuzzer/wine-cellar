// Duplicate check: the same producer, wine name AND vintage. Different vintages of
// the same wine are separate rows on purpose and never count as duplicates.
// Matching ignores capitals, accents, punctuation and a producer name repeated at
// the start of the wine name ("Torbreck RunRig" = "RunRig" by Torbreck).

import { norm, shortName, type Wine } from "./data";

interface WineIdentity {
  producer: string | null;
  name: string | null;
  vintage: string | number | null;
}

/** "2019", "nv", or "" when there's no vintage. */
export function vintageKey(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v).trim().toLowerCase();
  if (s === "nv") return "nv";
  const n = Number(s);
  return Number.isFinite(n) && s !== "" ? String(Math.round(n)) : s;
}

/** Key for "same wine, same vintage", or null if producer or name is missing. */
export function sameWineKey(w: WineIdentity): string | null {
  const producer = norm(w.producer);
  const name = norm(shortName({ producer: w.producer, name: w.name }));
  if (!producer || !name) return null;
  return `${producer}|${name}|${vintageKey(w.vintage)}`;
}

/** Wines already in the cellar with the same producer, name and vintage. */
export function findSameWine(wines: Wine[], candidate: WineIdentity, excludeId?: string | null): Wine[] {
  const key = sameWineKey(candidate);
  if (!key) return [];
  return wines.filter((w) => w.wineId !== excludeId && sameWineKey(w) === key);
}

/** Groups of two or more rows that are the same wine and vintage. */
export function duplicateGroups(wines: Wine[]): Wine[][] {
  const groups = new Map<string, Wine[]>();
  for (const w of wines) {
    const key = sameWineKey(w);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => (a[0].producer ?? "").localeCompare(b[0].producer ?? "") || (a[0].name ?? "").localeCompare(b[0].name ?? ""));
}
