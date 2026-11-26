// The Blind tab: how your blind guesses have gone — grape, country, region and
// vintage hit rates, each dinner, the grapes you get (and mix up), your vintage
// tendency, and every blind wine. Made from finished notes tasted blind.

import { useMemo } from "react";
import { blindStats, type FieldStat } from "../blindmodel";
import { href } from "../router";
import { useWorkbook } from "../store";

const pct = (f: FieldStat) => (f.marked ? `${Math.round((f.hits / f.marked) * 100)}%` : "–");
const day = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "No date";

function Bar({ value, of }: { value: number; of: number }) {
  return (
    <span className="bl-bar" aria-hidden="true">
      <i style={{ width: `${of ? Math.round((value / of) * 100) : 0}%` }} />
    </span>
  );
}

export default function Blind() {
  const { data } = useWorkbook();
  const s = useMemo(() => blindStats(data.tastings), [data.tastings]);

  if (!s.wines) {
    return (
      <div className="page">
        <h2>Blind tastings</h2>
        <section className="card">
          <p className="muted">No blind tastings with guesses yet. Start one with 🕶️ on a new note.</p>
        </section>
      </div>
    );
  }

  const v = s.fields.Vintage;
  return (
    <div className="page blind-page">
      <h2>Blind tastings</h2>
      <p className="muted small bl-sub">
        {s.wines} wine{s.wines === 1 ? "" : "s"} · {s.dinners} tasting{s.dinners === 1 ? "" : "s"}
      </p>

      <div className="bl-tiles">
        {(["Grape", "Country", "Region"] as const).map((k) => (
          <div key={k} className="bl-tile">
            <b>{pct(s.fields[k])}</b>
            <span>{k}</span>
            <small className="muted">{s.fields[k].hits}/{s.fields[k].marked}</small>
          </div>
        ))}
        <div className="bl-tile">
          <b>{pct(v)}</b>
          <span>Vintage ±1</span>
          <small className="muted">{v.exact} exact</small>
        </div>
      </div>

      <section className="card">
        <h3>By tasting</h3>
        {s.byDinner.map((d) => (
          <div key={d.date ?? "none"} className="bl-row">
            <span className="muted small">{day(d.date)} · {d.wines}</span>
            <Bar value={d.hits} of={d.marked} />
            <span className="bl-num">{d.hits}/{d.marked}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <h3>Grapes</h3>
        {s.grapes.map((g) => (
          <div key={g.grape} className="bl-row">
            <span>{g.grape}</span>
            {g.tasted >= 2 ? <Bar value={g.right} of={g.tasted} /> : <span className="muted small">1 tasted</span>}
            <span className="bl-num">{g.right}/{g.tasted}</span>
          </div>
        ))}
        {s.mixups.length > 0 && (
          <>
            <h3 className="bl-h">Mix-ups</h3>
            {s.mixups.map((m) => (
              <div key={`${m.was}|${m.said}`} className="bl-line">
                <span>{m.was} <span className="muted">→ you said</span> {m.said}</span>
                <span className="bl-num">{m.times}×</span>
              </div>
            ))}
          </>
        )}
      </section>

      {s.vintage && (
        <section className="card">
          <h3>Vintage</h3>
          <p className="bl-text">
            On average {s.vintage.averageOff.toFixed(1)} year{s.vintage.averageOff === 1 ? "" : "s"} off
            {Math.abs(s.vintage.lean) >= 0.5 ? (
              <> · you tend to guess <strong>{s.vintage.lean > 0 ? "younger" : "older"}</strong> (by {Math.abs(s.vintage.lean).toFixed(1)})</>
            ) : (
              <> · no lean either way</>
            )}
          </p>
        </section>
      )}

      <section className="card">
        <h3>Blind wines</h3>
        {s.past.map((p, i) => (
          <a key={p.tastingId ?? i} className="bl-line bl-link" href={p.tastingId ? href(`note/${p.tastingId}`) : undefined}>
            <span>
              {p.title} <span className="muted small">{day(p.date)}</span>
            </span>
            <span className="bl-num">{p.hits}/{p.marked} ›</span>
          </a>
        ))}
      </section>
    </div>
  );
}
