// Finds Inventory rows whose bottle counts aren't stored the way the app expects.
// Pure (type-only imports) so it can be unit-tested without a browser.

import type { Cell } from "./data";

export const COLS = { qty: "Qty", kc: "Qty K Cellars", home: "Qty Home", id: "WineID", name: "Name", producer: "Producer", vintage: "Vintage" };

export interface QtyIssue {
  /** 0-based index into the table's data rows. */
  index: number;
  wineId: string;
  label: string;
  reasons: string[];
  /** Parsed counts to write back; null when the cell holds something unreadable. */
  kc: number | null;
  home: number | null;
  kcIsText: boolean;
  homeIsText: boolean;
}

/** A bottle count from a cell: number, numeric text, or blank (= 0). Null if unreadable. */
export function asCount(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\s*\d+(\.0+)?\s*$/.test(v)) return Number(v);
  return null;
}

const isTextNumber = (v: Cell | undefined) => typeof v === "string" && v.trim() !== "" && asCount(v) !== null;

export function findQtyIssues(headers: string[], body: Cell[][]): QtyIssue[] {
  const c = (h: string) => headers.indexOf(h);
  const [qi, ki, hi] = [c(COLS.qty), c(COLS.kc), c(COLS.home)];
  if (qi < 0 || ki < 0 || hi < 0) return [];
  const issues: QtyIssue[] = [];
  body.forEach((row, index) => {
    const qty = row[qi];
    const kc = asCount(row[ki]);
    const home = asCount(row[hi]);
    const reasons: string[] = [];
    if (kc === null) reasons.push("K Cellars count can't be read");
    if (home === null) reasons.push("Home count can't be read");
    if (isTextNumber(row[ki])) reasons.push("K Cellars count is stored as text");
    if (isTextNumber(row[hi])) reasons.push("Home count is stored as text");
    // Typed straight into Excel: a Qty number but no bottles in either location.
    const unassigned = typeof qty === "number" && qty > 0 && kc === 0 && home === 0;
    if (typeof qty !== "number") reasons.push("Qty isn't calculating");
    else if (unassigned) reasons.push(`${qty} bottle${qty === 1 ? "" : "s"} not assigned to K Cellars or Home (will go to K Cellars)`);
    else if (kc !== null && home !== null && qty !== kc + home) reasons.push("Qty doesn't match K Cellars + Home");
    if (!reasons.length) return;
    const get = (h: string) => (c(h) >= 0 ? row[c(h)] : "");
    issues.push({
      index,
      wineId: String(get(COLS.id) ?? ""),
      label: [get(COLS.name), get(COLS.vintage)].filter((x) => x !== "" && x !== null).join(" "),
      reasons,
      kc: unassigned ? (qty as number) : kc,
      home,
      kcIsText: unassigned || isTextNumber(row[ki]),
      homeIsText: isTextNumber(row[hi]),
    });
  });
  return issues;
}
