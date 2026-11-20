import { useMemo, useState } from "react";
import type { QtyIssue } from "../bottlecheck";
import { shortName, type SchemaCheck, type Wine } from "../data";
import { duplicateGroups } from "../dupes";
import { href } from "../router";
import { locationLine } from "./Cellar";
import { repairBottleCounts } from "../inventory";
import { describeError, useWorkbook } from "../store";
import { Modal } from "../ui";

export default function Diagnostics() {
  const { data, reload, changeFile } = useWorkbook();
  const { file, wines, tastings } = data;
  const [reloading, setReloading] = useState(false);

  return (
    <>
      {data.hasLocations && <BottleCheck />}
      <DuplicateCheck />

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
            <dd>{data.hasLocations ? "Enabled" : "Missing Qty K Cellars / Qty Home columns"}</dd>
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
          {data.hasLocations && (
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
        <h2>Export for research</h2>
        <p className="muted small">
          Saves a list of your wines (producer, name, vintage, place, grape, type, alcohol and remarks; no prices, sources or
          bottle counts) as <strong>wine-research.json</strong> in your Downloads folder, for Claude to research.
        </p>
        <div className="actions">
          <button onClick={() => exportForResearch(wines, file.name)}>Export {wines.length} wines</button>
          <a href={href("research")}>Review researched remarks →</a>
        </div>
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

function exportForResearch(wines: Wine[], fileName: string) {
  const rows = wines.map((w) => ({
    wineId: w.wineId, producer: w.producer, name: w.name, vintage: w.vintage, country: w.country, region: w.region,
    appellation: w.location, varietal: w.varietal, blend: w.blend, type: w.type, alcohol: w.alcohol, qty: w.qty,
    remarks: w.remarks,
  }));
  const blob = new Blob([JSON.stringify({ workbook: fileName, exported: new Date().toISOString(), wines: rows }, null, 1)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wine-research.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function BottleCheck() {
  const { data, reload } = useWorkbook();
  const issues = data.qtyIssues;
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ repaired: number; remaining: QtyIssue[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isTest = /test/i.test(data.file.name);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const r = await repairBottleCounts(data.file.id);
      setResult(r);
      await reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  }

  if (result) {
    return (
      <section className={`card ${result.remaining.length ? "error" : ""}`}>
        <h2>Bottle counts repaired</h2>
        <p>{result.repaired} wine{result.repaired === 1 ? "" : "s"} fixed.</p>
        {result.remaining.length > 0 ? (
          <IssueList issues={result.remaining} title="Still needs fixing by hand in Excel:" />
        ) : (
          <p className="ok">All bottle counts are now correct.</p>
        )}
      </section>
    );
  }

  if (!issues.length) {
    return (
      <section className="card">
        <h2>Bottle count check</h2>
        <p className="ok">All {data.wines.length} wines have correct bottle counts.</p>
      </section>
    );
  }

  return (
    <section className="card upgrade">
      <h2>Bottle count check</h2>
      <p>
        {issues.length} wine{issues.length === 1 ? "" : "s"} {issues.length === 1 ? "has" : "have"} bottle counts
        stored in a way Excel can't add up. The app already shows the right numbers; repairing fixes the spreadsheet
        itself, so Qty is correct in Excel too.
      </p>
      <IssueList issues={issues} />
      {error && <p className="warn">{error}</p>}
      <div className="actions">
        <button className="primary" onClick={() => setConfirming(true)} disabled={running}>
          Repair {issues.length} wine{issues.length === 1 ? "" : "s"}…
        </button>
      </div>
      {confirming && (
        <Modal title="Repair bottle counts?" onClose={() => !running && setConfirming(false)}>
          <p>
            File: <strong>{data.file.name}</strong>{" "}
            {isTest ? <span className="badge test">TEST copy</span> : <span className="badge real">REAL file</span>}
          </p>
          <p>
            This sets the three bottle columns to normal number format, rewrites the counts and the Qty formula on
            the {issues.length} wines listed, then checks again. Nothing else changes.
          </p>
          <p className="muted">OneDrive keeps previous versions, so this can be undone from version history.</p>
          <div className="actions">
            <button className="primary" disabled={running} onClick={() => void run()}>
              {running ? "Repairing…" : "Yes, repair"}
            </button>
            <button disabled={running} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Same producer, name and vintage on more than one row. Listed only; merge in Excel. */
function DuplicateCheck() {
  const { data } = useWorkbook();
  const groups = useMemo(() => duplicateGroups(data.wines), [data.wines]);
  if (!groups.length) {
    return (
      <section className="card">
        <h2>Duplicate check</h2>
        <p className="ok">No wine appears twice with the same vintage.</p>
      </section>
    );
  }
  return (
    <section className="card upgrade">
      <h2>Duplicate check</h2>
      <p>
        {groups.length} wine{groups.length === 1 ? "" : "s"} {groups.length === 1 ? "appears" : "appear"} on more than one
        row with the same producer, name and vintage. Different vintages aren't counted. To merge, add the bottles to
        one row in Excel and set the other row's bottles to 0 (or delete it). Tasting notes linked to the other row's
        WineID won't move automatically.
      </p>
      <ul className="issue-list">
        {groups.map((g) => (
          <li key={g.map((w) => w.wineId).join("-")}>
            <strong>
              {g[0].producer} {shortName(g[0])} {g[0].vintage ?? "(no vintage)"}
            </strong>
            <div className="dupe-rows">
              {g.map((w) => (
                <a key={w.wineId} href={href(`wine/${w.wineId}`)}>
                  {w.wineId} <span className="muted">· {locationLine(w)}</span>
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IssueList({ issues, title }: { issues: QtyIssue[]; title?: string }) {
  return (
    <>
      {title && <p>{title}</p>}
      <ul className="issue-list">
        {issues.map((i) => (
          <li key={`${i.wineId}-${i.index}`}>
            <strong>{i.wineId || `Row ${i.index + 2}`}</strong> {i.label}
            <div className="muted small">{i.reasons.join(" · ")}</div>
          </li>
        ))}
      </ul>
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
