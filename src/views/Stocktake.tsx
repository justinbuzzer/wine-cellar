import { memo, useEffect, useMemo, useState } from "react";
import { config } from "../config";
import { shortName, toTable, toWine, type Wine } from "../data";
import { Workbook } from "../graph";
import type { Location } from "../locations";
import { todayIso } from "../notesmodel";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import {
  applyPlan, endStocktake, pickUpSaved, readPastStocktakes, savePlan, setChoice, setCount, startStocktake, undoStocktake,
  updateStocktake, useStocktake, useStocktakeSync, type PastStocktake,
} from "../stocktake";
import {
  buildPlan, countList, differences, expectedAt, isNya, keyOf, LOC_SLUG, locFromSlug, LOCS, missingReasons, newStocktake,
  parseKey, planTotals, progress, reasonLabel, reasonsFor, wineLabel, type CountEntry, type Diff, type Plan, type Stocktake as St,
} from "../stocktakemodel";
import { bottles, ChipGroup, FilterHeader, TypeDot, useToast } from "../ui";

export default function Stocktake({ step, arg }: { step?: string; arg?: string }) {
  const { data } = useWorkbook();
  if (!data.hasLocations) {
    return (
      <section className="card">
        <h2>Stocktake</h2>
        <p>The Inventory table needs its Qty K Cellars and Qty Home columns before you can do a stocktake.</p>
      </section>
    );
  }
  if (step === "count") {
    const loc = locFromSlug(arg);
    return loc ? <Count key={loc} loc={loc} /> : <Home />;
  }
  if (step === "review") return <Review />;
  return <Home />;
}

/** Shown on the start page after applying (kept here so it survives the page change). */
let lastApplied: { changed: number; skipped: string[] } | null = null;

const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "No date";
const fmtWhen = (ms: number) => new Date(ms).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function SyncLine() {
  const s = useStocktakeSync();
  const text =
    s.state === "saving" ? "Saved on this phone · copying to your workbook…"
    : s.state === "pending" ? "Saved on this phone · copies to your workbook shortly"
    : s.state === "failed" ? "Saved on this phone · couldn't copy to your workbook yet (will retry)"
    : s.at ? `Saved on this phone and in your workbook (${fmtWhen(s.at)})`
    : "Saved on this phone";
  return <p className={`muted small st-sync${s.state === "failed" ? " warn" : ""}`}>{text}</p>;
}

function Bar({ value, total }: { value: number; total: number }) {
  return (
    <div className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
      <i style={{ width: `${total ? Math.round((value / total) * 100) : 0}%` }} />
    </div>
  );
}

// ---- Start page ---------------------------------------------------------------------

function Home() {
  const { data, reload } = useWorkbook();
  const toast = useToast();
  const file = data.file.id;
  const st = useStocktake();
  const [past, setPast] = useState<PastStocktake[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(lastApplied);

  const loadPast = () =>
    readPastStocktakes(file).then(setPast, (e) => {
      setPast([]);
      toast({ text: `Couldn't read past stocktakes: ${describeError(e)}`, error: true });
    });

  useEffect(() => {
    void loadPast();
    // Progress saved from another device takes over if it's newer.
    pickUpSaved(file).then(
      (took) => took && toast({ text: "Picked up the stocktake saved in your workbook." }),
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  async function undo(p: PastStocktake) {
    if (!window.confirm(`Undo the stocktake of ${fmtDate(p.date)}? Bottle counts it changed go back to what they were (unless they've changed since), and the history and sales rows it added are removed.`)) return;
    setBusy(p.id);
    try {
      const r = await undoStocktake(file, p.id);
      await reload();
      toast({ text: `Stocktake undone: ${r.reverted} wine${r.reverted === 1 ? "" : "s"} put back${r.skipped.length ? `, ${r.skipped.length} left as they are` : ""}.` });
      if (r.skipped.length) setDone({ changed: r.reverted, skipped: r.skipped });
      await loadPast();
    } catch (e) {
      toast({ text: `Couldn't undo: ${describeError(e)}`, error: true });
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!st) return;
    const n = Object.keys(st.counts).length;
    if (!window.confirm(`Discard this stocktake? The ${n} wine${n === 1 ? "" : "s"} you've counted will be forgotten. Your cellar list isn't changed.`)) return;
    try {
      await endStocktake(file);
    } catch (e) {
      toast({ text: `Discarded here, but couldn't remove the progress sheet: ${describeError(e)}`, error: true });
    }
  }

  return (
    <>
      <a className="back" href={href("cellar")}>← Cellar</a>
      {done && (
        <section className="card st-done">
          <div className="card-head">
            <h2>Stocktake applied</h2>
            <button className="link" onClick={() => { lastApplied = null; setDone(null); }} aria-label="Dismiss">✕</button>
          </div>
          <p>{done.changed} wine{done.changed === 1 ? "" : "s"} updated in your workbook.</p>
          {done.skipped.length > 0 && (
            <>
              <p className="warn small">Left as they are, because they changed in the meantime:</p>
              <ul className="small">{done.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
            </>
          )}
        </section>
      )}

      {!st ? (
        <section className="card">
          <h2>Stocktake</h2>
          <p>Check the bottles on your shelves against your list, one location at a time.</p>
          <ul className="st-howto">
            <li>Tap <b>✓</b> when a wine's count is right, or <b>−</b> / <b>+</b> to the real number.</li>
            <li>Every tap is saved, so you can stop and carry on another day, even on another device.</li>
            <li>Then review only the differences, say why for each, and apply. Nothing in your workbook changes until then, and it can be undone.</li>
          </ul>
          <button className="primary" onClick={() => startStocktake(file, newStocktake())}>Start a stocktake</button>
        </section>
      ) : (
        <InProgress st={st} onDiscard={discard} />
      )}

      <section className="card">
        <h2>Past stocktakes</h2>
        {past === null ? (
          <p className="muted">Loading…</p>
        ) : past.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="st-past">
            {past.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{fmtDate(p.date)}</strong>
                  <div className="muted small">
                    {p.wines} wine{p.wines === 1 ? "" : "s"} changed · {p.net > 0 ? "+" : p.net < 0 ? "−" : ""}{bottles(Math.abs(p.net))} overall
                  </div>
                </div>
                <button className="small" disabled={busy !== null} onClick={() => void undo(p)}>{busy === p.id ? "Undoing…" : "Undo"}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function InProgress({ st, onDiscard }: { st: St; onDiscard: () => void }) {
  const { data } = useWorkbook();
  const { diffs, arrivals } = differences(st, data.wines);
  const toExplain = diffs.filter((d) => d.rest !== 0).length;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Stocktake in progress</h2>
        <span className="muted small">started {fmtWhen(st.started)}</span>
      </div>
      {st.plan && (
        <p className="notice">Applying was interrupted. Open the review to finish it; nothing will be done twice.</p>
      )}
      {LOCS.map((loc) => {
        const p = progress(st, data.wines, loc);
        return (
          <div className="st-loc" key={loc}>
            <div className="st-loc-head">
              <strong>{loc}</strong>
              <span className="muted small">
                {p.checked} of {p.total} checked{p.differences ? ` · ${p.differences} different` : ""}
              </span>
            </div>
            <Bar value={p.checked} total={p.total} />
            <button disabled={!!st.plan} onClick={() => go(`stocktake/count/${LOC_SLUG[loc]}`)}>
              {p.checked ? `Carry on counting ${loc}` : `Count ${loc}`}
            </button>
          </div>
        );
      })}
      <div className="actions">
        <button className="primary" onClick={() => go("stocktake/review")}>
          {st.plan ? "Finish applying" : `Review ${diffs.length + arrivals.length} difference${diffs.length + arrivals.length === 1 ? "" : "s"}`}
        </button>
        <button className="link" onClick={onDiscard}>Discard stocktake</button>
      </div>
      {toExplain > 0 && !st.plan && <p className="muted small">{toExplain} need a reason before you can apply.</p>}
      <SyncLine />
    </section>
  );
}

// ---- Counting -----------------------------------------------------------------------

type Sort = "region" | "producer" | "type";
const SORT_LABEL: Record<Sort, string> = { region: "Region", producer: "Producer", type: "Type" };
const text = (s: string | null | undefined) => (s ?? "").toLocaleLowerCase();
const vnum = (w: Wine) => (typeof w.vintage === "number" ? w.vintage : -1);

function groupOf(w: Wine, sort: Sort): string {
  if (sort === "region") return [w.country, w.region].filter(Boolean).join(" · ") || "No region";
  if (sort === "type") return w.type || "No type";
  return (w.producer ?? "#").trim().charAt(0).toUpperCase() || "#";
}

function compare(sort: Sort) {
  const byProducer = (a: Wine, b: Wine) =>
    text(a.producer).localeCompare(text(b.producer)) || text(a.name).localeCompare(text(b.name)) || vnum(a) - vnum(b);
  return (a: Wine, b: Wine) => groupOf(a, sort).localeCompare(groupOf(b, sort)) || byProducer(a, b);
}

function matches(w: Wine, words: string[]): boolean {
  if (!words.length) return true;
  const hay = [w.producer, w.name, w.vintage, w.region, w.location, w.country, w.varietal, w.type, w.wineId].join(" ").toLocaleLowerCase();
  return words.every((t) => hay.includes(t));
}

// Kept while you move between the count, review and other pages.
const countPrefs: { sort: Sort; hide: boolean } = { sort: "region", hide: false };

function Count({ loc }: { loc: Location }) {
  const { data } = useWorkbook();
  const file = data.file.id;
  const st = useStocktake();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>(countPrefs.sort);
  const [hide, setHide] = useState(countPrefs.hide);
  const [finding, setFinding] = useState(false);
  const [fq, setFq] = useState("");

  const { expected, onOrder } = useMemo(() => countList(data.wines, loc), [data.wines, loc]);
  const listed = useMemo(() => new Set([...expected, ...onOrder].map((w) => w.wineId)), [expected, onOrder]);
  const byId = useMemo(() => new Map(data.wines.map((w) => [w.wineId, w])), [data.wines]);

  if (!st) {
    return (
      <section className="card">
        <p>No stocktake in progress.</p>
        <a href={href("stocktake")}>Start one →</a>
      </section>
    );
  }
  const counts = st.counts;
  const locked = !!st.plan;
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const keep = (w: Wine) => matches(w, words) && !(hide && counts[keyOf(loc, w.wineId!)]);

  // Bottles you found here that the list doesn't have here.
  const found = Object.keys(counts)
    .map(parseKey)
    .filter((k) => k.loc === loc && !listed.has(k.wineId))
    .map((k) => byId.get(k.wineId))
    .filter((w): w is Wine => !!w)
    .sort(compare("producer"));

  const visible = expected.filter(keep).sort(compare(sort));
  const groups: { name: string; wines: Wine[] }[] = [];
  for (const w of visible) {
    const g = groupOf(w, sort);
    if (groups[groups.length - 1]?.name !== g) groups.push({ name: g, wines: [] });
    groups[groups.length - 1].wines.push(w);
  }
  const p = progress(st, data.wines, loc);

  const fwords = fq.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const findResults = fwords.length
    ? data.wines.filter((w) => w.wineId && !listed.has(w.wineId) && !counts[keyOf(loc, w.wineId)] && matches(w, fwords)).slice(0, 20)
    : [];

  return (
    <>
      <a className="back" href={href("stocktake")}>← Stocktake</a>
      <h2 className="st-title">Counting {loc}</h2>
      <FilterHeader
        id={`stocktake-${LOC_SLUG[loc]}`}
        watch={JSON.stringify([q, sort, hide])}
        q={q}
        onQ={setQ}
        placeholder="Find a wine…"
        active={hide ? 1 : 0}
        onClear={hide ? () => { setHide((countPrefs.hide = false)); } : undefined}
        summary={
          <>
            <strong>{p.checked}</strong> of {p.total}
            <br />
            {p.differences ? <><strong>{p.differences}</strong> diff</> : "checked"}
          </>
        }
        actions={<button className="primary st-review-btn" onClick={() => go("stocktake/review")}>Review</button>}
      >
        <select value={sort} onChange={(e) => setSort((countPrefs.sort = e.target.value as Sort))} aria-label="Group by">
          {(Object.keys(SORT_LABEL) as Sort[]).map((s) => <option key={s} value={s}>Group by: {SORT_LABEL[s]}</option>)}
        </select>
        <select value={hide ? "hide" : "all"} onChange={(e) => setHide((countPrefs.hide = e.target.value === "hide"))} aria-label="Show">
          <option value="all">Show all wines</option>
          <option value="hide">Hide checked wines</option>
        </select>
      </FilterHeader>
      <Bar value={p.checked} total={p.total} />
      <SyncLine />
      {locked && <p className="notice">Applying this stocktake was interrupted. Finish it from the review before changing counts.</p>}

      <div className="st-tools">
        <button onClick={() => setFinding((v) => !v)} aria-expanded={finding}>{finding ? "Close" : "Found a bottle not listed here"}</button>
        <a href={href("add")}>Not in your list at all? Add a wine</a>
      </div>
      {finding && (
        <section className="card st-find">
          <input className="search" type="search" placeholder="Producer, wine or vintage…" value={fq} onChange={(e) => setFq(e.target.value)} autoFocus />
          <p className="muted small">Searches all your wines, including finished ones and ones listed at {loc === "Home" ? "K Cellars" : "Home"}.</p>
          {findResults.map((w) => (
            <button
              key={w.wineId}
              className="st-find-row"
              disabled={locked}
              onClick={() => {
                const exp = expectedAt(w, loc);
                setCount(file, loc, w.wineId!, { expected: exp, counted: exp + 1, at: Date.now() });
                setFq("");
                setFinding(false);
              }}
            >
              <span>
                <strong>{wineLabel(w, w.wineId!)}</strong>
                <span className="muted small"> · {w.qty === 0 ? "finished" : `K Cellars ${w.kc ?? 0} · Home ${w.home ?? 0}`}</span>
              </span>
              <span className="st-add">+ Add</span>
            </button>
          ))}
          {fwords.length > 0 && findResults.length === 0 && <p className="muted small">No match. Use “Add a wine” for a wine that isn't in your list.</p>}
        </section>
      )}

      {found.length > 0 && (
        <section className="st-group">
          <h3>Found here, not listed here</h3>
          {found.filter(keep).map((w) => (
            <CountRow key={w.wineId} w={w} loc={loc} entry={counts[keyOf(loc, w.wineId!)]} file={file} locked={locked} />
          ))}
        </section>
      )}

      {groups.map((g) => (
        <section className="st-group" key={g.name}>
          <h3>{g.name}</h3>
          {g.wines.map((w) => (
            <CountRow key={w.wineId} w={w} loc={loc} entry={counts[keyOf(loc, w.wineId!)]} file={file} locked={locked} />
          ))}
        </section>
      ))}
      {visible.length === 0 && <p className="muted center-text">{words.length ? "No wine here matches." : hide ? "Everything here is checked." : "No wines listed here."}</p>}

      {onOrder.filter(keep).length > 0 && (
        <details className="st-group st-order">
          <summary>On order, not yet arrived ({onOrder.length})</summary>
          <p className="muted small">Tick any that are actually here; they'll be marked as arrived.</p>
          {onOrder.filter(keep).sort(compare("producer")).map((w) => (
            <CountRow key={w.wineId} w={w} loc={loc} entry={counts[keyOf(loc, w.wineId!)]} file={file} locked={locked} />
          ))}
        </details>
      )}

      <div className="actions st-end">
        <button className="primary" onClick={() => go("stocktake/review")}>Review differences</button>
      </div>
    </>
  );
}

const CountRow = memo(function CountRow({
  w, loc, entry, file, locked,
}: { w: Wine; loc: Location; entry: CountEntry | undefined; file: string; locked: boolean }) {
  const listedHere = expectedAt(w, loc);
  const nya = isNya(w);
  const checked = !!entry;
  const shown = entry ? entry.counted : listedHere;
  const diff = entry ? entry.counted - entry.expected : 0;
  const set = (counted: number) =>
    setCount(file, loc, w.wineId!, { expected: entry?.expected ?? listedHere, counted: Math.max(0, counted), at: Date.now() });
  const label = wineLabel(w, w.wineId!);
  return (
    <div className={`st-row${checked ? (diff && !(nya && entry!.counted === 0) ? " diff" : " ok") : ""}`}>
      <div className="st-wine">
        <div className="st-name">
          <TypeDot type={w.type} /> <span className="st-producer">{w.producer}</span> {shortName(w)} <b>{w.vintage ?? ""}</b>
        </div>
        <div className="st-meta">
          {[...new Set([w.region, w.location].filter(Boolean))].map((s) => `${s} · `).join("")}
          {nya ? "on order" : "listed"} {entry ? entry.expected : listedHere}
          {checked && diff !== 0 && <span className="st-badge">{diff > 0 ? "+" : "−"}{Math.abs(diff)}</span>}
        </div>
      </div>
      <div className="st-step">
        <button type="button" disabled={locked || shown <= 0} onClick={() => set(shown - 1)} aria-label={`One fewer ${label}`}>−</button>
        <b className={checked ? "" : "muted"}>{shown}</b>
        <button type="button" disabled={locked} onClick={() => set(shown + 1)} aria-label={`One more ${label}`}>+</button>
      </div>
      <button
        type="button"
        className={checked ? "st-tick on" : "st-tick"}
        disabled={locked}
        aria-pressed={checked}
        aria-label={checked ? `Un-tick ${label}` : `${label}: count is right`}
        onClick={() => (checked ? setCount(file, loc, w.wineId!, null) : set(listedHere))}
      >
        ✓
      </button>
    </div>
  );
});

// ---- Review and apply ---------------------------------------------------------------

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "confirm"; plan: Plan }
  | { kind: "applying"; step: string }
  | { kind: "error"; message: string };

function Review() {
  const { data, reload } = useWorkbook();
  const file = data.file.id;
  const st = useStocktake();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [warn, setWarn] = useState<string | null>(null);

  if (!st) {
    return (
      <section className="card">
        <p>No stocktake in progress.</p>
        <a href={href("stocktake")}>Stocktake →</a>
      </section>
    );
  }
  const byId = new Map(data.wines.map((w) => [w.wineId, w]));
  const { diffs, arrivals } = differences(st, data.wines);
  const moves = diffs.filter((d) => d.moved > 0 && d.loc === "K Cellars");
  const fewer = diffs.filter((d) => d.rest < 0);
  const more = diffs.filter((d) => d.rest > 0);
  const locked = !!st.plan;
  const unchecked = LOCS.map((loc) => {
    const ws = countList(data.wines, loc).expected.filter((w) => !st.counts[keyOf(loc, w.wineId!)]);
    return { loc, wines: ws, bottles: ws.reduce((s, w) => s + expectedAt(w, loc), 0) };
  });

  function markGone(loc: Location, wines: Wine[], n: number) {
    if (!window.confirm(`Count all ${wines.length} unchecked wines at ${loc} (${bottles(n)}) as no longer there? You'll then say why for each below.`)) return;
    const now = Date.now();
    updateStocktake(file, (s) => {
      const counts = { ...s.counts };
      for (const w of wines) counts[keyOf(loc, w.wineId!)] = { expected: expectedAt(w, loc), counted: 0, at: now };
      return { ...s, counts };
    });
  }

  async function run(plan: Plan) {
    savePlan(plan);
    setPhase({ kind: "applying", step: "Starting…" });
    try {
      const r = await applyPlan(file, st!, plan, (step) => setPhase({ kind: "applying", step }));
      lastApplied = { changed: r.changed, skipped: r.skipped };
      try {
        await endStocktake(file);
      } catch {
        /* the progress sheet stays; harmless */
      }
      await reload().catch(() => {});
      go("stocktake");
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }

  async function apply() {
    setWarn(null);
    if (st!.plan) return void run(st!.plan);
    const missing = missingReasons(st!, diffs);
    if (missing.length) {
      setWarn(`Choose a reason for ${missing.length} wine${missing.length === 1 ? "" : "s"} first.`);
      document.getElementById(`d-${missing[0].key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setPhase({ kind: "checking" });
    try {
      // Compare with the spreadsheet as it is right now, not the app's copy.
      const snap = await Workbook.reader(file).readTable(config.tables.inventory);
      const fresh = toTable(snap.values).rows.map(toWine);
      const plan = buildPlan(st!, fresh, todayIso());
      if (plan.wines.length === 0) {
        if (window.confirm("Nothing needs changing: every wine you counted matches. Finish the stocktake?")) {
          await endStocktake(file).catch(() => {});
          lastApplied = { changed: 0, skipped: [] };
          go("stocktake");
        } else setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "confirm", plan });
    } catch (e) {
      setPhase({ kind: "error", message: describeError(e) });
    }
  }

  const busy = phase.kind === "checking" || phase.kind === "applying";

  return (
    <>
      <a className="back" href={href("stocktake")}>← Stocktake</a>
      <h2 className="st-title">Review differences</h2>
      {locked && <p className="notice">Applying was interrupted. Tap “Finish applying”: changes already made are skipped, nothing is done twice.</p>}

      {diffs.length === 0 && arrivals.length === 0 && (
        <p className="muted">No differences so far. Every wine you've counted matches your list.</p>
      )}

      {moves.length > 0 && (
        <section className="card st-review">
          <h3>Moved between locations</h3>
          {moves.map((d) => (
            <div className="st-diff" key={d.key}>
              <div className="st-name">{wineLabel(byId.get(d.wineId), d.wineId)}</div>
              <div className="muted small">
                {bottles(d.moved)} {d.change < 0 ? "from K Cellars to Home" : "from Home to K Cellars"}
              </div>
            </div>
          ))}
        </section>
      )}

      {fewer.length > 0 && (
        <section className="card st-review">
          <h3>Fewer than listed</h3>
          {fewer.map((d) => <DiffRow key={d.key} d={d} wine={byId.get(d.wineId)} st={st} file={file} locked={locked} />)}
        </section>
      )}

      {more.length > 0 && (
        <section className="card st-review">
          <h3>More than listed</h3>
          {more.map((d) => <DiffRow key={d.key} d={d} wine={byId.get(d.wineId)} st={st} file={file} locked={locked} />)}
        </section>
      )}

      {arrivals.length > 0 && (
        <section className="card st-review">
          <h3>Arrived</h3>
          {arrivals.map((a) => (
            <div className="st-diff" key={a.key}>
              <div className="st-name">{wineLabel(byId.get(a.wineId), a.wineId)}</div>
              <div className="muted small">Found {bottles(a.counted)} at {a.loc}; will be marked as arrived</div>
            </div>
          ))}
        </section>
      )}

      <section className="card st-review">
        <h3>Not checked</h3>
        {unchecked.every((u) => u.wines.length === 0) ? (
          <p className="muted small">You've checked every wine at both locations.</p>
        ) : (
          unchecked.filter((u) => u.wines.length > 0).map((u) => (
            <div className="st-unchecked" key={u.loc}>
              <p className="small">
                {u.wines.length} wine{u.wines.length === 1 ? "" : "s"} at {u.loc} ({bottles(u.bottles)}) not checked. They stay as they are.
              </p>
              <button className="link small" disabled={locked} onClick={() => markGone(u.loc, u.wines, u.bottles)}>
                I've checked all of {u.loc}: count these as gone
              </button>
            </div>
          ))
        )}
      </section>

      {phase.kind === "confirm" ? (
        <Confirm plan={phase.plan} onCancel={() => setPhase({ kind: "idle" })} onApply={() => void run(phase.plan)} />
      ) : (
        <div className="save-bar st-apply-bar">
          {warn && <span className="warn small">{warn}</span>}
          {phase.kind === "error" && <span className="warn small">{phase.message}</span>}
          {phase.kind === "applying" && <span className="muted small">{phase.step}</span>}
          {phase.kind === "checking" && <span className="muted small">Checking your workbook…</span>}
          <button className="primary" disabled={busy || (!locked && diffs.length === 0 && arrivals.length === 0)} onClick={() => void apply()}>
            {busy ? "Working…" : locked ? "Finish applying" : "Apply to workbook"}
          </button>
        </div>
      )}
    </>
  );
}

function DiffRow({ d, wine, st, file, locked }: { d: Diff; wine: Wine | undefined; st: St; file: string; locked: boolean }) {
  const c = st.choices[d.key] ?? { reason: null, price: "" };
  const options = reasonsFor(d, wine);
  const labels = options.map((r) => reasonLabel(r, d));
  const current = c.reason && options.includes(c.reason) ? reasonLabel(c.reason, d) : "";
  return (
    <div className="st-diff" id={`d-${d.key}`}>
      <div className="st-name">{wineLabel(wine, d.wineId)}</div>
      <div className="muted small">
        {d.loc}: listed {d.expected}, counted {d.counted}
        {d.moved > 0 && ` · ${d.moved} moved`}
        {d.moved > 0 ? ` · ${Math.abs(d.rest)} to explain` : ""}
      </div>
      <ChipGroup
        label={`Why ${d.rest < 0 ? "fewer" : "more"}`}
        options={labels}
        value={current}
        onChange={(v) => {
          if (locked) return;
          const r = options[labels.indexOf(v)] ?? null;
          setChoice(file, d.key, { reason: r, price: c.price });
        }}
      />
      {c.reason === "sold" && (
        <label className="field st-price">
          <span>Sale price per bottle (optional)</span>
          <input
            inputMode="decimal"
            placeholder="unknown"
            value={c.price}
            disabled={locked}
            onChange={(e) => setChoice(file, d.key, { reason: c.reason, price: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}

function Confirm({ plan, onCancel, onApply }: { plan: Plan; onCancel: () => void; onApply: () => void }) {
  const t = planTotals(plan);
  return (
    <section className="card st-confirm">
      <h3>Apply to your workbook?</h3>
      <p>
        {t.wines} wine{t.wines === 1 ? "" : "s"} will change
        {t.drunk ? ` · ${bottles(t.drunk)} added to your history as drunk` : ""}
        {t.sold ? ` · ${bottles(t.sold)} added to your sales` : ""}
        {t.arrived ? ` · ${t.arrived} marked as arrived` : ""}.
      </p>
      {plan.drift.length > 0 && (
        <>
          <p className="warn small">These changed in your workbook after you counted them. Your count is adjusted by that change:</p>
          <ul className="small">
            {plan.drift.map((x) => (
              <li key={`${x.wineId}|${x.loc}`}>
                {x.label} at {x.loc}: you counted {x.counted} when the list said {x.expected}; it now says {x.now}, so it becomes {x.target}.
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">Each change is recorded on a “Stocktake” sheet, and the whole stocktake can be undone later.</p>
      <div className="actions">
        <button className="primary" onClick={onApply}>Apply</button>
        <button onClick={onCancel}>Back</button>
      </div>
    </section>
  );
}
