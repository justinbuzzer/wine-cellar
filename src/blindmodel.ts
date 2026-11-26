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

// ---- Performance across blind tastings ---------------------------------------------

export interface FieldStat {
  /** Right (vintage: also one year off). */
  hits: number;
  /** Vintage only: exactly right. */
  exact: number;
  marked: number;
}

export interface BlindStats {
  wines: number;
  dinners: number;
  fields: Record<GuessRow["label"], FieldStat>;
  byDinner: { date: string | null; wines: number; hits: number; marked: number }[];
  grapes: { grape: string; tasted: number; right: number }[];
  mixups: { was: string; said: string; times: number }[];
  /** Vintage: average years off, and on average how much later (positive: you guess younger) than the real one. */
  vintage: { pairs: number; averageOff: number; lean: number } | null;
  past: { tastingId: string | null; title: string; date: string | null; hits: number; marked: number }[];
}

type BlindNote = {
  tastingId: string | null;
  producer: string | null;
  name: string | null;
  wineId: string | null;
  varietal: string | null;
  country: string | null;
  region: string | null;
  location: string | null;
  vintage: string | number | null;
  dateTasted: string | null;
  blind: boolean;
  guess: BlindGuess | null;
};

/** Finished notes tasted blind, with guesses, whose wine is known. */
export function blindStats(notes: BlindNote[]): BlindStats {
  const done = notes.filter((t) => t.blind && hasGuess(t.guess) && (t.producer || t.wineId));
  const fields = Object.fromEntries((["Grape", "Country", "Region", "Vintage"] as const).map((k) => [k, { hits: 0, exact: 0, marked: 0 }])) as BlindStats["fields"];
  const dinners = new Map<string, { date: string | null; wines: number; hits: number; marked: number }>();
  const grapes = new Map<string, { grape: string; tasted: number; right: number }>();
  const mixups = new Map<string, { was: string; said: string; times: number }>();
  const offs: number[] = [];
  const past: BlindStats["past"] = [];
  for (const t of done) {
    const rows = scoreGuess(t.guess!, t);
    let hits = 0;
    let marked = 0;
    for (const r of rows) {
      if (r.mark === "none") continue;
      const f = fields[r.label];
      f.marked++;
      marked++;
      if (r.mark === "right" || r.mark === "close") {
        f.hits++;
        hits++;
      }
      if (r.mark === "right") f.exact++;
    }
    const d = dinners.get(t.dateTasted ?? "") ?? { date: t.dateTasted, wines: 0, hits: 0, marked: 0 };
    d.wines++;
    d.hits += hits;
    d.marked += marked;
    dinners.set(t.dateTasted ?? "", d);

    const grapeRow = rows[0];
    if (grapeRow.mark !== "none") {
      const key = appellationKey(grapeRow.was);
      const g = grapes.get(key) ?? { grape: grapeRow.was, tasted: 0, right: 0 };
      g.tasted++;
      if (grapeRow.mark === "right") g.right++;
      grapes.set(key, g);
      if (grapeRow.mark === "wrong") {
        const mk = `${key}|${appellationKey(grapeRow.said)}`;
        const m = mixups.get(mk) ?? { was: grapeRow.was, said: grapeRow.said, times: 0 };
        m.times++;
        mixups.set(mk, m);
      }
    }
    const said = Number(t.guess!.vintage);
    const was = Number(t.vintage);
    if (Number.isFinite(said) && Number.isFinite(was) && said > 1900 && was > 1900) offs.push(said - was);
    past.push({ tastingId: t.tastingId, title: [t.producer, t.name, t.vintage].filter(Boolean).join(" "), date: t.dateTasted, hits, marked });
  }
  const byDate = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");
  return {
    wines: done.length,
    dinners: dinners.size,
    fields,
    byDinner: [...dinners.values()].sort((a, b) => byDate(a.date, b.date)),
    grapes: [...grapes.values()].sort((a, b) => b.tasted - a.tasted || a.grape.localeCompare(b.grape)),
    mixups: [...mixups.values()].sort((a, b) => b.times - a.times || a.was.localeCompare(b.was)),
    vintage: offs.length
      ? { pairs: offs.length, averageOff: offs.reduce((s, x) => s + Math.abs(x), 0) / offs.length, lean: offs.reduce((s, x) => s + x, 0) / offs.length }
      : null,
    past: past.sort((a, b) => byDate(a.date, b.date)),
  };
}
