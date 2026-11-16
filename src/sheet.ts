// Pure helpers for Excel A1-style addresses. No browser or network dependencies.

export interface TableAddress {
  sheet: string;
  /** 0-based column index of the table's first column (A = 0). */
  firstCol: number;
  /** 1-based row number of the table's header row. */
  firstRow: number;
  lastCol: number;
  lastRow: number;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" -> 0, "AF" -> 31. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parses addresses such as "Inventory!A1:T606" or "'Wines Tasted'!$A$1:$AF$2679". */
export function parseAddress(address: string): TableAddress {
  const bang = address.lastIndexOf("!");
  if (bang < 0) throw new Error(`Unexpected range address: ${address}`);
  const sheet = address.slice(0, bang).replace(/^'|'$/g, "").replace(/''/g, "'");
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(address.slice(bang + 1));
  if (!m) throw new Error(`Unexpected range address: ${address}`);
  const firstCol = colIndex(m[1]);
  const firstRow = Number(m[2]);
  return {
    sheet,
    firstCol,
    firstRow,
    lastCol: m[3] ? colIndex(m[3]) : firstCol,
    lastRow: m[4] ? Number(m[4]) : firstRow,
  };
}

export function cellAddress(colIdx: number, row: number): string {
  return `${colLetter(colIdx)}${row}`;
}
