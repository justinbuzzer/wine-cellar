// Tasting notes for a wine: this exact wine, and other vintages of it. Pure, for unit testing.

import { norm, type Tasting, type Wine } from "./data";
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
