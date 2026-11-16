import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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

export function TypeDot({ type }: { type: string | null }) {
  const cls = (type ?? "other").toLowerCase().replace(/[^a-z]/g, "");
  return <span className={`dot t-${cls}`} title={type ?? ""} aria-hidden />;
}

export function bottles(n: number): string {
  return `${n} bottle${n === 1 ? "" : "s"}`;
}
