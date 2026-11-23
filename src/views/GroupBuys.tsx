import { useMemo, useState } from "react";
import { config } from "../config";
import { formatPrice, shortName, type Cell } from "../data";
import { changeGroupBuy, today } from "../groupbuys";
import { friends, groupOrders, isMe, ME, orderTitle, personKey, totals, type GbLine, type GbOrder, type GbPerson } from "../groupbuymodel";
import { addWine, adjustBottles, moveBottles, updateWine } from "../inventory";
import { LOCATIONS, type Location } from "../locations";
import { go, href } from "../router";
import { placementOf } from "../spots";
import { describeError, useWorkbook } from "../store";
import { bottles, Modal, useToast } from "../ui";
import { NEW_LOOSE, SpotSelect, useResolveSpot } from "./SpotPicker";
import { logPurchases, purchaseRow } from "../purchases";
import { todayIso } from "../notesmodel";

const money = (n: number) => formatPrice(Math.round(n * 100) / 100, config.currency);
const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "No date";
const lineName = (l: Pick<GbLine, "producer" | "name" | "vintage">) =>
  [l.producer, shortName({ producer: l.producer, name: l.name }), l.vintage].filter((x) => x !== null && x !== "").join(" ");

export default function GroupBuys({ view, arg }: { view?: string; arg?: string }) {
  if (view === "order" && arg) return <OrderView id={arg} />;
  if (view === "person" && arg) return <PersonView name={arg} />;
  return <Overview />;
}

/** Runs a group buy write and puts the rows it returns into the app. */
function useGroupWrite() {
  const { data, putGroupBuys } = useWorkbook();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (change: Parameters<typeof changeGroupBuy>[1], message?: string) => {
    setBusy(true);
    try {
      putGroupBuys(await changeGroupBuy(data.file.id, change));
      if (message) toast({ text: message });
      return true;
    } catch (e) {
      toast({ text: describeError(e), error: true });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// Kept while you move around.
let tab: "orders" | "people" = "orders";

function Overview() {
  const { data } = useWorkbook();
  const orders = useMemo(() => groupOrders(data.groupBuys), [data.groupBuys]);
  const fs = useMemo(() => friends(orders), [orders]);
  const t = totals(orders);
  const [which, setWhich] = useState(tab);
  const pick = (w: typeof tab) => setWhich((tab = w));

  return (
    <>
      <div className="card-head">
        <h2 className="st-title">Group Buys</h2>
        <button className="primary small" onClick={() => go("purchase/group")}>+ New Group Buy</button>
      </div>
      {orders.length === 0 ? (
        <section className="card">
          <p>No Group Buys yet. Use <strong>+ New Group Buy</strong> (or turn on "Group Buy" in Add purchase) to split an order with friends.</p>
        </section>
      ) : (
        <>
          <div className="gb-tiles">
            <div className="gb-tile">
              <span className="muted small">Owed to you</span>
              <b>{money(t.owed)}</b>
            </div>
            <div className="gb-tile">
              <span className="muted small">To hand over</span>
              <b>{bottles(t.waiting).replace(" bottles", " btl").replace(" bottle", " btl")}</b>
              {t.waiting > 0 && <span className="muted small">{t.ready} with you now</span>}
            </div>
          </div>
          <div className="seg gb-tabs">
            <button className={which === "orders" ? "on" : ""} onClick={() => pick("orders")}>Orders</button>
            <button className={which === "people" ? "on" : ""} onClick={() => pick("people")}>People</button>
          </div>
          {which === "orders"
            ? orders.map((o) => (
                <a key={o.id} className="card gb-order" href={href(`groupbuys/order/${encodeURIComponent(o.id)}`)}>
                  <div className="gb-row">
                    <strong>{orderTitle(o)}</strong>
                    <span className="muted small">{money(o.total)}</span>
                  </div>
                  <span className="muted small">{[o.name ? o.merchant : "", fmtDate(o.date)].filter(Boolean).join(" · ")}</span>
                  {o.done ? (
                    <span className="ok small">✓ All done</span>
                  ) : (
                    <span className="gb-prog small">
                      <span>Arrived <b>{o.arrivedLines}/{o.lines.length}</b></span>
                      <span>Paid <b>{o.paidPeople}/{o.people.length}</b></span>
                      <span>Handed <b>{o.handedPeople}/{o.people.length}</b></span>
                    </span>
                  )}
                </a>
              ))
            : fs.map((f) => (
                <a key={f.name} className="card gb-order" href={href(`groupbuys/person/${encodeURIComponent(f.name)}`)}>
                  <div className="gb-row">
                    <strong>{f.name}</strong>
                    <span className="muted small">
                      {f.owes > 0 || f.waiting > 0
                        ? [f.owes > 0 ? `owes ${money(f.owes)}` : "", f.waiting > 0 ? `${f.waiting} btl waiting${f.ready ? ` (${f.ready} with you)` : ""}` : ""].filter(Boolean).join(" · ")
                        : "✓ settled"}
                    </span>
                  </div>
                </a>
              ))}
        </>
      )}
    </>
  );
}

function OrderView({ id }: { id: string }) {
  const { data } = useWorkbook();
  const o = useMemo(() => groupOrders(data.groupBuys).find((x) => x.id === id), [data.groupBuys, id]);
  const [arriving, setArriving] = useState<GbLine | null>(null);
  const [editing, setEditing] = useState<GbLine | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const { busy, run } = useGroupWrite();
  if (!o) {
    return (
      <section className="card">
        <p>That Group Buy wasn't found.</p>
        <a href={href("groupbuys")}>← Group Buys</a>
      </section>
    );
  }
  const unArrive = (l: GbLine) =>
    run({ set: l.rows.map((r) => ({ rowId: r.rowId, cells: { Arrived: "", "Arrived Date": "" } })) }, "Marked as not arrived. Your cellar wasn't changed.");

  return (
    <>
      <a className="back" href={href("groupbuys")}>← Group Buys</a>
      {renaming !== null ? (
        <div className="split-new gb-rename">
          <input value={renaming} autoFocus placeholder="e.g. Burgundy 2021 release" onChange={(e) => setRenaming(e.target.value)} />
          <button
            className="primary small"
            disabled={busy}
            onClick={async () => {
              if (await run({ set: o.lines.flatMap((l) => l.rows).map((r) => ({ rowId: r.rowId, cells: { "Group Name": renaming.trim() } })) }, "Renamed.")) setRenaming(null);
            }}
          >
            Save
          </button>
          <button className="link" onClick={() => setRenaming(null)}>Cancel</button>
        </div>
      ) : (
        <div className="card-head">
          <h2 className="st-title">{orderTitle(o)}</h2>
          <button className="link small" onClick={() => setRenaming(o.name)}>✎ {o.name ? "Rename" : "Name it"}</button>
        </div>
      )}
      <p className="muted small gb-sub">
        {[o.merchant, fmtDate(o.date), money(o.total)].filter(Boolean).join(" · ")}
      </p>

      <section className="card">
        <h3 className="gb-h">Arrived with you</h3>
        {o.lines.map((l) => (
          <div key={l.line} className="gb-line">
            <div className="gb-line-text">
              <span>{lineName(l)} <span className="muted">· {l.bottles}</span></span>
              <span className="muted small">
                {l.rows.filter((r) => r.bottles > 0).map((r) => `${isMe(r.person) ? "Me" : r.person} ${r.bottles}`).join(" · ")}
                {l.price !== null && ` · ${money(l.price)} each`}
              </span>
              <button className="link small gb-edit" disabled={busy} onClick={() => setEditing(l)}>Edit split</button>
            </div>
            <button
              className={`gb-tick${l.arrived ? " on" : ""}`}
              disabled={busy}
              aria-pressed={l.arrived}
              onClick={() => (l.arrived ? void unArrive(l) : l.mine > 0 && l.wineId ? setArriving(l) : void run({ set: l.rows.map((r) => ({ rowId: r.rowId, cells: { Arrived: "Yes", "Arrived Date": today() } })) }, "Marked as arrived."))}
            >
              {l.arrived ? "✓ Arrived" : "Arrived?"}
            </button>
          </div>
        ))}
        <p className="muted small">Ticking “Arrived” on a wine you have a share of also marks your bottles as arrived in your cellar.</p>
      </section>

      {o.people.map((p) => <PersonShare key={p.name} order={o} person={p} />)}

      <section className="card gb-me">
        <div className="gb-row">
          <strong>Me</strong>
          <span className="muted small">{o.me.bottles ? `${bottles(o.me.bottles)} · ${money(o.me.amount)} · in your cellar` : "no bottles for you"}</span>
        </div>
      </section>

      {arriving && <ArriveShare order={o} line={arriving} onClose={() => setArriving(null)} />}
      {editing && <EditSplit order={o} line={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** One friend's share of an order: what they're getting, what they owe, and the Paid / Handed over ticks. */
function PersonShare({ order, person: p, showOrder }: { order: GbOrder; person: GbPerson; showOrder?: boolean }) {
  const { busy, run } = useGroupWrite();
  const rows = p.rows.filter((r) => r.bottles > 0);
  const lineOf = (n: number) => order.lines.find((l) => l.line === n);
  const setPaid = (paid: boolean) =>
    run({ set: p.rows.map((r) => ({ rowId: r.rowId, cells: { Paid: paid ? "Yes" : "", "Paid Date": paid ? today() : "" } })) }, paid ? `${p.name} has paid.` : undefined);
  const handOver = () =>
    run(
      { set: p.rows.filter((r) => r.arrived && !r.handed).map((r) => ({ rowId: r.rowId, cells: { Handed: "Yes", "Handed Date": today() } })) },
      `Handed ${bottles(p.ready)} to ${p.name}.`,
    );
  const unHand = () => run({ set: p.rows.filter((r) => r.handed).map((r) => ({ rowId: r.rowId, cells: { Handed: "", "Handed Date": "" } })) });
  const allHanded = p.handed === p.bottles;
  return (
    <section className="card gb-person">
      <div className="gb-row">
        <strong>{showOrder ? <a href={href(`groupbuys/order/${encodeURIComponent(order.id)}`)}>{orderTitle(order)} · {fmtDate(order.date)}</a> : <a href={href(`groupbuys/person/${encodeURIComponent(p.name)}`)}>{p.name}</a>}</strong>
        <span className="muted small">{bottles(p.bottles)} · {money(p.amount)}{p.unpriced ? " + unpriced" : ""}</span>
      </div>
      <div className="muted small gb-wines">
        {rows.map((r) => {
          const l = lineOf(r.line);
          const state = r.handed ? "handed over" : r.arrived ? "with you" : "not arrived";
          return (
            <span key={r.rowId}>
              {l ? lineName(l) : r.name} ×{r.bottles} <em>({state})</em>
            </span>
          );
        })}
      </div>
      <div className="gb-actions">
        <button className={`gb-tick${p.paid ? " on" : ""}`} disabled={busy} aria-pressed={p.paid} onClick={() => void setPaid(!p.paid)}>
          {p.paid ? "✓ Paid" : "Paid?"}
        </button>
        {allHanded ? (
          <button className="gb-tick on" disabled={busy} onClick={() => void unHand()} title="Tap to undo">✓ Handed over</button>
        ) : p.ready > 0 ? (
          <button className="gb-tick" disabled={busy} onClick={() => void handOver()}>Hand over {p.ready} arrived</button>
        ) : (
          <span className="muted small">{p.handed ? `${p.handed} handed over · ` : ""}{p.coming} not arrived yet</span>
        )}
      </div>
    </section>
  );
}

function PersonView({ name }: { name: string }) {
  const { data } = useWorkbook();
  const orders = useMemo(() => groupOrders(data.groupBuys), [data.groupBuys]);
  const mine = orders.map((o) => ({ o, p: o.people.find((x) => personKey(x.name) === personKey(name)) })).filter((x): x is { o: GbOrder; p: GbPerson } => !!x.p);
  const open = mine.filter((x) => !x.p.paid || x.p.handed < x.p.bottles);
  const done = mine.filter((x) => x.p.paid && x.p.handed === x.p.bottles);
  const f = friends(orders).find((x) => personKey(x.name) === personKey(name));
  return (
    <>
      <a className="back" href={href("groupbuys")}>← Group Buys</a>
      <div className="card-head">
        <h2 className="st-title">{f?.name ?? name}</h2>
        <span className="muted small">{f && (f.owes > 0 || f.waiting > 0) ? [f.owes > 0 ? `owes ${money(f.owes)}` : "", f.waiting ? `${f.waiting} btl waiting` : ""].filter(Boolean).join(" · ") : "✓ settled"}</span>
      </div>
      {open.length === 0 && <p className="muted">Nothing outstanding.</p>}
      {open.map(({ o, p }) => <PersonShare key={o.id} order={o} person={p} showOrder />)}
      {done.length > 0 && (
        <details className="card">
          <summary>Settled ({done.length})</summary>
          {done.map(({ o, p }) => (
            <div key={o.id} className="gb-row gb-done">
              <a href={href(`groupbuys/order/${encodeURIComponent(o.id)}`)}>{orderTitle(o)} · {fmtDate(o.date)}</a>
              <span className="muted small">{bottles(p.bottles)} · {money(p.amount)}</span>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

/** A wine with your share arrived: where your bottles went, then mark it arrived (cellar too). */
function ArriveShare({ order, line, onClose }: { order: GbOrder; line: GbLine; onClose: () => void }) {
  const { data, putWine } = useWorkbook();
  const resolveSpot = useResolveSpot();
  const { busy, run } = useGroupWrite();
  const from: Location = line.to ?? "K Cellars";
  const [loc, setLoc] = useState<Location>(from);
  const [spot, setSpot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wine = data.wines.find((w) => w.wineId === line.wineId);

  async function save() {
    setError(null);
    try {
      if (wine) {
        const s = await resolveSpot(spot);
        // Your bottles were added (not placed) at the purchase's location; move them if they went elsewhere.
        const n = Math.min(line.mine, placementOf(wine, from).unplaced);
        if (n > 0 && (loc !== from || s)) {
          const [w] = await moveBottles(data.file.id, [{ wineId: wine.wineId!, from: { loc: from, spot: null }, to: { loc, spot: s }, n }]);
          putWine(w);
        }
        if ((wine.status ?? "").toUpperCase() === "NYA") putWine(await updateWine(data.file.id, wine.wineId!, { Status: "" }));
      }
      const ok = await run({ set: line.rows.map((r) => ({ rowId: r.rowId, cells: { Arrived: "Yes", "Arrived Date": today() } })) }, `${lineName(line)} arrived.`);
      if (ok) onClose();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <Modal title="Where are your bottles?" onClose={onClose}>
      <p className="muted small">
        {lineName(line)}: your {bottles(line.mine)} from {orderTitle(order)}.
      </p>
      <div className="seg">
        {LOCATIONS.map((l) => (
          <button key={l} className={l === loc ? "on" : ""} onClick={() => { setLoc(l); setSpot(null); }}>{l}</button>
        ))}
      </div>
      <SpotSelect loc={loc} value={spot} onChange={setSpot} />
      {error && <p className="form-errors">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : `✓ Arrived${spot && spot !== NEW_LOOSE ? ` · ${loc} ${spot}` : ` at ${loc}`}`}
        </button>
      </div>
    </Modal>
  );
}

/** Change who takes how many of one wine. Your own share changes your cellar too. */
function EditSplit({ order, line, onClose }: { order: GbOrder; line: GbLine; onClose: () => void }) {
  const { data, putWine, putPurchases } = useWorkbook();
  const toast = useToast();
  const { busy, run } = useGroupWrite();
  const start = useMemo(() => {
    const m: Record<string, number> = { [ME]: 0 };
    for (const r of line.rows) m[isMe(r.person) ? ME : r.person] = (m[isMe(r.person) ? ME : r.person] ?? 0) + r.bottles;
    return m;
  }, [line]);
  const [split, setSplit] = useState(start);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const names = [ME, ...Object.keys(split).filter((k) => !isMe(k))];
  const total = Object.values(split).reduce((s, n) => s + n, 0);

  async function save() {
    setError(null);
    const to: Location = line.to ?? "K Cellars";
    const delta = (split[ME] ?? 0) - (start[ME] ?? 0);
    try {
      let wineId = line.wineId;
      let bought: Record<string, Cell> | null = null;
      // Your share changed: the cellar follows.
      if (delta !== 0) {
        let changed = null;
        if (wineId) {
          changed = await adjustBottles(data.file.id, wineId, { [to]: delta });
          putWine(changed);
        } else if (delta > 0) {
          changed = await addWine(
            data.file.id,
            { Producer: line.producer ?? "", Name: line.name ?? "", Vintage: line.vintage ?? "", Price: line.price ?? "", Source: order.merchant, Status: line.arrived ? "" : "NYA" },
            { kc: to === "K Cellars" ? delta : 0, home: to === "Home" ? delta : 0 },
          );
          putWine(changed);
          wineId = changed.wineId;
        }
        // Your purchase grew or shrank: dated with the order, so its month stays right.
        if (changed) {
          bought = purchaseRow(changed, {
            date: order.date ?? todayIso(), bottles: delta, price: line.price, source: order.merchant, to, groupBuy: order.name || order.id,
          });
        }
      }
      const set: { rowId: string; cells: Record<string, Cell> }[] = [];
      const remove: string[] = [];
      const add: Record<string, Cell>[] = [];
      const first = line.rows[0];
      const newRow = (who: string, n: number): Record<string, Cell> => ({
        GroupID: order.id, "Order Date": first.date ? excelDate(first.date) : today(), Merchant: order.merchant, Line: line.line,
        WineID: wineId ?? "", Producer: line.producer ?? "", Name: line.name ?? "", Vintage: line.vintage ?? "", Price: line.price ?? "",
        Person: who, Bottles: n, To: isMe(who) ? to : "", Arrived: line.arrived ? "Yes" : "", "Arrived Date": line.arrived ? today() : "",
      });
      for (const [who, n] of Object.entries(split)) {
        const rows = line.rows.filter((r) => (isMe(who) ? isMe(r.person) : personKey(r.person) === personKey(who)));
        const have = rows.reduce((s, r) => s + r.bottles, 0);
        if (n > have) {
          // Extra bottles start unpaid and not handed over: a row of their own if the existing one is ticked.
          const open = rows.find((r) => !r.paid && !r.handed);
          if (open) set.push({ rowId: open.rowId, cells: { Bottles: open.bottles + n - have } });
          else add.push(newRow(who, n - have));
        } else if (n < have) {
          // Fewer: take them off unticked rows first.
          let cut = have - n;
          for (const r of [...rows].sort((a, b) => Number(a.paid || a.handed) - Number(b.paid || b.handed))) {
            if (cut <= 0) break;
            const k = Math.min(cut, r.bottles);
            cut -= k;
            if (k === r.bottles) remove.push(r.rowId);
            else set.push({ rowId: r.rowId, cells: { Bottles: r.bottles - k } });
          }
        }
      }
      // A new cellar wine: link every row of this wine to it.
      if (wineId && wineId !== line.wineId) {
        for (const r of line.rows) {
          if (remove.includes(r.rowId)) continue;
          const s = set.find((x) => x.rowId === r.rowId);
          if (s) s.cells.WineID = wineId;
          else set.push({ rowId: r.rowId, cells: { WineID: wineId } });
        }
      }
      const ok = await run({ set, add, remove }, "Split updated.");
      if (ok) onClose();
      if (bought) {
        try {
          putPurchases(await logPurchases(data.file.id, [bought]));
        } catch (e) {
          toast({ text: `Split updated, but the purchase log couldn't be: ${describeError(e)}`, error: true });
        }
      }
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <Modal title={`Split: ${lineName(line)}`} onClose={onClose}>
      <div className="split-chips">
        {names.map((who) => (
          <span key={who} className={`split-chip${isMe(who) ? " me" : ""}`}>
            <b>{who}</b>
            <button type="button" disabled={(split[who] ?? 0) <= 0} onClick={() => setSplit({ ...split, [who]: (split[who] ?? 0) - 1 })} aria-label={`One fewer for ${who}`}>−</button>
            <span>{split[who] ?? 0}</span>
            <button type="button" onClick={() => setSplit({ ...split, [who]: (split[who] ?? 0) + 1 })} aria-label={`One more for ${who}`}>+</button>
          </span>
        ))}
      </div>
      <div className="split-new">
        <input value={name} placeholder="Add a person" onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          className="small"
          disabled={!name.trim() || isMe(name) || names.some((n) => n.toLowerCase() === name.trim().toLowerCase())}
          onClick={() => {
            setSplit({ ...split, [name.trim()]: 1 });
            setName("");
          }}
        >
          Add
        </button>
      </div>
      <p className="muted small">
        {total} bottle{total === 1 ? "" : "s"} in all (was {line.bottles}).
        {(split[ME] ?? 0) !== (start[ME] ?? 0) && ` Your cellar changes by ${(split[ME] ?? 0) - (start[ME] ?? 0) > 0 ? "+" : ""}${(split[ME] ?? 0) - (start[ME] ?? 0)}.`}
      </p>
      {error && <p className="form-errors">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save split"}</button>
      </div>
    </Modal>
  );
}

const excelDate = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
