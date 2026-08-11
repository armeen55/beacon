"use client";

/** changes-list-client: ONE flat ranked queue of every change, best first. THE FLIP THIS FILE EXISTS FOR
 *  (2026-08-11): the Ready / Needs review tabs made half the work invisible behind a tab nobody pressed, and
 *  the half that showed was framed as work in progress rather than work to do. Every card is now in one list,
 *  fully rendered, carrying its own chip saying how proven it is. This file owns the LIST (the filter and sort
 *  the operator drives, the database paging, and the one place a put-aside can be taken back); one card owns
 *  everything said about one change. Publishing is MANUAL: the only mutating controls anywhere in here are
 *  "I made this change" and "Put this aside". */

import { useMemo, useRef, useState, useTransition } from "react";
import type { ChangesView } from "./changes-data";
import type { ChangeProposal } from "@/domains/decision";
import { ChangeCard, TITLE_FOOTNOTE } from "./changes/change-card";
import { dismissProposalAction, loadMoreChangesAction } from "./changes/actions";
import { CHANGES_PAGE_SIZE } from "./changes/types";

type Lane = "ready" | "todo";
type Filter = "all" | "ready" | "building";
type Sort = "rank" | "gap" | "quick";

const FILTERS: [Filter, string][] = [["all", "All"], ["ready", "Ready to make"], ["building", "Still building evidence"]];
const SORTS: [Sort, string][] = [["rank", "Rank"], ["gap", "Biggest gap"], ["quick", "Quickest"]];
/** How long a put-aside stays takeable-back before I actually tell the store. Nothing is written until it ends. */
const UNDO_MS = 10_000;

export function ChangesListClient({ view }: { view: ChangesView }) {
  const [filter, setFilter] = useState<Filter>("all");
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
  const [toast, setToast] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [loadingMore, startLoadMore] = useTransition();
  // A RESTARTED LANE SHOWS THE FRESH PAGE AND NOTHING ELSE: rows from the ranking that went away are dropped
  // rather than stacked under the new ones, which is the only way "each change once" survives.
  const laneRows = useMemo(() => (l: Lane): ChangeProposal[] =>
    moved?.lane === l ? more[l] : [...(l === "ready" ? view.ready : view.toDo), ...more[l]], [moved, more, view]);
  // PROVEN FIRST, THEN THE REST. One list, one order, and the chip on each card says which kind it is.
  const raw = useMemo(() => [...laneRows("ready"), ...laneRows("todo")], [laneRows]);
  const readyIds = useMemo(() => new Set(laneRows("ready").map((p) => p.id)), [laneRows]);
  const rows = useMemo(() => {
    const kept = raw.filter((p) => !hidden.includes(p.id)
      && (filter === "all" || (filter === "building") === (p.confidence === "low")));
    if (sort === "quick") return [...kept].sort((a, b) => a.estimatedEffortMinutes - b.estimatedEffortMinutes);
    if (sort === "gap") return [...kept].sort((a, b) => (b.upsidePerMonth ?? b.impactScore ?? 0) - (a.upsidePerMonth ?? a.impactScore ?? 0));
    return kept;
  }, [raw, hidden, filter, sort]);
  // THE COUNT ON THE SCREEN IS THE COUNT OF THE LIST UNDER IT: a replaced ranking restarts its lane (the old
  // total said 35 above a list holding 12), `lost` takes off what a DEEPER page refused, and a change the
  // operator just put aside comes off it too, so it only ever falls.
  const gone = raw.filter((p) => hidden.includes(p.id)).length;
  const countOf = (l: Lane) => (moved?.lane === l ? moved.total : l === "ready" ? view.summary.ready : view.summary.todo) - lost[l];
  const openTotal = Math.max(0, countOf("ready") + countOf("todo") - gone);
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
      text: "Put aside. I will not suggest this again unless the evidence changes.",
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

      <p className="text-[14px] font-semibold tabular-nums text-foreground" data-open-count="true">
        {openTotal.toLocaleString()} {openTotal === 1 ? "edit" : "edits"} open
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {FILTERS.map(([k, l]) => <TabButton key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</TabButton>)}
        <span className="text-muted-foreground">Sorted by</span>
        {SORTS.map(([k, l]) => <TabButton key={k} active={sort === k} onClick={() => setSort(k)}>{l}</TabButton>)}
      </div>
      {/* SAID ONCE, UNDER THE LIST, INSTEAD OF ON ALL 37 CARDS. It is true of every title line here, so it is a
          footnote about the list rather than a reason for any one change. */}
      {raw.some((p) => p.whyItMatters.includes(TITLE_FOOTNOTE)) ? (
        <p className="text-[12px] text-muted-foreground" data-title-footnote="true">{TITLE_FOOTNOTE}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-[13px] leading-relaxed text-muted-foreground">
          {view.readyZeroHint ?? "Nothing is waiting on you right now. I rank your next edit here the moment it earns its place."}
        </p>
      ) : null}

      <ol className="space-y-3">
        {rows.map((p, i) => (
          <ChangeCard key={p.id} proposal={p} rank={i + 1} proven={readyIds.has(p.id)} onAside={putAside} onToast={say} />
        ))}
      </ol>

      {canMore[nextLane] && remaining > 0 ? (
        <button type="button" disabled={loadingMore} data-show-more="true"
          onClick={() => startLoadMore(async () => {
            const lane = nextLane;
            const res = await loadMoreChangesAction({ lane, cursor: at[lane], releaseId: release });
            // A LIST THAT MOVED IS NOT PAGED ON. The ranking I was reading is gone, so the server sent the
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
          {loadingMore ? "Loading…" : remaining <= CHANGES_PAGE_SIZE ? `Show the other ${remaining}` : `Show ${CHANGES_PAGE_SIZE} more of ${remaining}`}
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
