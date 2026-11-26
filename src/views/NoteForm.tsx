import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { config } from "../config";
import { norm, shortName, type Tasting } from "../data";
import { addTasting, updateTasting } from "../notes";
import { AGEING, buildVocab, COLOUR_INTENSITIES, DEFAULT_SCORE, huesFor, shortLevel, showsTannin, suggest, suggestAromas } from "../notesmodel";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { ChipGroup, TagInput, TypeDot, useToast } from "../ui";
import { labelReaderOn, type LabelResult } from "../label";
import { revealNote } from "../reveal";
import LabelFill, { type LabelApply } from "./LabelFill";
import { addDraft, deleteDraft, formatSaved, updateDraft } from "../drafts";

import { EMPTY, fromTasting, toCells, validate, validateDraft, wineFields, type NoteState, type WineFields } from "../noteState";

// On-device safety copy of the note being written, so nothing is lost if the app
// closes before you save. Separate from the drafts kept in the workbook: it
// remembers which workbook draft (if any) it belongs to.
const LOCAL_KEY = `wine-cellar.noteDraft.${import.meta.env.MODE}`;

function loadLocal(draftId: string | null): NoteState | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const owner: string | null = parsed && "state" in parsed ? (parsed.draftId ?? null) : null;
    const state = parsed && "state" in parsed ? parsed.state : parsed;
    return owner === draftId ? { ...EMPTY, ...state } : null;
  } catch {
    return null;
  }
}
function saveLocal(f: NoteState | null, draftId: string | null = null) {
  try {
    if (f) localStorage.setItem(LOCAL_KEY, JSON.stringify({ draftId, state: f }));
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* a convenience only */
  }
}

// ---- component -----------------------------------------------------------------

export default function NoteForm({ editId, wineId, fromId, draftId }: { editId?: string; wineId?: string; fromId?: string; draftId?: string }) {
  const { data, putTasting, putDraft, removeDraft } = useWorkbook();
  const toast = useToast();
  const editing = data.tastings.find((t) => t.tastingId === editId);
  const isEdit = !!editId;
  const draft = draftId ? data.drafts.find((d) => d.draftId === draftId) : undefined;

  const initial = useMemo<{ state: NoteState; restored: boolean }>(() => {
    if (editing) return { state: fromTasting(editing), restored: false };
    if (draftId) {
      const local = loadLocal(draftId);
      if (local) return { state: local, restored: true };
      return { state: draft ? fromTasting(draft.note) : EMPTY, restored: false };
    }
    if (wineId) {
      const w = data.wines.find((x) => x.wineId === wineId);
      if (w) return { state: { ...EMPTY, ...wineFields(w) }, restored: false };
    }
    if (fromId) {
      const t = data.tastings.find((x) => x.tastingId === fromId);
      if (t) return { state: { ...EMPTY, ...wineFields(t) }, restored: false };
    }
    const local = loadLocal(null);
    return local ? { state: local, restored: true } : { state: EMPTY, restored: false };
  }, []); // computed once, when the form opens

  const [f, setF] = useState<NoteState>(initial.state);
  const [restored, setRestored] = useState(initial.restored);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(!!(initial.state.vessel || initial.state.viticulture));
  const [showWineDetails, setShowWineDetails] = useState(false);
  const baseline = useRef(toCells(initial.state));
  const hasWine = !!f.name;
  const set = <K extends keyof NoteState>(k: K, v: NoteState[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: keyof NoteState) => (e: { target: { value: string } }) => set(k, e.target.value as never);

  // Fields filled from a label photo stay highlighted until you change them.
  const [fromLabel, setFromLabel] = useState<{ filled: Set<string>; unsure: string[] } | null>(null);
  const unmark = (k: string) =>
    setFromLabel((s) => {
      if (!s?.filled.has(k)) return s;
      const filled = new Set(s.filled);
      filled.delete(k);
      return filled.size ? { ...s, filled } : null;
    });
  const setW = <K extends keyof NoteState>(k: K, v: NoteState[K]) => {
    set(k, v);
    unmark(k);
  };
  const textW = (k: keyof NoteState) => (e: { target: { value: string } }) => {
    text(k)(e);
    unmark(k);
  };
  const pickWine = (w: Partial<WineFields>) => {
    setFromLabel(null);
    setF((p) => ({ ...p, ...wineFields(w) }));
    // A brand-new wine needs at least its type filled in.
    if (!w.type) setShowWineDetails(true);
  };
  // Reading a label once a wine is already filled in (e.g. "Wine 1" at a blind
  // tasting): replace the wine details, or only fill the empty ones.
  const [replaceWine, setReplaceWine] = useState(true);
  const blanksOnly = (p: NoteState, fields: Partial<NoteState>) =>
    Object.fromEntries(Object.entries(fields).filter(([k, v]) => v && !String(p[k as keyof NoteState] ?? "").trim())) as Partial<NoteState>;
  const applyLabel = ({ fields, unsure }: LabelApply) => {
    const added = !hasWine || replaceWine ? (fields as Partial<NoteState>) : blanksOnly(f, fields);
    setF((p) => (!hasWine || replaceWine ? { ...p, ...wineFields({}), ...fields } : { ...p, ...added }));
    const keys = Object.keys(added);
    setFromLabel(keys.length ? { filled: new Set(keys), unsure: unsure } : null);
    if (!keys.length) toast({ text: "The label didn't add anything: every wine detail was already filled in." });
    setShowWineDetails(true);
  };
  const pickFromLabel = (w: Partial<WineFields>) => {
    if (!hasWine || replaceWine) return pickWine(w);
    setFromLabel(null);
    setF((p) => ({ ...p, ...blanksOnly(p, wineFields(w)) }));
  };

  // Keep an on-device copy of new notes and drafts so nothing is lost.
  useEffect(() => {
    if (isEdit || !(f.name || f.noseTags.length || f.score !== null)) return;
    // An opened draft that hasn't been changed needs no copy.
    if (draft && JSON.stringify(f) === JSON.stringify(fromTasting(draft.note))) return;
    saveLocal(f, draftId ?? null);
  }, [f, isEdit, draftId, draft]);

  const vocab = useMemo(() => buildVocab(data.tastings), [data.tastings]);
  const tanninVocab = useMemo(() => buildVocab([], "tanninNature", data.tastings), [data.tastings]);
  const hues = useMemo(() => huesFor(f.type || null, data.tastings), [f.type, data.tastings]);
  const lists = data.lists;
  const sources = useMemo(
    () => [...new Set(data.tastings.map((t) => t.source).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    [data.tastings],
  );

  if ((editId && !editing) || (draftId && !draft)) {
    return (
      <section className="card">
        <p>{editId ? `Tasting note ${editId}` : `Draft ${draftId}`} wasn't found{draftId ? ": it may have been finished or deleted on another device" : ""}.</p>
        <a href={href("notes")}>← Notes</a>
      </section>
    );
  }

  async function saveAsDraft() {
    const errs = validateDraft(f);
    if (!f.name.trim() && !f.noseTags.length && f.score === null && !f.colourHue && !f.noteFree.trim()) {
      errs.unshift("Add something first: a wine (or \"Wine 1\" for a blind tasting), aromas or a score.");
    }
    setErrors(errs);
    if (errs.length) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return;
    }
    setBusy(true);
    try {
      const saved = draftId ? await updateDraft(data.file.id, draftId, toCells(f)) : await addDraft(data.file.id, toCells(f));
      saveLocal(null);
      putDraft(saved);
      toast({ text: draftId ? "Draft updated." : "Saved as a draft. Find it under Drafts on the Notes tab." });
      go("notes");
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  /** A line-up photo on a new note: one draft per bottle, in line-up order. */
  async function draftEach(bottles: LabelResult[]) {
    setBusy(true);
    let n = 0;
    try {
      for (const b of bottles) {
        // Anything already typed on this page goes with the first bottle.
        const base = n === 0 ? f : { ...EMPTY, date: f.date, source: f.source };
        putDraft(await addDraft(data.file.id, toCells(revealNote(base, b, data))));
        n++;
      }
      saveLocal(null);
      toast({ text: `${n} drafts started, one per bottle. Find them under Drafts on the Notes tab.` });
      go("notes");
    } catch (e) {
      toast({ text: `${describeError(e)}${n ? ` (${n} drafts started before this.)` : ""}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (!draftId || !window.confirm("Delete this draft? This can't be undone.")) return;
    setBusy(true);
    try {
      await deleteDraft(data.file.id, draftId);
      saveLocal(null);
      removeDraft(draftId);
      toast({ text: "Draft deleted." });
      go("notes");
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
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
        saveLocal(null);
      }
      putTasting(saved);
      let leftover = "";
      if (draftId) {
        try {
          await deleteDraft(data.file.id, draftId);
          removeDraft(draftId);
        } catch {
          leftover = ` The draft ${draftId} couldn't be removed: delete it from Drafts.`;
        }
      }
      toast({ text: isEdit ? "Note saved." : `Tasting note ${saved.tastingId} saved.${leftover}`, error: !!leftover });
      go(`note/${saved.tastingId}`);
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="back" href={href(isEdit ? `note/${editId}` : "notes")}>← {isEdit ? "Back" : "Notes"}</a>

      {draft && (
        <div className="notice draft-notice">
          Continuing your draft{draft.saved ? ` from ${formatSaved(draft.saved)}` : ""}.{" "}
          <button className="link" disabled={busy} onClick={() => void discardDraft()}>
            Delete draft
          </button>
        </div>
      )}

      {restored && (
        <div className="notice">
          {draft ? "Restored changes you hadn't saved yet." : "Restored your unsaved note."}{" "}
          <button
            className="link"
            onClick={() => {
              saveLocal(null);
              setF(draft ? fromTasting(draft.note) : EMPTY);
              setRestored(false);
            }}
          >
            {draft ? "Undo them" : "Discard it"}
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
        <h2 className="note-form-title">
          {isEdit ? `Edit ${editId}` : "New tasting note"}
          {draft && <span className="draft-badge">Draft</span>}
        </h2>

        {/* ---- Wine ---- */}
        <Section title="Wine">
          {!hasWine && !isEdit ? (
            <>
              {/* The label photo buttons sit beside the search box, as icons. */}
              {labelReaderOn() ? (
                <LabelFill
                  onApply={applyLabel}
                  onPick={(w) => pickFromLabel(w as Partial<WineFields>)}
                  onDraftEach={isEdit ? undefined : (b) => void draftEach(b)}
                  searchBar={(buttons) => <WinePicker onPick={pickWine} beside={buttons} />}
                />
              ) : (
                <WinePicker onPick={pickWine} />
              )}
            </>
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
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setFromLabel(null);
                      setF((p) => ({ ...p, ...wineFields({}) }));
                    }}
                  >
                    Choose a different wine
                  </button>
                )}
              </div>
              {fromLabel && (
                <p className="notice label-note">
                  Filled from the label: check the highlighted fields.
                  {fromLabel.unsure.length > 0 && <> Least sure about: {fromLabel.unsure.join(", ")}.</>}
                </p>
              )}
              {labelReaderOn() && (
                <LabelFill compact onApply={applyLabel} onPick={(w) => pickFromLabel(w as Partial<WineFields>)}>
                  <label className="switch small">
                    <input type="checkbox" checked={replaceWine} onChange={(e) => setReplaceWine(e.target.checked)} /> Replace the wine details
                    with what's on the label
                  </label>
                  {!replaceWine && <p className="muted small">Only empty wine details will be filled.</p>}
                </LabelFill>
              )}
            </>
          )}
          {(showWineDetails || (!hasWine && isEdit)) && (
            <WineDetails f={f} text={textW} set={setW} data={data} filled={fromLabel?.filled} />
          )}
        </Section>

        {/* ---- Appearance ---- */}
        <Section title="Appearance">
          {!f.type && (
            <Label text="Type">
              {/* Picked first when the wine isn't known (blind tastings): colours, aromas and tannin follow it. */}
              <ChipGroup label="Type" options={data.lists["List_Type"] ?? []} value={f.type} onChange={(v) => set("type", v)} />
            </Label>
          )}
          <Label text="Colour">
            <ChipGroup label="Colour intensity" display={shortLevel} options={COLOUR_INTENSITIES} value={f.colourIntensity} onChange={(v) => set("colourIntensity", v)} />
            <ChipGroup label="Colour" options={hues} value={f.colourHue} onChange={(v) => set("colourHue", v)} />
          </Label>
        </Section>

        {/* ---- Nose ---- */}
        <Section title="Nose">
          <Label text="Intensity">
            <ChipGroup label="Nose intensity" display={shortLevel} options={lists["List_Intensity"] ?? []} value={f.noseIntensity} onChange={(v) => set("noseIntensity", v)} />
          </Label>
          <Label text="Aromas">
            <TagInput
              label="Aromas"
              tags={f.noseTags}
              onChange={(t) => set("noseTags", t)}
              placeholder="Type an aroma, e.g. cherry"
              suggestions={(q, ex) => suggestAromas(vocab, f.type || null, q, ex)}
            />
          </Label>
        </Section>

        {/* ---- Palate ---- */}
        <Section title="Palate">
          <Label text="Sweetness">
            <ChipGroup label="Dryness" display={shortLevel} options={lists["List_Dryness"] ?? []} value={f.dryness} onChange={(v) => set("dryness", v)} />
          </Label>
          <Label text="Acidity">
            <ChipGroup label="Acid" display={shortLevel} options={lists["List_Acid"] ?? []} value={f.acid} onChange={(v) => set("acid", v)} />
          </Label>
          {showsTannin(f.type || null) && (
            <>
              <Label text="Tannin">
                <ChipGroup label="Tannin" display={shortLevel} options={(lists["List_Tannin"] ?? []).filter((x) => x !== "-")} value={f.tannin} onChange={(v) => set("tannin", v)} />
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
            <ChipGroup label="Body" display={shortLevel} options={lists["List_Body"] ?? []} value={f.body} onChange={(v) => set("body", v)} />
          </Label>
          <Label text="Flavour intensity">
            <ChipGroup label="Palate intensity" display={shortLevel} options={lists["List_Intensity"] ?? []} value={f.palateIntensity} onChange={(v) => set("palateIntensity", v)} />
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
                suggestions={(q, ex) => suggestAromas(vocab, f.type || null, q, ex)}
              />
            )}
          </Label>
          <Label text="Finish">
            <ChipGroup label="Finish" display={shortLevel} options={lists["List_Finish"] ?? []} value={f.finish} onChange={(v) => set("finish", v)} />
          </Label>
        </Section>

        {/* ---- Conclusion ---- */}
        <Section title="Conclusion">
          <Label text="Score *">
            <div className="score-row">
              <button type="button" aria-label="Lower score" onClick={() => set("score", Math.max(80, (f.score ?? DEFAULT_SCORE) - 1))}>−</button>
              <input
                type="range"
                min={80}
                max={100}
                step={1}
                value={f.score ?? DEFAULT_SCORE}
                aria-label="Score"
                onChange={(e) => set("score", Number(e.target.value))}
                onPointerUp={(e) => set("score", Number((e.target as HTMLInputElement).value))}
              />
              <button type="button" aria-label="Higher score" onClick={() => set("score", Math.min(100, (f.score ?? DEFAULT_SCORE) + 1))}>+</button>
              <span className="score-value">{f.score ?? DEFAULT_SCORE}</span>
            </div>
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
          {!isEdit && (
            <button type="button" disabled={busy} onClick={() => void saveAsDraft()}>
              {draft ? "Update draft" : "Save as draft"}
            </button>
          )}
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

function WinePicker({ onPick, beside }: { onPick: (w: Partial<WineFields>) => void; beside?: ReactNode }) {
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
      <div className="search-row">
        <input
          className="search"
          type="search"
          value={q}
          autoFocus
          placeholder="Search your cellar and past notes…"
          onChange={(e) => setQ(e.target.value)}
        />
        {beside}
      </div>
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
  filled,
}: {
  filled?: Set<string>;
  f: NoteState;
  text: (k: keyof NoteState) => (e: { target: { value: string } }) => void;
  set: <K extends keyof NoteState>(k: K, v: NoteState[K]) => void;
  data: ReturnType<typeof useWorkbook>["data"];
}) {
  const hl = (k: keyof NoteState) => (filled?.has(k) ? "label-filled" : undefined);
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
        <Label text="Producer"><input className={hl("producer")} value={f.producer} onChange={text("producer")} list="dl-n-producer" autoComplete="off" /></Label>
        <Label text="Wine name *"><input className={hl("name")} value={f.name} onChange={text("name")} autoComplete="off" /></Label>
      </div>
      <div className="row-2">
        <Label text="Vintage"><input className={hl("vintage")} value={f.vintage} onChange={text("vintage")} placeholder="2019 or NV" /></Label>
        <Label text="Type *">
          <select className={hl("type")} value={f.type} onChange={(e) => set("type", e.target.value)}>
            <option value="">Choose…</option>
            {(data.lists["List_Type"] ?? []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Label>
      </div>
      <div className="row-2">
        <Label text="Country"><input className={hl("country")} value={f.country} onChange={text("country")} list="dl-n-country" autoComplete="off" /></Label>
        <Label text="Region"><input className={hl("region")} value={f.region} onChange={text("region")} list="dl-n-region" autoComplete="off" /></Label>
      </div>
      <div className="row-2">
        <Label text="Location / appellation"><input className={hl("location")} value={f.location} onChange={text("location")} list="dl-n-location" autoComplete="off" /></Label>
        <Label text="Varietal"><input className={hl("varietal")} value={f.varietal} onChange={text("varietal")} list="dl-n-varietal" autoComplete="off" /></Label>
      </div>
      <div className="row-2">
        <Label text="Blend">
          <select className={hl("blend")} value={f.blend} onChange={(e) => set("blend", e.target.value)}>
            <option value="" />
            {(data.lists["List_Blend"] ?? []).map((b) => <option key={b}>{b}</option>)}
          </select>
        </Label>
        <div className="row-2">
          <Label text="Alcohol %"><input className={hl("alcohol")} value={f.alcohol} onChange={text("alcohol")} inputMode="decimal" placeholder="13.5" /></Label>
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
