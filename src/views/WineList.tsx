import { useCallback, useEffect, useMemo, useState } from "react";
import { config } from "../config";
import { formatPrice, shortName, type Wine } from "../data";
import WineSheet from "./WineSheet";
import { ListModes } from "./SaleLists";
import { LOCATIONS } from "../locations";
import { useWorkbook } from "../store";
import { buildList, selectEntries, type GroupBy, type ListLocation } from "../winelist";

interface Settings {
  heading: string;
  loc: ListLocation;
  groupBy: GroupBy;
  showPrices: boolean;
  showCounts: boolean;
}

const DEFAULTS: Settings = { heading: "The Cellar", loc: "all", groupBy: "type", showPrices: false, showCounts: true };
const KEY = "wine-cellar.listSettings";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export default function WineList() {
  const { data } = useWorkbook();
  const [s, setS] = useState<Settings>(loadSettings);
  const update = (p: Partial<Settings>) => setS((prev) => ({ ...prev, ...p }));
  const [open, setOpen] = useState<Wine | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const [full, setFull] = useState(false);
  useFullScreen(full, () => setFull(false), !!open);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* per-device convenience only */
    }
  }, [s]);

  const entries = useMemo(() => selectEntries(data.wines, s.loc), [data.wines, s.loc]);
  const sections = useMemo(() => buildList(entries, s.groupBy), [entries, s.groupBy]);
  const bottleTotal = entries.reduce((n, e) => n + e.bottles, 0);
  const today = new Date().toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" });

  const jump = (id: string) => document.getElementById(`wl-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      <ListModes on="list" />
      <section className="card wl-controls">
        <div className="wl-controls-grid">
          <label className="field">
            <span>Heading</span>
            <input value={s.heading} onChange={(e) => update({ heading: e.target.value })} />
          </label>
          <label className="field">
            <span>Group by</span>
            <select value={s.groupBy} onChange={(e) => update({ groupBy: e.target.value as GroupBy })}>
              <option value="type">Type, then region</option>
              <option value="region">Country &amp; region, then type</option>
            </select>
          </label>
        </div>
        {data.hasLocations && (
          <div className="seg" role="group" aria-label="Location">
            {(["all", ...LOCATIONS] as ListLocation[]).map((l) => (
              <button key={l} className={s.loc === l ? "on" : ""} onClick={() => update({ loc: l })}>
                {l === "all" ? "All locations" : l}
              </button>
            ))}
          </div>
        )}
        <div className="wl-toggles">
          <label>
            <input type="checkbox" checked={s.showPrices} onChange={(e) => update({ showPrices: e.target.checked })} /> Prices
          </label>
          <label>
            <input type="checkbox" checked={s.showCounts} onChange={(e) => update({ showCounts: e.target.checked })} /> Bottle counts
          </label>
          <span className="muted">
            {entries.length} wines · {bottleTotal} bottles
          </span>
          <button className="small wl-full-btn" onClick={() => setFull(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
            Full screen
          </button>
          <button className="primary small" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
      </section>

      {sections.length > 1 && (
        <nav className="wl-jump" aria-label="Jump to section">
          {sections.map((sec) => (
            <button key={sec.id} onClick={() => jump(sec.id)}>{sec.title}</button>
          ))}
        </nav>
      )}

      <article className="winelist">
        <header className="wl-header">
          <h1>{s.heading || "The Cellar"}</h1>
          <p>
            {s.loc === "all" ? "" : `${s.loc} · `}
            {today}
          </p>
        </header>

        {sections.length === 0 && <p className="wl-empty">No bottles {s.loc === "all" ? "in the cellar" : `at ${s.loc}`}.</p>}

        {sections.map((sec) => (
          <section key={sec.id} id={`wl-${sec.id}`} className="wl-section">
            <h2>{sec.title}</h2>
            {sec.groups.map((g, gi) => {
              const showCountry = s.groupBy === "type" && (gi === 0 || sec.groups[gi - 1].country !== g.country);
              return (
                <div key={`${g.country}-${g.region}`} className="wl-group">
                  {showCountry && <h3 className="wl-country">{g.country}</h3>}
                  {g.region && <h4 className="wl-region">{g.region}</h4>}
                  <ul>
                    {g.entries.map(({ wine, bottles }) => (
                      <li
                        key={wine.wineId ?? `${wine.name}-${wine.vintage}`}
                        className="wl-item wl-tap"
                        role="button"
                        tabIndex={0}
                        aria-label={`Details for ${wine.producer ?? ""} ${shortName(wine)} ${wine.vintage ?? ""}`}
                        onClick={() => setOpen(wine)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(wine))}
                      >
                        <div className="wl-line">
                          <span className="wl-vintage">{wine.vintage ?? ""}</span>
                          <span className="wl-wine">
                            <span className="wl-producer">{wine.producer}</span> {shortName(wine)}
                          </span>
                          {(s.showPrices || s.showCounts) && <span className="wl-leader" aria-hidden />}
                          {s.showCounts && <span className="wl-count">×{bottles}</span>}
                          {s.showPrices && <span className="wl-price">{formatPrice(wine.price, config.currency)}</span>}
                        </div>
                        {(wine.location || (s.groupBy === "region" && wine.type)) && (
                          <div className="wl-sub">
                            {[s.groupBy === "region" ? wine.type : null, wine.location].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        ))}
      </article>

      {full && (
        <button type="button" className="reading-exit" onClick={() => setFull(false)} aria-label="Exit full screen" title="Exit full screen">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
          </svg>
        </button>
      )}
      {open && <WineSheet wine={open} onClose={close} showWhere={!full} />}
    </>
  );
}

/**
 * Full screen reading: hides the app's header, tab dock, list controls and
 * footer (body.reading in styles.css), and asks the browser for real full
 * screen where it allows it (computers, Android; not iPhone, where the
 * installed app already has no browser bars). Escape, the browser's own way
 * out of full screen, or leaving the page all end it.
 */
function useFullScreen(on: boolean, exit: () => void, sheetOpen: boolean) {
  useEffect(() => {
    if (!on) return;
    document.body.classList.add("reading");
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    window.scrollTo({ top: 0 });
    const onChange = () => {
      if (!document.fullscreenElement) exit();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.body.classList.remove("reading");
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  // Escape leaves full screen (when a wine's details aren't open: Escape closes those first).
  useEffect(() => {
    if (!on || sheetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && exit();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, sheetOpen, exit]);
}
