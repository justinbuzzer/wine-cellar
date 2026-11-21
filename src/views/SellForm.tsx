import { useEffect, useMemo, useState, type ReactNode } from "react";
import { config } from "../config";
import { formatPrice, shortName, type Wine } from "../data";
import { type Location } from "../locations";
import { todayIso } from "../notesmodel";
import { go, href } from "../router";
import { sellBottles, undoSale } from "../sales";
import { formatPct, lastBoughtYear, saleMoney, type Sale } from "../salesmodel";
import { describeError, useWorkbook } from "../store";
import { bottles, Stepper, TypeDot, useToast } from "../ui";

// Selling several wines in one go: one line per wine (where from, how many,
// price per bottle), with the date, buyer and notes shared by the whole order.
// Each line becomes one row on the Sold sheet, exactly like a single sale.

type LineState = "idle" | "saving" | "saved" | "error";
interface Line {
  key: string;
  wineId: string;
  from: Location;
  bottles: number;
  /** Sold for, per bottle. */
  price: string;
  /** Paid, per bottle (pre-filled from the wine list). */
  paid: string;
  /** Year bought (pre-filled). */
  year: string;
  state: LineState;
  message?: string;
  /** Once saved: what Undo needs. */
  saleId?: string | null;
}
interface Shared {
  date: string;
  buyer: string;
  notes: string;
}

const DRAFT_KEY = `wine-cellar.saleDraft.${import.meta.env.MODE}`;
let keyCounter = 0;
const newKey = () => `sale-${Date.now()}-${keyCounter++}`;

const num = (s: string): number | null => {
  const t = s.replace(/[^0-9.]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const yearOf = (s: string): number | null => (/^\d{4}$/.test(s.trim()) ? Number(s.trim()) : null);
const money = (n: number) => formatPrice(Math.round(n * 100) / 100, config.currency);

const stock = (w: Wine | undefined, l: Location): number => (!w ? 0 : l === "Home" ? (w.home ?? 0) : (w.kc ?? 0));
const stockedAt = (w: Wine | undefined): Location[] => (["K Cellars", "Home"] as Location[]).filter((l) => stock(w, l) > 0);

/** Wines that can be sold: bottles at a location. */
export const sellable = (w: Wine): boolean => stockedAt(w).length > 0;

function loadDraft(): { shared: Shared; lines: Line[] } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { shared: Shared; lines: Line[] };
    if (!d.lines?.length || d.lines.every((l) => l.state === "saved")) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    d.lines = d.lines.map((l) =>
      l.state === "saving" ? { ...l, state: "error", message: "Saving was interrupted. Check this wine's bottles before retrying." } : l,
    );
    return d;
  } catch {
    return null;
  }
}
function saveDraft(d: { shared: Shared; lines: Line[] } | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* a convenience only */
  }
}

export default function SellForm({ preselect }: { preselect?: string }) {
  const { data, putWine, putSale, removeSale } = useWorkbook();
  const toast = useToast();
  const wineById = useMemo(() => new Map(data.wines.map((w) => [w.wineId, w])), [data.wines]);

  const lineFor = (w: Wine): Line => {
    const at = stockedAt(w);
    const year = w.yearPurchased ?? lastBoughtYear(data.sales, w.wineId ?? "");
    return {
      key: newKey(),
      wineId: w.wineId ?? "",
      from: at.includes("K Cellars") ? "K Cellars" : at[0] ?? "K Cellars",
      bottles: 1,
      price: "",
      paid: w.price !== null ? String(w.price) : "",
      year: year !== null ? String(year) : "",
      state: "idle",
    };
  };

  const [initial] = useState(() => {
    const ids = (preselect ?? "").split(",").filter(Boolean);
    if (ids.length) {
      return {
        shared: { date: todayIso(), buyer: "", notes: "" },
        lines: ids.map((id) => wineById.get(id)).filter((w): w is Wine => !!w && sellable(w)).map(lineFor),
        restored: false,
      };
    }
    const d = loadDraft();
    return d ? { ...d, restored: true } : { shared: { date: todayIso(), buyer: "", notes: "" }, lines: [] as Line[], restored: false };
  });
  const [shared, setShared] = useState<Shared>(initial.shared);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [restored, setRestored] = useState(initial.restored);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const finished = lines.length > 0 && lines.every((l) => l.state === "saved");
  useEffect(() => {
    if (finished) saveDraft(null);
    else if (lines.length) saveDraft({ shared, lines });
    else saveDraft(null);
  }, [shared, lines, finished]);

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const buyers = useMemo(
    () => [...new Set(data.sales.map((s) => s.buyer).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    [data.sales],
  );

  const lineProblem = (l: Line): string | null => {
    if (l.state === "saved") return null;
    const w = wineById.get(l.wineId);
    if (!w) return "This wine is no longer in the cellar.";
    if (stock(w, l.from) < l.bottles) return `Only ${bottles(stock(w, l.from))} at ${l.from}.`;
    if (num(l.price) === null) return "Enter the price each bottle sold for.";
    const y = yearOf(l.year);
    if (l.year.trim() && (y === null || y < 1900)) return "Year bought should be four digits, e.g. 2016.";
    if (y !== null && y > Number(shared.date.slice(0, 4))) return "The year bought is after the date sold.";
    return null;
  };

  /** A sale record for the money sums (not saved). */
  const asSale = (l: Line): Sale => ({
    saleId: "", date: shared.date, wineId: l.wineId, producer: null, name: null, vintage: null, type: null, from: l.from,
    bottles: l.bottles, salePrice: num(l.price), boughtPrice: num(l.paid), boughtYear: yearOf(l.year), buyer: null, notes: null,
  });

  const priced = lines.filter((l) => num(l.price) !== null);
  const totalBottles = lines.reduce((s, l) => s + l.bottles, 0);
  const totalValue = priced.reduce((s, l) => s + saleMoney(asSale(l)).revenue, 0);
  const withCost = priced.map((l) => saleMoney(asSale(l))).filter((m) => m.gain !== null && m.cost);
  const cost = withCost.reduce((s, m) => s + (m.cost ?? 0), 0);
  const gain = withCost.reduce((s, m) => s + (m.gain ?? 0), 0);
  const pending = lines.filter((l) => l.state !== "saved");

  async function sellAll() {
    setTried(true);
    const problems = pending.filter((l) => lineProblem(l));
    if (problems.length) {
      toast({ text: `Fix ${problems.length} line${problems.length === 1 ? "" : "s"} first.`, error: true });
      return;
    }
    setBusy(true);
    const sold: { wineId: string; from: Location; bottles: number; saleId: string | null }[] = [];
    let failed = 0;
    for (const l of pending) {
      setLine(l.key, { state: "saving", message: undefined });
      try {
        const res = await sellBottles(data.file.id, l.wineId, l.from, {
          bottles: l.bottles,
          date: shared.date,
          salePrice: num(l.price)!,
          boughtPrice: num(l.paid),
          boughtYear: yearOf(l.year),
          buyer: shared.buyer,
          notes: shared.notes,
        });
        putWine(res.wine);
        if (res.sale) putSale(res.sale);
        const saleId = res.sale?.saleId ?? null;
        sold.push({ wineId: l.wineId, from: l.from, bottles: l.bottles, saleId });
        setLine(l.key, {
          state: "saved",
          saleId,
          message: res.logError
            ? `Took ${bottles(l.bottles)} off ${l.from}, but the sale couldn't be recorded: ${describeError(res.logError)}`
            : `Sold · ${res.wine.qty} left`,
        });
      } catch (e) {
        failed++;
        setLine(l.key, { state: "error", message: describeError(e) });
      }
    }
    setBusy(false);
    if (failed) {
      toast({ text: `${sold.length} sold, ${failed} failed. Fix or retry the lines marked in red.`, error: true });
      return;
    }
    saveDraft(null);
    const n = sold.reduce((s, x) => s + x.bottles, 0);
    toast({
      text: `Sold ${bottles(n)} for ${money(totalValue)}.`,
      action: {
        label: "Undo",
        run: async () => {
          try {
            for (const x of sold) {
              putWine(await undoSale(data.file.id, x.wineId, x.from, x.bottles, x.saleId));
              if (x.saleId) removeSale(x.saleId);
            }
            toast({ text: "Sale undone: the bottles are back." });
            setLines((ls) => ls.map((l) => ({ ...l, state: "idle", message: undefined, saleId: undefined })));
          } catch (e) {
            toast({ text: describeError(e), error: true });
          }
        },
      },
    });
  }

  function discard() {
    saveDraft(null);
    setShared({ date: todayIso(), buyer: "", notes: "" });
    setLines([]);
    setRestored(false);
    setTried(false);
  }

  const inSale = new Set(lines.map((l) => l.wineId));

  return (
    <>
      <a className="back" href={href("cellar")}>← Cellar</a>
      {restored && !finished && (
        <div className="notice">
          Restored your unsaved sale. <button className="link" onClick={discard}>Discard it</button>
        </div>
      )}

      <h2 className="note-form-title">Sell bottles</h2>

      {!finished && <SellPicker exclude={inSale} onPick={(w) => setLines((ls) => [...ls, lineFor(w)])} />}

      {lines.map((l) => (
        <SellLine
          key={l.key}
          line={l}
          wine={wineById.get(l.wineId)}
          problem={tried ? lineProblem(l) : null}
          money={num(l.price) !== null ? saleMoney(asSale(l)) : null}
          busy={busy}
          onChange={(p) => setLine(l.key, p)}
          onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
        />
      ))}

      {lines.length > 0 && (
        <section className="card note-section">
          <h3>For the whole sale</h3>
          <div className="row-2">
            <Label text="Date sold">
              <input type="date" value={shared.date} max={todayIso()} disabled={finished} onChange={(e) => setShared({ ...shared, date: e.target.value || todayIso() })} />
            </Label>
            <Label text="Buyer or where (optional)">
              <input value={shared.buyer} list="dl-sale-buyer" autoComplete="off" disabled={finished} placeholder="e.g. auction house, a friend" onChange={(e) => setShared({ ...shared, buyer: e.target.value })} />
              <datalist id="dl-sale-buyer">{buyers.map((b) => <option key={b} value={b} />)}</datalist>
            </Label>
          </div>
          <Label text="Notes (optional)">
            <input value={shared.notes} disabled={finished} placeholder="e.g. fees, lot numbers" onChange={(e) => setShared({ ...shared, notes: e.target.value })} />
          </Label>
          {!data.hasSales && <p className="muted small">This first sale also adds a "Sold" sheet to your workbook.</p>}
        </section>
      )}

      {lines.length > 0 && (
        <div className="save-bar purchase-bar">
          <div className="purchase-summary">
            <span><strong>{bottles(totalBottles)}</strong></span>
            <span><strong>{money(totalValue)}</strong>{priced.length < lines.length ? " so far" : ""}</span>
            {withCost.length > 0 && (
              <span className="muted">
                {gain >= 0 ? "gain" : "loss"} {money(Math.abs(gain))} ({formatPct(cost ? gain / cost : null)})
                {withCost.length < priced.length ? " on wines with a purchase price" : ""}
              </span>
            )}
          </div>
          {finished ? (
            <div className="purchase-done">
              <button onClick={discard}>Sell more</button>
              <button className="primary" onClick={() => { discard(); go("cellar"); }}>Done: back to Cellar</button>
            </div>
          ) : (
            <button className="primary" disabled={busy || pending.length === 0} onClick={() => void sellAll()}>
              {busy ? "Saving…" : `💰 Sell ${bottles(pending.reduce((s, l) => s + l.bottles, 0))}${priced.length === lines.length ? ` for ${money(totalValue)}` : ""}`}
            </button>
          )}
        </div>
      )}
      {lines.length === 0 && <p className="muted center-text">Search above to add the wines in this sale.</p>}
    </>
  );
}

function SellLine({
  line, wine, problem, money: m, busy, onChange, onRemove,
}: {
  line: Line;
  wine: Wine | undefined;
  problem: string | null;
  money: ReturnType<typeof saleMoney> | null;
  busy: boolean;
  onChange: (p: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const locked = line.state === "saved" || line.state === "saving" || busy;
  const at = stockedAt(wine);
  const places = at;
  const max = Math.max(1, stock(wine, line.from));
  return (
    <section className={`card note-section line-card ${line.state}`}>
      <div className="line-head">
        <h3>
          {line.state === "saved" ? "✓ " : ""}
          {wine ? (
            <>
              <TypeDot type={wine.type} /> {wine.producer} {shortName(wine)} <span className="muted">{wine.vintage}</span>
            </>
          ) : (
            line.wineId
          )}
        </h3>
        {!locked && <button type="button" className="link" aria-label="Remove this wine" onClick={onRemove}>✕</button>}
      </div>
      {line.message && <p className={line.state === "error" ? "warn" : "ok"}>{line.message}</p>}
      {problem && <p className="warn">{problem}</p>}
      {line.state !== "saved" && (
        <>
          {places.length > 1 ? (
            <div className="seg">
              {places.map((l) => (
                <button
                  key={l}
                  type="button"
                  disabled={locked}
                  className={l === line.from ? "on" : ""}
                  onClick={() => onChange({ from: l, bottles: Math.min(line.bottles, Math.max(1, stock(wine, l))) })}
                >
                  {l} ({stock(wine, l)})
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">From {line.from} ({bottles(stock(wine, line.from))})</p>
          )}
          <div className="row-2 line-qty">
            <Label text="Bottles">
              <Stepper value={Math.min(line.bottles, max)} min={1} max={max} onChange={(n) => onChange({ bottles: n })} />
            </Label>
            <Label text="Sold for, per bottle (S$)">
              <input value={line.price} inputMode="decimal" placeholder="e.g. 180" disabled={locked} aria-invalid={!!problem && num(line.price) === null} onChange={(e) => onChange({ price: e.target.value })} />
            </Label>
          </div>
          <div className="row-2">
            <Label text="Paid, per bottle (S$)">
              <input value={line.paid} inputMode="decimal" placeholder="unknown" disabled={locked} onChange={(e) => onChange({ paid: e.target.value })} />
            </Label>
            <Label text="Year bought">
              <input value={line.year} inputMode="numeric" maxLength={4} placeholder="e.g. 2016" disabled={locked} onChange={(e) => onChange({ year: e.target.value.replace(/\D/g, "") })} />
            </Label>
          </div>
        </>
      )}
      {m && (
        <p className="muted small line-total">
          {bottles(line.bottles)} × {money(num(line.price) ?? 0)} = <strong>{money(m.revenue)}</strong>
          {m.gain !== null && <> · {m.gain >= 0 ? "gain" : "loss"} {money(Math.abs(m.gain))} ({formatPct(m.pct)})</>}
        </p>
      )}
    </section>
  );
}

function SellPicker({ exclude, onPick }: { exclude: Set<string>; onPick: (w: Wine) => void }) {
  const { data } = useWorkbook();
  const [q, setQ] = useState("");
  const tokens = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = tokens.length
    ? data.wines
        .filter((w) => sellable(w) && !exclude.has(w.wineId ?? ""))
        .filter((w) => {
          const hay = [w.wineId, w.producer, w.name, w.vintage, w.region, w.location].join(" ").toLocaleLowerCase();
          return tokens.every((t) => hay.includes(t));
        })
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 8)
    : [];
  return (
    <div className="wine-picker sell-picker">
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a wine to this sale: search your cellar…" />
      {tokens.length > 0 && (
        <div className="choice-list">
          {results.map((w) => (
            <button
              key={w.wineId}
              type="button"
              className="choice pick"
              onClick={() => {
                onPick(w);
                setQ("");
              }}
            >
              <span>
                <TypeDot type={w.type} /> <strong>{w.producer}</strong> {shortName(w)} <span className="muted">{w.vintage}</span>
              </span>
              <span className="pick-detail cellar">{bottles(w.qty)} · {stockedAt(w).map((l) => `${l} ${stock(w, l)}`).join(" · ")}</span>
            </button>
          ))}
          {results.length === 0 && <p className="muted small">No wines with bottles in stock match.</p>}
        </div>
      )}
    </div>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="field">
      <span>{text}</span>
      {children}
    </div>
  );
}
