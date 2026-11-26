// One spelling per appellation. "Gevrey Chambertin", "gevrey-chambertin" and
// "Gevrey-Chambertin" are the same place (only capitals, accents, hyphens and spaces
// differ; typos are left alone, since a one-letter guess can pick the wrong place). The standard spelling is picked from what's in your
// workbook: the most careful one (accents, hyphens, lower-case "de", "du", "les",
// "McLaren"), then the most used. Suggestions show only standard spellings, and
// what you type or a label gives is saved in the standard spelling.
// Pure, so it can be unit-tested.

/** "Côte-Rôtie", "cote rotie" and "Cote Rotie" all give "cote rotie". */
export const appellationKey = (s: string): string =>
  s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[-'’‘.\s]+/g, " ").trim();

const PARTICLE = /^(de|du|des|di|del|della|la|le|les|lès|sur|en|et|d)$/i;

/** How carefully a spelling is written: accents, hyphens, "McLaren"; capitalised "De", "Les" count against. */
function care(s: string): number {
  const accents = (s.normalize("NFD").match(/\p{Mn}/gu) ?? []).length;
  const hyphens = (s.match(/-/g) ?? []).length;
  const camel = (s.match(/[a-z][A-Z]/g) ?? []).length;
  const capParticles = s
    .split(/[\s-]+/)
    .slice(1)
    .filter((w) => PARTICLE.test(w) && /^[A-Z]/.test(w)).length;
  return accents * 3 + hyphens * 2 + camel * 2 - capParticles * 2;
}

export interface Appellations {
  /** The standard spelling of a value (as typed, if it's an appellation the workbook doesn't have yet). */
  canonical(value: string): string;
  /** The standard spellings among these values, each once, sorted. */
  options(values: (string | null | undefined)[]): string[];
}

export function appellationIndex(values: (string | null | undefined)[]): Appellations {
  const tidy = (v: string | null | undefined) => (v ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  const count = new Map<string, number>();
  for (const v of values) {
    const s = tidy(v);
    if (s) count.set(s, (count.get(s) ?? 0) + 1);
  }
  // Spellings of the same place, and the most careful (then most used) of each.
  const groups = new Map<string, string[]>();
  for (const s of count.keys()) {
    const k = appellationKey(s);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const best = new Map<string, string>();
  for (const [k, spellings] of groups) {
    spellings.sort((a, b) => care(b) - care(a) || (count.get(b) ?? 0) - (count.get(a) ?? 0) || a.localeCompare(b));
    best.set(k, spellings[0]);
  }
  const canonical = (value: string) => {
    const s = tidy(value);
    return s ? best.get(appellationKey(s)) ?? s : s;
  };
  return {
    canonical,
    options: (vals) => [...new Set(vals.map((v) => canonical(v ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  };
}

/** Every appellation in your cellar and notes. */
export const appellationsOf = (data: { wines: { location: string | null }[]; tastings: { location: string | null }[] }): Appellations =>
  appellationIndex([...data.wines, ...data.tastings].map((w) => w.location));
