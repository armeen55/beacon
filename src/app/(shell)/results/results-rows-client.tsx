"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import type { ResultsView } from "./results-presentation";

type ResultsGroup = keyof ResultsView["rows"];
type ResultsRow = ResultsView["rows"]["worked"][number];

/**
 * The Results list: one sticky strip that picks which answer you are looking at, then one line per
 * change. The line is the whole fix. A change opens into what happened, the numbers it moved, when
 * it was read, and the one thing to do about it. One row open at a time.
 */

const TABS: Array<{ key: ResultsGroup; label: string; line: string }> = [
  { key: "worked", label: "Worked", line: "These beat similar pages that were not changed." },
  { key: "down", label: "Went down", line: "These fell behind similar pages that were not changed." },
  { key: "flat", label: "No change", line: "These landed inside the normal range of similar pages." },
  { key: "reading", label: "Reading", line: "Nothing to decide here until the next read lands." },
];

const GRID = "grid grid-cols-[14px_minmax(0,1fr)_96px_84px_72px_64px_20px] items-center gap-2";

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
  // The verdict word replaces the number where a number would be read as the answer.
  const cell = group === "down" || group === "flat" ? row.verdictWord
    : group === "reading" ? row.readLabel
      : row.liftLabel;
  const cellTone = group === "worked" ? "text-emerald-700" : group === "down" ? "text-rose-700" : "text-muted-foreground";
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className={`${GRID} h-11 w-full px-3 text-left hover:bg-surface-inset/60 ${FOCUS}`}>
        <span className={`h-2 w-2 rounded-full ${DOT[row.dot]}`} aria-hidden />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">{row.path}</span>
          <span className="shrink-0 text-[12px] text-muted-foreground">&middot;</span>
          <span className="shrink-0 truncate text-[12px] text-muted-foreground">{row.work}</span>
          {row.chip ? (
            <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] ${row.chip.amber ? "bg-amber-50 text-amber-800" : "bg-surface-inset text-muted-foreground"}`}>
              {row.chip.text}
            </span>
          ) : null}
        </span>
        <LiftBar value={row.bar} opacity={row.barOpacity} />
        <span className={`text-[12px] leading-tight tabular-nums ${cellTone}`}>{cell}</span>
        <span className="text-[12px] tabular-nums text-muted-foreground">{row.impressionsLabel ?? ""}</span>
        <span className="flex flex-col gap-0.5">
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
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What happened</p>
              <p className="mt-1 text-[13px] text-foreground">{row.happened}</p>
              {row.numbers ? (
                <table className="mt-2 text-[12px] tabular-nums">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="w-16 text-left font-normal" />
                      <th className="pr-5 text-left font-normal">Clicks</th>
                      <th className="text-left font-normal">Appearances</th>
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
          {group === "worked" ? null : <p className="mt-1 text-[12px] font-medium text-foreground">{row.nextStep}</p>}
          <div className="mt-2 flex justify-end gap-4 text-[12px] font-medium">
            <a href={row.url} target="_blank" rel="noreferrer" className={`text-accent-primary underline underline-offset-2 ${FOCUS}`}>Open page</a>
            {group === "worked" ? (
              <Link href="/changes" className={`text-accent-primary underline underline-offset-2 ${FOCUS}`}>Do this again on a similar page</Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ResultsRows({ view }: { view: ResultsView }) {
  const [group, setGroup] = useState<ResultsGroup>(view.defaultGroup);
  const [open, setOpen] = useState<string | null>(null);
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
              {t.label} <span className="tabular-nums">{view.counts[t.key]}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground">{tab.line}</p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-6 text-[13px] text-muted-foreground">
          Nothing here yet. {view.counts.reading} changes are still reading.{" "}
          <button type="button" onClick={() => setGroup("reading")} className={`font-medium text-accent-primary underline underline-offset-2 ${FOCUS}`}>
            See what is reading
          </button>
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
