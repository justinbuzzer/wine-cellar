import { useMemo, useState, type ReactNode } from "react";
import { shortName, type Wine } from "../data";
import { moveBottles, type Move } from "../inventory";
import { LOCATIONS, type Location } from "../locations";
import { href } from "../router";
import { saveLayout } from "../settings";
import {
  columnLetters, drawnRows, hasGrid, HOME_OVERFLOW, isSetUp, looseSpot, MAX_LOOSE, rackSpot, sourceKey, sourceLabel, sourcesOf,
  spotName, spotTotals, topSpot, type Source,
} from "../spots";
import { describeError, useWorkbook } from "../store";
import { bottles, Modal, useToast } from "../ui";

/** Picker value meaning "a new loose box" (L + next number), created on save. */
export const NEW_LOOSE = "__new_loose__";

/** Turns NEW_LOOSE into a real box: adds it to the layout and returns its name. */
export function useResolveSpot() {
  const { data, putLayout } = useWorkbook();
  return async (spot: string | null): Promise<string | null> => {
    if (spot !== NEW_LOOSE) return spot;
    const n = data.layout.kcLoose + 1;
    if (n > MAX_LOOSE) throw new Error(`There can be up to ${MAX_LOOSE} loose boxes.`);
    const layout = { ...data.layout, kcLoose: n };
    await saveLayout(data.file.id, layout);
    putLayout(layout);
    return looseSpot(n);
  };
}

/** A compact dropdown of a location's boxes or racks (for forms). */
export function SpotSelect({
  loc, value, onChange, allowNew = true, label = "Box or rack",
}: { loc: Location; value: string | null; onChange: (s: string | null) => void; allowNew?: boolean; label?: string }) {
  const { data } = useWorkbook();
  const l = data.layout;
  if (!isSetUp(l, loc)) return null;
  const cols = columnLetters(l.kcCols);
  return (
    <label className="field spot-select">
      <span>{loc === "Home" ? "Rack" : "Box"} at {loc}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label}>
        <option value="">Not placed yet</option>
        {loc === "Home" ? (
          <>
            {Array.from({ length: l.homeRacks }, (_, i) => <option key={i} value={rackSpot(i + 1)}>{rackSpot(i + 1)}</option>)}
            {l.homeOverflow && <option value={HOME_OVERFLOW}>{HOME_OVERFLOW}</option>}
          </>
        ) : (
          <>
            {hasGrid(l) && l.kcOverflow && (
              <optgroup label="Overflow on top">{cols.map((c) => <option key={c} value={topSpot(c)}>{topSpot(c)}</option>)}</optgroup>
            )}
            {hasGrid(l) &&
              drawnRows(l).map((r) => (
                <optgroup key={r} label={`Row ${r}`}>{cols.map((c) => <option key={c} value={`${c}${r}`}>{`${c}${r}`}</option>)}</optgroup>
              ))}
            {l.kcLoose > 0 && (
              <optgroup label="Loose boxes">
                {Array.from({ length: l.kcLoose }, (_, i) => <option key={i} value={looseSpot(i + 1)}>{looseSpot(i + 1)}</option>)}
              </optgroup>
            )}
            {allowNew && <option value={NEW_LOOSE}>+ New loose box ({looseSpot(l.kcLoose + 1)})</option>}
          </>
        )}
      </select>
    </label>
  );
}

/** Tap-to-pick map of a location's spots, with bottle counts (for moving). */
export function SpotGrid({
  loc, value, onChange, allowNew = true,
}: { loc: Location; value: string | null; onChange: (s: string | null) => void; allowNew?: boolean }) {
  const { data } = useWorkbook();
  const l = data.layout;
  const { bySpot } = useMemo(() => spotTotals(data.wines, loc), [data.wines, loc]);
  const cell = (s: string, text = s, cls = "") => (
    <button key={s} type="button" className={`spot-cell${cls}${value === s ? " on" : ""}`} onClick={() => onChange(s)} aria-pressed={value === s}>
      <span>{text}</span>
      <small>{bySpot.get(s) ?? "·"}</small>
    </button>
  );
  const notPlaced = (
    <button type="button" className={`chip-btn${value === null ? " on" : ""}`} onClick={() => onChange(null)}>Not placed</button>
  );
  if (!isSetUp(l, loc)) {
    return (
      <div className="spot-grid-wrap">
        <div className="chips">{notPlaced}</div>
        <p className="muted small">No {loc === "Home" ? "racks" : "boxes"} set up yet. <a href={href("settings")}>Set them up in Settings</a>.</p>
      </div>
    );
  }
  if (loc === "Home") {
    return (
      <div className="spot-grid-wrap">
        <div className="spot-racks">
          {Array.from({ length: l.homeRacks }, (_, i) => cell(rackSpot(i + 1)))}
          {l.homeOverflow && cell(HOME_OVERFLOW, HOME_OVERFLOW, " top")}
        </div>
        <div className="chips">{notPlaced}</div>
      </div>
    );
  }
  const cols = columnLetters(l.kcCols);
  return (
    <div className="spot-grid-wrap">
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
          {drawnRows(l).map((r) => (
            <FragmentRow key={r} r={r}>{cols.map((c) => cell(`${c}${r}`))}</FragmentRow>
          ))}
        </div>
      )}
      <div className="chips">
        {Array.from({ length: l.kcLoose }, (_, i) => {
          const s = looseSpot(i + 1);
          return (
            <button key={s} type="button" className={`chip-btn${value === s ? " on" : ""}`} onClick={() => onChange(s)}>
              {s} · {bySpot.get(s) ?? 0}
            </button>
          );
        })}
        {allowNew && (
          <button type="button" className={`chip-btn${value === NEW_LOOSE ? " on" : ""}`} onClick={() => onChange(NEW_LOOSE)}>
            + New loose box
          </button>
        )}
        {notPlaced}
      </div>
    </div>
  );
}

function FragmentRow({ r, children }: { r: number; children: ReactNode }) {
  return (
    <>
      <span className="spot-head">{r}</span>
      {children}
    </>
  );
}

const other = (l: Location): Location => (l === "Home" ? "K Cellars" : "Home");

/**
 * One sheet for every kind of move: between boxes/racks, between Home and K
 * Cellars, and placing bottles that aren't in a box yet. Several wines at once.
 */
export function MoveSheet({
  wines, from, to, onClose, title,
}: {
  wines: Wine[];
  /** Where the bottles come from, when known (e.g. moving out of a box). */
  from?: { loc: Location; spot: string | null };
  /** Pre-chosen destination (e.g. adding bottles to a box). */
  to?: { loc: Location; spot: string | null };
  onClose: () => void;
  title?: string;
}) {
  const { data, putWine } = useWorkbook();
  const toast = useToast();
  const resolve = useResolveSpot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(() => {
    const out: Record<string, { key: string; n: number }> = {};
    for (const w of wines) {
      const srcs = sourcesOf(w);
      const fixed = from && srcs.find((s) => sourceKey(s) === sourceKey(from));
      const avoid = to ? sourceKey(to) : "";
      const pick =
        fixed ??
        (to && srcs.find((s) => s.loc === to.loc && s.spot === null && sourceKey(s) !== avoid)) ??
        srcs.find((s) => sourceKey(s) !== avoid) ??
        srcs[0];
      if (pick) out[w.wineId!] = { key: sourceKey(pick), n: fixed || (to && pick.spot === null) ? pick.n : 1 };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [items, setItems] = useState(initial);
  const firstFrom = wines.length ? sourcesOf(wines[0]).find((s) => sourceKey(s) === initial[wines[0].wineId!]?.key) : undefined;
  const [dest, setDest] = useState<{ loc: Location; spot: string | null }>(
    to ?? (firstFrom && firstFrom.spot === null && isSetUp(data.layout, firstFrom.loc) ? { loc: firstFrom.loc, spot: null } : { loc: firstFrom ? other(firstFrom.loc) : "Home", spot: null }),
  );

  const rows = wines
    .map((w) => {
      const srcs = sourcesOf(w);
      const it = items[w.wineId!];
      const src = srcs.find((s) => sourceKey(s) === it?.key);
      return { w, srcs, it, src };
    })
    .filter((r) => r.it && r.src) as { w: Wine; srcs: Source[]; it: { key: string; n: number }; src: Source }[];
  const total = rows.reduce((s, r) => s + Math.min(r.it.n, r.src.n), 0);
  const same = rows.filter((r) => r.src.loc === dest.loc && r.src.spot === dest.spot);
  const destName = dest.spot === NEW_LOOSE ? `new box ${looseSpot(data.layout.kcLoose + 1)}` : spotName(dest.spot);
  const delta = (loc: Location) => rows.reduce((s, r) => s + (r.src.loc === loc && dest.loc !== loc ? -r.it.n : r.src.loc !== loc && dest.loc === loc ? r.it.n : 0), 0);

  async function submit() {
    setError(null);
    if (same.length) return setError(`${same.length === 1 ? "That wine is" : "Some wines are"} already in ${dest.loc} · ${destName}.`);
    if (total === 0) return setError("Nothing to move.");
    setBusy(true);
    try {
      const spot = await resolve(dest.spot);
      const moves: Move[] = rows.map((r) => ({
        wineId: r.w.wineId!, from: { loc: r.src.loc, spot: r.src.spot }, to: { loc: dest.loc, spot }, n: Math.min(r.it.n, r.src.n),
      }));
      const updated = await moveBottles(data.file.id, moves);
      updated.forEach(putWine);
      onClose();
      toast({
        text: `Moved ${bottles(total)} to ${dest.loc} · ${spotName(spot)}.`,
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

  return (
    <Modal title={title ?? (wines.length === 1 ? "Move bottles" : `Move ${wines.length} wines`)} onClose={onClose}>
      <div className="move-items">
        {rows.map(({ w, srcs, it, src }) => (
          <div className="move-item" key={w.wineId}>
            <div className="move-name">
              <strong>{w.producer}</strong> {shortName(w)} {w.vintage ?? ""}
            </div>
            <div className="move-controls">
              {srcs.length > 1 ? (
                <select
                  value={it.key}
                  aria-label="From"
                  onChange={(e) => {
                    const s = srcs.find((x) => sourceKey(x) === e.target.value)!;
                    setItems({ ...items, [w.wineId!]: { key: e.target.value, n: Math.min(it.n, s.n) } });
                  }}
                >
                  {srcs.map((s) => <option key={sourceKey(s)} value={sourceKey(s)}>From {sourceLabel(s)} ({s.n})</option>)}
                </select>
              ) : (
                <span className="muted small">From {sourceLabel(src)} ({src.n})</span>
              )}
              <div className="st-step">
                <button type="button" disabled={it.n <= 1} onClick={() => setItems({ ...items, [w.wineId!]: { ...it, n: it.n - 1 } })} aria-label="Fewer">−</button>
                <b>{Math.min(it.n, src.n)}</b>
                <button type="button" disabled={it.n >= src.n} onClick={() => setItems({ ...items, [w.wineId!]: { ...it, n: it.n + 1 } })} aria-label="More">+</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <h3 className="move-to">To</h3>
      <div className="seg">
        {LOCATIONS.map((l) => (
          <button key={l} type="button" className={dest.loc === l ? "on" : ""} onClick={() => setDest({ loc: l, spot: null })}>{l}</button>
        ))}
      </div>
      <SpotGrid loc={dest.loc} value={dest.spot} onChange={(spot) => setDest({ ...dest, spot })} />
      {(delta("K Cellars") !== 0 || delta("Home") !== 0) && (
        <p className="muted small">
          K Cellars {delta("K Cellars") > 0 ? "+" : ""}{delta("K Cellars")} · Home {delta("Home") > 0 ? "+" : ""}{delta("Home")} bottles
        </p>
      )}
      {error && <p className="form-errors">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy || total === 0} onClick={() => void submit()}>
          {busy ? "Moving…" : `Move ${bottles(total)} to ${dest.loc} · ${destName}`}
        </button>
      </div>
    </Modal>
  );
}
