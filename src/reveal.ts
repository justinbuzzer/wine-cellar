// Revealing a blind tasting: the bottles read from a line-up photo (left to
// right) are paired with the blind drafts in the order they were written.

import { type Tasting, type Wine } from "./data";
import { type Draft } from "./drafts";
import { labelFields, matchLabel, type LabelResult } from "./label";
import { fromTasting, wineFields, type NoteState } from "./noteState";

/** Drafts still waiting for their wine: no producer and not linked to the cellar. */
export function isBlind(d: Draft): boolean {
  return !d.note.producer && !d.note.wineId;
}

/** "Wine 3", "#3", "3", "Bottle 3", "Glass 3" → 3 */
function blindNumber(name: string | null): number | null {
  const m = /^\s*(?:wine|bottle|glass|no\.?)?\s*#?\s*(\d{1,3})\s*$/i.exec(name ?? "");
  return m ? Number(m[1]) : null;
}

/** Blind drafts in tasting order: by their number when all are numbered, else in the order written. */
export function blindOrder(drafts: Draft[]): Draft[] {
  const blind = drafts.filter(isBlind);
  const nums = blind.map((d) => blindNumber(d.note.name));
  const byId = (a: Draft, b: Draft) => a.draftId.localeCompare(b.draftId);
  if (nums.every((n) => n !== null)) {
    return blind
      .map((d, i) => ({ d, n: nums[i]! }))
      .sort((a, b) => a.n - b.n || byId(a.d, b.d))
      .map((x) => x.d);
  }
  return [...blind].sort(byId);
}

/**
 * The note with its wine details taken from a bottle. A wine you already have
 * (same producer, name and vintage) is used as is, linking cellar wines; else
 * the label's details. Tasting notes are never touched.
 */
export function revealNote(
  base: NoteState,
  bottle: LabelResult,
  data: { wines: Wine[]; tastings: Tasting[]; lists: Record<string, string[]> },
): NoteState {
  const exact = matchLabel(bottle, data.wines, data.tastings).find((m) => m.exact);
  const fields = exact ? wineFields(exact.wine) : (labelFields(bottle, data.lists).fields as Partial<NoteState>);
  // Keep the colour you noted blind if the label doesn't say.
  return { ...base, ...wineFields({}), type: base.type, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) };
}

export function revealDraft(d: Draft, bottle: LabelResult, data: Parameters<typeof revealNote>[2]): NoteState {
  return revealNote(fromTasting(d.note), bottle, data);
}

/** The colour you noted blind disagrees with the label's (e.g. Red vs White). */
export function typeClash(d: Draft, bottle: LabelResult): boolean {
  const a = (d.note.type ?? "").trim().toLowerCase();
  const b = bottle.type.trim().toLowerCase();
  return !!a && !!b && a !== b;
}
