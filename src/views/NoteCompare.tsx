import { Fragment, useState } from "react";
import { norm, shortName, type Tasting } from "../data";
import { parseNote } from "../notesmodel";
import { href } from "../router";
import { useWorkbook } from "../store";
import { notesLikeNote } from "../winenotes";
import { tastedOn } from "./NoteView";

type Getter = (t: Tasting) => string;
interface Row {
  label: string;
  get: Getter;
  /** Named dropdown list whose order is the scale (shown as a little bar). */
  scale?: string;
  long?: boolean;
}

const v = (x: string | number | null | undefined) => (x === null || x === undefined ? "" : String(x).trim());

const ROWS: Row[] = [
  { label: "Tasted", get: (t) => [tastedOn(t), t.ageTasted !== null ? `${t.ageTasted} yrs old` : ""].filter(Boolean).join(" · ") },
  { label: "Grape", get: (t) => v(t.varietal) },
  { label: "Blend", get: (t) => v(t.blend) },
  { label: "Colour", get: (t) => v(t.colour) },
  { label: "Nose", get: (t) => v(t.noseIntensity), scale: "List_Intensity" },
  { label: "Aromas", get: (t) => v(t.nose), long: true },
  { label: "Sweetness", get: (t) => v(t.dryness), scale: "List_Dryness" },
  { label: "Acidity", get: (t) => v(t.acid), scale: "List_Acid" },
  { label: "Tannin", get: (t) => (t.tannin === "-" ? "" : v(t.tannin)), scale: "List_Tannin" },
  { label: "Tannin nature", get: (t) => v(t.tanninNature) },
  { label: "Body", get: (t) => v(t.body), scale: "List_Body" },
  { label: "Palate", get: (t) => v(t.palateIntensity), scale: "List_Intensity" },
  { label: "Flavours", get: (t) => (t.taste && t.taste === t.nose ? "Same as nose" : v(t.taste)), long: true },
  { label: "Finish", get: (t) => v(t.finish), scale: "List_Finish" },
  { label: "Quality", get: (t) => parseNote(t.note).quality },
  { label: "Ageing", get: (t) => parseNote(t.note).ageing },
  { label: "Notes", get: (t) => parseNote(t.note).free, long: true },
  { label: "Who / where", get: (t) => v(t.source) },
];

/** "Medium (+)", "Medium(+)" and "medium +" all count as the same step. */
const step = (s: string) => s.toLowerCase().replace(/[\s()]/g, "");

// Kept while you move between notes.
let onlyDiff = false;

export default function NoteCompare({ id }: { id: string }) {
  const { data } = useWorkbook();
  const t = data.tastings.find((x) => x.tastingId === id);
  const fam = t ? notesLikeNote(t, data.tastings) : null;
  // This note first, then the same order as on the note page.
  const order = t && fam ? [t, ...fam.thisVintage, ...fam.otherVintages] : [];
  const [picked, setPicked] = useState<Set<string>>(() => new Set(order.slice(0, 3).map((x) => x.tastingId!)));
  const [diffOnly, setDiffOnly] = useState(onlyDiff);
  if (!t || !fam) {
    return (
      <section className="card">
        <p>Tasting note {id} wasn't found.</p>
        <a href={href("notes")}>← Notes</a>
      </section>
    );
  }

  const cols = order.filter((x) => picked.has(x.tastingId!));
  const toggle = (tid: string) =>
    setPicked((p) => {
      const s = new Set(p);
      if (s.has(tid)) s.delete(tid);
      else s.add(tid);
      return s;
    });
  const rows = ROWS.map((r) => {
    const values = cols.map(r.get);
    const filled = values.filter(Boolean);
    // A blank next to a value isn't a difference, just something not noted.
    const differs = new Set(filled.map(step)).size > 1;
    return { ...r, values, empty: filled.length === 0, differs };
  }).filter((r) => !r.empty && (!diffOnly || r.differs));

  const meter = (scale: string | undefined, value: string) => {
    if (!scale || !value) return null;
    const steps = (data.lists[scale] ?? []).filter((s) => s !== "-");
    const i = steps.findIndex((s) => step(s) === step(value));
    if (i < 0) return null;
    return (
      <span className="meter" aria-hidden="true">
        {steps.map((s, k) => <i key={s} className={k <= i ? "f" : ""} />)}
      </span>
    );
  };
  const chipLabel = (x: Tasting) => `Vintage ${x.vintage ?? "NV"}, tasted ${tastedOn(x) || "unknown"}, score ${x.score ?? "none"}`;

  return (
    <>
      <a className="back" href={href(`note/${t.tastingId}`)}>← Note</a>
      <h2 className="st-title">
        Compare: {t.producer && norm(t.producer) !== norm(t.name) ? `${t.producer} ${shortName(t)}` : t.name ?? shortName(t)}
      </h2>
      <div className="chips cmp-chips" role="group" aria-label="Notes to compare">
        {order.map((x) => (
          <button
            key={x.tastingId}
            type="button"
            className={`cmp-pick${picked.has(x.tastingId!) ? " on" : ""}`}
            aria-pressed={picked.has(x.tastingId!)}
            aria-label={chipLabel(x)}
            onClick={() => toggle(x.tastingId!)}
          >
            <span className="cmp-pick-text">
              <span><small>Vintage</small> {x.vintage ?? "NV"}</span>
              <span><small>Tasted</small> {tastedOn(x) || "–"}</span>
            </span>
            <b className="cmp-pick-score">{x.score ?? "–"}</b>
          </button>
        ))}
      </div>
      <label className="switch small cmp-switch">
        <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly((onlyDiff = e.target.checked))} /> Only rows that differ
      </label>

      {cols.length < 2 ? (
        <p className="muted">Pick at least two notes to compare.</p>
      ) : (
        <div className="cmp-wrap">
          <div className="cmp-grid" style={{ gridTemplateColumns: `70px repeat(${cols.length}, minmax(86px, 1fr))` }}>
            <div className="cmp-k cmp-corner" />
            {cols.map((c) => (
              <a key={c.tastingId} className="cmp-head" href={href(`note/${c.tastingId}`)}>
                <span>{c.vintage ?? "NV"}</span>
                <b>{c.score ?? "–"}</b>
              </a>
            ))}
            {rows.map((r) => (
              <Fragment key={r.label}>
                <div className={`cmp-k${r.differs ? " d" : ""}`}>{r.label}</div>
                {r.values.map((val, i) => (
                  <div key={cols[i].tastingId} className={`cmp-v${r.differs ? " d" : ""}${r.long ? " long" : ""}`}>
                    {val || <span className="muted">–</span>}
                    {meter(r.scale, val)}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {cols.length >= 2 && rows.length === 0 && <p className="muted">These notes say the same thing in every category.</p>}
    </>
  );
}
