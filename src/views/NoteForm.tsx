import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { config } from "../config";
import { norm, shortName, type Cell, type Tasting, type Wine } from "../data";
import { addTasting, updateTasting } from "../notes";
import {
  AGEING,
  buildVocab,
  COLOUR_INTENSITIES,
  composeNote,
  excelSerial,
  huesFor,
  joinColour,
  parseNote,
  QUALITIES,
  showsTannin,
  splitColour,
  splitTerms,
  suggest,
  todayIso,
} from "../notesmodel";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { ChipGroup, TagInput, TypeDot, useToast } from "../ui";

// ---- form state ----------------------------------------------------------------

interface NoteState {
  wineId: string;
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
  colourIntensity: string;
  colourHue: string;
  noseIntensity: string;
  noseTags: string[];
  sameAsNose: boolean;
  tasteTags: string[];
  palateIntensity: string;
  dryness: string;
  acid: string;
  tannin: string;
  tanninTags: string[];
  body: string;
  finish: string;
  score: number | null;
  quality: string;
  ageing: string;
  noteFree: string;
  date: string;
  year: string;
  source: string;
  vessel: string;
  viticulture: string;
}

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

const EMPTY: NoteState = {
  wineId: "", producer: "", name: "", vintage: "", type: "", country: "", region: "", location: "",
  varietal: "", blend: "", alcohol: "", price: "",
  colourIntensity: "", colourHue: "", noseIntensity: "", noseTags: [], sameAsNose: true, tasteTags: [],
  palateIntensity: "", dryness: "", acid: "", tannin: "", tanninTags: [], body: "", finish: "",
  score: null, quality: "", ageing: "", noteFree: "",
  date: todayIso(), year: "", source: "", vessel: "", viticulture: "",
};

type WineFields = Pick<Wine, "wineId" | "producer" | "name" | "vintage" | "type" | "country" | "region" | "location" | "varietal" | "blend" | "alcohol" | "price">;

function wineFields(w: Partial<WineFields>): Partial<NoteState> {
  return {
    wineId: s(w.wineId), producer: s(w.producer), name: s(w.name), vintage: s(w.vintage), type: s(w.type),
    country: s(w.country), region: s(w.region), location: s(w.location), varietal: s(w.varietal),
    blend: s(w.blend), alcohol: s(w.alcohol), price: s(w.price),
  };
}

function fromTasting(t: Tasting): NoteState {
  const c = splitColour(t.colour);
  const n = parseNote(t.note);
  const nose = splitTerms(t.nose);
  const taste = splitTerms(t.taste);
  const same = !t.taste || t.taste.trim() === (t.nose ?? "").trim();
  return {
    ...EMPTY,
    ...wineFields(t),
    colourIntensity: c.intensity, colourHue: c.hue,
    noseIntensity: s(t.noseIntensity), noseTags: nose,
    sameAsNose: same, tasteTags: same ? [] : taste,
    palateIntensity: s(t.palateIntensity), dryness: s(t.dryness), acid: s(t.acid),
    tannin: t.tannin === "-" ? "" : s(t.tannin), tanninTags: splitTerms(t.tanninNature),
    body: s(t.body), finish: s(t.finish),
    score: t.score, quality: n.quality, ageing: n.ageing, noteFree: n.free,
    date: s(t.dateTasted), year: s(t.yearTasted), source: s(t.source),
    vessel: s(t.vessel), viticulture: s(t.viticulture),
  };
}

/** Spreadsheet values for the Tasted table. */
function toCells(f: NoteState): Record<string, Cell> {
  const nose = f.noseTags.join(", ");
  const taste = f.sameAsNose ? nose : f.tasteTags.join(", ");
  const year = f.date ? Number(f.date.slice(0, 4)) : f.year.trim() ? Number(f.year) : "";
  return {
    WineID: f.wineId,
    Producer: f.producer.trim(),
    Name: f.name.trim(),
    Vintage: f.vintage.trim() === "" ? "" : /^nv$/i.test(f.vintage.trim()) ? "NV" : Number(f.vintage),
    Type: f.type,
    Country: f.country.trim(),
    Region: f.region.trim(),
    Location: f.location.trim(),
    Varietal: f.varietal.trim(),
    Blend: f.blend,
    "Alcohol %": f.alcohol.trim() === "" ? "" : Math.round(Number(f.alcohol) * 10) / 1000,
    Price: f.price.trim() === "" ? "" : Number(f.price),
    Colour: joinColour(f.colourIntensity, f.colourHue),
    Nose: nose,
    "Nose Intensity": f.noseIntensity,
    Taste: taste,
    "Palate Intensity": f.palateIntensity,
    Dryness: f.dryness,
    Acid: f.acid,
    Tannin: f.tannin || (showsTannin(f.type) ? "" : "-"),
    "Tannin Nature": f.tanninTags.join(", "),
    Body: f.body,
    Finish: f.finish,
    Score: f.score ?? "",
    Note: composeNote(f.quality, f.ageing, f.noteFree),
    Source: f.source.trim(),
    "Year Tasted": year,
    "Date Tasted": f.date ? excelSerial(f.date) : "",
    "Maturing/Fermenting Vessel": f.vessel.trim(),
    "Viniculture/Viticulture": f.viticulture.trim(),
  };
}

function validate(f: NoteState): string[] {
  const errs: string[] = [];
  if (!f.name.trim()) errs.push("Choose or enter a wine.");
  if (!f.type) errs.push("Type is required.");
  if (f.score === null) errs.push("Give it a score.");
  if (f.vintage.trim() && !/^(\d{4}|nv)$/i.test(f.vintage.trim())) errs.push("Vintage must be a year or NV.");
  if (f.alcohol.trim() && !(Number(f.alcohol) > 0 && Number(f.alcohol) < 30)) errs.push("Alcohol should be like 13.5.");
  if (f.price.trim() && !(Number(f.price) >= 0)) errs.push("Price must be a number.");
  if (!f.date && f.year.trim() && !/^\d{4}$/.test(f.year.trim())) errs.push("Year tasted must be a year.");
  return errs;
}

const DRAFT_KEY = `wine-cellar.noteDraft.${import.meta.env.MODE}`;

function loadDraft(): NoteState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}
function saveDraft(f: NoteState | null) {
  try {
    if (f) localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* drafts are a convenience */
  }
}

// ---- component -----------------------------------------------------------------

export default function NoteForm({ editId, wineId, fromId }: { editId?: string; wineId?: string; fromId?: string }) {
  const { data, putTasting } = useWorkbook();
  const toast = useToast();
  const editing = data.tastings.find((t) => t.tastingId === editId);
  const isEdit = !!editId;

  const initial = useMemo<{ state: NoteState; restored: boolean }>(() => {
    if (editing) return { state: fromTasting(editing), restored: false };
    if (wineId) {
      const w = data.wines.find((x) => x.wineId === wineId);
      if (w) return { state: { ...EMPTY, ...wineFields(w) }, restored: false };
    }
    if (fromId) {
      const t = data.tastings.find((x) => x.tastingId === fromId);
      if (t) return { state: { ...EMPTY, ...wineFields(t) }, restored: false };
    }
    const draft = loadDraft();
    return draft ? { state: draft, restored: true } : { state: EMPTY, restored: false };
  }, []); // computed once, when the form opens

  const [f, setF] = useState<NoteState>(initial.state);
  const [restored, setRestored] = useState(initial.restored);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(!!(initial.state.vessel || initial.state.viticulture));
  const [showWineDetails, setShowWineDetails] = useState(false);
  const baseline = useRef(toCells(initial.state));
  const set = <K extends keyof NoteState>(k: K, v: NoteState[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: keyof NoteState) => (e: { target: { value: string } }) => set(k, e.target.value as never);

  // Keep an on-device draft of new notes so nothing is lost.
  useEffect(() => {
    if (!isEdit && (f.name || f.noseTags.length || f.score !== null)) saveDraft(f);
  }, [f, isEdit]);

  const vocab = useMemo(() => buildVocab(data.tastings), [data.tastings]);
  const tanninVocab = useMemo(() => buildVocab([], "tanninNature", data.tastings), [data.tastings]);
  const hues = useMemo(() => huesFor(f.type || null, data.tastings), [f.type, data.tastings]);
  const lists = data.lists;
  const sources = useMemo(
    () => [...new Set(data.tastings.map((t) => t.source).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    [data.tastings],
  );

  if (editId && !editing) {
    return (
      <section className="card">
        <p>Tasting note {editId} wasn't found.</p>
        <a href={href("notes")}>← Notes</a>
      </section>
    );
  }

  async function save() {
    const errs = validate(f);
    setErrors(errs);
    if (errs.length) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return;
    }
    const cells = toCells(f);
    setBusy(true);
    try {
      let saved: Tasting;
      if (isEdit) {
        const changed = Object.fromEntries(
          Object.entries(cells).filter(([k, v]) => String(v ?? "") !== String(baseline.current[k] ?? "")),
        );
        saved = Object.keys(changed).length ? await updateTasting(data.file.id, editId!, changed) : editing!;
      } else {
        saved = await addTasting(data.file.id, cells);
        saveDraft(null);
      }
      putTasting(saved);
      toast({ text: isEdit ? "Note saved." : `Tasting note ${saved.tastingId} saved.` });
      go(`note/${saved.tastingId}`);
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const hasWine = !!f.name;

  return (
    <>
      <a className="back" href={href(isEdit ? `note/${editId}` : "notes")}>← {isEdit ? "Back" : "Notes"}</a>

      {restored && (
        <div className="notice">
          Restored your unsaved note.{" "}
          <button
            className="link"
            onClick={() => {
              saveDraft(null);
              setF(EMPTY);
              setRestored(false);
            }}
          >
            Discard it
          </button>
        </div>
      )}

      <form
        className="note-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="note-form-title">{isEdit ? `Edit ${editId}` : "New tasting note"}</h2>

        {/* ---- Wine ---- */}
        <Section title="Wine">
          {!hasWine && !isEdit ? (
            <WinePicker
              onPick={(w) => {
                setF((p) => ({ ...p, ...wineFields(w) }));
                // A brand-new wine needs at least its type filled in.
                if (!w.type) setShowWineDetails(true);
              }}
            />
          ) : (
            <>
              <div className="picked-wine">
                <TypeDot type={f.type || null} />
                <div>
                  <div className="wc-producer">{f.producer}</div>
                  <div className="wc-name">
                    {shortName({ producer: f.producer, name: f.name })} <span className="muted">{f.vintage}</span>
                  </div>
                  <div className="wc-meta">
                    {[f.type, f.location, f.region, f.country].filter(Boolean).join(" · ")}
                    {f.wineId && <> · <span className="badge-inline">In cellar {f.wineId}</span></>}
                  </div>
                </div>
              </div>
              <div className="actions">
                <button type="button" className="link" onClick={() => setShowWineDetails((v) => !v)}>
                  {showWineDetails ? "Hide wine details" : "Edit wine details"}
                </button>
                {!isEdit && (
                  <button type="button" className="link" onClick={() => setF((p) => ({ ...p, ...wineFields({}) }))}>
                    Choose a different wine
                  </button>
                )}
              </div>
            </>
          )}
          {(showWineDetails || (!hasWine && isEdit)) && (
            <WineDetails f={f} text={text} set={set} data={data} />
          )}
        </Section>

        {/* ---- Appearance ---- */}
        <Section title="Appearance">
          <Label text="Colour">
            <ChipGroup label="Colour intensity" options={COLOUR_INTENSITIES} value={f.colourIntensity} onChange={(v) => set("colourIntensity", v)} />
            <ChipGroup label="Colour" options={hues} value={f.colourHue} onChange={(v) => set("colourHue", v)} />
          </Label>
        </Section>

        {/* ---- Nose ---- */}
        <Section title="Nose">
          <Label text="Intensity">
            <ChipGroup label="Nose intensity" options={lists["List_Intensity"] ?? []} value={f.noseIntensity} onChange={(v) => set("noseIntensity", v)} />
          </Label>
          <Label text="Aromas">
            <TagInput
              label="Aromas"
              tags={f.noseTags}
              onChange={(t) => set("noseTags", t)}
              placeholder="Type an aroma, e.g. cherry"
              suggestions={(q, ex) => suggest(vocab, f.type || null, q, ex, q ? 10 : 14)}
            />
          </Label>
        </Section>

        {/* ---- Palate ---- */}
        <Section title="Palate">
          <Label text="Sweetness">
            <ChipGroup label="Dryness" options={lists["List_Dryness"] ?? []} value={f.dryness} onChange={(v) => set("dryness", v)} />
          </Label>
          <Label text="Acidity">
            <ChipGroup label="Acid" options={lists["List_Acid"] ?? []} value={f.acid} onChange={(v) => set("acid", v)} />
          </Label>
          {showsTannin(f.type || null) && (
            <>
              <Label text="Tannin">
                <ChipGroup label="Tannin" options={(lists["List_Tannin"] ?? []).filter((x) => x !== "-")} value={f.tannin} onChange={(v) => set("tannin", v)} />
              </Label>
              <Label text="Tannin nature">
                <TagInput
                  label="Tannin nature"
                  tags={f.tanninTags}
                  onChange={(t) => set("tanninTags", t)}
                  placeholder="e.g. ripe, grippy"
                  suggestions={(q, ex) => suggest(tanninVocab, f.type || null, q, ex, 8)}
                />
              </Label>
            </>
          )}
          <Label text="Body">
            <ChipGroup label="Body" options={lists["List_Body"] ?? []} value={f.body} onChange={(v) => set("body", v)} />
          </Label>
          <Label text="Flavour intensity">
            <ChipGroup label="Palate intensity" options={lists["List_Intensity"] ?? []} value={f.palateIntensity} onChange={(v) => set("palateIntensity", v)} />
          </Label>
          <Label text="Flavours">
            <label className="switch">
              <input type="checkbox" checked={f.sameAsNose} onChange={(e) => set("sameAsNose", e.target.checked)} /> Same as nose
            </label>
            {!f.sameAsNose && (
              <TagInput
                label="Flavours"
                tags={f.tasteTags}
                onChange={(t) => set("tasteTags", t)}
                placeholder="Type a flavour"
                suggestions={(q, ex) => suggest(vocab, f.type || null, q, ex, q ? 10 : 14)}
              />
            )}
          </Label>
          <Label text="Finish">
            <ChipGroup label="Finish" options={lists["List_Finish"] ?? []} value={f.finish} onChange={(v) => set("finish", v)} />
          </Label>
        </Section>

        {/* ---- Conclusion ---- */}
        <Section title="Conclusion">
          <Label text="Score *">
            <div className="score-row">
              <button type="button" aria-label="Lower score" onClick={() => set("score", Math.max(80, (f.score ?? 91) - 1))}>−</button>
              <input
                type="range"
                min={80}
                max={100}
                step={1}
                value={f.score ?? 90}
                className={f.score === null ? "unset" : ""}
                aria-label="Score"
                onChange={(e) => set("score", Number(e.target.value))}
                onPointerUp={(e) => set("score", Number((e.target as HTMLInputElement).value))}
              />
              <button type="button" aria-label="Higher score" onClick={() => set("score", Math.min(100, (f.score ?? 89) + 1))}>+</button>
              <span className="score-value">{f.score ?? "—"}</span>
            </div>
          </Label>
          <Label text="Quality">
            <ChipGroup label="Quality" options={QUALITIES} value={f.quality} onChange={(v) => set("quality", v)} />
          </Label>
          <Label text="Ageing">
            <ChipGroup label="Ageing" options={AGEING} value={f.ageing} onChange={(v) => set("ageing", v)} />
          </Label>
          <Label text="Notes">
            <textarea rows={3} value={f.noteFree} onChange={text("noteFree")} placeholder="Anything else worth remembering" />
          </Label>
        </Section>

        {/* ---- Context ---- */}
        <Section title="When & where">
          <div className="row-2">
            <Label text="Date tasted">
              <input type="date" value={f.date} onChange={text("date")} />
            </Label>
            {!f.date && (
              <Label text="Year tasted">
                <input value={f.year} onChange={text("year")} inputMode="numeric" placeholder="2024" />
              </Label>
            )}
          </div>
          <Label text="Source (who / where)">
            <input value={f.source} onChange={text("source")} list="dl-note-source" autoComplete="off" />
            <datalist id="dl-note-source">
              {sources.map((x) => <option key={x} value={x} />)}
            </datalist>
          </Label>
          <button type="button" className="link" onClick={() => setShowMore((v) => !v)}>
            {showMore ? "Hide more details" : "More details (vessel, viticulture)"}
          </button>
          {showMore && (
            <>
              <Label text="Maturing / fermenting vessel">
                <input value={f.vessel} onChange={text("vessel")} />
              </Label>
              <Label text="Viniculture / viticulture">
                <input value={f.viticulture} onChange={text("viticulture")} />
              </Label>
            </>
          )}
        </Section>

        {errors.length > 0 && (
          <ul className="form-errors">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="save-bar">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Save note"}
          </button>
          <a href={href(isEdit ? `note/${editId}` : "notes")}>Cancel</a>
        </div>
      </form>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card note-section">
      <h3>{title}</h3>
      {children}
    </section>
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

// ---- wine picker ----------------------------------------------------------------

interface PickResult {
  key: string;
  wine: Partial<WineFields>;
  kind: "cellar" | "tasted";
  detail: string;
}

function WinePicker({ onPick }: { onPick: (w: Partial<WineFields>) => void }) {
  const { data } = useWorkbook();
  const [q, setQ] = useState("");

  const pastWines = useMemo(() => {
    const map = new Map<string, { t: Tasting; n: number }>();
    for (const t of data.tastings) {
      const key = `${norm(t.name)}|${t.vintage ?? ""}`;
      const e = map.get(key);
      if (!e) map.set(key, { t, n: 1 });
      else {
        e.n++;
        if ((t.tastingId ?? "") > (e.t.tastingId ?? "")) e.t = t;
      }
    }
    return [...map.values()];
  }, [data.tastings]);

  const tokens = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (parts: (string | number | null)[]) => {
    const hay = parts.join(" ").toLocaleLowerCase();
    return tokens.every((t) => hay.includes(t));
  };

  const results: PickResult[] = tokens.length
    ? [
        ...data.wines
          .filter((w) => matches([w.producer, w.name, w.vintage, w.region, w.location, w.wineId]))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 8)
          .map((w) => ({
            key: `c-${w.wineId}`,
            wine: w,
            kind: "cellar" as const,
            detail: w.qty > 0 ? `In cellar · ${w.qty} bottle${w.qty === 1 ? "" : "s"}` : "In cellar · finished",
          })),
        ...pastWines
          .filter(({ t }) => !t.wineId && matches([t.producer, t.name, t.vintage, t.region, t.location]))
          .slice(0, 8)
          .map(({ t, n }) => ({
            key: `t-${t.tastingId}`,
            wine: t,
            kind: "tasted" as const,
            detail: `Tasted before · ${n} note${n === 1 ? "" : "s"}`,
          })),
      ]
    : [];

  return (
    <div className="wine-picker">
      <input
        className="search"
        type="search"
        value={q}
        autoFocus
        placeholder="Search your cellar and past notes…"
        onChange={(e) => setQ(e.target.value)}
      />
      {tokens.length > 0 && (
        <div className="choice-list">
          {results.map((r) => (
            <button key={r.key} type="button" className="choice pick" onClick={() => onPick(r.wine)}>
              <span>
                <TypeDot type={r.wine.type ?? null} /> <strong>{r.wine.producer}</strong> {shortName({ producer: r.wine.producer ?? null, name: r.wine.name ?? null })}{" "}
                <span className="muted">{r.wine.vintage}</span>
              </span>
              <span className={r.kind === "cellar" ? "pick-detail cellar" : "pick-detail"}>{r.detail}</span>
            </button>
          ))}
          <button type="button" className="choice pick new" onClick={() => onPick({ name: q.trim() })}>
            <span>+ New wine: <strong>“{q.trim()}”</strong></span>
            <span className="pick-detail">Not in your cellar or notes</span>
          </button>
        </div>
      )}
    </div>
  );
}

function WineDetails({
  f,
  text,
  set,
  data,
}: {
  f: NoteState;
  text: (k: keyof NoteState) => (e: { target: { value: string } }) => void;
  set: <K extends keyof NoteState>(k: K, v: NoteState[K]) => void;
  data: ReturnType<typeof useWorkbook>["data"];
}) {
  const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  const all = [...data.wines, ...data.tastings];
  const lists: Record<string, string[]> = {
    producer: u(all.map((w) => w.producer)),
    country: u(all.map((w) => w.country)),
    region: u(all.filter((w) => !f.country || w.country === f.country).map((w) => w.region)),
    location: u(all.filter((w) => !f.region || w.region === f.region).map((w) => w.location)),
    varietal: u(all.map((w) => w.varietal)),
  };
  return (
    <div className="wine-details">
      <div className="row-2">
        <Label text="Producer"><input value={f.producer} onChange={text("producer")} list="dl-n-producer" autoComplete="off" /></Label>
        <Label text="Wine name *"><input value={f.name} onChange={text("name")} autoComplete="off" /></Label>
      </div>
      <div className="row-2">
        <Label text="Vintage"><input value={f.vintage} onChange={text("vintage")} placeholder="2019 or NV" /></Label>
        <Label text="Type *">
          <select value={f.type} onChange={(e) => set("type", e.target.value)}>
            <option value="">Choose…</option>
            {(data.lists["List_Type"] ?? []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Label>
      </div>
      <div className="row-2">
        <Label text="Country"><input value={f.country} onChange={text("country")} list="dl-n-country" autoComplete="off" /></Label>
        <Label text="Region"><input value={f.region} onChange={text("region")} list="dl-n-region" autoComplete="off" /></Label>
      </div>
      <div className="row-2">
        <Label text="Location / appellation"><input value={f.location} onChange={text("location")} list="dl-n-location" autoComplete="off" /></Label>
        <Label text="Varietal"><input value={f.varietal} onChange={text("varietal")} list="dl-n-varietal" autoComplete="off" /></Label>
      </div>
      <div className="row-2">
        <Label text="Blend">
          <select value={f.blend} onChange={(e) => set("blend", e.target.value)}>
            <option value="" />
            {(data.lists["List_Blend"] ?? []).map((b) => <option key={b}>{b}</option>)}
          </select>
        </Label>
        <div className="row-2">
          <Label text="Alcohol %"><input value={f.alcohol} onChange={text("alcohol")} inputMode="decimal" placeholder="13.5" /></Label>
          <Label text={`Price (${config.currency === "SGD" ? "S$" : config.currency})`}><input value={f.price} onChange={text("price")} inputMode="decimal" /></Label>
        </div>
      </div>
      {Object.entries(lists).map(([k, values]) => (
        <datalist key={k} id={`dl-n-${k}`}>
          {values.map((v) => <option key={v} value={v} />)}
        </datalist>
      ))}
    </div>
  );
}
