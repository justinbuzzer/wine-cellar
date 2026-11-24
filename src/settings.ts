// App settings kept in the workbook (so every device sees the same), in a small
// two-column table — Setting / Value — on its own "App Settings" sheet, created
// the first time you save. You can also change the values there in Excel.

import { headersOf, type Cell } from "./data";
import { withSession, type TableSnapshot, type Workbook } from "./graph";
import { readLog } from "./logtable";
import { cellAddress } from "./sheet";
import { layoutRows, type Layout } from "./spots";
import { prefsRows, type AppPrefs } from "./prefs";

export const SETTINGS_SHEET = "App Settings";
export const SETTINGS_TABLE = "AppSettings";

export function readSettings(wb: Workbook): Promise<TableSnapshot | null> {
  return readLog(wb, SETTINGS_TABLE);
}

/** Saves the storage layout (adds the sheet and table the first time). */
export function saveLayout(itemId: string, layout: Layout): Promise<void> {
  return saveSettings(itemId, layoutRows(layout));
}

/** Saves the purchase defaults and stocktake reminder. */
export function savePrefs(itemId: string, prefs: AppPrefs): Promise<void> {
  return saveSettings(itemId, prefsRows(prefs));
}

/** Writes Setting / Value rows: changed values in place, new settings added (the sheet and table the first time). */
function saveSettings(itemId: string, rows: [string, Cell][]): Promise<void> {
  return withSession(itemId, async (wb) => {
    const snap = await readSettings(wb);
    if (!snap) {
      try {
        await wb.addWorksheet(SETTINGS_SHEET);
      } catch (e) {
        throw new Error(
          `Couldn't add an "${SETTINGS_SHEET}" sheet for the settings. If a sheet with that name already exists, rename it and try again. (${e instanceof Error ? e.message : e})`,
        );
      }
      const values: Cell[][] = [["Setting", "Value"], ...rows];
      const range = `A1:B${values.length}`;
      await wb.writeValues(SETTINGS_SHEET, range, values);
      await wb.addTable(SETTINGS_SHEET, range, SETTINGS_TABLE);
      return;
    }
    const headers = headersOf(snap.values[0]);
    const k = headers.indexOf("Setting");
    const v = headers.indexOf("Value");
    if (k < 0 || v < 0) throw new Error(`The ${SETTINGS_TABLE} table needs "Setting" and "Value" columns.`);
    const missing: Cell[][] = [];
    for (const [key, value] of rows) {
      const i = snap.values.findIndex((r, n) => n > 0 && String(r[k] ?? "").trim().toLowerCase() === key.toLowerCase());
      if (i < 0) {
        missing.push(headers.map((_, c) => (c === k ? key : c === v ? value : "")));
      } else if (String(snap.values[i][v] ?? "") !== String(value ?? "")) {
        await wb.writeCell(snap.address.sheet, cellAddress(snap.address.firstCol + v, snap.address.firstRow + i), value);
      }
    }
    await wb.addRows(SETTINGS_TABLE, missing);
  });
}
