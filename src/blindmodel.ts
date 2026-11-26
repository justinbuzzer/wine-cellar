// Blind tasting guesses: what you guessed for a wine tasted blind (grape, country,
// region, vintage), marked against the wine once it's revealed.
// Pure (type-only imports apart from the appellation key), so it can be unit-tested.

import { appellationKey } from "./appellations";

/** The workbook columns for blind tastings, added to Tasted and Drafts the first time they're needed. */
export const BLIND_COLUMNS = ["Blind", "Guess Grape", "Guess Country", "Guess Region", "Guess Vintage"] as const;

export interface BlindGuess {
  grape: string | null;
  country: string | null;
  region: string | null;
  vintage: string | null;
}

export type Mark = "right" | "close" | "wrong" | "none";

export interface GuessRow {
  label: "Grape" | "Country" | "Region" | "Vintage";
  said: string;
  was: string;
  mark: Mark;
}

const n = (s: string | null | undefined) => appellationKey(s ?? "");
const grapesOf = (s: string | null | undefined) =>
  (s ?? "")
    .split(/[,;/&+]|\band\b/i)
    .map((g) => n(g))
    .filter(Boolean);

/** A guessed grape matches if it's one of the wine's (or a fuller name of it, e.g. "Pinot Noir" for "Pinot"). */
function grapeMark(said: string, was: string): Mark {
  const guess = grapesOf(said);
  const actual = grapesOf(was);
  if (!guess.length || !actual.length) return "none";
  return guess.some((g) => actual.some((a) => a === g || (g.length >= 4 && (a.startsWith(`${g} `) || a.endsWith(` ${g}`))))) ? "right" : "wrong";
}

function vintageMark(said: string, was: string): Mark {
  const g = said.trim();
  const a = was.trim();
  if (!g || !a) return "none";
  if (/^nv$/i.test(g) || /^nv$/i.test(a)) return /^nv$/i.test(g) && /^nv$/i.test(a) ? "right" : "wrong";
  const d = Math.abs(Number(g) - Number(a));
  if (!Number.isFinite(d)) return "none";
  return d === 0 ? "right" : d === 1 ? "close" : "wrong";
}

/** Each guess against the wine: right, close (vintage one year off), wrong, or none (no guess, or not known). */
export function scoreGuess(
  guess: BlindGuess,
  wine: { varietal: string | null; country: string | null; region: string | null; location: string | null; vintage: string | number | null },
): GuessRow[] {
  const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v).trim());
  const place = [s(wine.location), s(wine.region)].filter(Boolean);
  const regionSaid = s(guess.region);
  return [
    { label: "Grape", said: s(guess.grape), was: s(wine.varietal), mark: grapeMark(s(guess.grape), s(wine.varietal)) },
    {
      label: "Country",
      said: s(guess.country),
      was: s(wine.country),
      mark: !s(guess.country) || !s(wine.country) ? "none" : n(guess.country) === n(wine.country) ? "right" : "wrong",
    },
    {
      label: "Region",
      said: regionSaid,
      was: [...new Set(place)].join(", "),
      // Right if it's the region (Burgundy) or the appellation (Gevrey-Chambertin).
      mark: !regionSaid || !place.length ? "none" : place.some((p) => n(p) === n(regionSaid)) ? "right" : "wrong",
    },
    { label: "Vintage", said: s(guess.vintage), was: s(wine.vintage), mark: vintageMark(s(guess.vintage), s(wine.vintage)) },
  ];
}

export const hasGuess = (g: BlindGuess | null | undefined): boolean => !!g && Object.values(g).some((v) => !!v && String(v).trim());
