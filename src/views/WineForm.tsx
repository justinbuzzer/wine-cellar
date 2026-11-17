import { useMemo, useState, type ReactNode } from "react";
import type { Cell, Wine } from "../data";
import { addWine, updateWine } from "../inventory";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { useToast } from "../ui";

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
};

function validate(f: FormState, adding: boolean): string[] {
  const errs: string[] = [];
  if (!f.producer.trim()) errs.push("Producer is required.");
  if (!f.name.trim()) errs.push("Wine name is required.");
  if (!f.type) errs.push("Type is required.");
  if (f.vintage.trim() && !/^(\d{4}|nv)$/i.test(f.vintage.trim())) errs.push("Vintage must be a year (e.g. 2019) or NV.");
  if (f.alcohol.trim() && !(Number(f.alcohol) > 0 && Number(f.alcohol) < 30)) errs.push("Alcohol should be a percentage like 13.5.");
  if (f.price.trim() && !(Number(f.price) >= 0)) errs.push("Price must be a number.");
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

export default function WineForm({ id }: { id?: string }) {
  const { data, putWine } = useWorkbook();
  const toast = useToast();
  const original = id ? data.wines.find((w) => w.wineId === id) : undefined;
  const adding = !id;
  const [f, setF] = useState<FormState>(() => fromWine(original));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

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
        ? await addWine(data.file.id, cells, { kc: Number(f.kc), home: Number(f.home) })
        : await updateWine(data.file.id, id!, cells);
      putWine(w);
      toast({ text: adding ? `Added ${w.name} (${w.wineId}).` : "Saved." });
      go(`wine/${w.wineId}`);
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
        {!adding && <p className="muted small">Bottle counts are changed from the wine's page (Open, Add, Move).</p>}

        {errors.length > 0 && (
          <ul className="form-errors">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : adding ? "Add wine" : "Save changes"}
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
