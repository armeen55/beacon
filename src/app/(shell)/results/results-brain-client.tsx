"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { BrainModel } from "./results-brain";
type Thought = BrainModel["thoughts"][number];

/** THE LEARNING FIELD AND ITS INSPECTOR. One thought per real kind of work: its size is the verified sample and nothing else, a faint
 *  dashed ring says older unverified history exists, a slow pulse says readings are still in progress, and colour appears only once
 *  verified reads exist. Selecting a thought opens the evidence beside it (under it on a narrow screen). Native SVG, no chart library,
 *  reduced motion honoured, and every state is said in words beside its shape so colour is never the only encoding. */

/** THE SAME WORDS THE ROWS WEAR (results-lines STATE_LABEL): one vocabulary, whether a row or a whole kind of work is being named. */
const CONF_WORD: Record<Thought["confidence"], string> = { none: "No verified 28 day read yet", early: "Verified early signal", pattern: "Verified pattern", mixed: "Mixed" };
const confWord = (t: Thought): string => (t.confidence === "pattern" ? `${CONF_WORD.pattern}, ${t.ahead >= t.behind ? "ahead" : "behind"}` : CONF_WORD[t.confidence]);
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2";
/** The server paints the lattice at the desktop column's real width so hydration does not reflow it. */
const DEFAULT_WIDTH = 618;
const columns = (n: number, width: number): number => Math.max(1, Math.min(n, width < 520 ? 2 : width < 600 ? 3 : 4));

/** Where each thought sits: a calm lattice that wraps on narrow fields, deterministic from the order the model chose. */
function place(n: number, i: number, width: number): { x: number; y: number } {
  const cols = columns(n, width), gapX = width / cols;
  return { x: gapX * (i % cols) + gapX / 2, y: 78 + Math.floor(i / cols) * 118 };
}

function nodeFill(t: Thought): string {
  if (t.confidence === "pattern") return t.ahead >= t.behind ? "var(--status-success)" : "var(--status-danger)";
  if (t.confidence === "mixed") return "var(--status-warning)";
  return "var(--foreground)";
}

export function ResultsBrain({ model, checkedAgo }: { model: BrainModel; checkedAgo: string | null }) {
  const [selected, setSelected] = useState<string | null>(model.thoughts[0]?.key ?? null);
  const [reduced, setReduced] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const id = useId();
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)"); setReduced(mq.matches);
    const on = () => setReduced(mq.matches); mq.addEventListener("change", on);
    const el = document.getElementById(`${id}-field`); const ro = new ResizeObserver((es) => { const w = es[0]?.contentRect.width; if (w) setWidth(w); }); if (el) ro.observe(el);
    return () => { mq.removeEventListener("change", on); ro.disconnect(); };
  }, [id]);
  const thoughts = model.thoughts, rows = Math.ceil(thoughts.length / columns(thoughts.length, width));
  const height = Math.max(150, 40 + rows * 118);
  const pos = new Map(thoughts.map((t, i) => [t.key, place(thoughts.length, i, width)] as const));
  const current = thoughts.find((t) => t.key === selected) ?? null;
  const conf = model.belief.confidence;
  return (
    <section aria-label="What Beacon believes" data-results-brain="true">
      <div className="mb-5" data-brain-belief={conf}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Beacon&apos;s current belief</p>
        <h2 className="mt-1 text-[22px] font-semibold leading-snug tracking-tight text-foreground" style={{ textWrap: "balance" }}>{model.belief.headline}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${conf === "pattern" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : conf === "mixed" ? "border-amber-300 bg-amber-50 text-amber-800" : conf === "early" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-border bg-surface-inset text-muted-foreground"}`} data-brain-confidence={conf}>{CONF_WORD[conf]}</span>
          {checkedAgo ? <span className="text-[11px] text-muted-foreground">Checked {checkedAgo}</span> : null}
        </div>
        {model.belief.lines.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Why Beacon believes this</p>
            <ul className="mt-1 space-y-1">{model.belief.lines.map((l) => <li key={l} className="text-[13px] leading-relaxed text-foreground/85">{l}</li>)}</ul>
          </div>
        ) : null}
        {/* THE ONE THING TO DO, on the belief itself: a fact about waiting is not a next step. */}
        <p className="mt-3 text-[13px] font-medium text-foreground" data-brain-next="true">
          {model.nextStep.href ? <Link href={model.nextStep.href} className={`text-accent-primary underline underline-offset-2 ${FOCUS}`}>{model.nextStep.text}</Link> : model.nextStep.text}
        </p>
      </div>

      {/* DOM ORDER IS READING ORDER ON A NARROW SCREEN: field, then the evidence for the selected thought, then the recent and the watched. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_auto]">
        <div id={`${id}-field`} className="rounded-xl border border-border-subtle bg-surface-raised px-2 pb-2 pt-3 lg:col-start-1 lg:row-start-1" data-brain-field="true">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The learning field <span className="font-normal normal-case tracking-normal">(select a kind of work)</span></p>
          {thoughts.length === 0 ? (
            <p className="px-2 py-8 text-[13px] text-muted-foreground" data-brain-empty="true">Nothing has been marked done yet. The first change you mark done appears here as a thought, and its reads fill it in over 28 days.</p>
          ) : (
            <svg viewBox={`0 0 ${Math.max(320, width)} ${height}`} width="100%" height={height} role="group" aria-label="Kinds of work, sized by verified reads" className="block">
              <defs>
                <style>{`.brain-pulse{transform-origin:center;transform-box:fill-box;animation:brainPulse 3.2s ease-in-out infinite}@keyframes brainPulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.12;transform:scale(1.35)}}@media (prefers-reduced-motion:reduce){.brain-pulse{animation:none;opacity:.35}}.brain-focus{opacity:0}g:focus-visible>.brain-focus{opacity:1}g:hover>.brain-hit{fill:var(--accent-primary-light)}`}</style>
              </defs>
              {/* A REAL COMBINATION IS DRAWN AS AN ARC ABOVE THE ROW, never as a line through a neighbour. */}
              {thoughts.flatMap((t) => t.edges.filter((k) => k > t.key).map((k) => { const a = pos.get(t.key)!, b = pos.get(k); return b ? <path key={`${t.key}-${k}`} d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - 54} ${b.x},${b.y}`} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="3 4" /> : null; }))}
              {thoughts.map((t) => { const p = pos.get(t.key)!, r = Math.min(40, 7 + Math.sqrt(t.verifiedSample) * 7), ring = t.historical > 0 ? r + 5 + Math.min(14, Math.sqrt(t.historical) * 3) : null, on = t.key === selected;
                const fill = nodeFill(t), faint = t.confidence === "none" ? 0.35 : t.confidence === "early" ? 0.6 : 0.95, pulse = r + 4 + Math.min(12, Math.sqrt(t.inFlight) * 2);
                return (
                  <g key={t.key} tabIndex={0} role="button" aria-pressed={on} aria-label={`${t.name}: ${confWord(t)}. ${t.verifiedSample} verified reads, ${t.historical} historical, ${t.inFlight} still reading.`}
                    onClick={() => setSelected(t.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(t.key); } }} className="cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500" data-brain-thought={t.key}>
                    <circle className="brain-hit" cx={p.x} cy={p.y} r={Math.max(26, (ring ?? r) + 10)} fill="transparent" />
                    <circle className="brain-focus" cx={p.x} cy={p.y} r={(ring ?? r) + 12} fill="none" stroke="var(--accent-primary)" strokeWidth={2} />
                    {on ? <circle cx={p.x} cy={p.y} r={(ring ?? r) + 8} fill="var(--accent-primary-light)" stroke="var(--accent-primary)" strokeWidth={2} /> : null}
                    {ring != null ? <circle cx={p.x} cy={p.y} r={ring} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.8} strokeWidth={1} strokeDasharray="2 3" /> : null}
                    {t.inFlight > 0 ? <circle cx={p.x} cy={p.y} r={pulse} fill="none" stroke="var(--accent-primary)" strokeWidth={1.5} className={reduced ? "" : "brain-pulse"} opacity={reduced ? 0.55 : undefined} /> : null}
                    <circle cx={p.x} cy={p.y} r={r} fill={fill} fillOpacity={faint} stroke={fill} strokeOpacity={Math.min(1, faint + 0.35)} strokeWidth={1.25} />
                    {t.verifiedSample > 0 ? <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight={600} fill="var(--foreground)">{t.verifiedSample}</text> : null}
                    <text x={p.x} y={p.y + (ring ?? r) + 20} textAnchor="middle" fontSize="12" fontWeight={on ? 600 : 500} fill="var(--foreground)">{t.name}</text>
                    <text x={p.x} y={p.y + (ring ?? r) + 34} textAnchor="middle" fontSize="10.5" fill="var(--muted-foreground)">{t.confidence === "none" ? (t.inFlight > 0 ? `${t.inFlight} reading` : t.historical > 0 ? `${t.historical} historical` : t.notMeasurable > t.recorded ? `${t.notMeasurable} not measurable` : `${t.recorded} recorded`) : confWord(t)}</text>
                  </g>
                ); })}
            </svg>
          )}
          <p className="px-2 pt-1 text-[10.5px] leading-relaxed text-muted-foreground">Size is verified 28 day reads. A dashed ring is older history that cannot teach. {reduced ? "A blue ring" : "A pulse"} is reading still in progress, wider when more is being read. A dashed arc joins kinds of work that overlapped on one page. Colour appears only with verified reads: green or red for a pattern, amber for a split record.</p>
        </div>

        <aside className="rounded-xl border border-border-subtle bg-surface-raised px-4 py-3 lg:col-start-2 lg:row-span-2 lg:row-start-1" data-brain-inspector={current?.key ?? "none"}>
          {current ? (
            <>
              <div aria-live="polite">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{current.name} <span className="ml-1 rounded-full border border-sky-300 bg-sky-50 px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-sky-800">Selected</span></p>
                <p className="mt-1 text-[13px] font-medium leading-relaxed text-foreground">{current.belief}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{confWord(current)}</p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] tabular-nums">
                {([["Marked done", current.shipped], ["Confirmed live", current.liveVerified], ["Verified 28 day reads", current.verifiedSample], ["Historical reads", current.historical],
                  ["Ahead", current.ahead], ["Behind", current.behind], ["Inconclusive", current.inconclusive], ["Still reading", current.inFlight], ["Recorded, waiting for live verification", current.waitingVerification + current.recorded], ["Shared with other changes", current.overlapping]] as const)
                  .filter(([k, v]) => v > 0 || k === "Marked done" || k === "Verified 28 day reads").map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right text-foreground">{v}</dd></div>))}
              </dl>
              {current.historical > 0 ? <p className="mt-2 text-[11px] text-muted-foreground">Historical: {current.historicalAhead} ahead, {current.historicalBehind} behind, {current.historicalUnclear} unclear. Context only.</p> : null}
              <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Strongest example</p>
                {current.strongest ? <p className="text-[12px] text-foreground/85"><a href={`#change-${current.strongest.id}`} className={`font-medium text-accent-primary underline underline-offset-2 ${FOCUS}`}>{current.strongest.label}</a> {current.strongest.line}</p>
                  : <p className="text-[12px] text-muted-foreground">No read has finished ahead for {current.name.toLowerCase()} yet.</p>}</div>
              {current.counterexample ? (<div className="mt-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Counterexample</p>
                <p className="text-[12px] text-foreground/85"><a href={`#change-${current.counterexample.id}`} className={`font-medium text-accent-primary underline underline-offset-2 ${FOCUS}`}>{current.counterexample.label}</a> {current.counterexample.line}</p></div>) : null}
              {current.limits.length > 0 ? (<div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Limits</p><ul className="mt-1 space-y-1">{current.limits.map((l) => <li key={l} className="text-[12px] text-foreground/80">{l}</li>)}</ul></div>) : null}
              <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What would change Beacon&apos;s mind</p><p className="mt-1 text-[12px] text-foreground/85">{current.changeMind}</p></div>
              <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Watching</p><p className="mt-1 text-[12px] text-foreground/85">{current.watching}</p></div>
            </>
          ) : <p className="text-[13px] text-muted-foreground">Select a kind of work to see the evidence behind it.</p>}
        </aside>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-start-1 lg:row-start-2">
          {model.changed ? (<div><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What changed recently</p><p className="mt-1 text-[13px] text-foreground/85">{model.changed}</p></div>) : null}
          {model.watching.length > 0 ? (<div><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What Beacon is watching</p><ul className="mt-1 space-y-1">{model.watching.map((w) => <li key={w} className="text-[13px] text-foreground/85">{w}</li>)}</ul></div>) : null}
        </div>
      </div>
    </section>
  );
}
