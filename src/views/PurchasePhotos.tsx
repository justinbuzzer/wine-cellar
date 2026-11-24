import { useRef, useState } from "react";
import type { Invoice } from "../invoicemodel";
import { invoiceFile, labelHints, LabelReaderError, readInvoice, type LabelResult } from "../label";
import { useWorkbook } from "../store";
import LabelFill from "./LabelFill";

const MAX_FILES = 4;
type InvoiceFile = { key: string; mediaType: string; data: string; preview: string | null; name: string };

/**
 * Add a purchase from pictures: 🧾 an invoice (PDF, screenshot or photo) fills the
 * merchant, date, GST and every wine with its bottles and price; 📷 bottle photos
 * (one bottle or a line-up) give a line per wine. Files are sent once to be read,
 * then dropped: nothing is saved.
 */
export default function PurchasePhotos({ onInvoice, onBottles }: { onInvoice: (inv: Invoice) => void; onBottles: (bottles: LabelResult[]) => void }) {
  const { data } = useWorkbook();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"idle" | "invoice" | "bottles">("idle");
  const [files, setFiles] = useState<InvoiceFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const room = MAX_FILES - files.length;
    try {
      const read = await Promise.all([...list].slice(0, room).map(invoiceFile));
      setFiles((fs) => [...fs, ...read.map((f, i) => ({ key: `${Date.now()}-${i}`, ...f }))]);
      setMode("invoice");
      if (list.length > room) setError(`Up to ${MAX_FILES} files: the invoice PDF, or a photo of each page.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be opened.");
    }
  }

  function reset() {
    setFiles([]);
    setMode("idle");
    setError(null);
  }

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const inv = await readInvoice(files.map(({ mediaType, data: d }) => ({ mediaType, data: d })), labelHints(data));
      if (!inv.readable || !inv.lines.length) {
        setError("No wines could be read from this invoice. Try the PDF, or a sharper photo of each page.");
        return;
      }
      onInvoice(inv);
      reset();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The invoice reader failed. Try again.";
      setError(e instanceof LabelReaderError && e.userId ? `${msg} (Account ID for setup: ${e.userId})` : msg);
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,image/*"
      multiple
      hidden
      onChange={(e) => {
        void add(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return (
    <section className="card note-section purchase-photos">
      {picker}
      {mode === "idle" && (
        <>
          <div className="actions label-buttons">
            <button type="button" className="primary label-button" onClick={() => input.current?.click()}>🧾 Scan invoice</button>
            <button type="button" className="label-button" onClick={() => setMode("bottles")}>📷 Bottle photos</button>
          </div>
          <p className="muted small">
            An invoice (PDF, screenshot or photo) fills in the merchant, date and every wine with its price. Bottle photos: one bottle or a line-up.
          </p>
        </>
      )}

      {mode === "invoice" && (
        <>
          <div className="label-thumbs">
            {files.map((f, i) => (
              <figure key={f.key} className={f.preview ? undefined : "pdf-thumb"}>
                {f.preview ? <img src={f.preview} alt={`Invoice page ${i + 1}`} /> : <span>📄 {f.name}</span>}
                {!busy && (
                  <button type="button" className="link" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.key !== f.key))}>✕</button>
                )}
              </figure>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="primary" disabled={busy || !files.length} onClick={() => void read()}>
              {busy ? "Reading the invoice…" : "Read invoice"}
            </button>
            {files.length < MAX_FILES && !busy && <button type="button" onClick={() => input.current?.click()}>+ Add a page</button>}
            {!busy && <button type="button" className="link" onClick={reset}>Cancel</button>}
          </div>
          <p className="muted small">Sent once to be read, then thrown away. Nothing is saved.</p>
        </>
      )}

      {mode === "bottles" && (
        <>
          <LabelFill
            onBottles={(bottles) => {
              onBottles(bottles);
              reset();
            }}
          />
          <button type="button" className="link" onClick={reset}>Cancel</button>
        </>
      )}

      {error && <p className="warn">{error}</p>}
    </section>
  );
}
