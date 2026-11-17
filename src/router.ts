import { useEffect, useState } from "react";

// Hash routes (#/cellar, #/wine/W0001 …) so deep links work on GitHub Pages.
//
// Scroll handling: list pages (Cellar, Notes) remember how far down you were, so
// coming back from a wine or note returns you to the same spot. Every other page
// starts at the top.

function parse(hash = window.location.hash): string[] {
  return hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}

/** The page a hash belongs to; the default page is the Cellar. */
function pageOf(hash: string): string {
  return parse(hash)[0] ?? "cellar";
}

const RESTORABLE = new Set(["cellar", "notes"]);
const positions = new Map<string, number>();
const listeners = new Set<() => void>();
let currentHash = window.location.hash;

window.addEventListener("hashchange", () => {
  const leaving = pageOf(currentHash);
  if (RESTORABLE.has(leaving)) positions.set(leaving, window.scrollY);
  currentHash = window.location.hash;
  const arriving = pageOf(currentHash);
  // List pages restore their own position once they've rendered (see savedScroll).
  if (!(RESTORABLE.has(arriving) && positions.has(arriving))) window.scrollTo(0, 0);
  listeners.forEach((l) => l());
});

export function useRoute(): string[] {
  const [route, setRoute] = useState(() => parse());
  useEffect(() => {
    const l = () => setRoute(parse());
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return route;
}

/** Where the given list page was scrolled to when you last left it (this session). */
export function savedScroll(page: string): number | undefined {
  return positions.get(page);
}

export function go(path: string): void {
  window.location.hash = `#/${path}`;
}

export function href(path: string): string {
  return `#/${path}`;
}
