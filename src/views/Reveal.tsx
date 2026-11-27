import { useState } from "react";
import { addDraft, deleteDraft, updateDraft, type Draft } from "../drafts";
import { bottleTitle, type LabelResult } from "../label";
import { addTasting } from "../notes";
import { EMPTY, toCells, validate, type NoteState } from "../noteState";
import { blindOrder, revealDraft, revealNote, typeClash } from "../reveal";
import { href } from "../router";
import { describeError, useWorkbook } from "../store";
import { TypeDot, useToast } from "../ui";
import LabelFill from "./LabelFill";

/**
 * Reveal a blind tasting from the line-up: bottles (left to right) are paired with
 * the blind drafts in tasting order; fix any pair, then fill them. A long line-up
 * can be photographed in parts: each part is read on its own and its bottles
 * follow the previous part's, so the order holds across photos.
 */
export default function Reveal({ onClose }: { onClose: () => void }) {
  const { data, putDraft, removeDraft, putTasting } = useWorkbook();
  const toast = useToast();
  const blind = blindOrder(data.drafts);
  const [bottles, setBottles] = useState<LabelResult[] | null>(null);
  /** pair[i] = index of the bottle for blind[i], or -1 for none. */
  const [pair, setPair] = useState<number[]>([]);
  /** Bottles nobody is paired with: start a draft for them? */
  const [startExtra, setStartExtra] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ draft: Draft; state: NoteState }[] | null>(null);
  /** The line-up, part by part (one photo each), in the order taken. */
  const [parts, setParts] = useState<LabelResult[][]>([]);
  /** Retaking this part (its index), else adding a new one. */
  const [retake, setRetake] = useState<number | null>(null);
  /** Where parts meet with the same wine either side: "drop" counts it once, "keep" keeps both. */
  const [joins, setJoins] = useState<Record<number, "drop" | "keep">>({});

  const wineKey = (b: LabelResult) => [b.producer, b.name, b.vintage].map((x) => (x ?? "").trim().toLowerCase()).join("|");
  /** Joins (after part k) where the last bottle of part k and the first of part k+1 look like the same wine. */
  const repeats = parts
    .map((p, k) => (k + 1 < parts.length && p.length && parts[k + 1].length && wineKey(p[p.length - 1]) === wineKey(parts[k + 1][0]) && wineKey(p[p.length - 1]) !== "||" ? k : -1))
    .filter((k) => k >= 0);
  const lineUp = parts.flatMap((p, k) => (k > 0 && joins[k - 1] === "drop" && repeats.includes(k - 1) ? p.slice(1) : p));

  function gotBottles(b: LabelResult[]) {
    setBottles(b);
    setPair(blind.map((_, i) => (i < b.length ? i : -1)));
  }

  function gotPart(b: LabelResult[]) {
    const next = retake === null ? [...parts, b] : parts.map((p, k) => (k === retake ? b : p));
    setParts(next);
    setRetake(null);
    // Enough bottles for every blind draft (and no repeat to settle): straight on to pairing.
    const total = next.reduce((n, p) => n + p.length, 0);
    const join = next.length > 1 && next[next.length - 2].length && b.length && wineKey(next[next.length - 2][next[next.length - 2].length - 1]) === wineKey(b[0]);
    if (retake === null && blind.length && total >= blind.length && !join) gotBottles(next.flat());
  }

  // ---- 1. photo(s) ----
  if (!bottles) {
    const adding = retake !== null || parts.length === 0;
    return (
      <div className="reveal">
        <p className="muted small">
          {blind.length
            ? `Line-up left to right, in tasting order. A long one can go in parts: one photo per part, no overlaps. Your ${blind.length} blind draft${blind.length === 1 ? "" : "s"}: ${blind.map((d) => d.note.name || d.draftId).join(", ")}.`
            : "No blind drafts to pair (every draft already has a wine). A line-up photo will start a draft for each bottle."}
        </p>
        {parts.length > 0 && (
          <ol className="reveal-parts">
            {parts.map((p, k) => {
              const start = parts.slice(0, k).reduce((n, q) => n + q.length, 0) + 1;
              return (
                <li key={k}>
                  <span>
                    <strong>Part {k + 1}</strong>{" "}
                    <span className="muted small">
                      bottle{p.length === 1 ? "" : "s"} {start}{p.length > 1 ? `–${start + p.length - 1}` : ""}: {p.map((b) => bottleTitle(b)).join("; ") || "none found"}
                    </span>
                  </span>
                  <button type="button" className="link small" onClick={() => setRetake(k)}>{retake === k ? "Retaking…" : "Retake"}</button>
                  {repeats.includes(k) && (
                    <div className="warn small reveal-join">
                      Part {k + 1} ends and part {k + 2} starts with {bottleTitle(p[p.length - 1])}: the same bottle twice?{" "}
                      <button type="button" className={`link small${joins[k] === "drop" ? " on" : ""}`} onClick={() => setJoins({ ...joins, [k]: "drop" })}>Count it once</button>{" "}
                      <button type="button" className={`link small${joins[k] === "keep" ? " on" : ""}`} onClick={() => setJoins({ ...joins, [k]: "keep" })}>Two bottles</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {(adding || parts.length > 0) && (
          <div className="reveal-next">
            {parts.length > 0 && <strong className="small">{retake !== null ? `Retake part ${retake + 1}` : `Part ${parts.length + 1}`}</strong>}
            {/* A fresh reader for each part. */}
            <LabelFill key={`${parts.length}-${retake}`} onBottles={gotPart} />
          </div>
        )}
        <div className="actions">
          {parts.length > 0 && (
            <button
              type="button"
              className="primary"
              disabled={repeats.some((k) => !joins[k])}
              title={repeats.some((k) => !joins[k]) ? "Settle the possible repeat first" : undefined}
              onClick={() => gotBottles(lineUp)}
            >
              Pair {lineUp.length} bottle{lineUp.length === 1 ? "" : "s"} with your notes
            </button>
          )}
          {retake !== null && <button type="button" className="link" onClick={() => setRetake(null)}>Keep part {retake + 1}</button>}
          <button type="button" className="link" onClick={onClose}>Cancel</button>
        </div>
      </div>
    );
  }

  const used = new Set(pair.filter((p) => p >= 0));
  const extra = bottles.map((_, i) => i).filter((i) => !used.has(i));
  const twice = bottles.map((_, i) => i).filter((i) => pair.filter((p) => p === i).length > 1);

  async function fill() {
    setBusy("Filling your drafts…");
    const filled: { draft: Draft; state: NoteState }[] = [];
    try {
      for (let i = 0; i < blind.length; i++) {
        if (pair[i] < 0) continue;
        const state = revealDraft(blind[i], bottles![pair[i]], data);
        const saved = await updateDraft(data.file.id, blind[i].draftId, toCells(state));
        putDraft(saved);
        filled.push({ draft: saved, state });
      }
      if (startExtra) {
        for (const i of extra) {
          const state = revealNote(EMPTY, bottles![i], data);
          const saved = await addDraft(data.file.id, toCells(state));
          putDraft(saved);
          filled.push({ draft: saved, state });
        }
      }
      setDone(filled);
    } catch (e) {
      toast({ text: `${describeError(e)}${filled.length ? ` (${filled.length} done before this.)` : ""}`, error: true });
      if (filled.length) setDone(filled);
    } finally {
      setBusy(null);
    }
  }

  // ---- 3. filled: save the finished ones? ----
  if (done) {
    const finished = done.filter((x) => validate(x.state).length === 0);
    async function saveFinished() {
      setBusy("Saving your notes…");
      let n = 0;
      try {
        for (const x of finished) {
          const t = await addTasting(data.file.id, toCells(x.state));
          putTasting(t);
          await deleteDraft(data.file.id, x.draft.draftId);
          removeDraft(x.draft.draftId);
          n++;
        }
        toast({ text: `${n} tasting note${n === 1 ? "" : "s"} saved.` });
        onClose();
      } catch (e) {
        toast({ text: `${describeError(e)} (${n} saved before this.)`, error: true });
      } finally {
        setBusy(null);
      }
    }
    return (
      <div className="reveal">
        <p className="notice">
          {done.length} draft{done.length === 1 ? "" : "s"} filled from the line-up. Open any of them below to check the wine details.
        </p>
        <ul className="reveal-done">
          {done.map((x) => (
            <li key={x.draft.draftId}>
              <a href={href(`note/draft/${x.draft.draftId}`)}>
                <TypeDot type={x.state.type || null} /> {[x.state.producer, x.state.name, x.state.vintage].filter(Boolean).join(" ")}
              </a>{" "}
              <span className="muted small">{validate(x.state).length === 0 ? `score ${x.state.score}` : "not finished: stays a draft"}</span>
            </li>
          ))}
        </ul>
        <div className="actions">
          {finished.length > 0 && (
            <button type="button" className="primary" disabled={!!busy} onClick={() => void saveFinished()}>
              {busy ?? `Save the ${finished.length} finished note${finished.length === 1 ? "" : "s"} now`}
            </button>
          )}
          <button type="button" disabled={!!busy} onClick={onClose}>
            {finished.length ? "Check them first" : "Done"}
          </button>
        </div>
        {finished.length > 0 && <p className="muted small">Finished = has a type and a score. The rest stay in Drafts.</p>}
      </div>
    );
  }

  // ---- 2. pair bottles with drafts ----
  return (
    <div className="reveal">
      <p className="muted small">
        {bottles.length} bottle{bottles.length === 1 ? "" : "s"} found, left to right.{" "}
        {blind.length ? "Paired with your drafts in tasting order: change any that are wrong." : ""}
      </p>
      {blind.length > 0 && bottles.length !== blind.length && (
        <p className="warn small">
          {bottles.length} bottles but {blind.length} blind drafts: check the pairs.
        </p>
      )}
      <div className="reveal-pairs">
        {blind.map((d, i) => {
          const b = pair[i] >= 0 ? bottles[pair[i]] : null;
          return (
            <div key={d.draftId} className="reveal-row">
              <div className="reveal-draft">
                <strong>{d.note.name || d.draftId}</strong>
                <div className="muted small">
                  {[d.note.type, d.note.score !== null ? `score ${d.note.score}` : null].filter(Boolean).join(" · ") || "blind"}
                </div>
              </div>
              <span aria-hidden="true">→</span>
              <div>
                <select
                  value={pair[i]}
                  aria-label={`Bottle for ${d.note.name || d.draftId}`}
                  onChange={(e) => setPair((p) => p.map((x, k) => (k === i ? Number(e.target.value) : x)))}
                >
                  <option value={-1}>Not in this photo</option>
                  {bottles.map((bt, k) => (
                    <option key={k} value={k}>
                      {k + 1} · {bottleTitle(bt)}
                    </option>
                  ))}
                </select>
                {b && typeClash(d, b) && (
                  <div className="warn small">
                    Your note says {d.note.type}; the label reads {b.type}. Check this pair.
                  </div>
                )}
                {pair[i] >= 0 && twice.includes(pair[i]) && <div className="warn small">Bottle {pair[i] + 1} is paired twice.</div>}
              </div>
            </div>
          );
        })}
      </div>
      {extra.length > 0 && (
        <label className="switch small">
          <input type="checkbox" checked={startExtra} onChange={(e) => setStartExtra(e.target.checked)} />
          Start a new draft for {extra.length === 1 ? "bottle" : "bottles"} {extra.map((i) => i + 1).join(", ")} (
          {extra.map((i) => bottleTitle(bottles[i])).join("; ")})
        </label>
      )}
      <div className="actions">
        <button type="button" className="primary" disabled={!!busy || (used.size === 0 && !(startExtra && extra.length))} onClick={() => void fill()}>
          {busy ?? `Fill ${[used.size ? `${pair.filter((p) => p >= 0).length} draft${pair.filter((p) => p >= 0).length === 1 ? "" : "s"}` : "", startExtra && extra.length ? `start ${extra.length} new` : ""].filter(Boolean).join(" and ")}`}
        </button>
        <button type="button" className="link" disabled={!!busy} onClick={() => setBottles(null)}>{parts.length > 1 ? "Back to the parts" : "Add a part or retake"}</button>
        <button type="button" className="link" disabled={!!busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
