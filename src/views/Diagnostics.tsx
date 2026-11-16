import { useState } from "react";
import type { SchemaCheck } from "../data";
import { useWorkbook } from "../store";

export default function Diagnostics() {
  const { data, reload, changeFile } = useWorkbook();
  const { file, wines, tastings } = data;
  const [reloading, setReloading] = useState(false);

  return (
    <>
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
