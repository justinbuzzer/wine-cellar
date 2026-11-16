import { useMemo, useState } from "react";
import { config } from "../config";
import { formatPrice, shortName, type Wine } from "../data";
import { LOCATIONS, type Location } from "../locations";
import { go, href } from "../router";
import { useWorkbook } from "../store";
import { bottles, TypeDot } from "../ui";

type StatusFilter = "cellar" | "nya" | "finished" | "all";
type SortKey = "producer" | "region" | "vintage" | "price" | "qty";

interface Filters {
  q: string;
  status: StatusFilter;
  type: string;
  country: string;
  region: string;
  loc: "all" | Location;
  sort: SortKey;
}

const DEFAULTS: Filters = { q: "", status: "cellar", type: "", country: "", region: "", loc: "all", sort: "producer" };

// Kept outside the component so filters survive visiting a wine and coming back.
let saved: Filters = DEFAULTS;

const uniq = (xs: (string | null)[]) =>
  [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

function matchesStatus(w: Wine, s: StatusFilter): boolean {
  const nya = w.status === "NYA";
  switch (s) {
    case "cellar":
      return w.qty > 0 && !nya;
    case "nya":
      return nya;
    case "finished":
      return w.qty <= 0 && !nya;
    default:
      return true;
  }
}

const vintageNum = (w: Wine) => (typeof w.vintage === "number" ? w.vintage : -1);
const text = (s: string | null) => (s ?? "").toLocaleLowerCase();

const SORTS: Record<SortKey, (a: Wine, b: Wine) => number> = {
  producer: (a, b) => text(a.producer).localeCompare(text(b.producer)) || text(a.name).localeCompare(text(b.name)) || vintageNum(a) - vintageNum(b),
  region: (a, b) =>
    text(a.country).localeCompare(text(b.country)) ||
    text(a.region).localeCompare(text(b.region)) ||
    text(a.location).localeCompare(text(b.location)) ||
    text(a.producer).localeCompare(text(b.producer)),
  vintage: (a, b) => vintageNum(b) - vintageNum(a) || text(a.producer).localeCompare(text(b.producer)),
  price: (a, b) => (b.price ?? -1) - (a.price ?? -1),
  qty: (a, b) => b.qty - a.qty || text(a.producer).localeCompare(text(b.producer)),
};

export function locationLine(w: Wine): string {
  if (w.kc === null || w.home === null) return bottles(w.qty);
  if (w.qty === 0) return "Finished";
  const parts = [w.kc > 0 && `K Cellars ${w.kc}`, w.home > 0 && `Home ${w.home}`].filter(Boolean);
  return `${bottles(w.qty)} · ${parts.join(" · ")}`;
}

export default function Cellar() {
  const { data } = useWorkbook();
  const [f, setF] = useState<Filters>(saved);
  const update = (p: Partial<Filters>) => setF((prev) => (saved = { ...prev, ...p }));

  const typeOrder = data.lists["List_Type"] ?? [];
  const types = uniq(data.wines.map((w) => w.type)).sort(
    (a, b) => (typeOrder.indexOf(a) + 1 || 99) - (typeOrder.indexOf(b) + 1 || 99),
  );
  const countries = uniq(data.wines.map((w) => w.country));
  const regions = uniq(data.wines.filter((w) => !f.country || w.country === f.country).map((w) => w.region));

  const list = useMemo(() => {
    const tokens = f.q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return data.wines
      .filter((w) => matchesStatus(w, f.status))
      .filter((w) => !f.type || w.type === f.type)
      .filter((w) => !f.country || w.country === f.country)
      .filter((w) => !f.region || w.region === f.region)
      .filter((w) => {
        if (f.loc === "all" || w.kc === null || w.home === null) return true;
        return (f.loc === "Home" ? w.home : w.kc) > 0;
      })
      .filter((w) => {
        if (tokens.length === 0) return true;
        const hay = [w.wineId, w.producer, w.name, w.vintage, w.region, w.location, w.country, w.varietal, w.source, w.type]
          .join(" ")
          .toLocaleLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .sort(SORTS[f.sort]);
  }, [data.wines, f]);

  const totalBottles = list.reduce((s, w) => {
    if (f.loc !== "all" && w.kc !== null && w.home !== null) return s + (f.loc === "Home" ? w.home : w.kc);
    return s + w.qty;
  }, 0);
  const totalValue = list.reduce((s, w) => s + (w.price ?? 0) * Math.max(0, w.qty), 0);
  const filtered = JSON.stringify({ ...f, sort: "" }) !== JSON.stringify({ ...DEFAULTS, sort: "" });

  return (
    <>
      {!data.upgraded && (
        <div className="notice">
          Bottles aren't split between K Cellars and Home yet. <a href={href("diagnostics")}>Upgrade the spreadsheet</a>
        </div>
      )}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search producer, wine, region, grape…"
          value={f.q}
          onChange={(e) => update({ q: e.target.value })}
        />
        <div className="filters">
          <select value={f.status} onChange={(e) => update({ status: e.target.value as StatusFilter })} aria-label="Status">
            <option value="cellar">In cellar</option>
            <option value="nya">Not yet arrived</option>
            <option value="finished">Finished</option>
            <option value="all">All wines</option>
          </select>
          {data.upgraded && (
            <select value={f.loc} onChange={(e) => update({ loc: e.target.value as Filters["loc"] })} aria-label="Location">
              <option value="all">Any location</option>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          )}
          <select value={f.type} onChange={(e) => update({ type: e.target.value })} aria-label="Type">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select value={f.country} onChange={(e) => update({ country: e.target.value, region: "" })} aria-label="Country">
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select value={f.region} onChange={(e) => update({ region: e.target.value })} aria-label="Region">
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select value={f.sort} onChange={(e) => update({ sort: e.target.value as SortKey })} aria-label="Sort">
            <option value="producer">Sort: Producer</option>
            <option value="region">Sort: Region</option>
            <option value="vintage">Sort: Vintage (newest)</option>
            <option value="price">Sort: Price (highest)</option>
            <option value="qty">Sort: Bottles (most)</option>
          </select>
        </div>
      </div>

      <div className="summary">
        <span>
          <strong>{list.length.toLocaleString()}</strong> wines · <strong>{totalBottles.toLocaleString()}</strong> bottles
          {totalValue > 0 && <> · {formatPrice(Math.round(totalValue), config.currency)}</>}
        </span>
        <span className="summary-actions">
          {filtered && (
            <button className="link" onClick={() => update({ ...DEFAULTS, sort: f.sort })}>Clear filters</button>
          )}
          <button className="primary small" onClick={() => go("add")}>+ Add wine</button>
        </span>
      </div>

      {list.length === 0 ? (
        <p className="muted center-text">No wines match.</p>
      ) : (
        <div className="wine-grid">
          {list.map((w) => (
            <a key={w.wineId ?? w.name} className="wine-card" href={href(`wine/${w.wineId}`)}>
              <div className="wc-top">
                <TypeDot type={w.type} />
                <span className="wc-producer">{w.producer}</span>
                <span className="wc-vintage">{w.vintage}</span>
              </div>
              <div className="wc-name">{shortName(w)}</div>
              <div className="wc-meta">{[w.type, w.region, w.location].filter(Boolean).join(" · ")}</div>
              <div className="wc-bottom">
                <span className={w.qty > 0 ? "wc-qty" : "wc-qty muted"}>{locationLine(w)}</span>
                <span className="wc-price">{formatPrice(w.price, config.currency)}</span>
              </div>
              {w.status === "NYA" && <span className="badge">Not yet arrived</span>}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
