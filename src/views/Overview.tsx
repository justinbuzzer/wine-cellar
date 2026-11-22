import { useMemo } from "react";
import { config } from "../config";
import { formatPrice } from "../data";
import { LOCATIONS, type Location } from "../locations";
import { useLogos } from "../logos";
import { producerGroups } from "../producers";
import { todayIso } from "../notesmodel";
import { cellarStats, drinkingStats, MIN_NOTES, noteStats, regionLabel, topN, type Bar } from "../overview";
import { showInNotes } from "./Notes";
import { go, href } from "../router";
import { useWorkbook } from "../store";
import { useStocktake } from "../stocktake";
import { TypeDot } from "../ui";
import { TYPE_ORDER, typeLabel } from "../winelist";
import { showInCellar } from "./Cellar";
import { Columns } from "../charts";
import { formatPct, salesByMonth, salesTotals } from "../salesmodel";

const money = (n: number) => formatPrice(n, config.currency);

/** Link to the Producers page with how many producers have a logo so far. */
function LogoProgress() {
  const { data } = useWorkbook();
  const logos = useLogos();
  const groups = useMemo(() => producerGroups(data.wines), [data.wines]);
  const done = groups.filter((g) => logos.get(g.name)).length;
  // Only worth showing while some producers still need one (and once the logo
  // folder has been read, so it doesn't flash up while loading).
  if (logos.status === "loading" || done >= groups.length) return null;
  return (
    <a className="card prompt-card" href={href("producers")}>
      <strong>Producer logos</strong>
      <span className="muted">
        {done} of {groups.length} producers have one →
      </span>
    </a>
  );
}

/** Link to the stocktake, with progress while one is under way. */
function StocktakeLink() {
  const st = useStocktake();
  const counted = st ? Object.keys(st.counts).length : 0;
  return (
    <a className="card prompt-card" href={href("stocktake")}>
      <strong>Stocktake</strong>
      <span className="muted">{st ? `In progress: ${counted} wine${counted === 1 ? "" : "s"} counted →` : "Check your bottles against your list →"}</span>
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
      <StocktakeLink />

      <div className="ov-grid">
        <section className="card">
          <div className="card-head">
            <h2>Where</h2>
            <button className="primary icon-btn" onClick={() => go("storage")} aria-label="Boxes and racks" title="Boxes and racks">📦</button>
          </div>
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
          <Bars bars={c.byVintage} unit="bottle" onPick={(b) => showInCellar({ vintage: b.key })} />
        </section>

        <div className="ov-stack">
          <section className="card ov-half">
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
                <Columns bars={d.months} compact onPick={(b) => go(`history/${b.key}`)} />
                <p className="muted small">
                  {d.thisYear} bottle{d.thisYear === 1 ? "" : "s"} in {year}
                  {d.thisYearValue > 0 && <>, worth {money(d.thisYearValue)} at purchase price</>}.
                </p>
              </>
            )}
          </section>
          <SalesCard today={today} />
        </div>

        <section className="card">
          <h2>Tasting notes</h2>
          <p className="muted small">
            {n.thisYear} note{n.thisYear === 1 ? "" : "s"} in {year}.{" "}
            <a href={href("notes")}>Search notes →</a>
          </p>
          {n.topRegions.length > 0 && (
            <>
              <h3 className="ov-sub">Best-scoring regions</h3>
              <Scores
                bars={n.topRegions}
                onPick={(b) => {
                  const t = data.tastings.find((x) => regionLabel(x) === b.key);
                  if (t) showInNotes({ country: t.country ?? "", region: t.region ?? "" });
                }}
              />
            </>
          )}
          {n.topSingles.length > 0 && (
            <>
              <h3 className="ov-sub">Best-scoring grapes · single varietal</h3>
              <Scores bars={n.topSingles} onPick={(b) => showInNotes({ varietal: b.key, kind: "single" })} />
            </>
          )}
          {n.topBlends.length > 0 && (
            <>
              <h3 className="ov-sub">Best-scoring blends</h3>
              <Scores bars={n.topBlends} onPick={(b) => showInNotes({ varietal: b.key, kind: "blend" })} />
            </>
          )}
          <p className="muted small">Averages need at least {MIN_NOTES} scored notes.</p>
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
function Scores({ bars, onPick }: { bars: Bar[]; onPick: (b: Bar) => void }) {
  return (
    <ul className="bars">
      {bars.map((b) => {
        const title = `${b.label}: average ${b.value} from ${b.sub}`;
        return (
          <li key={b.key} title={title}>
            <button className="bar-row" onClick={() => onPick(b)} aria-label={`${title}. Show these notes`}>
              <span className="bar-label">
                {b.label} <span className="muted small">({b.sub})</span>
              </span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.max(2, ((b.value - 80) / 20) * 100)}%` }} />
              </span>
              <span className="bar-value">{b.value}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Sales this year: how many, what they brought in, and the gain over what you paid. */
function SalesCard({ today }: { today: string }) {
  const { data } = useWorkbook();
  const year = today.slice(0, 4);
  const months = useMemo(() => salesByMonth(data.sales, today), [data.sales, today]);
  const t = useMemo(() => salesTotals(data.sales.filter((s) => s.date?.startsWith(year))), [data.sales, year]);
  return (
    <section className="card ov-half">
      <div className="card-head">
        <h2>Sales</h2>
        <a href={href("sales")}>Details →</a>
      </div>
      {data.sales.length === 0 ? (
        <p className="muted">Nothing sold yet. When you use 💰 Sell on a wine's page, it's recorded here.</p>
      ) : (
        <>
          <Columns
            bars={months}
            compact
            title={(b) => `${b.label}: ${b.value} bottle${b.value === 1 ? "" : "s"} sold for ${money((b as (typeof months)[number]).revenue)}`}
            onPick={(b) => go(`sales/${b.key}`)}
          />
          <p className="muted small">
            {t.bottles} sold in {year} for {money(t.revenue)}
            {t.cost > 0 && (
              <>
                {" "}· paid {money(t.cost)} · {t.gain >= 0 ? "gain" : "loss"} {money(Math.abs(t.gain))} ({formatPct(t.pct)})
              </>
            )}
            .
          </p>
        </>
      )}
    </section>
  );
}
