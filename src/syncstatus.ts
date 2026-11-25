// The header's sync dot: whether what you see is saved and up to date with OneDrive.
// The store reports reading the workbook; every workbook session (reads and saves)
// counts as activity while it runs. Kept outside React so the header can show it.

import { useSyncExternalStore } from "react";

export interface SyncView {
  state: "fresh" | "updating" | "offline" | "failed";
  /** When the copy on screen was saved on this device (offline / failed). */
  savedAt?: number;
  message?: string;
}

let view: SyncView = { state: "fresh" };
let active = 0;
let retry: (() => void) | null = null;
let snap = { view, active };
const listeners = new Set<() => void>();
const emit = () => {
  snap = { view, active };
  listeners.forEach((l) => l());
};

export function setSyncView(v: SyncView, onRetry: () => void): void {
  view = v;
  retry = onRetry;
  emit();
}

export function sessionStarted(): void {
  active++;
  emit();
}

export function sessionEnded(): void {
  active = Math.max(0, active - 1);
  emit();
}

export const retrySync = (): void => retry?.();

/** The current state, outside React (diagnostics). */
export const syncSnapshot = () => snap;

export function useSyncStatus(): { view: SyncView; active: number } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => snap,
  );
}
