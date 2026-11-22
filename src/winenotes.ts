// Tasting notes for a wine: this exact wine, and other vintages of it. Pure, for unit testing.

import { norm, shortName, type Tasting, type Wine } from "./data";
import { newestFirst } from "./notesearch";

export interface WineNotes {
  /** Notes on this wine and vintage, newest first. */
  these: Tasting[];
  /** Notes on other vintages of the same producer + name, newest vintage first. */
  otherVintages: Tasting[];
  /** Average score of `these`, to one decimal, or null when none are scored. */
  average: number | null;
}

export function notesForWine(wine: Wine, tastings: Tasting[]): WineNotes {
  const sameName = (t: Tasting) =>
    norm(t.name) === norm(wine.name) && (!t.producer || !wine.producer || norm(t.producer) === norm(wine.producer));
  const sameVintage = (t: Tasting) => String(t.vintage ?? "") === String(wine.vintage ?? "");
  // Linked by WineID, or (for notes without one) the same wine and vintage by name.
  const isThis = (t: Tasting) => (t.wineId ? t.wineId === wine.wineId : sameName(t) && sameVintage(t));

  const these = tastings.filter(isThis).sort(newestFirst);
  const otherVintages = tastings
    .filter((t) => !isThis(t) && sameName(t) && !sameVintage(t))
    .sort((a, b) => vintageNum(b) - vintageNum(a) || newestFirst(a, b));
  const scored = these.filter((t) => t.score !== null);
  const average = scored.length
    ? Math.round((scored.reduce((s, t) => s + (t.score ?? 0), 0) / scored.length) * 10) / 10
    : null;
  return { these, otherVintages, average };
}

const vintageNum = (t: Tasting) => (typeof t.vintage === "number" ? t.vintage : -1);

/** Same producer (or one of them blank) and the same wine name, whatever the vintage. */
export function sameWineAnyVintage(a: Pick<Tasting, "producer" | "name">, b: Pick<Tasting, "producer" | "name">): boolean {
  if (a.producer && b.producer && norm(a.producer) !== norm(b.producer)) return false;
  const na = norm(a.name);
  const nb = norm(b.name);
  if (na && na === nb) return true;
  const sa = norm(shortName(a));
  return !!sa && sa === norm(shortName(b));
}

export interface NoteFamily {
  /** Other notes on this vintage, newest first. */
  thisVintage: Tasting[];
  /** Notes on other vintages, newest vintage first (then newest note). */
  otherVintages: Tasting[];
  /** All notes on the wine, this one included. */
  all: Tasting[];
  vintages: number;
  /** Average score of all notes on the wine, to one decimal. */
  average: number | null;
}

/** Every note you've written on the same wine as `t`, across vintages. */
export function notesLikeNote(t: Tasting, tastings: Tasting[]): NoteFamily {
  const sameVintage = (x: Tasting) => String(x.vintage ?? "") === String(t.vintage ?? "");
  const family = tastings.filter((x) => (t.wineId && x.wineId === t.wineId) || sameWineAnyVintage(t, x));
  const others = family.filter((x) => x.tastingId !== t.tastingId);
  const thisVintage = others.filter(sameVintage).sort(newestFirst);
  const otherVintages = others.filter((x) => !sameVintage(x)).sort((a, b) => vintageNum(b) - vintageNum(a) || newestFirst(a, b));
  const all = family.some((x) => x.tastingId === t.tastingId) ? family : [t, ...family];
  const scored = all.filter((x) => x.score !== null);
  return {
    thisVintage,
    otherVintages,
    all,
    vintages: new Set(all.map((x) => String(x.vintage ?? ""))).size,
    average: scored.length ? Math.round((scored.reduce((s, x) => s + (x.score ?? 0), 0) / scored.length) * 10) / 10 : null,
  };
}
