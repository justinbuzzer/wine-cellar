import { useMemo, useRef, useState, type ReactNode } from "react";
import { shortName, type Wine } from "../data";
import { moveBottles } from "../inventory";
import type { Location } from "../locations";
import { go, href } from "../router";
import {
  columnLetters, countAt, drawnRows, hasGrid, HOME_OVERFLOW, isSetUp, looseSpot, placementOf, rackSpot, sourcesOf, sourceLabel,
  sourceKey, spotTotals, strays, topSpot, winesIn,
} from "../spots";
import { describeError, useWorkbook } from "../store";
import { bottles, Modal, TypeDot, useLongPress, useToast } from "../ui";
import { MoveSheet } from "./SpotPicker";

const SLUG: Record<Location, string> = { "K Cellars": "kc", Home: "home" };
const fromSlug = (s: string | undefined): Location | null => (s === "kc" ? "K Cellars" : s === "home" ? "Home" : null);
/** In links, "unplaced" stands for the bottles not in any box. */
const UNPLACED = "unplaced";
export const spotHref = (loc: Location, spot: string | null) => href(`storage/${SLUG[loc]}/${encodeURIComponent(spot ?? UNPLACED)}`);

export default function Storage({ loc, spot }: { loc?: string; spot?: string }) {
  const l = fromSlug(loc);
  if (l && spot) return <SpotView key={`${l}|${spot}`} loc={l} spot={spot === UNPLACED ? null : spot} />;
  return <Overview />;
}

function Overview() {
  const { data } = useWorkbook();
  const l = data.layout;
  const kc = useMemo(() => spotTotals(data.wines, "K Cellars"), [data.wines]);
  const home = useMemo(() => spotTotals(data.wines, "Home"), [data.wines]);
  const cols = columnLetters(l.kcCols);
  const cell = (s: string, cls = "") => (
    <a key={s} className={`spot-cell${cls}${kc.bySpot.get(s) ? "" : " empty"}`} href={spotHref("K Cellars", s)}>
      <span>{s}</span>
      <small>{kc.bySpot.get(s) ?? "·"}</small>
    </a>
  );
  const none = !isSetUp(l, "K Cellars") && !isSetUp(l, "Home");

  return (
    <>
      <a className="back" href={href("cellar")}>← Cellar</a>
      <div className="card-head">
        <h2 className="st-title">Boxes and racks</h2>
        <a href={href("settings")}>Edit layout</a>
      </div>
      {none && (
        <section className="card">
          <p>Set up your K Cellars boxes and Home fridge racks first.</p>
          <button className="primary" onClick={() => go("settings")}>Open Settings</button>
        </section>
      )}

      {isSetUp(l, "K Cellars") && (
        <section className="card">
          <div className="card-head">
            <h2>K Cellars</h2>
            <span className="muted small">{bottles([...kc.bySpot.values()].reduce((a, b) => a + b, 0))} in boxes</span>
          </div>
          {hasGrid(l) && (
            <div className="spot-grid" style={{ gridTemplateColumns: `28px repeat(${cols.length}, minmax(0, 1fr))` }}>
              <span />
              {cols.map((c) => <span key={c} className="spot-head">{c}</span>)}
              {l.kcOverflow && (
                <>
                  <span className="spot-head">top</span>
                  {cols.map((c) => cell(topSpot(c), " top"))}
                </>
              )}
              {drawnRows(l).map((r) => (
                <GridRow key={r} r={r}>{cols.map((c) => cell(`${c}${r}`))}</GridRow>
              ))}
            </div>
          )}
          {l.kcLoose > 0 && (
            <>
              <h3 className="spot-sub">Loose boxes</h3>
              <div className="chips">
                {Array.from({ length: l.kcLoose }, (_, i) => {
                  const s = looseSpot(i + 1);
                  return <a key={s} className="chip-btn" href={spotHref("K Cellars", s)}>{s} · {kc.bySpot.get(s) ?? 0}</a>;
                })}
              </div>
            </>
          )}
          <Extras loc="K Cellars" unplaced={kc.unplaced} unplacedWines={kc.unplacedWines} />
        </section>
      )}

      {isSetUp(l, "Home") && (
        <section className="card">
          <div className="card-head">
            <h2>Home fridge</h2>
            <span className="muted small">{bottles([...home.bySpot.values()].reduce((a, b) => a + b, 0))} on racks</span>
          </div>
          <div className="spot-racks">
            {[...Array.from({ length: l.homeRacks }, (_, i) => rackSpot(i + 1)), ...(l.homeOverflow ? [HOME_OVERFLOW] : [])].map((s) => (
              <a key={s} className={`spot-cell${s === HOME_OVERFLOW ? " top" : ""}${home.bySpot.get(s) ? "" : " empty"}`} href={spotHref("Home", s)}>
                <span>{s}</span>
                <small>{home.bySpot.get(s) ?? "·"}</small>
              </a>
            ))}
          </div>
          <Extras loc="Home" unplaced={home.unplaced} unplacedWines={home.unplacedWines} />
        </section>
      )}
    </>
  );
}

function GridRow({ r, children }: { r: number; children: ReactNode }) {
  return (
    <>
      <span className="spot-head">{r}</span>
      {children}
    </>
  );
}

/** Not-placed bottles, and spots outside the layout. */
function Extras({ loc, unplaced, unplacedWines }: { loc: Location; unplaced: number; unplacedWines: number }) {
  const { data } = useWorkbook();
  const out = strays(data.wines, data.layout, loc);
  return (
    <>
      {unplaced > 0 && (
        <a className="notice spot-unplaced" href={spotHref(loc, null)}>
          {bottles(unplaced)} ({unplacedWines} wine{unplacedWines === 1 ? "" : "s"}) not in a {loc === "Home" ? "rack" : "box"} yet <span>Place them →</span>
        </a>
      )}
      {out.length > 0 && (
        <>
          <h3 className="spot-sub">Not in your layout</h3>
          <div className="chips">
            {out.map(([s, n]) => <a key={s} className="chip-btn" href={spotHref(loc, s)}>{s} · {n}</a>)}
          </div>
        </>
      )}
    </>
  );
}

function SpotView({ loc, spot }: { loc: Location; spot: string | null }) {
  const { data } = useWorkbook();
  const here = useMemo(
    () => winesIn(data.wines, loc, spot).sort((a, b) => (a.wine.producer ?? "").localeCompare(b.wine.producer ?? "") || shortName(a.wine).localeCompare(shortName(b.wine))),
    [data.wines, loc, spot],
  );
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [moving, setMoving] = useState<Wine[] | null>(null);
  const [adding, setAdding] = useState(false);
  const hold = useLongPress();
  const total = here.reduce((s, x) => s + x.n, 0);
  const title = spot === null ? `${loc} · not placed` : `${loc} · ${spot}`;
  const toggle = (id: string) =>
    setPicked((p) => {
      const s = new Set(p);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s.size ? s : null;
    });
  const pickedWines = picked ? here.filter((x) => picked.has(x.wine.wineId!)).map((x) => x.wine) : [];

  return (
    <>
      <a className="back" href={href("storage")}>← Boxes and racks</a>
      <div className="card-head">
        <h2 className="st-title">{title}</h2>
        <span className="muted small">{bottles(total)} · {here.length} wine{here.length === 1 ? "" : "s"}</span>
      </div>
      <div className="actions spot-actions">
        {spot !== null && <button onClick={() => setAdding(true)}>+ Add bottles</button>}
        {here.length > 0 && (
          <button onClick={() => setMoving(here.map((x) => x.wine))}>{spot === null ? "Place all…" : "Move all…"}</button>
        )}
      </div>

      {here.length === 0 ? (
        <p className="muted">{spot === null ? "Every bottle here is in a box or rack." : "Nothing in here yet."}</p>
      ) : (
        <div className="spot-list">
          {here.map(({ wine: w, n }) => {
            const id = w.wineId!;
            const elsewhere = sourcesOf(w).filter((s) => !(s.loc === loc && s.spot === spot));
            const body = (
              <>
                <div className="st-wine">
                  <div className="st-name">
                    <TypeDot type={w.type} /> <span className="st-producer">{w.producer}</span> {shortName(w)} <b>{w.vintage ?? ""}</b>
                  </div>
                  <div className="st-meta">
                    {n === countAt(w, loc) && placementOf(w, loc).spots.length <= 1 && elsewhere.length === 0
                      ? n === 1 ? "only bottle" : `all ${n} here`
                      : `${n} here${elsewhere.length ? ` · also ${elsewhere.map((s) => `${sourceLabel(s).replace(`${loc} · `, "")} (${s.n})`).join(", ")}` : ""}`}
                  </div>
                </div>
                <b className="spot-n">{n}</b>
              </>
            );
            return picked ? (
              <label key={id} className={`st-row spot-row pick${picked.has(id) ? " on" : ""}`} onClickCapture={hold.swallow}>
                <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} aria-label={`Pick ${w.producer ?? ""} ${shortName(w)}`} />
                {body}
              </label>
            ) : (
              <a key={id} className="st-row spot-row" href={href(`wine/${id}`)} {...hold.bind(() => setPicked(new Set([id])))}>
                {body}
              </a>
            );
          })}
        </div>
      )}
      {!picked && here.length > 1 && <p className="muted small center-text">Press and hold a wine to pick several to move.</p>}

      {picked && (
        <div className="select-bar">
          <span>
            <strong>{picked.size}</strong> wine{picked.size === 1 ? "" : "s"} picked
            {" · "}
            <button className="link" onClick={() => setPicked(picked.size === here.length ? null : new Set(here.map((x) => x.wine.wineId!)))}>
              {picked.size === here.length ? "None" : "All"}
            </button>
          </span>
          <button className="primary" onClick={() => setMoving(pickedWines)}>{spot === null ? "Place…" : "Move…"}</button>
        </div>
      )}

      {moving && (
        <MoveSheet
          wines={moving}
          from={{ loc, spot }}
          // From a box you usually move to another box here; Home / K Cellars is one tap away.
          to={{ loc, spot: null }}
          title={spot === null ? "Place bottles" : undefined}
          onClose={() => {
            setMoving(null);
            setPicked(null);
          }}
        />
      )}
      {adding && spot !== null && <AddToSpot loc={loc} spot={spot} onClose={() => setAdding(false)} />}
    </>
  );
}

/**
 * Filling a box: find a wine and tap it to add it to the list (how many and
 * where from can be changed on the list), keep going, then put them all in at once.
 */
function AddToSpot({ loc, spot, onClose }: { loc: Location; spot: string; onClose: () => void }) {
  const { data, putWine } = useWorkbook();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [list, setList] = useState<{ wineId: string; key: string; n: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(data.wines.map((w) => [w.wineId, w])), [data.wines]);

  /** Where this wine's bottles could come from (anywhere but this box). */
  const sourcesFor = (w: Wine) => sourcesOf(w).filter((s) => !(s.loc === loc && s.spot === spot));
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  // Not-placed bottles at this location first: that's what fills a box.
  const rank = (w: Wine) => (placementOf(w, loc).unplaced > 0 ? 0 : countAt(w, loc) > 0 ? 1 : 2);
  const results = words.length
    ? data.wines
        .filter((w) => w.wineId && sourcesFor(w).length > 0)
        .filter((w) => {
          const hay = [w.producer, w.name, w.vintage, w.region, w.location, w.wineId].join(" ").toLocaleLowerCase();
          return words.every((t) => hay.includes(t));
        })
        .sort((a, b) => rank(a) - rank(b) || (a.producer ?? "").localeCompare(b.producer ?? ""))
        .slice(0, 12)
    : [];

  const rows = list
    .map((it) => {
      const w = byId.get(it.wineId);
      const srcs = w ? sourcesFor(w) : [];
      const src = srcs.find((s) => sourceKey(s) === it.key) ?? srcs[0];
      return w && src ? { it, w, srcs, src, n: Math.min(it.n, src.n) } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const total = rows.reduce((s, r) => s + r.n, 0);
  const update = (wineId: string, p: Partial<{ key: string; n: number }>) => setList((l) => l.map((x) => (x.wineId === wineId ? { ...x, ...p } : x)));

  function add(w: Wine) {
    const srcs = sourcesFor(w);
    const best = srcs.find((s) => s.loc === loc && s.spot === null) ?? srcs[0];
    setList((l) => {
      const have = l.find((x) => x.wineId === w.wineId);
      if (have) {
        const max = srcs.find((s) => sourceKey(s) === have.key)?.n ?? 1;
        return l.map((x) => (x === have ? { ...x, n: Math.min(max, x.n + 1) } : x));
      }
      // Not-placed bottles usually all go in together; from elsewhere, one at a time.
      return [...l, { wineId: w.wineId!, key: sourceKey(best), n: best.loc === loc && best.spot === null ? best.n : 1 }];
    });
    setQ("");
    setError(null);
    search.current?.focus();
  }

  async function putAll() {
    if (!rows.length) return;
    setBusy(true);
    setError(null);
    const moves = rows.map((r) => ({ wineId: r.w.wineId!, from: { loc: r.src.loc, spot: r.src.spot }, to: { loc, spot }, n: r.n }));
    try {
      const updated = await moveBottles(data.file.id, moves);
      updated.forEach(putWine);
      onClose();
      toast({
        text: `Put ${bottles(total)} (${rows.length} wine${rows.length === 1 ? "" : "s"}) in ${spot}.`,
        action: {
          label: "Undo",
          run: async () => {
            try {
              const back = await moveBottles(data.file.id, moves.map((m) => ({ ...m, from: m.to, to: m.from })));
              back.forEach(putWine);
              toast({ text: "Undone." });
            } catch (e) {
              toast({ text: describeError(e), error: true });
            }
          },
        },
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    if (rows.length && !window.confirm(`Discard the ${bottles(total)} you've picked for ${spot}?`)) return;
    onClose();
  };

  return (
    <Modal title={`Add bottles to ${spot}`} onClose={close}>
      <input
        ref={search}
        className="search"
        type="search"
        placeholder="Find a wine: producer, name, vintage…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      {words.length > 0 ? (
        <div className="add-results">
          {results.map((w) => {
            const inList = list.some((x) => x.wineId === w.wineId);
            return (
              <button key={w.wineId} type="button" className="add-result" onClick={() => add(w)}>
                <span>
                  <strong>{w.producer}</strong> {shortName(w)} {w.vintage ?? ""}
                  <span className="pick-detail">{sourcesFor(w).map((s) => `${sourceLabel(s)} (${s.n})`).join(" · ")}</span>
                </span>
                <span className="st-add">{inList ? "+1" : "+ Add"}</span>
              </button>
            );
          })}
          {results.length === 0 && <p className="muted small">No wine with bottles to move matches.</p>}
        </div>
      ) : (
        !rows.length && <p className="muted small">Type to find a wine, tap it to add it to the list, and keep going. Bottles at {loc} not in a box yet come first.</p>
      )}

      {rows.length > 0 && (
        <div className="add-basket">
          <h3 className="move-to">Going into {spot}</h3>
          {rows.map(({ w, srcs, src, n }) => (
            <div className="move-item" key={w.wineId}>
              <div className="move-name add-basket-head">
                <span><strong>{w.producer}</strong> {shortName(w)} {w.vintage ?? ""}</span>
                <button type="button" className="link" aria-label={`Remove ${w.producer ?? ""} ${shortName(w)}`} onClick={() => setList((l) => l.filter((x) => x.wineId !== w.wineId))}>✕</button>
              </div>
              <div className="move-controls">
                {srcs.length > 1 ? (
                  <select
                    value={sourceKey(src)}
                    aria-label="From"
                    onChange={(e) => {
                      const s = srcs.find((x) => sourceKey(x) === e.target.value)!;
                      update(w.wineId!, { key: e.target.value, n: Math.min(Math.max(1, n), s.n) });
                    }}
                  >
                    {srcs.map((s) => <option key={sourceKey(s)} value={sourceKey(s)}>From {sourceLabel(s)} ({s.n})</option>)}
                  </select>
                ) : (
                  <span className="muted small">From {sourceLabel(src)}</span>
                )}
                <div className="st-step">
                  <button type="button" disabled={n <= 1} onClick={() => update(w.wineId!, { n: n - 1 })} aria-label="Fewer">−</button>
                  <b>{n}</b>
                  <button type="button" disabled={n >= src.n} onClick={() => update(w.wineId!, { n: n + 1 })} aria-label="More">+</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="form-errors">{error}</p>}
      <div className="actions add-actions">
        <button className="primary" disabled={busy || !rows.length} onClick={() => void putAll()}>
          {busy ? "Saving…" : rows.length ? `Put ${bottles(total)} in ${spot}` : `Put in ${spot}`}
        </button>
        <button onClick={close}>Cancel</button>
      </div>
    </Modal>
  );
}