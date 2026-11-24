// Group buy writes. The "GroupBuys" table (on its own sheet) is created the first
// time you save a group buy. Every change re-reads the table and finds rows by
// their RowID, like the app's other tables.

import { headersOf, toTable, type Cell } from "./data";
import { withSession, type Workbook } from "./graph";
import { GB_COLUMNS, isMe, toGbRow, type GbRow } from "./groupbuymodel";
import { appendLogs, readLog, removeLog, type LogSpec } from "./logtable";
import { excelSerial, todayIso } from "./notesmodel";
import { locateById, setCells } from "./tableops";

export const GB_SPEC: LogSpec = {
  table: "GroupBuys",
  columns: GB_COLUMNS,
  idHeader: "RowID",
  idPrefix: "G",
  idWidth: 5,
  formats: { "Order Date": "d mmm yyyy", "Arrived Date": "d mmm yyyy", "Paid Date": "d mmm yyyy", "Handed Date": "d mmm yyyy", Price: "#,##0.00" },
  numeric: ["Line", "Bottles"],
  what: "Group Buy",
};

export async function readGroupBuys(wb: Workbook) {
  return readLog(wb, GB_SPEC.table);
}

async function allRows(wb: Workbook): Promise<GbRow[]> {
  const snap = await readGroupBuys(wb);
  return snap ? toTable(snap.values).rows.map(toGbRow).filter((r) => r.rowId && r.groupId) : [];
}

export const today = () => excelSerial(todayIso());

/** Adds columns introduced after the table was made (e.g. "Group Name") at its end. */
async function withAllColumns(wb: Workbook): Promise<void> {
  const snap = await readGroupBuys(wb);
  if (!snap) return;
  const headers = headersOf(snap.values[0]);
  for (const c of GB_COLUMNS) {
    if (headers.includes(c)) continue;
    await wb.addTableColumn(GB_SPEC.table, [[c], ...snap.values.slice(1).map(() => [""])]);
    headers.push(c);
  }
}

/** Records a new group buy (one row per person per wine). Returns every group buy row. */
export function addGroupBuy(itemId: string, rows: Record<string, Cell>[]): Promise<GbRow[]> {
  return withSession(itemId, async (wb) => {
    await withAllColumns(wb);
    await appendLogs(wb, GB_SPEC, rows);
    return allRows(wb);
  });
}

/**
 * Changes rows: cells to set on existing rows, rows to add and rows to remove.
 * Returns every group buy row afterwards.
 */
export function changeGroupBuy(
  itemId: string,
  change: { set?: { rowId: string; cells: Record<string, Cell> }[]; add?: Record<string, Cell>[]; remove?: string[] },
): Promise<GbRow[]> {
  return withSession(itemId, async (wb) => {
    await withAllColumns(wb);
    if (change.set?.length) {
      const snap = await readGroupBuys(wb);
      if (!snap) throw new Error("The GroupBuys table is missing. Reload and try again.");
      for (const s of change.set) await setCells(wb, locateById(snap, "RowID", s.rowId, "Group Buy row"), s.cells);
    }
    if (change.add?.length) await appendLogs(wb, GB_SPEC, change.add);
    for (const id of change.remove ?? []) await removeLog(wb, GB_SPEC, id);
    return allRows(wb);
  });
}

/**
 * Wines marked arrived in the cellar: tick the Group Buy lines with your share of
 * them as arrived too (the whole line, since an order's bottles come together).
 * Returns every group buy row, or null when no line needed it.
 */
export function arriveGroupBuyWines(itemId: string, wineIds: string[]): Promise<GbRow[] | null> {
  return withSession(itemId, async (wb) => {
    const all = await allRows(wb);
    const want = new Set(wineIds);
    const lineOf = (r: GbRow) => `${r.groupId}#${r.line}`;
    const lines = new Set(all.filter((r) => isMe(r.person) && r.bottles > 0 && !r.arrived && r.wineId && want.has(r.wineId)).map(lineOf));
    if (!lines.size) return null;
    const snap = await readGroupBuys(wb);
    if (!snap) return null;
    const d = today();
    for (const r of all) {
      if (lines.has(lineOf(r)) && !r.arrived) await setCells(wb, locateById(snap, "RowID", r.rowId, "Group Buy row"), { Arrived: "Yes", "Arrived Date": d });
    }
    return allRows(wb);
  });
}
