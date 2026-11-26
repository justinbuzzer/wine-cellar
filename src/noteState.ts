// Tasting-note form state and its conversion to and from spreadsheet rows.
// Shared by the note form and the line-up reveal (which fills drafts).

import { type Cell, type Tasting, type Wine } from "./data";
import { composeNote, DEFAULT_SCORE, excelSerial, joinColour, parseNote, showsTannin, splitColour, splitTerms, todayIso } from "./notesmodel";
// ---- form state ----------------------------------------------------------------

export interface NoteState {
  wineId: string;
  producer: string;
  name: string;
  vintage: string;
  type: string;
  country: string;
  region: string;
  location: string;
  varietal: string;
  blend: string;
  alcohol: string;
  price: string;
  colourIntensity: string;
  colourHue: string;
  noseIntensity: string;
  noseTags: string[];
  sameAsNose: boolean;
  tasteTags: string[];
  palateIntensity: string;
  dryness: string;
  acid: string;
  tannin: string;
  tanninTags: string[];
  body: string;
  finish: string;
  score: number | null;
  quality: string;
  ageing: string;
  noteFree: string;
  date: string;
  year: string;
  source: string;
  vessel: string;
  viticulture: string;
  /** Tasted blind: your guesses are kept and marked once the wine is revealed. */
  blind: boolean;
  guessGrapes: string[];
  guessCountry: string;
  guessRegion: string;
  guessVintage: string;
}

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export const EMPTY: NoteState = {
  wineId: "", producer: "", name: "", vintage: "", type: "", country: "", region: "", location: "",
  varietal: "", blend: "", alcohol: "", price: "",
  colourIntensity: "", colourHue: "", noseIntensity: "", noseTags: [], sameAsNose: true, tasteTags: [],
  palateIntensity: "", dryness: "", acid: "", tannin: "", tanninTags: [], body: "", finish: "",
  score: null, quality: "", ageing: "", noteFree: "",
  date: todayIso(), year: "", source: "", vessel: "", viticulture: "",
  blind: false, guessGrapes: [], guessCountry: "", guessRegion: "", guessVintage: "",
};

export type WineFields = Pick<Wine, "wineId" | "producer" | "name" | "vintage" | "type" | "country" | "region" | "location" | "varietal" | "blend" | "alcohol" | "price">;

export function wineFields(w: Partial<WineFields>): Partial<NoteState> {
  return {
    wineId: s(w.wineId), producer: s(w.producer), name: s(w.name), vintage: s(w.vintage), type: s(w.type),
    country: s(w.country), region: s(w.region), location: s(w.location), varietal: s(w.varietal),
    blend: s(w.blend), alcohol: s(w.alcohol), price: s(w.price),
  };
}

export function fromTasting(t: Tasting): NoteState {
  const c = splitColour(t.colour);
  const n = parseNote(t.note);
  const nose = splitTerms(t.nose);
  const taste = splitTerms(t.taste);
  const same = !t.taste || t.taste.trim() === (t.nose ?? "").trim();
  return {
    ...EMPTY,
    ...wineFields(t),
    colourIntensity: c.intensity, colourHue: c.hue,
    noseIntensity: s(t.noseIntensity), noseTags: nose,
    sameAsNose: same, tasteTags: same ? [] : taste,
    palateIntensity: s(t.palateIntensity), dryness: s(t.dryness), acid: s(t.acid),
    tannin: t.tannin === "-" ? "" : s(t.tannin), tanninTags: splitTerms(t.tanninNature),
    body: s(t.body), finish: s(t.finish),
    score: t.score, quality: n.quality, ageing: n.ageing, noteFree: n.free,
    date: s(t.dateTasted), year: s(t.yearTasted), source: s(t.source),
    vessel: s(t.vessel), viticulture: s(t.viticulture),
    blind: t.blind, guessGrapes: splitTerms(t.guess?.grape), guessCountry: s(t.guess?.country),
    guessRegion: s(t.guess?.region), guessVintage: s(t.guess?.vintage),
  };
}

/** Spreadsheet values for the Tasted table. */
export function toCells(f: NoteState): Record<string, Cell> {
  const nose = f.noseTags.join(", ");
  const taste = f.sameAsNose ? nose : f.tasteTags.join(", ");
  const year = f.date ? Number(f.date.slice(0, 4)) : f.year.trim() ? Number(f.year) : "";
  return {
    WineID: f.wineId,
    Producer: f.producer.trim(),
    Name: f.name.trim(),
    Vintage: f.vintage.trim() === "" ? "" : /^nv$/i.test(f.vintage.trim()) ? "NV" : Number(f.vintage),
    Type: f.type,
    Country: f.country.trim(),
    Region: f.region.trim(),
    Location: f.location.trim(),
    Varietal: f.varietal.trim(),
    Blend: f.blend,
    "Alcohol %": f.alcohol.trim() === "" ? "" : Math.round(Number(f.alcohol) * 10) / 1000,
    Price: f.price.trim() === "" ? "" : Number(f.price),
    Colour: joinColour(f.colourIntensity, f.colourHue),
    Nose: nose,
    "Nose Intensity": f.noseIntensity,
    Taste: taste,
    "Palate Intensity": f.palateIntensity,
    Dryness: f.dryness,
    Acid: f.acid,
    Tannin: f.tannin || (showsTannin(f.type) ? "" : "-"),
    "Tannin Nature": f.tanninTags.join(", "),
    Body: f.body,
    Finish: f.finish,
    Score: f.score ?? DEFAULT_SCORE,
    Note: composeNote(f.quality, f.ageing, f.noteFree),
    Source: f.source.trim(),
    "Year Tasted": year,
    "Date Tasted": f.date ? excelSerial(f.date) : "",
    "Maturing/Fermenting Vessel": f.vessel.trim(),
    "Viniculture/Viticulture": f.viticulture.trim(),
    // Blind tastings: the flag and your guesses (blank on other notes).
    Blind: f.blind ? "Yes" : "",
    "Guess Grape": f.guessGrapes.join(", "),
    "Guess Country": f.guessCountry.trim(),
    "Guess Region": f.guessRegion.trim(),
    "Guess Vintage": /^nv$/i.test(f.guessVintage.trim()) ? "NV" : f.guessVintage.trim(),
  };
}

export function validate(f: NoteState): string[] {
  const errs: string[] = [];
  if (!f.name.trim()) errs.push("Choose or enter a wine.");
  if (!f.type) errs.push("Type is required.");
  if (f.vintage.trim() && !/^(\d{4}|nv)$/i.test(f.vintage.trim())) errs.push("Vintage must be a year or NV.");
  if (f.alcohol.trim() && !(Number(f.alcohol) > 0 && Number(f.alcohol) < 30)) errs.push("Alcohol should be like 13.5.");
  if (f.price.trim() && !(Number(f.price) >= 0)) errs.push("Price must be a number.");
  if (!f.date && f.year.trim() && !/^\d{4}$/.test(f.year.trim())) errs.push("Year tasted must be a year.");
  return errs;
}

/** Only the format checks: a draft can be saved at any stage. */
export function validateDraft(f: NoteState): string[] {
  return validate(f).filter((e) => !/^(Choose or enter a wine|Type is required|Give it a score)/.test(e));
}

