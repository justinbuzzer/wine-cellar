import { useRef, useState } from "react";
import { shortName, type Tasting, type Wine } from "../data";
import { LabelReaderError, matchLabel, readLabel, shrinkPhoto, type LabelField, type LabelMatch, type LabelResult } from "../label";
import { useWorkbook } from "../store";
import { TypeDot } from "../ui";

const MAX_PHOTOS = 3;
const FIELD_NAMES: Record<LabelField, string> = {
  producer: "producer", name: "wine name", vintage: "vintage", type: "type", country: "country",
  region: "region", location: "appellation", varietal: "grape", blend: "blend", alcohol: "alcohol",
};

export interface LabelApply {
  fields: Partial<Record<LabelField, string>>;
  /** Fields the reader inferred or found hard to read. */
  unsure: string[];
}

/**
 * "Fill from label": pick or take photos, read them, then either use a matching
 * wine you already have or fill the wine details from the label.
 * The photos only live in this component's memory and are dropped once used.
 */
export default function LabelFill({ onApply, onPick }: { onApply: (a: LabelApply) => void; onPick: (w: Wine | Tasting) => void }) {
  const { data } = useWorkbook();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<{ key: string; preview: string; mediaType: string; data: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ result: LabelResult; matches: LabelMatch[] } | null>(null);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    const picked = [...files].slice(0, room);
    try {
      const shrunk = await Promise.all(picked.map(shrinkPhoto));
      setPhotos((p) => [...p, ...shrunk.map((s, i) => ({ key: `${Date.now()}-${i}`, ...s }))]);
      if (files.length > room) setError(`Up to ${MAX_PHOTOS} photos: front and back labels are usually enough.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That photo couldn't be opened.");
    }
  }

  function reset() {
    setPhotos([]);
    setFound(null);
    setError(null);
  }

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
      const all = [...data.wines, ...data.tastings];
      const result = await readLabel(
        photos.map(({ mediaType, data }) => ({ mediaType, data })),
        {
          types: data.lists["List_Type"] ?? [],
          blends: data.lists["List_Blend"] ?? [],
          countries: u(all.map((w) => w.country)),
          regions: u(all.map((w) => w.region)),
        },
      );
      if (!result.readable || (!result.producer && !result.name)) {
        setError("No wine label could be read in these photos. Try a closer, straighter shot in good light.");
        return;
      }
      const matches = matchLabel(result, data.wines, data.tastings);
      if (matches.length) setFound({ result, matches });
      else applyLabel(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The label reader failed. Try again.";
      setError(e instanceof LabelReaderError && e.userId ? `${msg} (Account ID for setup: ${e.userId})` : msg);
    } finally {
      setBusy(false);
    }
  }

  function applyLabel(r: LabelResult) {
    const pick = (list: string[] | undefined, v: string) => (list ?? []).find((x) => x.toLowerCase() === v.toLowerCase()) ?? "";
    const fields: Partial<Record<LabelField, string>> = {
      producer: r.producer,
      // A wine needs a name: fall back to the appellation, then the producer.
      name: r.name || r.location || r.producer,
      vintage: /^(\d{4}|nv)$/i.test(r.vintage) ? (/^nv$/i.test(r.vintage) ? "NV" : r.vintage) : "",
      type: pick(data.lists["List_Type"], r.type),
      country: r.country,
      region: r.region,
      location: r.location,
      varietal: r.varietal,
      blend: pick(data.lists["List_Blend"], r.blend),
      alcohol: Number(r.alcohol) > 3 && Number(r.alcohol) < 25 ? String(Number(r.alcohol)) : "",
    };
    const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) as Partial<Record<LabelField, string>>;
    onApply({ fields: kept, unsure: r.unsure.filter((k) => kept[k]).map((k) => FIELD_NAMES[k]) });
    reset();
  }

  // ---- a match was found: offer it first ----
  if (found) {
    return (
      <div className="label-fill">
        <div className="notice label-match">
          {found.matches.some((m) => m.exact) ? "This is a wine you already have:" : "This looks like a wine you already have:"}
        </div>
        <div className="choice-list">
          {found.matches.map((m) => (
            <button key={m.key} type="button" className="choice pick" onClick={() => { onPick(m.wine); reset(); }}>
              <span>
                <TypeDot type={m.wine.type ?? null} /> <strong>{m.wine.producer}</strong> {shortName({ producer: m.wine.producer ?? null, name: m.wine.name ?? null })}{" "}
                <span className="muted">{m.wine.vintage}</span>
              </span>
              <span className={m.kind === "cellar" ? "pick-detail cellar" : "pick-detail"}>
                {m.kind === "cellar"
                  ? `In cellar ${(m.wine as Wine).wineId} · ${(m.wine as Wine).qty > 0 ? `${(m.wine as Wine).qty} bottle${(m.wine as Wine).qty === 1 ? "" : "s"}` : "finished"}`
                  : "Tasted before"}{" "}
                · use this wine
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="link" onClick={() => applyLabel(found.result)}>
          No, use the label as a new wine: {[found.result.producer, found.result.name, found.result.vintage].filter(Boolean).join(" ")}
        </button>
      </div>
    );
  }

  return (
    <div className="label-fill">
      {/* Two pickers: some phones only offer the gallery unless the camera is asked for directly. */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = ""; // the same photo can be chosen again
        }}
      />
      {photos.length === 0 ? (
        <>
          <p className="or">or fill from the label</p>
          <div className="actions label-buttons">
            <button type="button" className="primary label-button" onClick={() => camera.current?.click()}>
              📷 Take photo
            </button>
            <button type="button" className="label-button" onClick={() => input.current?.click()}>
              🖼️ Choose photos
            </button>
          </div>
          <p className="muted small">Add the back label too: it often has the alcohol and grapes.</p>
        </>
      ) : (
        <>
          <div className="label-thumbs">
            {photos.map((p, i) => (
              <figure key={p.key}>
                <img src={p.preview} alt={`Label photo ${i + 1}`} />
                {!busy && (
                  <button type="button" className="link" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((ps) => ps.filter((x) => x.key !== p.key))}>
                    ✕
                  </button>
                )}
              </figure>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void read()}>
              {busy ? "Reading the label…" : "Read label"}
            </button>
            {photos.length < MAX_PHOTOS && !busy && (
              <>
                <button type="button" onClick={() => camera.current?.click()}>+ Take another</button>
                <button type="button" onClick={() => input.current?.click()}>+ Choose another</button>
              </>
            )}
            {!busy && <button type="button" className="link" onClick={reset}>Cancel</button>}
          </div>
          <p className="muted small">The photos are sent once to read the label, then thrown away. Nothing is saved.</p>
        </>
      )}
      {error && <p className="warn">{error}</p>}
    </div>
  );
}
