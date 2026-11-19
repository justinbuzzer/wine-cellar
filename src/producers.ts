// Producers and their logo files. Pure functions, no network.
// A logo belongs to a producer by name: "Torbreck.png" is used for every wine
// whose producer is "Torbreck" (ignoring capitals, accents and punctuation).

import { norm, type Wine } from "./data";

export function producerKey(producer: string | null | undefined): string {
  return norm(producer);
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

/** The producer key a logo file belongs to, or null if it isn't a picture. */
export function logoKeyFromFileName(name: string): string | null {
  if (!IMAGE_EXT.test(name)) return null;
  return producerKey(name.replace(IMAGE_EXT, "")) || null;
}

/** A safe OneDrive file name for a producer's logo. */
export function logoFileName(producer: string, ext: string): string {
  const base = producer
    .replace(/["*:<>?/\\|#%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return `${base || "logo"}.${ext}`;
}

export interface Producer {
  key: string;
  /** The spelling used on most rows. */
  name: string;
  wines: Wine[];
  bottles: number;
}

/** Every producer in the cellar, most wines first. */
export function producerGroups(wines: Wine[]): Producer[] {
  const map = new Map<string, { wines: Wine[]; spellings: Map<string, number> }>();
  for (const w of wines) {
    const key = producerKey(w.producer);
    if (!key) continue;
    let g = map.get(key);
    if (!g) map.set(key, (g = { wines: [], spellings: new Map() }));
    g.wines.push(w);
    const p = String(w.producer).trim();
    g.spellings.set(p, (g.spellings.get(p) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, g]) => ({
      key,
      name: [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      wines: g.wines,
      bottles: g.wines.reduce((s, w) => s + w.qty, 0),
    }))
    .sort((a, b) => b.wines.length - a.wines.length || a.name.localeCompare(b.name));
}

/**
 * Producers whose names look like the same producer written two ways, e.g.
 * "Torbreck" and "Torbreck Vintners" or "Leflaive" and "Domaine Leflaive":
 * the shorter name (5+ letters) is the start or end of the longer one.
 */
export function similarProducers(groups: Producer[]): [Producer, Producer][] {
  const out: [Producer, Producer][] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const [a, b] = groups[i].key.length <= groups[j].key.length ? [groups[i], groups[j]] : [groups[j], groups[i]];
      if (a.key.length >= 5 && (b.key.startsWith(a.key) || b.key.endsWith(a.key))) out.push([a, b]);
    }
  }
  return out.sort((x, y) => x[0].name.localeCompare(y[0].name));
}
