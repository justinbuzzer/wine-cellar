// Sale list writes. The "SaleLists" table (on its own sheet) is created the
// first time you save a list. Every change re-reads the table and finds rows by
// their RowID, like the app's other tables.

import { toTable, type Cell } from "./data";
import { withSession, type Workbook } from "./graph";
import { appendLogs, readLog, removeLogs, type LogSpec } from "./logtable";
import { SL_COLUMNS, toSlRow, type SlRow } from "./salelistmodel";
import { locateById, setCells } from "./tableops";

export const SL_SPEC: LogSpec = {
  table: "SaleLists",
  columns: SL_COLUMNS,
  idHeader: "RowID",
  idPrefix: "L",
  idWidth: 5,
  formats: { "Asking Price": "#,##0.00", Added: "d mmm yyyy" },
  numeric: ["Bottles"],
  what: "sale list",
};

export function readSaleLists(wb: Workbook) {
  return readLog(wb, SL_SPEC.table);
}

async function allRows(wb: Workbook): Promise<SlRow[]> {
  const snap = await readSaleLists(wb);
  return snap ? toTable(snap.values).rows.map(toSlRow).filter((r) => r.rowId && r.listId) : [];
}

export interface SlChange {
  set?: { rowId: string; cells: Record<string, Cell> }[];
  add?: Record<string, Cell>[];
  remove?: string[];
}

/** Changes rows: cells to set, rows to add and rows to remove. Returns every sale list row afterwards. */
export function changeSaleLists(itemId: string, change: SlChange): Promise<SlRow[]> {
  return withSession(itemId, async (wb) => {
    if (change.set?.length) {
      const snap = await readSaleLists(wb);
      if (!snap) throw new Error("The SaleLists table is missing. Reload and try again.");
      for (const s of change.set) await setCells(wb, locateById(snap, "RowID", s.rowId, "sale list row"), s.cells);
    }
    if (change.add?.length) await appendLogs(wb, SL_SPEC, change.add);
    await removeLogs(wb, SL_SPEC, change.remove ?? []);
    return allRows(wb);
  });
}
