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

/** `tenantId` is the account this tab was DRAWN for and travels with every action so the server can refuse a stale tab. `days` is every day I actually hold
 *  readings on, so any one of them can be inspected and not only the newest. `cursor` is where the next page of the chosen day resumes, null at its end. */
export function AnswerJourney({ tenantId, days, day, note, first, cursor, page, open }: {
  tenantId: string; days: Array<{ day: string; label: string }>; day: string; note: string;
  first: AnswerLine[]; cursor: string | null;
  page: (tenantId: string, day: string, after: string | null) => Promise<{ rows: AnswerLine[]; cursor: string | null; note: string | null; replace?: boolean }>;
  open: (tenantId: string, id: string) => Promise<string[]>;
}) {
  const [rows, setRows] = useState(first); const [at, setAt] = useState(cursor); const [on, setOn] = useState(day);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState<Record<string, string[]>>({}); const [busy, start] = useTransition();
  /** ONE way in for the day picker and the show-more button, so a refused or failed read can never clear the rows or the way forward. */
  const load = (forDay: string, after: string | null) => start(async () => {
    const res = await page(tenantId, forDay, after); setProblem(res.note);
    if (res.note == null) { setOn(forDay); setRows((p) => (res.replace ? res.rows : [...p, ...res.rows])); setAt(res.cursor); } });
  if (rows.length === 0 && problem == null) return null;
  return (
    <section className="rounded-2xl border border-border bg-surface-raised px-4 py-3" data-visibility-block="Question by question">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-foreground/70">Question by question</h2>
      <p className="mt-1.5 text-[13px] tabular-nums text-muted-foreground">{note}</p>
      {days.length > 1 ? (
        <label className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">Show me the day
          <select value={on} disabled={busy} data-answers-day="true" onChange={(e) => load(e.target.value, null)}
            className="rounded-lg border border-border bg-surface-raised px-2 py-1 text-[12px] font-medium text-foreground">
            {days.map((d) => <option key={d.day} value={d.day}>{d.label}</option>)}</select></label>) : null}
      {problem ? <p className="mt-1.5 text-[13px] text-amber-800" data-answers-problem="true">{problem}</p> : null}
      <ul className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="text-[12px] tabular-nums text-muted-foreground">
            {/* THE WHOLE ANSWER LOADS HERE AND NOWHERE ELSE, one stored reading at a time. */}
            <details data-visibility-detail="true" onToggle={(e) => {
              if (!(e.currentTarget as HTMLDetailsElement).open || reading[r.id]) return;
              start(async () => { const lines = await open(tenantId, r.id); setReading((p) => ({ ...p, [r.id]: lines })); });
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
      {/* A READ THAT FAILED KEEPS THE WAY FORWARD. The cursor comes back unchanged from a refused or broken
          read, so the button stays and this can never settle into "that is every answer" over an outage. */}
      {at ? (
        <button type="button" disabled={busy} data-more-answers="true" onClick={() => load(on, at)}
          className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60">
          {busy ? "Reading them back…" : problem ? "Try that again" : "Show me more of this day's answers"}
        </button>
      ) : <p className="mt-2 text-[12px] text-muted-foreground">That is every answer I hold for this day.</p>}
    </section>
  );
}
