// Numbers for the Overview page. Pure (type-only imports), so it can be unit-tested.

import type { Tasting, Wine } from "./data";
import type { Opening } from "./historymodel";

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** Secondary text, e.g. "12 wines". */
  sub?: string;
}

export interface CellarStats {
  wines: number;
  bottles: number;
  /** Bottles bought but not yet arrived. */
  nyaBottles: number;
  value: number;
  bottlesWithoutPrice: number;
  kc: number;
  home: number;
  byType: Bar[];
  byCountry: Bar[];
  byVintage: Bar[];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Counts bottles per key; returns bars largest first (or in `order` when given). */
function group(wines: Wine[], keyOf: (w: Wine) => string, order?: string[]): Bar[] {
  const m = new Map<string, { bottles: number; wines: number }>();
  for (const w of wines) {
    const k = keyOf(w);
    const g = m.get(k) ?? { bottles: 0, wines: 0 };
    g.bottles += w.qty;
    g.wines += 1;
    m.set(k, g);
  }
  const bars = [...m].map(([k, g]) => ({ key: k, label: k, value: g.bottles, sub: plural(g.wines, "wine") }));
  if (order) {
    const rank = (k: string) => (order.indexOf(k) + 1 || order.length + 1);
    return bars.sort((a, b) => rank(a.key) - rank(b.key) || b.value - a.value);
  }
  return bars.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** Keeps the top `n` bars and folds the rest into "Other". */
export function topN(bars: Bar[], n: number, otherLabel = "Other"): Bar[] {
  if (bars.length <= n + 1) return bars;
  const rest = bars.slice(n);
  return [
    ...bars.slice(0, n),
    { key: "__other", label: `${otherLabel} (${rest.length})`, value: rest.reduce((s, b) => s + b.value, 0) },
  ];
}

/** "2015–19"-style vintage buckets, plus NV and "Before 1990". */
export function vintageBucket(v: Wine["vintage"]): string {
  if (v === "NV") return "NV";
  if (v === null) return "Unknown";
  if (v < 1990) return "Before 1990";
  const start = v - (v % 5);
  return `${start}–${String(start + 4).slice(2)}`;
}

/** `typeOrder` is the display order for wine types (TYPE_ORDER in winelist.ts). */
export function cellarStats(all: Wine[], typeOrder: string[]): CellarStats {
  const current = all.filter((w) => w.qty > 0);
  const arrived = current.filter((w) => w.status !== "NYA");
  const nya = current.filter((w) => w.status === "NYA");
  const sum = (xs: Wine[], f: (w: Wine) => number) => xs.reduce((s, w) => s + f(w), 0);

  const vintageOrder = [...new Set(current.map((w) => vintageBucket(w.vintage)))].sort((a, b) => {
    const rank = (s: string) => (s === "NV" ? 99999 : s === "Unknown" ? 100000 : s === "Before 1990" ? 0 : Number(s.slice(0, 4)));
    return rank(a) - rank(b);
  });

  return {
    wines: current.length,
    bottles: sum(current, (w) => w.qty),
    nyaBottles: sum(nya, (w) => w.qty),
    value: Math.round(sum(current, (w) => (w.price ?? 0) * w.qty)),
    bottlesWithoutPrice: sum(current.filter((w) => w.price === null), (w) => w.qty),
    kc: sum(arrived, (w) => w.kc ?? 0),
    home: sum(arrived, (w) => w.home ?? 0),
    byType: group(current, (w) => w.type ?? "Other", typeOrder),
    byCountry: group(current, (w) => w.country ?? "Unknown"),
    byVintage: group(current, (w) => vintageBucket(w.vintage), vintageOrder),
  };
}

export interface DrinkingStats {
  thisYear: number;
  thisYearValue: number;
  lastYear: number;
  /** Bottles per month for the last 12 months, oldest first. */
  months: Bar[];
  /** Most-opened wines this year. */
  favourites: { wineId: string | null; label: string; count: number }[];
}

/** `today` is "YYYY-MM-DD" (local date). */
export function drinkingStats(history: Opening[], today: string): DrinkingStats {
  const year = today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const dated = history.filter((o) => o.date);
  const thisYear = dated.filter((o) => o.date!.startsWith(year));

  const months: Bar[] = [];
  let y = Number(year);
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", { month: "short", timeZone: "UTC" });
    months.unshift({ key, label, value: dated.filter((o) => o.date!.startsWith(key)).length });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }

  const counts = new Map<string, { wineId: string | null; label: string; count: number }>();
  for (const o of thisYear) {
    const k = o.wineId ?? `${o.producer} ${o.name} ${o.vintage}`;
    const label = [o.producer, o.name, o.vintage].filter(Boolean).join(" ");
    const c = counts.get(k) ?? { wineId: o.wineId, label, count: 0 };
    c.count += 1;
    counts.set(k, c);
  }

  return {
    thisYear: thisYear.length,
    thisYearValue: Math.round(thisYear.reduce((s, o) => s + (o.price ?? 0), 0)),
    lastYear: dated.filter((o) => o.date!.startsWith(lastYear)).length,
    months,
    favourites: [...counts.values()].filter((c) => c.count > 1).sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

export interface NoteStats {
  notes: number;
  thisYear: number;
  average: number | null;
  /** Highest average score, with at least `minNotes` notes. */
  topRegions: Bar[];
  /** Single-grape wines, by grape. */
  topSingles: Bar[];
  /** Blends, by what the varietal column says (e.g. "Cabernet Sauvignon, Merlot"). */
  topBlends: Bar[];
}

function averages(ts: Tasting[], keyOf: (t: Tasting) => string | null, minNotes: number, n: number): Bar[] {
  const m = new Map<string, number[]>();
  for (const t of ts) {
    const k = keyOf(t);
    if (!k || t.score === null) continue;
    m.set(k, [...(m.get(k) ?? []), t.score]);
  }
  return [...m]
    .filter(([, s]) => s.length >= minNotes)
    .map(([k, s]) => ({ key: k, label: k, value: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10, sub: plural(s.length, "note") }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, n);
}

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

export const MIN_NOTES = 10;

export function noteStats(tastings: Tasting[], today: string, minNotes = MIN_NOTES): NoteStats {
  const scored = tastings.filter((t) => t.score !== null && Number.isFinite(t.score));
  const year = Number(today.slice(0, 4));
  return {
    notes: tastings.length,
    thisYear: tastings.filter((t) => t.yearTasted === year || (t.dateTasted ?? "").startsWith(String(year))).length,
    average: scored.length ? Math.round((scored.reduce((s, t) => s + t.score!, 0) / scored.length) * 10) / 10 : null,
    topRegions: averages(tastings, (t) => (t.region ? (t.country ? `${t.region}, ${t.country}` : t.region) : null), minNotes, 5),
    topSingles: averages(tastings, (t) => (isBlend(t) ? null : t.varietal), minNotes, 5),
    topBlends: averages(tastings, (t) => (isBlend(t) ? t.varietal : null), minNotes, 5),
  };
}
