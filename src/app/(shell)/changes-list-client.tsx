"use client";

/** changes-list-client: ONE flat ranked queue of every change, best first. THE FLIP THIS FILE EXISTS FOR
 *  (2026-08-11): the Ready / Needs review tabs made half the work invisible behind a tab nobody pressed, and
 *  the half that showed was framed as work in progress rather than work to do. Every card is now in one list,
 *  fully rendered, carrying its own chip saying how proven it is. This file owns the LIST (the filter and sort
 *  the operator drives, the database paging, and the one place a put-aside can be taken back); one card owns
 *  everything said about one change. Publishing is MANUAL: the only mutating controls anywhere in here are
 *  "Mark done" and "Skip". */

import { useMemo, useRef, useState, useTransition } from "react";
import type { ChangesView } from "./changes-data";
import type { ChangeProposal } from "@/domains/decision";
import { ChangeCard } from "./changes/change-card";
import { dismissProposalAction, loadMoreChangesAction } from "./changes/actions";
import { CHANGES_PAGE_SIZE } from "./changes/types";

type Lane = "ready" | "todo";
type Sort = "rank" | "gap" | "quick";

/** THE PROVEN / EARLY / BEST GUESSES FILTER IS GONE. It sorted the queue by how finished the work LOOKED, over a
 *  list that mixed finished changes with instructions to go and write one, so "Best guesses" read as a tray of
 *  things to do. Evidence strength stays on the card, where it is a fact about the argument.
 *
 *  BUT ONE FLAT LIST WAS THE WRONG LESSON. The two lanes were merged into one ranked list and the card offered
 *  Copy and Mark done on every row in it, so a change still waiting on a human look ("needs_review", the stage
 *  Product Truth puts BEFORE ready) presented as a paste-ready deliverable: three of the five cards on this
 *  screen were work nobody had validated, wearing the same buttons as work that had cleared every gate. Ready
 *  work is one list. Everything still waiting on a look sits below it, plainly labelled, with nothing on it to
 *  press: reading it is the whole of what an operator can do with it, and that is said rather than implied. */
const SORTS: [Sort, string][] = [["rank", "Rank"], ["gap", "Biggest gap"], ["quick", "Quickest"]];
/** How long a skip stays takeable-back before the store is told. Nothing is written until it ends. */
const UNDO_MS = 10_000;

export function ChangesListClient({ view }: { view: ChangesView }) {
  // WHAT WAS DECIDED ABOUT THE SEARCH A CHANGE ANSWERS, off the ONE case file Visibility reads. Matched on the
  // canonical case identity the card carries, never on wording that merely resembles it, and an unreadable
  // file says nothing at all rather than letting a card imply a verdict nobody reached.
  const caseLineOf = (p: ChangeProposal): string | null => {
    const key = p.aiScope?.caseKey;
    if (!key || view.aiCases.state !== "read") return null;
    return view.aiCases.rows.find((d) => d.caseKey === key)?.reason ?? null;
  };
  const [sort, setSort] = useState<Sort>("rank");
  // THE QUEUE IS UNLIMITED AND THE SCREEN IS NOT: the server cuts one page per lane in the database and counts
  // the rest there too, so what is behind this screen is a fact rather than a length. The two lanes survive as
  // PAGING lanes only; the operator never sees them.
  const [more, setMore] = useState<Record<Lane, ChangeProposal[]>>({ ready: [], todo: [] });
  // THE CURSOR IS A POSITION IN A RANKING, so the ranking it was taken against travels with every press. When
  // the background rebuild has replaced it, the server says so and this lane restarts from the top.
  const [at, setAt] = useState<Record<Lane, number>>(view.queueCursor ?? { ready: view.ready.length, todo: view.toDo.length });
  const [release, setRelease] = useState<string | null>(view.surfaceVersion ?? null);
  // THE BUTTON DIES ON WHAT THE DATABASE READ: a short raw page means the lane is exhausted however many rows a
  // count still names. A view with no page verdict yet defaults open; the first press settles it.
  const [canMore, setCanMore] = useState<Record<Lane, boolean>>(view.queueMore ?? { ready: true, todo: true });
  const [moved, setMoved] = useState<{ lane: Lane; note: string; total: number } | null>(null);
  const [lost, setLost] = useState<Record<Lane, number>>({ ready: 0, todo: 0 }); // refusals a deeper page found
  const [hidden, setHidden] = useState<string[]>([]);
  // Marked done in this session. The row stays on screen saying so; the open count drops on the press.
  const [finished, setFinished] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [loadingMore, startLoadMore] = useTransition();
  // A RESTARTED LANE SHOWS THE FRESH PAGE AND NOTHING ELSE: rows from the ranking that went away are dropped
  // rather than stacked under the new ones, which is the only way "each change once" survives.
  const laneRows = useMemo(() => (l: Lane): ChangeProposal[] =>
    moved?.lane === l ? more[l] : [...(l === "ready" ? view.ready : view.toDo), ...more[l]], [moved, more, view]);
  // THE ONE DIVIDING LINE ON THIS SCREEN: the row's own stage. Nothing about how it looks, how strong its
  // evidence is or which lane it was paged out of decides it, so a card can never present above its stage.
  const raw = useMemo(() => [...laneRows("ready"), ...laneRows("todo")], [laneRows]);
  const readyIds = useMemo(() => new Set(raw.filter((p) => p.status === "ready").map((p) => p.id)), [raw]);
  const order = useMemo(() => (kept: ChangeProposal[]) => {
    // QUICKEST TIES BREAK ON STAGE: two one-minute changes are not equal work, and the validated one is the one
    // to do first.
    const proven = (p: ChangeProposal) => (readyIds.has(p.id) ? 0 : 1);
    if (sort === "quick") return [...kept].sort((a, b) => a.estimatedEffortMinutes - b.estimatedEffortMinutes || proven(a) - proven(b));
    if (sort === "gap") return [...kept].sort((a, b) => (b.upsidePerMonth ?? b.impactScore ?? 0) - (a.upsidePerMonth ?? a.impactScore ?? 0));
    return kept;
  }, [sort, readyIds]);
  const shown = useMemo(() => raw.filter((p) => !hidden.includes(p.id)), [raw, hidden]);
  const rows = useMemo(() => order(shown.filter((p) => p.status === "ready")), [order, shown]);
  const review = useMemo(() => order(shown.filter((p) => p.status !== "ready")), [order, shown]);
  // THE COUNT ON THE SCREEN IS THE COUNT OF THE LIST UNDER IT: a replaced ranking restarts its lane (the old
  // total said 35 above a list holding 12), `lost` takes off what a DEEPER page refused, and a change the
  // operator just put aside comes off it too, so it only ever falls.
  const countOf = (l: Lane) => (moved?.lane === l ? moved.total : l === "ready" ? view.summary.ready : view.summary.todo) - lost[l];
  // THE HEADLINE COUNT IS FINISHED WORK AND NOTHING ELSE. It used to add both lanes together, so the number
  // above the list counted cards nobody had validated as "finished changes ready to make".
  const openTotal = Math.max(0, rows.filter((p) => !finished.includes(p.id)).length + Math.max(0, countOf("ready") - laneRows("ready").length));
  const leftIn = (l: Lane) => Math.max(0, countOf(l) - laneRows(l).length);
  const remaining = leftIn("ready") + leftIn("todo");
  // ONE BUTTON, TWO LANES BEHIND IT: finish the proven ones, then keep going into the rest.
  const nextLane: Lane = canMore.ready && leftIn("ready") > 0 ? "ready" : "todo";

  /** OPTIMISTIC, AND TAKEABLE BACK. The row goes now because that is what the press meant; nothing reaches the
   *  store until the ten seconds are up, so "Undo" costs no write at all. */
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
    <div className="space-y-4">
      {view.receiptLine ? <p className="text-[12px] text-muted-foreground tabular-nums">{
        // The stored release froze "ranked just now" at build time; the live line above owns freshness.
        view.receiptLine.replace(/, ranked [^.]*\.?$/, ".")
      }</p> : null}
      {moved ? <p data-list-moved="true" className="text-[12px] text-amber-800">{moved.note}</p> : null}

      {/* THE COUNT IS FINISHED WORK ONLY, so it is said as changes ready to make and never as ideas open. */}
      <p className="text-[14px] font-semibold tabular-nums text-foreground" data-open-count="true">
        {openTotal.toLocaleString("en-US")} finished {openTotal === 1 ? "change" : "changes"} ready to make
      </p>
      {openTotal > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted-foreground">Sorted by</span>
          {SORTS.map(([k, l]) => <TabButton key={k} active={sort === k} onClick={() => setSort(k)}>{l}</TabButton>)}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-[13px] leading-relaxed text-muted-foreground">
          {view.readyZeroHint ?? "Nothing is waiting on you right now. Your next edit is ranked here the moment it earns its place."}
        </p>
      ) : null}

      <ul className="list-none space-y-3">
        {rows.map((p, i) => (
          <ChangeCard key={p.id} proposal={p} rank={i + 1} proven={readyIds.has(p.id)} caseLine={caseLineOf(p)} onAside={putAside}
            onDone={(id) => setFinished((prev) => [...prev, id])} onToast={say} />
        ))}
      </ul>

      {/* WAITING ON A LOOK. Separated, labelled, and carrying no control that would record work as done: what
          is here is not finished, and a screen that offers Copy and Mark done on it says otherwise. */}
      {review.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-dashed border-border bg-surface-inset p-4" data-review-area="true">
          <div className="space-y-1">
            <p className="text-[14px] font-semibold tabular-nums text-foreground" data-review-count="true">
              {review.length.toLocaleString("en-US")} {review.length === 1 ? "draft is" : "drafts are"} waiting on your review
            </p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Each one carries its proposed wording, where it goes, why it is held and what backs it. Take the
              draft as a starting point, approve the wording where only judgement is holding it, or send it back
              for better words. Nothing here counts as finished until it is approved.
            </p>
          </div>
          <ul className="list-none space-y-3">
            {review.map((p, i) => (
              <ChangeCard key={p.id} proposal={p} rank={rows.length + i + 1} proven={false} review caseLine={caseLineOf(p)} onAside={putAside}
                onDone={(id) => setFinished((prev) => [...prev, id])} onToast={say} />
            ))}
          </ul>
        </section>
      ) : null}

      {canMore[nextLane] && remaining > 0 ? (
        <button type="button" disabled={loadingMore} data-show-more="true"
          onClick={() => startLoadMore(async () => {
            const lane = nextLane;
            const res = await loadMoreChangesAction({ lane, cursor: at[lane], releaseId: release });
            // A LIST THAT MOVED IS NOT PAGED ON. The ranking being read is gone, so the server sent the
            // fresh first page and the sentence saying why, and this lane starts again from it.
            setRelease(res.releaseId);
            setAt((prev) => ({ ...prev, [lane]: res.cursor }));
            setCanMore((prev) => ({ ...prev, [lane]: res.more }));
            // A fresh first page's refusals are already out of its own total; only DEEPER pages accumulate.
            setLost((prev) => ({ ...prev, [lane]: res.refreshed ? 0 : prev[lane] + res.dropped }));
            setMoved((prev) => (res.refreshed ? { lane, note: res.refreshed, total: res.total }
              : prev?.lane === lane ? { ...prev, total: res.total } : prev));
            setMore((prev) => ({ ...prev, [lane]: res.refreshed ? res.rows : [...prev[lane], ...res.rows] }));
          })}
          className="w-full rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted-foreground tabular-nums hover:text-foreground disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : remaining <= CHANGES_PAGE_SIZE ? `Show ${remaining} more` : `Show ${CHANGES_PAGE_SIZE} more of ${remaining}`}
        </button>
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-md border px-3 py-1.5 tabular-nums transition-colors ${active
        ? "border-accent-primary/50 bg-accent-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}
