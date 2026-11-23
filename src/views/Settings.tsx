import { useState } from "react";
import { href } from "../router";
import { saveLayout, SETTINGS_SHEET } from "../settings";
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
