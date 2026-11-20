// Builds the restaurant-style wine list structure. Pure (type-only imports),
// so it can be unit-tested without a browser.

import type { Wine } from "./data";
import type { Location } from "./locations";

export const TYPE_ORDER = ["Sparkling", "White", "Rose", "Orange", "Red", "Sweet", "Fortified"];
const TYPE_LABEL: Record<string, string> = { Rose: "Rosé" };

export function typeLabel(t: string | null): string {
  if (!t) return "Other";
  return TYPE_LABEL[t] ?? t;
}

export type GroupBy = "type" | "region";
export type ListLocation = "all" | Location;

export interface ListEntry {
  wine: Wine;
  /** Bottles at the chosen location. */
  bottles: number;
}

export interface ListGroup {
  country: string;
  region: string;
  entries: ListEntry[];
}

export interface ListSection {
  id: string;
  title: string;
  groups: ListGroup[];
  wines: number;
  bottles: number;
}

export function bottlesAt(w: Wine, loc: ListLocation): number {
  if (loc === "all" || w.kc === null || w.home === null) return w.qty;
  return loc === "Home" ? w.home : w.kc;
}

/** Wines in stock at the location; not-yet-arrived wines are left out. */
export function selectEntries(wines: Wine[], loc: ListLocation): ListEntry[] {
  return wines
    .filter((w) => w.status !== "NYA")
    .map((wine) => ({ wine, bottles: bottlesAt(wine, loc) }))
    .filter((e) => e.bottles > 0);
}

const cmp = (a: string | null, b: string | null) =>
  (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });

function typeRank(t: string | null): number {
  const i = TYPE_ORDER.indexOf(t ?? "");
  return i < 0 ? TYPE_ORDER.length : i;
}

/** NV before dated vintages; older vintages first. */
function vintageRank(v: Wine["vintage"]): number {
  if (v === "NV") return -1;
  return v ?? 99999;
}

/** Within a region: by appellation (the Location column), then producer, then vintage. */
const byWine = (a: ListEntry, b: ListEntry) =>
  cmp(a.wine.location, b.wine.location) ||
  cmp(a.wine.producer, b.wine.producer) ||
  vintageRank(a.wine.vintage) - vintageRank(b.wine.vintage) ||
  cmp(a.wine.name, b.wine.name);

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function groupByPlace(entries: ListEntry[], within: (a: ListEntry, b: ListEntry) => number): ListGroup[] {
  const map = new Map<string, ListGroup>();
  for (const e of entries) {
    const country = e.wine.country ?? "Other";
    const region = e.wine.region ?? "";
    const key = `${country}\u0000${region}`;
    let g = map.get(key);
    if (!g) map.set(key, (g = { country, region, entries: [] }));
    g.entries.push(e);
  }
  const groups = [...map.values()].sort((a, b) => cmp(a.country, b.country) || cmp(a.region, b.region));
  groups.forEach((g) => g.entries.sort(within));
  return groups;
}

function section(id: string, title: string, entries: ListEntry[], within: (a: ListEntry, b: ListEntry) => number): ListSection {
  return {
    id: slug(id) || "other",
    title,
    groups: groupByPlace(entries, within),
    wines: entries.length,
    bottles: entries.reduce((s, e) => s + e.bottles, 0),
  };
}

export function buildList(entries: ListEntry[], groupBy: GroupBy): ListSection[] {
  if (groupBy === "type") {
    const types = [...new Set(entries.map((e) => e.wine.type))].sort(
      (a, b) => typeRank(a) - typeRank(b) || cmp(a, b),
    );
    return types.map((t) =>
      section(t ?? "other", typeLabel(t), entries.filter((e) => e.wine.type === t), byWine),
    );
  }
  // Region first: one section per country, regions inside, wines by appellation.
  const countries = [...new Set(entries.map((e) => e.wine.country ?? "Other"))].sort(cmp);
  return countries.map((c) =>
    section(c, c, entries.filter((e) => (e.wine.country ?? "Other") === c), byWine),
  );
}
