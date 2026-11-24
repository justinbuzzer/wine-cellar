import { useMemo, useState } from "react";
import { href } from "../router";
import { saveLayout, savePrefs, SETTINGS_SHEET } from "../settings";
import { msal, signOut } from "../auth";
import { clearSnapshots } from "../offline";
import { config } from "../config";
import { changeGroupBuy } from "../groupbuys";
import { isMe, personKey } from "../groupbuymodel";
import { LOCATIONS } from "../locations";
import { STOCKTAKE_EVERY, type AppPrefs } from "../prefs";
import { InstallButton } from "../ui";
import {
  columnLetters, drawnRows, hasGrid, HOME_OVERFLOW, looseSpot, MAX_COLS, MAX_LOOSE, MAX_RACKS, MAX_ROWS, rackSpot, strays, topSpot,
  type Layout,
} from "../spots";
import { describeError, useWorkbook } from "../store";
import { useToast } from "../ui";
import { getTextSize, setTextSize, TEXT_SIZES, type TextSizeKey } from "../textsize";
import { setThemeChoice, themeChoice, type ThemeChoice } from "../theme";

export default function Settings() {
  const { data, putLayout } = useWorkbook();
  const toast = useToast();
  const [f, setF] = useState<Layout>(data.layout);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Layout>) => setF({ ...f, ...p });
  const changed = JSON.stringify(f) !== JSON.stringify(data.layout);

  // Spots that would hold bottles but no longer be in the layout.
  const lost = (["K Cellars", "Home"] as const).flatMap((loc) => strays(data.wines, f, loc).map(([s, n]) => ({ loc, s, n })));

  async function save() {
    setBusy(true);
    try {
      await saveLayout(data.file.id, f);
      putLayout(f);
      toast({ text: "Storage layout saved." });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  const cols = columnLetters(f.kcCols);
  return (
    <>
      <h2 className="st-title">Settings</h2>

      <h3 className="set-group">Display</h3>
      <ThemeCard />
      <TextSizeCard />

      <h3 className="set-group">Purchases and stocktakes</h3>
      <p className="muted small set-group-note">Saved in your workbook, so every device uses the same.</p>
      <PrefsCard />

      <h3 className="set-group">Group Buys</h3>
      <FriendsCard />

      <h3 className="set-group">Storage layout</h3>
      <p className="muted small set-group-note">Your K Cellars boxes and Home fridge racks. Saved in your workbook, so every device uses the same layout.</p>
      <section className="card">
        <div className="card-head">
          <h2>K Cellars boxes</h2>
          <a href={href("storage")}>View boxes →</a>
        </div>
        <Num label="Columns" hint={cols.length ? `${cols[0]}–${cols[cols.length - 1]}` : "none"} value={f.kcCols} max={MAX_COLS} onChange={(kcCols) => set({ kcCols })} />
        <Num label="Rows" value={f.kcRows} max={MAX_ROWS} onChange={(kcRows) => set({ kcRows })} />
        <div className="set-row">
          <span>Row 1 is at the</span>
          <div className="seg set-seg">
            {(["Top", "Bottom"] as const).map((v) => (
              <button key={v} type="button" className={f.kcRow1 === v ? "on" : ""} onClick={() => set({ kcRow1: v })}>{v}</button>
            ))}
          </div>
        </div>
        <p className="muted small set-note">Decide this before you write the numbers on your boxes; it only changes how the grid is drawn.</p>
        <label className="set-row switch">
          <span>Overflow spot on top of each column</span>
          <input type="checkbox" checked={f.kcOverflow} onChange={(e) => set({ kcOverflow: e.target.checked })} />
        </label>
        <Num
          label="Loose cardboard boxes"
          hint={f.kcLoose ? `L1–${looseSpot(f.kcLoose)}` : "none"}
          value={f.kcLoose}
          max={MAX_LOOSE}
          onChange={(kcLoose) => set({ kcLoose })}
        />

        {hasGrid(f) && (
          <div className="spot-grid preview" style={{ gridTemplateColumns: `28px repeat(${cols.length}, minmax(0, 1fr))` }}>
            <span />
            {cols.map((c) => <span key={c} className="spot-head">{c}</span>)}
            {f.kcOverflow && (
              <>
                <span className="spot-head">top</span>
                {cols.map((c) => <span key={c} className="spot-cell top"><span>{topSpot(c)}</span></span>)}
              </>
            )}
            {drawnRows(f).map((r) => (
              <Row key={r} r={r} cols={cols} />
            ))}
          </div>
        )}
        {f.kcLoose > 0 && (
          <div className="chips preview-chips">
            {Array.from({ length: f.kcLoose }, (_, i) => <span key={i} className="chip">{looseSpot(i + 1)}</span>)}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Home fridge</h2>
        <Num label="Racks" hint="Rack 1 at the top" value={f.homeRacks} max={MAX_RACKS} onChange={(homeRacks) => set({ homeRacks })} />
        <label className="set-row switch">
          <span>Overflow spot</span>
          <input type="checkbox" checked={f.homeOverflow} onChange={(e) => set({ homeOverflow: e.target.checked })} />
        </label>
        {f.homeRacks > 0 && (
          <div className="chips preview-chips">
            {Array.from({ length: f.homeRacks }, (_, i) => <span key={i} className="chip">{rackSpot(i + 1)}</span>)}
            {f.homeOverflow && <span className="chip dashed">{HOME_OVERFLOW}</span>}
          </div>
        )}
      </section>

      {lost.length > 0 && (
        <p className="notice">
          {lost.length === 1 ? "This spot holds" : "These spots hold"} bottles but {lost.length === 1 ? "isn't" : "aren't"} in the layout:{" "}
          {lost.map((x) => `${x.loc} ${x.s} (${x.n})`).join(", ")}. They'll show under “Not in your layout” on the boxes page until you move them.
        </p>
      )}

      <h3 className="set-group">Account and data</h3>
      <AccountCard />

      <h3 className="set-group">Tools</h3>
      <section className="card set-tools">
        <a href={href("storage")}>📦 Boxes and racks →</a>
        <a href={href("producers")}>🏷️ Producer logos →</a>
        <a href={href("diagnostics")}>🩺 Diagnostics → <span className="muted small">bottle-count check and repair, duplicates, export for research</span></a>
      </section>

      {/* Only while the storage layout has unsaved changes (text size applies straight away). */}
      {changed && (
        <div className="save-bar">
          <button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save layout"}</button>
          <button className="link" disabled={busy} onClick={() => setF(data.layout)}>Undo changes</button>
          <span className="muted small">Saved on an “{SETTINGS_SHEET}” sheet in your workbook.</span>
        </div>
      )}
    </>
  );
}

const THEMES: { key: ThemeChoice; label: string }[] = [
  { key: "auto", label: "Automatic" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

/** Light or dark for this device (Automatic follows the device): applies straight away. */
function ThemeCard() {
  const [choice, setChoice] = useState<ThemeChoice>(themeChoice());
  return (
    <section className="card">
      <h2>Theme</h2>
      <div className="seg set-theme" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={choice === t.key}
            className={choice === t.key ? "on" : ""}
            onClick={() => {
              setThemeChoice(t.key);
              setChoice(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted small set-note">Automatic follows your phone or computer, so it turns dark when they do. Just for this device.</p>
    </section>
  );
}

/** Purchase defaults and the stocktake reminder, saved in the workbook. */
function PrefsCard() {
  const { data, putPrefs } = useWorkbook();
  const toast = useToast();
  const [f, setF] = useState<AppPrefs>(data.prefs);
  const [gst, setGst] = useState(String(data.prefs.gstRate));
  const [busy, setBusy] = useState(false);
  const gstNum = Number(gst);
  const gstOk = gst.trim() !== "" && Number.isFinite(gstNum) && gstNum >= 0 && gstNum <= 50;
  const next: AppPrefs = { ...f, gstRate: gstOk ? gstNum : f.gstRate };
  const changed = JSON.stringify(next) !== JSON.stringify(data.prefs);

  async function save() {
    if (!gstOk) {
      toast({ text: "GST must be a number like 9.", error: true });
      return;
    }
    setBusy(true);
    try {
      await savePrefs(data.file.id, next);
      putPrefs(next);
      toast({ text: "Saved." });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Add a purchase starts with</h2>
      <div className="set-row">
        <span>Bottles go to</span>
        <div className="seg set-seg">
          {LOCATIONS.map((l) => (
            <button key={l} type="button" className={f.defaultWhere === l ? "on" : ""} onClick={() => setF({ ...f, defaultWhere: l })}>{l}</button>
          ))}
        </div>
      </div>
      <label className="set-row switch">
        <span>Not yet arrived ticked</span>
        <input type="checkbox" checked={f.defaultNya} onChange={(e) => setF({ ...f, defaultNya: e.target.checked })} />
      </label>
      <label className="set-row">
        <span>GST rate <span className="muted small">added to "before GST" prices and by the invoice reader</span></span>
        <span className="set-gst">
          <input value={gst} inputMode="decimal" onChange={(e) => setGst(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="GST rate %" />%
        </span>
      </label>

      <h2 className="set-sub">Stocktake reminder</h2>
      <div className="set-row">
        <span>Remind me on the Overview</span>
        <div className="seg set-seg">
          {STOCKTAKE_EVERY.map((m) => (
            <button key={m} type="button" className={f.stocktakeMonths === m ? "on" : ""} onClick={() => setF({ ...f, stocktakeMonths: m })}>
              {m === 0 ? "Off" : `${m} mo`}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small set-note">When it's been this long since your last stocktake, the Overview says a stocktake is due.</p>

      {changed && (
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
          <button className="link" disabled={busy} onClick={() => { setF(data.prefs); setGst(String(data.prefs.gstRate)); }}>Undo changes</button>
        </div>
      )}
    </section>
  );
}

/** Friends in your Group Buys: rename one, or merge two that are the same person. */
function FriendsCard() {
  const { data, putGroupBuys } = useWorkbook();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const friends = useMemo(() => {
    const m = new Map<string, { key: string; name: string; bottles: number; orders: Set<string> }>();
    for (const r of data.groupBuys) {
      if (!r.person || isMe(r.person)) continue;
      const k = personKey(r.person);
      const f = m.get(k) ?? { key: k, name: r.person, bottles: 0, orders: new Set<string>() };
      f.bottles += r.bottles;
      f.orders.add(r.groupId);
      m.set(k, f);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.groupBuys]);

  async function save(oldKey: string) {
    const target = name.trim();
    if (!target || isMe(target)) {
      toast({ text: "Enter a name.", error: true });
      return;
    }
    const into = friends.find((f) => f.key === personKey(target) && f.key !== oldKey);
    const from = friends.find((f) => f.key === oldKey);
    if (into && !confirm(`${from?.name} and ${into.name} will become one person, “${into.name}”. Merge them?`)) return;
    const newName = into ? into.name : target;
    setBusy(true);
    try {
      const set = data.groupBuys.filter((r) => personKey(r.person) === oldKey).map((r) => ({ rowId: r.rowId, cells: { Person: newName } }));
      putGroupBuys(await changeGroupBuy(data.file.id, { set }));
      toast({ text: into ? `Merged into ${newName}.` : `Renamed to ${newName}.` });
      setEditing(null);
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Friends</h2>
      {friends.length === 0 ? (
        <p className="muted small">No friends yet: they're added when you split a Group Buy.</p>
      ) : (
        <>
          <p className="muted small set-note">Rename someone, or give two names the same name to merge them (e.g. a typo or a nickname).</p>
          <ul className="set-friends">
            {friends.map((f) => (
              <li key={f.key}>
                {editing === f.key ? (
                  <span className="split-new">
                    <input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save(f.key)} aria-label={`New name for ${f.name}`} />
                    <button className="primary small" disabled={busy} onClick={() => void save(f.key)}>{busy ? "Saving…" : "Save"}</button>
                    <button className="link" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <span>
                      <strong>{f.name}</strong>{" "}
                      <span className="muted small">{f.bottles} btl · {f.orders.size} order{f.orders.size === 1 ? "" : "s"}</span>
                    </span>
                    <button className="link small" onClick={() => { setEditing(f.key); setName(f.name); }}>✎ Rename</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Who's signed in, which workbook, when it last synced; refresh, start afresh, install, sign out. */
function AccountCard() {
  const { data, syncedAt, syncing, refresh, changeFile } = useWorkbook();
  const account = msal.getActiveAccount();
  const isTest = /test/i.test(data.file.name);
  const when = (t: number) => new Date(t).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className="card set-account">
      <div className="set-row">
        <span>Signed in as</span>
        <strong>{account?.name ?? account?.username ?? "–"}</strong>
      </div>
      <div className="set-row">
        <span>Workbook</span>
        <span className="set-file">
          {data.file.name} {isTest && <span className="badge">TEST</span>}
        </span>
      </div>
      <div className="set-row">
        <span>Last read from OneDrive</span>
        <span className="muted small">{syncing ? "Reading now…" : syncedAt ? when(syncedAt) : "Showing this device's saved copy"}</span>
      </div>
      <div className="actions">
        <button disabled={syncing} onClick={() => void refresh()}>⟳ Refresh now</button>
        <button
          onClick={async () => {
            if (!confirm("Forget the copy saved on this device and read everything again from OneDrive?")) return;
            await clearSnapshots();
            location.reload();
          }}
        >
          Start afresh
        </button>
        <InstallButton />
      </div>
      <p className="muted small set-note">
        Start afresh clears the copy this device keeps for offline use, then reloads it from OneDrive. Your workbook isn't changed.
      </p>
      <div className="actions set-account-end">
        <button className="link small" onClick={() => { if (confirm(`Use a different workbook than ${data.file.name}?`)) changeFile(); }}>Use a different workbook</button>
        <button className="danger" onClick={() => void signOut()}>Sign out</button>
      </div>
      {config.usingTestFile && <p className="muted small">Development mode: this copy of the app uses the TEST workbook.</p>}
    </section>
  );
}

/** Text size for this device: applies straight away, no Save needed. */
function TextSizeCard() {
  const [size, setSize] = useState<TextSizeKey>(getTextSize());
  return (
    <section className="card">
      <h2>Text size</h2>
      <p className="muted small set-note">Smaller text fits more wines and notes on screen. Just for this device; your phone and computer can differ.</p>
      <div className="text-sizes" role="radiogroup" aria-label="Text size">
        {TEXT_SIZES.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={size === s.key}
            className={size === s.key ? "on" : ""}
            onClick={() => {
              setTextSize(s.key);
              setSize(s.key);
            }}
          >
            <span className="ts-a" style={{ fontSize: `${(s.pct / 100) * 1.15}rem` }}>A</span>
            <span className="ts-l">{s.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Row({ r, cols }: { r: number; cols: string[] }) {
  return (
    <>
      <span className="spot-head">{r}</span>
      {cols.map((c) => <span key={c} className="spot-cell"><span>{`${c}${r}`}</span></span>)}
    </>
  );
}

function Num({ label, hint, value, max, onChange }: { label: string; hint?: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="set-row">
      <span>
        {label} {hint && <span className="muted small">{hint}</span>}
      </span>
      <div className="st-step">
        <button type="button" disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label.toLowerCase()}`}>−</button>
        <b>{value}</b>
        <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label.toLowerCase()}`}>+</button>
      </div>
    </div>
  );
}
