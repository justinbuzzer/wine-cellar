import { useMemo, useState, type ReactNode } from "react";
import { shortName, type Cell, type Tasting, type Wine } from "../data";
import { labelReaderOn } from "../label";
import LabelFill, { type LabelApply } from "./LabelFill";
import { findSameWine } from "../dupes";
import { addWine, adjustBottles, updateWine } from "../inventory";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { bottles, useToast } from "../ui";
import { SpotSelect, useResolveSpot } from "./SpotPicker";
import { locationLine } from "./Cellar";
import { logPurchases, purchaseRow } from "../purchases";
import { todayIso } from "../notesmodel";

interface FormState {
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
  price: string;
  source: string;
  status: string;
  remarks: string;
  yearPurchased: string;
  kc: string;
  home: string;
}

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function fromWine(w?: Wine): FormState {
  return {
    producer: s(w?.producer),
    name: s(w?.name),
    vintage: s(w?.vintage),
    type: s(w?.type),
    country: s(w?.country),
    region: s(w?.region),
    location: s(w?.location),
    varietal: s(w?.varietal),
    blend: s(w?.blend),
    alcohol: s(w?.alcohol),
    price: s(w?.price),
    source: s(w?.source),
    status: s(w?.status),
    remarks: s(w?.remarks),
    // New wines default to this year; you can change it (e.g. for older bottles).
    yearPurchased: w ? s(w.yearPurchased) : String(new Date().getFullYear()),
    kc: "0",
    home: "0",
  };
}

/** Form field -> spreadsheet column, and how to convert the typed text. */
const COLUMNS: Record<Exclude<keyof FormState, "kc" | "home">, [string, (v: string) => Cell]> = {
  producer: ["Producer", (v) => v.trim()],
  name: ["Name", (v) => v.trim()],
  vintage: ["Vintage", (v) => (v.trim() === "" ? "" : /^nv$/i.test(v.trim()) ? "NV" : Number(v))],
  type: ["Type", (v) => v],
  country: ["Country", (v) => v.trim()],
  region: ["Region", (v) => v.trim()],
  location: ["Location", (v) => v.trim()],
  varietal: ["Varietal", (v) => v.trim()],
  blend: ["Blend", (v) => v],
  alcohol: ["Alcohol %", (v) => (v.trim() === "" ? "" : Math.round(Number(v) * 10) / 1000)],
  price: ["Price", (v) => (v.trim() === "" ? "" : Number(v))],
  source: ["Source", (v) => v.trim()],
  status: ["Status", (v) => v],
  remarks: ["Remarks", (v) => v.trim()],
  yearPurchased: ["Year Purchased", (v) => (v.trim() === "" ? "" : Number(v))],
};

function validate(f: FormState, adding: boolean): string[] {
  const errs: string[] = [];
  if (!f.producer.trim()) errs.push("Producer is required.");
  if (!f.name.trim()) errs.push("Wine name is required.");
  if (!f.type) errs.push("Type is required.");
  if (f.vintage.trim() && !/^(\d{4}|nv)$/i.test(f.vintage.trim())) errs.push("Vintage must be a year (e.g. 2019) or NV.");
  if (f.alcohol.trim() && !(Number(f.alcohol) > 0 && Number(f.alcohol) < 30)) errs.push("Alcohol should be a percentage like 13.5.");
  if (f.price.trim() && !(Number(f.price) >= 0)) errs.push("Price must be a number.");
  if (f.yearPurchased.trim() && !(/^\d{4}$/.test(f.yearPurchased.trim()) && Number(f.yearPurchased) >= 1900 && Number(f.yearPurchased) <= new Date().getFullYear())) {
    errs.push("Year purchased must be a year like 2016.");
  }
  if (adding) {
    for (const [label, v] of [["K Cellars", f.kc], ["Home", f.home]] as const) {
      if (!/^\d+$/.test(v.trim())) errs.push(`${label} bottles must be a whole number.`);
    }
    if (/^\d+$/.test(f.kc.trim()) && /^\d+$/.test(f.home.trim()) && Number(f.kc) + Number(f.home) < 1) {
      errs.push("Enter how many bottles you have at K Cellars or Home.");
    }
  }
  return errs;
}

/**
 * Purchases log rows for bottles added here, dated today. Only when they were
 * bought this year (an older Year purchased means bottles you're catching up on,
 * whose month isn't known).
 */
function boughtRows(f: FormState, w: Wine, kc: number, home: number) {
  const y = f.yearPurchased.trim();
  if (y && y !== todayIso().slice(0, 4)) return [];
  const price = f.price.trim() ? Number(f.price) : w.price;
  return ([["K Cellars", kc], ["Home", home]] as const)
    .filter(([, n]) => n > 0)
    .map(([to, n]) => purchaseRow(w, { date: todayIso(), bottles: n, price, source: f.source || w.source, to }));
}

export default function WineForm({ id }: { id?: string }) {
  const { data, putWine, putPurchases } = useWorkbook();
  const toast = useToast();
  const original = id ? data.wines.find((w) => w.wineId === id) : undefined;
  const adding = !id;
  const [f, setF] = useState<FormState>(() => fromWine(original));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** Box / rack for a new wine's bottles. */
  const [spots, setSpots] = useState<{ kc: string | null; home: string | null }>({ kc: null, home: null });
  const resolveSpot = useResolveSpot();
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  /** Fields the label reader inferred or found hard to read. */
  const [unsure, setUnsure] = useState<string[]>([]);
  /** Fill from label photos: the reader's answer replaces the wine details (bottles, price and source stay). */
  const applyLabel = (a: LabelApply) => {
    setF((p) => ({ ...p, ...a.fields }));
    setUnsure(a.unsure);
  };
  /** The label matched a wine you have or tasted: copy its details (an exact cellar match then offers "add the bottles instead"). */
  const pickFromLabel = (w: Wine | Tasting) => {
    const t = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
    setF((p) => ({
      ...p,
      producer: t(w.producer), name: t(w.name), vintage: t(w.vintage), type: t(w.type), country: t(w.country),
      region: t(w.region), location: t(w.location), varietal: t(w.varietal), blend: t(w.blend), alcohol: t(w.alcohol),
    }));
    setUnsure([]);
  };

  // Suggestions from what's already in your spreadsheet keep spellings consistent.
  const suggest = useMemo(() => {
    const all = [...data.wines, ...data.tastings];
    const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
    return {
      producer: u(data.wines.map((w) => w.producer)),
      country: u(all.map((w) => w.country)),
      region: u(all.filter((w) => !f.country || w.country === f.country).map((w) => w.region)),
      location: u(all.filter((w) => !f.region || w.region === f.region).map((w) => w.location)),
      varietal: u(all.map((w) => w.varietal)),
      source: u(data.wines.map((w) => w.source)),
    };
  }, [data.wines, data.tastings, f.country, f.region]);

  // Same producer, name and vintage as a wine already in the sheet?
  const same = useMemo(
    () => findSameWine(data.wines, { producer: f.producer, name: f.name, vintage: f.vintage }, id),
    [data.wines, f.producer, f.name, f.vintage, id],
  );

  /** Adds the bottles typed here to the existing wine instead of creating a new row. */
  async function addToExisting(w: Wine) {
    const kc = /^\d+$/.test(f.kc.trim()) ? Number(f.kc) : 0;
    const home = /^\d+$/.test(f.home.trim()) ? Number(f.home) : 0;
    if (kc + home < 1) {
      go(`wine/${w.wineId}`);
      return;
    }
    setBusy(true);
    try {
      const s = f.status === "NYA" ? { kc: null, home: null } : { kc: await resolveSpot(spots.kc), home: await resolveSpot(spots.home) };
      const updated = await adjustBottles(data.file.id, w.wineId!, { "K Cellars": kc, Home: home }, { "K Cellars": { to: s.kc }, Home: { to: s.home } });
      putWine(updated);
      toast({ text: `Added ${bottles(kc + home)} to ${w.wineId}.` });
      go(`wine/${w.wineId}`);
      void logBought(boughtRows(f, updated, kc, home));
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  /** The bottles are in; a log that fails is reported but doesn't undo them. */
  async function logBought(rows: Record<string, Cell>[]) {
    if (!rows.length) return;
    try {
      putPurchases(await logPurchases(data.file.id, rows));
    } catch (e) {
      toast({ text: `Bottles added, but they couldn't be added to the purchase log: ${describeError(e)}`, error: true });
    }
  }

  if (id && !original) {
    return (
      <section className="card">
        <p>Wine {id} wasn't found.</p>
        <a href={href("cellar")}>← Back to cellar</a>
      </section>
    );
  }

  async function save() {
    const errs = validate(f, adding);
    setErrors(errs);
    if (errs.length) return;
    const before = fromWine(original);
    const cells: Record<string, Cell> = {};
    for (const [k, [col, conv]] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, (typeof COLUMNS)[keyof typeof COLUMNS]][]) {
      if (adding || f[k] !== before[k]) cells[col] = conv(f[k]);
    }
    if (!adding && Object.keys(cells).length === 0) {
      go(`wine/${id}`);
      return;
    }
    setBusy(true);
    try {
      const w = adding
        ? await addWine(
            data.file.id,
            cells,
            { kc: Number(f.kc), home: Number(f.home) },
            f.status === "NYA" ? {} : { kc: await resolveSpot(spots.kc), home: await resolveSpot(spots.home) },
          )
        : await updateWine(data.file.id, id!, cells);
      putWine(w);
      toast({ text: adding ? `Added ${w.name} (${w.wineId}).` : "Saved." });
      go(`wine/${w.wineId}`);
      // In the background: the wine page opens straight away.
      if (adding) void logBought(boughtRows(f, w, Number(f.kc), Number(f.home)));
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const typeOptions = data.lists["List_Type"] ?? [];
  const blendOptions = data.lists["List_Blend"] ?? [];
  const statusOptions = data.lists["List_Status"] ?? ["NYA"];

  return (
    <>
      <a className="back" href={href(id ? `wine/${id}` : "cellar")}>← {id ? "Back" : "Cellar"}</a>
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{adding ? "Add a wine" : `Edit ${original?.wineId}`}</h2>
        {adding && labelReaderOn() && <LabelFill compact onApply={applyLabel} onPick={pickFromLabel} />}
        {unsure.length > 0 && <p className="notice small">From the label: check the {unsure.join(", ")}.</p>}

        <Field label="Producer *">
          <input value={f.producer} onChange={set("producer")} list="dl-producer" autoComplete="off" />
        </Field>
        <Field label="Wine name *">
          <input value={f.name} onChange={set("name")} autoComplete="off" />
        </Field>
        <div className="row-2">
          <Field label="Vintage">
            <input value={f.vintage} onChange={set("vintage")} placeholder="2019 or NV" inputMode="text" />
          </Field>
          <Field label="Type *">
            <select value={f.type} onChange={set("type")}>
              <option value="">Choose…</option>
              {typeOptions.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <div className="row-2">
          <Field label="Country">
            <input value={f.country} onChange={set("country")} list="dl-country" autoComplete="off" />
          </Field>
          <Field label="Region">
            <input value={f.region} onChange={set("region")} list="dl-region" autoComplete="off" />
          </Field>
        </div>
        <Field label="Location / appellation">
          <input value={f.location} onChange={set("location")} list="dl-location" autoComplete="off" />
        </Field>
        <div className="row-2">
          <Field label="Varietal">
            <input value={f.varietal} onChange={set("varietal")} list="dl-varietal" autoComplete="off" />
          </Field>
          <Field label="Blend">
            <select value={f.blend} onChange={set("blend")}>
              <option value="" />
              {blendOptions.map((b) => <option key={b}>{b}</option>)}
            </select>
          </Field>
        </div>
        <div className="row-2">
          <Field label="Alcohol %">
            <input value={f.alcohol} onChange={set("alcohol")} inputMode="decimal" placeholder="13.5" />
          </Field>
          <Field label="Price (S$)">
            <input value={f.price} onChange={set("price")} inputMode="decimal" />
          </Field>
        </div>
        <div className="row-2">
          <Field label="Source">
            <input value={f.source} onChange={set("source")} list="dl-source" autoComplete="off" />
          </Field>
          <Field label="Status">
            <select value={f.status} onChange={set("status")}>
              <option value="">In cellar</option>
              {statusOptions.map((o) => <option key={o} value={o}>{o === "NYA" ? "Not yet arrived (NYA)" : o}</option>)}
            </select>
          </Field>
        </div>
        <div className="row-2">
          <Field label="Year purchased">
            <input value={f.yearPurchased} onChange={set("yearPurchased")} inputMode="numeric" maxLength={4} placeholder="e.g. 2016" />
          </Field>
        </div>
        <Field label="Remarks">
          <textarea value={f.remarks} onChange={set("remarks")} rows={3} />
        </Field>

        {adding && (
          <div className="row-2">
            <Field label="Bottles at K Cellars">
              <input value={f.kc} onChange={set("kc")} inputMode="numeric" />
            </Field>
            <Field label="Bottles at Home">
              <input value={f.home} onChange={set("home")} inputMode="numeric" />
            </Field>
          </div>
        )}
        {adding && f.status !== "NYA" && (
          <div className="row-2">
            {Number(f.kc) > 0 ? <SpotSelect loc="K Cellars" value={spots.kc} onChange={(kc) => setSpots({ ...spots, kc })} /> : <span />}
            {Number(f.home) > 0 && <SpotSelect loc="Home" value={spots.home} onChange={(home) => setSpots({ ...spots, home })} />}
          </div>
        )}
        {!adding && <p className="muted small">Bottle counts are changed from the wine's page (Open, Add, Move).</p>}

        {same.length > 0 && (
          <div className="notice dupe-notice">
            {adding ? "You already have this wine and vintage:" : "Another wine has the same producer, name and vintage:"}
            <ul>
              {same.map((w) => (
                <li key={w.wineId}>
                  <a href={href(`wine/${w.wineId}`)}>
                    {w.wineId} · {w.producer} {shortName(w)} {w.vintage}
                  </a>{" "}
                  <span className="muted">· {locationLine(w)}</span>
                  {adding && (
                    <>
                      {" "}
                      <button type="button" className="small" disabled={busy} onClick={() => void addToExisting(w)}>
                        Add these bottles to {w.wineId} instead
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="form-errors">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : adding ? (same.length ? "Add as a separate wine anyway" : "Add wine") : "Save changes"}
          </button>
          <a href={href(id ? `wine/${id}` : "cellar")}>Cancel</a>
        </div>

        {Object.entries(suggest).map(([k, values]) => (
          <datalist key={k} id={`dl-${k}`}>
            {values.map((v) => <option key={v} value={v} />)}
          </datalist>
        ))}
      </form>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
