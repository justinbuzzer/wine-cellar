// The app's offline copy of your workbook data, kept in this browser's own
// database (IndexedDB) on this device only. It lets the app open instantly and
// still show your cellar and notes without a connection. Signing out deletes it.
// Changes are never made from this copy: every write re-reads the spreadsheet.

const DB_NAME = "wine-cellar";
const STORE = "snapshots";

export interface Snapshot<T> {
  savedAt: number;
  data: T;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  try {
    return (await run<Snapshot<T> | undefined>("readonly", (s) => s.get(key))) ?? null;
  } catch {
    return null; // private browsing or storage blocked: just start without it
  }
}

export async function saveSnapshot<T>(key: string, data: T): Promise<void> {
  try {
    await run("readwrite", (s) => s.put({ savedAt: Date.now(), data } satisfies Snapshot<T>, key));
  } catch {
    /* not critical */
  }
}

export async function clearSnapshots(): Promise<void> {
  try {
    await run("readwrite", (s) => s.clear());
  } catch {
    /* nothing stored */
  }
}

/** Asks the browser not to clear the offline copy when the phone is short of space. */
export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* optional */
  }
}

/** True when an error means the request never reached Microsoft (no connection, blocked, timed out). */
export function isOfflineError(e: unknown): boolean {
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) return true;
  const code = (e as { errorCode?: string } | null)?.errorCode ?? "";
  return /network|no_network|endpoints_resolution|timed_out/i.test(code);
}
