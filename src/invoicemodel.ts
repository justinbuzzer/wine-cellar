// An invoice read by the label reader's /invoice, turned into purchase lines:
// bottles and a per-bottle price on the invoice's own GST basis (Add a purchase
// then adds GST when "Prices are before GST" is on), with any order discount
// spread across the bottles, and a check against the invoice total.
// Pure (type-only imports), so it can be unit-tested.

import type { LabelField, LabelResult } from "./label";

export interface InvoiceLine extends Omit<LabelResult, "unsure" | "readable"> {
  /** Label fields that were inferred or hard to read, plus "quantity" / "unitPrice". */
  unsure: string[];
  quantity: number;
  /** Per bottle, as printed (after any discount on that line). */
  unitPrice: number;
  lineTotal: number;
  /** false: no GST on this line's price although the invoice adds GST (e.g. an auction lot marked ◊). */
  gstOnPrice?: boolean;
}

export interface Invoice {
  readable: boolean;
  merchant: string;
  /** "YYYY-MM-DD" or "" */
  date: string;
  currency: string;
  pricesIncludeGst: "yes" | "no" | "unknown";
  lines: InvoiceLine[];
  /** Order-level discount (positive), on the lines' GST basis. */
  discount: number;
  /** The same discount as a percentage, when the invoice prints one (it wins over the amount). */
  discountPercent: number;
  /** An auction buyer's premium or other surcharge on the wines: amount, and percentage when printed. */
  premium: number;
  premiumPercent: number;
  /** GST is charged on the premium too (auctions: GST on hammer + premium). */
  gstOnPremium?: boolean;
  delivery: number;
  subtotal: number;
  gst: number;
  total: number;
  notes: string;
}

export interface PlannedLine {
  /** The wine as the label reader would describe it. */
  label: LabelResult;
  bottles: number;
  /** What each bottle cost in the end: after discount, premium and GST ("" if unknown). */
  price: string;
  /** Why this line needs a look, if it does. */
  check: string | null;
}

export interface InvoicePlan {
  lines: PlannedLine[];
  /** Always false: the prices are worked out in full, GST included. */
  beforeGst: boolean;
  bottles: number;
  /** What the wines come to after discount and GST (per-bottle prices × bottles). */
  winesTotal: number;
  /** Expected invoice total: wines plus delivery (with GST where the invoice adds it). */
  expectedTotal: number;
  /** null when the invoice shows no total. */
  totalMatches: boolean | null;
  /** expectedTotal − invoice total. */
  difference: number;
  /** How the per-bottle prices were worked out, e.g. "10% discount taken off each bottle". */
  adjustments: string[];
  warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const LABEL_KEYS: LabelField[] = ["producer", "name", "vintage", "type", "country", "region", "location", "varietal", "blend", "alcohol"];

export function planInvoice(inv: Invoice, gstRatePct: number): InvoicePlan {
  const rate = gstRatePct / 100;
  /** The invoice adds GST to the prices (rather than including it, or charging none). */
  const addsGst = inv.pricesIncludeGst === "no";
  const beforeGst = false;
  const wines = inv.lines.filter((l) => l.quantity > 0);
  const listSum = wines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  // An order discount and a buyer's premium apply to every bottle in proportion to its price.
  // A printed percentage wins over the amount (some invoices print an amount that doesn't match it).
  const pct = (v: number | undefined) => (typeof v === "number" && v > 0 && v < 100 ? v / 100 : 0);
  const discountShare = pct(inv.discountPercent) || (listSum > 0 ? Math.min(1, Math.max(0, inv.discount) / listSum) : 0);
  const premiumShare = pct(inv.premiumPercent) || (listSum > 0 ? Math.max(0, inv.premium ?? 0) / listSum : 0);
  const gstOnPremium = inv.gstOnPremium !== false;
  /**
   * Per bottle: the printed price less its share of any discount, plus the premium on that, plus GST
   * where the invoice adds it: on the price (unless the lot is GST-free, e.g. ◊) and on the premium.
   */
  const finalPrice = (l: InvoiceLine) => {
    const price = l.unitPrice * (1 - discountShare);
    const premium = price * premiumShare;
    const gst = addsGst ? rate * ((l.gstOnPrice === false ? 0 : price) + (gstOnPremium ? premium : 0)) : 0;
    return price + premium + gst;
  };
  const adjustments: string[] = [];
  if (discountShare > 0) adjustments.push(`${+(discountShare * 100).toFixed(2)}% discount taken off each bottle.`);
  if (premiumShare > 0) adjustments.push(`${+(premiumShare * 100).toFixed(2)}% buyer's premium added to each bottle.`);
  if (addsGst) adjustments.push(`${gstRatePct}% GST added${premiumShare > 0 && gstOnPremium ? " (on the premium too)" : ""}.`);
  const gstFree = wines.filter((l) => l.gstOnPrice === false).length;
  if (addsGst && gstFree) adjustments.push(`${gstFree} lot${gstFree === 1 ? "" : "s"} without GST on the price (e.g. marked ◊).`);

  const lines: PlannedLine[] = wines.map((l) => {
    const label: LabelResult = {
      ...(Object.fromEntries(LABEL_KEYS.map((k) => [k, l[k] ?? ""])) as Record<LabelField, string>),
      unsure: l.unsure.filter((k): k is LabelField => (LABEL_KEYS as string[]).includes(k)),
      readable: true,
    };
    const checks: string[] = [];
    if (l.unsure.includes("quantity")) checks.push("the number of bottles");
    if (l.unitPrice <= 0) checks.push("the price (none found)");
    else if (l.unsure.includes("unitPrice")) checks.push("the price");
    else if (l.lineTotal > 0) {
      // A line total may be before or after GST (some invoices print unit prices before GST and line totals with it).
      const net = l.quantity * l.unitPrice;
      const close = (x: number) => Math.abs(x - l.lineTotal) <= 0.05 * Math.max(1, l.quantity);
      if (!close(net) && !close(net * (1 + rate))) checks.push(`the price (${l.quantity} × ${l.unitPrice} isn't the line's ${l.lineTotal})`);
    }
    return {
      label,
      bottles: Math.round(l.quantity),
      price: l.unitPrice > 0 ? String(round2(finalPrice(l))) : "",
      check: checks.length ? `Check ${checks.join(" and ")}.` : null,
    };
  });

  const bottles = lines.reduce((s, l) => s + l.bottles, 0);
  const winesNet = round2(wines.reduce((s, l) => s + l.quantity * finalPrice(l), 0));
  const expectedTotal = round2(winesNet + Math.max(0, inv.delivery) * (addsGst ? 1 + rate : 1));
  const totalMatches = inv.total > 0 ? Math.abs(expectedTotal - inv.total) <= Math.max(1, inv.total * 0.005) : null;

  const warnings: string[] = [];
  if (inv.currency && inv.currency.toUpperCase() !== "SGD") warnings.push(`Prices are in ${inv.currency}, not SGD: convert them before saving.`);
  if (inv.pricesIncludeGst === "unknown") warnings.push("It isn't clear whether these prices include GST: check the switch below.");
  if (inv.delivery > 0) warnings.push("Delivery isn't added to the bottle prices.");
  if (inv.notes) warnings.push(inv.notes);
  if (inv.lines.length > wines.length) warnings.push(`${inv.lines.length - wines.length} line${inv.lines.length - wines.length === 1 ? "" : "s"} with no bottles left out.`);

  return {
    lines,
    beforeGst,
    bottles,
    winesTotal: winesNet,
    expectedTotal,
    totalMatches,
    difference: round2(expectedTotal - inv.total),
    adjustments,
    warnings,
  };
}

/** Bottles from photos, same wine together: one line per wine with its count. */
export function groupBottles(bottles: LabelResult[]): { label: LabelResult; count: number }[] {
  const key = (b: LabelResult) => [b.producer, b.name, b.vintage].map((x) => x.trim().toLowerCase()).join("|");
  const out = new Map<string, { label: LabelResult; count: number }>();
  for (const b of bottles) {
    if (!b.producer && !b.name) continue;
    const k = key(b);
    const g = out.get(k);
    if (g) g.count++;
    else out.set(k, { label: b, count: 1 });
  }
  return [...out.values()];
}
