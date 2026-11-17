import { useLayoutEffect, useMemo, useState } from "react";
import { shortName, type Tasting } from "../data";
import { EMPTY_QUERY, fold, highlightParts, searchNotes, tokens, type NoteQuery, type NoteSort } from "../notesearch";
import { go, href } from "../router";
import { useWorkbook } from "../store";
import { restoreListPosition, TypeDot } from "../ui";

// Kept outside the component so the search survives opening a note and coming back.
let saved: NoteQuery = EMPTY_QUERY;
let savedShown = 50;
/** The note you last opened, highlighted when you come back to the list. */
let lastOpened: string | null = null;

const PAGE = 50;
const SCORES = [85, 88, 90, 92, 94, 96];

const uniq = (xs: (string | number | null)[]) =>
  [...new Set(xs.filter((x): x is string | number => x !== null && x !== "").map(String))].sort((a, b) => a.localeCompare(b));

export default function Notes() {
  const { data } = useWorkbook();
  const [f, setF] = useState<NoteQuery>(saved);
  const [shown, setShown] = useState(savedShown);
  const [showFilters, setShowFilters] = useState(
    () => JSON.stringify({ ...saved, q: "", sort: "" }) !== JSON.stringify({ ...EMPTY_QUERY, q: "", sort: "" }),
  );
  const update = (p: Partial<NoteQuery>) => {
    setF((prev) => (saved = { ...prev, ...p }));
    setShown((savedShown = PAGE));
  };

  // Coming back from a note: return to the same spot and highlight that note.
  useLayoutEffect(() => {
    restoreListPosition("notes", lastOpened ? `[data-note="${CSS.escape(lastOpened)}"]` : null);
  }, []);

  const all = data.tastings;
  const typeOrder = data.lists["List_Type"] ?? [];
  const types = uniq(all.map((t) => t.type)).sort((a, b) => (typeOrder.indexOf(a) + 1 || 99) - (typeOrder.indexOf(b) + 1 || 99));
  const countries = uniq(all.map((t) => t.country));
  const regions = uniq(all.filter((t) => !f.country || t.country === f.country).map((t) => t.region));
  const years = uniq(all.map((t) => t.yearTasted)).reverse();
  const varietals = useMemo(() => uniq(all.map((t) => t.varietal)), [all]);
  const sources = useMemo(() => uniq(all.map((t) => t.source)), [all]);

  const results = useMemo(() => searchNotes(all, f), [all, f]);
  const words = tokens(f.q);
  const filtersActive = JSON.stringify({ ...f, q: "", sort: "" }) !== JSON.stringify({ ...EMPTY_QUERY, q: "", sort: "" });
  const scored = results.filter((t) => t.score !== null);
  const avg = scored.length ? scored.reduce((s, t) => s + (t.score ?? 0), 0) / scored.length : null;

  return (
    <>
      <div className="toolbar">
        <div className="search-row">
          <input
            className="search"
            type="search"
            placeholder="Search notes: wine, aroma, region, who…"
            value={f.q}
            onChange={(e) => update({ q: e.target.value })}
          />
          <button className="primary" onClick={() => go("note/new")}>✍ New</button>
        </div>
        <div className="filter-bar">
          <button className={filtersActive ? "on" : ""} onClick={() => setShowFilters((v) => !v)}>
            Filters{filtersActive ? " •" : ""}
          </button>
          <select value={f.sort} onChange={(e) => update({ sort: e.target.value as NoteSort })} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="score">Highest score</option>
            <option value="name">Wine name</option>
          </select>
        </div>
        {showFilters && (
          <div className="filters">
            <select value={f.type} onChange={(e) => update({ type: e.target.value })} aria-label="Type">
              <option value="">All types</option>
              {types.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={f.country} onChange={(e) => update({ country: e.target.value, region: "" })} aria-label="Country">
              <option value="">All countries</option>
              {countries.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={f.region} onChange={(e) => update({ region: e.target.value })} aria-label="Region">
              <option value="">All regions</option>
              {regions.map((r) => <option key={r}>{r}</option>)}
            </select>
            <input
              value={f.varietal}
              onChange={(e) => update({ varietal: e.target.value })}
              placeholder="Grape"
              list="dl-notes-varietal"
              aria-label="Grape"
            />
            <select value={f.minScore} onChange={(e) => update({ minScore: Number(e.target.value) })} aria-label="Minimum score">
              <option value={0}>Any score</option>
              {SCORES.map((s) => <option key={s} value={s}>{s}+</option>)}
            </select>
            <select value={f.year} onChange={(e) => update({ year: e.target.value })} aria-label="Year tasted">
              <option value="">Any year</option>
              {years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <input
              value={f.source}
              onChange={(e) => update({ source: e.target.value })}
              placeholder="Who / where"
              list="dl-notes-source"
              aria-label="Source"
            />
            <datalist id="dl-notes-varietal">{varietals.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-notes-source">{sources.map((v) => <option key={v} value={v} />)}</datalist>
          </div>
        )}
      </div>

      <div className="summary">
        <span>
          <strong>{results.length.toLocaleString()}</strong>
          {results.length === all.length ? " tasting notes" : ` of ${all.length.toLocaleString()} notes`}
          {avg !== null && <span className="muted"> · average {avg.toFixed(1)}</span>}
        </span>
        {(filtersActive || f.q) && (
          <button className="link" onClick={() => update({ ...EMPTY_QUERY, sort: f.sort })}>Clear</button>
        )}
      </div>

      {results.length === 0 ? (
        <p className="muted center-text">No notes match.</p>
      ) : (
        <section className="card notes-list">
          {results.slice(0, shown).map((t) => <ResultRow key={t.tastingId} t={t} words={words} />)}
          {results.length > shown && (
            <button className="show-more" onClick={() => setShown((savedShown = shown + PAGE))}>
              Show more ({(results.length - shown).toLocaleString()} left)
            </button>
          )}
        </section>
      )}
    </>
  );
}

function Hl({ text, words }: { text: string | number | null; words: string[] }) {
  if (text === null || text === "") return null;
  return (
    <>
      {highlightParts(String(text), words).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function ResultRow({ t, words }: { t: Tasting; words: string[] }) {
  const matchesIn = (s: string | null) => !!s && words.some((w) => fold(s).includes(w));
  const showTaste = t.taste && t.taste !== t.nose && matchesIn(t.taste);
  const showNote = t.note && (matchesIn(t.note) || !words.length);
  return (
    <a
      className="tasting-row note-link result"
      href={href(`note/${t.tastingId}`)}
      data-note={t.tastingId ?? undefined}
      onClick={() => {
        lastOpened = t.tastingId;
      }}
    >
      <div className="result-head">
        <span className="result-score">{t.score ?? "–"}</span>
        <div className="result-wine">
          <div>
            <TypeDot type={t.type} />{" "}
            {t.producer && <strong><Hl text={t.producer} words={words} /> </strong>}
            <Hl text={shortName(t)} words={words} /> <span className="muted">{t.vintage}</span>
          </div>
          <div className="muted small">
            <Hl text={[t.location, t.region, t.country].filter(Boolean).join(" · ")} words={words} />
          </div>
          <div className="muted small">
            {t.dateTasted ?? t.yearTasted}
            {t.source && <> · <Hl text={t.source} words={words} /></>}
          </div>
        </div>
      </div>
      {t.nose && <p className="tasting-text clamp"><Hl text={t.nose} words={words} /></p>}
      {showTaste && <p className="tasting-text clamp"><span className="muted">Palate:</span> <Hl text={t.taste} words={words} /></p>}
      {showNote && <p className="tasting-text clamp"><Hl text={t.note} words={words} /></p>}
    </a>
  );
}
