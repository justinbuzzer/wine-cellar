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
 * Reveal a blind tasting from one line-up photo: bottles (left to right) are
 * paired with the blind drafts in tasting order; fix any pair, then fill them.
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

  function gotBottles(b: LabelResult[]) {
    setBottles(b);
    setPair(blind.map((_, i) => (i < b.length ? i : -1)));
  }

  // ---- 1. photo ----
  if (!bottles) {
    return (
      <div className="reveal">
        <p className="muted small">
          {blind.length
            ? `Take one photo of the line-up, bottles in the order you tasted them. They'll be paired with your ${blind.length} blind draft${blind.length === 1 ? "" : "s"} (${blind.map((d) => d.note.name || d.draftId).join(", ")}).`
            : "No blind drafts to pair (every draft already has a wine). A line-up photo will start a draft for each bottle."}
        </p>
        <LabelFill onBottles={gotBottles} />
        <button type="button" className="link" onClick={onClose}>Cancel</button>
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
        <button type="button" className="link" disabled={!!busy} onClick={() => setBottles(null)}>Use another photo</button>
        <button type="button" className="link" disabled={!!busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
