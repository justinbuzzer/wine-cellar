// Review researched remarks: approve, edit or reject each wine's proposed text,
// then save the approved ones to the Remarks column (added below anything already there).

import { useEffect, useMemo, useState } from "react";
import { norm, shortName, type Wine } from "../data";
import { applyResearch } from "../inventory";
import {
  alcoholValue,
  hostOf,
  parseProposals,
  vintageBadge,
  type Decision,
  type Proposal,
  type ProposalFile,
} from "../researchmodel";
import { href } from "../router";
import { describeError, useWorkbook } from "../store";
import { useToast } from "../ui";

const FILE_KEY = "wine-cellar.research.file";
const DECISIONS_KEY = "wine-cellar.research.decisions";

type Filter = "review" | "approved" | "rejected" | "saved";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* per-device convenience only */
  }
}

/** The wine in the workbook this proposal is for, if it still matches. */
function matchWine(p: Proposal, wines: Wine[]): { wine?: Wine; problem?: string } {
  const wine = wines.find((w) => w.wineId === p.wineId);
  if (!wine) return { problem: `${p.wineId} isn't in this workbook.` };
  if (norm(wine.producer) !== norm(p.producer) || norm(wine.name) !== norm(p.name) || String(wine.vintage ?? "") !== String(p.vintage ?? "")) {
    return { wine, problem: `${p.wineId} is now ${wine.producer} ${wine.name} ${wine.vintage ?? ""}, not the wine researched.` };
  }
  return { wine };
}

export default function Research() {
  const { data, putWine } = useWorkbook();
  const toast = useToast();
  const [file, setFile] = useState<ProposalFile | null>(() => load<ProposalFile | null>(FILE_KEY, null));
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => load(DECISIONS_KEY, {}));
  const [filter, setFilter] = useState<Filter>("review");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  useEffect(() => store(DECISIONS_KEY, decisions), [decisions]);

  const decide = (id: string, d: Decision | null) =>
    setDecisions((prev) => {
      const next = { ...prev };
      if (d) next[id] = d;
      else delete next[id];
      return next;
    });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const parsed = parseProposals(await f.text());
      setFile(parsed);
      store(FILE_KEY, parsed);
      // A new batch: keep decisions only for wines that are in it.
      setDecisions((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => parsed.proposals.some((p) => p.wineId === id))));
      setFilter("review");
    } catch (e) {
      setError(describeError(e));
    }
  };

  const proposals = file?.proposals ?? [];
  const statusOf = (p: Proposal): Filter => decisions[p.wineId]?.status ?? "review";
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { review: 0, approved: 0, rejected: 0, saved: 0 };
    for (const p of proposals) c[decisions[p.wineId]?.status ?? "review"]++;
    return c;
  }, [proposals, decisions]);
  const shown = proposals.filter((p) => statusOf(p) === filter);
  const isTest = /test/i.test(data.file.name);

  const save = async () => {
    setSaving(true);
    const errors: Record<string, string> = {};
    let saved = 0;
    let alcohols = 0;
    for (const p of proposals) {
      const d = decisions[p.wineId];
      if (d?.status !== "approved") continue;
      try {
        const alcohol = d.alcohol === undefined ? (p.alcohol ?? null) : d.alcohol;
        const r = await applyResearch(data.file.id, p.wineId, { text: d.text ?? p.text, alcohol }, p);
        putWine(r.wine);
        decide(p.wineId, { ...d, status: "saved" });
        saved++;
        if (r.alcoholFilled) alcohols++;
      } catch (e) {
        errors[p.wineId] = describeError(e);
      }
    }
    setSaveErrors(errors);
    setSaving(false);
    const failed = Object.keys(errors).length;
    const what = `Saved ${saved} wine${saved === 1 ? "" : "s"}${alcohols ? ` (${alcohols} alcohol % filled)` : ""}`;
    toast({
      text: failed ? `${what}; ${failed} couldn't be saved (see the Approved list).` : `${what}.`,
      error: failed > 0,
    });
  };

  return (
    <>
      <a className="back" href={href("diagnostics")}>← Diagnostics</a>
      <section className="card">
        <div className="card-head">
          <h2>Review remarks</h2>
          {file && <span className="muted small">{proposals.length - counts.review} of {proposals.length} reviewed</span>}
        </div>
        <p className="muted small">
          Approved text is added to <strong>Remarks</strong> in <strong>{data.file.name}</strong>
          {isTest ? " (the TEST copy)" : ""}, on a new line below anything already there.
        </p>
        <label className="file-pick">
          <input type="file" accept=".json,application/json" onChange={(e) => void onFile(e.target.files?.[0])} />
          <span className="button-like">{file ? "Load a different file" : "Choose wine-research-proposals.json"}</span>
        </label>
        {error && <p className="warn small">{error}</p>}
        {file && (
          <div className="seg rs-filter" role="group" aria-label="Show">
            {(["review", "approved", "rejected", "saved"] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {{ review: "To review", approved: "Approved", rejected: "Rejected", saved: "Saved" }[f]} {counts[f]}
              </button>
            ))}
          </div>
        )}
      </section>

      {file && shown.length === 0 && filter === "review" && proposals.length > 0 ? (
        <section className="card rs-done">
          <h3>All {proposals.length} reviewed</h3>
          <p className="small">
            {counts.approved > 0 && <>{counts.approved} approved and <strong>not saved yet</strong>. </>}
            {counts.saved > 0 && <>{counts.saved} saved. </>}
            {counts.rejected > 0 && <>{counts.rejected} rejected.</>}
          </p>
          <div className="actions">
            {counts.approved > 0 && (
              <button className="primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : `Save ${counts.approved} to Excel`}
              </button>
            )}
            {counts.approved > 0 && <button onClick={() => setFilter("approved")}>Check the approved ones</button>}
            {counts.saved > 0 && <button onClick={() => setFilter("saved")}>See what was saved</button>}
          </div>
        </section>
      ) : (
        file && shown.length === 0 && <p className="muted center-text">Nothing here.</p>
      )}
      {shown.map((p) => (
        <ProposalCard
          key={p.wineId}
          p={p}
          decision={decisions[p.wineId]}
          match={matchWine(p, data.wines)}
          saveError={saveErrors[p.wineId]}
          onDecide={(d) => decide(p.wineId, d)}
        />
      ))}

      {counts.approved > 0 && (
        <div className="rs-savebar">
          <span className="muted small">{counts.approved} approved</span>
          <button className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : `Save ${counts.approved} to Excel`}
          </button>
        </div>
      )}
    </>
  );
}

function ProposalCard({
  p,
  decision,
  match,
  saveError,
  onDecide,
}: {
  p: Proposal;
  decision?: Decision;
  match: { wine?: Wine; problem?: string };
  saveError?: string;
  onDecide: (d: Decision | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(decision?.text ?? p.text);
  const text = decision?.text ?? p.text;
  const status = decision?.status;

  // Alcohol %: only offered when the source gives one and the wine's cell is blank.
  const currentAlc = match.wine?.alcohol ?? null;
  const canFillAlc = p.alcohol != null && currentAlc === null;
  const [fillAlc, setFillAlc] = useState(decision?.alcohol !== null);
  const [alcText, setAlcText] = useState(String(decision?.alcohol ?? p.alcohol ?? ""));
  const alc = canFillAlc && fillAlc ? alcoholValue(alcText) : null;
  const alcInvalid = canFillAlc && fillAlc && alc === null;
  const empty = !p.text && !canFillAlc;
  const approve = (t?: string) => onDecide({ status: "approved", text: t, alcohol: canFillAlc ? alc : null });

  return (
    <section className={`card rs-card${status ? ` rs-${status}` : ""}`}>
      <div className="muted small">{p.producer}</div>
      <h3 className="rs-title">
        {shortName(p)} {p.vintage && <span className="muted">{p.vintage}</span>}
      </h3>

      <div className="rs-sources">
        <div className="rs-sources-label">Source{p.sources.length === 1 ? "" : "s"}</div>
        {p.sources.length === 0 && <div className="warn small">No source given — don't approve without one.</div>}
        {p.sources.map((s) => (
          <a key={s.url} className="rs-source" href={s.url} target="_blank" rel="noopener noreferrer">
            <span className={`rs-kind${s.kind === "winery tech sheet" ? " rs-kind-best" : ""}`}>{s.kind}</span>
            <span className="rs-source-title">
              {s.title}
              {s.vintage ? ` (${s.vintage})` : ""}
            </span>
            <span className="rs-host">{s.kind === "email" ? "Open in Gmail" : s.kind === "instagram" ? "Your Instagram" : hostOf(s.url)} ↗</span>
          </a>
        ))}
      </div>

      <div className="rs-badges">
        <span className={`rs-badge rs-conf-${p.confidence}`}>{p.confidence} confidence</span>
        <span className={`rs-badge${p.vintageMatch === "exact" ? " rs-exact" : " rs-vintage-warn"}`}>{vintageBadge(p)}</span>
      </div>
      {p.caveat && <p className="warn small">{p.caveat}</p>}
      {match.problem && <p className="warn small">{match.problem}</p>}
      {saveError && <p className="warn small">Couldn't save: {saveError}</p>}

      {match.wine?.remarks && (
        <div className="rs-existing">
          <div className="muted small">Already in Remarks (kept)</div>
          <div className="rs-text">{match.wine.remarks}</div>
        </div>
      )}

      {empty ? (
        <p className="muted">Nothing reliable found for this wine.</p>
      ) : !p.text ? (
        <p className="muted small">No remarks found — alcohol only.</p>
      ) : editing ? (
        <textarea className="rs-edit" rows={Math.max(5, draft.split("\n").length + 1)} value={draft} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <div className="rs-text rs-proposed">{text}</div>
      )}

      {p.alcohol != null && (
        <div className="rs-alcohol">
          {currentAlc !== null ? (
            <span className="muted small">
              Alcohol % already {currentAlc}% in Excel (kept)
              {Math.abs(currentAlc - p.alcohol) >= 0.1 && <span className="warn"> — the source says {p.alcohol}%</span>}
            </span>
          ) : status ? (
            <span className="small">
              Alcohol %: {decision?.alcohol != null ? `${decision.alcohol}% ${status === "saved" ? "filled" : "will be filled"}` : "left blank"}
            </span>
          ) : (
            <label className="small">
              <input type="checkbox" checked={fillAlc} onChange={(e) => setFillAlc(e.target.checked)} /> Fill the empty Alcohol % with{" "}
              <input
                className="rs-alc-input"
                inputMode="decimal"
                value={alcText}
                disabled={!fillAlc}
                onChange={(e) => setAlcText(e.target.value)}
                aria-label="Alcohol %"
              />
              %{alcInvalid && <span className="warn"> — enter a number like 13.5</span>}
            </label>
          )}
        </div>
      )}

      {status === "saved" ? (
        <p className="ok small">Saved.</p>
      ) : editing ? (
        <div className="actions">
          <button onClick={() => { setDraft(text); setEditing(false); }}>Cancel</button>
          <button
            className="primary"
            disabled={!draft.trim() || !!match.problem || alcInvalid}
            onClick={() => { approve(draft.trim()); setEditing(false); }}
          >
            Approve edited text
          </button>
        </div>
      ) : (
        <div className="actions rs-actions">
          {status ? (
            <button onClick={() => onDecide(null)}>Undo {status === "approved" ? "approval" : "rejection"}</button>
          ) : (
            <>
              <button onClick={() => onDecide({ status: "rejected" })}>✕ {empty ? "Dismiss" : "Reject"}</button>
              {p.text && <button onClick={() => { setDraft(text); setEditing(true); }} disabled={!!match.problem}>✎ Edit</button>}
              {!empty && (
                <button className="primary" onClick={() => approve()} disabled={!!match.problem || alcInvalid}>
                  ✓ Approve
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
