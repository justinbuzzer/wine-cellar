// Pure helpers for tasting notes (type-only imports, unit-testable without a browser).

// ---- Appearance ----------------------------------------------------------------

export const COLOUR_INTENSITIES = ["Pale", "Medium", "Deep"];

/** A wine type compared loosely: "Rosé", "rose " and "Rose" are the same. */
export const typeKey = (type: string | null | undefined): string =>
  (type ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").trim().toLowerCase();

const DEFAULT_HUES: Record<string, string[]> = {
  white: ["Lemon", "Gold", "Amber"],
  sparkling: ["Lemon", "Gold", "Pink", "Salmon"],
  rose: ["Pink", "Salmon", "Orange"],
  orange: ["Gold", "Amber", "Orange"],
  red: ["Purple", "Ruby", "Garnet", "Tawny"],
  sweet: ["Lemon", "Gold", "Amber"],
  fortified: ["Ruby", "Tawny", "Amber", "Brown"],
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
  const base = DEFAULT_HUES[typeKey(type)] ?? ALL_HUES;
  // "Lemon-Green" and "lemon green" are one hue: counted together, shown as you spell it most.
  const hk = (h: string) => h.toLowerCase().replace(/[-\s]+/g, " ").trim();
  const counts = new Map<string, { n: number; spellings: Map<string, number> }>();
  for (const h of history) {
    if (typeKey(h.type) !== typeKey(type)) continue;
    const hue = splitColour(h.colour).hue;
    if (!hue) continue;
    const c = counts.get(hk(hue)) ?? { n: 0, spellings: new Map<string, number>() };
    c.n++;
    c.spellings.set(hue, (c.spellings.get(hue) ?? 0) + 1);
    counts.set(hk(hue), c);
  }
  const extra = [...counts.entries()]
    // Your own hues (e.g. Straw), but not another type's standard ones (Purple on a white is a slip).
    .filter(([k, c]) => c.n >= 3 && !base.some((b) => hk(b) === k) && !(typeKey(type) && ALL_HUES.some((b) => hk(b) === k)))
    .sort((a, b) => b[1].n - a[1].n)
    .map(([, c]) => [...c.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return [...base, ...extra];
}

/** Types where tannin isn't assessed; saved as "-" when left blank. */
export const NO_TANNIN_TYPES = ["White", "Sparkling", "Sweet"];
export const showsTannin = (type: string | null) => !NO_TANNIN_TYPES.some((t) => typeKey(t) === typeKey(type));

/**
 * Shorter words on the chips, so a scale fits on one line: "Medium (-)" → "M-", "Medium (+)" → "M+",
 * "Medium" → "Med", "Pronounced" → "Pron.", "Medium-dry" → "Med-dry". The saved value keeps its full wording.
 */
export function shortLevel(v: string): string {
  const s = v.trim();
  const m = /^medium\s*\(?\s*([-–−+])\s*\)?$/i.exec(s);
  if (m) return `M${m[1] === "+" ? "+" : "-"}`;
  if (/^medium$/i.test(s)) return "Med";
  if (/^pronounced$/i.test(s)) return "Pron.";
  const d = /^medium[-\s]+(dry|sweet)$/i.exec(s);
  return d ? `Med-${d[1].toLowerCase()}` : v;
}

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

/** Common aromas for each type: suggested until you've used enough of your own for that type. */
const TYPE_AROMAS: Record<string, string[]> = {
  sparkling: ["lemon", "green apple", "pear", "white peach", "citrus peel", "brioche", "toast", "biscuit", "cream", "almond", "white flowers", "chalk"],
  white: ["lemon", "lime", "green apple", "pear", "peach", "apricot", "pineapple", "white flowers", "butter", "vanilla", "hazelnut", "wet stone", "flint", "honey"],
  red: ["strawberry", "raspberry", "red cherry", "black cherry", "blackberry", "blackcurrant", "plum", "violet", "rose", "pepper", "vanilla", "leather", "earth", "mushroom"],
  rose: ["strawberry", "raspberry", "red cherry", "watermelon", "grapefruit", "peach", "rose", "herbs"],
  orange: ["apricot", "orange peel", "dried apricot", "bruised apple", "tea", "honey", "nuts", "spice"],
  sweet: ["honey", "apricot", "peach", "marmalade", "candied citrus", "pineapple", "saffron", "ginger", "raisin"],
  fortified: ["raisin", "fig", "prune", "dried fruit", "walnut", "caramel", "toffee", "coffee", "chocolate", "nutmeg"],
};

/**
 * Aroma suggestions. Typing: as suggest(). Not typing, with the type known: the aromas
 * you've used most for that type, then the common ones for it, nothing from other types.
 */
export function suggestAromas(vocab: Vocab, type: string | null, query: string, exclude: string[], limit = 14): string[] {
  const k = typeKey(type);
  if (query.trim() || !k) return suggest(vocab, type, query, exclude, query.trim() ? 10 : limit);
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  const forType = (e: VocabEntry) => Object.entries(e.byType).reduce((s, [t, n]) => s + (typeKey(t) === k ? n : 0), 0);
  const mine = [...vocab.values()]
    .map((e) => ({ label: e.label, n: forType(e) }))
    .filter((e) => e.n > 0 && !skip.has(e.label))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map((e) => e.label);
  const common = (TYPE_AROMAS[k] ?? []).filter((t) => !skip.has(t) && !mine.includes(t));
  return [...mine, ...common].slice(0, limit);
}

// ---- Conclusion ------------------------------------------------------------------

/** A new note starts at this score. */
export const DEFAULT_SCORE = 90;

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
