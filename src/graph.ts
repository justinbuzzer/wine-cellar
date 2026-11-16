// Thin Microsoft Graph client: OneDrive file lookup + Excel workbook reads.
// Step 1 is READ-ONLY: this file only issues GET requests.

import { getToken } from "./auth";
import { config } from "./config";
import type { Cell } from "./data";

const GRAPH = "https://graph.microsoft.com/v1.0";
const STORED_ITEM_KEY = "wine-cellar.workbookItemId";

export interface DriveItem {
  id: string;
  name: string;
  lastModifiedDateTime: string;
  webUrl: string;
  size?: number;
  parentReference?: { path?: string };
}

export class GraphError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface Timed<T> {
  value: T;
  ms: number;
}

async function graphGet<T>(path: string, attempt = 1): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
    const retryAfter = Number(res.headers.get("Retry-After")) || attempt * 2;
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return graphGet<T>(path, attempt + 1);
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new GraphError(res.status, code, message);
  }
  return (await res.json()) as T;
}

async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
}

const ITEM_FIELDS = "$select=id,name,lastModifiedDateTime,webUrl,size,parentReference";

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export function getStoredItemId(): string | null {
  try {
    return localStorage.getItem(STORED_ITEM_KEY);
  } catch {
    return null;
  }
}

export function storeItemId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORED_ITEM_KEY, id);
    else localStorage.removeItem(STORED_ITEM_KEY);
  } catch {
    /* storage unavailable: we'll just look the file up again next time */
  }
}

/**
 * Find the workbook: remembered OneDrive item ID first (survives renames/moves),
 * then the default path. Returns null if neither works (caller offers a search).
 */
export async function findWorkbook(): Promise<DriveItem | null> {
  const stored = getStoredItemId();
  if (stored) {
    try {
      return await graphGet<DriveItem>(`/me/drive/items/${stored}?${ITEM_FIELDS}`);
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e;
      storeItemId(null);
    }
  }
  try {
    const item = await graphGet<DriveItem>(
      `/me/drive/root:${encodePath(config.defaultWorkbookPath)}?${ITEM_FIELDS}`,
    );
    storeItemId(item.id);
    return item;
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null;
    throw e;
  }
}

export async function searchWorkbooks(text: string): Promise<DriveItem[]> {
  const q = encodeURIComponent(text.replace(/'/g, "''"));
  const res = await graphGet<{ value: DriveItem[] }>(
    `/me/drive/root/search(q='${q}')?${ITEM_FIELDS}`,
  );
  return res.value.filter((i) => i.name.toLowerCase().endsWith(".xlsx"));
}

/** Read a whole Excel Table, header row included. */
export function readTable(itemId: string, table: string): Promise<Timed<Cell[][]>> {
  return timed(async () => {
    const res = await graphGet<{ values: Cell[][] }>(
      `/me/drive/items/${itemId}/workbook/tables/${encodeURIComponent(table)}/range?$select=values`,
    );
    return res.values;
  });
}

/** Read a named range (used for the dropdown lists on the "Dont Touch" sheet). */
export function readNamedList(itemId: string, name: string): Promise<Timed<string[]>> {
  return timed(async () => {
    const res = await graphGet<{ values: Cell[][] }>(
      `/me/drive/items/${itemId}/workbook/names/${encodeURIComponent(name)}/range?$select=values`,
    );
    return res.values.map((r) => String(r[0] ?? "")).filter((v) => v !== "");
  });
}
