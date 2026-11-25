import { useState } from "react";
import { config } from "../config";
import { formatPrice, norm, shortName, type Tasting, type Wine } from "../data";
import { adjustBottles, markArrived } from "../inventory";
import { arriveGroupBuyWines } from "../groupbuys";
import { openBottle, undoOpen } from "../history";
import { newestOpenings, noteFor } from "../historymodel";
import { todayIso } from "../notesmodel";
import { LOCATIONS, type Location } from "../locations";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { bottles, Modal, Stepper, TypeDot, useToast } from "../ui";
import { locationLine } from "./Cellar";
import { LogoDialog, ProducerLogo, useLogos } from "../logos";
import { producerKey } from "../producers";
import { sellBottles, undoSale, type SaleDetails } from "../sales";
import { formatHeld, formatPct, heldYears, lastBoughtYear, newestSales, saleMoney } from "../salesmodel";
import { isSetUp, placementOf, sourceKey, sourcesOf, spotName } from "../spots";
import { MoveSheet, NEW_LOOSE, SpotSelect, useResolveSpot } from "./SpotPicker";
import { lastPurchaseOf, removeBottles, REMOVE_REASONS, undoRemove, type RemoveReason, type RemoveRequest } from "../corrections";
import type { Purchase } from "../purchasemodel";
import { spotHref } from "./Storage";

type Dialog = null | "open" | "add" | "remove" | "arrived" | "sell";

const money = (n: number | null) => formatPrice(n === null ? null : Math.round(n * 100) / 100, config.currency);

/** Boxes/racks a location's bottles could come from (null = not placed); empty when there's no choice. */
function spotChoices(w: Wine, loc: Location): (string | null)[] {
  const p = placementOf(w, loc);
  const xs: (string | null)[] = [...p.spots.map((s) => s.spot), ...(p.unplaced > 0 ? [null] : [])];
  return xs.length > 1 ? xs : [];
}

/** Where bottles come from unless you choose: the first box/rack listed (also when it's the only one). */
const firstSpot = (w: Wine, loc: Location): string | null => placementOf(w, loc).spots[0]?.spot ?? null;

function FromSpot({ w, loc, value, onChange }: { w: Wine; loc: Location; value: string | null; onChange: (s: string | null) => void }) {
  const xs = spotChoices(w, loc);
  if (!xs.length) return null;
  const p = placementOf(w, loc);
  return (
    <label className="field">
      <span>From which {loc === "Home" ? "rack" : "box"}?</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        {xs.map((s) => (
          <option key={s ?? ""} value={s ?? ""}>
            {spotName(s)} ({s === null ? p.unplaced : p.spots.find((x) => x.spot === s)?.n})
          </option>
        ))}
      </select>
    </label>
  );
}

export default function WineDetail({ id }: { id: string }) {
  const { data, putWine, putOpening, removeOpening, putSale, removeSale, putPurchases, putGroupBuys } = useWorkbook();
  const toast = useToast();
  const resolveSpot = useResolveSpot();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [more, setMore] = useState(false);
  /** The Move sheet: from a particular spot, or (empty) let it choose. */
  const [moving, setMoving] = useState<{ from?: { loc: Location; spot: string | null }; place?: boolean } | null>(null);
  const [justOpened, setJustOpened] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const logos = useLogos();

  const wine = data.wines.find((w) => w.wineId === id);
  if (!wine) {
    return (
      <section className="card">
        <p>Wine {id} wasn't found.</p>
        <a href={href("cellar")}>← Back to cellar</a>
      </section>
    );
  }

  const itemId = data.file.id;
  const hasLocations = wine.kc !== null && wine.home !== null;
  const at = (l: Location) => (l === "Home" ? wine.home ?? 0 : wine.kc ?? 0);
  const stocked = LOCATIONS.filter((l) => at(l) > 0);

  /** Runs a write, updates the app, and offers Undo when possible. */
  async function act(op: () => Promise<Wine>, message: string, undo?: () => Promise<Wine>) {
    setBusy(true);
    try {
      const w = await op();
      putWine(w);
      setDialog(null);
      toast({
        text: message,
        action: undo && {
          label: "Undo",
          run: async () => {
            try {
              putWine(await undo());
              toast({ text: "Undone." });
            } catch (e) {
              toast({ text: describeError(e), error: true });
            }
          },
        },
      });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  /** Bottles that weren't opened or sold: off the count, into the adjustments log, with Undo. */
  const remove = async (r: RemoveRequest) => {
    setBusy(true);
    try {
      const res = await removeBottles(itemId, id, r);
      putWine(res.wine);
      if (res.purchases) putPurchases(res.purchases);
      setDialog(null);
      const what = `Removed ${bottles(r.n)} from ${r.loc}`;
      toast({
        text: res.logError
          ? `${what}, but the change couldn't be recorded: ${describeError(res.logError)}`
          : `${what}${res.purchaseId ? " and from your purchases" : ""}.`,
        error: !!res.logError,
        action: {
          label: "Undo",
          run: async () => {
            try {
              const u = await undoRemove(itemId, id, r, res);
              putWine(u.wine);
              if (u.purchases) putPurchases(u.purchases);
              toast({ text: "Undone." });
            } catch (e) {
              toast({ text: describeError(e), error: true });
            }
          },
        },
      });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const open = async (l: Location, date: string, occasion: string, spot: string | null) => {
    setBusy(true);
    try {
      const res = await openBottle(itemId, id, l, { date, occasion, spot });
      putWine(res.wine);
      if (res.opening) putOpening(res.opening);
      setJustOpened(true);
      setDialog(null);
      const openId = res.opening?.openId ?? null;
      toast({
        text: res.logError
          ? `Opened a bottle from ${l}, but it couldn't be added to the bottle history: ${describeError(res.logError)}`
          : `Opened a bottle from ${l}. Enjoy!`,
        error: !!res.logError,
        action: {
          label: "Undo",
          run: async () => {
            try {
              putWine(await undoOpen(itemId, id, l, openId, spot));
              if (openId) removeOpening(openId);
              setJustOpened(false);
              toast({ text: "Undone." });
            } catch (e) {
              toast({ text: describeError(e), error: true });
            }
          },
        },
      });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const sell = async (l: Location, d: SaleDetails, spot: string | null) => {
    setBusy(true);
    try {
      const res = await sellBottles(itemId, id, l, d, spot);
      putWine(res.wine);
      if (res.sale) putSale(res.sale);
      setDialog(null);
      const saleId = res.sale?.saleId ?? null;
      toast({
        text: res.logError
          ? `Took ${bottles(d.bottles)} off ${l}, but the sale couldn't be recorded: ${describeError(res.logError)}`
          : `Sold ${bottles(d.bottles)} from ${l}.`,
        error: !!res.logError,
        action: {
          label: "Undo",
          run: async () => {
            try {
              putWine(await undoSale(itemId, id, l, d.bottles, saleId, spot));
              if (saleId) removeSale(saleId);
              toast({ text: "Undone." });
            } catch (e) {
              toast({ text: describeError(e), error: true });
            }
          },
        },
      });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const opened = newestOpenings(data.history.filter((o) => o.wineId === id));
  const sold = newestSales(data.sales.filter((s) => s.wineId === id));

  const linked = data.tastings.filter((t) => t.wineId === id);
  const likely = data.tastings.filter(
    (t) => !t.wineId && norm(t.name) === norm(wine.name) && String(t.vintage) === String(wine.vintage),
  );

  return (
    <>
      <a className="back" href={href("cellar")}>← Cellar</a>

      <section className="card">
        <div className="detail-head">
          <button
            type="button"
            className="logo-button"
            onClick={() => setLogoOpen(true)}
            disabled={!wine.producer}
            aria-label={logos.get(wine.producer) ? "Change the producer's logo" : "Add a logo for this producer"}
            title={logos.get(wine.producer) ? "Change logo" : "Add logo"}
          >
            <ProducerLogo producer={wine.producer} size="large" />
            {wine.producer && <span className="logo-button-label">{logos.get(wine.producer) ? "Change" : "+ Logo"}</span>}
          </button>
          <div>
            <div className="wc-top">
              <TypeDot type={wine.type} />
              <span className="wc-producer">{wine.producer}</span>
            </div>
            <h2 className="detail-title">
              {shortName(wine)} <span className="muted">{wine.vintage}</span>
            </h2>
            <div className="wc-meta">{[wine.type, wine.location, wine.region, wine.country].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        {wine.status === "NYA" && <span className="badge">Not yet arrived</span>}
      </section>

      {logoOpen && wine.producer && (
        <LogoDialog
          producer={wine.producer}
          wineCount={data.wines.filter((w) => producerKey(w.producer) === producerKey(wine.producer)).length}
          onClose={() => setLogoOpen(false)}
        />
      )}

      {justOpened && (
        <a className="card prompt-card" href={href(`note/new/wine/${id}`)}>
          <strong>✍ Write a tasting note</strong>
          <span className="muted">while it's in the glass →</span>
        </a>
      )}

      <section className="card">
        <h2>Bottles</h2>
        {hasLocations ? (
          <div className="bottle-split">
            {LOCATIONS.map((l) => (
              <div key={l} className="bottle-loc">
                <div className="stat-value">{at(l)}</div>
                <div className="muted">{l}</div>
              </div>
            ))}
          </div>
        ) : (
          <p>
            {bottles(wine.qty)}. Add <strong>Qty K Cellars</strong> and <strong>Qty Home</strong> columns to the
            Inventory table to track bottles by location.
          </p>
        )}
        {hasLocations && wine.qty > 0 && (isSetUp(data.layout, "K Cellars") || isSetUp(data.layout, "Home") || wine.kcSpots || wine.homeSpots) && (
          <div className="where">
            <h3>Where</h3>
            {sourcesOf(wine).map((s) => (
              <div className="where-row" key={sourceKey(s)}>
                <a href={spotHref(s.loc, s.spot)}>
                  {s.loc} · <strong>{spotName(s.spot)}</strong>
                </a>
                <b>{s.n}</b>
                {s.spot === null && isSetUp(data.layout, s.loc) ? (
                  <button className="small" disabled={busy} onClick={() => setMoving({ from: s, place: true })}>Place</button>
                ) : (
                  <button className="small" disabled={busy} onClick={() => setMoving({ from: s })}>Move</button>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Kept at the bottom of the screen: the main action, Sell, and the rest under More. */}
        <div className="wine-bar">
          {/* Phones: this bar takes the tab dock's place, so it carries the way back. */}
          <a className="wine-bar-back" href={href("cellar")} aria-label="Back to the Cellar" title="Back to the Cellar">←</a>
          {/* Bottles that haven't arrived can be sold, but not drunk: Mark arrived takes Open's place. */}
          {wine.status === "NYA" ? (
            <button className="primary" disabled={busy} onClick={() => setDialog("arrived")}>✓ Mark arrived</button>
          ) : (
            <button className="primary" disabled={!hasLocations || busy || stocked.length === 0} onClick={() => setDialog("open")}>🍷 Open a bottle</button>
          )}
          <button disabled={!hasLocations || busy || stocked.length === 0} onClick={() => setDialog("sell")}>💰 Sell</button>
          <div className="more-wrap">
            <button aria-expanded={more} aria-haspopup="menu" onClick={() => setMore((m) => !m)}>⋯ More</button>
            {more && (
              <div className="more-menu" role="menu" onClick={() => setMore(false)}>
                <button role="menuitem" disabled={!hasLocations || busy} onClick={() => setDialog("add")}>+ Add bottles</button>
                <button role="menuitem" disabled={!hasLocations || busy || stocked.length === 0} onClick={() => setDialog("remove")}>− Remove</button>
                <button role="menuitem" disabled={!hasLocations || busy || stocked.length === 0} onClick={() => setMoving({})}>⇄ Move</button>
                <button role="menuitem" onClick={() => go(`edit/${id}`)}>✎ Edit details</button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Details</h2>
          <button onClick={() => go(`edit/${id}`)}>Edit</button>
        </div>
        <dl className="facts">
          <Fact label="Producer" value={wine.producer} />
          <Fact label="Wine" value={wine.name} />
          <Fact label="Vintage" value={wine.vintage} />
          <Fact label="Country" value={wine.country} />
          <Fact label="Region" value={wine.region} />
          <Fact label="Location" value={wine.location} />
          <Fact label="Varietal" value={wine.varietal} />
          <Fact label="Blend" value={wine.blend} />
          <Fact label="Alcohol" value={wine.alcohol !== null ? `${wine.alcohol}%` : null} />
          <Fact label="Price" value={formatPrice(wine.price, config.currency)} />
          <Fact label="Source" value={wine.source} />
          <Fact label="Year purchased" value={wine.yearPurchased} />
          <Fact label="Remarks" value={wine.remarks} />
          <Fact label="Wine ID" value={wine.wineId} />
        </dl>
      </section>

      {opened.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Opened ({opened.length})</h2>
            <a href={href("history")}>All history →</a>
          </div>
          <ul className="history-mini">
            {opened.map((o) => {
              const note = noteFor(o, data.tastings);
              return (
                <li key={o.openId}>
                  <span>{formatDay(o.date)}</span>
                  <span className="muted">{[o.from, o.occasion].filter(Boolean).join(" · ")}</span>
                  {note && <a href={href(`note/${note.tastingId}`)}>Note{note.score ? ` · ${note.score}` : ""}</a>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {sold.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Sold ({sold.reduce((n, s) => n + s.bottles, 0)})</h2>
            <a href={href("sales")}>All sales →</a>
          </div>
          <ul className="history-mini">
            {sold.map((s) => {
              const m = saleMoney(s);
              return (
                <li key={s.saleId}>
                  <span>{formatDay(s.date)}</span>
                  <span>
                    {bottles(s.bottles)} at {money(s.salePrice)}
                    {m.pct !== null && <span className="muted"> ({formatPct(m.pct)})</span>}
                  </span>
                  <span className="muted">
                    {[s.buyer, heldYears(s) !== null ? `kept ${formatHeld(heldYears(s)).toLowerCase()}` : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Tasting notes ({linked.length + likely.length})</h2>
          <button onClick={() => go(`note/new/wine/${id}`)}>✍ Write a note</button>
        </div>
        {linked.length + likely.length === 0 && <p className="muted">No tasting notes for this wine yet.</p>}
        {linked.map((t) => (
          <TastingRow key={t.tastingId} t={t} />
        ))}
        {likely.length > 0 && (
          <>
            <p className="muted small">Probably the same wine (same name and vintage, not linked):</p>
            {likely.map((t) => (
              <TastingRow key={t.tastingId} t={t} />
            ))}
          </>
        )}
      </section>

      {dialog === "open" && (
        <OpenDialog
          wine={wine}
          stocked={stocked}
          at={at}
          busy={busy}
          firstTime={!data.hasHistory}
          onClose={() => setDialog(null)}
          onOpen={(l, date, occasion, spot) => void open(l, date, occasion, spot)}
        />
      )}

      {dialog === "sell" && (
        <SellDialog
          wine={wine}
          stocked={stocked}
          at={at}
          busy={busy}
          firstTime={!data.hasSales}
          lastBought={wine.yearPurchased ?? lastBoughtYear(data.sales, id)}
          boughtFromList={wine.yearPurchased !== null}
          onClose={() => setDialog(null)}
          onSell={(l, d, spot) => void sell(l, d, spot)}
        />
      )}

      {dialog === "add" && (
        <AddDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(l, n, chosen) => {
            let spot: string | null = null;
            return act(
              async () => {
                spot = await resolveSpot(chosen);
                return adjustBottles(itemId, id, { [l]: n }, { [l]: { to: spot } });
              },
              `Added ${bottles(n)} at ${l}.`,
              () => adjustBottles(itemId, id, { [l]: -n }, { [l]: { from: spot } }),
            );
          }}
        />
      )}

      {dialog === "remove" && (
        <RemoveDialog
          wine={wine}
          stocked={stocked}
          at={at}
          busy={busy}
          lastPurchase={lastPurchaseOf(data.purchases, id)}
          onClose={() => setDialog(null)}
          onRemove={(r) => void remove(r)}
        />
      )}

      {moving && (
        <MoveSheet
          wines={[wine]}
          from={moving.from}
          to={moving.place && moving.from ? { loc: moving.from.loc, spot: null } : undefined}
          title={moving.place ? "Place bottles" : undefined}
          onClose={() => setMoving(null)}
        />
      )}

      {dialog === "arrived" && (
        <ArrivedDialog
          wine={wine}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(l, chosen) =>
            void act(async () => {
              const w = await markArrived(itemId, id, l, await resolveSpot(chosen));
              // Its Group Buy line (if you bought it in one) has arrived too.
              await arriveGroupBuyWines(itemId, [id]).then((rows) => rows && putGroupBuys(rows), () => {});
              return w;
            }, `Marked as arrived at ${l}.`)
          }
        />
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="fact-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function TastingRow({ t }: { t: Tasting }) {
  return (
    <a className="tasting-row note-link" href={href(`note/${t.tastingId}`)}>
      <div className="tasting-meta">
        <strong>{t.score ?? "–"}</strong>
        <span className="muted">{t.dateTasted ?? t.yearTasted}</span>
        {t.source && <span className="muted">· {t.source}</span>}
      </div>
      {t.nose && <p className="tasting-text"><span className="muted">Nose:</span> {t.nose}</p>}
      {t.taste && t.taste !== t.nose && <p className="tasting-text"><span className="muted">Palate:</span> {t.taste}</p>}
      {t.note && <p className="tasting-text">{t.note}</p>}
    </a>
  );
}

function OpenDialog({
  wine,
  stocked,
  at,
  busy,
  firstTime,
  onClose,
  onOpen,
}: {
  wine: Wine;
  stocked: Location[];
  at: (l: Location) => number;
  busy: boolean;
  firstTime: boolean;
  onClose: () => void;
  onOpen: (l: Location, date: string, occasion: string, spot: string | null) => void;
}) {
  const [from, setFrom] = useState<Location>(stocked.includes("Home") ? "Home" : stocked[0]);
  const [spot, setSpot] = useState<string | null>(() => firstSpot(wine, from));
  const [date, setDate] = useState(todayIso());
  const [occasion, setOccasion] = useState("");
  return (
    <Modal title="Open a bottle" onClose={onClose}>
      {stocked.length > 1 ? (
        <div className="seg">
          {stocked.map((l) => (
            <button
              key={l}
              className={l === from ? "on" : ""}
              onClick={() => {
                setFrom(l);
                setSpot(firstSpot(wine, l));
              }}
            >
              {l} ({at(l)})
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">From {from} ({bottles(at(from))})</p>
      )}
      <FromSpot w={wine} loc={from} value={spot} onChange={setSpot} />
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} />
      </label>
      <label className="field">
        <span>Occasion or company (optional)</span>
        <input
          type="text"
          value={occasion}
          placeholder="e.g. Dinner with friends, Anniversary"
          onChange={(e) => setOccasion(e.target.value)}
        />
      </label>
      {firstTime && (
        <p className="muted small">This first bottle also adds an "Opened" sheet to your workbook to keep the history.</p>
      )}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => onOpen(from, date, occasion, spot)}>
          {busy ? "Saving…" : `🍷 Open from ${from}`}
        </button>
      </div>
    </Modal>
  );
}

const priceValue = (s: string): number | null => {
  const t = s.replace(/[^0-9.]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function SellDialog({
  wine,
  stocked,
  at,
  busy,
  firstTime,
  lastBought,
  boughtFromList,
  onClose,
  onSell,
}: {
  boughtFromList: boolean;
  wine: Wine;
  stocked: Location[];
  at: (l: Location) => number;
  busy: boolean;
  firstTime: boolean;
  lastBought: number | null;
  onClose: () => void;
  onSell: (l: Location, d: SaleDetails, spot: string | null) => void;
}) {
  const [from, setFrom] = useState<Location>(stocked.includes("K Cellars") ? "K Cellars" : stocked[0]);
  const [spot, setSpot] = useState<string | null>(() => firstSpot(wine, from));
  const [n, setN] = useState(1);
  const [sale, setSale] = useState("");
  const [bought, setBought] = useState(wine.price !== null ? String(wine.price) : "");
  const [date, setDate] = useState(todayIso());
  const [boughtIn, setBoughtIn] = useState(lastBought !== null ? String(lastBought) : "");
  const [buyer, setBuyer] = useState("");
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);

  const max = at(from);
  const count = Math.min(n, max);
  const salePrice = priceValue(sale);
  const boughtPrice = priceValue(bought);
  const boughtYear = /^\d{4}$/.test(boughtIn.trim()) ? Number(boughtIn.trim()) : null;
  const yearOk = boughtIn.trim() === "" || (boughtYear !== null && boughtYear >= 1900);
  const tooLate = boughtYear !== null && boughtYear > Number(date.slice(0, 4));
  const preview = salePrice !== null
    ? saleMoney({
        saleId: "", date, wineId: null, producer: null, name: null, vintage: null, type: null, from, bottles: count,
        salePrice, boughtPrice, boughtYear: yearOk && !tooLate ? boughtYear : null, buyer: null, notes: null,
      })
    : null;
  const held = yearOk && !tooLate && boughtYear !== null ? heldYears({ date, boughtYear }) : null;

  const submit = () => {
    setTried(true);
    if (salePrice === null || !yearOk || tooLate) return;
    onSell(from, { bottles: count, date, salePrice, boughtPrice, boughtYear, buyer, notes }, spot);
  };

  return (
    <Modal title="Sell bottles" onClose={onClose}>
      {stocked.length > 1 ? (
        <div className="seg">
          {stocked.map((l) => (
            <button
              key={l}
              className={l === from ? "on" : ""}
              onClick={() => {
                setFrom(l);
                setSpot(firstSpot(wine, l));
                setN(1);
              }}
            >
              {l} ({at(l)})
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">From {from} ({bottles(max)})</p>
      )}
      <FromSpot w={wine} loc={from} value={spot} onChange={setSpot} />
      {max > 1 && <Stepper value={count} min={1} max={max} onChange={setN} />}
      <div className="row-2">
        <label className="field">
          <span>Sold for, per bottle (S$)</span>
          <input
            type="text"
            inputMode="decimal"
            value={sale}
            placeholder="e.g. 180"
            aria-invalid={tried && salePrice === null}
            onChange={(e) => setSale(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Paid, per bottle (S$)</span>
          <input type="text" inputMode="decimal" value={bought} placeholder="unknown" onChange={(e) => setBought(e.target.value)} />
        </label>
      </div>
      <div className="row-2">
        <label className="field">
          <span>Date sold</span>
          <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} />
        </label>
        <label className="field">
          <span>Year bought{boughtFromList && boughtIn === String(lastBought) ? " (from the wine list)" : " (optional)"}</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={boughtIn}
            placeholder="e.g. 2016"
            aria-invalid={tried && (!yearOk || tooLate)}
            onChange={(e) => setBoughtIn(e.target.value.replace(/\D/g, ""))}
          />
        </label>
      </div>
      <label className="field">
        <span>Buyer or where (optional)</span>
        <input type="text" value={buyer} placeholder="e.g. a friend, auction house, shop" onChange={(e) => setBuyer(e.target.value)} />
      </label>
      <label className="field">
        <span>Notes (optional)</span>
        <input type="text" value={notes} placeholder="e.g. fees, condition" onChange={(e) => setNotes(e.target.value)} />
      </label>

      {tried && salePrice === null && <p className="form-errors">Enter the price you sold each bottle for.</p>}
      {tried && !yearOk && <p className="form-errors">Write the year bought as four digits, e.g. 2016.</p>}
      {tried && tooLate && <p className="form-errors">The year bought is after the year sold.</p>}

      {preview && (
        <p className="sell-preview">
          <strong>{money(preview.revenue)}</strong> for {bottles(count)}
          {preview.gain !== null && (
            <>
              {" · "}
              {preview.gain >= 0 ? "gain" : "loss"} {money(Math.abs(preview.gain))} ({formatPct(preview.pct)})
            </>
          )}
          {held !== null && <> · kept {formatHeld(held).toLowerCase()}</>}
        </p>
      )}
      <p className="muted small">
        Sales aren't added to the bottle history.
        {firstTime && ' This first sale also adds a "Sold" sheet to your workbook.'}
      </p>
      <div className="actions">
        <button className="primary" disabled={busy || max === 0} onClick={submit}>
          {busy ? "Saving…" : `💰 Sell ${bottles(count)}`}
        </button>
      </div>
    </Modal>
  );
}

export function formatDay(iso: string | null): string {
  if (!iso) return "No date";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Take bottles off that weren't opened or sold (added by mistake, broken, given away). */
function RemoveDialog({
  wine, stocked, at, busy, lastPurchase, onClose, onRemove,
}: {
  wine: Wine;
  stocked: Location[];
  at: (l: Location) => number;
  busy: boolean;
  lastPurchase: Purchase | null;
  onClose: () => void;
  onRemove: (r: RemoveRequest) => void;
}) {
  const [from, setFrom] = useState<Location>(stocked[0]);
  const [spot, setSpot] = useState<string | null>(() => firstSpot(wine, stocked[0]));
  const [n, setN] = useState(1);
  const [reason, setReason] = useState<RemoveReason>("mistake");
  const [note, setNote] = useState("");
  const [fixPurchase, setFixPurchase] = useState(true);
  // No more than the chosen box (or the not-placed bottles) holds.
  const p = placementOf(wine, from);
  const max = spot === null ? (p.spots.length && p.unplaced > 0 ? p.unplaced : at(from)) : p.spots.find((x) => x.spot === spot)?.n ?? at(from);
  const count = Math.min(n, Math.max(1, max));
  const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
  return (
    <Modal title="Remove bottles" onClose={onClose}>
      <p className="muted small">For bottles that weren't opened or sold. If you drank or sold them, use 🍷 Open or 💰 Sell so they're in your history.</p>
      {stocked.length > 1 ? (
        <div className="seg">
          {stocked.map((l) => (
            <button
              key={l}
              className={l === from ? "on" : ""}
              onClick={() => {
                setFrom(l);
                setSpot(firstSpot(wine, l));
              }}
            >
              {l} ({at(l)})
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">From {from} ({bottles(at(from))})</p>
      )}
      <FromSpot w={wine} loc={from} value={spot} onChange={setSpot} />
      <Stepper value={count} min={1} max={Math.max(1, max)} onChange={setN} />
      <div className="seg rm-reasons" role="radiogroup" aria-label="Why">
        {REMOVE_REASONS.map((r) => (
          <button key={r.key} type="button" role="radio" aria-checked={reason === r.key} className={reason === r.key ? "on" : ""} onClick={() => setReason(r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      {reason === "mistake" && lastPurchase?.date && (
        <label className="switch rm-purchase">
          <input type="checkbox" checked={fixPurchase} onChange={(e) => setFixPurchase(e.target.checked)} /> Also take {count === 1 ? "it" : "them"} off
          your purchase on {fmtDay(lastPurchase.date)}{lastPurchase.source ? ` (${lastPurchase.source})` : ""}
        </label>
      )}
      <label className="field">
        <span>Note (optional)</span>
        <input value={note} placeholder={reason === "gift" ? "Who to" : reason === "broken" ? "What happened" : ""} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => onRemove({ loc: from, n: count, spot, reason, note, purchase: reason === "mistake" && fixPurchase ? lastPurchase : null })}
        >
          {busy ? "Saving…" : `Remove ${bottles(count)} from ${from}`}
        </button>
      </div>
    </Modal>
  );
}

function AddDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (l: Location, n: number, spot: string | null) => void }) {
  const [loc, setLoc] = useState<Location>("K Cellars");
  const [spot, setSpot] = useState<string | null>(null);
  const [n, setN] = useState(1);
  return (
    <Modal title="Add bottles" onClose={onClose}>
      <div className="seg">
        {LOCATIONS.map((l) => (
          <button
            key={l}
            className={l === loc ? "on" : ""}
            onClick={() => {
              setLoc(l);
              setSpot(null);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <Stepper value={n} min={1} max={48} onChange={setN} />
      <SpotSelect loc={loc} value={spot} onChange={setSpot} />
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => onSave(loc, n, spot)}>
          {busy ? "Saving…" : `Add ${bottles(n)} at ${loc}`}
        </button>
      </div>
    </Modal>
  );
}

function ArrivedDialog({
  wine, busy, onClose, onSave,
}: { wine: Wine; busy: boolean; onClose: () => void; onSave: (l: Location, spot: string | null) => void }) {
  const [loc, setLoc] = useState<Location>((wine.kc ?? 0) > 0 ? "K Cellars" : "Home");
  const [spot, setSpot] = useState<string | null>(null);
  return (
    <Modal title="Where did the bottles go?" onClose={onClose}>
      <p className="muted">{locationLine(wine)}</p>
      <div className="seg">
        {LOCATIONS.map((l) => (
          <button
            key={l}
            className={l === loc ? "on" : ""}
            onClick={() => {
              setLoc(l);
              setSpot(null);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <SpotSelect loc={loc} value={spot} onChange={setSpot} />
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => onSave(loc, spot)}>
          {busy ? "Saving…" : `✓ Arrived at ${loc}${spot && spot !== NEW_LOOSE ? ` · ${spot}` : ""}`}
        </button>
      </div>
    </Modal>
  );
}
