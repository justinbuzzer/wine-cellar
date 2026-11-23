// Sale lists: named lists of wines you're offering, with how many bottles and
// an asking price each. One row per wine per list in the "SaleLists" table;
// the list's name and note are repeated on each of its rows. Pure (type-only
// imports apart from date parsing), so it can be unit-tested.

import type { Cell, Wine } from "./data";
import { toIsoDate } from "./historymodel";

export const SL_COLUMNS = [
  "RowID", "ListID", "List Name", "List Note", "WineID", "Producer", "Name", "Vintage", "Bottles", "Asking Price", "Added",
] as const;

export interface SlRow {
  rowId: string;
  listId: string;
  listName: string;
  listNote: string;
  wineId: string;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  /** Bottles offered when last saved (never more than you have now: see `offered`). */
  bottles: number;
  asking: number | null;
  /** "YYYY-MM-DD" added to the list. */
  added: string | null;
}

const str = (v: Cell | undefined): string | null => (v === null || v === undefined ? null : String(v).trim() || null);
const num = (v: Cell | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function toSlRow(r: Record<string, Cell>): SlRow {
  const v = r["Vintage"];
  return {
    rowId: str(r["RowID"] ?? null) ?? "",
    listId: str(r["ListID"] ?? null) ?? "",
    listName: str(r["List Name"] ?? null) ?? "",
    listNote: str(r["List Note"] ?? null) ?? "",
    wineId: str(r["WineID"] ?? null) ?? "",
    producer: str(r["Producer"] ?? null),
    name: str(r["Name"] ?? null),
    vintage: typeof v === "string" && v.trim().toUpperCase() === "NV" ? "NV" : num(v) === null ? null : Math.round(num(v)!),
    bottles: Math.max(0, Math.round(num(r["Bottles"] ?? null) ?? 0)),
    asking: num(r["Asking Price"] ?? null),
    added: toIsoDate(r["Added"] ?? null),
  };
}

/** Bottles you can still offer: what the list says, but never more than you have (not-yet-arrived bottles count). */
export function offered(row: Pick<SlRow, "bottles">, wine: Pick<Wine, "qty"> | undefined): number {
  return Math.max(0, Math.min(row.bottles, wine?.qty ?? 0));
}

export interface SaleList {
  id: string;
  name: string;
  note: string;
  rows: SlRow[];
  /** Newest "added" date on the list. */
  updated: string | null;
}

/** Rows grouped into lists, most recently added to first. */
export function saleLists(rows: SlRow[]): SaleList[] {
  const m = new Map<string, SaleList>();
  for (const r of rows) {
    if (!r.listId) continue;
    const l = m.get(r.listId) ?? { id: r.listId, name: r.listName, note: r.listNote, rows: [], updated: null };
    l.rows.push(r);
    if (r.listName && !l.name) l.name = r.listName;
    if (r.listNote && !l.note) l.note = r.listNote;
    if (r.added && (!l.updated || r.added > l.updated)) l.updated = r.added;
    m.set(r.listId, l);
  }
  return [...m.values()].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "") || b.id.localeCompare(a.id));
}

export const listTitle = (l: Pick<SaleList, "name">) => l.name || "Sale list";

export interface ListTotals {
  wines: number;
  bottles: number;
  /** Asking total of priced bottles. */
  asking: number;
  /** What those priced bottles cost you (only where the purchase price is known). */
  paid: number;
  /** Asking total of the bottles whose purchase price is known (to compare with `paid`). */
  askingKnown: number;
  unpriced: number;
  soldOut: number;
}

export function listTotals(lines: { bottles: number; asking: number | null; paid: number | null }[]): ListTotals {
  const t: ListTotals = { wines: 0, bottles: 0, asking: 0, paid: 0, askingKnown: 0, unpriced: 0, soldOut: 0 };
  for (const l of lines) {
    if (l.bottles <= 0) {
      t.soldOut++;
      continue;
    }
    t.wines++;
    t.bottles += l.bottles;
    if (l.asking === null) {
      t.unpriced += l.bottles;
      continue;
    }
    t.asking += l.asking * l.bottles;
    if (l.paid !== null) {
      t.paid += l.paid * l.bottles;
      t.askingKnown += l.asking * l.bottles;
    }
  }
  return t;
}

export const ROUND_TO = [1, 5, 10, 50] as const;

/** Asking price from what you paid: plus `pct` %, rounded to the nearest `to`. */
export function priceFromRule(paid: number | null, pct: number, to: number): number | null {
  if (paid === null || !Number.isFinite(pct)) return null;
  const raw = paid * (1 + pct / 100);
  const r = Math.max(1, to);
  return Math.max(r, Math.round(raw / r) * r);
}

/** "SL-20261123-1405" */
export function newListId(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `SL-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
