// Producer logos: one picture per producer, kept in a OneDrive folder next to
// the workbook (config.logoFolder) and named after the producer. A copy is kept
// on this device so they show instantly and offline. Never stored in Excel.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { msal } from "./auth";
import { config } from "./config";
import { deleteFile, listFolder, renameFile, uploadFile, type FolderFile } from "./graph";
import { forgetLogo, loadLogos, saveLogo } from "./offline";
import { logoFileName, logoKeyFromFileName, producerKey } from "./producers";
import { describeError } from "./store";
import { Modal, useToast } from "./ui";

export interface LogoFile {
  id: string;
  name: string;
  eTag: string;
  key: string;
  /** Object URL of the saved copy, or OneDrive's short-lived link. */
  src: string;
}

type LogoStatus = "loading" | "ready" | "failed";

interface Logos {
  status: LogoStatus;
  /** The logo for a producer, if there is one. */
  get(producer: string | null | undefined): LogoFile | undefined;
  /** Every picture in the folder (including ones that match no producer). */
  files: LogoFile[];
  upload(producer: string, image: PreparedImage): Promise<void>;
  remove(producer: string): Promise<void>;
  /** Re-labels a picture (e.g. after a producer was renamed in Excel). */
  assign(file: LogoFile, producer: string): Promise<void>;
  deleteFile(file: LogoFile): Promise<void>;
}

const LogoContext = createContext<Logos | null>(null);

export function useLogos(): Logos {
  const l = useContext(LogoContext);
  if (!l) throw new Error("useLogos outside LogoProvider");
  return l;
}

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "png";

export function LogoProvider({ children }: { children: ReactNode }) {
  const prefix = `${import.meta.env.MODE}:${msal.getActiveAccount()?.homeAccountId ?? "none"}`;
  const [files, setFiles] = useState<LogoFile[]>([]);
  const [status, setStatus] = useState<LogoStatus>("loading");
  const urls = useRef(new Set<string>());

  const objectUrl = useCallback((b: Blob) => {
    const u = URL.createObjectURL(b);
    urls.current.add(u);
    return u;
  }, []);
  const release = useCallback((src: string) => {
    if (urls.current.delete(src)) URL.revokeObjectURL(src);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const made = urls.current;
    void (async () => {
      const cached = await loadLogos(prefix);
      if (cancelled) return;
      const byId = new Map<string, LogoFile>();
      for (const c of cached) {
        const key = logoKeyFromFileName(c.name);
        if (key) byId.set(c.id, { id: c.id, name: c.name, eTag: c.eTag, key, src: objectUrl(c.blob) });
      }
      setFiles([...byId.values()]);

      let listing: FolderFile[];
      try {
        listing = await listFolder(config.logoFolder);
      } catch {
        if (!cancelled) setStatus(byId.size ? "ready" : "failed");
        return;
      }
      if (cancelled) return;
      const keep = new Set(listing.map((f) => f.id));
      for (const c of cached) if (!keep.has(c.id)) void forgetLogo(prefix, c.id);

      const result = new Map<string, LogoFile>();
      const todo: FolderFile[] = [];
      for (const f of listing) {
        const key = logoKeyFromFileName(f.name);
        if (!key) continue;
        const have = byId.get(f.id);
        if (have && have.eTag === f.eTag) result.set(f.id, { ...have, name: f.name, key });
        else todo.push(f);
      }
      const show = () => !cancelled && setFiles([...result.values()]);
      show();

      // Download new or changed pictures, a few at a time.
      const next = async (): Promise<void> => {
        const f = todo.shift();
        if (!f || cancelled) return;
        const key = logoKeyFromFileName(f.name)!;
        try {
          if (!f.downloadUrl) throw new Error("no link");
          const res = await fetch(f.downloadUrl);
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          await saveLogo(prefix, { id: f.id, name: f.name, eTag: f.eTag, blob });
          result.set(f.id, { id: f.id, name: f.name, eTag: f.eTag, key, src: objectUrl(blob) });
        } catch {
          // Couldn't keep a copy: show it straight from OneDrive for now.
          if (f.downloadUrl) result.set(f.id, { id: f.id, name: f.name, eTag: f.eTag, key, src: f.downloadUrl });
        }
        show();
        return next();
      };
      await Promise.all([next(), next(), next(), next()]);
      if (!cancelled) setStatus("ready");
    })();
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
      made.clear();
    };
  }, [prefix, objectUrl]);

  const byKey = useMemo(() => {
    const m = new Map<string, LogoFile>();
    // Several files for one producer: pick one consistently (first by name).
    for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) if (!m.has(f.key)) m.set(f.key, f);
    return m;
  }, [files]);

  const value: Logos = {
    status,
    files,
    get: (producer) => byKey.get(producerKey(producer)),

    async upload(producer, image) {
      const key = producerKey(producer);
      const saved = await uploadFile(`${config.logoFolder}/${logoFileName(producer, image.ext)}`, image.blob);
      // Other pictures for the same producer (another spelling or file type) go.
      const old = files.filter((f) => f.key === key && f.id !== saved.id);
      await Promise.all(old.map((f) => deleteFile(f.id).catch(() => undefined)));
      old.forEach((f) => {
        release(f.src);
        void forgetLogo(prefix, f.id);
      });
      await saveLogo(prefix, { id: saved.id, name: saved.name, eTag: saved.eTag, blob: image.blob });
      const entry: LogoFile = { id: saved.id, name: saved.name, eTag: saved.eTag, key, src: objectUrl(image.blob) };
      setFiles((fs) => [...fs.filter((f) => f.key !== key && f.id !== saved.id), entry]);
    },

    async remove(producer) {
      const key = producerKey(producer);
      const gone = files.filter((f) => f.key === key);
      for (const f of gone) await value.deleteFile(f);
    },

    async deleteFile(file) {
      await deleteFile(file.id);
      release(file.src);
      void forgetLogo(prefix, file.id);
      setFiles((fs) => fs.filter((f) => f.id !== file.id));
    },

    async assign(file, producer) {
      const key = producerKey(producer);
      const renamed = await renameFile(file.id, logoFileName(producer, extOf(file.name)));
      const old = files.filter((f) => f.key === key && f.id !== file.id);
      await Promise.all(old.map((f) => deleteFile(f.id).catch(() => undefined)));
      old.forEach((f) => {
        release(f.src);
        void forgetLogo(prefix, f.id);
      });
      const entry = { ...file, name: renamed.name, eTag: renamed.eTag, key };
      setFiles((fs) => [...fs.filter((f) => f.id !== file.id && f.key !== key), entry]);
      // Keep the saved copy under its new name/version.
      if (file.src.startsWith("blob:")) {
        const blob = await fetch(file.src).then((r) => r.blob());
        await saveLogo(prefix, { id: file.id, name: renamed.name, eTag: renamed.eTag, blob });
      }
    },
  };

  return <LogoContext.Provider value={value}>{children}</LogoContext.Provider>;
}

// ---- Preparing a picture ----------------------------------------------------

export interface PreparedImage {
  blob: Blob;
  ext: "png" | "jpg";
  url: string;
}

const WORK = 900; // working size for trimming
const OUT = 480; // longest side of the saved logo

/**
 * Shrinks a picture to a small logo, trims plain margins (common in
 * screenshots) and keeps transparency when the picture has it.
 */
export async function prepareLogo(file: Blob): Promise<PreparedImage> {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch {
      throw new Error("That file couldn't be read as a picture. Try a PNG or JPEG.");
    }
    const w0 = img.naturalWidth || OUT;
    const h0 = img.naturalHeight || OUT;
    const s = Math.min(1, WORK / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s));
    const h = Math.max(1, Math.round(h0 * s));
    const work = document.createElement("canvas");
    work.width = w;
    work.height = h;
    const wctx = work.getContext("2d", { willReadFrequently: true })!;
    wctx.drawImage(img, 0, 0, w, h);
    const px = wctx.getImageData(0, 0, w, h).data;

    let transparent = false;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 250) {
        transparent = true;
        break;
      }
    }

    // Trim: anything matching the corner colour (or fully transparent) is margin.
    const [r0, g0, b0] = [px[0], px[1], px[2]];
    const isMargin = (i: number) =>
      px[i + 3] < 16 ||
      (!transparent && Math.abs(px[i] - r0) + Math.abs(px[i + 1] - g0) + Math.abs(px[i + 2] - b0) < 36);
    let top = h, left = w, right = -1, bottom = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isMargin((y * w + x) * 4)) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < 0) [left, top, right, bottom] = [0, 0, w - 1, h - 1]; // blank picture: keep as is
    const pad = Math.round(Math.max(right - left, bottom - top) * 0.04);
    left = Math.max(0, left - pad);
    top = Math.max(0, top - pad);
    right = Math.min(w - 1, right + pad);
    bottom = Math.min(h - 1, bottom + pad);
    const cw = right - left + 1;
    const ch = bottom - top + 1;

    const k = Math.min(1, OUT / Math.max(cw, ch));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cw * k));
    out.height = Math.max(1, Math.round(ch * k));
    const octx = out.getContext("2d")!;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(work, left, top, cw, ch, 0, 0, out.width, out.height);

    const ext = transparent ? "png" : "jpg";
    const blob = await new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the picture."))), transparent ? "image/png" : "image/jpeg", 0.88),
    );
    return { blob, ext, url: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(src);
  }
}

// ---- Showing a logo ---------------------------------------------------------

/** Small square tile: the producer's logo, or their initial when there isn't one. */
export function ProducerLogo({ producer, size = "card" }: { producer: string | null; size?: "card" | "large" | "row" }) {
  const { get } = useLogos();
  const logo = get(producer);
  if (logo) {
    return (
      <span className={`logo-tile logo-${size}`}>
        <img src={logo.src} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }
  const initial = (producer ?? "").replace(/^(domaine|dom\.|château|chateau|weingut|bodegas?|tenuta|cantina|maison)\s+/i, "").trim()[0];
  return (
    <span className={`logo-tile logo-${size} logo-empty`} aria-hidden>
      {initial?.toUpperCase() ?? ""}
    </span>
  );
}

// ---- Adding / changing a logo -----------------------------------------------

export function LogoDialog({ producer, wineCount, onClose }: { producer: string; wineCount: number; onClose: () => void }) {
  const logos = useLogos();
  const toast = useToast();
  const current = logos.get(producer);
  const [picked, setPicked] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (picked && URL.revokeObjectURL(picked.url)), [picked]);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      setPicked(await prepareLogo(f));
    } catch (e) {
      setError(describeError(e));
    }
  };

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast({ text: done });
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const folder = config.logoFolder.replace(/^\//, "").split("/").join(" › ");

  return (
    <Modal title={`Logo for ${producer}`} onClose={() => !busy && onClose()}>
      <div className="logo-preview">
        {picked ? (
          <span className="logo-tile logo-preview-tile">
            <img src={picked.url} alt="New logo" />
          </span>
        ) : current ? (
          <span className="logo-tile logo-preview-tile">
            <img src={current.src} alt="Current logo" />
          </span>
        ) : (
          <span className="logo-tile logo-preview-tile logo-empty">No logo yet</span>
        )}
      </div>
      <p className="muted small">
        Used for all {wineCount} wine{wineCount === 1 ? "" : "s"} from {producer}. Saved in your OneDrive under{" "}
        <strong>{folder}</strong>. A screenshot from the winery's website or a photo of the label's crest works well;
        plain margins are trimmed automatically.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="warn">{error}</p>}
      {confirmRemove ? (
        <>
          <p>Remove the logo for {producer}? The picture goes to your OneDrive recycle bin.</p>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void run(() => logos.remove(producer), "Logo removed.")}>
              {busy ? "Removing…" : "Yes, remove"}
            </button>
            <button disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="actions">
          {picked ? (
            <>
              <button className="primary" disabled={busy} onClick={() => void run(() => logos.upload(producer, picked), "Logo saved.")}>
                {busy ? "Saving…" : "Save logo"}
              </button>
              <button disabled={busy} onClick={() => input.current?.click()}>Choose another</button>
            </>
          ) : (
            <button className="primary" onClick={() => input.current?.click()}>
              {current ? "Choose a new picture…" : "Choose picture…"}
            </button>
          )}
          {current && !picked && (
            <button className="link" onClick={() => setConfirmRemove(true)}>Remove logo</button>
          )}
        </div>
      )}
    </Modal>
  );
}
