// Pure helpers for tasting notes (type-only imports, unit-testable without a browser).

// ---- Appearance ----------------------------------------------------------------

export const COLOUR_INTENSITIES = ["Pale", "Medium", "Deep"];

const DEFAULT_HUES: Record<string, string[]> = {
  White: ["Lemon", "Gold", "Amber"],
  Sparkling: ["Lemon", "Gold", "Pink", "Salmon"],
  Rose: ["Pink", "Salmon", "Orange"],
  Orange: ["Gold", "Amber", "Orange"],
  Red: ["Purple", "Ruby", "Garnet", "Tawny"],
  Sweet: ["Lemon", "Gold", "Amber"],
  Fortified: ["Ruby", "Tawny", "Amber", "Brown"],
};
const ALL_HUES = ["Lemon", "Gold", "Amber", "Pink", "Salmon", "Orange", "Purple", "Ruby", "Garnet", "Tawny", "Brown"];

/** "Medium Ruby" -> { intensity: "Medium", hue: "Ruby" }. */
export function splitColour(c: string | null | undefined): { intensity: string; hue: string } {
  const s = (c ?? "").trim();
  if (!s) return { intensity: "", hue: "" };
  const [first, ...rest] = s.split(/\s+/);
  const match = COLOUR_INTENSITIES.find((i) => i.toLowerCase() === first.toLowerCase());
  return match ? { intensity: match, hue: rest.join(" ") } : { intensity: "", hue: s };
}

export function joinColour(intensity: string, hue: string): string {
  return [intensity, hue].filter(Boolean).join(" ");
}

/** Standard hues for the type, plus any others you've used for that type before (most used first). */
export function huesFor(type: string | null, history: { type: string | null; colour: string | null }[]): string[] {
  const base = DEFAULT_HUES[type ?? ""] ?? ALL_HUES;
  const counts = new Map<string, number>();
  for (const h of history) {
    if (h.type !== type) continue;
    const hue = splitColour(h.colour).hue;
    if (hue) counts.set(hue, (counts.get(hue) ?? 0) + 1);
  }
  const extra = [...counts.entries()]
    .filter(([hue, n]) => n >= 3 && !base.some((b) => b.toLowerCase() === hue.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .map(([hue]) => hue);
  return [...base, ...extra];
}

/** Types where tannin isn't assessed; saved as "-" when left blank. */
export const NO_TANNIN_TYPES = ["White", "Sparkling", "Sweet"];
export const showsTannin = (type: string | null) => !NO_TANNIN_TYPES.includes(type ?? "");

// ---- Descriptor vocabulary -------------------------------------------------------

export function splitTerms(s: string | null | undefined): string[] {
  return (s ?? "")
    .split(/[,;\n]/)
    .map((t) => t.trim().replace(/\.$/, ""))
    .filter((t) => t.length > 0 && t.length <= 40);
}

export interface VocabEntry {
  label: string;
  count: number;
  byType: Record<string, number>;
}
export type Vocab = Map<string, VocabEntry>;

/** Every descriptor you've used in Nose/Taste, with how often (overall and per type). */
export function buildVocab(
  notes: { type: string | null; nose: string | null; taste: string | null }[],
  field: "aroma" | "tanninNature" = "aroma",
  tanninNotes: { type: string | null; tanninNature: string | null }[] = [],
): Vocab {
  const vocab: Vocab = new Map();
  const add = (term: string, type: string | null) => {
    const key = term.toLowerCase();
    let e = vocab.get(key);
    if (!e) vocab.set(key, (e = { label: key, count: 0, byType: {} }));
    e.count++;
    if (type) e.byType[type] = (e.byType[type] ?? 0) + 1;
  };
  if (field === "aroma") {
    for (const n of notes) {
      const terms = new Set([...splitTerms(n.nose), ...splitTerms(n.taste)].map((t) => t.toLowerCase()));
      terms.forEach((t) => add(t, n.type));
    }
  } else {
    for (const n of tanninNotes) splitTerms(n.tanninNature).forEach((t) => add(t, n.type));
  }
  return vocab;
}

/**
 * Suggestions: with no query, the most-used terms for this type; with a query,
 * terms starting with it first, then terms containing it.
 */
export function suggest(vocab: Vocab, type: string | null, query: string, exclude: string[], limit = 12): string[] {
  const q = query.trim().toLowerCase();
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  const score = (e: VocabEntry) => (type ? (e.byType[type] ?? 0) * 3 : 0) + e.count;
  return [...vocab.values()]
    .filter((e) => !skip.has(e.label) && (!q || e.label.includes(q)))
    .sort((a, b) => {
      if (q) {
        const pa = a.label.startsWith(q) ? 0 : 1;
        const pb = b.label.startsWith(q) ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      return score(b) - score(a) || a.label.localeCompare(b.label);
    })
    .slice(0, limit)
    .map((e) => e.label);
}

// ---- Conclusion ------------------------------------------------------------------

export const QUALITIES = ["Poor", "Acceptable", "Good", "Very good", "Outstanding"];
export const AGEING = ["Suitable for ageing", "Not suitable for ageing"];

export function composeNote(quality: string, ageing: string, free: string): string {
  const head = [quality, ageing].filter(Boolean).join(". ");
  const tail = free.trim();
  if (!head) return tail;
  return tail ? `${head}. ${tail}` : head;
}

/** Splits "Outstanding. Suitable for aging. 2018 base" back into its parts. */
export function parseNote(note: string | null | undefined): { quality: string; ageing: string; free: string } {
  const s = (note ?? "").trim();
  // The quality word must be followed by "." or end the note ("Goodness me" is not "Good").
  const m = /^(poor|acceptable|good|very good|outstanding|outstandng)(?:\.|$)\s*(?:((?:not )?suitable for age?ing)(?:\.|$))?\s*(.*)$/is.exec(s);
  if (!m) return { quality: "", ageing: "", free: s };
  const q = m[1].toLowerCase() === "outstandng" ? "outstanding" : m[1].toLowerCase();
  const quality = QUALITIES.find((x) => x.toLowerCase() === q) ?? "";
  const ageing = m[2] ? (m[2].toLowerCase().startsWith("not") ? AGEING[1] : AGEING[0]) : "";
  return { quality, ageing, free: m[3].trim() };
}

// ---- Dates -------------------------------------------------------------------------

/** "2026-11-16" -> Excel date serial (days since 1899-12-30). */
export function excelSerial(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const AGE_FORMULA = '=IFERROR([@[Year Tasted]]-[@Vintage],"")';
