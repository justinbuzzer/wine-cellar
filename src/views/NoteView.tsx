import { config } from "../config";
import { formatPrice, shortName, type Tasting } from "../data";
import { parseNote } from "../notesmodel";
import { go, href } from "../router";
import { useWorkbook } from "../store";
import { TypeDot } from "../ui";
import { notesLikeNote } from "../winenotes";

export default function NoteView({ id }: { id: string }) {
  const { data } = useWorkbook();
  const t = data.tastings.find((x) => x.tastingId === id);
  if (!t) {
    return (
      <section className="card">
        <p>Tasting note {id} wasn't found.</p>
        <a href={href("notes")}>← Notes</a>
      </section>
    );
  }
  const inCellar = t.wineId ? data.wines.find((w) => w.wineId === t.wineId) : undefined;
  const n = parseNote(t.note);
  const fam = notesLikeNote(t, data.tastings);

  return (
    <>
      <a className="back" href={href("notes")}>← Notes</a>

      <section className="card">
        <div className="detail-head">
          <TypeDot type={t.type} />
          <div style={{ flex: 1 }}>
            <div className="wc-producer">{t.producer}</div>
            <h2 className="detail-title">
              {shortName(t)} <span className="muted">{t.vintage}</span>
            </h2>
            <div className="wc-meta">{[t.type, t.location, t.region, t.country].filter(Boolean).join(" · ")}</div>
            {inCellar && (
              <a className="cellar-link" href={href(`wine/${inCellar.wineId}`)}>
                In your cellar ({inCellar.qty} bottle{inCellar.qty === 1 ? "" : "s"}) →
              </a>
            )}
          </div>
          <div className="big-score" aria-label="Score">{t.score ?? "–"}</div>
        </div>
        <p className="muted small">
          {t.dateTasted ?? t.yearTasted}
          {t.source && ` · ${t.source}`}
          {t.ageTasted !== null && ` · ${t.ageTasted} years old when tasted`}
          {` · ${t.tastingId}`}
        </p>
        <div className="actions">
          <button className="primary" onClick={() => go(`note/new/from/${t.tastingId}`)}>Taste again</button>
          <button onClick={() => go(`note/${t.tastingId}/edit`)}>Edit</button>
        </div>
      </section>

      <NoteSection title="Appearance" rows={[["Colour", t.colour]]} />
      <NoteSection title="Nose" rows={[["Intensity", t.noseIntensity], ["Aromas", t.nose]]} />
      <NoteSection
        title="Palate"
        rows={[
          ["Sweetness", t.dryness],
          ["Acidity", t.acid],
          ["Tannin", t.tannin === "-" ? null : t.tannin],
          ["Tannin nature", t.tanninNature],
          ["Body", t.body],
          ["Intensity", t.palateIntensity],
          ["Flavours", t.taste && t.taste !== t.nose ? t.taste : t.taste ? "Same as nose" : null],
          ["Finish", t.finish],
        ]}
      />
      <NoteSection
        title="Conclusion"
        rows={[
          ["Quality", n.quality],
          ["Ageing", n.ageing],
          ["Notes", n.free],
        ]}
      />
      <NoteSection
        title="Wine details"
        rows={[
          ["Varietal", t.varietal],
          ["Blend", t.blend],
          ["Alcohol", t.alcohol !== null ? `${t.alcohol}%` : null],
          ["Price", formatPrice(t.price, config.currency)],
          ["Vessel", t.vessel],
          ["Viticulture", t.viticulture],
        ]}
      />

      {fam.all.length > 1 && (
        <section className="card">
          <div className="card-head">
            <h2>Your notes on {shortName(t)}</h2>
            <button className="primary icon-btn compare-btn" onClick={() => go(`note/${t.tastingId}/compare`)}>⇆ Compare</button>
          </div>
          <p className="muted small fam-sum">
            {fam.all.length} notes · {fam.vintages} vintage{fam.vintages === 1 ? "" : "s"}
            {fam.average !== null && ` · average ${fam.average}`}
          </p>
          {fam.thisVintage.length > 0 && (
            <>
              <h3 className="fam-group">This vintage · {t.vintage ?? "NV"}</h3>
              {fam.thisVintage.map((o) => <MiniNote key={o.tastingId} t={o} />)}
            </>
          )}
          {fam.otherVintages.length > 0 && (
            <>
              <h3 className="fam-group">Other vintages</h3>
              {fam.otherVintages.map((o) => <MiniNote key={o.tastingId} t={o} />)}
            </>
          )}
        </section>
      )}
    </>
  );
}

function NoteSection({ title, rows }: { title: string; rows: [string, string | number | null][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== "");
  if (!shown.length) return null;
  return (
    <section className="card">
      <h2>{title}</h2>
      <dl className="facts">
        {shown.map(([k, v]) => (
          <div key={k} className="fact-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** One of your notes on the same wine: score, vintage, when and where, the start of the aromas. */
export function MiniNote({ t }: { t: Tasting }) {
  return (
    <a className="tasting-row note-link fam-note" href={href(`note/${t.tastingId}`)}>
      <span className="fam-score">{t.score ?? "–"}</span>
      <span className="fam-body">
        <span className="muted small">
          <span className="vint-badge">{t.vintage ?? "NV"}</span>
          {[tastedOn(t), t.source].filter(Boolean).join(" · ")}
        </span>
        {t.nose && <span className="tasting-text clamp">{t.nose}</span>}
      </span>
    </a>
  );
}

/** "Mar 2024" from the date tasted (or the year when that's all there is). */
export function tastedOn(t: Pick<Tasting, "dateTasted" | "yearTasted">): string {
  if (t.dateTasted && /^\d{4}-\d{2}/.test(t.dateTasted)) {
    return new Date(`${t.dateTasted.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-SG", { month: "short", year: "numeric" });
  }
  return t.yearTasted ? String(t.yearTasted) : "";
}
