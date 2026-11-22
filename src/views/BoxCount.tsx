import { useMemo, useState } from "react";
import { allSpots, boxKey, boxProgress, doneSpots } from "../boxcount";
import { shortName, type Wine } from "../data";
import { bottleTitle, labelReaderOn, matchLabel, type LabelResult } from "../label";
import type { Location } from "../locations";
import { go, href } from "../router";
import {
  columnLetters, countAt, drawnRows, hasGrid, HOME_OVERFLOW, looseSpot, placementOf, rackSpot, strays, topSpot, winesIn,
} from "../spots";
import { useWorkbook } from "../store";
import { resetBox, setBox, useStocktake } from "../stocktake";
import { LOC_SLUG, wineLabel } from "../stocktakemodel";
import { bottles, TypeDot, useToast } from "../ui";
import LabelFill from "./LabelFill";

export const boxHref = (loc: Location, spot: string) => href(`stocktake/box/${LOC_SLUG[loc]}/${encodeURIComponent(spot)}`);

/** Counting a location box by box: the grid, with which boxes are done. */
export function BoxGrid({ loc }: { loc: Location }) {
  const { data } = useWorkbook();
  const st = useStocktake();
  const l = data.layout;
  const listed = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of data.wines) for (const s of placementOf(w, loc).spots) m.set(s.spot, (m.get(s.spot) ?? 0) + s.n);
    return m;
  }, [data.wines, loc]);
  const unplaced = useMemo(() => data.wines.reduce((s, w) => s + ((w.status ?? "").toUpperCase() === "NYA" ? 0 : placementOf(w, loc).unplaced), 0), [data.wines, loc]);
  if (!st) return null;
  const done = doneSpots(st, loc);
  const p = boxProgress(st, l, data.wines, loc);
  const cell = (s: string, text = s, cls = "") => {
    const b = st.boxes?.[boxKey(loc, s)];
    const state = b?.done ? " done" : b ? " started" : "";
    return (
      <a key={s} className={`spot-cell${cls}${state}`} href={boxHref(loc, s)}>
        <span>{text}</span>
        <small>{b?.done ? "✓" : listed.get(s) ?? "·"}</small>
      </a>
    );
  };
  const cols = columnLetters(l.kcCols);
  const extra = strays(data.wines, l, loc);
  return (
    <>
      <p className="muted small">
        {p.done} of {p.spots} {loc === "Home" ? "racks" : "boxes"} checked{p.started ? ` · ${p.started} started` : ""}. Tap a {loc === "Home" ? "rack" : "box"} to count it.
      </p>
      <div className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.spots} aria-valuenow={p.done}>
        <i style={{ width: `${p.spots ? Math.round((p.done / p.spots) * 100) : 0}%` }} />
      </div>
      {loc === "Home" ? (
        <div className="spot-racks">
          {Array.from({ length: l.homeRacks }, (_, i) => cell(rackSpot(i + 1)))}
          {l.homeOverflow && cell(HOME_OVERFLOW, HOME_OVERFLOW, " top")}
        </div>
      ) : (
        <>
          {hasGrid(l) && (
            <div className="spot-grid" style={{ gridTemplateColumns: `28px repeat(${cols.length}, minmax(0, 1fr))` }}>
              <span />
              {cols.map((c) => <span key={c} className="spot-head">{c}</span>)}
              {l.kcOverflow && (
                <>
                  <span className="spot-head">top</span>
                  {cols.map((c) => cell(topSpot(c), `${c} top`, " top"))}
                </>
              )}
              {drawnRows(l).map((r) => [<span key={`h${r}`} className="spot-head">{r}</span>, ...cols.map((c) => cell(`${c}${r}`))])}
            </div>
          )}
          {l.kcLoose > 0 && (
            <div className="spot-racks">{Array.from({ length: l.kcLoose }, (_, i) => cell(looseSpot(i + 1)))}</div>
          )}
        </>
      )}
      {extra.length > 0 && (
        <>
          <h3 className="spot-sub">Not in your layout</h3>
          <div className="spot-racks">{extra.map(([s]) => cell(s))}</div>
        </>
      )}
      {unplaced > 0 && (
        <p className="notice small">
          {bottles(unplaced)} at {loc} {unplaced === 1 ? "isn't" : "aren't"} in a {loc === "Home" ? "rack" : "box"} yet. Count them in whichever{" "}
          {loc === "Home" ? "rack" : "box"} they're in. Any not found by the time every {loc === "Home" ? "rack" : "box"} is checked count as missing.
        </p>
      )}
      {done.size > 0 && p.done === p.spots && <p className="ok small">Every {loc === "Home" ? "rack" : "box"} here is checked.</p>}
    </>
  );
}

/** Counting one box: listed wines with their counts, plus anything else found in it. */
export function BoxCount({ loc, spot }: { loc: Location; spot: string }) {
  const { data } = useWorkbook();
  const toast = useToast();
  const st = useStocktake();
  const file = data.file.id;
  const [finding, setFinding] = useState(false);
  const [fq, setFq] = useState("");
  const [photo, setPhoto] = useState(false);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const byId = useMemo(() => new Map(data.wines.map((w) => [w.wineId, w])), [data.wines]);
  const listed = useMemo(() => winesIn(data.wines, loc, spot), [data.wines, loc, spot]);
  if (!st) {
    return (
      <section className="card">
        <p>No stocktake in progress.</p>
        <a href={href("stocktake")}>Stocktake →</a>
      </section>
    );
  }
  const check = st.boxes?.[boxKey(loc, spot)];
  const locked = !!st.plan;
  const listedN = new Map(listed.map((x) => [x.wine.wineId!, x.n]));
  /** What the box holds as counted so far: the listed bottles unless changed. */
  const counts: Record<string, number> = { ...Object.fromEntries(listed.map((x) => [x.wine.wineId!, x.n])), ...(check?.items ?? {}) };
  const ids = [...new Set([...listed.map((x) => x.wine.wineId!), ...Object.keys(check?.items ?? {})])];
  const rows = ids.map((id) => ({ id, w: byId.get(id), n: counts[id] ?? 0, listed: listedN.get(id) ?? 0 })).filter((r) => r.w) as {
    id: string; w: Wine; n: number; listed: number;
  }[];
  const total = rows.reduce((s, r) => s + r.n, 0);

  const save = (items: Record<string, number>, done: boolean) =>
    setBox(file, data.wines, data.layout, loc, spot, { at: Date.now(), done, sealed: false, items });
  const setN = (id: string, n: number) => save({ ...counts, [id]: Math.max(0, n) }, check?.done ?? false);

  function finish() {
    save(counts, true);
    // On to the next box not yet checked, in layout order.
    const order = allSpots(data.layout, data.wines, loc);
    const done = new Set([...doneSpots(st!, loc), spot]);
    const i = order.indexOf(spot);
    const next = [...order.slice(i + 1), ...order.slice(0, Math.max(0, i))].find((s) => !done.has(s));
    toast({ text: `${spot} checked.` });
    if (next) go(`stocktake/box/${LOC_SLUG[loc]}/${encodeURIComponent(next)}`);
    else {
      toast({ text: `Every ${loc === "Home" ? "rack" : "box"} at ${loc} is checked. Review the differences when you're ready.` });
      go(`stocktake/count/${LOC_SLUG[loc]}`);
    }
  }

  function addFound(w: Wine, n = 1) {
    save({ ...counts, [w.wineId!]: (counts[w.wineId!] ?? 0) + n }, check?.done ?? false);
  }

  /** A line-up photo: bottles recognised are added (listed wines go up to what the photo shows). */
  function fromPhoto(found: LabelResult[]) {
    setPhoto(false);
    const here = data.wines.filter((w) => w.wineId && countAt(w, loc) > 0);
    const tally = new Map<string, number>();
    const missed: string[] = [];
    for (const r of found) {
      const m = matchLabel(r, here, []).filter((x) => x.kind === "cellar");
      const pick = m.find((x) => x.exact) ?? (m.length === 1 ? m[0] : null) ?? matchLabel(r, data.wines, []).find((x) => x.kind === "cellar" && x.exact) ?? null;
      const id = pick ? (pick.wine as Wine).wineId : null;
      if (id) tally.set(id, (tally.get(id) ?? 0) + 1);
      else missed.push(bottleTitle(r));
    }
    const next = { ...counts };
    for (const [id, n] of tally) next[id] = listedN.has(id) ? Math.max(next[id] ?? 0, n) : (check?.items?.[id] ?? 0) + n;
    save(next, check?.done ?? false);
    setUnmatched(missed);
    toast({ text: `Photo: ${found.length} bottle${found.length === 1 ? "" : "s"} read, ${found.length - missed.length} matched to your wines.` });
  }

  const fwords = fq.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rank = (w: Wine) => (placementOf(w, loc).unplaced > 0 ? 0 : countAt(w, loc) > 0 ? 1 : 2);
  const results = fwords.length
    ? data.wines
        .filter((w) => w.wineId && fwords.every((t) => [w.producer, w.name, w.vintage, w.region, w.wineId].join(" ").toLocaleLowerCase().includes(t)))
        .sort((a, b) => rank(a) - rank(b) || (a.producer ?? "").localeCompare(b.producer ?? ""))
        .slice(0, 12)
    : [];

  return (
    <>
      <a className="back" href={href(`stocktake/count/${LOC_SLUG[loc]}`)}>← All {loc === "Home" ? "racks" : "boxes"}</a>
      <div className="card-head">
        <h2 className="st-title">{loc} · {spot}</h2>
        <span className="muted small">{check?.done ? "✓ checked" : check ? "started" : "not checked"}</span>
      </div>
      {locked && <p className="notice">Applying this stocktake was interrupted. Finish it from the review before changing counts.</p>}

      {rows.length === 0 ? (
        <p className="muted">Nothing is listed in {spot}. Add what you find, or tick it as empty.</p>
      ) : (
        <div className="spot-list">
          {rows.map((r) => (
            <div key={r.id} className={`st-row${r.n !== r.listed ? " diff" : ""}`}>
              <div className="st-wine">
                <div className="st-name">
                  <TypeDot type={r.w.type} /> <span className="st-producer">{r.w.producer}</span> {shortName(r.w)} <b>{r.w.vintage ?? ""}</b>
                </div>
                <div className="st-meta">
                  {r.listed ? `listed ${r.listed}` : "found here, not listed"}
                  {r.n !== r.listed && <span className="st-badge">{r.n > r.listed ? "+" : "−"}{Math.abs(r.n - r.listed)}</span>}
                </div>
              </div>
              <div className="st-step">
                <button type="button" disabled={locked || r.n <= 0} onClick={() => setN(r.id, r.n - 1)} aria-label={`One fewer ${wineLabel(r.w, r.id)}`}>−</button>
                <b>{r.n}</b>
                <button type="button" disabled={locked} onClick={() => setN(r.id, r.n + 1)} aria-label={`One more ${wineLabel(r.w, r.id)}`}>+</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="st-tools">
        <button disabled={locked} onClick={() => { setFinding((v) => !v); setPhoto(false); }} aria-expanded={finding}>{finding ? "Close" : "+ Found a bottle"}</button>
        {labelReaderOn() && (
          <button disabled={locked} onClick={() => { setPhoto((v) => !v); setFinding(false); }} aria-expanded={photo}>{photo ? "Close" : "📷 Line-up photo"}</button>
        )}
      </div>
      {photo && (
        <section className="card st-find">
          <p className="muted small">Stand the bottles from {spot} in a row, labels facing you, and take one photo (up to 16 bottles).</p>
          <LabelFill onBottles={fromPhoto} />
        </section>
      )}
      {unmatched.length > 0 && (
        <p className="notice small">
          Not matched: {unmatched.map((t, i) => (
            <button key={i} className="link" onClick={() => { setFinding(true); setFq(t); }}>{t}</button>
          ))}. Tap one to search for it.
        </p>
      )}
      {finding && (
        <section className="card st-find">
          <input className="search" type="search" placeholder="Producer, wine or vintage…" value={fq} onChange={(e) => setFq(e.target.value)} autoFocus />
          {results.map((w) => (
            <button
              key={w.wineId}
              className="st-find-row"
              onClick={() => {
                addFound(w);
                setFq("");
              }}
            >
              <span>
                <strong>{wineLabel(w, w.wineId!)}</strong>
                <span className="muted small"> · {w.qty === 0 ? "finished" : `K Cellars ${w.kc ?? 0} · Home ${w.home ?? 0}`}</span>
              </span>
              <span className="st-add">{counts[w.wineId!] ? "+1" : "+ Add"}</span>
            </button>
          ))}
          {fwords.length > 0 && results.length === 0 && <p className="muted small">No match.</p>}
        </section>
      )}

      <div className="save-bar st-box-bar">
        <button className="primary" disabled={locked} onClick={() => finish()}>
          {rows.length === 0 || total === 0 ? "Empty ✓" : `${check?.done ? "Done" : loc === "Home" ? "Rack checked" : "Box checked"} ✓ ${bottles(total)}`}
        </button>
        {check && !locked && (
          <button className="link" onClick={() => resetBox(file, loc, spot)}>Count again</button>
        )}
      </div>
    </>
  );
}
