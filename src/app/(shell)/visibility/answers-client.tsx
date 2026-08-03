"use client";

/**
 * answers-client - THE day's AI readings, question by question, with a way to EVERY one of them and a way
 * into the whole of any one of them.
 *
 * A live day is thirty five questions across four assistants, so a hundred and forty readings. This screen
 * opens with one bounded page and pages the rest from the server on demand: never a first fifty with no next
 * page. Opening one reading fetches that ONE stored answer by its own identity, which is the only place a
 * whole answer text is ever loaded. Both are READS of answers already bought; no assistant is asked anything.
 */

import { useState, useTransition } from "react";

export type AnswerLine = { id: string; head: string; body: string };

export function AnswerJourney({ note, first, cursor, more, open }: {
  /** The one sentence above the list: which day, and what opening a line gets you. */
  note: string;
  first: AnswerLine[];
  /** Where the next page resumes, or null when this page is the end of the day. */
  cursor: string | null;
  more: (cursor: string) => Promise<{ rows: AnswerLine[]; cursor: string | null }>;
  open: (id: string) => Promise<string[]>;
}) {
  const [rows, setRows] = useState(first);
  const [at, setAt] = useState(cursor);
  const [reading, setReading] = useState<Record<string, string[]>>({});
  const [busy, start] = useTransition();
  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-surface-raised px-4 py-3" data-visibility-block="Question by question">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-foreground/70">Question by question</h2>
      <p className="mt-1.5 text-[13px] tabular-nums text-muted-foreground">{note}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="text-[12px] tabular-nums text-muted-foreground">
            {/* THE WHOLE ANSWER LOADS HERE AND NOWHERE ELSE, one stored reading at a time. */}
            <details data-visibility-detail="true" onToggle={(e) => {
              if (!(e.currentTarget as HTMLDetailsElement).open || reading[r.id]) return;
              start(async () => { const lines = await open(r.id); setReading((p) => ({ ...p, [r.id]: lines })); });
            }}>
              <summary className="cursor-pointer list-item"><span className="font-medium text-foreground">{r.head}</span>: {r.body}</summary>
              <div className="mt-1 space-y-1 border-l border-border pl-3">
                {(reading[r.id] ?? ["Opening the whole of this reading."]).map((d, i) => (
                  <p key={i} className="whitespace-pre-line break-words text-[12px] text-muted-foreground">{d}</p>))}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {at ? (
        <button type="button" disabled={busy} data-more-answers="true"
          onClick={() => start(async () => { const res = await more(at); setRows((p) => [...p, ...res.rows]); setAt(res.cursor); })}
          className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60">
          {busy ? "Reading them back…" : "Show me more of this day's answers"}
        </button>
      ) : <p className="mt-2 text-[12px] text-muted-foreground">That is every answer I hold for this day.</p>}
    </section>
  );
}
