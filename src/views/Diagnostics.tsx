import { useMemo, useState } from "react";
import { config } from "../config";
import { shortName, type SchemaCheck } from "../data";
import { describeError, useWorkbook } from "../store";
import { Modal } from "../ui";
import { planUpgrade, runUpgrade, type UpgradeResult } from "../upgrade";

export default function Diagnostics() {
  const { data, reload, changeFile } = useWorkbook();
  const { file, wines, tastings } = data;
  const [reloading, setReloading] = useState(false);

  return (
    <>
      {!data.upgraded && <UpgradeCard />}

      <section className="card">
        <h2>Workbook</h2>
        <dl className="facts">
          <div className="fact-row">
            <dt>File</dt>
            <dd>
              <a href={file.webUrl} target="_blank" rel="noreferrer">{file.name}</a>
            </dd>
          </div>
          <div className="fact-row">
            <dt>Folder</dt>
            <dd>{file.parentReference?.path?.replace("/drive/root:", "") || "/"}</dd>
          </div>
          <div className="fact-row">
            <dt>Last modified</dt>
            <dd>{new Date(file.lastModifiedDateTime).toLocaleString()}</dd>
          </div>
          <div className="fact-row">
            <dt>K Cellars / Home</dt>
            <dd>{data.upgraded ? "Enabled" : "Not yet — upgrade needed"}</dd>
          </div>
        </dl>
        <div className="actions">
          <button
            disabled={reloading}
            onClick={async () => {
              setReloading(true);
              try {
                await reload();
              } finally {
                setReloading(false);
              }
            }}
          >
            {reloading ? "Reloading…" : "Reload"}
          </button>
          <button className="link" onClick={changeFile}>Use a different file</button>
        </div>
      </section>

      <section className="card">
        <h2>Counts</h2>
        <dl className="facts">
          <div className="fact-row"><dt>Wines</dt><dd>{wines.length}</dd></div>
          <div className="fact-row"><dt>Bottles</dt><dd>{wines.reduce((s, w) => s + w.qty, 0)}</dd></div>
          {data.upgraded && (
            <div className="fact-row">
              <dt>K Cellars / Home</dt>
              <dd>
                {wines.reduce((s, w) => s + (w.kc ?? 0), 0)} / {wines.reduce((s, w) => s + (w.home ?? 0), 0)}
              </dd>
            </div>
          )}
          <div className="fact-row"><dt>Tasting notes</dt><dd>{tastings.length} ({tastings.filter((t) => t.wineId).length} linked)</dd></div>
        </dl>
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
              <td>Total (in parallel)</td>
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
              <dd>{values.map((v) => <span key={v} className="chip">{v}</span>)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

function SchemaLine({ name, check }: { name: string; check: SchemaCheck }) {
  const ok = check.missing.length === 0;
  return (
    <p className={ok ? "ok" : "warn"}>
      <strong>{name}:</strong> {ok ? "all expected columns found" : `missing ${check.missing.join(", ")}`}
      {check.extra.length > 0 && <span className="muted"> · extra columns: {check.extra.join(", ")}</span>}
    </p>
  );
}

function UpgradeCard() {
  const { data, reload } = useWorkbook();
  const plan = useMemo(() => planUpgrade(data.wines), [data.wines]);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UpgradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const count = (rule: string) => plan.filter((p) => p.rule === rule).length;
  const kc = plan.reduce((s, p) => s + p.kc, 0);
  const home = plan.reduce((s, p) => s + p.home, 0);
  const notable = plan.filter((p) => p.rule !== "kc");
  const isTest = /test/i.test(data.file.name);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const r = await runUpgrade(data.file.id);
      setResult(r);
      if (r.mismatches.length === 0) await reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  }

  if (result) {
    return (
      <section className={`card ${result.mismatches.length ? "error" : ""}`}>
        <h2>Upgrade {result.mismatches.length ? "finished with problems" : "complete"}</h2>
        <p>
          {result.rows} wines converted: {result.kcBottles} bottles at K Cellars, {result.homeBottles} at Home.
        </p>
        {result.mismatches.length > 0 ? (
          <p>
            These wines' totals changed and need checking in Excel: {result.mismatches.join(", ")}. Restore the
            previous version from OneDrive's version history if needed.
          </p>
        ) : (
          <p className="ok">Every wine's total bottle count is unchanged. Check the new columns in Excel for the web.</p>
        )}
      </section>
    );
  }

  return (
    <section className="card upgrade">
      <h2>Upgrade spreadsheet for K Cellars / Home</h2>
      <p>
        Adds <strong>Qty K Cellars</strong> and <strong>Qty Home</strong> columns to the Inventory table, fills them
        from the old <em>Loc</em> column, and turns <strong>Qty</strong> into their sum. Nothing else changes.
      </p>
      <table className="grid narrow">
        <tbody>
          <tr><td>Blank Loc → all at K Cellars</td><td className="num">{count("kc")} wines</td></tr>
          <tr><td>"Fridge" → all at Home</td><td className="num">{count("home")} wines</td></tr>
          <tr><td>"Fridge (n)" → n at Home, rest at K Cellars</td><td className="num">{count("partial")} wines</td></tr>
          {count("unknown") > 0 && (
            <tr className="warn"><td>Unrecognised Loc → K Cellars</td><td className="num">{count("unknown")} wines</td></tr>
          )}
          <tr className="total"><td>Bottles: K Cellars / Home</td><td className="num">{kc} / {home}</td></tr>
        </tbody>
      </table>

      <details>
        <summary>Wines not going entirely to K Cellars ({notable.length})</summary>
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr><th>ID</th><th>Wine</th><th>Loc</th><th className="num">Qty</th><th className="num">K Cellars</th><th className="num">Home</th></tr>
            </thead>
            <tbody>
              {notable.map((p) => (
                <tr key={p.wine.wineId} className={p.rule === "unknown" ? "warn" : ""}>
                  <td>{p.wine.wineId}</td>
                  <td>{p.wine.producer} {shortName(p.wine)} {p.wine.vintage}</td>
                  <td>{p.wine.loc}</td>
                  <td className="num">{p.wine.qty}</td>
                  <td className="num">{p.kc}</td>
                  <td className="num">{p.home}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {error && <p className="warn">{error}</p>}
      <div className="actions">
        <button className="primary" onClick={() => setConfirming(true)} disabled={running}>
          Upgrade {data.file.name}…
        </button>
      </div>

      {confirming && (
        <Modal title="Upgrade this spreadsheet?" onClose={() => !running && setConfirming(false)}>
          <p>
            File: <strong>{data.file.name}</strong>{" "}
            {isTest ? <span className="badge test">TEST copy</span> : <span className="badge real">REAL file</span>}
          </p>
          {!isTest && !config.usingTestFile && (
            <p className="warn">This is your real workbook. Make sure you've tried the upgrade on the TEST copy first.</p>
          )}
          <p className="muted">OneDrive keeps previous versions, so this can be undone from version history.</p>
          <div className="actions">
            <button className="primary" disabled={running} onClick={() => void run()}>
              {running ? "Upgrading…" : "Yes, upgrade"}
            </button>
            <button disabled={running} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
