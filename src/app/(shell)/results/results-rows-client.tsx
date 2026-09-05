"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import type { ResultsView } from "./results-presentation";
import { pageLabel } from "../changes/types";

type ResultsGroup = keyof ResultsView["rows"];
type ResultsRow = ResultsView["rows"]["worked"][number];

/**
 * The Results list: one sticky strip that picks which answer you are looking at, then one line per
 * change. The line is the whole fix. A change opens into what happened, the numbers it moved, when
 * it was read, and the one thing to do about it. One row open at a time.
 */

const TABS: Array<{ key: ResultsGroup; label: string; line: string }> = [
  // EACH ROW FINISHED AHEAD OR BEHIND ON ITS OWN DECLARED YARDSTICK: unchanged pages for a Google objective,
  // the account's own unaffected questions for an AI one. One shared sentence may not claim otherwise.
  // A READ AHEAD IS NOT A WIN (operator, 2026-09-01): "Worked" over rows whose live page was never read back claimed what nobody verified. The tab says what was read; the row says whether it was verified.
  { key: "worked", label: "Read ahead", line: "Each finished ahead on the yardstick it declared: unchanged pages for Google, unaffected questions for AI answers. Only a live-verified read teaches." },
  { key: "down", label: "Read behind", line: "Each fell behind on the yardstick it declared." },
  // NEUTRAL ENOUGH TO HOLD WHAT IS IN IT: inside the normal range, uncalled, split, and unmeasurable are
  // four different outcomes, and naming the group "No change" spoke for all four (Codex, 2026-08-21).
  { key: "flat", label: "Unclear", line: "Nothing here earned a verdict. Each row says which kind of silence it is." },
  { key: "reading", label: "Reading", line: "Nothing to decide here until the next read lands." },
];

/** THE ROW FITS THE SCREEN IT IS READ ON. Seven tracks whose fixed parts alone total 350px sat inside a 301px
 *  card at phone width, so every row overflowed by about a hundred pixels and the parent's overflow-hidden
 *  simply cut it off: the outcome figure and the chevron were unreachable exactly where the operator checks
 *  results. Narrow screens keep the four things a row is for, the state dot, what changed, the outcome and the
 *  control to open it, and the lift bar, the impressions figure and the read pips return at the first breakpoint
 *  that can hold them. No row is dropped and no figure changes; the same detail is one tap away in the panel. */
const GRID = "grid grid-cols-[14px_minmax(0,1fr)_84px_20px] sm:grid-cols-[14px_minmax(0,1fr)_96px_84px_72px_64px_20px] items-center gap-2";

const DOT: Record<ResultsRow["dot"], string> = {
  emerald: "bg-emerald-500", rose: "bg-rose-500", grey: "bg-foreground/25", sky: "bg-sky-400",
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

/** The one shared scale, drawn: green to the right of the zero tick, rose to the left. */
function LiftBar({ value, opacity }: { value: number | null; opacity: number }) {
  if (value == null) {
    return (
      <svg width="96" height="14" viewBox="0 0 96 14" aria-hidden className="shrink-0 text-foreground/25">
        <rect x="42" y="6" width="12" height="2" rx="1" fill="currentColor" />
      </svg>
    );
  }
  const w = Math.max(1, Math.abs(value) * 46);
  return (
    <svg width="96" height="14" viewBox="0 0 96 14" aria-hidden className="shrink-0">
      <rect x="47.5" y="1" width="1" height="12" fill="currentColor" className="text-foreground/30" />
      <rect
        x={value >= 0 ? 48 : 48 - w} y="4" width={w} height="6" rx="1" fill="currentColor" opacity={opacity}
        className={value >= 0 ? "text-emerald-600" : "text-rose-600"}
      />
    </svg>
  );
}

function Row({ row, group, open, onToggle }: { row: ResultsRow; group: ResultsGroup; open: boolean; onToggle: () => void }) {
  // The verdict word replaces the number where a number would read as the answer, and where there is none to
  // print: an AI-judged row can win with no Google click figure at all. On those rows `liftLabel` is the
  // objective's own move in words, so this slot can never print a click decline in green under a win.
  const cell = group === "down" || group === "flat" ? (row.yardstick ? row.liftLabel ?? row.verdictWord : row.verdictWord)
    : group === "reading" ? row.readLabel
      : row.liftLabel ?? row.verdictWord;
  const cellTone = row.dot === "emerald" ? "text-emerald-700" : row.dot === "rose" ? "text-rose-700" : "text-muted-foreground";
  // THE GOOGLE HALF OF THE PANEL, IN ONE PIECE: the before and after, the site's own move and the pages this one stood against. On a row
  // judged on AI it is rendered inside the labelled aside below rather than in the answer slot, which is where it used to contradict the
  // verdict out loud. On a row judged on clicks it renders exactly where it always did.
  const googleBlock = (
    <>
      {row.numbers ? (
        <table className="mt-2 text-[12px] tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="w-16 text-left font-normal" />
              <th className="pr-5 text-left font-normal">Clicks</th>
              <th className="text-left font-normal">Impressions</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="text-muted-foreground">Before</td><td className="pr-5">{row.numbers.before[0]}</td><td>{row.numbers.before[1]}</td></tr>
            <tr><td className="text-muted-foreground">After</td><td className="pr-5">{row.numbers.after[0]}</td><td>{row.numbers.after[1]}</td></tr>
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">{row.numbersNote}</p>
      )}
      {row.unadjustedNote ? <p className="mt-1.5 text-[12px] text-muted-foreground">{row.unadjustedNote}</p> : null}
      {row.comparedAgainst.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Compared against</p>
          {row.comparedAgainst.map((c) => (
            <p key={c} className="text-[11px] text-muted-foreground">{c}</p>
          ))}
        </div>
      ) : null}
    </>
  );
  // WHICH YARDSTICK DECIDED THIS ROW. "Worked" has to mean the thing the change was aimed at, and a reader must never have to guess
  // whether it meant traffic or citations. On an AI judged row this sits directly under the answer, ahead of anything Google says.
  const aiBlock = row.aiLine ? (
    <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{row.yardstick ?? "AI answers"}</p>
      <p className="text-[11px] text-muted-foreground">{row.aiLine}</p>
      {/* The objective's own numbers sit under the sentence: a change raised to earn a citation
          showed only the mention line, so a flat citation rate read as the change working. */}
      {row.aiMetricLines.map((m) => (
        <p key={m} className="mt-1 text-[11px] text-muted-foreground">{m}</p>
      ))}
      {row.aiBoundary ? <p className="mt-1 text-[11px] text-status-warning">{row.aiBoundary}</p> : null}
    </div>
  ) : null;
  return (
    <div id={`change-${row.id}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className={`${GRID} h-11 w-full px-3 text-left hover:bg-surface-inset/60 ${FOCUS}`}>
        <span className={`h-2 w-2 rounded-full ${DOT[row.dot]}`} aria-hidden />
        <span className="flex min-w-0 items-center gap-1.5">
          {/* The page said the way a person says it; the address itself is one hover away. */}
          <span title={row.path} className="truncate text-[13px] font-medium text-foreground">{pageLabel(row.path)}</span>
          <span className="shrink-0 text-[12px] text-muted-foreground">&middot;</span>
          <span className="shrink-0 truncate text-[12px] text-muted-foreground">{row.work}</span>
          {row.chip ? (
            <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] ${row.chip.amber ? "bg-amber-50 text-amber-800" : "bg-surface-inset text-muted-foreground"}`}>
              {row.chip.text}
            </span>
          ) : null}
          {/* THE SECOND CHIP, AND THE ONLY OTHER ONE: a change whose recommendation was later retired reads exactly like a
              current one without it. The row keeps its state word, its number and its read; this adds the one missing fact. */}
          {row.retired ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">{row.retired.text}</span>
          ) : null}
        </span>
        <span className="hidden sm:block"><LiftBar value={row.bar} opacity={row.barOpacity} /></span>
        <span className={`text-[12px] leading-tight tabular-nums ${cellTone}`}>{cell}</span>
        <span className="hidden text-[12px] tabular-nums text-muted-foreground sm:block">{row.impressionsLabel ?? ""}</span>
        <span className="hidden flex-col gap-0.5 sm:flex">
          <span className="flex gap-1">
            {row.pips.map((p) => (
              <span
                key={p.day}
                title={`${p.day} day read`}
                className={`h-1.5 w-1.5 rounded-full ${p.state === "read" ? "bg-foreground/60" : p.state === "shared" ? "border border-amber-400" : "border border-border"}`}
              />
            ))}
          </span>
          <span className="text-[10px] text-muted-foreground">{row.pipCaption ?? ""}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open ? (
        <div className="bg-surface-inset px-3 py-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              {/* TWO THINGS, TWO SENTENCES (2026-09-05): what was applied and what the live page said about it is one fact, and what the reading learned is another. One block carried both, so "the page moved up after it" sat beside "never confirmed on the live page" with nothing saying which was which. */}
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What was applied</p>
              <p className="mt-1 text-[13px] text-foreground" data-execution="true">{row.execution}</p>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What the reading says</p>
              <p className="mt-1 text-[13px] text-foreground">{row.happened}</p>
              {row.googleAside ? aiBlock : null}
              {/* GOOGLE UNDER ITS OWN HEADING, never in the answer slot. A citation win printed the click decline as its story, so the
                  same panel said "Worked" at the top and "the page did not move" underneath with nothing naming which was which. */}
              {row.googleAside ? (
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{row.googleAside.heading}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{row.googleAside.line}</p>
                  {googleBlock}
                </div>
              ) : googleBlock}
              {row.googleAside ? null : aiBlock}
              {/* BOTH VERSIONS, WHERE THE OPERATOR APPLIED THEIR OWN (2026-09-05): the record keeps the prepared wording and the wording that went live, and the row showed neither, so nothing said whose words this reading is about. */}
              {row.appliedLines.map((a) => <p key={a} className="mt-1.5 text-[11px] text-muted-foreground" data-applied-wording="true">{a}</p>)}
              {row.retired ? <p className="mt-1.5 text-[11px] text-muted-foreground">{row.retired.note}</p> : null}
              {row.caveats.map((c) => (
                <p key={c} className="mt-1.5 text-[11px] text-amber-700">{c}</p>
              ))}
            </div>
            <ol className="space-y-1.5">
              {row.timeline.map((t) => (
                <li key={t.label} className="flex items-center gap-2 text-[12px]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.done ? "bg-foreground/60" : "border border-border"}`} aria-hidden />
                  <span className={t.done ? "text-foreground" : "text-muted-foreground"}>{t.label}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-3 text-[12px] text-foreground/80">{row.taught}</p>
          {/* AND WHAT THAT CHANGED IN WHAT GETS FUNDED NEXT, in the funding door's own rule and in the same words the belief at the top of this page uses. */}
          <p className="mt-1 text-[12px] text-foreground/80" data-funded="true">{row.funded}</p>
          {/* ONE next step per row, and it is the row's own: a win used to be sent off with the title
              advice whatever the change had actually been. Clickable where there is somewhere to go. */}
          {group === "worked" && row.liveConfirmed
            ? <Link href="/changes" className={`mt-1 block text-[12px] font-medium text-accent-primary underline underline-offset-2 ${FOCUS}`}>{row.nextStep}</Link>
            : <p className="mt-1 text-[12px] font-medium text-foreground">{row.nextStep}</p>}
          <div className="mt-2 flex justify-end gap-4 text-[12px] font-medium">
            <a href={row.url} target="_blank" rel="noreferrer" className={`text-accent-primary underline underline-offset-2 ${FOCUS}`}>Open page</a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ResultsRows({ view }: { view: ResultsView }) {
  const [group, setGroup] = useState<ResultsGroup>(view.defaultGroup);
  const [open, setOpen] = useState<string | null>(null);
  // A Brain link names one change by id. The ledger renders one tab at a time, so the link must first
  // switch to the tab that holds the row, open the ledger, expand the row, and only then scroll to it.
  useEffect(() => {
    const follow = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#change-/, ""));
      if (!id || !window.location.hash.startsWith("#change-")) return;
      const holder = (Object.keys(view.rows) as ResultsGroup[]).find((g) => view.rows[g].some((r) => r.id === id));
      if (!holder) return;
      setGroup(holder);
      setOpen(id);
      const ledger = document.querySelector<HTMLDetailsElement>("details[data-results-all-changes]");
      if (ledger) ledger.open = true;
      window.setTimeout(() => document.getElementById(`change-${id}`)?.scrollIntoView({ block: "start" }), 0);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [view.rows]);
  const rows = view.rows[group];
  const tab = TABS.find((t) => t.key === group)!;

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 pb-2 pt-1 backdrop-blur">
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-border-subtle p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setGroup(t.key); setOpen(null); }}
              aria-pressed={group === t.key}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${FOCUS} ${group === t.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {/* A ZERO ON A TAB IS NOT A NUMBER WORTH PRINTING: "Worked 3 · Went down 0 · No change 0" made an
                  account with three wins read as a scoreboard of failures. An empty tab is just its name. */}
              {t.label}{view.counts[t.key] > 0 ? <span className="tabular-nums"> {view.counts[t.key]}</span> : null}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground">{tab.line}</p>
      </div>

      {rows.length === 0 ? (
        // NEVER A DEAD END, AND NEVER "1 changes". With something still reading the button goes there; with
        // nothing reading it said so over a button onto an equally empty tab, so it says what fills this instead.
        <div className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-6 text-[13px] text-muted-foreground">
          {view.counts.reading > 0 ? (
            <>
              Nothing here yet. {view.counts.reading} {view.counts.reading === 1 ? "change is" : "changes are"} still reading.{" "}
              <button type="button" onClick={() => setGroup("reading")} className={`font-medium text-accent-primary underline underline-offset-2 ${FOCUS}`}>
                See what is reading
              </button>
            </>
          ) : "Nothing here yet. New changes appear here after Mark done on a change."}
        </div>
      ) : (
        <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
          {rows.map((r) => (
            <Row key={r.id} row={r} group={group} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
