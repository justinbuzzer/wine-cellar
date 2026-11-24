// Fill from label: shrink photos on the device, send them to the label reader
// (a Cloudflare Worker that holds the Claude API key), and match the answer to
// wines you already have. Photos are never stored anywhere.

import { getToken } from "./auth";
import { config } from "./config";
import { norm, shortName, type Tasting, type Wine } from "./data";
import { sameWineKey, vintageKey } from "./dupes";
import type { Invoice } from "./invoicemodel";

export const LABEL_FIELDS = ["producer", "name", "vintage", "type", "country", "region", "location", "varietal", "blend", "alcohol"] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];
export type LabelResult = Record<LabelField, string> & { unsure: LabelField[]; readable: boolean };

export const labelReaderOn = (): boolean => !!config.labelReaderUrl;

/** Longest edge sent to Claude. Labels stay sharp; each photo costs well under a cent. */
const MAX_EDGE = 1568;

/** Resize a photo to a JPEG no larger than MAX_EDGE, returned as base64 (no data: prefix). */
export async function shrinkPhoto(file: File): Promise<{ mediaType: "image/jpeg"; data: string; preview: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("That photo couldn't be opened. Try a JPEG or PNG.");
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1), preview: url };
}

interface Hints {
  types: string[];
  blends: string[];
  countries: string[];
  regions: string[];
}

export class LabelReaderError extends Error {
  constructor(message: string, readonly userId?: string) {
    super(message);
  }
}

/** The app's own lists, sent with every read so answers use the workbook's names. */
export function labelHints(data: { wines: Wine[]; tastings: Tasting[]; lists: Record<string, string[]> }): Hints {
  const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const all = [...data.wines, ...data.tastings];
  return {
    types: data.lists["List_Type"] ?? [],
    blends: data.lists["List_Blend"] ?? [],
    countries: u(all.map((w) => w.country)),
    regions: u(all.map((w) => w.region)),
  };
}

/**
 * Every bottle in the photos, left to right as they stand (a single bottle, or
 * its front and back labels, gives a list of one).
 */
export async function readBottles(images: { mediaType: string; data: string }[], hints: Hints): Promise<LabelResult[]> {
  if (!config.labelReaderUrl) throw new LabelReaderError("The label reader isn't set up yet.");
  if (navigator.onLine === false) throw new LabelReaderError("You're offline. Reading a label needs a connection.");
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${config.labelReaderUrl}/bottles`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ images, ...hints }),
    });
  } catch {
    throw new LabelReaderError("Couldn't reach the label reader. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; userId?: string; bottles?: Omit<LabelResult, "readable">[]; readable?: boolean };
  if (!res.ok || !Array.isArray(body.bottles)) throw new LabelReaderError(body.error ?? `The label reader failed (${res.status}).`, body.userId);
  if (body.readable === false) return [];
  return body.bottles.map((b) => ({ ...b, readable: true }));
}

/** An invoice file for the reader: a PDF as it is, a screenshot or photo shrunk like a label. */
export async function invoiceFile(file: File): Promise<{ mediaType: string; data: string; preview: string | null; name: string }> {
  if (file.type === "application/pdf" || /.pdf$/i.test(file.name)) {
    if (file.size > 4_500_000) throw new Error("That PDF is too large (over 4.5 MB).");
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const url = String(r.result);
        resolve(url.slice(url.indexOf(",") + 1));
      };
      r.onerror = () => reject(new Error("That PDF couldn't be opened."));
      r.readAsDataURL(file);
    });
    return { mediaType: "application/pdf", data, preview: null, name: file.name };
  }
  return { ...(await shrinkPhoto(file)), name: file.name };
}

/** An invoice (PDF and/or photos) read by the label reader: the order, each wine line and the totals. */
export async function readInvoice(files: { mediaType: string; data: string }[], hints: Hints): Promise<Invoice> {
  if (!config.labelReaderUrl) throw new LabelReaderError("The invoice reader isn't set up yet.");
  if (navigator.onLine === false) throw new LabelReaderError("You're offline. Reading an invoice needs a connection.");
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${config.labelReaderUrl}/invoice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ images: files, ...hints }),
    });
  } catch {
    throw new LabelReaderError("Couldn't reach the invoice reader. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; userId?: string; invoice?: Invoice };
  if (!res.ok || !body.invoice) {
    throw new LabelReaderError(
      res.status === 404 ? "The invoice reader isn't switched on yet (the Worker needs updating)." : body.error ?? `The invoice reader failed (${res.status}).`,
      body.userId,
    );
  }
  return body.invoice;
}

/** A one-line name for a bottle the reader found, e.g. "Torbreck Descendant 2018". */
export function bottleTitle(r: LabelResult): string {
  const name = r.name && r.producer && norm(r.name).startsWith(norm(r.producer)) ? r.name : [r.producer, r.name].filter(Boolean).join(" ");
  return [name || r.location || (r.type ? `${r.type} (label unreadable)` : "Label unreadable"), r.vintage].filter(Boolean).join(" ");
}

/**
 * The reader's answer as note fields: type and blend snapped to the workbook's
 * lists, vintage and alcohol checked. Empty values are left out.
 */
export function labelFields(r: LabelResult, lists: Record<string, string[]>): { fields: Partial<Record<LabelField, string>>; unsure: LabelField[] } {
  const pick = (list: string[] | undefined, v: string) => (list ?? []).find((x) => x.toLowerCase() === v.toLowerCase()) ?? "";
  const fields: Partial<Record<LabelField, string>> = {
    producer: r.producer,
    // A wine needs a name: fall back to the appellation, then the producer.
    name: r.name || r.location || r.producer,
    vintage: /^(\d{4}|nv)$/i.test(r.vintage) ? (/^nv$/i.test(r.vintage) ? "NV" : r.vintage) : "",
    type: pick(lists["List_Type"], r.type),
    country: r.country,
    region: r.region,
    location: r.location,
    varietal: r.varietal,
    blend: pick(lists["List_Blend"], r.blend),
    alcohol: Number(r.alcohol) > 3 && Number(r.alcohol) < 25 ? String(Number(r.alcohol)) : "",
  };
  const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) as Partial<Record<LabelField, string>>;
  return { fields: kept, unsure: r.unsure.filter((k) => kept[k]) };
}

// ---- matching to wines you already have ----------------------------------------------

export interface LabelMatch {
  key: string;
  wine: Wine | Tasting;
  kind: "cellar" | "tasted";
  exact: boolean;
}

const words = (s: string | null | undefined) =>
  new Set(
    String(s ?? "")
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !["cru", "premier", "grand", "the", "les", "des", "domaine", "chateau"].includes(w)),
  );

function sameProducer(a: string | null, b: string | null): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)));
}

/** Share of the label's name words found in the candidate's name. */
function nameOverlap(label: LabelResult, w: { producer: string | null; name: string | null }): number {
  const a = words(shortName({ producer: label.producer, name: label.name }));
  const b = words(shortName(w));
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return hit / Math.max(a.size, b.size);
}

/** Cellar wines and past-note wines that look like the label: same producer and vintage. */
export function matchLabel(label: LabelResult, wines: Wine[], tastings: Tasting[]): LabelMatch[] {
  if (!label.producer && !label.name) return [];
  const key = sameWineKey({ producer: label.producer, name: label.name, vintage: label.vintage });
  const vk = vintageKey(label.vintage);
  const score = (w: { producer: string | null; name: string | null; vintage: string | number | null }) => {
    if (key && sameWineKey(w) === key) return 2;
    if (!sameProducer(label.producer, w.producer) || vintageKey(w.vintage) !== vk) return 0;
    return nameOverlap(label, w) >= 0.5 ? 1 : 0;
  };
  const out: (LabelMatch & { s: number })[] = [];
  for (const w of wines) {
    const s = score(w);
    if (s) out.push({ key: `c-${w.wineId}`, wine: w, kind: "cellar", exact: s === 2, s });
  }
  const seen = new Set(out.map((m) => sameWineKey(m.wine)));
  for (const t of tastings) {
    if (t.wineId) continue; // notes linked to a cellar wine are covered above
    const s = score(t);
    const k = sameWineKey(t);
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `t-${t.tastingId}`, wine: t, kind: "tasted", exact: s === 2, s });
  }
  return out.sort((a, b) => b.s - a.s || (b.kind === "cellar" ? 1 : 0) - (a.kind === "cellar" ? 1 : 0)).slice(0, 3);
}
