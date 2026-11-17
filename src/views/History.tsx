import { useState } from "react";
import { config } from "../config";
import { formatPrice } from "../data";
import { deleteOpening } from "../history";
import { byMonth, newestOpenings, noteFor, type Opening } from "../historymodel";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { useToast } from "../ui";
import { formatDay } from "./WineDetail";

/** Bottle history, newest first. `month` ("2026-11") narrows it to one month. */
export default function History({ month }: { month?: string }) {
  const { data, removeOpening } = useWorkbook();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const years = [...new Set(data.history.map((o) => o.date?.slice(0, 4)).filter((y): y is string => !!y))].sort().reverse();
  const [year, setYear] = useState<string>(month ? month.slice(0, 4) : "");

  const shown = newestOpenings(
    data.history.filter((o) => (month ? o.date?.startsWith(month) : !year || o.date?.startsWith(year))),
  );
  const value = shown.reduce((s, o) => s + (o.price ?? 0), 0);

  async function remove(o: Opening) {
    if (!window.confirm(`Remove "${[o.producer, o.name, o.vintage].filter(Boolean).join(" ")}" opened ${formatDay(o.date)} from the history? Bottle counts won't change.`)) return;
    setBusy(o.openId);
    try {
      await deleteOpening(data.file.id, o.openId);
      removeOpening(o.openId);
      toast({ text: "Removed from the history." });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <a className="back" href={href("overview")}>← Overview</a>
      <section className="card">
        <div className="card-head">
          <h2>Bottle history</h2>
          {month ? (
            <button className="link" onClick={() => go("history")}>Show all</button>
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
        {data.history.length === 0 ? (
          <p className="muted">No bottles recorded yet. Use 🍷 Open a bottle on a wine's page and it appears here.</p>
        ) : (
          <p className="muted small">
            {shown.length} bottle{shown.length === 1 ? "" : "s"}
            {value > 0 && <> · {formatPrice(Math.round(value), config.currency)} at purchase price</>}
          </p>
        )}
      </section>

      {shown.length === 0 && data.history.length > 0 && <p className="muted center-text">Nothing opened in this period.</p>}

      {byMonth(shown).map((g) => (
        <section className="card" key={g.key}>
          <h2>
            {g.label} <span className="muted small">· {g.entries.length}</span>
          </h2>
          <ul className="history-list">
            {g.entries.map((o) => {
              const note = noteFor(o, data.tastings);
              const title = [o.producer, o.name].filter(Boolean).join(" ");
              return (
                <li key={o.openId}>
                  <span className="h-date">{formatDay(o.date)}</span>
                  <span className="h-wine">
                    {o.wineId ? <a href={href(`wine/${o.wineId}`)}>{title}</a> : title} <span className="muted">{o.vintage}</span>
                    <span className="h-meta muted">{[o.from, o.occasion].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="h-actions">
                    {note ? (
                      <a href={href(`note/${note.tastingId}`)}>Note{note.score ? ` · ${note.score}` : ""}</a>
                    ) : (
                      o.wineId && <a className="muted" href={href(`note/new/wine/${o.wineId}`)}>+ Note</a>
                    )}
                    <button
                      className="link"
                      aria-label="Remove from history"
                      title="Remove from history"
                      disabled={busy === o.openId}
                      onClick={() => void remove(o)}
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
  );
}
