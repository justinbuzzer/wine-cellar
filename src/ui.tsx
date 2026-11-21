import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { savedScroll } from "./router";
import { useTheme } from "./theme";

// ---- Toasts (with optional Undo) --------------------------------------------

interface ToastSpec {
  text: string;
  error?: boolean;
  action?: { label: string; run: () => Promise<void> | void };
}

const ToastContext = createContext<(t: ToastSpec) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastSpec & { id: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((t: ToastSpec) => {
    window.clearTimeout(timer.current);
    setToast({ ...t, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), t.error ? 10000 : 8000);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Lets other floating controls (the back-to-top button) move out of the way.
  useEffect(() => {
    document.body.classList.toggle("has-toast", !!toast);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.error ? "toast-error" : ""}`} role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="toast-action"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await toast.action!.run();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "…" : toast.action.label}
            </button>
          )}
          <button className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

// ---- Modal dialog -------------------------------------------------------------

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** − n + control for bottle counts. */
export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="Fewer">−</button>
      <span>{value}</span>
      <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="More">+</button>
    </div>
  );
}

/** Single-choice buttons; tapping the selected one clears it. */
export function ChipGroup({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          className={value === o ? "chip-btn on" : "chip-btn"}
          onClick={() => onChange(value === o ? "" : o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** Multi-value tags with type-ahead suggestions. */
export function TagInput({
  tags,
  onChange,
  suggestions,
  placeholder,
  label,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: (query: string, exclude: string[]) => string[];
  placeholder?: string;
  label: string;
}) {
  const [q, setQ] = useState("");
  // Track the latest tags so quick successive taps never drop one.
  const latest = useRef(tags);
  latest.current = tags;
  const add = (t: string) => {
    const v = t.trim().replace(/,$/, "").trim();
    const current = latest.current;
    if (!v || current.some((x) => x.toLowerCase() === v.toLowerCase())) return setQ("");
    latest.current = [...current, v];
    onChange(latest.current);
    setQ("");
  };
  const list = suggestions(q, tags);
  return (
    <div className="tag-input">
      {tags.length > 0 && (
        <div className="tags">
          {tags.map((t) => (
            <span key={t} className="tag">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        value={q}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) add(v);
          else setQ(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(q);
          } else if (e.key === "Backspace" && !q && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
      />
      {list.length > 0 && (
        <div className="suggestions">
          {list.map((s) => (
            <button key={s} type="button" className="suggestion" onClick={() => add(s)}>+ {s}</button>
          ))}
          {q.trim() && !list.some((s) => s.toLowerCase() === q.trim().toLowerCase()) && (
            <button type="button" className="suggestion new" onClick={() => add(q)}>+ “{q.trim()}”</button>
          )}
        </div>
      )}
      {list.length === 0 && q.trim() && (
        <div className="suggestions">
          <button type="button" className="suggestion new" onClick={() => add(q)}>+ “{q.trim()}”</button>
        </div>
      )}
    </div>
  );
}

/** Sun/moon button that switches between light and dark mode. */
export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const toDark = theme === "light";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={toDark ? "Switch to dark mode" : "Switch to light mode"}
      title={toDark ? "Dark mode" : "Light mode"}
    >
      {toDark ? (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      )}
    </button>
  );
}

/** Floating ↑ button that appears once you've scrolled about 1.5 screens down. */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 1.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      className={show ? "to-top show" : "to-top"}
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      ↑
    </button>
  );
}

/**
 * After a list page renders, scroll back to where you left it and briefly
 * highlight the item you opened. If that item is no longer listed, the saved
 * position still lands you close to where you were.
 */
export function restoreListPosition(page: string, selector: string | null): void {
  const y = savedScroll(page);
  if (y === undefined) return;
  window.scrollTo(0, y);
  if (!selector) return;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation if it's already applied
  el.classList.add("flash");
  window.setTimeout(() => el.classList.remove("flash"), 1800);
}

// ---- Install as an app (Android / desktop Chrome and Edge) --------------------
// The browser offers installation via a "beforeinstallprompt" event, which can
// fire before React starts, so it's caught as soon as this module loads.
// iPhone/iPad have no such event: there it's Share → Add to Home Screen.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let installPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  installListeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installListeners.forEach((l) => l());
});

export function InstallButton() {
  const [available, setAvailable] = useState(!!installPrompt);
  useEffect(() => {
    const l = () => setAvailable(!!installPrompt);
    installListeners.add(l);
    return () => {
      installListeners.delete(l);
    };
  }, []);
  if (!available) return null;
  return (
    <button
      className="link"
      onClick={async () => {
        const p = installPrompt;
        if (!p) return;
        await p.prompt();
        await p.userChoice;
        installPrompt = null;
        setAvailable(false);
      }}
    >
      Install app
    </button>
  );
}

export function TypeDot({ type }: { type: string | null }) {
  const cls = (type ?? "other").toLowerCase().replace(/[^a-z]/g, "");
  return <span className={`dot t-${cls}`} title={type ?? ""} aria-hidden />;
}

export function bottles(n: number): string {
  return `${n} bottle${n === 1 ? "" : "s"}`;
}

// ---- Press and hold ----------------------------------------------------------

const HOLD_MS = 500;
/** Finger or mouse may wander this far (px) and still count as holding still. */
const HOLD_SLOP = 10;

/**
 * Press and hold: calls `onHold` after HOLD_MS without moving, and swallows the
 * click that follows so the row doesn't also open. Scrolling cancels it.
 */
export function useLongPress() {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  return {
    /**
     * The click ending a long press can land on whatever replaced the row
     * (e.g. its tick box); call this from that element's click to ignore it.
     */
    swallow: (e: MouseEvent<HTMLElement>) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    bind: (onHold: () => void) => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          fired.current = true;
          timer.current = null;
          navigator.vibrate?.(15);
          onHold();
        }, HOLD_MS);
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > HOLD_SLOP) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      // A long press on a phone would otherwise open the link menu.
      onContextMenu: (e: MouseEvent<HTMLElement>) => e.preventDefault(),
      onClick: (e: MouseEvent<HTMLElement>) => {
        if (fired.current) {
          e.preventDefault();
          fired.current = false;
        }
      },
    }),
  };
}

