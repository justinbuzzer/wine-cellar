import { useEffect, useMemo, useState, type ReactNode } from "react";
import { config } from "../config";
import { formatPrice, shortName, type Cell, type Wine } from "../data";
import { findSameWine } from "../dupes";
import { addWine, receiveBottles } from "../inventory";
import { LOCATIONS, type Location } from "../locations";
import { GST_RATE, storedPrice, summarize } from "../purchase";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { Stepper, TypeDot, useToast } from "../ui";

// ---- state ----------------------------------------------------------------------

interface NewFields {
  producer: string;
  name: string;
  vintage: string;
  type: string;
  country: string;
  region: string;
  location: string;
  varietal: string;
  blend: string;
  alcohol: string;
  remarks: string;
}
const EMPTY_NEW: NewFields = {
  producer: "", name: "", vintage: "", type: "", country: "", region: "", location: "", varietal: "", blend: "", alcohol: "", remarks: "",
};

type LineState = "idle" | "saving" | "saved" | "error";
interface Line {
  key: string;
  kind: "pick" | "existing" | "new";
  wineId: string;
  fields: NewFields;
  bottles: number;
  price: string;
  state: LineState;
  message?: string;
}
interface Shared {
  source: string;
  where: Location;
  nya: boolean;
  beforeGst: boolean;
  /** Year bought; defaults to this year. (Optional so drafts saved before it existed still load.) */
  year?: string;
}

const thisYear = () => String(new Date().getFullYear());
const DEFAULT_SHARED: Shared = { source: "", where: "K Cellars", nya: true, beforeGst: false, year: thisYear() };
const yearValue = (s: Shared): number | null => {
  const y = (s.year ?? thisYear()).trim();
  return /^\d{4}$/.test(y) ? Number(y) : null;
};
let keyCounter = 0;
const newKey = () => `line-${Date.now()}-${keyCounter++}`;
const blankLine = (): Line => ({ key: newKey(), kind: "pick", wineId: "", fields: { ...EMPTY_NEW }, bottles: 1, price: "", state: "idle" });

const DRAFT_KEY = `wine-cellar.purchaseDraft.${import.meta.env.MODE}`;
function loadDraft(): { shared: Shared; lines: Line[] } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { shared: Shared; lines: Line[] };
    // A save interrupted by closing the app may or may not have reached Excel.
    d.lines = d.lines.map((l) =>
      l.state === "saving" ? { ...l, state: "error", message: "Saving was interrupted. Check this wine in the Cellar before retrying." } : l,
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
    /* drafts are a convenience */
  }
}

const vintageCell = (v: string): Cell => (v.trim() === "" ? "" : /^nv$/i.test(v.trim()) ? "NV" : Number(v));

function validate(l: Line): string | null {
  if (l.state === "saved") return null;
  if (l.kind === "pick") return "Choose a wine, or remove this line.";
  if (l.bottles < 1) return "Add at least one bottle.";
  if (l.price.trim() && storedPrice(l.price, false) === null) return "Price must be a number.";
  if (l.kind === "new") {
    const f = l.fields;
    if (!f.producer.trim()) return "Producer is required.";
    if (!f.name.trim()) return "Wine name is required.";
    if (!f.type) return "Type is required.";
    if (f.vintage.trim() && !/^(\d{4}|nv)$/i.test(f.vintage.trim())) return "Vintage must be a year or NV.";
    if (f.alcohol.trim() && !(Number(f.alcohol) > 0 && Number(f.alcohol) < 30)) return "Alcohol should be like 13.5.";
  }
  return null;
}

// ---- component ------------------------------------------------------------------

export default function PurchaseForm() {
  const { data, putWine } = useWorkbook();
  const toast = useToast();
  const [initial] = useState(() => loadDraft());
  const [shared, setShared] = useState<Shared>(initial?.shared ?? DEFAULT_SHARED);
  const [lines, setLines] = useState<Line[]>(initial?.lines?.length ? initial.lines : [blankLine()]);
  const [restored, setRestored] = useState(!!initial);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const hasContent = lines.some((l) => l.kind !== "pick") || !!shared.source;
  useEffect(() => {
    if (hasContent) saveDraft({ shared, lines });
  }, [shared, lines, hasContent]);

  const setLine = (key: string, patch: Partial<Line> | ((l: Line) => Partial<Line>)) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)));
  const setField = (key: string, k: keyof NewFields, v: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, fields: { ...l.fields, [k]: v } } : l)));

  const wineById = useMemo(() => new Map(data.wines.map((w) => [w.wineId, w])), [data.wines]);
  const sources = useMemo(
    () => [...new Set(data.wines.map((w) => w.source).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    [data.wines],
  );

  const pending = lines.filter((l) => l.kind !== "pick" && l.state !== "saved");
  const summary = summarize(
    lines
      .filter((l) => l.kind !== "pick")
      .map((l) => ({
        kind: l.kind === "new" ? "new" : "existing",
        bottles: l.bottles,
        // A blank price on a wine you already have means "keep its current price" (already after GST).
        price: l.price.trim()
          ? storedPrice(l.price, shared.beforeGst)
          : l.kind === "existing"
            ? wineById.get(l.wineId)?.price ?? null
            : null,
      })),
  );
  const allSaved = lines.length > 0 && lines.every((l) => l.state === "saved");

  async function saveAll() {
    setShowErrors(true);
    const problems = lines.map(validate).filter(Boolean);
    const y = yearValue(shared);
    if ((shared.year ?? "").trim() && (y === null || y < 1900 || y > new Date().getFullYear())) {
      toast({ text: "Year purchased must be a year like 2026.", error: true });
      return;
    }
    if (problems.length) {
      toast({ text: `Fix ${problems.length} line${problems.length === 1 ? "" : "s"} first.`, error: true });
      return;
    }
    setBusy(true);
    let saved = 0;
    let failed = 0;
    for (const line of lines) {
      if (line.state === "saved") continue;
      setLine(line.key, { state: "saving", message: undefined });
      try {
        const price = storedPrice(line.price, shared.beforeGst);
        if (line.kind === "existing") {
          const before = wineById.get(line.wineId);
          const { wine, markedNya } = await receiveBottles(data.file.id, line.wineId, shared.where, line.bottles, {
            price: price !== null && price !== before?.price ? price : undefined,
            notYetArrived: shared.nya,
            yearPurchased: yearValue(shared),
          });
          putWine(wine);
          setLine(line.key, {
            state: "saved",
            message: `+${line.bottles} at ${shared.where} · now ${wine.qty} bottle${wine.qty === 1 ? "" : "s"}${markedNya ? " · not yet arrived" : ""}`,
          });
        } else {
          const f = line.fields;
          const cells: Record<string, Cell> = {
            Producer: f.producer.trim(),
            Name: f.name.trim(),
            Vintage: vintageCell(f.vintage),
            Type: f.type,
            Country: f.country.trim(),
            Region: f.region.trim(),
            Location: f.location.trim(),
            Varietal: f.varietal.trim(),
            Blend: f.blend,
            "Alcohol %": f.alcohol.trim() === "" ? "" : Math.round(Number(f.alcohol) * 10) / 1000,
            Price: price ?? "",
            Source: shared.source.trim(),
            Status: shared.nya ? "NYA" : "",
            Remarks: f.remarks.trim(),
            "Year Purchased": yearValue(shared) ?? "",
          };
          const wine = await addWine(data.file.id, cells, {
            kc: shared.where === "K Cellars" ? line.bottles : 0,
            home: shared.where === "Home" ? line.bottles : 0,
          });
          putWine(wine);
          setLine(line.key, { state: "saved", message: `Added as ${wine.wineId}` });
        }
        saved++;
      } catch (e) {
        failed++;
        setLine(line.key, { state: "error", message: describeError(e) });
      }
    }
    setBusy(false);
    if (failed) {
      toast({ text: `${saved} saved, ${failed} failed. Fix or retry the lines marked in red.`, error: true });
    } else {
      saveDraft(null);
      toast({ text: `Purchase saved: ${saved} line${saved === 1 ? "" : "s"}.` });
    }
  }

  function discard() {
    saveDraft(null);
    setShared(DEFAULT_SHARED);
    setLines([blankLine()]);
    setRestored(false);
    setShowErrors(false);
  }

  return (
    <>
      <a className="back" href={href("cellar")}>← Cellar</a>
      {restored && !allSaved && (
        <div className="notice">
          Restored your unsaved purchase. <button className="link" onClick={discard}>Discard it</button>
        </div>
      )}

      <h2 className="note-form-title">Add a purchase</h2>

      <section className="card note-section">
        <h3>For the whole purchase</h3>
        <Label text="Source (merchant)">
          <input value={shared.source} onChange={(e) => setShared({ ...shared, source: e.target.value })} list="dl-purchase-source" autoComplete="off" />
          <datalist id="dl-purchase-source">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        </Label>
        <Label text="Bottles go to">
          <div className="seg">
            {LOCATIONS.map((l) => (
              <button key={l} type="button" className={shared.where === l ? "on" : ""} onClick={() => setShared({ ...shared, where: l })}>{l}</button>
            ))}
          </div>
        </Label>
        <Label text="Year purchased">
          <input
            value={shared.year ?? thisYear()}
            onChange={(e) => setShared({ ...shared, year: e.target.value.replace(/\D/g, "") })}
            inputMode="numeric"
            maxLength={4}
            className="year-input"
          />
        </Label>
        <label className="switch">
          <input type="checkbox" checked={shared.nya} onChange={(e) => setShared({ ...shared, nya: e.target.checked })} /> Not yet arrived
        </label>
        <label className="switch">
          <input type="checkbox" checked={shared.beforeGst} onChange={(e) => setShared({ ...shared, beforeGst: e.target.checked })} /> Prices
          are before GST (add {GST_RATE}%)
        </label>
      </section>

      {lines.map((line, i) => (
        <LineCard
          key={line.key}
          index={i}
          line={line}
          shared={shared}
          error={showErrors ? validate(line) : null}
          wine={wineById.get(line.wineId)}
          canRemove={lines.length > 1 && line.state !== "saved" && !busy}
          onRemove={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
          onChange={(patch) => setLine(line.key, patch)}
          onField={(k, v) => setField(line.key, k, v)}
          onSameProducer={() =>
            setLines((ls) => {
              const at = ls.findIndex((l) => l.key === line.key);
              const f = line.fields;
              const copy: Line = {
                ...blankLine(),
                kind: "new",
                fields: { ...EMPTY_NEW, producer: f.producer, country: f.country, region: f.region, location: f.location, type: f.type },
              };
              return [...ls.slice(0, at + 1), copy, ...ls.slice(at + 1)];
            })
          }
        />
      ))}

      {!allSaved && (
        <button type="button" className="add-line" disabled={busy} onClick={() => setLines((ls) => [...ls, blankLine()])}>
          + Add another wine
        </button>
      )}

      <div className="save-bar purchase-bar">
        <div className="purchase-summary">
          {summary.newWines > 0 && <span>{summary.newWines} new wine{summary.newWines === 1 ? "" : "s"}</span>}
          {summary.existingWines > 0 && <span>{summary.existingWines} you already have</span>}
          <span><strong>{summary.bottles}</strong> bottle{summary.bottles === 1 ? "" : "s"}</span>
          {summary.total > 0 && <span><strong>{formatPrice(summary.total, config.currency)}</strong>{summary.unpriced ? " + unpriced" : ""}</span>}
          <span className="muted">{shared.where}{shared.nya ? " · not yet arrived" : ""}</span>
        </div>
        {allSaved ? (
          <button className="primary" onClick={() => go("cellar")}>Done: back to Cellar</button>
        ) : (
          <button className="primary" disabled={busy || pending.length === 0} onClick={() => void saveAll()}>
            {busy ? "Saving…" : `Save ${pending.length} line${pending.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      {shared.nya && summary.existingWines > 0 && !allSaved && (
        <p className="muted small">
          Wines you already have that still have bottles won't be marked Not yet arrived. Their new bottles are simply
          added.
        </p>
      )}
    </>
  );
}

// ---- one line ---------------------------------------------------------------------

function LineCard({
  index, line, shared, error, wine, canRemove, onRemove, onChange, onField, onSameProducer,
}: {
  index: number;
  line: Line;
  shared: Shared;
  error: string | null;
  wine: Wine | undefined;
  canRemove: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<Line>) => void;
  onField: (k: keyof NewFields, v: string) => void;
  onSameProducer: () => void;
}) {
  const { data } = useWorkbook();
  const locked = line.state === "saved" || line.state === "saving";
  const same = useMemo(
    () => (line.kind === "new" && line.state !== "saved" ? findSameWine(data.wines, line.fields) : []),
    [data.wines, line.kind, line.state, line.fields],
  );
  const converted = shared.beforeGst ? storedPrice(line.price, true) : null;
  const title =
    line.kind === "existing" && wine
      ? `${wine.producer ?? ""} ${shortName(wine)} ${wine.vintage ?? ""}`
      : line.kind === "new"
        ? [line.fields.producer, shortName({ producer: line.fields.producer, name: line.fields.name }), line.fields.vintage]
            .filter(Boolean)
            .join(" ") || "New wine"
        : `Wine ${index + 1}`;

  return (
    <section className={`card note-section line-card ${line.state}`}>
      <div className="line-head">
        <h3>
          {line.state === "saved" ? "✓ " : ""}
          {title}
        </h3>
        {canRemove && <button type="button" className="link" aria-label="Remove this wine" onClick={onRemove}>✕</button>}
      </div>

      {line.message && <p className={line.state === "error" ? "warn" : "ok"}>{line.message}</p>}
      {error && <p className="warn">{error}</p>}

      {line.state === "saved" ? null : line.kind === "pick" ? (
        <LinePicker
          onExisting={(w) => onChange({ kind: "existing", wineId: w.wineId ?? "", price: "" })}
          onNew={(name) => onChange({ kind: "new", fields: { ...EMPTY_NEW, name } })}
        />
      ) : (
        <>
          {line.kind === "existing" && wine && (
            <div className="picked-wine">
              <TypeDot type={wine.type} />
              <div className="wc-meta">
                {wine.wineId} · {wine.qty > 0 ? `${wine.qty} in cellar now` : "finished"} · {[wine.region, wine.country].filter(Boolean).join(", ")}
                {!locked && (
                  <> · <button type="button" className="link" onClick={() => onChange({ kind: "pick", wineId: "", price: "" })}>change</button></>
                )}
              </div>
            </div>
          )}
          {line.kind === "new" && <NewWineFields f={line.fields} onField={onField} disabled={locked} />}
          {same.length > 0 && !locked && (
            <div className="notice dupe-notice">
              You already have this wine and vintage:
              <ul>
                {same.map((w) => (
                  <li key={w.wineId}>
                    {w.wineId} · {w.producer} {shortName(w)} {w.vintage}{" "}
                    <span className="muted">· {w.qty > 0 ? `${w.qty} in cellar now` : "finished"}</span>{" "}
                    <button
                      type="button"
                      className="small"
                      onClick={() => onChange({ kind: "existing", wineId: w.wineId ?? "", state: "idle", message: undefined })}
                    >
                      Add the bottles to {w.wineId} instead
                    </button>
                  </li>
                ))}
              </ul>
              <span className="muted small">Or leave it as a new wine to add a separate row.</span>
            </div>
          )}

          <div className="row-2 line-qty">
            <Label text="Bottles">
              <Stepper value={line.bottles} min={1} max={120} onChange={(n) => onChange({ bottles: n })} />
            </Label>
            <Label text={`Price per bottle${shared.beforeGst ? " (before GST)" : ""}`}>
              <input
                value={line.price}
                onChange={(e) => onChange({ price: e.target.value })}
                inputMode="decimal"
                placeholder={line.kind === "existing" && wine?.price != null ? "Blank keeps the current price" : "S$"}
                disabled={locked}
              />
              {line.kind === "existing" && wine?.price != null && !line.price.trim() && (
                <span className="muted small">Current price {formatPrice(wine.price, config.currency)}</span>
              )}
              {converted !== null && <span className="muted small">→ {formatPrice(converted, config.currency)} after GST</span>}
            </Label>
          </div>
          {line.kind === "new" && !locked && (
            <button type="button" className="link" onClick={onSameProducer}>+ Same producer, another wine</button>
          )}
        </>
      )}
    </section>
  );
}

function LinePicker({ onExisting, onNew }: { onExisting: (w: Wine) => void; onNew: (name: string) => void }) {
  const { data } = useWorkbook();
  const [q, setQ] = useState("");
  const tokens = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = tokens.length
    ? data.wines
        .filter((w) => {
          const hay = [w.wineId, w.producer, w.name, w.vintage, w.region, w.location].join(" ").toLocaleLowerCase();
          return tokens.every((t) => hay.includes(t));
        })
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 6)
    : [];
  return (
    <div className="wine-picker">
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a wine: your cellar is searched first…" />
      {tokens.length > 0 && (
        <div className="choice-list">
          {results.map((w) => (
            <button key={w.wineId} type="button" className="choice pick" onClick={() => onExisting(w)}>
              <span>
                <TypeDot type={w.type} /> <strong>{w.producer}</strong> {shortName(w)} <span className="muted">{w.vintage}</span>
              </span>
              <span className="pick-detail cellar">
                Already have · {w.qty > 0 ? `${w.qty} bottle${w.qty === 1 ? "" : "s"}` : "finished"} · add bottles to {w.wineId}
              </span>
            </button>
          ))}
          <button type="button" className="choice pick new" onClick={() => onNew(q.trim())}>
            <span>+ New wine: <strong>“{q.trim()}”</strong></span>
            <span className="pick-detail">Fill in its details</span>
          </button>
        </div>
      )}
    </div>
  );
}

function NewWineFields({ f, onField, disabled }: { f: NewFields; onField: (k: keyof NewFields, v: string) => void; disabled: boolean }) {
  const { data } = useWorkbook();
  const lists = useMemo(() => {
    const all = [...data.wines, ...data.tastings];
    const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
    return {
      producer: u(data.wines.map((w) => w.producer)),
      country: u(all.map((w) => w.country)),
      region: u(all.filter((w) => !f.country || w.country === f.country).map((w) => w.region)),
      location: u(all.filter((w) => !f.region || w.region === f.region).map((w) => w.location)),
      varietal: u(all.map((w) => w.varietal)),
    };
  }, [data.wines, data.tastings, f.country, f.region]);
  const id = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const input = (k: keyof NewFields, extra: Record<string, unknown> = {}) => (
    <input value={f[k]} onChange={(e) => onField(k, e.target.value)} disabled={disabled} autoComplete="off" {...extra} />
  );
  return (
    <div className="wine-details">
      <div className="row-2">
        <Label text="Producer *">{input("producer", { list: `dl-${id}-producer` })}</Label>
        <Label text="Wine name *">{input("name")}</Label>
      </div>
      <div className="row-2">
        <Label text="Vintage">{input("vintage", { placeholder: "2019 or NV" })}</Label>
        <Label text="Type *">
          <select value={f.type} onChange={(e) => onField("type", e.target.value)} disabled={disabled}>
            <option value="">Choose…</option>
            {(data.lists["List_Type"] ?? []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Label>
      </div>
      <div className="row-2">
        <Label text="Country">{input("country", { list: `dl-${id}-country` })}</Label>
        <Label text="Region">{input("region", { list: `dl-${id}-region` })}</Label>
      </div>
      <div className="row-2">
        <Label text="Location / appellation">{input("location", { list: `dl-${id}-location` })}</Label>
        <Label text="Varietal">{input("varietal", { list: `dl-${id}-varietal` })}</Label>
      </div>
      <div className="row-2">
        <Label text="Blend">
          <select value={f.blend} onChange={(e) => onField("blend", e.target.value)} disabled={disabled}>
            <option value="" />
            {(data.lists["List_Blend"] ?? []).map((b) => <option key={b}>{b}</option>)}
          </select>
        </Label>
        <Label text="Alcohol %">{input("alcohol", { inputMode: "decimal", placeholder: "13.5" })}</Label>
      </div>
      <Label text="Remarks">{input("remarks")}</Label>
      {Object.entries(lists).map(([k, values]) => (
        <datalist key={k} id={`dl-${id}-${k}`}>{values.map((v) => <option key={v} value={v} />)}</datalist>
      ))}
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
