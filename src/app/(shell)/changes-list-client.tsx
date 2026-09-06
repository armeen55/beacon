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
import { dismissProposalAction, loadMoreChangesAction, markManyImplementedAction } from "./changes/actions";
import { CHANGES_PAGE_SIZE } from "./changes/types";

type Lane = "ready" | "todo" | "research";
/** How long a skip stays takeable-back before the store is told. Nothing is written until it ends. */
const UNDO_MS = 10_000;

/** The plain-language kind of work a preparing row is, for the collapsed lane's tally: what a customer calls it, never a producer slug.
 *  WHAT it is comes from the field; WHAT IS HAPPENING TO IT comes from the row's own typed obligation and nothing else (2026-09-04).
 *  "being written and checked" was printed over every unfinished row of a field, so a change waiting on a source read, one waiting on
 *  Beacon's own reviewer and one genuinely being written all said the same thing, and the lane could not be told apart from a stall. */
const preparingKind = (p: ChangeProposal): string => {
  const c = p.recommendedChange, field = c.kind === "existing_edit" ? c.field : null;
  const what = c.kind === "new_page" ? "new pages"
    : p.id.endsWith("::internal_link") ? "links between your own pages"
    : field === "meta" ? "page descriptions"
    : field === "section" || field === "answer_block" ? "sections and answers"
    : field === "title" || field === "h1" ? "titles and headings" : "changes";
  const owed = p.obligation?.kind;
  return `${what} ${owed === "evidence" ? "waiting on a source read" : owed === "review" ? "waiting on Beacon's own reviewer"
    : owed === "draft" || owed === "sections" || owed === "redraft" ? "being written" : owed === "terminal" ? "settled until the evidence changes" : "waiting for the next pass"}`;
};

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
  const [at, setAt] = useState<number>(view.queueCursor?.ready ?? view.queueCursor?.all ?? view.proposals.length); // the finished lane's own cursor: its Show more continues the READY lane, never the global page
  const [release, setRelease] = useState<string | null>(view.surfaceVersion ?? null);
  // READY PAGES ALONE. The one load-more control belongs to the finished lane: it starts at the global
  // first page's cursor (every ready row at or before it is already on screen, so nothing is skipped and
  // nothing repeats) and asks the server for ready rows only.
  const [canMore, setCanMore] = useState<boolean>(true);
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
    // FAIL CLOSED WITHOUT THE SERVER VERDICT. The stamped lane above carries BOTH legs of the one servability rule (blocking hold AND unsettled cause, computed server-side); this browser fallback can ask only the first, because the second leg's import chain is server-only. A row no stamp knows therefore never wears Ready here: offering Copy off half the verdict is exactly the list-versus-detail disagreement the one rule exists to end, and in practice every served row arrives stamped.
    return hold.lane === "research" ? "research" : "todo";
  }, [moreLanes, view]);
  const rows = useMemo(() => raw.filter((p) => !hidden.includes(p.id)), [raw, hidden]);
  // THE VISIBLE SEQUENCE IS THE READY LANE'S OWN, 1..N with no gaps (operator, 2026-08-27): the stored global
  // rank still orders everything, but a customer reading finished work must never see 1, 5, 11, 19 because
  // internal lanes sit hidden between them. Each numbered section counts its own cards.

  const readyRows = useMemo(() => rows.filter((p) => laneOf(p) === "ready"), [rows, laneOf]);
  // A row carrying BOTH a genuine safety decision AND a Beacon fault belongs to Beacon first: the operator is
  // never asked to authorize work Beacon itself knows is defective (approved contract, 2026-08-27).
  const decisionRows = useMemo(() => rows.filter((p) => { if (laneOf(p) !== "todo") return false; const h = openHold(p); return h.safetyHold && !h.faulted; }), [rows, laneOf]);
  const preparingRows = useMemo(() => rows.filter((p) => { if (laneOf(p) === "research") return true; if (laneOf(p) !== "todo") return false; const h = openHold(p); return !(h.safetyHold && !h.faulted); }), [rows, laneOf]);
  // THE WORKING-ON COUNT IS THE DATABASE'S, NEVER THE RENDERED PAGE'S (operator, 2026-08-30): past one page, counting rendered rows silently under-reported the work in progress with no control to reach the rest.
  const workingTotal = Math.max(preparingRows.length, (view.summary.todo ?? 0) + (view.summary.research ?? 0) - decisionRows.length);
  // THE HEADLINE COUNT IS FINISHED WORK AND NOTHING ELSE (2026-08-15), and it must be true of every row under
  // the Ready heading: the whole-lane total from the database, minus what this session finished or skipped.
  const openTotal = Math.max(0, readyRows.filter((p) => !finished.includes(p.id)).length
    + Math.max(0, (view.summary.ready ?? 0) - readyRows.length));
  // WHAT IS LEFT TO LOAD IS FINISHED WORK ONLY: the ready lane's own database total minus the ready rows
  // already on screen. Internal lanes have no pagination to share.
  const loadedReady = useMemo(() => raw.filter((p) => laneOf(p) === "ready").length, [raw, laneOf]);
  const remaining = Math.max(0, (moved?.total ?? view.summary.ready ?? 0) - loadedReady - lost);
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
  // BULK MARK DONE (operator ruling, 2026-08-29), offered only in the Ready lane and only now that the
  // record-then-flip race is closed: ticking claims nothing, ONE press records every ticked change through
  // the same per-change transaction, one card failing never erases the others, and the answer names counts.
  const [picked, setPicked] = useState<string[]>([]);
  // WHY EACH ROW THE BATCH REFUSED WAS REFUSED, kept per row: one first error under twenty cards named the problem and never which card had it.
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [bulkPending, startBulk] = useTransition();
  const pick = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const markPicked = () => startBulk(async () => {
    const n = picked.length;
    say(`Recording ${n} ${n === 1 ? "change" : "changes"}…`); // said the moment the press lands; the durable answer replaces it
    const res = await markManyImplementedAction({ proposalIds: picked }).catch(() => null);
    if (!res) { say("That could not be recorded just now. Press it again in a moment."); return; }
    const failedIds = new Set(res.failed.map((f) => f.id));
    setFinished((prev) => [...prev, ...picked.filter((id) => !failedIds.has(id))]); // FAILED ROWS STAY SELECTED AND VISIBLE; recorded rows leave the list only after the durable answer
    setPicked(picked.filter((id) => failedIds.has(id)));
    // THE COUNT AND THE CARDS MOVE TOGETHER. Every id this press sent gets its answer on its own card: a recorded one flips to "Done. Measuring from ..." where it sits, and a refused one carries its own reason and stays pressable. The count dropping while the cards it counted still offer Copy and Mark done is the one thing a batch may never do.
    setProblems((prev) => ({ ...prev, ...Object.fromEntries(picked.map((id) => [id, ""])), ...Object.fromEntries(res.failed.map((f) => [f.id, f.error])) }));
    const doneWord = res.done > 0 ? `${res.done} ${res.done === 1 ? "change" : "changes"} recorded.` : "";
    say([doneWord, res.already > 0 ? `${res.already} already being measured.` : "", res.failed.length > 0 ? `${res.failed.length} could not be recorded, and each one says why on its own card.` : ""].filter(Boolean).join(" ") || res.note);
  });

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
            {view.readyZeroHint}{/* THE LANE'S OWN SENTENCE COMES OFF THE VIEW: a second copy here said it in different words, and two screens wording one fact two ways is the drift the one map exists to end. */}
          </p>
        ) : (
          <ul className="list-none space-y-3">
            {readyRows.map((p, i) => (
              <ChangeCard key={p.id} proposal={p} rank={i + 1} ready review={false} caseLine={caseLineOf(p)}
                onAside={putAside} onDone={(id) => setFinished((prev) => [...prev, id])} onToast={say}
                recorded={finished.includes(p.id)} problem={problems[p.id] || null}
                picked={picked.includes(p.id)} onPick={pick} />
            ))}
          </ul>
        )}
        {picked.length > 0 ? (
          <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-accent-primary/50 bg-surface-raised px-4 py-2 shadow-lg" data-bulk-bar="true">
            <p className="text-[13px] font-semibold text-foreground">{picked.length} selected</p>
            <button type="button" data-bulk-done="true" disabled={bulkPending} onClick={markPicked}
              className="rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
              {bulkPending ? `Recording ${picked.length}…` : `Mark ${picked.length} done`}
            </button>
          </div>
        ) : null}
        {canMore && remaining > 0 ? (
          <button type="button" disabled={loadingMore} data-show-more="true"
            onClick={() => startLoadMore(async () => {
              const res = await loadMoreChangesAction({ lane: "ready", cursor: at, releaseId: release });
              setRelease(res.releaseId);
              setAt(res.cursor);
              setCanMore(res.more);
              setLost((prev) => (res.refreshed ? 0 : prev + res.dropped));
              setMoved((prev) => (res.refreshed ? { note: res.refreshed, total: res.total } : prev ? { ...prev, total: res.total } : prev));
              setMoreLanes((prev) => ({ ...prev, ...res.laneById }));
              setMore((prev) => (res.refreshed ? res.rows : [...prev, ...res.rows]));
            })}
            className="w-full rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted-foreground tabular-nums hover:text-foreground disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : `Show ${Math.min(remaining, CHANGES_PAGE_SIZE).toLocaleString("en-US")} more finished ${remaining === 1 ? "change" : "changes"}`}
          </button>
        ) : null}
      </section>

      {/* NEEDS YOUR DECISION: the ONE lane that is genuinely the operator's, and only that. A redirect, merge or
          removal is complete work awaiting an authority Beacon does not have. Everything else held in review is
          Beacon's own unfinished responsibility (weak writing, missing evidence, an unread evaluator) and is
          never offered to the customer as work: at ten to thirty applied changes a day, inspecting Beacon's QA
          debt was the operator's single biggest time sink (operator-approved contract, 2026-08-27). */}
      {decisionRows.length > 0 ? (
        <section className="space-y-3" data-lane-decision="true">
          <p className="text-[14px] font-semibold tabular-nums text-foreground">
            Needs your decision: {decisionRows.length.toLocaleString("en-US")}
          </p>
          <ul className="list-none space-y-3">
            {decisionRows.map((p, i) => (
              <ChangeCard key={p.id} proposal={p} rank={i + 1} review caseLine={caseLineOf(p)}
                onAside={putAside} onDone={(id) => setFinished((prev) => [...prev, id])} onToast={say} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* BEACON IS PREPARING: internal work, collapsed and compact. Each row is one sentence about what
          Beacon is doing; the full evidence stays on the row's own detail page, one click away. */}
      {preparingRows.length > 0 ? (
        <details className="rounded-2xl border border-border bg-surface-raised" data-lane-preparing="true">
          <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold tabular-nums text-foreground">
            Beacon is working on {workingTotal.toLocaleString("en-US")} more {workingTotal === 1 ? "opportunity" : "opportunities"}
            <span className="ml-2 font-normal text-muted-foreground">Writing, checking and evidence still in progress. Nothing here is yours to do yet.</span>
          </summary>
          {/* ONE TALLY PER KIND OF WORK, never the inventory (Product Truth; operator, 2026-08-31): printing every
              unfinished row made the operator Beacon's own progress clerk. What a person opening this line needs is
              the shape of what is coming, in plain words, one line per kind. */}
          <ul className="list-none space-y-1 px-4 pb-3">
            {[...preparingRows.reduce((m, p) => { const k = preparingKind(p); m.set(k, (m.get(k) ?? 0) + 1); return m; }, new Map<string, number>())]
              .sort((a, b) => b[1] - a[1])
              .map(([kind, n]) => (
                <li key={kind} className="flex items-baseline gap-x-2 border-t border-border/60 py-2 text-[13px] tabular-nums" data-preparing-kind="true">
                  <span className="font-medium text-foreground">{n.toLocaleString("en-US")}</span>
                  <span className="text-muted-foreground">{kind}</span>
                </li>
              ))}
          </ul>
        </details>
      ) : null}

      {/* The one load-more lives under Ready above: finished work pages alone, and internal work never
          shares its pagination (operator, 2026-08-27). */}

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
