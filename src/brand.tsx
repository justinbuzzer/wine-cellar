import { useLayoutEffect, useRef, useState } from "react";

export const BRAND = "halffulldrinkup";

/**
 * The halffulldrinkup logo: a balloon glass filled halfway, its wine level
 * running on as a gold line under the name and ending in a gold dot.
 * HALFFULL in spaced Jost capitals above the line, "drinkup" in Playfair
 * Display italic below. The line is measured from the lettering once the fonts
 * have loaded, so it always ends just after the name. Colours follow the theme.
 */
export function BrandLogo({ height = 46 }: { height?: number }) {
  const top = useRef<SVGTextElement>(null);
  const bottom = useRef<SVGTextElement>(null);
  // Until the fonts are measured, a width that suits them.
  const [end, setEnd] = useState(186);

  useLayoutEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive || !top.current || !bottom.current) return;
      const w = Math.max(top.current.getComputedTextLength(), bottom.current.getComputedTextLength());
      if (w > 0) setEnd(Math.round(56 + w + 6));
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const width = end + 12;
  return (
    <svg className="brand-logo" viewBox={`0 0 ${width} 68`} height={height} width={(height * width) / 68} role="img" aria-label={BRAND}>
      <title>{BRAND}</title>
      <g transform="translate(6,10)">
        <path className="b-glass" d="M9 4 C3 14 4 30 20 33 C36 30 37 14 31 4 Z" fill="none" strokeWidth="1.8" />
        <path className="b-wine" d="M5.2 20 H34.8 C34 27 29 31.5 20 33 C11 31.5 6 27 5.2 20 Z" />
        <path className="b-glass" d="M20 33 V51 M13 53 H27" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
      <line className="b-line" x1="11.2" y1="30" x2={end} y2="30" strokeWidth="1.4" strokeLinecap="round" />
      <circle className="b-dot" cx={end + 7} cy="30" r="2.5" />
      <text ref={top} className="b-top" x="56" y="23" fontSize="21" letterSpacing="3">
        HALFFULL
      </text>
      <text ref={bottom} className="b-bottom" x="56" y="56" fontSize="25">
        drinkup
      </text>
    </svg>
  );
}
