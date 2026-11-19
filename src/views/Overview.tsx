import { useMemo } from "react";
import { config } from "../config";
import { formatPrice } from "../data";
import { LOCATIONS, type Location } from "../locations";
import { useLogos } from "../logos";
import { producerGroups } from "../producers";
import { todayIso } from "../notesmodel";
import { cellarStats, drinkingStats, noteStats, topN, type Bar } from "../overview";
import { go, href } from "../router";
import { useWorkbook } from "../store";
import { TypeDot } from "../ui";
import { TYPE_ORDER, typeLabel } from "../winelist";
import { showInCellar } from "./Cellar";

const money = (n: number) => formatPrice(n, config.currency);

/** Link to the Producers page with how many producers have a logo so far. */
function LogoProgress() {
  const { data } = useWorkbook();
  const logos = useLogos();
  const groups = useMemo(() => producerGroups(data.wines), [data.wines]);
  const done = groups.filter((g) => logos.get(g.name)).length;
  return (
    <a className="card prompt-card" href={href("producers")}>
      <strong>Producer logos</strong>
      <span className="muted">
        {done} of {groups.length} producers have one →
      </span>
    </a>
  );
}

export default function Overview() {
  const { data } = useWorkbook();
  const today = todayIso();
  const c = useMemo(() => cellarStats(data.wines, TYPE_ORDER), [data.wines]);
  const d = useMemo(() => drinkingStats(data.history, today), [data.history, today]);
  const n = useMemo(() => noteStats(data.tastings, today), [data.tastings, today]);
  const year = today.slice(0, 4);

  const where: Bar[] = LOCATIONS.map((l) => ({ key: l, label: l, value: l === "Home" ? c.home : c.kc }));
  if (c.nyaBottles) where.push({ key: "nya", label: "Not yet arrived", value: c.nyaBottles });

  return (
    <>
      <div className="stats">
        <Tile label="Bottles" value={c.bottles.toLocaleString()} sub={`${c.wines.toLocaleString()} wines`} />
        <Tile
          label="Cellar value"
          value={money(c.value)}
          sub={c.bottlesWithoutPrice ? `${c.bottlesWithoutPrice} bottles have no price` : "at purchase price"}
        />
        <Tile label={`Opened in ${year}`} value={String(d.thisYear)} sub={`${d.lastYear} last year`} />
        <Tile
          label="Tasting notes"
          value={n.notes.toLocaleString()}
          sub={n.average !== null ? `average score ${n.average}` : undefined}
        />
      </div>

      <LogoProgress />

      <div className="ov-grid">
        <section className="card">
          <h2>Where</h2>
          <Bars
            bars={where}
            unit="bottle"
            onPick={(b) => (b.key === "nya" ? showInCellar({ status: "nya" }) : showInCellar({ loc: b.key as Location }))}
          />
        </section>

        <section className="card">
          <h2>By type</h2>
          <Bars
            bars={c.byType.map((b) => ({ ...b, label: typeLabel(b.key === "Other" ? null : b.key) }))}
            unit="bottle"
            dot
            onPick={(b) => showInCellar({ type: b.key === "Other" ? "" : b.key })}
          />
        </section>

        <section className="card">
          <h2>By country</h2>
          <Bars
            bars={topN(c.byCountry, 8)}
            unit="bottle"
            onPick={(b) => b.key !== "__other" && b.key !== "Unknown" && showInCellar({ country: b.key })}
          />
        </section>

        <section className="card">
          <h2>By vintage</h2>
          <Bars bars={c.byVintage} unit="bottle" />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Bottles opened</h2>
            <a href={href("history")}>History →</a>
          </div>
          {data.history.length === 0 ? (
            <p className="muted">
              Nothing yet. When you use 🍷 Open a bottle on a wine's page, it's recorded here.
            </p>
          ) : (
            <>
              <Columns bars={d.months} />
              <p className="muted small">
                {d.thisYear} bottle{d.thisYear === 1 ? "" : "s"} in {year}
                {d.thisYearValue > 0 && <>, worth {money(d.thisYearValue)} at purchase price</>}.
              </p>
              {d.favourites.length > 0 && (
                <>
                  <h3 className="ov-sub">Opened most this year</h3>
                  <ul className="ov-list">
                    {d.favourites.map((f) => (
                      <li key={f.label}>
                        {f.wineId ? <a href={href(`wine/${f.wineId}`)}>{f.label}</a> : f.label}
                        <span className="muted"> × {f.count}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        <section className="card">
          <h2>Tasting notes</h2>
          <p className="muted small">
            {n.thisYear} note{n.thisYear === 1 ? "" : "s"} in {year}.{" "}
            <a href={href("notes")}>Search notes →</a>
          </p>
          {n.topRegions.length > 0 && (
            <>
              <h3 className="ov-sub">Best-scoring regions</h3>
              <Scores bars={n.topRegions} />
            </>
          )}
          {n.topGrapes.length > 0 && (
            <>
              <h3 className="ov-sub">Best-scoring grapes</h3>
              <Scores bars={n.topGrapes} />
            </>
          )}
          <p className="muted small">Averages need at least 3 scored notes.</p>
        </section>
      </div>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Horizontal bars: label, bar, value. Tapping a bar opens the cellar filtered to it. */
function Bars({ bars, unit, dot, onPick }: { bars: Bar[]; unit: string; dot?: boolean; onPick?: (b: Bar) => void }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  if (bars.length === 0) return <p className="muted">No bottles.</p>;
  return (
    <ul className="bars">
      {bars.map((b) => {
        const title = `${b.label}: ${b.value} ${unit}${b.value === 1 ? "" : "s"}${b.sub ? ` · ${b.sub}` : ""}`;
        const body = (
          <>
            <span className="bar-label">
              {dot && <TypeDot type={b.key} />}
              {b.label}
            </span>
            <span className="bar-track">
              <span className={`bar-fill${dot ? ` t-${b.key.toLowerCase().replace(/[^a-z]/g, "")}` : ""}`} style={{ width: `${(b.value / max) * 100}%` }} />
            </span>
            <span className="bar-value">{b.value.toLocaleString()}</span>
          </>
        );
        return (
          <li key={b.key} title={title}>
            {onPick ? (
              <button className="bar-row" onClick={() => onPick(b)} aria-label={title}>{body}</button>
            ) : (
              <div className="bar-row">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Average scores, shown on an 80–100 scale. */
function Scores({ bars }: { bars: Bar[] }) {
  return (
    <ul className="bars">
      {bars.map((b) => (
        <li key={b.key} title={`${b.label}: average ${b.value} from ${b.sub}`}>
          <div className="bar-row">
            <span className="bar-label">
              {b.label} <span className="muted small">({b.sub})</span>
            </span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(2, ((b.value - 80) / 20) * 100)}%` }} />
            </span>
            <span className="bar-value">{b.value}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Small column chart for bottles per month. */
function Columns({ bars }: { bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="cols" role="img" aria-label={bars.map((b) => `${b.label} ${b.value}`).join(", ")}>
      {bars.map((b) => (
        <button
          key={b.key}
          className="col"
          title={`${b.label}: ${b.value} bottle${b.value === 1 ? "" : "s"}`}
          onClick={() => go(`history/${b.key}`)}
        >
          <span className="col-value">{b.value || ""}</span>
          <span className="col-bar" style={{ height: `${(b.value / max) * 100}%` }} />
          <span className="col-label">{b.label}</span>
        </button>
      ))}
    </div>
  );
}
