import { useEffect, useRef, useState } from "react";
import type { Bar } from "./overview";

/**
 * Small column chart, one column per month. With `detail`, tapping a column
 * shows that month's figures in a bubble (tap it again, or anywhere else, to
 * close); `onOpen` makes the bubble a link to the month. Without `detail`,
 * tapping a column calls `onPick` straight away.
 */
export function Columns({
  bars,
  unit = "bottle",
  compact,
  title,
  onPick,
  detail,
  onOpen,
}: {
  bars: Bar[];
  unit?: string;
  compact?: boolean;
  /** Hover text; defaults to "Nov: 3 bottles". */
  title?: (b: Bar) => string;
  onPick?: (b: Bar) => void;
  /** The month's figures, shown in a bubble when its column is tapped. */
  detail?: (b: Bar) => string;
  /** Tapping the bubble opens the month (only for months with something in them). */
  onOpen?: (b: Bar) => void;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const text = title ?? detail ?? ((b: Bar) => `${b.label}: ${b.value} ${unit}${b.value === 1 ? "" : "s"}`);
  const [sel, setSel] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // A tap anywhere outside the chart closes the bubble.
  useEffect(() => {
    if (!sel) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setSel(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [sel]);

  const at = bars.findIndex((b) => b.key === sel);
  const picked = at >= 0 ? bars[at] : null;
  // Keep the bubble inside the card: left-aligned at the start, right-aligned at the end.
  const align = at < 3 ? "start" : at > bars.length - 4 ? "end" : "mid";
  const pos =
    align === "start" ? { left: 0 } : align === "end" ? { right: 0 } : { left: `${((at + 0.5) / bars.length) * 100}%` };

  return (
    <div className="cols-wrap" ref={wrap}>
      {picked && detail && (
        onOpen && picked.value > 0 ? (
          <button type="button" className={`col-tip ${align}`} style={pos} onClick={() => onOpen(picked)}>
            {detail(picked)} <span aria-hidden="true">›</span>
          </button>
        ) : (
          <span className={`col-tip ${align}`} style={pos} role="status">{detail(picked)}</span>
        )
      )}
      <div className={`cols${compact ? " compact" : ""}`} role="img" aria-label={bars.map(text).join(", ")}>
        {bars.map((b) => (
          <button
            key={b.key}
            className={`col${b.key === sel ? " on" : ""}`}
            title={text(b)}
            onClick={() => (detail ? setSel((s) => (s === b.key ? null : b.key)) : onPick?.(b))}
            disabled={!detail && !onPick}
          >
            <span className="col-value">{b.value || ""}</span>
            <span className="col-bar" style={{ height: `${(b.value / max) * 100}%` }} />
            <span className="col-label">{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
