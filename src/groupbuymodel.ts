// Group buys: wines bought in bulk and split with friends. Pure (type-only
// imports), so it can be unit-tested without a browser.
//
// Stored on a "GroupBuys" sheet, one row per person per wine in an order:
// who takes how many, and for each row whether it has arrived with you, been
// paid for and been handed over. Your own share ("Me") also goes into your
// cellar like any purchase; its rows just say where it went.

import type { Cell } from "./data";
import { toIsoDate } from "./historymodel";
import type { Location } from "./locations";

export const GB_COLUMNS = [
  "RowID", "GroupID", "Order Date", "Merchant", "Line", "WineID", "Producer", "Name", "Vintage", "Price",
  "Person", "Bottles", "To", "Arrived", "Arrived Date", "Paid", "Paid Date", "Handed", "Handed Date", "Notes", "Group Name",
] as const;

export const ME = "Me";
export const isMe = (p: string | null | undefined) => (p ?? "").trim().toLowerCase() === "me";

export interface GbRow {
  rowId: string;
  groupId: string;
  /** What you call this group buy, e.g. "Burgundy 2021 release". */
  groupName: string;
  /** "YYYY-MM-DD" */
  date: string | null;
  merchant: string;
  line: number;
  wineId: string | null;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  /** Per bottle, after GST. */
  price: number | null;
  person: string;
  bottles: number;
  /** Where your own share went (only on your rows). */
  to: Location | null;
  arrived: boolean;
  paid: boolean;
  handed: boolean;
}

const str = (v: Cell | undefined): string | null => (v === null || v === undefined ? null : String(v).trim() || null);
const num = (v: Cell | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const yes = (v: Cell | undefined) => /^(yes|y|true|1|✓)$/i.test(String(v ?? "").trim());

export function toGbRow(r: Record<string, Cell>): GbRow {
  const v = r["Vintage"];
  const to = str(r["To"]);
  return {
    rowId: str(r["RowID"]) ?? "",
    groupId: str(r["GroupID"]) ?? "",
    groupName: str(r["Group Name"]) ?? "",
    date: toIsoDate(r["Order Date"]),
    merchant: str(r["Merchant"]) ?? "",
    line: num(r["Line"]) ?? 0,
    wineId: str(r["WineID"]),
    producer: str(r["Producer"]),
    name: str(r["Name"]),
    vintage: typeof v === "string" && v.trim().toUpperCase() === "NV" ? "NV" : num(v) === null ? null : Math.round(num(v)!),
    price: num(r["Price"]),
    person: str(r["Person"]) ?? "",
    bottles: Math.max(0, Math.round(num(r["Bottles"]) ?? 0)),
    to: to === "Home" ? "Home" : to === "K Cellars" ? "K Cellars" : null,
    arrived: yes(r["Arrived"]),
    paid: yes(r["Paid"]),
    handed: yes(r["Handed"]),
  };
}

export interface GbLine {
  line: number;
  wineId: string | null;
  producer: string | null;
  name: string | null;
  vintage: number | "NV" | null;
  price: number | null;
  bottles: number;
  arrived: boolean;
  /** Your bottles of it (0 if none). */
  mine: number;
  /** Where your share went. */
  to: Location | null;
  rows: GbRow[];
}

export interface GbPerson {
  name: string;
  bottles: number;
  /** What they owe for this order (priced bottles only). */
  amount: number;
  /** Some of their bottles have no price. */
  unpriced: boolean;
  paid: boolean;
  /** Bottles handed over / arrived but not yet handed over / still to arrive. */
  handed: number;
  ready: number;
  coming: number;
  rows: GbRow[];
}

export interface GbOrder {
  id: string;
  /** The name you gave it ("" if none). */
  name: string;
  date: string | null;
  merchant: string;
  lines: GbLine[];
  /** Friends (not you). */
  people: GbPerson[];
  me: { bottles: number; amount: number };
  total: number;
  bottles: number;
  arrivedLines: number;
  paidPeople: number;
  handedPeople: number;
  done: boolean;
}

function person(name: string, rows: GbRow[]): GbPerson {
  const amount = rows.reduce((s, r) => s + (r.price ?? 0) * r.bottles, 0);
  return {
    name,
    bottles: rows.reduce((s, r) => s + r.bottles, 0),
    amount: Math.round(amount * 100) / 100,
    unpriced: rows.some((r) => r.price === null && r.bottles > 0),
    paid: rows.length > 0 && rows.every((r) => r.paid || r.bottles === 0),
    handed: rows.filter((r) => r.handed).reduce((s, r) => s + r.bottles, 0),
    ready: rows.filter((r) => r.arrived && !r.handed).reduce((s, r) => s + r.bottles, 0),
    coming: rows.filter((r) => !r.arrived && !r.handed).reduce((s, r) => s + r.bottles, 0),
    rows,
  };
}

export const personKey = (name: string) => name.trim().toLowerCase();

export function groupOrders(rows: GbRow[]): GbOrder[] {
  const byGroup = new Map<string, GbRow[]>();
  for (const r of rows) {
    if (!r.groupId) continue;
    byGroup.set(r.groupId, [...(byGroup.get(r.groupId) ?? []), r]);
  }
  const orders: GbOrder[] = [];
  for (const [id, rs] of byGroup) {
    const lineNos = [...new Set(rs.map((r) => r.line))].sort((a, b) => a - b);
    const lines: GbLine[] = lineNos.map((n) => {
      const lr = rs.filter((r) => r.line === n);
      const first = lr[0];
      const mineRows = lr.filter((r) => isMe(r.person));
      return {
        line: n,
        wineId: lr.find((r) => r.wineId)?.wineId ?? null,
        producer: first.producer,
        name: first.name,
        vintage: first.vintage,
        price: first.price,
        bottles: lr.reduce((s, r) => s + r.bottles, 0),
        arrived: lr.every((r) => r.arrived),
        mine: mineRows.reduce((s, r) => s + r.bottles, 0),
        to: mineRows[0]?.to ?? null,
        rows: lr,
      };
    });
    const names = new Map<string, string>();
    for (const r of rs) if (!isMe(r.person) && !names.has(personKey(r.person))) names.set(personKey(r.person), r.person);
    const people = [...names].map(([k, name]) => person(name, rs.filter((r) => personKey(r.person) === k))).filter((p) => p.bottles > 0);
    const meRows = rs.filter((r) => isMe(r.person));
    const total = Math.round(rs.reduce((s, r) => s + (r.price ?? 0) * r.bottles, 0) * 100) / 100;
    const arrivedLines = lines.filter((l) => l.arrived).length;
    const paidPeople = people.filter((p) => p.paid).length;
    const handedPeople = people.filter((p) => p.handed === p.bottles).length;
    orders.push({
      id,
      name: rs.find((r) => r.groupName)?.groupName ?? "",
      date: rs[0].date,
      merchant: rs[0].merchant,
      lines,
      people: people.sort((a, b) => a.name.localeCompare(b.name)),
      me: { bottles: meRows.reduce((s, r) => s + r.bottles, 0), amount: person(ME, meRows).amount },
      total,
      bottles: rs.reduce((s, r) => s + r.bottles, 0),
      arrivedLines,
      paidPeople,
      handedPeople,
      done: arrivedLines === lines.length && paidPeople === people.length && handedPeople === people.length,
    });
  }
  return orders.sort((a, b) => Number(a.done) - Number(b.done) || (b.date ?? "").localeCompare(a.date ?? "") || b.id.localeCompare(a.id));
}

export interface GbFriend {
  name: string;
  /** Unpaid, across all orders. */
  owes: number;
  /** Bottles not yet handed over, and how many of those are with you now. */
  waiting: number;
  ready: number;
  orders: string[];
}

/** One line per friend across every order: what they owe and what's waiting for them. */
export function friends(orders: GbOrder[]): GbFriend[] {
  const m = new Map<string, GbFriend>();
  for (const o of orders) {
    for (const p of o.people) {
      const k = personKey(p.name);
      const f = m.get(k) ?? { name: p.name, owes: 0, waiting: 0, ready: 0, orders: [] };
      if (!p.paid) f.owes += p.amount;
      f.waiting += p.bottles - p.handed;
      f.ready += p.ready;
      if (!p.paid || p.handed < p.bottles) f.orders.push(o.id);
      m.set(k, f);
    }
  }
  return [...m.values()]
    .map((f) => ({ ...f, owes: Math.round(f.owes * 100) / 100 }))
    .sort((a, b) => Number(b.owes > 0 || b.waiting > 0) - Number(a.owes > 0 || a.waiting > 0) || b.owes - a.owes || a.name.localeCompare(b.name));
}

export function totals(orders: GbOrder[]): { owed: number; waiting: number; ready: number; open: number } {
  const fs = friends(orders);
  return {
    owed: Math.round(fs.reduce((s, f) => s + f.owes, 0) * 100) / 100,
    waiting: fs.reduce((s, f) => s + f.waiting, 0),
    ready: fs.reduce((s, f) => s + f.ready, 0),
    open: orders.filter((o) => !o.done).length,
  };
}

/** Names used before, for suggestions (most used first). */
export function knownPeople(rows: GbRow[]): string[] {
  const n = new Map<string, { name: string; c: number }>();
  for (const r of rows) {
    if (isMe(r.person) || !r.person) continue;
    const k = personKey(r.person);
    n.set(k, { name: n.get(k)?.name ?? r.person, c: (n.get(k)?.c ?? 0) + 1 });
  }
  return [...n.values()].sort((a, b) => b.c - a.c || a.name.localeCompare(b.name)).map((x) => x.name);
}

export function newGroupId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `GB-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** How an order is shown: its name, else the merchant, else "Group buy". */
export const orderTitle = (o: Pick<GbOrder, "name" | "merchant">) => o.name || o.merchant || "Group Buy";