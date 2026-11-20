// Researched remarks waiting for review: the file Claude writes after looking up
// each wine (wine-research-proposals.json). Pure, for unit testing.

export type SourceKind = "winery tech sheet" | "winery website" | "importer" | "email" | "instagram" | "other";
export type VintageMatch = "exact" | "other" | "general";
export type Confidence = "high" | "medium" | "low";

export interface ResearchSource {
  title: string;
  url: string;
  kind: SourceKind;
  /** The vintage the source describes, when it's for a particular one. */
  vintage?: number | "NV" | null;
}

export interface Proposal {
  wineId: string;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  /** The text to add to Remarks. Empty when nothing reliable was found. */
  text: string;
  confidence: Confidence;
  /** Whether the details are for this vintage, a different one, or the wine in general. */
  vintageMatch: VintageMatch;
  sources: ResearchSource[];
  /** Anything worth knowing before approving, e.g. "2018 sheet used; 2019 not published". */
  caveat?: string;
  /** Alcohol % for this vintage (e.g. 13.5), to fill the Alcohol % column when it's blank. */
  alcohol?: number | null;
}

/** A plausible alcohol percentage (5–25), rounded to one decimal; otherwise null. */
export function alcoholValue(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace("%", "").trim()) : NaN;
  return Number.isFinite(n) && n >= 5 && n <= 25 ? Math.round(n * 10) / 10 : null;
}

export interface ProposalFile {
  generated: string;
  proposals: Proposal[];
}

const KINDS: SourceKind[] = ["winery tech sheet", "winery website", "importer", "email", "instagram", "other"];
const MATCHES: VintageMatch[] = ["exact", "other", "general"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/** Reads and checks a proposals file; throws a readable error if it isn't one. */
export function parseProposals(json: string): ProposalFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const r = raw as Partial<ProposalFile>;
  if (!r || !Array.isArray(r.proposals)) throw new Error("That file has no proposals in it.");
  const proposals = r.proposals.map((p, i): Proposal => {
    if (!p || typeof p.wineId !== "string") throw new Error(`Proposal ${i + 1} is missing its WineID.`);
    if (typeof p.text !== "string") p.text = "";
    const sources = Array.isArray(p.sources) ? p.sources : [];
    return {
      wineId: p.wineId,
      producer: p.producer ?? null,
      name: p.name ?? null,
      vintage: p.vintage ?? null,
      text: p.text.trim(),
      confidence: CONFIDENCES.includes(p.confidence) ? p.confidence : "low",
      vintageMatch: MATCHES.includes(p.vintageMatch) ? p.vintageMatch : "general",
      caveat: typeof p.caveat === "string" && p.caveat.trim() ? p.caveat.trim() : undefined,
      alcohol: alcoholValue(p.alcohol),
      sources: sources
        .filter((s) => s && typeof s.url === "string" && /^https?:\/\//i.test(s.url))
        .map((s) => ({
          title: String(s.title || hostOf(s.url)),
          url: s.url,
          kind: KINDS.includes(s.kind) ? s.kind : "other",
          vintage: s.vintage ?? null,
        })),
    };
  });
  return { generated: String(r.generated ?? ""), proposals };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Text for the vintage badge, e.g. "Matches 2017", "From the 2018 sheet", "General". */
export function vintageBadge(p: Proposal): string {
  if (p.vintageMatch === "exact") return `Matches ${p.vintage ?? "vintage"}`;
  if (p.vintageMatch === "other") {
    const v = p.sources.find((s) => s.vintage && s.vintage !== p.vintage)?.vintage;
    return v ? `From the ${v} sheet` : "Another vintage";
  }
  return "General, not vintage-specific";
}

/**
 * What you decided for one wine. `text` is your edited remarks (undefined = as proposed);
 * `alcohol` is the value to fill (undefined = as proposed, null = don't fill it).
 */
export type Decision = { status: "approved" | "rejected" | "saved"; text?: string; alcohol?: number | null };
