// Your blind guess beside the real wine: ✓ right, ±1 close (vintage), ✗ wrong.

import { scoreGuess, type BlindGuess, type Mark } from "../blindmodel";

const SIGN: Record<Mark, string> = { right: "✓", close: "±1", wrong: "✗", none: "–" };

export default function GuessResult({
  guess,
  wine,
}: {
  guess: BlindGuess;
  wine: Parameters<typeof scoreGuess>[1];
}) {
  const rows = scoreGuess(guess, wine);
  const right = rows.filter((r) => r.mark === "right").length;
  const close = rows.filter((r) => r.mark === "close").length;
  const marked = rows.filter((r) => r.mark !== "none").length;
  return (
    <div className="guess-result">
      <div className="guess-row guess-head muted small">
        <span />
        <span>You said</span>
        <span>It was</span>
        <span />
      </div>
      {rows.map((r) => (
        <div key={r.label} className="guess-row">
          <span className="muted small">{r.label}</span>
          <span>{r.said || <span className="muted">–</span>}</span>
          <span>{r.was || <span className="muted">–</span>}</span>
          <span className={`guess-mark ${r.mark}`} aria-label={r.mark}>{SIGN[r.mark]}</span>
        </div>
      ))}
      {marked > 0 && (
        <p className="muted small guess-total">
          {right} of {marked} right{close ? ` · ${close} close` : ""}
        </p>
      )}
    </div>
  );
}
