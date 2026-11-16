import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { isAllowed, signIn, signOut } from "./auth";
import { config } from "./config";
import {
  checkSchema,
  formatPrice,
  INVENTORY_COLUMNS,
  TASTING_COLUMNS,
  toTable,
  toTasting,
  toWine,
  type SchemaCheck,
  type Tasting,
  type Wine,
} from "./data";
import {
  findWorkbook,
  GraphError,
  readNamedList,
  readTable,
  searchWorkbooks,
  storeItemId,
  type DriveItem,
} from "./graph";

interface Loaded {
  file: DriveItem;
  wines: Wine[];
  tastings: Tasting[];
  invSchema: SchemaCheck;
  tasSchema: SchemaCheck;
  lists: Record<string, string[]>;
  timings: { label: string; ms: number }[];
  totalMs: number;
}

type Phase =
  | { kind: "finding" }
  | { kind: "notFound"; results: DriveItem[] | null }
  | { kind: "loading"; file: DriveItem }
  | { kind: "loaded"; data: Loaded }
  | { kind: "error"; message: string };

function describeError(e: unknown): string {
  if (e instanceof GraphError) return `${e.message} (Graph ${e.status} ${e.code})`;
  if (e instanceof Error) return e.message;
  return String(e);
}

async function loadWorkbook(file: DriveItem): Promise<Loaded> {
  const start = performance.now();
  const [inv, tas, ...lists] = await Promise.all([
    readTable(file.id, config.tables.inventory),
    readTable(file.id, config.tables.tastings),
    ...config.lists.map((n) => readNamedList(file.id, n)),
  ]);
  const invTable = toTable(inv.value);
  const tasTable = toTable(tas.value);
  return {
    file,
    wines: invTable.rows.map(toWine),
    tastings: tasTable.rows.map(toTasting),
    invSchema: checkSchema(invTable.headers, INVENTORY_COLUMNS),
    tasSchema: checkSchema(tasTable.headers, TASTING_COLUMNS),
    lists: Object.fromEntries(config.lists.map((n, i) => [n, lists[i].value])),
    timings: [
      { label: `Table "${config.tables.inventory}"`, ms: inv.ms },
      { label: `Table "${config.tables.tastings}"`, ms: tas.ms },
      { label: `${config.lists.length} dropdown lists (slowest)`, ms: Math.max(...lists.map((l) => l.ms)) },
    ],
    totalMs: Math.round(performance.now() - start),
  };
}

export default function App({ account }: { account: AccountInfo | null }) {
  if (!account) return <SignedOut />;
  if (!isAllowed(account)) return <NotAllowed account={account} />;
  return <SignedIn account={account} />;
}

function Shell({ account, children }: { account?: AccountInfo; children: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <h1>Wine Cellar</h1>
        {account && (
          <div className="who">
            <span>{account.name}</span>
            <button className="link" onClick={() => signOut()}>Sign out</button>
          </div>
        )}
      </header>
      <main>{children}</main>
      {account && (
        <footer className="foot">
          Step 1 · read-only · account ID <code>{account.homeAccountId}</code>
        </footer>
      )}
    </div>
  );
}

function SignedOut() {
  return (
    <Shell>
      <section className="card center">
        <p>Sign in with your Microsoft account to open your wine cellar.</p>
        <button className="primary" onClick={() => signIn()}>Sign in with Microsoft</button>
      </section>
    </Shell>
  );
}

function NotAllowed({ account }: { account: AccountInfo }) {
  return (
    <Shell account={account}>
      <section className="card center">
        <p>This account isn't authorised to use this app.</p>
      </section>
    </Shell>
  );
}

function SignedIn({ account }: { account: AccountInfo }) {
  const [phase, setPhase] = useState<Phase>({ kind: "finding" });

  const open = useCallback(async (file: DriveItem) => {
    setPhase({ kind: "loading", file });
    try {
      setPhase({ kind: "loaded", data: await loadWorkbook(file) });
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }, []);

  const find = useCallback(async () => {
    setPhase({ kind: "finding" });
    try {
      const file = await findWorkbook();
      if (file) return open(file);
      setPhase({ kind: "notFound", results: null });
      setPhase({ kind: "notFound", results: await searchWorkbooks(config.workbookSearchText) });
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }, [open]);

  useEffect(() => {
    void find();
  }, [find]);

  const choose = (file: DriveItem) => {
    storeItemId(file.id);
    void open(file);
  };

  return (
    <Shell account={account}>
      {phase.kind === "finding" && <Status text="Looking for your workbook in OneDrive…" />}
      {phase.kind === "loading" && <Status text={`Reading ${phase.file.name}…`} />}
      {phase.kind === "error" && (
        <section className="card error">
          <h2>Something went wrong</h2>
          <p>{phase.message}</p>
          <button className="primary" onClick={() => void find()}>Try again</button>
        </section>
      )}
      {phase.kind === "notFound" && (
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
                <button onClick={() => choose(f)}>
                  <strong>{f.name}</strong>
                  <span className="muted">{f.parentReference?.path?.replace("/drive/root:", "") || "/"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {phase.kind === "loaded" && (
        <Report
          data={phase.data}
          onChangeFile={() => {
            storeItemId(null);
            setPhase({ kind: "notFound", results: null });
            searchWorkbooks(config.workbookSearchText)
              .then((results) => setPhase({ kind: "notFound", results }))
              .catch((e) => setPhase({ kind: "error", message: describeError(e) }));
          }}
          onReload={() => void open(phase.data.file)}
        />
      )}
    </Shell>
  );
}

function Status({ text }: { text: string }) {
  return (
    <section className="card center">
      <div className="spinner" aria-hidden />
      <p>{text}</p>
    </section>
  );
}

function Report({ data, onChangeFile, onReload }: { data: Loaded; onChangeFile: () => void; onReload: () => void }) {
  const { file, wines, tastings } = data;
  const inCellar = wines.filter((w) => w.qty > 0);
  const bottles = inCellar.reduce((s, w) => s + w.qty, 0);
  const nya = wines.filter((w) => w.status === "NYA").length;
  const linked = tastings.filter((t) => t.wineId).length;
  const latest = [...tastings].reverse().slice(0, 10);

  return (
    <>
      <section className="card">
        <h2>Workbook</h2>
        <dl className="facts">
          <dt>File</dt>
          <dd>
            <a href={file.webUrl} target="_blank" rel="noreferrer">{file.name}</a>
          </dd>
          <dt>Folder</dt>
          <dd>{file.parentReference?.path?.replace("/drive/root:", "") || "/"}</dd>
          <dt>Last modified</dt>
          <dd>{new Date(file.lastModifiedDateTime).toLocaleString()}</dd>
        </dl>
        <div className="actions">
          <button onClick={onReload}>Reload</button>
          <button className="link" onClick={onChangeFile}>Use a different file</button>
        </div>
      </section>

      <section className="stats">
        <Stat label="Wines in inventory" value={wines.length} />
        <Stat label="Bottles in cellar" value={bottles} sub={`${inCellar.length} wines with Qty > 0`} />
        <Stat label="Not yet arrived" value={nya} />
        <Stat label="Tasting notes" value={tastings.length} sub={`${linked} linked to inventory`} />
      </section>

      <section className="card">
        <h2>Load time</h2>
        <table className="grid narrow">
          <tbody>
            {data.timings.map((t) => (
              <tr key={t.label}>
                <td>{t.label}</td>
                <td className="num">{(t.ms / 1000).toFixed(2)} s</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total (requests run in parallel)</td>
              <td className="num">{(data.totalMs / 1000).toFixed(2)} s</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Column check</h2>
        <SchemaLine name="Inventory" check={data.invSchema} />
        <SchemaLine name="Tasted" check={data.tasSchema} />
      </section>

      <section className="card">
        <h2>Dropdown lists</h2>
        <dl className="facts">
          {Object.entries(data.lists).map(([name, values]) => (
            <div key={name} className="fact-row">
              <dt>{name.replace("List_", "")}</dt>
              <dd>
                {values.map((v) => (
                  <span key={v} className="chip">{v}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card">
        <h2>Inventory · first 10 rows</h2>
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>ID</th><th>Producer</th><th>Wine</th><th>Vintage</th><th>Type</th>
                <th>Region</th><th className="num">Qty</th><th className="num">Price</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {wines.slice(0, 10).map((w, i) => (
                <tr key={w.wineId ?? i}>
                  <td>{w.wineId}</td><td>{w.producer}</td><td>{w.name}</td><td>{w.vintage}</td>
                  <td>{w.type}</td><td>{w.region}</td><td className="num">{w.qty}</td>
                  <td className="num">{formatPrice(w.price, config.currency)}</td><td>{w.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Tasting notes · 10 most recent</h2>
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>ID</th><th>Wine</th><th>Vintage</th><th>Type</th><th className="num">Score</th>
                <th className="num">Tasted</th><th className="num">Age</th><th>Nose</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((t, i) => (
                <tr key={t.tastingId ?? i}>
                  <td>{t.tastingId}</td><td>{t.name}</td><td>{t.vintage}</td><td>{t.type}</td>
                  <td className="num">{t.score}</td><td className="num">{t.dateTasted ?? t.yearTasted}</td>
                  <td className="num">{t.ageTasted}</td><td className="clip">{t.nose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function SchemaLine({ name, check }: { name: string; check: SchemaCheck }) {
  const ok = check.missing.length === 0;
  return (
    <p className={ok ? "ok" : "warn"}>
      <strong>{name}:</strong>{" "}
      {ok ? "all expected columns found" : `missing ${check.missing.join(", ")}`}
      {check.extra.length > 0 && <span className="muted"> · extra columns: {check.extra.join(", ")}</span>}
    </p>
  );
}
