import { useMemo, useState } from "react";
import { config } from "../config";
import { LogoDialog, ProducerLogo, useLogos, type LogoFile } from "../logos";
import { producerGroups, similarProducers, type Producer } from "../producers";
import { href } from "../router";
import { describeError, useWorkbook } from "../store";
import { ChipGroup, bottles, useToast } from "../ui";

const MISSING = "Missing logo";
const ALL = "All producers";

export default function Producers() {
  const { data } = useWorkbook();
  const logos = useLogos();
  const groups = useMemo(() => producerGroups(data.wines), [data.wines]);
  const similar = useMemo(() => similarProducers(groups), [groups]);
  const [show, setShow] = useState(MISSING);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Producer | null>(null);

  const withLogo = groups.filter((g) => logos.get(g.name)).length;
  const query = q.trim().toLowerCase();
  const list = groups.filter(
    (g) => (show === ALL || !logos.get(g.name)) && (!query || g.name.toLowerCase().includes(query)),
  );

  // Pictures that match no producer, or are a second picture for one.
  const keys = new Set(groups.map((g) => g.key));
  const unused = logos.files.filter((f) => !keys.has(f.key) || logos.get(f.key)?.id !== f.id);

  return (
    <>
      <a className="back" href={href("overview")}>← Overview</a>
      <section className="card">
        <h2>Producer logos</h2>
        <p>
          <strong>{withLogo}</strong> of {groups.length} producers have a logo. One picture covers every wine and vintage
          from that producer.
        </p>
        {logos.status === "loading" && <p className="muted small">Checking OneDrive for logos…</p>}
        {logos.status === "failed" && (
          <p className="warn small">Couldn't read the logo folder in OneDrive. Logos you add will still be saved there.</p>
        )}
        <div className="producer-filters">
          <ChipGroup options={[MISSING, ALL]} value={show} onChange={(v) => setShow(v || ALL)} label="Show" />
          <input
            className="search producer-search"
            type="search"
            placeholder="Find a producer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Find a producer"
          />
        </div>
        {list.length === 0 ? (
          <p className="muted">{show === MISSING && !query ? "Every producer has a logo." : "No producers match."}</p>
        ) : (
          <ul className="producer-list">
            {list.map((g) => (
              <li key={g.key}>
                <button className="producer-row" onClick={() => setEditing(g)}>
                  <ProducerLogo producer={g.name} size="row" />
                  <span className="producer-text">
                    <strong>{g.name}</strong>
                    <span className="muted small">
                      {g.wines.length} wine{g.wines.length === 1 ? "" : "s"} · {bottles(g.bottles)}
                    </span>
                  </span>
                  <span className="producer-action">{logos.get(g.name) ? "Change" : "Add logo"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {similar.length > 0 && (
        <section className="card">
          <h2>Names that look alike</h2>
          <p className="muted small">
            These may be the same producer written two ways, which would need two logos. If they are the same, make the
            Producer name match in Excel and they'll share one logo.
          </p>
          <ul className="issue-list">
            {similar.map(([a, b]) => (
              <li key={`${a.key}-${b.key}`}>
                <strong>{a.name}</strong> <span className="muted">({a.wines.length})</span> ·{" "}
                <strong>{b.name}</strong> <span className="muted">({b.wines.length})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unused.length > 0 && <UnusedLogos files={unused} groups={groups} />}

      {editing && <LogoDialog producer={editing.name} wineCount={editing.wines.length} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Pictures in the folder that no producer uses, e.g. after renaming a producer in Excel. */
function UnusedLogos({ files, groups }: { files: LogoFile[]; groups: Producer[] }) {
  const logos = useLogos();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const without = groups.filter((g) => !logos.get(g.name)).sort((a, b) => a.name.localeCompare(b.name));

  const run = async (id: string, fn: () => Promise<void>, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast({ text: done });
    } catch (e) {
      toast({ text: describeError(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <h2>Pictures not in use</h2>
      <p className="muted small">
        These are in your <strong>{config.logoFolder.split("/").pop()}</strong> folder but don't match a producer's name
        (for example after a producer was renamed in Excel). Pick who each one belongs to, or delete it.
      </p>
      <ul className="producer-list">
        {files.map((f) => (
          <li key={f.id} className="unused-logo">
            <span className="logo-tile logo-row">
              <img src={f.src} alt="" loading="lazy" />
            </span>
            <span className="producer-text">
              <strong>{f.name}</strong>
              <select
                disabled={busy === f.id}
                value=""
                aria-label={`Use ${f.name} for`}
                onChange={(e) => {
                  const g = without.find((x) => x.key === e.target.value);
                  if (g) void run(f.id, () => logos.assign(f, g.name), `Logo now used for ${g.name}.`);
                }}
              >
                <option value="">Use for…</option>
                {without.map((g) => (
                  <option key={g.key} value={g.key}>{g.name}</option>
                ))}
              </select>
            </span>
            <button
              className="link"
              disabled={busy === f.id}
              onClick={() => {
                if (window.confirm(`Delete ${f.name}? It goes to your OneDrive recycle bin.`)) {
                  void run(f.id, () => logos.deleteFile(f), "Picture deleted.");
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
