// The sheet that slides up when you tap a wine on the Wine list: the wine's
// details (no price, source, year purchased or WineID) and its tasting notes.
// Read-only — editing, opening and selling stay on the Cellar's wine page.

import { useEffect, useMemo, useRef, useState } from "react";
import { shortName, type Tasting, type Wine } from "../data";
import { ProducerLogo } from "../logos";
import { parseNote } from "../notesmodel";
import { useWorkbook } from "../store";
import { notesForWine } from "../winenotes";
import { LOCATIONS } from "../locations";
import { placementOf } from "../spots";
import { isNya } from "../stocktakemodel";
import { spotHref } from "./Storage";
import { formatDay } from "./WineDetail";

/** `linkWhere`: the box and rack tags open that box (off in full screen, so tapping one doesn't leave it). */
export default function WineSheet({ wine, onClose, linkWhere = false }: { wine: Wine; onClose: () => void; linkWhere?: boolean }) {
  const { data } = useWorkbook();
  const notes = useMemo(() => notesForWine(wine, data.tastings), [wine, data.tastings]);
  const sheet = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    sheet.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const facts: [string, string | null][] = [
    ["Country", wine.country],
    ["Region", wine.region],
    ["Appellation", wine.location],
    ["Alcohol", wine.alcohol !== null ? `${wine.alcohol}%` : null],
    ["Grape", wine.varietal],
    ["Blend", wine.blend],
  ];
  const shown = facts.filter(([, v]) => v);
  const bottlesHeld = LOCATIONS.reduce((s, loc) => {
    const p = placementOf(wine, loc);
    return s + p.unplaced + p.spots.reduce((a, x) => a + x.n, 0);
  }, 0);

  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div
        ref={sheet}
        className="modal wine-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${wine.producer ?? ""} ${shortName(wine)} ${wine.vintage ?? ""}`.trim()}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
        onClick={(e) => e.stopPropagation()}
        // Swipe down (from the top of the sheet) to close.
        onTouchStart={(e) => {
          startY.current = sheet.current && sheet.current.scrollTop <= 0 ? e.touches[0].clientY : null;
        }}
        onTouchMove={(e) => {
          if (startY.current === null) return;
          setDrag(Math.max(0, e.touches[0].clientY - startY.current));
        }}
        onTouchEnd={() => {
          if (drag > 90) onClose();
          startY.current = null;
          setDrag(0);
        }}
      >
        <div className="sheet-grip" aria-hidden />
        <div className="sheet-head">
          <ProducerLogo producer={wine.producer} size="large" />
          <div className="sheet-title">
            <div className="wc-producer">{wine.producer}</div>
            <h2 className="detail-title">
              {shortName(wine)} {wine.vintage && <span className="muted">{wine.vintage}</span>}
            </h2>
          </div>
          <button className="link sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ws-tags">
          {wine.type && <span className="ws-tag">{wine.type}</span>}
          {/* Where the bottles are, with their counts. Tapping one opens that box, except in full screen (it would leave it). */}
          {isNya(wine) ? (
            <span className="ws-tag ws-where">🚚 Not arrived yet{bottlesHeld ? ` ×${bottlesHeld}` : ""}</span>
          ) : (
            LOCATIONS.flatMap((loc) => {
              const p = placementOf(wine, loc);
              const icon = loc === "Home" ? "🏠" : "📦";
              // "K Cellars A2 ×2" (a K Cellars box is just a letter and number); home racks are named already.
              const label = (spot: string) => (loc === "Home" ? spot : `${loc} ${spot}`);
              const tag = (key: string, spot: string | null, title: string, text: string) =>
                linkWhere ? (
                  <a key={key} className="ws-tag ws-where" href={spotHref(loc, spot)} title={title}>{text}</a>
                ) : (
                  <span key={key} className="ws-tag ws-where">{text}</span>
                );
              return [
                ...p.spots.map((s) => tag(`${loc}-${s.spot}`, s.spot, `Open ${label(s.spot)}`, `${icon} ${label(s.spot)} ×${s.n}`)),
                ...(p.unplaced > 0 ? [tag(`${loc}-none`, null, `Bottles at ${loc} not in a box or rack yet`, `${icon} ${loc} ×${p.unplaced} not placed`)] : []),
              ];
            })
          )}
        </div>

        {(shown.length > 0 || wine.remarks) && (
          <dl className="sheet-facts">
            {shown.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {wine.remarks && (
              <div className="wide">
                <dt>Remarks</dt>
                <dd>{wine.remarks}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="sheet-notes-head">
          <h3>Tasting notes ({notes.these.length})</h3>
          {notes.average !== null && <span className="muted small">average {notes.average}</span>}
        </div>
        {notes.these.length === 0 ? (
          <p className="muted small">No tasting notes for this vintage yet.</p>
        ) : (
          notes.these.map((t, i) => <SheetNote key={t.tastingId ?? i} t={t} open={i === 0} />)
        )}

        {/* Other vintages open here too, so you stay on the Wine list (and in full screen). */}
        {notes.otherVintages.length > 0 && (
          <>
            <div className="sheet-notes-head sheet-others-head">
              <h3>Other vintages ({notes.otherVintages.length})</h3>
            </div>
            {notes.otherVintages.map((t, i) => <SheetNote key={t.tastingId ?? `o${i}`} t={t} open={false} showVintage />)}
          </>
        )}
      </div>
    </div>
  );
}

function SheetNote({ t, open: startOpen, showVintage }: { t: Tasting; open: boolean; showVintage?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const n = parseNote(t.note);
  const when = [t.dateTasted ? formatDay(t.dateTasted) : t.yearTasted, t.ageTasted !== null ? `${t.ageTasted} years old` : null]
    .filter(Boolean)
    .join(" · ");
  const structure: [string, string | null][] = [
    ["Colour", t.colour],
    ["Sweetness", t.dryness],
    ["Acid", t.acid],
    ["Tannin", t.tannin && t.tannin !== "-" ? [t.tannin, t.tanninNature].filter(Boolean).join(", ") : null],
    ["Body", t.body],
    ["Finish", t.finish],
  ];
  const nose = [t.noseIntensity, t.nose].filter(Boolean).join(": ");
  const palate = [t.palateIntensity, t.taste && t.taste !== t.nose ? t.taste : t.taste ? "same as nose" : null]
    .filter(Boolean)
    .join(": ");
  const verdict = [n.quality, n.ageing].filter(Boolean).join(". ");

  return (
    <div className="sheet-note">
      <button className="sheet-note-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="muted small">
          {showVintage && <strong className="sheet-note-vintage">{t.vintage ?? "NV"}</strong>}
          {showVintage && " · "}
          {when || "Undated"}
        </span>
        <span className="sheet-note-score">
          {t.score ?? "–"} <span className="muted" aria-hidden>{open ? "▴" : "▾"}</span>
        </span>
      </button>
      {open && (
        <div className="sheet-note-body">
          {nose && (
            <p><span className="muted small">Nose </span>{nose}</p>
          )}
          {palate && (
            <p><span className="muted small">Palate </span>{palate}</p>
          )}
          <div className="ws-tags">
            {structure.filter(([, v]) => v).map(([k, v]) => (
              <span key={k} className="ws-tag">{k} {v!.toLowerCase()}</span>
            ))}
          </div>
          {verdict && <p className="sheet-verdict">{verdict}</p>}
          {n.free && <p>{n.free}</p>}
        </div>
      )}
    </div>
  );
}
