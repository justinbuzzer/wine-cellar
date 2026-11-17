// Microsoft Graph client: OneDrive file lookup + Excel workbook reads and writes.
//
// Write safety rules (enforced by callers in inventory.ts):
//  - writes go through a workbook session (createSession/closeSession)
//  - only individual cells are written, never whole rows, so formulas elsewhere survive
//  - the target row is re-located by WineID immediately before every write

import { getToken } from "./auth";
import { config } from "./config";
import type { Cell } from "./data";
import { parseAddress, type TableAddress } from "./sheet";

const GRAPH = "https://graph.microsoft.com/v1.0";

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

type Method = "GET" | "POST" | "PATCH";

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  sessionId?: string,
  attempt = 1,
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (sessionId) headers["workbook-session-id"] = sessionId;

  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 429 = request was not processed, always safe to retry. 503/504 only for
  // idempotent requests, so a POST (e.g. add row) is never applied twice.
  const retryable = res.status === 429 || (method !== "POST" && (res.status === 503 || res.status === 504));
  if (retryable && attempt < 4) {
    const retryAfter = Number(res.headers.get("Retry-After")) || attempt * 2;
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return request<T>(method, path, body, sessionId, attempt + 1);
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = res.statusText;
    try {
      const err = await res.json();
      code = err?.error?.code ?? code;
      message = err?.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new GraphError(res.status, code, message);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
}

// ---- OneDrive file lookup ---------------------------------------------------

const ITEM_FIELDS = "$select=id,name,lastModifiedDateTime,webUrl,size,parentReference";

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export function getStoredItemId(): string | null {
  try {
    return localStorage.getItem(config.storageKey);
  } catch {
    return null;
  }
}

export function storeItemId(id: string | null): void {
  try {
    if (id) localStorage.setItem(config.storageKey, id);
    else localStorage.removeItem(config.storageKey);
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
      return await request<DriveItem>("GET", `/me/drive/items/${stored}?${ITEM_FIELDS}`);
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e;
      storeItemId(null);
    }
  }
  try {
    const item = await request<DriveItem>(
      "GET",
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
  const res = await request<{ value: DriveItem[] }>("GET", `/me/drive/root/search(q='${q}')?${ITEM_FIELDS}`);
  return res.value.filter((i) => i.name.toLowerCase().endsWith(".xlsx"));
}

// ---- Excel workbook ---------------------------------------------------------

const enc = encodeURIComponent;

export interface TableSnapshot {
  address: TableAddress;
  /** Header row first, then data rows. */
  values: Cell[][];
}

export class Workbook {
  private constructor(readonly itemId: string, private readonly sessionId?: string) {}

  /** Sessionless, for reads. */
  static reader(itemId: string): Workbook {
    return new Workbook(itemId);
  }

  static async openSession(itemId: string): Promise<Workbook> {
    const res = await request<{ id: string }>(
      "POST",
      `/me/drive/items/${itemId}/workbook/createSession`,
      { persistChanges: true },
    );
    return new Workbook(itemId, res.id);
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.req("POST", "/closeSession", {});
    } catch {
      /* sessions also expire on their own */
    }
  }

  private req<T>(method: Method, path: string, body?: unknown): Promise<T> {
    return request<T>(method, `/me/drive/items/${this.itemId}/workbook${path}`, body, this.sessionId);
  }

  /** Whole table including header row, plus its address. */
  async readTable(table: string): Promise<TableSnapshot> {
    const res = await this.req<{ address: string; values: Cell[][] }>(
      "GET",
      `/tables/${enc(table)}/range?$select=address,values`,
    );
    return { address: parseAddress(res.address), values: res.values };
  }

  /** A named range's first column (used for the dropdown lists on "Dont Touch"). */
  async readNamedList(name: string): Promise<string[]> {
    const res = await this.req<{ values: Cell[][] }>("GET", `/names/${enc(name)}/range?$select=values`);
    return res.values.map((r) => String(r[0] ?? "")).filter((v) => v !== "");
  }

  async writeCell(sheet: string, address: string, value: Cell): Promise<void> {
    await this.req("PATCH", `/worksheets/${enc(sheet)}/range(address='${address}')`, {
      values: [[value ?? ""]],
    });
  }

  async writeNumberFormat(sheet: string, address: string, formats: string[][]): Promise<void> {
    await this.req("PATCH", `/worksheets/${enc(sheet)}/range(address='${address}')`, { numberFormat: formats });
  }

  async writeFormulas(sheet: string, address: string, formulas: string[][]): Promise<void> {
    await this.req("PATCH", `/worksheets/${enc(sheet)}/range(address='${address}')`, { formulas });
  }

  /** Adds a new, empty worksheet. */
  async addWorksheet(name: string): Promise<void> {
    await this.req("POST", "/worksheets/add", { name });
  }

  /** Turns a range (header row included) into a table and gives it a name. */
  async addTable(sheet: string, address: string, name: string): Promise<void> {
    const t = await this.req<{ id: string }>("POST", `/worksheets/${enc(sheet)}/tables/add`, { address, hasHeaders: true });
    await this.req("PATCH", `/tables/${enc(t.id)}`, { name });
  }

  async writeValues(sheet: string, address: string, values: Cell[][]): Promise<void> {
    await this.req("PATCH", `/worksheets/${enc(sheet)}/range(address='${address}')`, { values });
  }

  /** Deletes cells and shifts the cells below up (used to remove one table row). */
  async deleteRange(sheet: string, address: string): Promise<void> {
    await this.req("POST", `/worksheets/${enc(sheet)}/range(address='${address}')/delete`, { shift: "Up" });
  }

  /** Appends a row to a table. Returns the new row's 0-based index and its values. */
  async addRow(table: string, row: Cell[]): Promise<{ index: number; values: Cell[][] }> {
    return this.req("POST", `/tables/${enc(table)}/rows`, { values: [row.map((v) => v ?? "")] });
  }
}

/** Run writes inside a workbook session that is always closed afterwards. */
export async function withSession<T>(itemId: string, fn: (wb: Workbook) => Promise<T>): Promise<T> {
  const wb = await Workbook.openSession(itemId);
  try {
    return await fn(wb);
  } finally {
    await wb.close();
  }
}
