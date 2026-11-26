// Unfinished tasting notes, kept on their own "Drafts" sheet (created
// automatically the first time) so they never mix with finished notes in the
// Tasted table. Same columns as Tasted, plus DraftID and when it was saved.

import { config } from "./config";
import { TASTING_COLUMNS, toTasting, type Cell, type Tasting } from "./data";
import { withSession, type TableSnapshot, type Workbook } from "./graph";
import { appendLog, readLog, removeLog, type LogSpec } from "./logtable";
import { ensureColumns, fillsAny, locateById, setCells } from "./tableops";
import { BLIND_COLUMNS } from "./blindmodel";

const NOTE_COLUMNS = TASTING_COLUMNS.filter((c) => c !== "TastingID" && c !== "Age Tasted");

export const DRAFT_COLUMNS = ["DraftID", "Saved", ...NOTE_COLUMNS, ...BLIND_COLUMNS] as const;

const SPEC: LogSpec = {
  table: config.tables.drafts,
  columns: DRAFT_COLUMNS,
  idHeader: "DraftID",
  idPrefix: "D",
  idWidth: 4,
  formats: { Saved: "d mmm yyyy h:mm", "Date Tasted": "d mmm yyyy", "Alcohol %": "0.0%" },
  numeric: ["Score", "Year Tasted"],
  what: "draft notes",
};

export interface Draft {
  draftId: string;
  /** When it was last saved (ms since 1970), or null if unknown. */
  saved: number | null;
  /** The note so far (tastingId is always null). */
  note: Tasting;
}

const DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

/** Now, as an Excel date-time in local time. */
function nowSerial(): number {
  const d = new Date();
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
  return (local - EPOCH) / DAY;
}

function fromSerial(v: Cell | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const u = new Date(EPOCH + Math.round(v * DAY));
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes()).getTime();
}

export function toDraft(r: Record<string, Cell>): Draft {
  return {
    draftId: String(r["DraftID"] ?? "").trim(),
    saved: fromSerial(r["Saved"] ?? undefined),
    note: { ...toTasting(r), tastingId: null },
  };
}

export function readDrafts(wb: Workbook): Promise<TableSnapshot | null> {
  return readLog(wb, SPEC.table);
}

/** Only the columns a draft keeps. */
function draftCells(fields: Record<string, Cell>): Record<string, Cell> {
  const out: Record<string, Cell> = { Saved: nowSerial() };
  for (const c of NOTE_COLUMNS) out[c] = fields[c] ?? "";
  for (const c of BLIND_COLUMNS) out[c] = fields[c] ?? "";
  return out;
}

export function addDraft(itemId: string, fields: Record<string, Cell>): Promise<Draft> {
  return withSession(itemId, async (wb) => {
    const cells = draftCells(fields);
    // A blind draft's flag and guesses need their columns (added the first time).
    const snap = fillsAny(cells, BLIND_COLUMNS) ? await readLog(wb, SPEC.table) : null;
    if (snap) await ensureColumns(wb, SPEC.table, snap, BLIND_COLUMNS);
    return toDraft(await appendLog(wb, SPEC, cells));
  });
}

export function updateDraft(itemId: string, draftId: string, fields: Record<string, Cell>): Promise<Draft> {
  return withSession(itemId, async (wb) => {
    let snap = await readLog(wb, SPEC.table);
    if (!snap) throw new Error(`Draft ${draftId} is no longer in the spreadsheet. Reload and try again.`);
    if (fillsAny(draftCells(fields), BLIND_COLUMNS)) snap = await ensureColumns(wb, SPEC.table, snap, BLIND_COLUMNS);
    const at = locateById(snap, SPEC.idHeader, draftId, "Draft");
    // Only columns the sheet has (someone may have removed one in Excel).
    const cells = Object.fromEntries(Object.entries(draftCells(fields)).filter(([h]) => at.headers.includes(h)));
    await setCells(wb, at, cells);
    const rec: Record<string, Cell> = {};
    at.headers.forEach((h, i) => (rec[h] = at.row[i] === "" ? null : at.row[i]));
    return toDraft(rec);
  });
}

export function deleteDraft(itemId: string, draftId: string): Promise<void> {
  return withSession(itemId, (wb) => removeLog(wb, SPEC, draftId));
}

/** Deletes several drafts in one go, calling `done` after each, so a failure part-way still reports what went. */
export function deleteDrafts(itemId: string, draftIds: string[], done: (id: string) => void): Promise<void> {
  return withSession(itemId, async (wb) => {
    for (const id of draftIds) {
      await removeLog(wb, SPEC, id);
      done(id);
    }
  });
}

/** Newest first. */
export function newestDrafts(xs: Draft[]): Draft[] {
  return [...xs].sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0) || b.draftId.localeCompare(a.draftId));
}

/** "21 Nov, 9:42 pm" */
export function formatSaved(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
