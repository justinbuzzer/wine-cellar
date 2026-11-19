import type { Bar } from "./overview";

/** Small column chart, one column per month. Tapping a column opens that month. */
export function Columns({
  bars,
  unit = "bottle",
  compact,
  title,
  onPick,
}: {
  bars: Bar[];
  unit?: string;
  compact?: boolean;
  /** Hover text; defaults to "Nov: 3 bottles". */
  title?: (b: Bar) => string;
  onPick?: (b: Bar) => void;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const text = title ?? ((b: Bar) => `${b.label}: ${b.value} ${unit}${b.value === 1 ? "" : "s"}`);
  return (
    <div className={`cols${compact ? " compact" : ""}`} role="img" aria-label={bars.map(text).join(", ")}>
      {bars.map((b) => (
        <button key={b.key} className="col" title={text(b)} onClick={() => onPick?.(b)} disabled={!onPick}>
          <span className="col-value">{b.value || ""}</span>
          <span className="col-bar" style={{ height: `${(b.value / max) * 100}%` }} />
          <span className="col-label">{b.label}</span>
        </button>
      ))}
    </div>
  );
}
