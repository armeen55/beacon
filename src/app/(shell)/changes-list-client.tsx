"use client";

/** changes-list-client: the ranked ChangeProposal queue. This file owns the LIST (the two lanes, the filter and
 *  sort the operator drives, the database paging, and the one place a put-aside can be taken back); one card
 *  owns everything said about one change. Publishing is MANUAL: the only mutating controls anywhere in here are
 *  "I made this change" and "Put this aside". */

import { useMemo, useRef, useState, useTransition } from "react";
import type { ChangesView } from "./changes-data";
import type { ChangeProposal } from "@/domains/decision";
import { ChangeCard, TITLE_FOOTNOTE } from "./changes/change-card";
import { dismissProposalAction, loadMoreChangesAction } from "./changes/actions";
import { CHANGES_PAGE_SIZE } from "./changes/types";

type Tab = "ready" | "todo";
type Filter = "all" | "ready" | "building";
type Sort = "rank" | "gap" | "quick";

const FILTERS: [Filter, string][] = [["all", "All"], ["ready", "Ready to test"], ["building", "Building evidence"]];
const SORTS: [Sort, string][] = [["rank", "Rank"], ["gap", "Biggest gap"], ["quick", "Quickest"]];
/** How long a put-aside stays takeable-back before I actually tell the store. Nothing is written until it ends. */
const UNDO_MS = 10_000;

export function ChangesListClient({ view }: { view: ChangesView }) {
  const [tab, setTab] = useState<Tab>(view.ready.length > 0 ? "ready" : "todo");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("rank");
  // THE QUEUE IS UNLIMITED AND THE SCREEN IS NOT: the server cuts one page per lane in the database and counts
  // the rest there too, so what is behind this screen is a fact rather than a length.
  const [more, setMore] = useState<Record<Tab, ChangeProposal[]>>({ ready: [], todo: [] });
  // THE CURSOR IS A POSITION IN A RANKING, so the ranking it was taken against travels with every press. When
  // the background rebuild has replaced it, the server says so and this lane restarts from the top.
  const [at, setAt] = useState<Record<Tab, number>>(view.queueCursor ?? { ready: view.ready.length, todo: view.toDo.length });
  const [release, setRelease] = useState<string | null>(view.surfaceVersion ?? null);
  // THE BUTTON DIES ON WHAT THE DATABASE READ: a short raw page means the lane is exhausted however many rows a
  // count still names. A view with no page verdict yet defaults open; the first press settles it.
  const [canMore, setCanMore] = useState<Record<Tab, boolean>>(view.queueMore ?? { ready: true, todo: true });
  const [moved, setMoved] = useState<{ tab: Tab; note: string; total: number } | null>(null);
  const [lost, setLost] = useState<Record<Tab, number>>({ ready: 0, todo: 0 }); // refusals a deeper page found
  const [hidden, setHidden] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [loadingMore, startLoadMore] = useTransition();
  // A RESTARTED LANE SHOWS THE FRESH PAGE AND NOTHING ELSE: rows from the ranking that went away are dropped
  // rather than stacked under the new ones, which is the only way "each change once" survives.
  const restarted = moved?.tab === tab;
  const raw = useMemo(() => (restarted ? more[tab] : [...(tab === "ready" ? view.ready : view.toDo), ...more[tab]]), [restarted, tab, view, more]);
  const rows = useMemo(() => {
    const kept = raw.filter((p) => !hidden.includes(p.id)
      && (filter === "all" || (filter === "building") === (p.confidence === "low")));
    if (sort === "quick") return [...kept].sort((a, b) => a.estimatedEffortMinutes - b.estimatedEffortMinutes);
    if (sort === "gap") return [...kept].sort((a, b) => (b.upsidePerMonth ?? b.impactScore ?? 0) - (a.upsidePerMonth ?? a.impactScore ?? 0));
    return kept;
  }, [raw, hidden, filter, sort]);
  // THE COUNT ON THE TAB IS THE COUNT OF THE LIST UNDER IT: a replaced ranking restarts the lane (the old total
  // said 35 above a list holding 12), `lost` takes off what a DEEPER page refused, and a change the operator
  // just put aside comes off it too, so it only ever falls.
  const gone = raw.filter((p) => hidden.includes(p.id)).length;
  const countOf = (t: Tab) => (moved?.tab === t ? moved.total : t === "ready" ? view.summary.ready : view.summary.todo)
    - lost[t] - (t === tab ? gone : 0);
  const remaining = Math.max(0, countOf(tab) + gone - raw.length);

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
      {restarted ? <p data-list-moved="true" className="text-[12px] text-amber-800">{moved!.note}</p> : null}

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <TabButton active={tab === "ready"} onClick={() => setTab("ready")}>Ready {countOf("ready")}</TabButton>
        <TabButton active={tab === "todo"} onClick={() => setTab("todo")}>Needs review {countOf("todo")}</TabButton>
      </div>
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

      {tab === "ready" && view.ready.length === 0 && view.readyZeroHint ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-[13px] leading-relaxed text-muted-foreground">
          {view.readyZeroHint}
        </p>
      ) : null}
      {rows.length === 0 && tab === "todo" ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-center text-[13px] text-muted-foreground">
          Nothing waiting for a review right now.
        </p>
      ) : null}

      <ol className="space-y-3">
        {rows.map((p, i) => (
          <ChangeCard key={p.id} proposal={p} rank={i + 1} inReadyLane={tab === "ready"} onAside={putAside} onToast={say} />
        ))}
      </ol>

      {canMore[tab] && remaining > 0 ? (
        <button type="button" disabled={loadingMore} data-show-more="true"
          onClick={() => startLoadMore(async () => {
            const res = await loadMoreChangesAction({ lane: tab, cursor: at[tab], releaseId: release });
            // A LIST THAT MOVED IS NOT PAGED ON. The ranking I was reading is gone, so the server sent the
            // fresh first page and the sentence saying why, and this lane starts again from it.
            setRelease(res.releaseId);
            setAt((prev) => ({ ...prev, [tab]: res.cursor }));
            setCanMore((prev) => ({ ...prev, [tab]: res.more }));
            // A fresh first page's refusals are already out of its own total; only DEEPER pages accumulate.
            setLost((prev) => ({ ...prev, [tab]: res.refreshed ? 0 : prev[tab] + res.dropped }));
            setMoved((prev) => (res.refreshed ? { tab, note: res.refreshed, total: res.total }
              : prev?.tab === tab ? { ...prev, total: res.total } : prev));
            setMore((prev) => ({ ...prev, [tab]: res.refreshed ? res.rows : [...prev[tab], ...res.rows] }));
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
