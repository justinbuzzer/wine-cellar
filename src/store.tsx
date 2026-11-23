import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { msal, OfflineError } from "./auth";
import { isOfflineError, loadSnapshot, requestPersistentStorage, saveSnapshot } from "./offline";
import { config } from "./config";
import {
  checkSchema,
  INVENTORY_COLUMNS,
  TASTING_COLUMNS,
  toTable,
  toTasting,
  toWine,
  type Cell,
  type SchemaCheck,
  type Tasting,
  type Wine,
} from "./data";
import { findWorkbook, GraphError, searchWorkbooks, storeItemId, timed, Workbook, type DriveItem } from "./graph";
import { COL_HOME, COL_KC } from "./locations";
import { findQtyIssues, type QtyIssue } from "./bottlecheck";
import { readHistory } from "./history";
import { toOpening, type Opening } from "./historymodel";
import { readSales } from "./sales";
import { toSale, type Sale } from "./salesmodel";
import { readDrafts, toDraft, type Draft } from "./drafts";
import { readSettings, SETTINGS_TABLE } from "./settings";
import { layoutFromRows, type Layout } from "./spots";
import { readGroupBuys } from "./groupbuys";
import { toGbRow, type GbRow } from "./groupbuymodel";
import { readPurchases } from "./purchases";
import { toPurchase, type Purchase } from "./purchasemodel";

export interface WorkbookData {
  file: DriveItem;
  wines: Wine[];
  tastings: Tasting[];
  invSchema: SchemaCheck;
  tasSchema: SchemaCheck;
  /** Inventory rows whose bottle counts need repair (see Diagnostics). */
  qtyIssues: QtyIssue[];
  lists: Record<string, string[]>;
  timings: { label: string; ms: number }[];
  totalMs: number;
  /** Inventory has "Qty K Cellars" and "Qty Home" columns. */
  hasLocations: boolean;
  /** Bottles opened (empty until the first one is opened in the app). */
  history: Opening[];
  /** The "Opened" table exists in the workbook. */
  hasHistory: boolean;
  /** Bottles sold (empty until the first sale in the app). */
  sales: Sale[];
  /** The "Sold" table exists in the workbook. */
  hasSales: boolean;
  /** Unfinished tasting notes (the "Drafts" table; empty until the first draft). */
  drafts: Draft[];
  /** K Cellars boxes and Home racks (Settings page; empty until set up). */
  layout: Layout;
  /** Group buys split with friends (the "GroupBuys" table; empty until the first). */
  groupBuys: GbRow[];
  /** Bottles you bought, by date (the "Purchases" table; empty until the first purchase after it was added). */
  purchases: Purchase[];
}

export function describeError(e: unknown): string {
  if (e instanceof OfflineError || (isOfflineError(e) && navigator.onLine === false)) return new OfflineError().message;
  if (isOfflineError(e)) {
    const detail = (e as { errorCode?: string; message?: string }).errorCode || (e instanceof Error ? e.message : String(e));
    return `Couldn't reach Microsoft (${detail}). Check your internet connection, VPN or browser extensions, then try again.`;
  }
  if (e instanceof GraphError) {
    if (e.status === 423 || /lock/i.test(e.code)) {
      return "The workbook is locked for editing (is it open in desktop Excel?). Close it there, or use Excel for the web, and try again.";
    }
    return `${e.message} (Graph ${e.status} ${e.code})`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export async function loadWorkbook(file: DriveItem): Promise<WorkbookData> {
  const wb = Workbook.reader(file.id);
  const start = performance.now();
  const [inv, tas, hist, sold, drafts, settings, groups, bought, ...lists] = await Promise.all([
    timed(() => wb.readTable(config.tables.inventory)),
    timed(() => wb.readTable(config.tables.tastings)),
    timed(() => readHistory(wb)),
    timed(() => readSales(wb)),
    timed(() => readDrafts(wb)),
    timed(() => readSettings(wb)),
    timed(() => readGroupBuys(wb)),
    timed(() => readPurchases(wb)),
    ...config.lists.map((n) => timed(() => wb.readNamedList(n))),
  ]);
  const invTable = toTable(inv.value.values);
  const tasTable = toTable(tas.value.values);
  const rowsOf = (snap: { values: Cell[][] } | null) =>
    snap ? toTable(snap.values).rows.filter((r) => Object.values(r).some((v) => v !== null)) : [];
  return {
    history: rowsOf(hist.value).map(toOpening),
    hasHistory: hist.value !== null,
    sales: rowsOf(sold.value).map(toSale),
    hasSales: sold.value !== null,
    drafts: rowsOf(drafts.value).map(toDraft).filter((d) => d.draftId),
    layout: layoutFromRows(rowsOf(settings.value)),
    groupBuys: rowsOf(groups.value).map(toGbRow).filter((r) => r.rowId && r.groupId),
    purchases: rowsOf(bought.value).map(toPurchase).filter((p) => p.purchaseId),
    file,
    wines: invTable.rows.map(toWine),
    tastings: tasTable.rows.map(toTasting),
    invSchema: checkSchema(invTable.headers, INVENTORY_COLUMNS),
    tasSchema: checkSchema(tasTable.headers, TASTING_COLUMNS),
    lists: Object.fromEntries(config.lists.map((n, i) => [n, lists[i].value])),
    timings: [
      { label: `Table "${config.tables.inventory}"`, ms: inv.ms },
      { label: `Table "${config.tables.tastings}"`, ms: tas.ms },
      { label: `Table "${config.tables.history}"${hist.value ? "" : " (not created yet)"}`, ms: hist.ms },
      { label: `Table "${config.tables.sales}"${sold.value ? "" : " (not created yet)"}`, ms: sold.ms },
      { label: `Table "${config.tables.drafts}"${drafts.value ? "" : " (not created yet)"}`, ms: drafts.ms },
      { label: `Table "${SETTINGS_TABLE}"${settings.value ? "" : " (not created yet)"}`, ms: settings.ms },
      { label: `Table "GroupBuys"${groups.value ? "" : " (not created yet)"}`, ms: groups.ms },
      { label: `Table "Purchases"${bought.value ? "" : " (not created yet)"}`, ms: bought.ms },
      { label: `${config.lists.length} dropdown lists (slowest)`, ms: Math.max(...lists.map((l) => l.ms)) },
    ],
    totalMs: Math.round(performance.now() - start),
    hasLocations: invTable.headers.includes(COL_KC) && invTable.headers.includes(COL_HOME),
    qtyIssues: findQtyIssues(invTable.headers, inv.value.values.slice(1)),
  };
}

interface Store {
  data: WorkbookData;
  reload(): Promise<void>;
  /** Replace (or add) one wine in the app's copy after a successful write. */
  putWine(w: Wine): void;
  /** Replace (or add) one tasting note after a successful write. */
  putTasting(t: Tasting): void;
  /** Add a history entry after a successful write. */
  putOpening(o: Opening): void;
  removeOpening(openId: string): void;
  putSale(s: Sale): void;
  removeSale(saleId: string): void;
  putDraft(d: Draft): void;
  removeDraft(draftId: string): void;
  putLayout(l: Layout): void;
  /** Replace the group buy rows after a write (writes return them all). */
  putGroupBuys(rows: GbRow[]): void;
  /** Replace the purchase log after a write (writes return it all). */
  putPurchases(rows: Purchase[]): void;
  changeFile(): void;
}

const StoreContext = createContext<Store | null>(null);

export function useWorkbook(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useWorkbook outside WorkbookGate");
  return s;
}

type Phase =
  | { kind: "finding" }
  | { kind: "notFound"; results: DriveItem[] | null }
  | { kind: "loading"; file: DriveItem }
  | { kind: "loaded"; data: WorkbookData }
  | { kind: "error"; message: string };

/** Whether the data on screen is fresh from OneDrive or the offline copy. */
type Sync =
  | { state: "fresh" }
  | { state: "updating"; savedAt: number }
  | { state: "offline"; savedAt: number }
  | { state: "failed"; savedAt: number; message: string };

/** Bump when WorkbookData changes shape, so an old offline copy is ignored. */
const SNAPSHOT_VERSION = 6;

function snapshotKey(): string {
  return `v${SNAPSHOT_VERSION}:${import.meta.env.MODE}:${msal.getActiveAccount()?.homeAccountId ?? "none"}`;
}

/**
 * Finds and loads the workbook, then renders children with the data available.
 * If this device has an offline copy, it's shown straight away while the
 * workbook is re-read in the background (or kept, with a notice, when offline).
 */
export function WorkbookGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "finding" });
  const [sync, setSync] = useState<Sync>({ state: "fresh" });
  const cachedAt = useRef<number | null>(null);
  const key = snapshotKey();

  const open = useCallback(async (file: DriveItem) => {
    setPhase({ kind: "loading", file });
    try {
      setPhase({ kind: "loaded", data: await loadWorkbook(file) });
      setSync({ state: "fresh" });
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }, []);

  const search = useCallback(async () => {
    setPhase({ kind: "notFound", results: null });
    try {
      setPhase({ kind: "notFound", results: await searchWorkbooks(config.workbookSearchText) });
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }, []);

  const find = useCallback(async () => {
    setPhase({ kind: "finding" });
    try {
      const file = await findWorkbook();
      if (file) return open(file);
      await search();
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }, [open, search]);

  /** Re-reads the workbook while the offline copy stays on screen. */
  const refresh = useCallback(async () => {
    const savedAt = cachedAt.current ?? Date.now();
    setSync({ state: "updating", savedAt });
    try {
      const file = await findWorkbook();
      if (!file) return void search();
      setPhase({ kind: "loaded", data: await loadWorkbook(file) });
      setSync({ state: "fresh" });
    } catch (e) {
      // "Offline" only when the device itself says so; otherwise show what failed.
      setSync(
        e instanceof OfflineError || (navigator.onLine === false && isOfflineError(e))
          ? { state: "offline", savedAt }
          : { state: "failed", savedAt, message: describeError(e) },
      );
    }
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snap = await loadSnapshot<WorkbookData>(key);
      if (cancelled) return;
      if (snap && Array.isArray(snap.data?.wines)) {
        cachedAt.current = snap.savedAt;
        setPhase({ kind: "loaded", data: snap.data });
        void refresh();
      } else {
        void find();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, find, refresh]);

  // Keep the offline copy up to date with what's on screen (only fresh data).
  useEffect(() => {
    if (phase.kind !== "loaded" || sync.state !== "fresh") return;
    cachedAt.current = Date.now();
    void saveSnapshot(key, phase.data);
    requestPersistentStorage();
  }, [phase, sync.state, key]);

  // Showing the saved copy: try again when the connection returns, when the
  // app comes back into view, and every minute, so the notice never sticks.
  useEffect(() => {
    if (sync.state !== "offline" && sync.state !== "failed") return;
    const retry = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onVisible = () => document.visibilityState === "visible" && retry();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(retry, 60_000);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [sync.state, refresh]);

  if (phase.kind === "finding") return <Status text="Looking for your workbook in OneDrive…" />;
  if (phase.kind === "loading") return <Status text={`Reading ${phase.file.name}…`} />;
  if (phase.kind === "error") {
    return (
      <section className="card error">
        <h2>Something went wrong</h2>
        <p>{phase.message}</p>
        <button className="primary" onClick={() => void find()}>Try again</button>
      </section>
    );
  }
  if (phase.kind === "notFound") {
    return (
      <section className="card">
        <h2>Workbook not found</h2>
        <p>
          It isn't at <code>{config.defaultWorkbookPath}</code>. Pick it from the files below.
        </p>
        {phase.results === null && <p className="muted">Searching OneDrive…</p>}
        {phase.results?.length === 0 && <p>No matching .xlsx files found.</p>}
        <ul className="picklist">
          {phase.results?.map((f) => (
            <li key={f.id}>
              <button
                onClick={() => {
                  storeItemId(f.id);
                  void open(f);
                }}
              >
                <strong>{f.name}</strong>
                <span className="muted">{f.parentReference?.path?.replace("/drive/root:", "") || "/"}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const data = phase.data;
  const store: Store = {
    data,
    reload: async () => {
      const fresh = await loadWorkbook(data.file);
      setPhase({ kind: "loaded", data: fresh });
    },
    putWine: (w) =>
      setPhase((p) => {
        if (p.kind !== "loaded") return p;
        const wines = p.data.wines.some((x) => x.wineId === w.wineId)
          ? p.data.wines.map((x) => (x.wineId === w.wineId ? w : x))
          : [...p.data.wines, w];
        return { kind: "loaded", data: { ...p.data, wines } };
      }),
    putTasting: (t) =>
      setPhase((p) => {
        if (p.kind !== "loaded") return p;
        const tastings = p.data.tastings.some((x) => x.tastingId === t.tastingId)
          ? p.data.tastings.map((x) => (x.tastingId === t.tastingId ? t : x))
          : [...p.data.tastings, t];
        return { kind: "loaded", data: { ...p.data, tastings } };
      }),
    putOpening: (o) =>
      setPhase((p) =>
        p.kind !== "loaded"
          ? p
          : { kind: "loaded", data: { ...p.data, hasHistory: true, history: [...p.data.history.filter((x) => x.openId !== o.openId), o] } },
      ),
    removeOpening: (id) =>
      setPhase((p) =>
        p.kind !== "loaded" ? p : { kind: "loaded", data: { ...p.data, history: p.data.history.filter((x) => x.openId !== id) } },
      ),
    putSale: (s) =>
      setPhase((p) =>
        p.kind !== "loaded"
          ? p
          : { kind: "loaded", data: { ...p.data, hasSales: true, sales: [...p.data.sales.filter((x) => x.saleId !== s.saleId), s] } },
      ),
    removeSale: (id) =>
      setPhase((p) =>
        p.kind !== "loaded" ? p : { kind: "loaded", data: { ...p.data, sales: p.data.sales.filter((x) => x.saleId !== id) } },
      ),
    putDraft: (d) =>
      setPhase((p) =>
        p.kind !== "loaded" ? p : { kind: "loaded", data: { ...p.data, drafts: [...p.data.drafts.filter((x) => x.draftId !== d.draftId), d] } },
      ),
    removeDraft: (id) =>
      setPhase((p) =>
        p.kind !== "loaded" ? p : { kind: "loaded", data: { ...p.data, drafts: p.data.drafts.filter((x) => x.draftId !== id) } },
      ),
    putLayout: (l) => setPhase((p) => (p.kind !== "loaded" ? p : { kind: "loaded", data: { ...p.data, layout: l } })),
    putGroupBuys: (rows) => setPhase((p) => (p.kind !== "loaded" ? p : { kind: "loaded", data: { ...p.data, groupBuys: rows } })),
    putPurchases: (rows) => setPhase((p) => (p.kind !== "loaded" ? p : { kind: "loaded", data: { ...p.data, purchases: rows } })),
    changeFile: () => {
      storeItemId(null);
      void search();
    },
  };
  return (
    <StoreContext.Provider value={store}>
      <SyncNotice sync={sync} onRetry={() => void refresh()} />
      {children}
    </StoreContext.Provider>
  );
}

function savedTime(ms: number): string {
  return new Date(ms).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function SyncNotice({ sync, onRetry }: { sync: Sync; onRetry: () => void }) {
  if (sync.state === "fresh") return null;
  if (sync.state === "updating") return <div className="sync-note muted small">Updating from OneDrive…</div>;
  return (
    <div className="notice sync-offline">
      {sync.state === "offline" ? (
        <>
          <strong>Offline.</strong> Showing your cellar as saved on this device at {savedTime(sync.savedAt)}. Changes need a
          connection.
        </>
      ) : (
        <>
          <strong>Couldn't update from OneDrive.</strong> Showing the copy saved at {savedTime(sync.savedAt)}. It will
          try again automatically. <span className="muted small">{sync.message}</span>
        </>
      )}{" "}
      <button className="link" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function Status({ text }: { text: string }) {
  return (
    <section className="card center">
      <div className="spinner" aria-hidden />
      <p>{text}</p>
    </section>
  );
}
