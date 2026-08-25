"use client";

/** changes-list-client - COMPLETE WORK FIRST, AND ONLY COMPLETE WORK CALLED WORK (operator, 2026-08-21). The
 *  screen opens on READY NOW (finished, pasteable changes, best first), then NEEDS YOUR REVIEW (complete
 *  drafts held for one judgement), then BEACON IS PREPARING, collapsed and compact, because internal research
 *  is Beacon's work and never the operator's assignment. One persisted global rank still orders every lane
 *  internally; the lanes decide the controls and where a row renders. One compact line points at measurement,
 *  which Results owns. Publishing is MANUAL: the only mutating controls are "Mark done" and "Skip". */

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { ChangesView } from "./changes-data";
import type { ChangeProposal } from "@/domains/decision";
import { ChangeCard } from "./changes/change-card";
import { openHold } from "@/domains/decision/completeness";
import { pageLabel } from "./changes/types";
import { dismissProposalAction, loadMoreChangesAction } from "./changes/actions";
import { CHANGES_PAGE_SIZE } from "./changes/types";

type Lane = "ready" | "todo" | "research";
/** How long a skip stays takeable-back before the store is told. Nothing is written until it ends. */
const UNDO_MS = 10_000;

/** WHAT BEACON IS DOING ON A PREPARING ROW, in one plain sentence per kind of work. The full internal
 *  argument stays on the row's own detail page; the default screen never renders the research essay. */
const PREPARING: [RegExp, string][] = [
  [/::ownership$/, "Reading the competing pages before writing distinct titles and openings."],
  [/::researching$/, "Reading the results page for this search before naming the exact change."],
  [/::(ai_answer_gap|engine_followup)$/, "Comparing this page with the sources assistants credit before writing the section."],
  [/::missing_description$/, "Writing a page-specific description from the stored page."],
  [/::thin_page$/, "Reading what the winning pages cover that this one does not."],
  [/::internal_link$/, "Writing the linking sentence from both pages' stored copy."],
  [/::duplicate_heading$/, "Writing a distinct heading from this page's own stored copy."],
];
const preparingLine = (p: ChangeProposal): string =>
  PREPARING.find(([re]) => re.test(p.id))?.[1] ?? "Preparing the exact change from stored evidence.";

export function ChangesListClient({ view }: { view: ChangesView }) {
  // WHAT WAS DECIDED ABOUT THE SEARCH A CHANGE ANSWERS, off the ONE case file Visibility reads, matched on
  // the canonical case identity and never on wording. An unreadable file says nothing at all.
  const caseLineOf = (p: ChangeProposal): string | null => {
    const key = p.aiScope?.caseKey;
    if (!key || view.aiCases.state !== "read") return null;
    return view.aiCases.rows.find((d) => d.caseKey === key)?.reason ?? null;
  };
  // ONE CURSOR IN ONE RANKING. The cursor is a position; when the background rebuild replaced the ranking,
  // the server says so and the list restarts from the fresh first page.
  const [more, setMore] = useState<ChangeProposal[]>([]);
  const [moreLanes, setMoreLanes] = useState<Record<string, Lane>>({});
  const [at, setAt] = useState<number>(view.queueCursor?.all ?? view.proposals.length);
  const [release, setRelease] = useState<string | null>(view.surfaceVersion ?? null);
  const [canMore, setCanMore] = useState<boolean>(view.queueMore?.all ?? true);
  const [moved, setMoved] = useState<{ note: string; total: number } | null>(null);
  const [lost, setLost] = useState<number>(0); // refusals a deeper page found
  const [hidden, setHidden] = useState<string[]>([]);
  // Marked done in this session. The row stays on screen saying so; the open count drops on the press.
  const [finished, setFinished] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [loadingMore, startLoadMore] = useTransition();
  // A RESTARTED LIST SHOWS THE FRESH PAGE AND NOTHING ELSE: rows from a ranking that went away are dropped
  // rather than stacked under the new ones, which is the only way "each change once" survives.
  const raw = useMemo(() => (moved ? more : [...view.proposals, ...more]), [moved, more, view]);
  // THE STAMPED LANE IS THE ONE SOURCE of what a card may offer; a row the stamp does not know asks the SAME servability verdict every other surface asks, never the raw status: `p.status === "ready"` here was the one reader that could render Ready with no hold consulted at all.
  const laneOf = useMemo(() => (p: ChangeProposal): Lane => {
    const stamped = moreLanes[p.id] ?? view.laneById?.[p.id]; if (stamped) return stamped;
    const hold = openHold(p);
    return hold.lane === "research" ? "research" : p.status === "ready" && hold.blocking == null ? "ready" : "todo";
  }, [moreLanes, view]);
  const rows = useMemo(() => raw.filter((p) => !hidden.includes(p.id)), [raw, hidden]);
  const readyRows = useMemo(() => rows.filter((p) => laneOf(p) === "ready"), [rows, laneOf]);
  const reviewRows = useMemo(() => rows.filter((p) => laneOf(p) === "todo"), [rows, laneOf]);
  const preparingRows = useMemo(() => rows.filter((p) => laneOf(p) === "research"), [rows, laneOf]);
  // THE HEADLINE COUNT IS FINISHED WORK AND NOTHING ELSE (2026-08-15), and it must be true of every row under
  // the Ready heading: the whole-lane total from the database, minus what this session finished or skipped.
  const openTotal = Math.max(0, readyRows.filter((p) => !finished.includes(p.id)).length
    + Math.max(0, (view.summary.ready ?? 0) - readyRows.length));
  const remaining = Math.max(0, (view.queueTotal ?? (moved?.total ?? rows.length)) - raw.length - lost);
  const measuring = view.countsUnavailable ? null : view.measuringCountCanonical;
  const wins = view.countsUnavailable ? null : view.wonCountCanonical ?? null;

  /** OPTIMISTIC, AND TAKEABLE BACK: nothing reaches the store until the ten seconds are up. */
  function putAside(id: string) {
    setHidden((prev) => [...prev, id]);
    const timer = setTimeout(() => { timers.current.delete(id); void dismissProposalAction({ proposalId: id }); }, UNDO_MS);
    timers.current.set(id, timer);
    setToast({
      text: "Skipped. It will not come back unless its evidence changes.",
      undo: () => { const t = timers.current.get(id); if (t) clearTimeout(t); timers.current.delete(id);
        setHidden((prev) => prev.filter((x) => x !== id)); setToast(null); },
    });
    setTimeout(() => setToast((cur) => (cur && cur.undo ? null : cur)), UNDO_MS);
  }
  const say = (text: string) => { setToast({ text, undo: null }); setTimeout(() => setToast((c) => (c?.text === text ? null : c)), 3000); };

  return (
    <div className="space-y-5">
      {moved ? <p data-list-moved="true" className="text-[12px] text-amber-800">{moved.note}</p> : null}

      {/* READY NOW: complete, executable work only, best first. The count counts exactly what sits here. */}
      <section className="space-y-3" data-lane-ready="true">
        <p className="text-[14px] font-semibold tabular-nums text-foreground" data-open-count="true">
          Ready now: {openTotal.toLocaleString("en-US")} finished {openTotal === 1 ? "change" : "changes"}
        </p>
        {readyRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-5 text-[13px] leading-relaxed text-muted-foreground">
            {view.readyZeroHint ?? "No finished change is ready right now. The next one lands here the moment the exact work is written."}
          </p>
        ) : (
          <ul className="list-none space-y-3">
            {readyRows.map((p, i) => (
              <ChangeCard key={p.id} proposal={p} rank={i + 1} ready review={false} caseLine={caseLineOf(p)}
                onAside={putAside} onDone={(id) => setFinished((prev) => [...prev, id])} onToast={say} />
            ))}
          </ul>
        )}
      </section>

      {/* TWO DIFFERENT THINGS WEAR ONE LABEL NO LONGER: a draft Beacon's own gates already refused is NOT waiting on anybody's taste, and calling it "Needs your review" hands a known failure back as if the reader were the missing ingredient. Copy nothing has objected to is the only kind that owes a judgement. Read off the row's own blocking reason, so a card moves the moment its stored reasons change. */}
      {([["Beacon must improve", reviewRows.filter((p) => openHold(p).faulted)], ["Needs your review", reviewRows.filter((p) => !openHold(p).faulted)]] as const)
        .filter(([, rows]) => rows.length > 0).map(([title, rows]) => (
        <section key={title} className="space-y-3" data-lane-review="true">
          <p className="text-[14px] font-semibold tabular-nums text-foreground">
            {title}: {rows.length.toLocaleString("en-US")} {rows.length === 1 ? "draft" : "drafts"}
          </p>
          <ul className="list-none space-y-3">
            {rows.map((p, i) => (
              <ChangeCard key={p.id} proposal={p} rank={i + 1} review caseLine={caseLineOf(p)}
                onAside={putAside} onDone={(id) => setFinished((prev) => [...prev, id])} onToast={say} />
            ))}
          </ul>
        </section>
      ))}

      {/* BEACON IS PREPARING: internal work, collapsed and compact. Each row is one sentence about what
          Beacon is doing; the full evidence stays on the row's own detail page, one click away. */}
      {preparingRows.length > 0 ? (
        <details className="rounded-2xl border border-border bg-surface-raised" data-lane-preparing="true">
          <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold tabular-nums text-foreground">
            Future opportunities ({preparingRows.length.toLocaleString("en-US")})
            <span className="ml-2 font-normal text-muted-foreground">Evidence Beacon is still gathering. Nothing here is yours to do yet.</span>
          </summary>
          <ul className="list-none space-y-1 px-4 pb-3">
            {preparingRows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 border-t border-border/60 py-2 text-[13px]" data-preparing-row="true">
                <span className="font-medium text-foreground">{p.pagePath ? pageLabel(p.pagePath) : p.pageLabel}</span>
                <span className="text-muted-foreground">{preparingLine(p)}</span>
                <Link href={`/changes/${encodeURIComponent(p.id)}`} className="text-[12px] font-semibold text-accent-primary underline underline-offset-2" data-research-detail="true">Details</Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canMore && remaining > 0 ? (
        <button type="button" disabled={loadingMore} data-show-more="true"
          onClick={() => startLoadMore(async () => {
            const res = await loadMoreChangesAction({ lane: "all", cursor: at, releaseId: release });
            setRelease(res.releaseId);
            setAt(res.cursor);
            setCanMore(res.more);
            // A fresh first page's refusals are already out of its own total; only DEEPER pages accumulate.
            setLost((prev) => (res.refreshed ? 0 : prev + res.dropped));
            setMoved((prev) => (res.refreshed ? { note: res.refreshed, total: res.total } : prev ? { ...prev, total: res.total } : prev));
            setMoreLanes((prev) => ({ ...prev, ...res.laneById }));
            setMore((prev) => (res.refreshed ? res.rows : [...prev, ...res.rows]));
          })}
          className="w-full rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted-foreground tabular-nums hover:text-foreground disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : remaining <= CHANGES_PAGE_SIZE ? `Show ${remaining} more` : `Show ${CHANGES_PAGE_SIZE} more of ${remaining}`}
        </button>
      ) : null}

      {/* THE ONE COMPACT LINE TO MEASUREMENT. Results owns the ledger; this only points at it, and a ledger
          that could not be read gets one compact sentence, never a zero and never an empty claim. */}
      {measuring == null ? (
        <p className="text-[13px] text-muted-foreground" data-measurement-line="unread">
          What is measuring could not be read just now.{" "}
          <Link href="/results" className="font-semibold text-accent-primary underline underline-offset-2">Results has the full ledger</Link>
        </p>
      ) : measuring > 0 || (wins ?? 0) > 0 ? (
        <p className="text-[13px] tabular-nums text-muted-foreground" data-measurement-line="true">
          {measuring.toLocaleString("en-US")} {measuring === 1 ? "change" : "changes"} measuring
          {wins != null && wins > 0 ? ` · ${wins.toLocaleString("en-US")} clear ${wins === 1 ? "win" : "wins"}` : ""}
          {" · "}
          <Link href="/results" className="font-semibold text-accent-primary underline underline-offset-2">View Results</Link>
        </p>
      ) : null}

      {toast ? (
        <div role="status" aria-live="polite" data-toast="true"
          className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2 text-[12px] text-foreground shadow-sm">
          <span>{toast.text}</span>
          {toast.undo ? (
            <button type="button" onClick={toast.undo} className="font-semibold underline underline-offset-2">Undo</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
