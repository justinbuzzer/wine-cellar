import { useState } from "react";
import { config } from "../config";
import { formatPrice, norm, shortName, type Tasting, type Wine } from "../data";
import { adjustBottles, markArrived } from "../inventory";
import { LOCATIONS, type Location } from "../locations";
import { go, href } from "../router";
import { describeError, useWorkbook } from "../store";
import { bottles, Modal, Stepper, TypeDot, useToast } from "../ui";
import { locationLine } from "./Cellar";

type Dialog = null | "open" | "add" | "move" | "arrived";

const other = (l: Location): Location => (l === "Home" ? "K Cellars" : "Home");

export default function WineDetail({ id }: { id: string }) {
  const { data, putWine } = useWorkbook();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

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

  const openBottle = (l: Location) =>
    act(
      () => adjustBottles(itemId, id, { [l]: -1 }),
      `Opened a bottle from ${l}. Enjoy!`,
      () => adjustBottles(itemId, id, { [l]: 1 }),
    );

  const linked = data.tastings.filter((t) => t.wineId === id);
  const likely = data.tastings.filter(
    (t) => !t.wineId && norm(t.name) === norm(wine.name) && String(t.vintage) === String(wine.vintage),
  );

  return (
    <>
      <a className="back" href={href("cellar")}>← Cellar</a>

      <section className="card">
        <div className="detail-head">
          <TypeDot type={wine.type} />
          <div>
            <div className="wc-producer">{wine.producer}</div>
            <h2 className="detail-title">
              {shortName(wine)} <span className="muted">{wine.vintage}</span>
            </h2>
            <div className="wc-meta">{[wine.type, wine.location, wine.region, wine.country].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        {wine.status === "NYA" && <span className="badge">Not yet arrived</span>}
      </section>

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
            onClick={() => (stocked.length === 1 ? void openBottle(stocked[0]) : setDialog("open"))}
          >
            {busy && dialog === null ? "Saving…" : "🍷 Open a bottle"}
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

      <section className="card">
        <h2>Tasting notes ({linked.length + likely.length})</h2>
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
        <Modal title="Open a bottle from…" onClose={() => setDialog(null)}>
          <div className="choice-list">
            {stocked.map((l) => (
              <button key={l} className="choice" disabled={busy} onClick={() => void openBottle(l)}>
                <strong>{l}</strong>
                <span className="muted">{bottles(at(l))}</span>
              </button>
            ))}
          </div>
        </Modal>
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
    <div className="tasting-row">
      <div className="tasting-meta">
        <strong>{t.score ?? "–"}</strong>
        <span className="muted">{t.dateTasted ?? t.yearTasted}</span>
        {t.source && <span className="muted">· {t.source}</span>}
      </div>
      {t.nose && <p className="tasting-text"><span className="muted">Nose:</span> {t.nose}</p>}
      {t.taste && t.taste !== t.nose && <p className="tasting-text"><span className="muted">Palate:</span> {t.taste}</p>}
      {t.note && <p className="tasting-text">{t.note}</p>}
    </div>
  );
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
