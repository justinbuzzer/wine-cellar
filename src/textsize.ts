// Text size: a preference for this device (a phone and a computer usually want
// different sizes), kept in localStorage and applied by scaling the page's base
// font size, which everything sized in rem/em follows. index.html applies it
// before the first paint so the page doesn't jump.

export const TEXT_SIZES = [
  { key: "xs", label: "Smallest", pct: 82 },
  { key: "s", label: "Smaller", pct: 90 },
  { key: "m", label: "Default", pct: 100 },
  { key: "l", label: "Larger", pct: 110 },
  { key: "xl", label: "Largest", pct: 120 },
] as const;

export type TextSizeKey = (typeof TEXT_SIZES)[number]["key"];

const KEY = "wine-cellar.textSize";

export function getTextSize(): TextSizeKey {
  try {
    const v = localStorage.getItem(KEY);
    if (TEXT_SIZES.some((s) => s.key === v)) return v as TextSizeKey;
  } catch {
    /* storage blocked: default */
  }
  return "m";
}

export function applyTextSize(key: TextSizeKey) {
  const s = TEXT_SIZES.find((x) => x.key === key) ?? TEXT_SIZES[2];
  document.documentElement.style.fontSize = s.pct === 100 ? "" : `${s.pct}%`;
}

export function setTextSize(key: TextSizeKey) {
  try {
    if (key === "m") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, key);
  } catch {
    /* still applies for now */
  }
  applyTextSize(key);
}
