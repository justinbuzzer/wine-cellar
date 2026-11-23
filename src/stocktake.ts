// Stocktake storage and workbook writes.
//
// Saving while you count: every tap is saved on this device straight away
// (localStorage), and copied to a "Stocktake Count" sheet in the workbook in
// batches — after 20 unsaved taps, 15 seconds after the first unsaved tap, or
// when the app goes into the background. So taps stay instant, and progress
// survives a lost phone or can be picked up on another device.
//
// Applying: the plan (stocktakemodel.ts) is kept with the stocktake, so if the
// connection drops halfway, "Try again" finishes the same plan: inventory cells
// already at their new value are skipped, and log rows already written (found by
// the stocktake's ID) aren't added twice. The Stocktake log is written first, so
// anything changed in the inventory can always be undone from it.

import { useSyncExternalStore } from "react";
import { config } from "./config";
import { headersOf, toTable, toWine, type Cell, type Wine } from "./data";
import { GraphError, withSession, Workbook, type TableSnapshot } from "./graph";
import { OPENED_SPEC } from "./history";
import { countCells, SPOT_COLUMN, withSpotColumns } from "./inventory";
import { clearBox, recordBox, type BoxCheck } from "./boxcount";
import { changeSpots, type Layout } from "./spots";
import { LOCATION_COLUMN, type Location } from "./locations";
import { appendLogs, readLog, removeLog, type LogSpec } from "./logtable";
import { excelSerial } from "./notesmodel";
import { SOLD_SPEC } from "./sales";
import { lastBoughtYear, toSale } from "./salesmodel";
import { locateById, setCells } from "./tableops";
import { isNya, keyOf, parseKey, type Choice, type CountEntry, type Plan, type Stocktake } from "./stocktakemodel";

// ---- On this device -------------------------------------------------------------

const LOCAL_KEY = `wine-cellar.stocktake.${import.meta.env.MODE}`;

function loadLocal(): Stocktake | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const st = raw ? (JSON.parse(raw) as Stocktake) : null;
    return st && st.id && st.counts ? { ...st, choices: st.choices ?? {}, plan: st.plan ?? null, boxes: st.boxes ?? {}, base: st.base ?? {} } : null;
  } catch {
    return null;
  }
}

function saveLocal(st: Stocktake | null) {
  try {
    if (st) localStorage.setItem(LOCAL_KEY, JSON.stringify(st));
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* storage full or blocked: the workbook copy still has it */
  }
}

// ---- Shared state (one stocktake at a time) ---------------------------------------

export type SyncState =
  | { state: "idle"; at: number | null }
  | { state: "pending" }
  | { state: "saving" }
  | { state: "failed"; message: string };

let current: Stocktake | null = loadLocal();
let sync: SyncState = { state: "idle", at: null };
let unsaved = 0;
let timer: number | undefined;
let itemId: string | null = null;
/** Rows written to the sheet last time, so leftovers can be cleared (−1 = not known yet). */
let sheetRows = -1;
/** Bumped when a stocktake starts or ends, so a slow read can't bring back an old one. */
let generation = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStocktake(): Stocktake | null {
  return useSyncExternalStore(subscribe, () => current);
}

export function useStocktakeSync(): SyncState {
  return useSyncExternalStore(subscribe, () => sync);
}

function setSync(s: SyncState) {
  sync = s;
  emit();
}

/** Replace the stocktake (null = none) and save it on this device. */
function replace(st: Stocktake | null) {
  current = st;
  saveLocal(st);
  emit();
}

/** Change the stocktake in progress; saved here at once, copied to the workbook in batches. */
export function updateStocktake(file: string, fn: (st: Stocktake) => Stocktake) {
  if (!current) return;
  itemId = file;
  replace({ ...fn(current), updated: Date.now() });
  unsaved++;
  if (unsaved >= 20) void flush();
  else {
    if (sync.state !== "saving") setSync({ state: "pending" });
    if (timer === undefined) timer = window.setTimeout(() => void flush(), 15_000);
  }
}

export function startStocktake(file: string, st: Stocktake) {
  generation++;
  itemId = file;
  sheetRows = -1;
  replace(st);
  unsaved = 1;
  void flush();
}

export function setCount(file: string, loc: Location, wineId: string, entry: CountEntry | null) {
  updateStocktake(file, (st) => {
    const counts = { ...st.counts };
    const k = keyOf(loc, wineId);
    if (entry) counts[k] = entry;
    else delete counts[k];
    return { ...st, counts };
  });
}

export function setChoice(file: string, key: string, c: Choice) {
  updateStocktake(file, (st) => ({ ...st, choices: { ...st.choices, [key]: c } }));
}

/** Saves a box's count (draft or done). */
export function setBox(file: string, wines: Wine[], layout: Layout, loc: Location, spot: string, check: BoxCheck) {
  updateStocktake(file, (st) => recordBox(st, wines, layout, loc, spot, check));
}

/** Forgets a box's count so it can be counted again. */
export function resetBox(file: string, loc: Location, spot: string) {
  updateStocktake(file, (st) => clearBox(st, loc, spot));
}

// Save when the app is put in the background (phone locked, switched app).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && unsaved > 0) void flush();
  });
}

// ---- The progress sheet in the workbook -------------------------------------------

export const PROGRESS_SHEET = "Stocktake Count";
const PROGRESS_HEADERS = ["StocktakeID", "Started", "Saved", "Location", "WineID", "Expected", "Counted", "Counted At", "Reason", "Sale Price", "Kind", "Data"];
/** Box counts are kept as JSON split over cells (Excel allows ~32,000 characters per cell). */
const CHUNK = 30000;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: Cell) => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : 0;
};

function progressRows(st: Stocktake): Cell[][] {
  const keys = new Set([...Object.keys(st.counts), ...Object.keys(st.choices)]);
  const rows: Cell[][] = [];
  for (const k of [...keys].sort()) {
    const { loc, wineId } = parseKey(k);
    const e = st.counts[k];
    const c = st.choices[k];
    rows.push([
      st.id, iso(st.started), iso(st.updated), loc, wineId,
      e ? e.expected : "", e ? e.counted : "", e ? iso(e.at) : "",
      c?.reason ?? "", c?.price ?? "", "", "",
    ]);
  }
  if (st.boxes && Object.keys(st.boxes).length) {
    const json = JSON.stringify({ boxes: st.boxes, base: st.base ?? {} });
    for (let i = 0; i * CHUNK < json.length; i++) {
      // A leading letter keeps Excel from reading a chunk as a number or formula.
      rows.push([st.id, iso(st.started), iso(st.updated), "", "", "", "", "", "", "", "boxes", `J${json.slice(i * CHUNK, (i + 1) * CHUNK)}`]);
    }
  }
  return rows;
}

function lastCol(n: number) {
  return String.fromCharCode(64 + n);
}

async function writeProgress(file: string, st: Stocktake): Promise<void> {
  await withSession(file, async (wb) => {
    const rows = [PROGRESS_HEADERS, ...progressRows(st)];
    const end = lastCol(PROGRESS_HEADERS.length);
    const address = `A1:${end}${rows.length}`;
    try {
      // Rows from an earlier, longer save (a wine un-ticked) or an unknown earlier
      // save (app reopened) are cleared first so they can't come back.
      if (sheetRows < 0 || sheetRows > rows.length) await wb.clearRange(PROGRESS_SHEET, `A1:${end}${Math.max(sheetRows, 2000)}`);
      await wb.writeValues(PROGRESS_SHEET, address, rows);
    } catch (e) {
      if (!(e instanceof GraphError && (e.status === 404 || /notfound/i.test(e.code)))) throw e;
      // The sheet doesn't exist yet (first save): add it and write again.
      await wb.addWorksheet(PROGRESS_SHEET);
      await wb.writeValues(PROGRESS_SHEET, address, rows);
    }
    sheetRows = rows.length;
  });
}

let flushing: Promise<void> | null = null;

/** Copy the stocktake to the workbook now (no-op if nothing changed). */
export async function flush(): Promise<void> {
  window.clearTimeout(timer);
  timer = undefined;
  if (flushing) {
    await flushing;
    if (unsaved === 0) return;
  }
  if (!current || !itemId || unsaved === 0) return;
  const st = current;
  const pendingBefore = unsaved;
  setSync({ state: "saving" });
  flushing = (async () => {
    try {
      await writeProgress(itemId!, st);
      unsaved = Math.max(0, unsaved - pendingBefore);
      setSync(unsaved ? { state: "pending" } : { state: "idle", at: Date.now() });
    } catch (e) {
      setSync({ state: "failed", message: e instanceof Error ? e.message : String(e) });
      // Try again later; the taps are safe on this device meanwhile.
      if (timer === undefined) timer = window.setTimeout(() => void flush(), 30_000);
    } finally {
      flushing = null;
    }
  })();
  await flushing;
  if (unsaved > 0 && sync.state !== "failed" && timer === undefined) timer = window.setTimeout(() => void flush(), 15_000);
}

/** Reads a stocktake saved in the workbook (e.g. started on another device). */
export async function readSavedProgress(file: string): Promise<Stocktake | null> {
  const values = await Workbook.reader(file).readUsedRange(PROGRESS_SHEET);
  if (!values || values.length < 2) return null;
  const t = toTable(values);
  const rows = t.rows.filter((r) => r["StocktakeID"]);
  if (!rows.length) return null;
  const id = String(rows[0]["StocktakeID"]);
  const st: Stocktake = { id, started: ms(rows[0]["Started"]), updated: ms(rows[0]["Saved"]), counts: {}, choices: {}, plan: null };
  let json = "";
  for (const r of rows) {
    if (String(r["StocktakeID"]) !== id) continue;
    if (r["Kind"] === "boxes") {
      json += String(r["Data"] ?? "").slice(1);
      continue;
    }
    const k = keyOf(String(r["Location"]) as Location, String(r["WineID"]));
    if (r["Counted"] !== null && r["Counted"] !== "") {
      st.counts[k] = { expected: Number(r["Expected"]) || 0, counted: Number(r["Counted"]) || 0, at: ms(r["Counted At"]) };
    }
    if (r["Reason"]) st.choices[k] = { reason: String(r["Reason"]) as Choice["reason"], price: String(r["Sale Price"] ?? "") };
  }
  if (json) {
    try {
      const d = JSON.parse(json) as { boxes: Stocktake["boxes"]; base: Stocktake["base"] };
      st.boxes = d.boxes;
      st.base = d.base;
    } catch {
      /* unreadable box data: the counts by wine still load */
    }
  }
  sheetRows = values.length;
  return st;
}

/**
 * On opening the stocktake page: if the workbook holds newer progress than this
 * device (another phone), switch to it. Returns true if it did.
 */
export async function pickUpSaved(file: string): Promise<boolean> {
  const gen = generation;
  const saved = await readSavedProgress(file);
  // Started, discarded or applied while reading: what you just did wins.
  if (!saved || gen !== generation) return false;
  if (current && (current.plan || current.updated >= saved.updated)) return false;
  itemId = file;
  unsaved = 0;
  replace(saved);
  setSync({ state: "idle", at: saved.updated });
  return true;
}

/** Drop the stocktake on this device and remove its progress sheet. */
export async function endStocktake(file: string): Promise<void> {
  generation++;
  window.clearTimeout(timer);
  timer = undefined;
  unsaved = 0;
  if (flushing) await flushing.catch(() => {});
  replace(null);
  setSync({ state: "idle", at: null });
  sheetRows = -1;
  await withSession(file, (wb) => wb.deleteWorksheet(PROGRESS_SHEET));
}

export function savePlan(plan: Plan | null) {
  if (!current) return;
  replace({ ...current, plan });
}

// ---- The Stocktake log ------------------------------------------------------------

export const STOCKTAKE_SPEC: LogSpec = {
  table: "Stocktake",
  columns: [
    "AdjustID", "StocktakeID", "Date", "WineID", "Producer", "Name", "Vintage", "Location",
    "Expected", "Counted", "Before", "After", "Change", "Reason",
  ],
  idHeader: "AdjustID",
  idPrefix: "A",
  idWidth: 5,
  formats: { Date: "d mmm yyyy" },
  what: "stocktake record",
};

/** StocktakeID on rows for bottles removed from a wine page (corrections.ts): not a stocktake. */
export const CORRECTION_ID = "Correction";

/** Marks rows written by a stocktake in the Opened and Sold tables. */
export const tagFor = (id: string) => `[${id}]`;

const str = (v: Cell | undefined) => String(v ?? "").trim();
const n = (v: Cell | undefined) => (typeof v === "number" ? v : Number(v) || 0);

export interface ApplyResult {
  /** Wines changed. */
  changed: number;
  /** Changes skipped because the spreadsheet changed in the meantime. */
  skipped: string[];
}

function rowsOf(snap: TableSnapshot | null) {
  return snap ? toTable(snap.values).rows : [];
}

/**
 * Carries out a plan. Safe to run again after a failure: nothing is written twice.
 * Order: Stocktake log, then bottle counts, then Opened and Sold.
 */
export function applyPlan(file: string, st: Stocktake, plan: Plan, onStep: (text: string) => void): Promise<ApplyResult> {
  const tag = tagFor(st.id);
  const date = excelSerial(plan.date);
  return withSession(file, async (wb) => {
    onStep("Reading your cellar…");
    const inv = await wb.readTable(config.tables.inventory);
    const headers = headersOf(inv.values[0]);
    const wineOf = (wineId: string): Wine | null => {
      const row = inv.values.find((r, i) => i > 0 && str(r[headers.indexOf("WineID")]) === wineId);
      return row ? toWine(Object.fromEntries(headers.map((h, i) => [h, row[i] === "" ? null : row[i]]))) : null;
    };

    // 1. Stocktake log (skipping rows a previous attempt already wrote).
    onStep("Recording the changes…");
    const done = new Set(
      rowsOf(await readLog(wb, STOCKTAKE_SPEC.table))
        .filter((r) => str(r["StocktakeID"]) === st.id)
        .map((r) => `${str(r["WineID"])}|${str(r["Location"])}`),
    );
    const logRows: Record<string, Cell>[] = [];
    for (const p of plan.wines) {
      const w = wineOf(p.wineId);
      for (const l of p.logs) {
        if (done.has(`${l.wineId}|${l.loc}`)) continue;
        logRows.push({
          StocktakeID: st.id, Date: date, WineID: p.wineId,
          Producer: w?.producer ?? "", Name: w?.name ?? "", Vintage: w?.vintage ?? "",
          Location: l.loc, Expected: l.expected ?? "", Counted: l.counted ?? "",
          Before: l.before, After: l.after, Change: l.after - l.before, Reason: l.reason,
        });
      }
    }
    await appendLogs(wb, STOCKTAKE_SPEC, logRows);

    // 2. Bottle counts (and "arrived"), and box lists from a box-by-box count.
    if (plan.wines.some((p) => p.spotText)) {
      const withCols = await withSpotColumns(wb, inv);
      inv.values = withCols.values;
      inv.address = withCols.address;
    }
    const skipped: string[] = [];
    let changed = 0;
    let i = 0;
    for (const p of plan.wines) {
      i++;
      onStep(`Updating bottle counts (${i} of ${plan.wines.length})…`);
      let at;
      try {
        at = locateById(inv, "WineID", p.wineId, "Wine");
      } catch {
        skipped.push(`${p.label}: no longer in the spreadsheet`);
        continue;
      }
      const changes: Record<string, Cell> = {};
      for (const [loc, target] of Object.entries(p.set) as [Location, number][]) {
        const col = LOCATION_COLUMN[loc];
        const now = n(at.row[at.col(col)]);
        if (now === target) continue; // already done
        if (now !== (p.before[loc] ?? 0)) {
          skipped.push(`${p.label} at ${loc}: now ${now}, expected ${p.before[loc] ?? 0}; left as it is`);
          continue;
        }
        // Boxes/racks follow along: missing bottles come off the not-placed ones first.
        Object.assign(changes, countCells(at, loc, target));
      }
      for (const [loc, pl] of Object.entries(p.spotText ?? {}) as [Location, { text: string; counted: number }][]) {
        const col = SPOT_COLUMN[loc];
        if (!at.headers.includes(col)) continue;
        // Bottles opened or sold since the box was counted come off the list too.
        const total = typeof changes[LOCATION_COLUMN[loc]] === "number" ? (changes[LOCATION_COLUMN[loc]] as number) : n(at.row[at.col(LOCATION_COLUMN[loc])]);
        changes[col] = total === pl.counted ? pl.text : changeSpots(pl.text, pl.counted, total);
      }
      if (p.clearNya && at.headers.includes("Status") && isNya({ status: str(at.row[at.col("Status")]) })) changes["Status"] = "";
      if (Object.keys(changes).length) {
        await setCells(wb, at, changes);
        changed++;
      }
    }

    // 3. Opened (bottles drunk; no date, since when isn't known).
    const drunk = plan.wines.flatMap((p) => p.drunk.map((d) => ({ p, ...d })));
    if (drunk.length) {
      onStep("Adding drunk bottles to your history…");
      const have = rowsOf(await readLog(wb, OPENED_SPEC.table)).filter((r) => str(r["Occasion"]).includes(tag));
      const rows: Record<string, Cell>[] = [];
      for (const d of drunk) {
        const already = have.filter((r) => str(r["WineID"]) === d.p.wineId && str(r["From"]) === d.loc).length;
        const w = wineOf(d.p.wineId);
        for (let k = already; k < d.n; k++) {
          rows.push({
            "Date Opened": "", WineID: d.p.wineId, Producer: w?.producer ?? "", Name: w?.name ?? "", Vintage: w?.vintage ?? "",
            Type: w?.type ?? "", From: d.loc, Price: w?.price ?? "", Occasion: `Missing at stocktake ${tag}`,
          });
        }
      }
      await appendLogs(wb, OPENED_SPEC, rows);
    }

    // 4. Sold (date unknown; price if you gave one).
    const sold = plan.wines.flatMap((p) => p.sold.map((s) => ({ p, ...s })));
    if (sold.length) {
      onStep("Adding sold bottles to your sales…");
      const salesRows = rowsOf(await readLog(wb, SOLD_SPEC.table));
      const have = salesRows.filter((r) => str(r["Notes"]).includes(tag));
      const sales = salesRows.map(toSale);
      const rows: Record<string, Cell>[] = [];
      for (const s of sold) {
        if (have.some((r) => str(r["WineID"]) === s.p.wineId && str(r["From"]) === s.loc)) continue;
        const w = wineOf(s.p.wineId);
        rows.push({
          "Date Sold": "", WineID: s.p.wineId, Producer: w?.producer ?? "", Name: w?.name ?? "", Vintage: w?.vintage ?? "",
          Type: w?.type ?? "", From: s.loc, Bottles: s.n, "Bought Price": w?.price ?? "", "Sale Price": s.price ?? "",
          "Year Bought": w?.yearPurchased ?? lastBoughtYear(sales, s.p.wineId) ?? "", Buyer: "", Notes: `Found sold at stocktake ${tag}`,
        });
      }
      await appendLogs(wb, SOLD_SPEC, rows);
    }
    return { changed, skipped };
  });
}

// ---- Past stocktakes and undo -----------------------------------------------------

export interface PastStocktake {
  id: string;
  /** "YYYY-MM-DD" */
  date: string | null;
  wines: number;
  /** Net change in bottles. */
  net: number;
  rows: number;
}

export async function readPastStocktakes(file: string): Promise<PastStocktake[]> {
  const snap = await readLog(Workbook.reader(file), STOCKTAKE_SPEC.table);
  const groups = new Map<string, PastStocktake & { ids: Set<string> }>();
  for (const r of rowsOf(snap)) {
    const id = str(r["StocktakeID"]);
    if (!id || id === CORRECTION_ID) continue;
    let g = groups.get(id);
    if (!g) {
      const d = r["Date"];
      const date = typeof d === "number" ? new Date(Date.UTC(1899, 11, 30) + d * 86400000).toISOString().slice(0, 10) : null;
      g = { id, date, wines: 0, net: 0, rows: 0, ids: new Set() };
      groups.set(id, g);
    }
    g.rows++;
    g.net += n(r["Change"]);
    g.ids.add(str(r["WineID"]));
    g.wines = g.ids.size;
  }
  return [...groups.values()].map(({ ids: _ids, ...g }) => g).sort((a, b) => b.id.localeCompare(a.id));
}

export interface UndoResult {
  reverted: number;
  skipped: string[];
}

/**
 * Puts the bottle counts back to what they were before the stocktake (only where
 * they haven't changed since), and removes the rows it added to Opened, Sold and
 * the Stocktake log.
 */
export function undoStocktake(file: string, id: string): Promise<UndoResult> {
  const tag = tagFor(id);
  return withSession(file, async (wb) => {
    const log = await readLog(wb, STOCKTAKE_SPEC.table);
    const rows = rowsOf(log).filter((r) => str(r["StocktakeID"]) === id);
    const inv = await wb.readTable(config.tables.inventory);
    const skipped: string[] = [];
    let reverted = 0;
    for (const r of rows) {
      const wineId = str(r["WineID"]);
      const loc = str(r["Location"]) as Location;
      const label = [str(r["Producer"]), str(r["Name"]), str(r["Vintage"])].filter(Boolean).join(" ") || wineId;
      let at;
      try {
        at = locateById(inv, "WineID", wineId, "Wine");
      } catch {
        skipped.push(`${label}: no longer in the spreadsheet`);
        continue;
      }
      const changes: Record<string, Cell> = {};
      const col = LOCATION_COLUMN[loc];
      if (col && at.headers.includes(col)) {
        const now = n(at.row[at.col(col)]);
        const after = n(r["After"]);
        const before = n(r["Before"]);
        if (after !== before) {
          if (now === after) Object.assign(changes, countCells(at, loc, before));
          else skipped.push(`${label} at ${loc}: changed since (now ${now}); left as it is`);
        }
      }
      if (str(r["Reason"]).includes("Arrived") && at.headers.includes("Status") && str(at.row[at.col("Status")]) === "") changes["Status"] = "NYA";
      if (Object.keys(changes).length) {
        await setCells(wb, at, changes);
        reverted++;
      }
    }
    // Remove the rows it added (each removal re-reads its table).
    for (const spec of [OPENED_SPEC, SOLD_SPEC] as const) {
      const field = spec === OPENED_SPEC ? "Occasion" : "Notes";
      const ids = rowsOf(await readLog(wb, spec.table))
        .filter((r) => str(r[field]).includes(tag))
        .map((r) => str(r[spec.idHeader]));
      for (const rid of ids) await removeLog(wb, spec, rid);
    }
    for (const r of rows) await removeLog(wb, STOCKTAKE_SPEC, str(r["AdjustID"]));
    return { reverted, skipped };
  });
}
