import { useEffect, useMemo, useState, type ReactNode } from "react";
import { config } from "../config";
import { formatPrice, shortName, type Cell, type Wine } from "../data";
import { findSameWine } from "../dupes";
import { addWine, receiveBottles } from "../inventory";
import { LOCATIONS, type Location } from "../locations";
import { GST_RATE, storedPrice, summarize } from "../purchase";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { Stepper, TypeDot, useToast } from "../ui";
import { SpotSelect, useResolveSpot } from "./SpotPicker";
import { addGroupBuy } from "../groupbuys";
import { isMe, knownPeople, ME, newGroupId, personKey } from "../groupbuymodel";
import { excelSerial, todayIso } from "../notesmodel";
import { logPurchases, purchaseRow } from "../purchases";

// ---- state ----------------------------------------------------------------------

interface NewFields {
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
  remarks: string;
}
const EMPTY_NEW: NewFields = {
  producer: "", name: "", vintage: "", type: "", country: "", region: "", location: "", varietal: "", blend: "", alcohol: "", remarks: "",
};

type LineState = "idle" | "saving" | "saved" | "error";
interface Line {
  key: string;
  kind: "pick" | "existing" | "new";
  wineId: string;
  fields: NewFields;
  bottles: number;
  price: string;
  state: LineState;
  message?: string;
  /** Group buy: bottles per person ("Me" = yours). */
  split?: Record<string, number>;
  /** Once saved: the cellar wine your share went to ("" if you took none). */
  cellarId?: string;
  /** Once saved: its row for the Purchases log (none if you took no bottles), and whether that's written. */
  log?: Record<string, Cell>;
  logged?: boolean;
}
interface Shared {
  source: string;
  where: Location;
  nya: boolean;
  beforeGst: boolean;
  /** Year bought, from drafts saved before "Bought on" existed. */
  year?: string;
  /** "YYYY-MM-DD" bought; defaults to today. */
  date?: string;
  /** Box or rack the bottles go into (only once they've arrived). */
  spot?: string | null;
  /** Split with friends; your share goes to the cellar, everyone's is tracked under Group buys. */
  group?: boolean;
  groupId?: string;
  /** The GroupBuys rows have been written. */
  groupSaved?: boolean;
  /** What you call it, e.g. "Burgundy 2021 release". */
  groupName?: string;
  /** Friends who've already paid (key: lower-case name). */
  paid?: Record<string, boolean>;
}

const thisYear = () => String(new Date().getFullYear());
const DEFAULT_SHARED: Shared = { source: "", where: "K Cellars", nya: true, beforeGst: false };
/** The day bought: today unless changed (an older draft's year becomes 1 January of it). */
const boughtOn = (s: Shared): string =>
  s.date ?? (s.year && /^\d{4}$/.test(s.year) && s.year !== thisYear() ? `${s.year}-01-01` : todayIso());
const yearValue = (s: Shared): number | null => {
  const d = boughtOn(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? Number(d.slice(0, 4)) : null;
};
/** Every saved line that took bottles has its Purchases row written. */
const allLogged = (ls: Line[]) => ls.every((l) => l.state !== "saved" || !l.log || l.logged);
let keyCounter = 0;
const newKey = () => `line-${Date.now()}-${keyCounter++}`;
const blankLine = (): Line => ({ key: newKey(), kind: "pick", wineId: "", fields: { ...EMPTY_NEW }, bottles: 1, price: "", state: "idle" });

const DRAFT_KEY = `wine-cellar.purchaseDraft.${import.meta.env.MODE}`;
function loadDraft(): { shared: Shared; lines: Line[] } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { shared: Shared; lines: Line[] };
    // A purchase whose lines were all saved (and logged) is finished; start a fresh one.
    if (!d.lines?.length || (d.lines.every((l) => l.state === "saved") && allLogged(d.lines))) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    // A save interrupted by closing the app may or may not have reached Excel.
    d.lines = d.lines.map((l) =>
      l.state === "saving" ? { ...l, state: "error", message: "Saving was interrupted. Check this wine in the Cellar before retrying." } : l,
    );
    return d;
  } catch {
    return null;
  }
}
function saveDraft(d: { shared: Shared; lines: Line[] } | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* drafts are a convenience */
  }
}

const vintageCell = (v: string): Cell => (v.trim() === "" ? "" : /^nv$/i.test(v.trim()) ? "NV" : Number(v));

/** Bottles per person on a group buy line (everything is yours until split). */
export function splitOf(l: Line): Record<string, number> {
  return l.split && Object.keys(l.split).length ? l.split : { [ME]: l.bottles };
}
const splitTotal = (l: Line) => Object.values(splitOf(l)).reduce((s, n) => s + n, 0);

function validate(l: Line, group = false): string | null {
  if (l.state === "saved") return null;
  if (l.kind === "pick") return "Choose a wine, or remove this line.";
  if (l.bottles < 1) return "Add at least one bottle.";
  if (group && splitTotal(l) !== l.bottles) return `Split all ${l.bottles} bottles (${splitTotal(l)} split so far).`;
  if (l.price.trim() && storedPrice(l.price, false) === null) return "Price must be a number.";
  if (l.kind === "new") {
    const f = l.fields;
    if (!f.producer.trim()) return "Producer is required.";
    if (!f.name.trim()) return "Wine name is required.";
    if (!f.type) return "Type is required.";
    if (f.vintage.trim() && !/^(\d{4}|nv)$/i.test(f.vintage.trim())) return "Vintage must be a year or NV.";
    if (f.alcohol.trim() && !(Number(f.alcohol) > 0 && Number(f.alcohol) < 30)) return "Alcohol should be like 13.5.";
  }
  return null;
}

// ---- component ------------------------------------------------------------------

export default function PurchaseForm({ startGroup = false }: { startGroup?: boolean }) {
  const { data, putWine, putGroupBuys, putPurchases } = useWorkbook();
  const toast = useToast();
  const resolveSpot = useResolveSpot();
  const [initial] = useState(() => loadDraft());
  const [shared, setShared] = useState<Shared>(initial?.shared ?? { ...DEFAULT_SHARED, group: startGroup });
  const [lines, setLines] = useState<Line[]>(initial?.lines?.length ? initial.lines : [blankLine()]);
  const [restored, setRestored] = useState(!!initial);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const hasContent = lines.some((l) => l.kind !== "pick") || !!shared.source;
  const linesDone = lines.length > 0 && lines.every((l) => l.state === "saved");
  const logsDone = allLogged(lines);
  // A group buy is only finished once its GroupBuys record is written too.
  const finished = linesDone && logsDone && (!shared.group || !!shared.groupSaved);
  useEffect(() => {
    // Once every line is saved there's nothing left to restore, so don't write the draft back.
    if (finished) saveDraft(null);
    else if (hasContent) saveDraft({ shared, lines });
  }, [shared, lines, hasContent, finished]);
  const people = useMemo(() => knownPeople(data.groupBuys), [data.groupBuys]);

  const setLine = (key: string, patch: Partial<Line> | ((l: Line) => Partial<Line>)) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)));
  const setField = (key: string, k: keyof NewFields, v: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, fields: { ...l.fields, [k]: v } } : l)));

  const wineById = useMemo(() => new Map(data.wines.map((w) => [w.wineId, w])), [data.wines]);
  const sources = useMemo(
    () => [...new Set(data.wines.map((w) => w.source).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    [data.wines],
  );

  const pending = lines.filter((l) => l.kind !== "pick" && l.state !== "saved");
  const summary = summarize(
    lines
      .filter((l) => l.kind !== "pick")
      .map((l) => ({
        kind: l.kind === "new" ? "new" : "existing",
        bottles: l.bottles,
        // A blank price on a wine you already have means "keep its current price" (already after GST).
        price: l.price.trim()
          ? storedPrice(l.price, shared.beforeGst)
          : l.kind === "existing"
            ? wineById.get(l.wineId)?.price ?? null
            : null,
      })),
  );
  const allSaved = finished;

  async function saveAll() {
    setShowErrors(true);
    const problems = lines.map((l) => validate(l, !!shared.group)).filter(Boolean);
    const y = yearValue(shared);
    if (y === null || y < 1900 || boughtOn(shared) > todayIso()) {
      toast({ text: "Bought on must be a date, not in the future.", error: true });
      return;
    }
    if (problems.length) {
      toast({ text: `Fix ${problems.length} line${problems.length === 1 ? "" : "s"} first.`, error: true });
      return;
    }
    setBusy(true);
    let spot: string | null = null;
    try {
      // A "new loose box" is created once, then used for every line (and any retry).
      spot = shared.nya ? null : await resolveSpot(shared.spot ?? null);
      if (spot !== (shared.spot ?? null)) setShared({ ...shared, spot });
    } catch (e) {
      setBusy(false);
      toast({ text: describeError(e), error: true });
      return;
    }
    const group = !!shared.group;
    const groupId = shared.groupId ?? newGroupId();
    if (group && !shared.groupId) setShared((s) => ({ ...s, groupId }));
    let saved = 0;
    let failed = 0;
    const cellarIds = new Map<string, string>();
    const logs = new Map<string, Record<string, Cell>>();
    const date = boughtOn(shared);
    const groupBuy = group ? (shared.groupName ?? "").trim() || groupId : null;
    const logRow = (w: Wine, bottles: number, price: number | null) =>
      purchaseRow(w, { date, bottles, price, source: shared.source, to: shared.where, groupBuy });
    for (const line of lines) {
      if (line.state === "saved") continue;
      setLine(line.key, { state: "saving", message: undefined });
      try {
        const price = storedPrice(line.price, shared.beforeGst);
        const mine = group ? splitOf(line)[ME] ?? 0 : line.bottles;
        const others = line.bottles - mine;
        if (group && mine === 0) {
          // None for you: nothing goes into the cellar; the group buy record tracks it.
          const id = line.kind === "existing" ? line.wineId : "";
          cellarIds.set(line.key, id);
          setLine(line.key, { state: "saved", cellarId: id, message: `${others} for friends · none for your cellar` });
        } else if (line.kind === "existing") {
          const before = wineById.get(line.wineId);
          const { wine, markedNya } = await receiveBottles(data.file.id, line.wineId, shared.where, mine, {
            price: price !== null && price !== before?.price ? price : undefined,
            notYetArrived: shared.nya,
            yearPurchased: yearValue(shared),
            spot,
          });
          putWine(wine);
          cellarIds.set(line.key, line.wineId);
          const log = logRow(wine, mine, price ?? before?.price ?? null);
          logs.set(line.key, log);
          setLine(line.key, {
            state: "saved",
            cellarId: line.wineId,
            log,
            message: `+${mine} at ${shared.where} · now ${wine.qty} bottle${wine.qty === 1 ? "" : "s"}${markedNya ? " · not yet arrived" : ""}${others ? ` · ${others} for friends` : ""}`,
          });
        } else {
          const f = line.fields;
          const cells: Record<string, Cell> = {
            Producer: f.producer.trim(),
            Name: f.name.trim(),
            Vintage: vintageCell(f.vintage),
            Type: f.type,
            Country: f.country.trim(),
            Region: f.region.trim(),
            Location: f.location.trim(),
            Varietal: f.varietal.trim(),
            Blend: f.blend,
            "Alcohol %": f.alcohol.trim() === "" ? "" : Math.round(Number(f.alcohol) * 10) / 1000,
            Price: price ?? "",
            Source: shared.source.trim(),
            Status: shared.nya ? "NYA" : "",
            Remarks: f.remarks.trim(),
            "Year Purchased": yearValue(shared) ?? "",
          };
          const wine = await addWine(
            data.file.id,
            cells,
            { kc: shared.where === "K Cellars" ? mine : 0, home: shared.where === "Home" ? mine : 0 },
            shared.where === "K Cellars" ? { kc: spot } : { home: spot },
          );
          putWine(wine);
          cellarIds.set(line.key, wine.wineId ?? "");
          const log = logRow(wine, mine, price);
          logs.set(line.key, log);
          setLine(line.key, { state: "saved", cellarId: wine.wineId ?? "", log, message: `Added as ${wine.wineId}${others ? ` · ${others} for friends` : ""}` });
        }
        saved++;
      } catch (e) {
        failed++;
        setLine(line.key, { state: "error", message: describeError(e) });
      }
    }
    // Lines saved earlier whose log row didn't make it go with this batch.
    for (const l of lines) if (l.state === "saved" && l.log && !l.logged) logs.set(l.key, l.log);
    const logOk = await saveLogs(logs);
    setBusy(false);
    if (failed) {
      toast({ text: `${saved} saved, ${failed} failed. Fix or retry the lines marked in red.`, error: true });
    } else if (!logOk) {
      return;
    } else if (group) {
      await saveGroupRecord(groupId, cellarIds);
    } else {
      saveDraft(null);
      toast({ text: `Purchase saved: ${saved} line${saved === 1 ? "" : "s"}.` });
    }
  }

  /** Writes the Purchases log rows for these lines (key → row). Safe to retry. */
  async function saveLogs(logs: Map<string, Record<string, Cell>>): Promise<boolean> {
    if (!logs.size) return true;
    try {
      putPurchases(await logPurchases(data.file.id, [...logs.values()]));
      setLines((ls) => ls.map((l) => (logs.has(l.key) ? { ...l, logged: true } : l)));
      return true;
    } catch (e) {
      toast({ text: `Your bottles are saved, but the purchase log couldn't be: ${describeError(e)}. Tap "Save to the purchase log" to retry.`, error: true });
      return false;
    }
  }

  async function retryLogs() {
    setBusy(true);
    const logs = new Map(lines.filter((l) => l.state === "saved" && l.log && !l.logged).map((l) => [l.key, l.log!] as const));
    const ok = await saveLogs(logs);
    setBusy(false);
    if (!ok) return;
    if (shared.group && !shared.groupSaved) await saveGroupRecord(shared.groupId ?? newGroupId());
    else {
      saveDraft(null);
      toast({ text: "Purchase saved." });
    }
  }

  /** Writes the GroupBuys rows: one per person per wine. Safe to retry (only once it succeeds is it marked saved). */
  async function saveGroupRecord(groupId: string, cellarIds: Map<string, string> = new Map()) {
    setBusy(true);
    try {
      const date = excelSerial(todayIso());
      const rows: Record<string, Cell>[] = [];
      lines.filter((l) => l.kind !== "pick").forEach((l, i) => {
        const w = wineById.get(l.wineId);
        const f = l.fields;
        const price = storedPrice(l.price, shared.beforeGst) ?? (l.kind === "existing" ? w?.price ?? null : null);
        const wineId = cellarIds.get(l.key) ?? l.cellarId ?? (l.kind === "existing" ? l.wineId : "");
        for (const [who, n] of Object.entries(splitOf(l))) {
          if (n <= 0) continue;
          rows.push({
            GroupID: groupId,
            "Order Date": date,
            Merchant: shared.source.trim(),
            Line: i + 1,
            WineID: wineId,
            Producer: l.kind === "existing" ? w?.producer ?? "" : f.producer.trim(),
            Name: l.kind === "existing" ? w?.name ?? "" : f.name.trim(),
            Vintage: l.kind === "existing" ? w?.vintage ?? "" : vintageCell(f.vintage),
            Price: price ?? "",
            Person: who,
            Bottles: n,
            To: isMe(who) ? shared.where : "",
            Arrived: shared.nya ? "" : "Yes",
            "Arrived Date": shared.nya ? "" : date,
            Paid: !isMe(who) && shared.paid?.[personKey(who)] ? "Yes" : "",
            "Paid Date": !isMe(who) && shared.paid?.[personKey(who)] ? date : "",
            "Group Name": (shared.groupName ?? "").trim(),
          });
        }
      });
      putGroupBuys(await addGroupBuy(data.file.id, rows));
      setShared((s) => ({ ...s, groupId, groupSaved: true }));
      saveDraft(null);
      const who = new Set(rows.map((r) => String(r.Person)).filter((p) => !isMe(p)));
      toast({ text: `Group Buy saved: ${who.size} friend${who.size === 1 ? "" : "s"}, ${lines.length} wine${lines.length === 1 ? "" : "s"}.` });
    } catch (e) {
      toast({ text: `Your bottles are saved, but the Group Buy record couldn't be: ${describeError(e)}. Tap "Save the Group Buy record" to retry.`, error: true });
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    saveDraft(null);
    setShared({ ...DEFAULT_SHARED });
    setLines([blankLine()]);
    setRestored(false);
    setShowErrors(false);
  }

  return (
    <>
      <a className="back" href={href("cellar")}>← Cellar</a>
      {restored && !allSaved && (
        <div className="notice">
          Restored your unsaved purchase. <button className="link" onClick={discard}>Discard it</button>
        </div>
      )}

      <div className="card-head">
        <h2 className="note-form-title">{shared.group ? "Add a Group Buy" : "Add a purchase"}</h2>
        {data.groupBuys.length > 0 && <a href={href("groupbuys")}>Group Buys →</a>}
      </div>

      <section className="card note-section">
        <label className="switch">
          <input
            type="checkbox"
            checked={!!shared.group}
            disabled={lines.some((l) => l.state === "saved")}
            onChange={(e) => setShared({ ...shared, group: e.target.checked })}
          />{" "}
          Group Buy: split with friends
        </label>
        {shared.group && (
          <>
            <label className="field">
              <span>Name this Group Buy</span>
              <input
                value={shared.groupName ?? ""}
                placeholder="e.g. Burgundy 2021 release"
                disabled={!!shared.groupSaved}
                onChange={(e) => setShared({ ...shared, groupName: e.target.value })}
              />
            </label>
            <p className="muted small">Your share goes into your cellar. Everyone's share is tracked under Group Buys: arrived, paid and handed over.</p>
          </>
        )}
      </section>

      <section className="card note-section">
        <h3>For the whole purchase</h3>
        <Label text="Source (merchant)">
          <input value={shared.source} onChange={(e) => setShared({ ...shared, source: e.target.value })} list="dl-purchase-source" autoComplete="off" />
          <datalist id="dl-purchase-source">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        </Label>
        <Label text="Bottles go to">
          <div className="seg">
            {LOCATIONS.map((l) => (
              <button key={l} type="button" className={shared.where === l ? "on" : ""} onClick={() => setShared({ ...shared, where: l, spot: null })}>{l}</button>
            ))}
          </div>
        </Label>
        {!shared.nya && <SpotSelect loc={shared.where} value={shared.spot ?? null} onChange={(spot) => setShared({ ...shared, spot })} />}
        <Label text="Bought on">
          <input
            type="date"
            value={boughtOn(shared)}
            max={todayIso()}
            disabled={lines.some((l) => l.state === "saved")}
            onChange={(e) => setShared({ ...shared, date: e.target.value || undefined })}
          />
        </Label>
        <label className="switch">
          <input type="checkbox" checked={shared.nya} onChange={(e) => setShared({ ...shared, nya: e.target.checked })} /> Not yet arrived
        </label>
        <label className="switch">
          <input type="checkbox" checked={shared.beforeGst} onChange={(e) => setShared({ ...shared, beforeGst: e.target.checked })} /> Prices
          are before GST (add {GST_RATE}%)
        </label>
      </section>

      {lines.map((line, i) => (
        <LineCard
          key={line.key}
          index={i}
          line={line}
          shared={shared}
          error={showErrors ? validate(line, !!shared.group) : null}
          people={people}
          paid={shared.paid ?? {}}
          onPaid={(who, v) => setShared((s) => ({ ...s, paid: { ...(s.paid ?? {}), [personKey(who)]: v } }))}
          wine={wineById.get(line.wineId)}
          canRemove={lines.length > 1 && line.state !== "saved" && !busy}
          onRemove={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
          onChange={(patch) => setLine(line.key, patch)}
          onField={(k, v) => setField(line.key, k, v)}
          onSameProducer={() =>
            setLines((ls) => {
              const at = ls.findIndex((l) => l.key === line.key);
              const f = line.fields;
              const copy: Line = {
                ...blankLine(),
                kind: "new",
                fields: { ...EMPTY_NEW, producer: f.producer, country: f.country, region: f.region, location: f.location, type: f.type },
              };
              return [...ls.slice(0, at + 1), copy, ...ls.slice(at + 1)];
            })
          }
        />
      ))}

      {!allSaved && !linesDone && (
        <button type="button" className="add-line" disabled={busy} onClick={() => setLines((ls) => [...ls, blankLine()])}>
          + Add another wine
        </button>
      )}

      {shared.group && <SplitSummary
          lines={lines}
          shared={shared}
          wineById={wineById}
          onPaid={shared.groupSaved ? undefined : (who, v) => setShared((s) => ({ ...s, paid: { ...(s.paid ?? {}), [personKey(who)]: v } }))}
        />}
      {linesDone && !logsDone && !busy && (
        <p className="notice">
          Your bottles are saved. <button className="primary small" disabled={busy} onClick={() => void retryLogs()}>Save to the purchase log</button>
        </p>
      )}
      {shared.group && linesDone && logsDone && !shared.groupSaved && (
        <p className="notice">
          Your bottles are saved. <button className="primary small" disabled={busy} onClick={() => void saveGroupRecord(shared.groupId ?? newGroupId())}>Save the Group Buy record</button>
        </p>
      )}

      <div className="save-bar purchase-bar">
        <div className="purchase-summary">
          {summary.newWines > 0 && <span>{summary.newWines} new wine{summary.newWines === 1 ? "" : "s"}</span>}
          {summary.existingWines > 0 && <span>{summary.existingWines} you already have</span>}
          <span><strong>{summary.bottles}</strong> bottle{summary.bottles === 1 ? "" : "s"}</span>
          {summary.total > 0 && <span><strong>{formatPrice(summary.total, config.currency)}</strong>{summary.unpriced ? " + unpriced" : ""}</span>}
          <span className="muted">{shared.where}{shared.nya ? " · not yet arrived" : ""}</span>
        </div>
        {allSaved ? (
          <div className="purchase-done">
            <button onClick={discard}>Add another purchase</button>
            {shared.group ? (
              <button className="primary" onClick={() => { discard(); go("groupbuys"); }}>Done: see Group Buys</button>
            ) : (
              <button className="primary" onClick={() => { discard(); go("cellar"); }}>Done: back to Cellar</button>
            )}
          </div>
        ) : linesDone ? null : (
          <button className="primary" disabled={busy || pending.length === 0} onClick={() => void saveAll()}>
            {busy ? "Saving…" : `Save ${pending.length} line${pending.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      {shared.nya && summary.existingWines > 0 && !allSaved && (
        <p className="muted small">
          Wines you already have that still have bottles won't be marked Not yet arrived. Their new bottles are simply
          added.
        </p>
      )}
    </>
  );
}

// ---- one line ---------------------------------------------------------------------

function LineCard({
  index, line, shared, error, people, paid, onPaid, wine, canRemove, onRemove, onChange, onField, onSameProducer,
}: {
  index: number;
  line: Line;
  shared: Shared;
  error: string | null;
  people: string[];
  paid: Record<string, boolean>;
  onPaid: (who: string, v: boolean) => void;
  wine: Wine | undefined;
  canRemove: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<Line>) => void;
  onField: (k: keyof NewFields, v: string) => void;
  onSameProducer: () => void;
}) {
  const { data } = useWorkbook();
  const locked = line.state === "saved" || line.state === "saving";
  const same = useMemo(
    () => (line.kind === "new" && line.state !== "saved" ? findSameWine(data.wines, line.fields) : []),
    [data.wines, line.kind, line.state, line.fields],
  );
  const converted = shared.beforeGst ? storedPrice(line.price, true) : null;
  const title =
    line.kind === "existing" && wine
      ? `${wine.producer ?? ""} ${shortName(wine)} ${wine.vintage ?? ""}`
      : line.kind === "new"
        ? [line.fields.producer, shortName({ producer: line.fields.producer, name: line.fields.name }), line.fields.vintage]
            .filter(Boolean)
            .join(" ") || "New wine"
        : `Wine ${index + 1}`;

  return (
    <section className={`card note-section line-card ${line.state}`}>
      <div className="line-head">
        <h3>
          {line.state === "saved" ? "✓ " : ""}
          {title}
        </h3>
        {canRemove && <button type="button" className="link" aria-label="Remove this wine" onClick={onRemove}>✕</button>}
      </div>

      {line.message && <p className={line.state === "error" ? "warn" : "ok"}>{line.message}</p>}
      {error && <p className="warn">{error}</p>}

      {line.state === "saved" ? null : line.kind === "pick" ? (
        <LinePicker
          onExisting={(w) => onChange({ kind: "existing", wineId: w.wineId ?? "", price: "" })}
          onNew={(name) => onChange({ kind: "new", fields: { ...EMPTY_NEW, name } })}
        />
      ) : (
        <>
          {line.kind === "existing" && wine && (
            <div className="picked-wine">
              <TypeDot type={wine.type} />
              <div className="wc-meta">
                {wine.wineId} · {wine.qty > 0 ? `${wine.qty} in cellar now` : "finished"} · {[wine.region, wine.country].filter(Boolean).join(", ")}
                {!locked && (
                  <> · <button type="button" className="link" onClick={() => onChange({ kind: "pick", wineId: "", price: "" })}>change</button></>
                )}
              </div>
            </div>
          )}
          {line.kind === "new" && <NewWineFields f={line.fields} onField={onField} disabled={locked} />}
          {same.length > 0 && !locked && (
            <div className="notice dupe-notice">
              You already have this wine and vintage:
              <ul>
                {same.map((w) => (
                  <li key={w.wineId}>
                    {w.wineId} · {w.producer} {shortName(w)} {w.vintage}{" "}
                    <span className="muted">· {w.qty > 0 ? `${w.qty} in cellar now` : "finished"}</span>{" "}
                    <button
                      type="button"
                      className="small"
                      onClick={() => onChange({ kind: "existing", wineId: w.wineId ?? "", state: "idle", message: undefined })}
                    >
                      Add the bottles to {w.wineId} instead
                    </button>
                  </li>
                ))}
              </ul>
              <span className="muted small">Or leave it as a new wine to add a separate row.</span>
            </div>
          )}

          <div className="row-2 line-qty">
            <Label text="Bottles">
              <Stepper
                value={line.bottles}
                min={1}
                max={120}
                onChange={(n) => {
                  // In a group buy, extra or fewer bottles change your share.
                  if (!shared.group) return onChange({ bottles: n });
                  const s = { ...splitOf(line) };
                  const others = Object.entries(s).filter(([k]) => !isMe(k)).reduce((a, [, v]) => a + v, 0);
                  s[ME] = Math.max(0, n - others);
                  onChange({ bottles: n, split: s });
                }}
              />
            </Label>
            <Label text={`Price per bottle${shared.beforeGst ? " (before GST)" : ""}`}>
              <input
                value={line.price}
                onChange={(e) => onChange({ price: e.target.value })}
                inputMode="decimal"
                placeholder={line.kind === "existing" && wine?.price != null ? "Blank keeps the current price" : "S$"}
                disabled={locked}
              />
              {line.kind === "existing" && wine?.price != null && !line.price.trim() && (
                <span className="muted small">Current price {formatPrice(wine.price, config.currency)}</span>
              )}
              {converted !== null && <span className="muted small">→ {formatPrice(converted, config.currency)} after GST</span>}
            </Label>
          </div>
          {shared.group && <SplitEditor line={line} people={people} paid={paid} onPaid={onPaid} disabled={locked} onChange={(split) => onChange({ split })} />}
          {line.kind === "new" && !locked && (
            <button type="button" className="link" onClick={onSameProducer}>+ Same producer, another wine</button>
          )}
        </>
      )}
    </section>
  );
}

function LinePicker({ onExisting, onNew }: { onExisting: (w: Wine) => void; onNew: (name: string) => void }) {
  const { data } = useWorkbook();
  const [q, setQ] = useState("");
  const tokens = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = tokens.length
    ? data.wines
        .filter((w) => {
          const hay = [w.wineId, w.producer, w.name, w.vintage, w.region, w.location].join(" ").toLocaleLowerCase();
          return tokens.every((t) => hay.includes(t));
        })
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 6)
    : [];
  return (
    <div className="wine-picker">
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a wine: your cellar is searched first…" />
      {tokens.length > 0 && (
        <div className="choice-list">
          {results.map((w) => (
            <button key={w.wineId} type="button" className="choice pick" onClick={() => onExisting(w)}>
              <span>
                <TypeDot type={w.type} /> <strong>{w.producer}</strong> {shortName(w)} <span className="muted">{w.vintage}</span>
              </span>
              <span className="pick-detail cellar">
                Already have · {w.qty > 0 ? `${w.qty} bottle${w.qty === 1 ? "" : "s"}` : "finished"} · add bottles to {w.wineId}
              </span>
            </button>
          ))}
          <button type="button" className="choice pick new" onClick={() => onNew(q.trim())}>
            <span>+ New wine: <strong>“{q.trim()}”</strong></span>
            <span className="pick-detail">Fill in its details</span>
          </button>
        </div>
      )}
    </div>
  );
}

function NewWineFields({ f, onField, disabled }: { f: NewFields; onField: (k: keyof NewFields, v: string) => void; disabled: boolean }) {
  const { data } = useWorkbook();
  const lists = useMemo(() => {
    const all = [...data.wines, ...data.tastings];
    const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
    return {
      producer: u(data.wines.map((w) => w.producer)),
      country: u(all.map((w) => w.country)),
      region: u(all.filter((w) => !f.country || w.country === f.country).map((w) => w.region)),
      location: u(all.filter((w) => !f.region || w.region === f.region).map((w) => w.location)),
      varietal: u(all.map((w) => w.varietal)),
    };
  }, [data.wines, data.tastings, f.country, f.region]);
  const id = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const input = (k: keyof NewFields, extra: Record<string, unknown> = {}) => (
    <input value={f[k]} onChange={(e) => onField(k, e.target.value)} disabled={disabled} autoComplete="off" {...extra} />
  );
  return (
    <div className="wine-details">
      <div className="row-2">
        <Label text="Producer *">{input("producer", { list: `dl-${id}-producer` })}</Label>
        <Label text="Wine name *">{input("name")}</Label>
      </div>
      <div className="row-2">
        <Label text="Vintage">{input("vintage", { placeholder: "2019 or NV" })}</Label>
        <Label text="Type *">
          <select value={f.type} onChange={(e) => onField("type", e.target.value)} disabled={disabled}>
            <option value="">Choose…</option>
            {(data.lists["List_Type"] ?? []).map((t) => <option key={t}>{t}</option>)}
          </select>
        </Label>
      </div>
      <div className="row-2">
        <Label text="Country">{input("country", { list: `dl-${id}-country` })}</Label>
        <Label text="Region">{input("region", { list: `dl-${id}-region` })}</Label>
      </div>
      <div className="row-2">
        <Label text="Location / appellation">{input("location", { list: `dl-${id}-location` })}</Label>
        <Label text="Varietal">{input("varietal", { list: `dl-${id}-varietal` })}</Label>
      </div>
      <div className="row-2">
        <Label text="Blend">
          <select value={f.blend} onChange={(e) => onField("blend", e.target.value)} disabled={disabled}>
            <option value="" />
            {(data.lists["List_Blend"] ?? []).map((b) => <option key={b}>{b}</option>)}
          </select>
        </Label>
        <Label text="Alcohol %">{input("alcohol", { inputMode: "decimal", placeholder: "13.5" })}</Label>
      </div>
      <Label text="Remarks">{input("remarks")}</Label>
      {Object.entries(lists).map(([k, values]) => (
        <datalist key={k} id={`dl-${id}-${k}`}>{values.map((v) => <option key={v} value={v} />)}</datalist>
      ))}
    </div>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="field">
      <span>{text}</span>
      {children}
    </div>
  );
}

// ---- group buy: who takes how many ------------------------------------------------

function SplitEditor({
  line, people, paid, onPaid, disabled, onChange,
}: {
  line: Line;
  people: string[];
  paid: Record<string, boolean>;
  onPaid: (who: string, v: boolean) => void;
  disabled: boolean;
  onChange: (s: Record<string, number>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [paidNow, setPaidNow] = useState(false);
  const split = splitOf(line);
  const total = Object.values(split).reduce((s, n) => s + n, 0);
  const names = [ME, ...Object.keys(split).filter((k) => !isMe(k))];
  const set = (who: string, n: number) => onChange({ ...split, [who]: Math.max(0, n) });
  const add = () => {
    const nm = name.trim();
    if (!nm || isMe(nm)) return;
    const existing = Object.keys(split).find((k) => k.toLowerCase() === nm.toLowerCase());
    // A new person takes a bottle from your share, if you have one.
    if (!existing) onChange({ ...split, [ME]: Math.max(0, (split[ME] ?? 0) - 1), [nm]: (split[ME] ?? 0) > 0 ? 1 : 0 });
    if (paidNow) onPaid(existing ?? nm, true);
    setName("");
    setPaidNow(false);
    setAdding(false);
  };
  const id = `dl-people-${line.key}`;
  return (
    <div className="split-edit">
      <div className="split-chips">
        {names.map((who) => (
          <span key={who} className={`split-chip${isMe(who) ? " me" : ""}`}>
            <b>{who}</b>
            {!isMe(who) && paid[personKey(who)] && <em className="split-paid" title="Paid">✓ paid</em>}
            <button type="button" disabled={disabled || (split[who] ?? 0) <= 0} onClick={() => set(who, (split[who] ?? 0) - 1)} aria-label={`One fewer for ${who}`}>−</button>
            <span>{split[who] ?? 0}</span>
            <button type="button" disabled={disabled} onClick={() => set(who, (split[who] ?? 0) + 1)} aria-label={`One more for ${who}`}>+</button>
          </span>
        ))}
        {!disabled && !adding && (
          <button type="button" className="split-add" onClick={() => setAdding(true)}>+ Person</button>
        )}
      </div>
      {adding && (
        <div className="split-new">
          <input
            value={name}
            list={id}
            placeholder="Name"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <datalist id={id}>{people.filter((p) => !names.some((n) => n.toLowerCase() === p.toLowerCase())).map((p) => <option key={p} value={p} />)}</datalist>
          <label className="split-paid-check">
            <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> Paid
          </label>
          <button type="button" className="primary small" onClick={add}>Add</button>
          <button type="button" className="link" onClick={() => { setAdding(false); setName(""); }}>Cancel</button>
        </div>
      )}
      <p className={`small ${total === line.bottles ? "ok" : "warn"}`}>
        {total === line.bottles ? `✓ All ${line.bottles} bottles split` : `${total} of ${line.bottles} bottles split`}
      </p>
    </div>
  );
}

/** Per person: bottles and what they owe (you: what goes to your cellar). */
function SplitSummary({
  lines, shared, wineById, onPaid,
}: { lines: Line[]; shared: Shared; wineById: Map<string | null, Wine>; onPaid?: (who: string, v: boolean) => void }) {
  const per = new Map<string, { bottles: number; amount: number; unpriced: boolean }>();
  for (const l of lines) {
    if (l.kind === "pick") continue;
    const price = storedPrice(l.price, shared.beforeGst) ?? (l.kind === "existing" ? wineById.get(l.wineId)?.price ?? null : null);
    for (const [who, n] of Object.entries(splitOf(l))) {
      if (n <= 0) continue;
      const key = isMe(who) ? ME : who;
      const p = per.get(key) ?? { bottles: 0, amount: 0, unpriced: false };
      p.bottles += n;
      if (price === null) p.unpriced = true;
      else p.amount += price * n;
      per.set(key, p);
    }
  }
  if (!per.size) return null;
  const money = (n: number) => formatPrice(Math.round(n * 100) / 100, config.currency);
  const rows = [...per].sort(([a], [b]) => (isMe(a) ? -1 : isMe(b) ? 1 : a.localeCompare(b)));
  return (
    <section className="card note-section split-summary">
      <h3>Split</h3>
      {rows.map(([who, p]) => (
        <div key={who} className="split-sum-row">
          <span>{who}</span>
          <span className="muted small split-sum-text">
            {p.bottles} bottle{p.bottles === 1 ? "" : "s"} · {money(p.amount)}
            {p.unpriced ? " + unpriced" : ""}
            {isMe(who) ? ` → your cellar${shared.nya ? " (not yet arrived)" : ""}` : shared.paid?.[personKey(who)] ? " paid" : " owed"}
          </span>
          {!isMe(who) && (
            <button
              type="button"
              className={`gb-tick${shared.paid?.[personKey(who)] ? " on" : ""}`}
              disabled={!onPaid}
              aria-pressed={!!shared.paid?.[personKey(who)]}
              onClick={() => onPaid?.(who, !shared.paid?.[personKey(who)])}
            >
              {shared.paid?.[personKey(who)] ? "✓ Paid" : "Paid?"}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}