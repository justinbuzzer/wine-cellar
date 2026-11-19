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
import {
  CropEditor,
  fillView,
  fitView,
  loadImage,
  renderCrop,
  suggestCrop,
  type LoadedImage,
  type PreparedImage,
  type View,
} from "./logocrop";

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

// (See logocrop.tsx.)

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
  const [picked, setPicked] = useState<{ src: LoadedImage; suggested: View; whole: View; fill: View } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (picked && URL.revokeObjectURL(picked.src.url)), [picked]);

  const choose = async (f: Blob | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const src = await loadImage(f);
      const suggested = fitView(suggestCrop(src));
      setPicked({ src, suggested, whole: fitView({ x: 0, y: 0, w: src.w, h: src.h }, 0), fill: fillView(src) });
      setView(suggested);
    } catch (e) {
      setError(describeError(e));
    }
  };

  /** Re-crop the logo already saved. */
  const adjust = async () => {
    if (!current) return;
    try {
      await choose(await fetch(current.src).then((r) => r.blob()));
    } catch {
      setError("Couldn't open the current logo to adjust it. Choose the picture again instead.");
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
      {picked && view ? (
        <>
          <CropEditor
            src={picked.src}
            view={view}
            onChange={setView}
            minZ={picked.whole.z * 0.3}
            maxZ={Math.max(picked.fill.z, picked.suggested.z) * 8}
          />
          <p className="muted small crop-help">
            Drag to move. Pinch, scroll or use the slider to resize. What's inside the square is what shows on your
            cards.
          </p>
          <div className="chips crop-presets">
            <button type="button" className="chip-btn" onClick={() => setView(picked.suggested)}>Trim margins</button>
            <button type="button" className="chip-btn" onClick={() => setView(picked.whole)}>Whole picture</button>
            <button type="button" className="chip-btn" onClick={() => setView(picked.fill)}>Fill square</button>
          </div>
        </>
      ) : (
        <div className="logo-preview">
          {current ? (
            <span className="logo-tile logo-preview-tile">
              <img src={current.src} alt="Current logo" />
            </span>
          ) : (
            <span className="logo-tile logo-preview-tile logo-empty">No logo yet</span>
          )}
        </div>
      )}
      <p className="muted small">
        Used for all {wineCount} wine{wineCount === 1 ? "" : "s"} from {producer}. Saved in your OneDrive under{" "}
        <strong>{folder}</strong>. A screenshot from the winery's website or a photo of the label's crest works well.
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
          {picked && view ? (
            <>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(async () => logos.upload(producer, await renderCrop(picked.src, view)), "Logo saved.")}
              >
                {busy ? "Saving…" : "Save logo"}
              </button>
              <button disabled={busy} onClick={() => input.current?.click()}>Choose another</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={() => input.current?.click()}>
                {current ? "Choose a new picture…" : "Choose picture…"}
              </button>
              {current && <button onClick={() => void adjust()}>Adjust crop</button>}
            </>
          )}
          {current && !picked && (
            <button className="link" onClick={() => setConfirmRemove(true)}>Remove logo</button>
          )}
        </div>
      )}
    </Modal>
  );
}
