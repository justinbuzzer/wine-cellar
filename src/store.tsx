import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { config } from "./config";
import {
  checkSchema,
  INVENTORY_COLUMNS,
  TASTING_COLUMNS,
  toTable,
  toTasting,
  toWine,
  type SchemaCheck,
  type Tasting,
  type Wine,
} from "./data";
import { findWorkbook, GraphError, searchWorkbooks, storeItemId, timed, Workbook, type DriveItem } from "./graph";
import { COL_HOME, COL_KC } from "./locations";
import { findQtyIssues, type QtyIssue } from "./bottlecheck";
import { readHistory } from "./history";
import { toOpening, type Opening } from "./historymodel";

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
}

export function describeError(e: unknown): string {
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
  const [inv, tas, hist, ...lists] = await Promise.all([
    timed(() => wb.readTable(config.tables.inventory)),
    timed(() => wb.readTable(config.tables.tastings)),
    timed(() => readHistory(wb)),
    ...config.lists.map((n) => timed(() => wb.readNamedList(n))),
  ]);
  const invTable = toTable(inv.value.values);
  const tasTable = toTable(tas.value.values);
  const histRows = hist.value ? toTable(hist.value.values).rows : [];
  return {
    history: histRows.filter((r) => Object.values(r).some((v) => v !== null)).map(toOpening),
    hasHistory: hist.value !== null,
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

/** Finds and loads the workbook, then renders children with the data available. */
export function WorkbookGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "finding" });

  const open = useCallback(async (file: DriveItem) => {
    setPhase({ kind: "loading", file });
    try {
      setPhase({ kind: "loaded", data: await loadWorkbook(file) });
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

  useEffect(() => {
    void find();
  }, [find]);

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
    changeFile: () => {
      storeItemId(null);
      void search();
    },
  };
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function Status({ text }: { text: string }) {
  return (
    <section className="card center">
      <div className="spinner" aria-hidden />
      <p>{text}</p>
    </section>
  );
}
