"use client";

/** changes-list-client: ONE flat ranked queue of every nonterminal opportunity, best first, whatever its
 *  stage. THE TWO LESSONS THIS LAYOUT HOLDS TOGETHER: (2026-08-11) tabs made half the work invisible;
 *  (2026-08-15) merging lanes while every card wore Copy and Mark done presented unvalidated work as
 *  paste-ready. So the ORDER is the one persisted global rank and never the lane, and the LANE gates the
 *  CONTROLS on each card: ready rows carry Mark done, review rows carry nothing that records work, research
 *  rows present what is owed. High-impact research ranks above tiny ready work because importance and
 *  finishedness are different facts (Codex, 2026-08-21). Publishing is MANUAL: the only mutating controls
 *  are "Mark done" and "Skip". */

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { ChangesView } from "./changes-data";
import type { ChangeProposal } from "@/domains/decision";
import { ChangeCard } from "./changes/change-card";
import { dismissProposalAction, loadMoreChangesAction } from "./changes/actions";
import { CHANGES_PAGE_SIZE } from "./changes/types";

type Lane = "ready" | "todo" | "research";
type Sort = "rank" | "gap" | "quick";
const SORTS: [Sort, string][] = [["rank", "Rank"], ["gap", "Biggest gap"], ["quick", "Quickest"]];
/** How long a skip stays takeable-back before the store is told. Nothing is written until it ends. */
const UNDO_MS = 10_000;

export function ChangesListClient({ view }: { view: ChangesView }) {
  // WHAT WAS DECIDED ABOUT THE SEARCH A CHANGE ANSWERS, off the ONE case file Visibility reads, matched on
  // the canonical case identity and never on wording. An unreadable file says nothing at all.
  const caseLineOf = (p: ChangeProposal): string | null => {
    const key = p.aiScope?.caseKey;
    if (!key || view.aiCases.state !== "read") return null;
    return view.aiCases.rows.find((d) => d.caseKey === key)?.reason ?? null;
  };
  const [sort, setSort] = useState<Sort>("rank");
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
  // THE STAMPED LANE IS THE ONE SOURCE of what a card may offer; a row the stamp does not know is review.
  const laneOf = useMemo(() => (p: ChangeProposal): Lane =>
    moreLanes[p.id] ?? view.laneById?.[p.id] ?? (p.researchOnly === true ? "research" : p.status === "ready" ? "ready" : "todo"),
    [moreLanes, view]);
  const order = useMemo(() => (kept: ChangeProposal[]) => {
    // The sorts reorder the WHOLE flow: finishedness never outranks worth (Codex, 2026-08-21).
    if (sort === "quick") return [...kept].sort((a, b) => a.estimatedEffortMinutes - b.estimatedEffortMinutes);
    if (sort === "gap") return [...kept].sort((a, b) => (b.upsidePerMonth ?? b.impactScore ?? 0) - (a.upsidePerMonth ?? a.impactScore ?? 0));
    return kept;
  }, [sort]);
  const rows = useMemo(() => order(raw.filter((p) => !hidden.includes(p.id))), [order, raw, hidden]);
  const readyRows = useMemo(() => rows.filter((p) => laneOf(p) === "ready"), [rows, laneOf]);
  const reviewCount = useMemo(() => rows.filter((p) => laneOf(p) === "todo").length, [rows, laneOf]);
  const researchCount = useMemo(() => rows.filter((p) => laneOf(p) === "research").length, [rows, laneOf]);
  // THE HEADLINE COUNT IS FINISHED WORK AND NOTHING ELSE (2026-08-15): drafts and research are named beside
  // it in their own words, never folded into "ready to make".
  const openTotal = Math.max(0, readyRows.filter((p) => !finished.includes(p.id)).length
    + Math.max(0, (view.summary.ready ?? 0) - readyRows.length));
  const remaining = Math.max(0, (view.queueTotal ?? (moved?.total ?? rows.length)) - raw.length - lost);

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
    <div className="space-y-4">
      {view.receiptLine ? <p className="text-[12px] text-muted-foreground tabular-nums">{
        // The stored release froze "ranked just now" at build time; the live line above owns freshness.
        view.receiptLine.replace(/, ranked [^.]*\.?$/, ".")
      }</p> : null}
      {moved ? <p data-list-moved="true" className="text-[12px] text-amber-800">{moved.note}</p> : null}

      <p className="text-[14px] font-semibold tabular-nums text-foreground" data-open-count="true">
        {openTotal.toLocaleString("en-US")} finished {openTotal === 1 ? "change" : "changes"} ready to make
        {reviewCount + researchCount > 0 ? (
          <span className="font-normal text-muted-foreground"> · {reviewCount > 0 ? `${reviewCount.toLocaleString("en-US")} ${reviewCount === 1 ? "draft" : "drafts"} to review` : null}{reviewCount > 0 && researchCount > 0 ? ", " : null}{researchCount > 0 ? `${researchCount.toLocaleString("en-US")} being researched` : null}</span>
        ) : null}
      </p>
      {rows.length > 1 ? (
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

      {/* ONE LIST, THE PERSISTED ORDER. Each card's controls come from its lane: a review row carries nothing
          that records work as done, and a research row presents exactly what is owed and what happens next. */}
      <ul className="list-none space-y-3">
        {rows.map((p, i) => laneOf(p) === "research"
          ? <ResearchRow key={p.id} p={p} rank={i + 1} />
          : <ChangeCard key={p.id} proposal={p} rank={i + 1} proven={laneOf(p) === "ready"}
              review={laneOf(p) !== "ready"} caseLine={caseLineOf(p)} onAside={putAside}
              onDone={(id) => setFinished((prev) => [...prev, id])} onToast={say} />)}
      </ul>

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

/** ONE OPPORTUNITY THAT HAS NO FINISHED WORDS YET, SHOWN WHOLE at its global rank (operator, 2026-08-15;
 *  one flow, Codex 2026-08-21). Every card says the page, the exact search behind it, the audience, what the
 *  evidence says, what is still missing and what happens next. Nothing here is offered as work: no copy to
 *  take, no control that records it done; reading it is the work. */
function ResearchRow({ p, rank }: { p: ChangeProposal; rank: number }) {
  const path = p.pagePath ?? p.pageUrl ?? "";
  const missing = p.research?.missing ?? "what is missing has not been named in a typed field yet"; // typed, never guessed (operator, 2026-08-15)
  const believes = p.causeFinding?.explanation ?? p.whyItMatters;
  const next = p.research?.next ?? "what happens next has not been named in a typed field yet";
  const held = (p.evidence?.hints ?? []).filter((h) => h.trim() && h !== believes && !missing.includes(h.trim())).slice(0, 2);
  const facts = [p.demandImpressions90d ? `${p.demandImpressions90d.toLocaleString("en-US")} views in Google over 90 days` : null,
    p.impactScore ? `${Math.round(p.impactScore).toLocaleString("en-US")} clicks recoverable` : null].filter(Boolean);
  return (
    <li className="space-y-1.5 rounded-2xl border border-border bg-surface-raised p-4" data-research-card="true">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="tabular-nums text-muted-foreground">{rank}</span>
        <span className="rounded-full border border-border px-2 py-0.5 font-semibold text-muted-foreground">Being researched</span>
        {path ? <span className="text-muted-foreground">{path}</span> : null}
      </div>
      <p className="text-[14px] font-semibold leading-snug text-foreground">{p.opportunityType}</p>
      <p className="text-[12px] tabular-nums text-muted-foreground">
        Searched as &ldquo;{p.primaryQuery}&rdquo;{facts.length > 0 ? ` · ${facts.join(" · ")}` : ""}
      </p>
      <p className="text-[13px] leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">What the evidence says: </span>{believes}</p>
      <p className="text-[13px] leading-relaxed text-muted-foreground" data-research-owed="true"><span className="font-semibold text-foreground">Still missing: </span>{missing}</p>
      <p className="text-[12px] leading-relaxed text-muted-foreground" data-research-next="true"><span className="font-semibold text-foreground">Next: </span>{next}</p>
      {held.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground" data-research-evidence="true">
          {held.map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      ) : null}
      <Link href={`/changes/${encodeURIComponent(p.id)}`} data-research-detail="true" className="inline-flex text-[12px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">Open details &rarr;</Link>
    </li>
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
