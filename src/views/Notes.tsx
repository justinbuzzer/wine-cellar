import { useMemo } from "react";
import type { Tasting } from "../data";
import { go } from "../router";
import { useWorkbook } from "../store";
import { MiniNote } from "./NoteView";

/** Newest first: by date tasted, then year tasted, then TastingID. */
export function newestFirst(a: Tasting, b: Tasting): number {
  const da = a.dateTasted ?? `${a.yearTasted ?? 0}-00-00`;
  const db = b.dateTasted ?? `${b.yearTasted ?? 0}-00-00`;
  return db.localeCompare(da) || (b.tastingId ?? "").localeCompare(a.tastingId ?? "");
}

// Step 4: recent notes + "write a note". Step 5 adds search and filters here.
export default function Notes() {
  const { data } = useWorkbook();
  const recent = useMemo(() => [...data.tastings].sort(newestFirst).slice(0, 30), [data.tastings]);
  return (
    <>
      <div className="summary">
        <span>
          <strong>{data.tastings.length.toLocaleString()}</strong> tasting notes
        </span>
        <button className="primary small" onClick={() => go("note/new")}>✍ Write a note</button>
      </div>
      <section className="card">
        <h2>Recent notes</h2>
        {recent.map((t) => <MiniNote key={t.tastingId} t={t} />)}
        <p className="muted small">Search across all notes is coming in step 5.</p>
      </section>
    </>
  );
}
