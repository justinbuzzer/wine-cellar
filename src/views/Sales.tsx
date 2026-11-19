import { useMemo, useState } from "react";
import { Columns } from "../charts";
import { config } from "../config";
import { formatPrice } from "../data";
import { todayIso } from "../notesmodel";
import { go, href } from "../router";
import { deleteSale } from "../sales";
import {
  byField,
  byHeld,
  byMonthKey,
  formatHeld,
  formatPct,
  heldYears,
  newestSales,
  saleMoney,
  salesByMonth,
  salesTotals,
  type Group,
  type Sale,
} from "../salesmodel";
import { describeError, useWorkbook } from "../store";
import { bottles, useToast } from "../ui";
import { formatDay } from "./WineDetail";

const money = (n: number | null) => formatPrice(n === null ? null : Math.round(n), config.currency);
const exact = (n: number | null) => formatPrice(n === null ? null : Math.round(n * 100) / 100, config.currency);
const wineLabel = (s: Sale) => [s.producer, s.name].filter(Boolean).join(" ");

/** Sales, with what they made over the purchase price. `period` is "2026" or "2026-11". */
export default function Sales({ period }: { period?: string }) {
  const { data, removeSale } = useWorkbook();
  const toast = useToast();
  const today = todayIso();
  const [busy, setBusy] = useState<string | null>(null);
  const month = period && /^\d{4}-\d{2}$/.test(period) ? period : undefined;
  const [year, setYear] = useState<string>(period ? period.slice(0, 4) : "");

  const years = [...new Set(data.sales.map((s) => s.date?.slice(0, 4)).filter((y): y is string => !!y))].sort().reverse();
  const shown = useMemo(
    () => newestSales(data.sales.filter((s) => (month ? s.date?.startsWith(month) : !year || s.date?.startsWith(year)))),
    [data.sales, month, year],
  );
  const t = useMemo(() => salesTotals(shown), [shown]);
  const chartEnd = year && year !== today.slice(0, 4) ? `${year}-12-31` : today;
  const months = useMemo(() => salesByMonth(data.sales, chartEnd), [data.sales, chartEnd]);
  const held = useMemo(() => byHeld(shown), [shown]);
  const buyers = useMemo(() => byField(shown, (s) => s.buyer, "Not recorded"), [shown]);
  const types = useMemo(() => byField(shown, (s) => s.type, "Other"), [shown]);

  async function remove(s: Sale) {
    const what = `${wineLabel(s)} ${s.vintage ?? ""}`.trim();
    if (!window.confirm(`Remove the sale of "${what}" on ${formatDay(s.date)}? Bottle counts won't change.`)) return;
    setBusy(s.saleId);
    try {
      await deleteSale(data.file.id, s.saleId);
      removeSale(s.saleId);
      toast({ text: "Sale removed." });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  const periodLabel = month
    ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-SG", { month: "long", year: "numeric", timeZone: "UTC" })
    : year || "All time";

  return (
    <>
      <a className="back" href={href("overview")}>← Overview</a>
      <section className="card">
        <div className="card-head">
          <h2>Sales · {periodLabel}</h2>
          {month ? (
            <button className="link" onClick={() => go("sales")}>Show all</button>
          ) : (
            years.length > 0 && (
              <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
                <option value="">All years</option>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            )
          )}
        </div>
        {data.sales.length === 0 ? (
          <p className="muted">Nothing sold yet. Use 💰 Sell on a wine's page and it appears here.</p>
        ) : shown.length === 0 ? (
          <p className="muted">Nothing sold in this period.</p>
        ) : (
          <p className="muted small">
            Gains compare the sale price with what you paid. Sales are kept apart from the bottle history.
          </p>
        )}
      </section>

      {shown.length > 0 && (
        <>
          <div className="stats six">
            <Tile label="Bottles sold" value={t.bottles.toLocaleString()} sub={`${t.sales} sale${t.sales === 1 ? "" : "s"}`} />
            <Tile label="Sold for" value={money(t.revenue)} sub={t.bottles ? `${exact(t.revenue / t.bottles)} a bottle on average` : undefined} />
            <Tile
              label="Paid"
              value={t.cost ? money(t.cost) : "–"}
              sub={t.unpricedBottles ? `${bottles(t.unpricedBottles)} with no purchase price left out` : "purchase price of the bottles sold"}
            />
            <Tile
              label={t.gain >= 0 ? "Gain" : "Loss"}
              value={t.cost ? money(Math.abs(t.gain)) : "–"}
              sub={t.pct !== null ? `${formatPct(t.pct)} on what you paid` : undefined}
            />
            <Tile
              label="Average time kept"
              value={formatHeld(t.avgHeldYears)}
              sub={t.datedBottles < t.bottles ? `${t.datedBottles} of ${bottles(t.bottles)} have a year bought` : "from buying to selling"}
            />
            <Tile label="Yearly return" value={formatPct(t.annual)} sub={t.annual !== null ? "compound, over the average time kept" : "needs the year bought, kept 1+ years"} />
          </div>

          <div className="ov-grid">
            {!month && (
              <section className="card">
                <h2>Bottles sold by month</h2>
                <Columns
                  bars={months}
                  title={(b) => `${b.label}: ${b.value} bottle${b.value === 1 ? "" : "s"} sold for ${money((b as (typeof months)[number]).revenue)}`}
                  onPick={(b) => go(`sales/${b.key}`)}
                />
                <p className="muted small">
                  {chartEnd === today ? "The last 12 months." : `${year}.`} Tap a month to see its sales.
                </p>
              </section>
            )}

            <section className="card">
              <h2>By time kept</h2>
              {held.length === 0 ? (
                <p className="muted">Add the year you bought a wine when you sell it to see how holding time affects the return.</p>
              ) : (
                <GroupTable groups={held} first="Kept" />
              )}
            </section>

            <section className="card">
              <h2>By type</h2>
              <GroupTable groups={types} first="Type" />
            </section>

            {buyers.some((g) => g.key !== "Not recorded") && (
              <section className="card">
                <h2>By buyer</h2>
                <GroupTable groups={buyers} first="Buyer" />
              </section>
            )}
          </div>

          <section className="card">
            <h2>Paid vs sold</h2>
            <PaidVsSold sales={shown} />
          </section>

          {byMonthKey(shown).map((g) => (
            <section className="card" key={g.key}>
              <h2>
                {g.label} <span className="muted small">· {bottles(g.entries.reduce((n, s) => n + s.bottles, 0))}</span>
              </h2>
              <ul className="history-list">
                {g.entries.map((s) => {
                  const m = saleMoney(s);
                  const d = heldYears(s);
                  return (
                    <li key={s.saleId}>
                      <span className="h-date">{formatDay(s.date)}</span>
                      <span className="h-wine">
                        {s.wineId ? <a href={href(`wine/${s.wineId}`)}>{wineLabel(s)}</a> : wineLabel(s)} <span className="muted">{s.vintage}</span>
                        <span className="h-meta muted">
                          {[
                            `${bottles(s.bottles)} at ${exact(s.salePrice)}`,
                            s.boughtPrice !== null ? `paid ${exact(s.boughtPrice)}` : "purchase price unknown",
                            d !== null ? `kept ${formatHeld(d).toLowerCase()}` : null,
                            s.buyer,
                            s.notes,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="h-actions">
                        <span className="sale-gain">
                          {m.gain !== null ? `${m.gain >= 0 ? "+" : "−"}${money(Math.abs(m.gain))}` : ""}
                          {m.pct !== null && <span className="muted small"> {formatPct(m.pct)}</span>}
                        </span>
                        <button
                          className="link"
                          aria-label="Remove sale"
                          title="Remove sale"
                          disabled={busy === s.saleId}
                          onClick={() => void remove(s)}
                        >
                          ✕
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
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

function GroupTable({ groups, first }: { groups: Group[]; first: string }) {
  return (
    <div className="scroll">
      <table className="grid tight">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="num">Bottles</th>
            <th className="num">Sold for</th>
            <th className="num">Return</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <td>{g.key}</td>
              <td className="num">{g.totals.bottles}</td>
              <td className="num">{money(g.totals.revenue)}</td>
              <td className="num" title={g.totals.cost ? `${money(g.totals.gain)} on ${money(g.totals.cost)} paid` : "No purchase price"}>
                {formatPct(g.totals.pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One row per sale: a line from the price paid to the price sold, per bottle, on a shared scale. Best return first. */
function PaidVsSold({ sales }: { sales: Sale[] }) {
  const rows = [...sales].sort((a, b) => (saleMoney(b).pct ?? -Infinity) - (saleMoney(a).pct ?? -Infinity));
  const max = Math.max(1, ...sales.flatMap((s) => [s.salePrice ?? 0, s.boughtPrice ?? 0]));
  const x = (v: number) => `${(v / max) * 100}%`;
  return (
    <>
      <div className="dumb-legend muted small">
        <span><span className="dumb-dot paid" /> Paid</span>
        <span><span className="dumb-dot sold" /> Sold</span>
        <span>per bottle, best return first</span>
      </div>
      <ul className="dumb-list">
        {rows.map((s) => {
          const m = saleMoney(s);
          const lo = Math.min(s.boughtPrice ?? s.salePrice ?? 0, s.salePrice ?? 0);
          const hi = Math.max(s.boughtPrice ?? 0, s.salePrice ?? 0);
          const title = `${wineLabel(s)} ${s.vintage ?? ""}: paid ${exact(s.boughtPrice) || "unknown"}, sold ${exact(s.salePrice)}${m.pct !== null ? ` (${formatPct(m.pct)})` : ""}`;
          return (
            <li key={s.saleId} title={title}>
              <div className="dumb-head">
                <span className="dumb-name">
                  {wineLabel(s)} <span className="muted">{s.vintage}</span>
                </span>
                <span className="dumb-values">
                  {s.boughtPrice !== null ? exact(s.boughtPrice) : "?"} → {exact(s.salePrice)}
                  <strong> {formatPct(m.pct)}</strong>
                </span>
              </div>
              <div className="dumb-track" aria-hidden>
                {s.boughtPrice !== null && <span className="dumb-line" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />}
                {s.boughtPrice !== null && <span className="dumb-dot paid" style={{ left: x(s.boughtPrice) }} />}
                {s.salePrice !== null && <span className="dumb-dot sold" style={{ left: x(s.salePrice) }} />}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
