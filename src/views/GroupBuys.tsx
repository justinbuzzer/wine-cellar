import { useEffect, useMemo, useState } from "react";
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
/** "23 Nov" this year, "23 Nov 2025" otherwise. */
const fmtShort = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-SG", {
        day: "numeric",
        month: "short",
        ...(iso.slice(0, 4) === String(new Date().getFullYear()) ? {} : { year: "numeric" }),
      })
    : "No date";
const lineName = (l: Pick<GbLine, "producer" | "name" | "vintage">) =>
  [l.producer, shortName({ producer: l.producer, name: l.name }), l.vintage].filter((x) => x !== null && x !== "").join(" ");

export default function GroupBuys({ view, arg }: { view?: string; arg?: string }) {
  // Links to an order or a person open its card on the Group Buys page.
  if (view === "order" && arg) return <Overview focusOrder={arg} />;
  if (view === "person" && arg) return <Overview focusPerson={arg} />;
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

// Kept while you move around: the tab, and which orders' and people's cards are open.
let tab: "orders" | "people" = "orders";
let openOrders = new Set<string>();
let openPeople = new Set<string>();

function useToggleSet(initial: () => Set<string>, keep: (s: Set<string>) => void): [Set<string>, (k: string) => void] {
  const [set, setSet] = useState(initial);
  const toggle = (k: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      keep(next);
      return next;
    });
  return [set, toggle];
}

function Overview({ focusOrder, focusPerson }: { focusOrder?: string; focusPerson?: string }) {
  const { data } = useWorkbook();
  const orders = useMemo(() => groupOrders(data.groupBuys), [data.groupBuys]);
  const fs = useMemo(() => friends(orders), [orders]);
  const t = totals(orders);
  const [which, setWhich] = useState(() => (focusPerson ? (tab = "people") : focusOrder ? (tab = "orders") : tab));
  const pick = (w: typeof tab) => setWhich((tab = w));
  const [openO, toggleO] = useToggleSet(
    () => (focusOrder ? (openOrders = new Set([...openOrders, focusOrder])) : openOrders),
    (n) => (openOrders = n),
  );
  const [openP, toggleP] = useToggleSet(
    () => (focusPerson ? (openPeople = new Set([...openPeople, personKey(focusPerson)])) : openPeople),
    (n) => (openPeople = n),
  );
  // Opened from a link to one order or person: bring their card into view.
  useEffect(() => {
    const id = focusOrder ? `gb-o-${focusOrder}` : focusPerson ? `gb-p-${personKey(focusPerson)}` : null;
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [focusOrder, focusPerson]);

  return (
    <>
      {/* One row: what you're owed, what's to hand over, Orders / People, and + New. */}
      <div className="gb-bar">
        {orders.length > 0 && (
          <>
            <span className="gb-stat" title="Owed to you by friends who haven't paid">
              <b>{money(t.owed)}</b>
              <i>owed to you</i>
            </span>
            <span className="gb-stat" title={`${t.waiting} bottles to hand over${t.waiting ? `, ${t.ready} of them with you now` : ""}`}>
              <b>{t.waiting} btl</b>
              <i>to hand over</i>
            </span>
            <div className="seg gb-tabs" role="group" aria-label="Show">
              <button className={which === "orders" ? "on" : ""} onClick={() => pick("orders")}>Orders</button>
              <button className={which === "people" ? "on" : ""} onClick={() => pick("people")}>People</button>
            </div>
          </>
        )}
        <button className="primary small gb-new" onClick={() => go("purchase/group")} aria-label="New Group Buy" title="New Group Buy">
          {orders.length > 0 ? "+ New" : "+ New Group Buy"}
        </button>
      </div>
      {orders.length === 0 ? (
        <section className="card">
          <p>No Group Buys yet. Use <strong>+ New Group Buy</strong> (or turn on "Group Buy" in Add purchase) to split an order with friends.</p>
        </section>
      ) : which === "orders" ? (
        orders.map((o) => {
          const isOpen = openO.has(o.id);
          return (
            <section key={o.id} id={`gb-o-${o.id}`} className={`card gb-order gb-person-card${isOpen ? " open" : ""}`}>
              <button type="button" className="gb-person-head gb-order-row" aria-expanded={isOpen} onClick={() => toggleO(o.id)}>
                <span className="gb-order-text">
                  <strong>{orderTitle(o)}</strong>
                  <span className="muted small">{[o.name ? o.merchant : "", fmtShort(o.date), money(o.total)].filter(Boolean).join(" · ")}</span>
                </span>
                {o.done ? (
                  <span className="gb-alldone">✓ All done</span>
                ) : (
                  <span className="gb-counts">
                    <Count label="Arrived" n={o.arrivedLines} of={o.lines.length} />
                    <Count label="Paid" n={o.paidPeople} of={o.people.length} />
                    <Count label="Handed" n={o.handedPeople} of={o.people.length} />
                  </span>
                )}
                <span className="gb-chev" aria-hidden="true">▾</span>
              </button>
              {isOpen && <OrderDetail order={o} />}
            </section>
          );
        })
      ) : (
        fs.map((f) => {
          const k = personKey(f.name);
          const isOpen = openP.has(k);
          return (
            <section key={f.name} id={`gb-p-${k}`} className={`card gb-order gb-person-card${isOpen ? " open" : ""}`}>
              <button type="button" className="gb-row gb-person-head" aria-expanded={isOpen} onClick={() => toggleP(k)}>
                <strong>{f.name}</strong>
                <span className="muted small">
                  {f.owes > 0 || f.waiting > 0
                    ? [f.owes > 0 ? `owes ${money(f.owes)}` : "", f.waiting > 0 ? `${f.waiting} btl waiting${f.ready ? ` (${f.ready} with you)` : ""}` : ""].filter(Boolean).join(" · ")
                    : "✓ settled"}
                  <span className="gb-chev" aria-hidden="true">▾</span>
                </span>
              </button>
              {isOpen && <PersonDetail name={f.name} orders={orders} />}
            </section>
          );
        })
      )}
    </>
  );
}

/** One step of an order: "Paid 2/4", or a gold ✓ once everyone has. */
function Count({ label, n, of }: { label: string; n: number; of: number }) {
  const done = of > 0 && n >= of;
  return (
    <span className="gb-count" title={`${label}: ${n} of ${of}`}>
      <i>{label}</i>
      {of === 0 ? <b className="muted">–</b> : done ? <b className="ok-gold" aria-label="done">✓</b> : <b>{n}/{of}</b>}
    </span>
  );
}

/** Inside an order's expanded card: name it, mark wines arrived, change the split, and each friend's Paid / Hand over. */
function OrderDetail({ order: o }: { order: GbOrder }) {
  const [arriving, setArriving] = useState<GbLine | null>(null);
  const [editing, setEditing] = useState<GbLine | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const { busy, run } = useGroupWrite();
  const unArrive = (l: GbLine) =>
    run({ set: l.rows.map((r) => ({ rowId: r.rowId, cells: { Arrived: "", "Arrived Date": "" } })) }, "Marked as not arrived. Your cellar wasn't changed.");

  return (
    <div className="gb-order-body">
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
        <div className="gb-row gb-order-tools">
          <span className="gb-h">Arrived with you</span>
          <button className="link small" onClick={() => setRenaming(o.name)}>✎ {o.name ? "Rename" : "Name it"}</button>
        </div>
      )}
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
            title={l.mine > 0 ? "Also marks your bottles as arrived in your cellar" : undefined}
            onClick={() => (l.arrived ? void unArrive(l) : l.mine > 0 && l.wineId ? setArriving(l) : void run({ set: l.rows.map((r) => ({ rowId: r.rowId, cells: { Arrived: "Yes", "Arrived Date": today() } })) }, "Marked as arrived."))}
          >
            {l.arrived ? "✓ Arrived" : "Arrived?"}
          </button>
        </div>
      ))}

      {o.people.map((p) => <PersonShare key={p.name} order={o} person={p} flat />)}

      <div className="gb-row gb-me-row">
        <strong>Me</strong>
        <span className="muted small">{o.me.bottles ? `${bottles(o.me.bottles)} · ${money(o.me.amount)} · in your cellar` : "no bottles for you"}</span>
      </div>

      {arriving && <ArriveShare order={o} line={arriving} onClose={() => setArriving(null)} />}
      {editing && <EditSplit order={o} line={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** One friend's share of an order: what they're getting, what they owe, and the Paid / Handed over ticks. */
function PersonShare({ order, person: p, showOrder, flat }: { order: GbOrder; person: GbPerson; showOrder?: boolean; flat?: boolean }) {
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
  const stateOf = (r: (typeof rows)[number]) => (r.handed ? "handed over" : r.arrived ? "with you" : "not arrived");
  const mixed = new Set(rows.map(stateOf)).size > 1;
  return (
    <section className={`gb-person${flat ? " flat" : " card"}`}>
      <div className="gb-share-row">
        <strong className="gb-share-title">{showOrder ? <a href={href(`groupbuys/order/${encodeURIComponent(order.id)}`)}>{orderTitle(order)} · {fmtShort(order.date)}</a> : <a href={href(`groupbuys/person/${encodeURIComponent(p.name)}`)}>{p.name}</a>}</strong>
        <span className="gb-share-top">
          <span className="muted small">{p.bottles} btl · {money(p.amount)}{p.unpriced ? " + unpriced" : ""}</span>
          <button className={`gb-tick${p.paid ? " on" : ""}`} disabled={busy} aria-pressed={p.paid} onClick={() => void setPaid(!p.paid)}>
            {p.paid ? "✓ Paid" : "Paid?"}
          </button>
        </span>
      </div>
      <div className="gb-share-row">
        <div className="muted small gb-wines">
          {rows.map((r) => {
            const l = lineOf(r.line);
            const state = stateOf(r);
            return (
              <span key={r.rowId}>
                {l ? lineName(l) : r.name} ×{r.bottles}
                {/* Each wine's state only when they differ (the right side already says it otherwise). */}
                {mixed && <em> ({state})</em>}
              </span>
            );
          })}
        </div>
        <span className="gb-share-status">
          {allHanded ? (
            <button className="gb-tick on" disabled={busy} onClick={() => void unHand()} title="Tap to undo">✓ Handed over</button>
          ) : p.ready > 0 ? (
            <button className="gb-tick" disabled={busy} onClick={() => void handOver()}>Hand over {p.ready}</button>
          ) : (
            <span className="muted small">{p.handed ? `${p.handed} handed · ` : ""}{p.coming} not arrived yet</span>
          )}
        </span>
      </div>
    </section>
  );
}

/** Inside a person's expanded card: their open orders (with Paid / Hand over), then settled ones. */
function PersonDetail({ name, orders }: { name: string; orders: GbOrder[] }) {
  const mine = orders.map((o) => ({ o, p: o.people.find((x) => personKey(x.name) === personKey(name)) })).filter((x): x is { o: GbOrder; p: GbPerson } => !!x.p);
  const open = mine.filter((x) => !x.p.paid || x.p.handed < x.p.bottles);
  const done = mine.filter((x) => x.p.paid && x.p.handed === x.p.bottles);
  return (
    <div className="gb-person-body">
      {open.length === 0 && <p className="muted small gb-nothing">Nothing outstanding.</p>}
      {open.map(({ o, p }) => <PersonShare key={o.id} order={o} person={p} showOrder flat />)}
      {done.length > 0 && (
        <div className="gb-settled">
          <span className="muted small">Settled</span>
          {done.map(({ o, p }) => (
            <div key={o.id} className="gb-row gb-done">
              <a href={href(`groupbuys/order/${encodeURIComponent(o.id)}`)}>{orderTitle(o)} · {fmtShort(o.date)}</a>
              <span className="muted small">{bottles(p.bottles)} · {money(p.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
