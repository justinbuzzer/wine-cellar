// Pure helpers for the "Add a purchase" screen (type-only imports; unit-testable).

export const GST_RATE = 9;

/** Price per bottle as stored: after GST. Returns null for blank/invalid input. */
export function storedPrice(input: string, beforeGst: boolean, ratePct = GST_RATE): number | null {
  const s = input.trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, "");
  if (!/\d/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 0) return null;
  const v = beforeGst ? n * (1 + ratePct / 100) : n;
  return Math.round(v * 100) / 100;
}

export interface SummaryLine {
  kind: "existing" | "new";
  bottles: number;
  price: number | null;
}

export interface PurchaseSummary {
  newWines: number;
  existingWines: number;
  bottles: number;
  total: number;
  /** Lines without a price (not counted in the total). */
  unpriced: number;
}

export function summarize(lines: SummaryLine[]): PurchaseSummary {
  const s: PurchaseSummary = { newWines: 0, existingWines: 0, bottles: 0, total: 0, unpriced: 0 };
  for (const l of lines) {
    if (l.kind === "new") s.newWines++;
    else s.existingWines++;
    s.bottles += l.bottles;
    if (l.price === null) s.unpriced++;
    else s.total += l.price * l.bottles;
  }
  s.total = Math.round(s.total * 100) / 100;
  return s;
}
