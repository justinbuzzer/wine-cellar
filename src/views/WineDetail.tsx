import { useState } from "react";
import { config } from "../config";
import { formatPrice, norm, shortName, type Tasting, type Wine } from "../data";
import { adjustBottles, markArrived } from "../inventory";
import { openBottle, undoOpen } from "../history";
import { newestOpenings, noteFor } from "../historymodel";
import { todayIso } from "../notesmodel";
import { LOCATIONS, type Location } from "../locations";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { bottles, Modal, Stepper, TypeDot, useToast } from "../ui";
import { locationLine } from "./Cellar";
import { LogoDialog, ProducerLogo, useLogos } from "../logos";
import { producerKey } from "../producers";

type Dialog = null | "open" | "add" | "move" | "arrived";

const other = (l: Location): Location => (l === "Home" ? "K Cellars" : "Home");

export default function WineDetail({ id }: { id: string }) {
  const { data, putWine, putOpening, removeOpening } = useWorkbook();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [justOpened, setJustOpened] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const logos = useLogos();

  const wine = data.wines.find((w) => w.wineId === id);
  if (!wine) {
    return (
      <section className="card">
        <p>Wine {id} wasn't found.</p>
        <a href={href("cellar")}>← Back to cellar</a>
      </section>
    );
  }

  const itemId = data.file.id;
  const hasLocations = wine.kc !== null && wine.home !== null;
  const at = (l: Location) => (l === "Home" ? wine.home ?? 0 : wine.kc ?? 0);
  const stocked = LOCATIONS.filter((l) => at(l) > 0);

  /** Runs a write, updates the app, and offers Undo when possible. */
  async function act(op: () => Promise<Wine>, message: string, undo?: () => Promise<Wine>) {
    setBusy(true);
    try {
      const w = await op();
      putWine(w);
      setDialog(null);
      toast({
        text: message,
        action: undo && {
          label: "Undo",
          run: async () => {
            try {
              putWine(await undo());
              toast({ text: "Undone." });
            } catch (e) {
              toast({ text: describeError(e), error: true });
            }
          },
        },
      });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const open = async (l: Location, date: string, occasion: string) => {
    setBusy(true);
    try {
      const res = await openBottle(itemId, id, l, { date, occasion });
      putWine(res.wine);
      if (res.opening) putOpening(res.opening);
      setJustOpened(true);
      setDialog(null);
      const openId = res.opening?.openId ?? null;
      toast({
        text: res.logError
          ? `Opened a bottle from ${l}, but it couldn't be added to the bottle history: ${describeError(res.logError)}`
          : `Opened a bottle from ${l}. Enjoy!`,
        error: !!res.logError,
        action: {
          label: "Undo",
          run: async () => {
            try {
              putWine(await undoOpen(itemId, id, l, openId));
              if (openId) removeOpening(openId);
              setJustOpened(false);
              toast({ text: "Undone." });
            } catch (e) {
              toast({ text: describeError(e), error: true });
            }
          },
        },
      });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const opened = newestOpenings(data.history.filter((o) => o.wineId === id));

  const linked = data.tastings.filter((t) => t.wineId === id);
  const likely = data.tastings.filter(
    (t) => !t.wineId && norm(t.name) === norm(wine.name) && String(t.vintage) === String(wine.vintage),
  );

  return (
    <>
      <a className="back" href={href("cellar")}>← Cellar</a>

      <section className="card">
        <div className="detail-head">
          <button
            type="button"
            className="logo-button"
            onClick={() => setLogoOpen(true)}
            disabled={!wine.producer}
            aria-label={logos.get(wine.producer) ? "Change the producer's logo" : "Add a logo for this producer"}
            title={logos.get(wine.producer) ? "Change logo" : "Add logo"}
          >
            <ProducerLogo producer={wine.producer} size="large" />
            {wine.producer && <span className="logo-button-label">{logos.get(wine.producer) ? "Change" : "+ Logo"}</span>}
          </button>
          <div>
            <div className="wc-top">
              <TypeDot type={wine.type} />
              <span className="wc-producer">{wine.producer}</span>
            </div>
            <h2 className="detail-title">
              {shortName(wine)} <span className="muted">{wine.vintage}</span>
            </h2>
            <div className="wc-meta">{[wine.type, wine.location, wine.region, wine.country].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        {wine.status === "NYA" && <span className="badge">Not yet arrived</span>}
      </section>

      {logoOpen && wine.producer && (
        <LogoDialog
          producer={wine.producer}
          wineCount={data.wines.filter((w) => producerKey(w.producer) === producerKey(wine.producer)).length}
          onClose={() => setLogoOpen(false)}
        />
      )}

      {justOpened && (
        <a className="card prompt-card" href={href(`note/new/wine/${id}`)}>
          <strong>✍ Write a tasting note</strong>
          <span className="muted">while it's in the glass →</span>
        </a>
      )}

      <section className="card">
        <h2>Bottles</h2>
        {hasLocations ? (
          <div className="bottle-split">
            {LOCATIONS.map((l) => (
              <div key={l} className="bottle-loc">
                <div className="stat-value">{at(l)}</div>
                <div className="muted">{l}</div>
              </div>
            ))}
          </div>
        ) : (
          <p>
            {bottles(wine.qty)}. Add <strong>Qty K Cellars</strong> and <strong>Qty Home</strong> columns to the
            Inventory table to track bottles by location.
          </p>
        )}
        <div className="actions">
          <button
            className="primary"
            disabled={!hasLocations || busy || stocked.length === 0}
            onClick={() => setDialog("open")}
          >
            🍷 Open a bottle
          </button>
          <button disabled={!hasLocations || busy} onClick={() => setDialog("add")}>+ Add bottles</button>
          <button disabled={!hasLocations || busy || stocked.length === 0} onClick={() => setDialog("move")}>⇄ Move</button>
          {wine.status === "NYA" && (
            <button disabled={busy} onClick={() => setDialog("arrived")}>✓ Mark arrived</button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Details</h2>
          <button onClick={() => go(`edit/${id}`)}>Edit</button>
        </div>
        <dl className="facts">
          <Fact label="Producer" value={wine.producer} />
          <Fact label="Wine" value={wine.name} />
          <Fact label="Vintage" value={wine.vintage} />
          <Fact label="Country" value={wine.country} />
          <Fact label="Region" value={wine.region} />
          <Fact label="Location" value={wine.location} />
          <Fact label="Varietal" value={wine.varietal} />
          <Fact label="Blend" value={wine.blend} />
          <Fact label="Alcohol" value={wine.alcohol !== null ? `${wine.alcohol}%` : null} />
          <Fact label="Price" value={formatPrice(wine.price, config.currency)} />
          <Fact label="Source" value={wine.source} />
          <Fact label="Remarks" value={wine.remarks} />
          <Fact label="Wine ID" value={wine.wineId} />
        </dl>
      </section>

      {opened.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Opened ({opened.length})</h2>
            <a href={href("history")}>All history →</a>
          </div>
          <ul className="history-mini">
            {opened.map((o) => {
              const note = noteFor(o, data.tastings);
              return (
                <li key={o.openId}>
                  <span>{formatDay(o.date)}</span>
                  <span className="muted">{[o.from, o.occasion].filter(Boolean).join(" · ")}</span>
                  {note && <a href={href(`note/${note.tastingId}`)}>Note{note.score ? ` · ${note.score}` : ""}</a>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Tasting notes ({linked.length + likely.length})</h2>
          <button onClick={() => go(`note/new/wine/${id}`)}>✍ Write a note</button>
        </div>
        {linked.length + likely.length === 0 && <p className="muted">No tasting notes for this wine yet.</p>}
        {linked.map((t) => (
          <TastingRow key={t.tastingId} t={t} />
        ))}
        {likely.length > 0 && (
          <>
            <p className="muted small">Probably the same wine (same name and vintage, not linked):</p>
            {likely.map((t) => (
              <TastingRow key={t.tastingId} t={t} />
            ))}
          </>
        )}
      </section>

      {dialog === "open" && (
        <OpenDialog
          stocked={stocked}
          at={at}
          busy={busy}
          firstTime={!data.hasHistory}
          onClose={() => setDialog(null)}
          onOpen={(l, date, occasion) => void open(l, date, occasion)}
        />
      )}

      {dialog === "add" && (
        <AddDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(l, n) =>
            act(
              () => adjustBottles(itemId, id, { [l]: n }),
              `Added ${bottles(n)} at ${l}.`,
              () => adjustBottles(itemId, id, { [l]: -n }),
            )
          }
        />
      )}

      {dialog === "move" && (
        <MoveDialog
          wine={wine}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(from, n) =>
            act(
              () => adjustBottles(itemId, id, { [from]: -n, [other(from)]: n }),
              `Moved ${bottles(n)} from ${from} to ${other(from)}.`,
              () => adjustBottles(itemId, id, { [from]: n, [other(from)]: -n }),
            )
          }
        />
      )}

      {dialog === "arrived" && (
        <Modal title="Where did the bottles go?" onClose={() => setDialog(null)}>
          <p className="muted">{locationLine(wine)}</p>
          <div className="choice-list">
            {LOCATIONS.map((l) => (
              <button
                key={l}
                className="choice"
                disabled={busy}
                onClick={() => void act(() => markArrived(itemId, id, l), `Marked as arrived at ${l}.`)}
              >
                <strong>{l}</strong>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="fact-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function TastingRow({ t }: { t: Tasting }) {
  return (
    <a className="tasting-row note-link" href={href(`note/${t.tastingId}`)}>
      <div className="tasting-meta">
        <strong>{t.score ?? "–"}</strong>
        <span className="muted">{t.dateTasted ?? t.yearTasted}</span>
        {t.source && <span className="muted">· {t.source}</span>}
      </div>
      {t.nose && <p className="tasting-text"><span className="muted">Nose:</span> {t.nose}</p>}
      {t.taste && t.taste !== t.nose && <p className="tasting-text"><span className="muted">Palate:</span> {t.taste}</p>}
      {t.note && <p className="tasting-text">{t.note}</p>}
    </a>
  );
}

function OpenDialog({
  stocked,
  at,
  busy,
  firstTime,
  onClose,
  onOpen,
}: {
  stocked: Location[];
  at: (l: Location) => number;
  busy: boolean;
  firstTime: boolean;
  onClose: () => void;
  onOpen: (l: Location, date: string, occasion: string) => void;
}) {
  const [from, setFrom] = useState<Location>(stocked.includes("Home") ? "Home" : stocked[0]);
  const [date, setDate] = useState(todayIso());
  const [occasion, setOccasion] = useState("");
  return (
    <Modal title="Open a bottle" onClose={onClose}>
      {stocked.length > 1 ? (
        <div className="seg">
          {stocked.map((l) => (
            <button key={l} className={l === from ? "on" : ""} onClick={() => setFrom(l)}>
              {l} ({at(l)})
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">From {from} ({bottles(at(from))})</p>
      )}
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} />
      </label>
      <label className="field">
        <span>Occasion or company (optional)</span>
        <input
          type="text"
          value={occasion}
          placeholder="e.g. Dinner with friends, Anniversary"
          onChange={(e) => setOccasion(e.target.value)}
        />
      </label>
      {firstTime && (
        <p className="muted small">This first bottle also adds an "Opened" sheet to your workbook to keep the history.</p>
      )}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => onOpen(from, date, occasion)}>
          {busy ? "Saving…" : `🍷 Open from ${from}`}
        </button>
      </div>
    </Modal>
  );
}

export function formatDay(iso: string | null): string {
  if (!iso) return "No date";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function AddDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (l: Location, n: number) => void }) {
  const [loc, setLoc] = useState<Location>("K Cellars");
  const [n, setN] = useState(1);
  return (
    <Modal title="Add bottles" onClose={onClose}>
      <div className="seg">
        {LOCATIONS.map((l) => (
          <button key={l} className={l === loc ? "on" : ""} onClick={() => setLoc(l)}>{l}</button>
        ))}
      </div>
      <Stepper value={n} min={1} max={48} onChange={setN} />
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => onSave(loc, n)}>
          {busy ? "Saving…" : `Add ${bottles(n)} at ${loc}`}
        </button>
      </div>
    </Modal>
  );
}

function MoveDialog({
  wine,
  busy,
  onClose,
  onSave,
}: {
  wine: Wine;
  busy: boolean;
  onClose: () => void;
  onSave: (from: Location, n: number) => void;
}) {
  const at = (l: Location) => (l === "Home" ? wine.home ?? 0 : wine.kc ?? 0);
  const [from, setFrom] = useState<Location>(at("K Cellars") > 0 ? "K Cellars" : "Home");
  const [n, setN] = useState(1);
  const max = at(from);
  return (
    <Modal title="Move bottles" onClose={onClose}>
      <div className="seg">
        {LOCATIONS.map((l) => (
          <button
            key={l}
            className={l === from ? "on" : ""}
            disabled={at(l) === 0}
            onClick={() => {
              setFrom(l);
              setN(1);
            }}
          >
            From {l} ({at(l)})
          </button>
        ))}
      </div>
      <Stepper value={Math.min(n, max)} min={1} max={max} onChange={setN} />
      <div className="actions">
        <button className="primary" disabled={busy || max === 0} onClick={() => onSave(from, Math.min(n, max))}>
          {busy ? "Saving…" : `Move ${bottles(Math.min(n, max))} → ${other(from)}`}
        </button>
      </div>
    </Modal>
  );
}
