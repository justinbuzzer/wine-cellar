import { useEffect, useMemo, useState } from "react";
import { config } from "../config";
import { formatPrice, shortName, type Cell, type Wine } from "../data";
import { excelSerial, todayIso } from "../notesmodel";
import { go, href } from "../router";
import { changeSaleLists } from "../salelists";
import {
  listTitle, listTotals, newListId, offered, priceFromRule, ROUND_TO, saleLists, type SaleList, type SlRow,
} from "../salelistmodel";
import { formatPct } from "../salesmodel";
import { describeError, useWorkbook } from "../store";
import { bottles, Modal, TypeDot, useToast } from "../ui";
import { buildList } from "../winelist";
import { presetAsking } from "./SellForm";

const money = (n: number) => formatPrice(Math.round(n * 100) / 100, config.currency);
/** "S$": the currency sign the app shows prices with. */
const SIGN = formatPrice(0, config.currency).replace(/[\d.,\s]/g, "");
const priceText = (n: number | null) => (n === null ? "" : String(Math.round(n * 100) / 100));
const priceNum = (s: string): number | null => {
  const t = s.replace(/[^0-9.]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const fmtShort = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-SG", {
        day: "numeric",
        month: "short",
        ...(iso.slice(0, 4) === String(new Date().getFullYear()) ? {} : { year: "numeric" }),
      })
    : "";

// ---- per-device preferences: the price rule and how the PDF looks ----------------

interface Prefs {
  pct: number;
  round: number;
  heading: string;
  showName: boolean;
  showCounts: boolean;
}
const PREFS: Prefs = { pct: 25, round: 10, heading: "Wines for Sale", showName: true, showCounts: true };
const PREFS_KEY = "wine-cellar.saleListPrefs";

function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [p, setP] = useState<Prefs>(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? { ...PREFS, ...JSON.parse(raw) } : PREFS;
    } catch {
      return PREFS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* per-device convenience only */
    }
  }, [p]);
  return [p, (x) => setP((prev) => ({ ...prev, ...x }))];
}

// ---- routes -------------------------------------------------------------------------

/** #/forsale (the lists), #/forsale/new[/ids], #/forsale/<id>, #/forsale/<id>/add/<ids>. */
export default function SaleLists({ arg, sub, subArg }: { arg?: string; sub?: string; subArg?: string }) {
  if (!arg) return <Index />;
  const ids = (s?: string) => (s ?? "").split(",").filter(Boolean);
  if (arg === "new") return <Editor id={null} addIds={ids(sub)} />;
  return <Editor id={decodeURIComponent(arg)} addIds={sub === "add" ? ids(subArg) : []} />;
}

/** Cellar list / Sale lists, at the top of the Wine list tab. */
export function ListModes({ on }: { on: "list" | "forsale" }) {
  return (
    <div className="seg list-modes" role="group" aria-label="Lists">
      <button className={on === "list" ? "on" : ""} onClick={() => go("list")}>Cellar list</button>
      <button className={on === "forsale" ? "on" : ""} onClick={() => go("forsale")}>Sale lists</button>
    </div>
  );
}

function useWineById() {
  const { data } = useWorkbook();
  return useMemo(() => new Map(data.wines.map((w) => [w.wineId ?? "", w])), [data.wines]);
}

function totalsOf(l: SaleList, wineById: Map<string, Wine>) {
  return listTotals(
    l.rows.map((r) => ({ bottles: offered(r, wineById.get(r.wineId)), asking: r.asking, paid: wineById.get(r.wineId)?.price ?? null })),
  );
}

function Index() {
  const { data } = useWorkbook();
  const wineById = useWineById();
  const lists = useMemo(() => saleLists(data.saleLists), [data.saleLists]);
  return (
    <>
      <ListModes on="forsale" />
      <div className="card-head">
        <h2 className="st-title">Sale lists</h2>
        <button className="primary small" onClick={() => go("forsale/new")}>+ New list</button>
      </div>
      {lists.length === 0 ? (
        <section className="card">
          <p>
            No sale lists yet. In the Cellar, press and hold wines to pick them, then tap <strong>🏷️ For sale</strong>. Or start
            with <strong>+ New list</strong> and add wines to it.
          </p>
        </section>
      ) : (
        lists.map((l) => {
          const t = totalsOf(l, wineById);
          return (
            <a key={l.id} className="card gb-order gb-order-row" href={href(`forsale/${encodeURIComponent(l.id)}`)}>
              <span className="gb-order-text">
                <strong>{listTitle(l)}</strong>
                <span className="muted small">
                  {[`${t.wines} wine${t.wines === 1 ? "" : "s"}`, bottles(t.bottles), t.asking ? `${money(t.asking)} asking` : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="muted small sl-when">{t.soldOut ? `${t.soldOut} sold out` : fmtShort(l.updated)}</span>
            </a>
          );
        })
      )}
    </>
  );
}

/** Where to put wines picked in the Cellar: an existing list or a new one. */
export function ForSaleSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { data } = useWorkbook();
  const lists = useMemo(() => saleLists(data.saleLists), [data.saleLists]);
  const n = ids.length;
  const pick = (path: string) => {
    onClose();
    go(path);
  };
  return (
    <Modal title={`Put ${n} wine${n === 1 ? "" : "s"} on a sale list`} onClose={onClose}>
      <div className="choice-list">
        <button type="button" className="choice pick new" onClick={() => pick(`forsale/new/${ids.join(",")}`)}>
          <span>+ New sale list</span>
        </button>
        {lists.map((l) => {
          const have = new Set(l.rows.map((r) => r.wineId));
          const extra = ids.filter((id) => !have.has(id)).length;
          return (
            <button key={l.id} type="button" className="choice pick" onClick={() => pick(`forsale/${encodeURIComponent(l.id)}/add/${ids.join(",")}`)}>
              <span><strong>{listTitle(l)}</strong></span>
              <span className="pick-detail">
                {l.rows.length} wine{l.rows.length === 1 ? "" : "s"} now{extra < n ? ` · ${n - extra} already on it` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ---- one list ---------------------------------------------------------------------

interface DLine {
  key: string;
  /** Saved row; none for wines added since the last save. */
  rowId?: string;
  wineId: string;
  bottles: number;
  price: string;
}
interface Draft {
  name: string;
  note: string;
  lines: DLine[];
}

const draftOf = (list: SaleList | undefined): Draft => ({
  name: list?.name ?? "",
  note: list?.note ?? "",
  lines: (list?.rows ?? []).map((r) => ({ key: r.rowId, rowId: r.rowId, wineId: r.wineId, bottles: r.bottles, price: priceText(r.asking) })),
});
const same = (a: Draft, b: Draft) =>
  a.name.trim() === b.name.trim() &&
  a.note.trim() === b.note.trim() &&
  a.lines.length === b.lines.length &&
  a.lines.every((l, i) => l.rowId === b.lines[i].rowId && l.bottles === b.lines[i].bottles && priceNum(l.price) === priceNum(b.lines[i].price));

let keyN = 0;
const newKey = () => `sl-${Date.now()}-${keyN++}`;

function Editor({ id, addIds }: { id: string | null; addIds: string[] }) {
  const { data, putSaleLists } = useWorkbook();
  const toast = useToast();
  const wineById = useWineById();
  const [prefs, setPrefs] = usePrefs();
  const list = useMemo(() => (id ? saleLists(data.saleLists).find((l) => l.id === id) : undefined), [data.saleLists, id]);
  const base = useMemo(() => draftOf(list), [list]);
  const ruleFor = (w: Wine | undefined) => priceText(priceFromRule(w?.price ?? null, prefs.pct, prefs.round));
  const lineFor = (w: Wine): DLine => ({ key: newKey(), wineId: w.wineId ?? "", bottles: w.qty, price: ruleFor(w) });

  const [draft, setDraft] = useState<Draft>(() => {
    const d = draftOf(list);
    const have = new Set(d.lines.map((l) => l.wineId));
    for (const wid of addIds) {
      const w = wineById.get(wid);
      if (w && w.qty > 0 && !have.has(wid)) {
        d.lines.push(lineFor(w));
        have.add(wid);
      }
    }
    return d;
  });
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const changed = !list || !same(draft, base);

  if (id && !list && !busy) {
    return (
      <section className="card">
        <p>That sale list wasn't found.</p>
        <a href={href("forsale")}>← Sale lists</a>
      </section>
    );
  }

  const setLine = (key: string, p: Partial<DLine>) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }));
  const lines = draft.lines.map((l) => {
    const w = wineById.get(l.wineId);
    return { l, w, n: offered(l, w), asking: priceNum(l.price), paid: w?.price ?? null };
  });
  const t = listTotals(lines.map((x) => ({ bottles: x.n, asking: x.asking, paid: x.paid })));

  function applyRule() {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => {
      const p = ruleFor(wineById.get(l.wineId));
      return p ? { ...l, price: p } : l;
    }) }));
  }

  async function save() {
    if (!draft.lines.length && !list) {
      toast({ text: "Add at least one wine first.", error: true });
      return;
    }
    if (!draft.lines.length && !confirm("Every wine is off this list, so the list will be deleted. Delete it?")) return;
    const listId = id ?? newListId();
    const name = draft.name.trim();
    const note = draft.note.trim();
    const today = excelSerial(todayIso());
    const saved = new Map((list?.rows ?? []).map((r) => [r.rowId, r] as const));
    const set: { rowId: string; cells: Record<string, Cell> }[] = [];
    const add: Record<string, Cell>[] = [];
    for (const l of draft.lines) {
      const asking = priceNum(l.price);
      const r = l.rowId ? saved.get(l.rowId) : undefined;
      if (r) {
        const cells: Record<string, Cell> = {};
        if (r.bottles !== l.bottles) cells.Bottles = l.bottles;
        if (r.asking !== asking) cells["Asking Price"] = asking ?? "";
        if (r.listName !== name) cells["List Name"] = name;
        if (r.listNote !== note) cells["List Note"] = note;
        if (Object.keys(cells).length) set.push({ rowId: r.rowId, cells });
      } else {
        const w = wineById.get(l.wineId);
        add.push({
          ListID: listId, "List Name": name, "List Note": note, WineID: l.wineId,
          Producer: w?.producer ?? "", Name: w?.name ?? "", Vintage: w?.vintage ?? "",
          Bottles: l.bottles, "Asking Price": asking ?? "", Added: today,
        });
      }
    }
    const remove = (list?.rows ?? []).filter((r) => !draft.lines.some((l) => l.rowId === r.rowId)).map((r) => r.rowId);
    setBusy(true);
    try {
      const rows = await changeSaleLists(data.file.id, { set, add, remove });
      putSaleLists(rows);
      if (!draft.lines.length) {
        toast({ text: "Sale list deleted." });
        go("forsale");
        return;
      }
      toast({ text: "Sale list saved." });
      // A new list, or one opened to add wines: show it at its own address (so a reload doesn't add them again).
      if (!id || addIds.length) go(`forsale/${encodeURIComponent(listId)}`);
      else setDraft(draftOf(saleLists(rows).find((l) => l.id === listId)));
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function deleteList() {
    if (!list || !confirm(`Delete “${listTitle(list)}”? Your wines aren't changed.`)) return;
    setBusy(true);
    try {
      putSaleLists(await changeSaleLists(data.file.id, { remove: list.rows.map((r: SlRow) => r.rowId) }));
      toast({ text: "Sale list deleted." });
      go("forsale");
    } catch (e) {
      toast({ text: describeError(e), error: true });
      setBusy(false);
    }
  }

  function sell() {
    const ids = lines.filter((x) => x.n > 0).map((x) => x.l.wineId);
    presetAsking(Object.fromEntries(lines.filter((x) => x.asking !== null).map((x) => [x.l.wineId, x.asking!])));
    go(`sell/${ids.join(",")}`);
  }

  const gain = t.paid > 0 ? (t.askingKnown - t.paid) / t.paid : null;
  return (
    <>
      <a className="back" href={href("forsale")}>← Sale lists</a>
      <div className="sl-top">
        <div className="seg sl-mode" role="group" aria-label="View">
          <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>Edit</button>
          <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>Preview</button>
        </div>
        <button className="primary small" disabled={t.bottles === 0} onClick={() => window.print()}>🖨️ PDF</button>
      </div>

      {mode === "edit" ? (
        <div className="sl-editor">
          <section className="card note-section">
            <label className="field">
              <span>List name</span>
              <input value={draft.name} placeholder="e.g. Burgundy clear-out" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Note at the top of the PDF (optional)</span>
              <input
                value={draft.note}
                placeholder="e.g. Stored at K Cellars since purchase. Collection in Singapore."
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
          </section>

          <section className="card sl-rule">
            <span>Paid +</span>
            <input inputMode="numeric" value={String(prefs.pct)} onChange={(e) => setPrefs({ pct: Number(e.target.value.replace(/[^0-9-]/g, "")) || 0 })} aria-label="Mark-up over what you paid, %" />
            <span>% · round to</span>
            <select value={prefs.round} onChange={(e) => setPrefs({ round: Number(e.target.value) })} aria-label="Round to">
              {ROUND_TO.map((r) => <option key={r} value={r}>{formatPrice(r, config.currency)}</option>)}
            </select>
            <button type="button" className="small" onClick={applyRule} disabled={!draft.lines.length} title="Set every asking price from what you paid">Apply</button>
          </section>

          <section className="card">
            {lines.length === 0 && <p className="muted">No wines yet. Add some below, or pick them in the Cellar (press and hold) and tap 🏷️ For sale.</p>}
            {lines.map(({ l, w, n, asking, paid }) => (
              <div key={l.key} className="sl-line">
                <div className="sl-line-top">
                  <TypeDot type={w?.type ?? null} />
                  <span className="sl-wine">
                    <strong>{w?.producer}</strong> {w ? shortName(w) : l.wineId} <span className="muted">{w?.vintage ?? ""}</span>
                  </span>
                  <button type="button" className="link" aria-label="Take off the list" onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) }))}>✕</button>
                </div>
                <div className="sl-line-row">
                  {n === 0 ? (
                    <span className="warn small">Sold out · none left in your cellar</span>
                  ) : (
                    <>
                      <span className="muted small">Offer</span>
                      <div className="st-step">
                        <button type="button" disabled={n <= 1} onClick={() => setLine(l.key, { bottles: n - 1 })} aria-label="Fewer">−</button>
                        <b>{n}</b>
                        <button type="button" disabled={n >= (w?.qty ?? 0)} onClick={() => setLine(l.key, { bottles: n + 1 })} aria-label="More">+</button>
                      </div>
                      <span className="muted small">of {w?.qty ?? 0}</span>
                    </>
                  )}
                  <label className="sl-price">
                    <span className="muted small">{SIGN}</span>
                    <input inputMode="decimal" value={l.price} placeholder="Price" aria-label="Asking price per bottle" onChange={(e) => setLine(l.key, { price: e.target.value })} />
                  </label>
                </div>
                <div className="muted small">
                  {paid !== null ? <>Paid {money(paid)}</> : "No purchase price"}
                  {paid !== null && asking !== null && (
                    <> · <span className={asking >= paid ? "sl-gain" : "warn"}>{formatPct((asking - paid) / paid)}</span></>
                  )}
                </div>
              </div>
            ))}
            <AddWines have={new Set(draft.lines.map((l) => l.wineId))} onAdd={(w) => setDraft((d) => ({ ...d, lines: [...d.lines, lineFor(w)] }))} />
          </section>

          <p className="muted small sl-totals">
            {bottles(t.bottles)}
            {t.asking > 0 && <> · asking {money(t.asking)}</>}
            {t.unpriced > 0 && <> · {t.unpriced} without a price</>}
            {gain !== null && <> · paid {money(t.paid)} · <span className={gain >= 0 ? "sl-gain" : "warn"}>{formatPct(gain)}</span></>}
            <br />
            What you paid and the gain stay on screen; they're never on the PDF.
          </p>

          {list && (
            <div className="sl-actions">
              <button type="button" disabled={busy || changed || t.bottles === 0} onClick={sell} title={changed ? "Save the list first" : undefined}>💰 Sell from this list</button>
              <button type="button" className="link danger" disabled={busy} onClick={() => void deleteList()}>Delete list</button>
            </div>
          )}
        </div>
      ) : (
        <section className="card sl-options">
          <label className="field">
            <span>Heading</span>
            <input value={prefs.heading} onChange={(e) => setPrefs({ heading: e.target.value })} />
          </label>
          <div className="wl-toggles">
            <label><input type="checkbox" checked={prefs.showName} onChange={(e) => setPrefs({ showName: e.target.checked })} /> List name</label>
            <label><input type="checkbox" checked={prefs.showCounts} onChange={(e) => setPrefs({ showCounts: e.target.checked })} /> Bottle counts</label>
          </div>
        </section>
      )}

      <Sheet draft={draft} prefs={prefs} wineById={wineById} hidden={mode === "edit"} />

      {changed && (
        <div className="save-bar">
          <button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : list ? "Save list" : "Save new list"}</button>
          {list ? (
            <button className="link" disabled={busy} onClick={() => setDraft(base)}>Undo changes</button>
          ) : (
            <button className="link" disabled={busy} onClick={() => go("forsale")}>Discard</button>
          )}
        </div>
      )}
    </>
  );
}

/** Search the cellar and add a wine to the list. */
function AddWines({ have, onAdd }: { have: Set<string>; onAdd: (w: Wine) => void }) {
  const { data } = useWorkbook();
  const [q, setQ] = useState("");
  const tokens = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = tokens.length
    ? data.wines
        .filter((w) => w.qty > 0 && !have.has(w.wineId ?? ""))
        .filter((w) => {
          const hay = [w.wineId, w.producer, w.name, w.vintage, w.region, w.location].join(" ").toLocaleLowerCase();
          return tokens.every((t) => hay.includes(t));
        })
        .slice(0, 6)
    : [];
  return (
    <div className="wine-picker sl-add">
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="+ Add a wine from your cellar…" />
      {tokens.length > 0 && (
        <div className="choice-list">
          {results.length === 0 && <p className="muted small">No wines in your cellar match.</p>}
          {results.map((w) => (
            <button
              key={w.wineId}
              type="button"
              className="choice pick"
              onClick={() => {
                onAdd(w);
                setQ("");
              }}
            >
              <span>
                <TypeDot type={w.type} /> <strong>{w.producer}</strong> {shortName(w)} <span className="muted">{w.vintage}</span>
              </span>
              <span className="pick-detail">{bottles(w.qty)}{w.price !== null ? ` · paid ${money(w.price)}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the buyer sees (and what prints): grouped like the wine list, asking prices only. */
function Sheet({ draft, prefs, wineById, hidden }: { draft: Draft; prefs: Prefs; wineById: Map<string, Wine>; hidden: boolean }) {
  const entries = draft.lines
    .map((l) => ({ wine: wineById.get(l.wineId), bottles: offered(l, wineById.get(l.wineId)) }))
    .filter((e): e is { wine: Wine; bottles: number } => !!e.wine && e.bottles > 0);
  const asking = new Map(draft.lines.map((l) => [l.wineId, priceNum(l.price)]));
  const sections = buildList(entries, "type");
  const total = entries.reduce((s, e) => s + e.bottles, 0);
  const today = new Date().toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" });
  return (
    <article className={`winelist sl-sheet${hidden ? " print-only" : ""}`}>
      <header className="wl-header">
        <h1>{prefs.heading || "Wines for Sale"}</h1>
        <p>{[prefs.showName ? draft.name.trim() : "", today].filter(Boolean).join(" · ")}</p>
        {draft.note.trim() && <p className="sl-note">{draft.note.trim()}</p>}
      </header>
      {sections.length === 0 && <p className="wl-empty">No bottles on this list yet.</p>}
      {sections.map((sec) => (
        <section key={sec.id} className="wl-section">
          <h2>{sec.title}</h2>
          {sec.groups.map((g, gi) => (
            <div key={`${g.country}-${g.region}`} className="wl-group">
              {(gi === 0 || sec.groups[gi - 1].country !== g.country) && <h3 className="wl-country">{g.country}</h3>}
              {g.region && <h4 className="wl-region">{g.region}</h4>}
              <ul>
                {g.entries.map(({ wine, bottles: n }) => {
                  const p = asking.get(wine.wineId ?? "") ?? null;
                  return (
                    <li key={wine.wineId} className="wl-item">
                      <div className="wl-line">
                        <span className="wl-vintage">{wine.vintage ?? ""}</span>
                        <span className="wl-wine"><span className="wl-producer">{wine.producer}</span> {shortName(wine)}</span>
                        <span className="wl-leader" aria-hidden />
                        {prefs.showCounts && <span className="wl-count">×{n}</span>}
                        <span className={`wl-price${p === null ? " none" : ""}`}>{p === null ? "On request" : formatPrice(p, config.currency)}</span>
                      </div>
                      {wine.location && <div className="wl-sub">{wine.location}</div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {total > 0 && prefs.showCounts && <p className="sl-foot">{bottles(total)}</p>}
    </article>
  );
}
