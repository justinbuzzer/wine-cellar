import { useRef, useState, type ReactNode } from "react";
import { shortName, type Tasting, type Wine } from "../data";
import {
  bottleTitle,
  labelFields,
  labelHints,
  LabelReaderError,
  matchLabel,
  readBottles,
  shrinkPhoto,
  type LabelField,
  type LabelMatch,
  type LabelResult,
} from "../label";
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

type Photo = { key: string; preview: string; mediaType: string; data: string };

/**
 * "Fill from label": pick or take photos, read them, then either use a matching
 * wine you already have or fill the wine details from the label. A line-up photo
 * lists its bottles left to right: choose which one this note is (or, with
 * `onDraftEach`, start a draft for each). With `onBottles`, every bottle found is
 * handed over as is (used to reveal blind drafts).
 * The photos only live in this component's memory and are dropped once used.
 */
export default function LabelFill({
  onApply,
  onPick,
  onDraftEach,
  onBottles,
  compact,
  searchBar,
  children,
}: {
  onApply?: (a: LabelApply) => void;
  onPick?: (w: Wine | Tasting) => void;
  /** Offered when a line-up photo is read on a new note: one draft per bottle. */
  onDraftEach?: (bottles: LabelResult[]) => void;
  /** Line-up mode: all bottles go here instead of filling one note. */
  onBottles?: (bottles: LabelResult[]) => void;
  /** A smaller version, shown once a wine is already filled in. */
  compact?: boolean;
  /** Extra options shown with the buttons (e.g. replace or keep the wine details). */
  children?: ReactNode;
  /** A search box to put the photo buttons beside (as icons), instead of showing them on their own. */
  searchBar?: (buttons: ReactNode) => ReactNode;
}) {
  const { data } = useWorkbook();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [several, setSeveral] = useState<LabelResult[] | null>(null);
  const [found, setFound] = useState<{ result: LabelResult; matches: LabelMatch[] } | null>(null);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    const picked = [...files].slice(0, room);
    try {
      const shrunk = await Promise.all(picked.map(shrinkPhoto));
      setPhotos((p) => [...p, ...shrunk.map((s, i) => ({ key: `${Date.now()}-${i}`, ...s }))]);
      if (files.length > room) setError(`Up to ${MAX_PHOTOS} photos: a line-up shot plus a close-up or two is usually enough.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That photo couldn't be opened.");
    }
  }

  function reset() {
    setPhotos([]);
    setFound(null);
    setSeveral(null);
    setError(null);
  }

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const bottles = await readBottles(
        photos.map(({ mediaType, data }) => ({ mediaType, data })),
        labelHints(data),
      );
      if (!bottles.length || (bottles.length === 1 && !bottles[0].producer && !bottles[0].name)) {
        setError("No wine label could be read in these photos. Try a closer, straighter shot in good light.");
        return;
      }
      if (onBottles) {
        onBottles(bottles);
        reset();
        return;
      }
      if (bottles.length > 1) setSeveral(bottles);
      else choose(bottles[0]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The label reader failed. Try again.";
      setError(e instanceof LabelReaderError && e.userId ? `${msg} (Account ID for setup: ${e.userId})` : msg);
    } finally {
      setBusy(false);
    }
  }

  /** One bottle chosen: offer a wine you already have, else fill from the label. */
  function choose(r: LabelResult) {
    setSeveral(null);
    const matches = matchLabel(r, data.wines, data.tastings);
    if (matches.length) setFound({ result: r, matches });
    else applyLabel(r);
  }

  function applyLabel(r: LabelResult) {
    const { fields, unsure } = labelFields(r, data.lists);
    onApply?.({ fields, unsure: unsure.map((k) => FIELD_NAMES[k]) });
    reset();
  }

  const pickers = (
    <>
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
    </>
  );

  // ---- a line-up photo: which bottle is this note? ----
  if (several) {
    return (
      <div className="label-fill">
        <div className="notice label-match">
          This photo shows {several.length} bottles (left to right). Which one is this note?
        </div>
        <div className="choice-list">
          {several.map((b, i) => (
            <button key={i} type="button" className="choice pick" onClick={() => choose(b)}>
              <span>
                <span className="bottle-pos">{i + 1}</span> <TypeDot type={b.type || null} /> {bottleTitle(b)}
              </span>
            </button>
          ))}
        </div>
        <div className="actions">
          {onDraftEach && (
            <button
              type="button"
              onClick={() => {
                onDraftEach(several);
                reset();
              }}
            >
              Start a draft for each of the {several.length} bottles
            </button>
          )}
          <button type="button" className="link" onClick={reset}>Cancel</button>
        </div>
        {compact && children}
      </div>
    );
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
            <button key={m.key} type="button" className="choice pick" onClick={() => { onPick?.(m.wine); reset(); }}>
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
        {children}
      </div>
    );
  }

  const iconButtons = (
    <>
      <button type="button" className="label-icon" aria-label="Take a photo of the label" title="Take a photo of the label" onClick={() => camera.current?.click()}>📷</button>
      <button type="button" className="label-icon" aria-label="Choose label photos" title="Choose label photos" onClick={() => input.current?.click()}>🖼️</button>
    </>
  );

  return (
    <div className="label-fill">
      {pickers}
      {searchBar?.(iconButtons)}
      {photos.length === 0 && searchBar ? null : photos.length === 0 && (compact || onBottles) ? (
        <div className="label-compact">
          <div className="actions">
            {!onBottles && <span className="muted small">Label to hand?</span>}
            <button type="button" className={onBottles ? "primary" : undefined} onClick={() => camera.current?.click()}>📷 Take photo</button>
            <button type="button" onClick={() => input.current?.click()}>🖼️ Choose photos</button>
          </div>
          {children}
        </div>
      ) : photos.length === 0 ? (
        <>
          <div className="actions label-buttons">
            <button type="button" className="primary label-button" onClick={() => camera.current?.click()}>
              📷 Take photo
            </button>
            <button type="button" className="label-button" onClick={() => input.current?.click()}>
              🖼️ Choose photos
            </button>
          </div>
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
              {busy ? "Reading the labels…" : onBottles ? "Read line-up" : "Read label"}
            </button>
            {photos.length < MAX_PHOTOS && !busy && (
              <>
                <button type="button" onClick={() => camera.current?.click()}>+ Take another</button>
                <button type="button" onClick={() => input.current?.click()}>+ Choose another</button>
              </>
            )}
            {!busy && <button type="button" className="link" onClick={reset}>Cancel</button>}
          </div>
          {compact && children}
          <p className="muted small">The photos are sent once to read the labels, then thrown away. Nothing is saved.</p>
        </>
      )}
      {error && <p className="warn">{error}</p>}
    </div>
  );
}
