// Search, filter and sort tasting notes. Pure (type-only imports) for unit testing.

import type { Tasting } from "./data";

export type NoteSort = "newest" | "score" | "name";
export type GrapeKind = "" | "single" | "blend";

export interface NoteQuery {
  q: string;
  type: string;
  country: string;
  region: string;
  varietal: string;
  /** Single varietals only, blends only, or either. */
  kind: GrapeKind;
  minScore: number;
  year: string;
  source: string;
  sort: NoteSort;
}

export const EMPTY_QUERY: NoteQuery = {
  q: "", type: "", country: "", region: "", varietal: "", kind: "", minScore: 0, year: "", source: "", sort: "newest",
};

/**
 * Whether a note is for a blend. The Blend column decides when it says so
 * ("Blend" vs "Single…"/"Mono…"); otherwise a varietal naming several grapes
 * ("Cabernet Sauvignon, Merlot", "Grenache/Syrah", "GSM", "Red blend") counts.
 */
export function isBlend(t: Pick<Tasting, "blend" | "varietal">): boolean {
  const b = (t.blend ?? "").trim();
  if (/single|mono|varietal/i.test(b)) return false;
  if (/blend|cuv[eé]e|assemblage/i.test(b)) return true;
  const v = (t.varietal ?? "").trim();
  return /[,/&+]|\band\b|\bblend\b|^gsm$|meritage/i.test(v);
}

/** Lower-case, accent-free text so "cote" finds "Côte". */
export function fold(s: string | number | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
}

export function tokens(q: string): string[] {
  return fold(q).split(/\s+/).filter(Boolean);
}

function haystack(t: Tasting): string {
  return fold(
    [t.producer, t.name, t.vintage, t.type, t.country, t.region, t.location, t.varietal, t.nose, t.taste,
      t.note, t.source, t.tanninNature, t.colour, t.vessel, t.viticulture, t.tastingId].join(" | "),
  );
}

const cache = new WeakMap<Tasting, string>();
function hay(t: Tasting): string {
  let h = cache.get(t);
  if (h === undefined) cache.set(t, (h = haystack(t)));
  return h;
}

const contains = (value: string | null, wanted: string) => !wanted || fold(value).includes(fold(wanted));

/** Newest first: by date tasted, then year tasted, then TastingID. */
export function newestFirst(a: Tasting, b: Tasting): number {
  const da = a.dateTasted ?? `${a.yearTasted ?? 0}-00-00`;
  const db = b.dateTasted ?? `${b.yearTasted ?? 0}-00-00`;
  return db.localeCompare(da) || (b.tastingId ?? "").localeCompare(a.tastingId ?? "");
}

const SORTS: Record<NoteSort, (a: Tasting, b: Tasting) => number> = {
  newest: newestFirst,
  score: (a, b) => (b.score ?? 0) - (a.score ?? 0) || newestFirst(a, b),
  name: (a, b) =>
    fold(a.producer).localeCompare(fold(b.producer)) ||
    fold(a.name).localeCompare(fold(b.name)) ||
    String(a.vintage ?? "").localeCompare(String(b.vintage ?? "")) ||
    newestFirst(a, b),
};

export function searchNotes(all: Tasting[], query: NoteQuery): Tasting[] {
  const words = tokens(query.q);
  return all
    .filter((t) => {
      if (query.type && t.type !== query.type) return false;
      if (query.country && t.country !== query.country) return false;
      if (query.region && t.region !== query.region) return false;
      if (query.year && String(t.yearTasted ?? "") !== query.year) return false;
      if (query.minScore && (t.score ?? 0) < query.minScore) return false;
      if (!contains(t.varietal, query.varietal)) return false;
      if (query.kind && isBlend(t) !== (query.kind === "blend")) return false;
      if (!contains(t.source, query.source)) return false;
      if (words.length) {
        const h = hay(t);
        if (!words.every((w) => h.includes(w))) return false;
      }
      return true;
    })
    .sort(SORTS[query.sort]);
}

/**
 * Splits text into plain and matched parts for highlighting, matching
 * accent-insensitively ("cote" highlights "Côte").
 */
export function highlightParts(text: string, words: string[]): { text: string; hit: boolean }[] {
  if (!text || !words.length) return [{ text, hit: false }];
  // Map folded positions back to the original string, character by character.
  const folded: string[] = [];
  const origIndex: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    for (const ch of f) {
      folded.push(ch);
      origIndex.push(i);
    }
  }
  const flat = folded.join("");
  const marks = new Array(text.length).fill(false);
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = flat.indexOf(w, from);
      if (at < 0) break;
      for (let k = at; k < at + w.length; k++) marks[origIndex[k]] = true;
      from = at + w.length;
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}
