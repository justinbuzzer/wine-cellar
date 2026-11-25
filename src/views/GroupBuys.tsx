import { useEffect, useMemo, useState } from "react";
import { config } from "../config";
import { formatPrice, norm, shortName, type Cell } from "../data";
import { changeGroupBuy, today } from "../groupbuys";
import { friends, groupOrders, isMe, ME, orderTitle, personKey, totals, type GbLine, type GbOrder, type GbPerson } from "../groupbuymodel";
import { addWine, adjustBottles, moveBottles, updateWine } from "../inventory";
import { LOCATIONS, type Location } from "../locations";
import { go, href } from "../router";
import { placementOf } from "../spots";
import { describeError, useWorkbook } from "../store";
import { bottles, Modal, useToast } from "../ui";
import { NEW_LOOSE, SpotSelect, useResolveSpot } from "./SpotPicker";
import { changePurchases, logPurchases, purchaseRow } from "../purchases";
import { excelSerial, todayIso } from "../notesmodel";

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
  const [arriving, setArriving] = useState<GbLine[] | null>(null);
  const [editing, setEditing] = useState(false);
  /** Once every wine has arrived the list shrinks to a record; this shows the full rows again. */
  const [showWines, setShowWines] = useState(false);
  const { busy, run } = useGroupWrite();
  const waiting = o.lines.filter((l) => !l.arrived);
  const arrivedAll = waiting.length === 0;
  /** Every wine still to arrive, in one go (asks where your bottles went if you have a share). */
  const allArrived = () =>
    waiting.some((l) => l.mine > 0 && l.wineId)
      ? setArriving(waiting)
      : void run(
          { set: waiting.flatMap((l) => l.rows).map((r) => ({ rowId: r.rowId, cells: { Arrived: "Yes", "Arrived Date": today() } })) },
          `All ${waiting.length} wines arrived.`,
        );
  const unArrive = (l: GbLine) =>
    run({ set: l.rows.map((r) => ({ rowId: r.rowId, cells: { Arrived: "", "Arrived Date": "" } })) }, "Marked as not arrived. Your cellar wasn't changed.");

  return (
    <div className="gb-order-body">
      {waiting.length > 1 && (
        <div className="gb-row gb-all-row">
          <span className="muted small">{waiting.length} wines still to arrive</span>
          <button className="gb-tick gb-pill" disabled={busy} onClick={allArrived}>All arrived</button>
        </div>
      )}
      {arrivedAll && !showWines ? (
        <div className="gb-arrived">
          <div className="gb-row">
            <span className="gb-arrived-tick">✓ All arrived</span>
            <button className="link small" onClick={() => setShowWines(true)}>Edit</button>
          </div>
          <ul className="muted small gb-arrived-list">
            {o.lines.map((l) => <li key={l.line}>{lineName(l)} ×{l.bottles}</li>)}
          </ul>
        </div>
      ) : (
        <>
      {arrivedAll && (
        <div className="gb-row gb-all-row">
          <span className="gb-arrived-tick">✓ All arrived</span>
          <button className="link small" onClick={() => setShowWines(false)}>Done</button>
        </div>
      )}
      {o.lines.map((l) => (
        <div key={l.line} className="gb-line">
          {/* Who gets how many is in each friend's row and the Me line, so here just the wine and its total. */}
          <span className="gb-line-name">{lineName(l)} ×{l.bottles}</span>
          <span className="gb-line-acts">
          <button
            className={`gb-tick gb-pill${l.arrived ? " on" : ""}`}
            disabled={busy}
            aria-pressed={l.arrived}
            title={l.mine > 0 ? "Also marks your bottles as arrived in your cellar" : undefined}
            onClick={() => (l.arrived ? void unArrive(l) : l.mine > 0 && l.wineId ? setArriving([l]) : void run({ set: l.rows.map((r) => ({ rowId: r.rowId, cells: { Arrived: "Yes", "Arrived Date": today() } })) }, "Marked as arrived."))}
          >
            {l.arrived ? "✓ Arrived" : "Arrived?"}
          </button>
          </span>
        </div>
      ))}
        </>
      )}

      {o.people.map((p) => <PersonShare key={p.name} order={o} person={p} flat hideWines={o.lines.length === 1} shrinkWhenDone />)}

      <div className="gb-row gb-me-row">
        <span className="muted small">
          <strong className="gb-me">Me</strong> · {o.me.bottles ? `${o.me.bottles} btl in your cellar` : "no bottles for you"}
        </span>
        <button className="gb-tick gb-pill" disabled={busy} onClick={() => setEditing(true)}>✎ Edit order</button>
      </div>

      {arriving && <ArriveShare order={o} lines={arriving} onClose={() => setArriving(null)} />}
      {editing && <EditOrder order={o} onClose={() => setEditing(false)} />}
    </div>
  );
}

/**
 * One friend's share of an order. Left: their name (in an order) or the order
 * with its amount (on the People tab), and their wines when it's worth listing
 * them. Right: "1/6 arrived" and "0/6 handed" as a block, beside Paid and,
 * when there's something to do, Hand over (✓ Handed once done; tap to undo).
 */
function PersonShare({
  order, person: p, showOrder, flat, hideWines, shrinkWhenDone,
}: { order: GbOrder; person: GbPerson; showOrder?: boolean; flat?: boolean; hideWines?: boolean; shrinkWhenDone?: boolean }) {
  const { busy, run } = useGroupWrite();
  /** Paid and handed over: just "✓ Complete" until tapped. */
  const [opened, setOpened] = useState(false);
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
  const allHanded = p.bottles > 0 && p.handed === p.bottles;
  if (shrinkWhenDone && p.paid && allHanded && !opened) {
    return (
      <section className={`gb-person gb-person-done${flat ? " flat" : " card"}`}>
        <button type="button" className="gb-row gb-person-head" onClick={() => setOpened(true)} title="Paid and handed over. Tap to see it again">
          <span className="gb-share-title">{p.name}</span>
          <span className="gb-arrived-tick">✓ Complete</span>
        </button>
      </section>
    );
  }
  const arrived = p.bottles - p.coming;
  const stateOf = (r: (typeof rows)[number]) => (r.handed ? "handed over" : r.arrived ? "with you" : "not arrived");
  const mixed = new Set(rows.map(stateOf)).size > 1;
  return (
    <section className={`gb-person${flat ? " flat" : " card"}`}>
      <div className="gb-share">
        <div className="gb-share-main">
          {showOrder ? (
            <span className="gb-share-title">
              <a href={href(`groupbuys/order/${encodeURIComponent(order.id)}`)}>{orderTitle(order)} · {fmtShort(order.date)}</a>
              <span className="muted small"> · {money(p.amount)}{p.unpriced ? " + unpriced" : ""}</span>
            </span>
          ) : (
            <a className="gb-share-title" href={href(`groupbuys/person/${encodeURIComponent(p.name)}`)}>{p.name}</a>
          )}
        </div>
        <span className="gb-share-stat muted small">
          <span>{arrived}/{p.bottles} arrived</span>
          <span>{p.handed}/{p.bottles} handed</span>
        </span>
        <span className="gb-share-btns">
          <button className={`gb-tick gb-pill${p.paid ? " on" : ""}`} disabled={busy} aria-pressed={p.paid} onClick={() => void setPaid(!p.paid)}>
            {p.paid ? "✓ Paid" : "Paid?"}
          </button>
          {allHanded ? (
            <button className="gb-tick gb-pill on" disabled={busy} onClick={() => void unHand()} title="Handed over. Tap to undo">✓ Handed</button>
          ) : p.ready > 0 ? (
            <button className="gb-tick gb-pill" disabled={busy} onClick={() => void handOver()}>Hand over {p.ready}</button>
          ) : null}
        </span>
      </div>
      {/* The wines under the top row, full width, so the order name and block beside it stay on one line. */}
      {!hideWines && (
        <div className="muted small gb-wines">
          {rows.map((r) => {
            const l = lineOf(r.line);
            return (
              <span key={r.rowId}>
                {l ? lineName(l) : r.name} ×{r.bottles}
                {/* Each wine's state only when they differ. */}
                {mixed && <em> ({stateOf(r)})</em>}
              </span>
            );
          })}
        </div>
      )}
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

/**
 * Wines arrived (one, or all still to arrive): where your bottles went, then mark
 * them arrived. Your share moves to that place in the cellar and stops being
 * "not yet arrived"; friends' bottles are just marked arrived.
 */
function ArriveShare({ order, lines, onClose }: { order: GbOrder; lines: GbLine[]; onClose: () => void }) {
  const { data, putWine } = useWorkbook();
  const resolveSpot = useResolveSpot();
  const { busy, run } = useGroupWrite();
  const mine = lines.filter((l) => l.mine > 0 && l.wineId);
  const [loc, setLoc] = useState<Location>(mine[0]?.to ?? "K Cellars");
  const [spot, setSpot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const myBottles = mine.reduce((n, l) => n + l.mine, 0);

  async function save() {
    setError(null);
    try {
      const s = await resolveSpot(spot);
      // Your bottles were added (not placed) where the purchase said; move them if they went elsewhere.
      const moves = mine.flatMap((l) => {
        const wine = data.wines.find((w) => w.wineId === l.wineId);
        const from: Location = l.to ?? "K Cellars";
        const n = wine ? Math.min(l.mine, placementOf(wine, from).unplaced) : 0;
        return n > 0 && (loc !== from || s) ? [{ wineId: l.wineId!, from: { loc: from, spot: null }, to: { loc, spot: s }, n }] : [];
      });
      if (moves.length) for (const w of await moveBottles(data.file.id, moves)) putWine(w);
      for (const l of mine) {
        const wine = data.wines.find((w) => w.wineId === l.wineId);
        if (wine && (wine.status ?? "").toUpperCase() === "NYA") putWine(await updateWine(data.file.id, wine.wineId!, { Status: "" }));
      }
      const ok = await run(
        { set: lines.flatMap((l) => l.rows).map((r) => ({ rowId: r.rowId, cells: { Arrived: "Yes", "Arrived Date": today() } })) },
        lines.length === 1 ? `${lineName(lines[0])} arrived.` : `All ${lines.length} wines arrived.`,
      );
      if (ok) onClose();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <Modal title="Where are your bottles?" onClose={onClose}>
      <p className="muted small">
        {lines.length === 1
          ? `${lineName(lines[0])}: your ${bottles(myBottles)} from ${orderTitle(order)}.`
          : `Your ${bottles(myBottles)} of ${mine.length} wine${mine.length === 1 ? "" : "s"} from ${orderTitle(order)}. All ${lines.length} wines will be marked arrived.`}
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
          {busy ? "Saving…" : `✓ ${lines.length === 1 ? "Arrived" : "All arrived"}${spot && spot !== NEW_LOOSE ? ` · ${loc} ${spot}` : ` at ${loc}`}`}
        </button>
      </div>
    </Modal>
  );
}

/** Change who takes how many of one wine. Your own share changes your cellar too. */
/**
 * Edit a whole order in one sheet: its name, merchant and date, and each wine's
 * price and split. Your share follows into your cellar and Purchases log (as
 * Edit split did); friends' paid and handed ticks stay on their existing bottles.
 */
function EditOrder({ order, onClose }: { order: GbOrder; onClose: () => void }) {
  const { data, putWine, putPurchases } = useWorkbook();
  const toast = useToast();
  const { run } = useGroupWrite();
  const starts = useMemo(
    () =>
      order.lines.map((line) => {
        const m: Record<string, number> = { [ME]: 0 };
        for (const r of line.rows) m[isMe(r.person) ? ME : r.person] = (m[isMe(r.person) ? ME : r.person] ?? 0) + r.bottles;
        return m;
      }),
    [order],
  );
  const [name, setName] = useState(order.name);
  const [merchant, setMerchant] = useState(order.merchant);
  const [date, setDate] = useState(order.date ?? "");
  const [prices, setPrices] = useState(order.lines.map((l) => (l.price === null ? "" : String(l.price))));
  const [splits, setSplits] = useState(starts);
  const [adding, setAdding] = useState<{ i: number; who: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const known = useMemo(() => [...new Set(data.groupBuys.map((r) => r.person).filter((x) => x && !isMe(x)))].sort(), [data.groupBuys]);
  const priceOf = (s: string): number | null => {
    const t = s.replace(/[^0-9.]/g, "");
    return t && Number.isFinite(Number(t)) ? Math.round(Number(t) * 100) / 100 : null;
  };
  const bump = (i: number, who: string, by: number) =>
    setSplits((ss) => ss.map((s, k) => (k === i ? { ...s, [who]: Math.max(0, (s[who] ?? 0) + by) } : s)));
  const sum = (s: Record<string, number>) => Object.values(s).reduce((a, n) => a + n, 0);
  const myTotal = splits.reduce((a, s) => a + (s[ME] ?? 0), 0);
  const friendTotal = splits.reduce((a, s) => a + sum(s) - (s[ME] ?? 0), 0);

  async function save() {
    setError(null);
    const newName = name.trim();
    const newMerchant = merchant.trim() || order.merchant;
    const newDate = date || order.date || "";
    const orderCells: Record<string, Cell> = {};
    if (newName !== order.name) orderCells["Group Name"] = newName;
    if (newMerchant !== order.merchant) orderCells.Merchant = newMerchant;
    if (newDate && newDate !== order.date) orderCells["Order Date"] = excelDate(newDate);
    const groupName = newName || order.id;
    const boughtOn = newDate || todayIso();

    const set = new Map<string, Record<string, Cell>>();
    const put = (rowId: string, cells: Record<string, Cell>) => set.set(rowId, { ...(set.get(rowId) ?? {}), ...cells });
    const add: Record<string, Cell>[] = [];
    const remove: string[] = [];
    const bought: Record<string, Cell>[] = [];
    /** Purchase rows' new prices, by wine. */
    const repriced = new Map<string, number | null>();
    setSaving(true);
    try {
      for (const [i, line] of order.lines.entries()) {
        const start = starts[i];
        const split = splits[i];
        const price = priceOf(prices[i]);
        const priceChanged = price !== line.price;
        const to: Location = line.to ?? "K Cellars";
        const delta = (split[ME] ?? 0) - (start[ME] ?? 0);
        let wineId = line.wineId;
        // Your share changed: the cellar and your Purchases log follow (dated with the order).
        if (delta !== 0) {
          let changed = null;
          if (wineId) {
            changed = await adjustBottles(data.file.id, wineId, { [to]: delta });
            putWine(changed);
          } else if (delta > 0) {
            changed = await addWine(
              data.file.id,
              { Producer: line.producer ?? "", Name: line.name ?? "", Vintage: line.vintage ?? "", Price: price ?? "", Source: newMerchant, Status: line.arrived ? "" : "NYA" },
              { kc: to === "K Cellars" ? delta : 0, home: to === "Home" ? delta : 0 },
            );
            putWine(changed);
            wineId = changed.wineId;
          }
          if (changed) bought.push(purchaseRow(changed, { date: boughtOn, bottles: delta, price, source: newMerchant, to, groupBuy: groupName }));
        }
        // A corrected price: your cellar's price follows if it was this order's price.
        if (priceChanged && line.wineId) {
          repriced.set(line.wineId, price);
          const w = data.wines.find((x) => x.wineId === line.wineId);
          if (w && price !== null && w.price === line.price) putWine(await updateWine(data.file.id, line.wineId, { Price: price }));
        }

        const first = line.rows[0];
        const newRow = (who: string, n: number): Record<string, Cell> => ({
          GroupID: order.id, "Order Date": newDate ? excelDate(newDate) : first.date ? excelDate(first.date) : today(), Merchant: newMerchant, Line: line.line,
          WineID: wineId ?? "", Producer: line.producer ?? "", Name: line.name ?? "", Vintage: line.vintage ?? "", Price: price ?? "",
          Person: isMe(who) ? ME : who, Bottles: n, To: isMe(who) ? to : "", Arrived: line.arrived ? "Yes" : "", "Arrived Date": line.arrived ? today() : "",
          "Group Name": newName,
        });
        for (const [who, n] of Object.entries(split)) {
          const rows = line.rows.filter((r) => (isMe(who) ? isMe(r.person) : personKey(r.person) === personKey(who)));
          const have = rows.reduce((s, r) => s + r.bottles, 0);
          if (n > have) {
            // Extra bottles start unpaid and not handed over: a row of their own if the existing one is ticked.
            const open = rows.find((r) => !r.paid && !r.handed);
            if (open) put(open.rowId, { Bottles: open.bottles + n - have });
            else add.push(newRow(who, n - have));
          } else if (n < have) {
            // Fewer: take them off unticked rows first.
            let cut = have - n;
            for (const r of [...rows].sort((a, b) => Number(a.paid || a.handed) - Number(b.paid || b.handed))) {
              if (cut <= 0) break;
              const k = Math.min(cut, r.bottles);
              cut -= k;
              if (k === r.bottles) remove.push(r.rowId);
              else put(r.rowId, { Bottles: r.bottles - k });
            }
          }
        }
        for (const r of line.rows) {
          if (remove.includes(r.rowId)) continue;
          if (priceChanged) put(r.rowId, { Price: price ?? "" });
          if (wineId && wineId !== line.wineId) put(r.rowId, { WineID: wineId });
          if (Object.keys(orderCells).length) put(r.rowId, orderCells);
        }
      }

      if (!set.size && !add.length && !remove.length) {
        toast({ text: "Nothing changed." });
        onClose();
        return;
      }
      const ok = await run({ set: [...set].map(([rowId, cells]) => ({ rowId, cells })), add, remove }, "Order updated.");
      if (!ok) return;
      onClose();

      // Your Purchases log rows for this order follow its name, merchant, date and prices.
      try {
        const mine = data.purchases.filter(
          (x) => (x.groupBuy === (order.name || order.id) || x.groupBuy === order.id) && norm(x.source) === norm(order.merchant),
        );
        const fix = mine
          .map((x) => {
            const cells: Record<string, Cell> = {};
            if (newName !== order.name) cells["Group Buy"] = groupName;
            if (newMerchant !== order.merchant) cells.Source = newMerchant;
            if (newDate && newDate !== order.date) cells["Date Bought"] = excelSerial(newDate);
            if (x.wineId && repriced.has(x.wineId)) cells.Price = repriced.get(x.wineId) ?? "";
            return { purchaseId: x.purchaseId, cells };
          })
          .filter((x) => Object.keys(x.cells).length);
        if (fix.length) putPurchases(await changePurchases(data.file.id, fix));
        if (bought.length) putPurchases(await logPurchases(data.file.id, bought));
      } catch (e) {
        toast({ text: `Order updated, but your Purchases log couldn't be: ${describeError(e)}`, error: true });
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit order" onClose={onClose}>
      <div className="eo-fields">
        <label className="wide">Name<input value={name} placeholder="e.g. Burgundy 2024 release" onChange={(e) => setName(e.target.value)} /></label>
        <label>From<input value={merchant} onChange={(e) => setMerchant(e.target.value)} /></label>
        <label>Ordered<input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <datalist id="eo-people">{known.map((k) => <option key={k} value={k} />)}</datalist>
      {order.lines.map((line, i) => {
        const split = splits[i];
        const names = [ME, ...Object.keys(split).filter((k) => !isMe(k))];
        const delta = (split[ME] ?? 0) - (starts[i][ME] ?? 0);
        const total = sum(split);
        return (
          <div key={line.line} className="eo-wine">
            <div className="eo-wine-head">
              <span>{lineName(line)}</span>
              <label className="eo-price">
                S$
                <input value={prices[i]} inputMode="decimal" aria-label={`Price per bottle of ${lineName(line)}`} onChange={(e) => setPrices((ps) => ps.map((x, k) => (k === i ? e.target.value : x)))} />
              </label>
            </div>
            <div className="split-chips">
              {names.map((who) => (
                <span key={who} className={`split-chip${isMe(who) ? " me" : ""}`}>
                  <b>{who}</b>
                  <button type="button" disabled={(split[who] ?? 0) <= 0} onClick={() => bump(i, who, -1)} aria-label={`One fewer for ${who}`}>−</button>
                  <span>{split[who] ?? 0}</span>
                  <button type="button" onClick={() => bump(i, who, 1)} aria-label={`One more for ${who}`}>+</button>
                </span>
              ))}
              {adding?.i !== i && (
                <button type="button" className="split-chip" onClick={() => setAdding({ i, who: "" })}>+ Person</button>
              )}
            </div>
            {adding?.i === i && (
              <div className="split-new">
                <input value={adding.who} autoFocus list="eo-people" placeholder="Name" onChange={(e) => setAdding({ i, who: e.target.value })} />
                <button
                  type="button"
                  className="small"
                  disabled={!adding.who.trim() || isMe(adding.who) || names.some((n) => personKey(n) === personKey(adding.who))}
                  onClick={() => {
                    const who = known.find((k) => personKey(k) === personKey(adding.who)) ?? adding.who.trim();
                    setSplits((ss) => ss.map((s, k) => (k === i ? { ...s, [who]: 1 } : s)));
                    setAdding(null);
                  }}
                >
                  Add
                </button>
                <button type="button" className="link" onClick={() => setAdding(null)}>Cancel</button>
              </div>
            )}
            <p className="muted small">
              {total} bottle{total === 1 ? "" : "s"}{total !== line.bottles && ` (was ${line.bottles})`}
              {delta !== 0 && ` · your cellar ${delta > 0 ? "+" : ""}${delta}`}
            </p>
          </div>
        );
      })}
      {error && <p className="form-errors">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        <button className="link" disabled={saving} onClick={onClose}>Cancel</button>
        <span className="muted small" style={{ marginLeft: "auto" }}>Me {myTotal} · friends {friendTotal}</span>
      </div>
    </Modal>
  );
}

const excelDate = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
