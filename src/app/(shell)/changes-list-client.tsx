"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ChangesView } from "./changes-data";
import type { ChangeProposal } from "@/domains/decision";
import { ChangeCard } from "./changes/change-card";
import { confirmedVersion, openHold } from "@/domains/decision/completeness";
import { dismissProposalAction, loadMoreChangesAction, markManyImplementedAction } from "./changes/actions";
import operatorUiPolicy, { CHANGES_PAGE_SIZE } from "./changes/types";

type Lane = "ready" | "todo" | "research";
type WorkFilter = "all" | string;
const TYPE_LABEL: Record<string, string> = {
  title: "Titles", meta: "Meta descriptions", h1: "H1 headings", opening_answer: "Direct answers",
  answer_block: "Direct answers", section: "Sections", section_add: "Section additions",
  section_remove: "Section removals", section_rewrite: "Section rewrites", restructure: "Restructures",
  full_rewrite: "Full-page rewrites", factual_correction: "Fact corrections",
  paragraph_correction: "Paragraph corrections", source_pack: "Source packs", source_update: "Source updates",
  entity_expansion: "Entity expansions", table_or_list_add: "Tables and lists", internal_links: "Internal links",
  internal_link_add: "Link additions", internal_link_remove: "Link removals", anchor_text: "Anchor text",
  schema: "Schema", canonical: "Canonicals", redirect: "Redirects", noindex: "Noindex",
  consolidation: "Page merges", navigation: "Navigation", new_page: "New pages",
};
const workTypesOf = (p: ChangeProposal): string[] => {
  const c = p.recommendedChange, kinds = (p.bundle?.components ?? []).map((part) => part.kind);
  if (kinds.length > 0) return [...new Set(kinds.map((kind) => TYPE_LABEL[kind] ?? kind.replace(/_/g, " ")))];
  if (c.kind === "new_page") return [TYPE_LABEL.new_page];
  if (c.linkTo) return [TYPE_LABEL.internal_link_add];
  if (TYPE_LABEL[p.changeFamily]) return [TYPE_LABEL[p.changeFamily]];
  return [TYPE_LABEL[c.field] ?? c.field.replace(/_/g, " ")];
};
const searchableText = (p: ChangeProposal): string => [p.pageLabel, p.pagePath, p.pageUrl, p.primaryQuery, p.opportunityType,
  p.recommendedChange.kind === "existing_edit" ? `${p.recommendedChange.field} ${p.recommendedChange.where ?? ""} ${p.recommendedChange.after}` : p.recommendedChange.proposedTitle,
  ...(p.bundle?.components ?? []).flatMap((part) => [part.kind, part.label, part.page, part.where, part.before, part.after])].filter(Boolean).join(" ").toLowerCase();
const UNDO_MS = 10_000;
const bulkSelectionOf = (picked: readonly string[], shown: readonly string[]) => {
  const visible = new Set(shown), hidden = picked.filter((id) => !visible.has(id));
  return { hidden, canSubmit: picked.length > 0 && hidden.length === 0 };
};

export function ChangesListClient({ view, initialPicked = [] }: { view: ChangesView; initialPicked?: string[] }) {
  const params = useSearchParams();
  const caseLineOf = (p: ChangeProposal): string | null => {
    const key = p.aiScope?.caseKey;
    if (!key || view.aiCases.state !== "read") return null;
    return view.aiCases.rows.find((d) => d.caseKey === key)?.reason ?? null;
  };
  const [more, setMore] = useState<ChangeProposal[]>([]);
  const [moreLanes, setMoreLanes] = useState<Record<string, Lane>>({});
  const [at, setAt] = useState<number>(view.queueCursor?.ready ?? view.queueCursor?.all ?? view.proposals.length); // the finished lane's own cursor: its Show more continues the READY lane, never the global page
  const [release, setRelease] = useState<string | null>(view.surfaceVersion ?? null);
  const [canMore, setCanMore] = useState<boolean>(true);
  const [moved, setMoved] = useState<{ note: string; total: number } | null>(null);
  const [lost, setLost] = useState<number>(0); // refusals a deeper page found
  const [hidden, setHidden] = useState<string[]>([]);
  const [finished, setFinished] = useState<string[]>([]);
  const [recordedNotes, setRecordedNotes] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [loadingMore, startLoadMore] = useTransition();
  const [workFilter, setWorkFilter] = useState<WorkFilter>(() => params.get("type") || "all");
  const [search, setSearch] = useState(() => params.get("q") || "");
  const raw = useMemo(() => (moved ? more : [...view.proposals, ...more]), [moved, more, view]);
  // THE STAMPED LANE IS THE ONE SOURCE of what a card may offer; a row the stamp does not know asks the SAME servability verdict every other surface asks, never the raw status: `p.status === "ready"` here was the one reader that could render Ready with no hold consulted at all.
  const laneOf = useMemo(() => (p: ChangeProposal): Lane => {
    const stamped = moreLanes[p.id] ?? view.laneById?.[p.id]; if (stamped) return stamped;
    const hold = openHold(p);
    // FAIL CLOSED WITHOUT THE SERVER VERDICT. The stamped lane above carries BOTH legs of the one servability rule (blocking hold AND unsettled cause, computed server-side); this browser fallback can ask only the first, because the second leg's import chain is server-only. A row no stamp knows therefore never wears Ready here: offering Copy off half the verdict is exactly the list-versus-detail disagreement the one rule exists to end, and in practice every served row arrives stamped.
    return hold.lane === "research" ? "research" : "todo";
  }, [moreLanes, view]);
  const rows = useMemo(() => raw.filter((p) => operatorUiPolicy.isManualEditProofWork(p) && !hidden.includes(p.id)), [raw, hidden]);
  const readyRows = useMemo(() => rows.filter((p) => laneOf(p) === "ready"), [rows, laneOf]);
  const filters = useMemo(() => ["all", ...new Set(readyRows.flatMap(workTypesOf))], [readyRows]);
  const shownReadyRows = useMemo(() => readyRows.filter((p) => (workFilter === "all" || workTypesOf(p).includes(workFilter))
    && (!search.trim() || searchableText(p).includes(search.trim().toLowerCase()))), [readyRows, search, workFilter]);
  const visibleMinutes = useMemo(() => shownReadyRows.reduce((sum, p) => sum + Math.max(0, p.estimatedEffortMinutes), 0), [shownReadyRows]);
  // A row carrying BOTH a genuine safety decision AND a Beacon fault belongs to Beacon first: the operator is
  // never asked to authorize work Beacon itself knows is defective (approved contract, 2026-08-27).
  const decisionRows = useMemo(() => rows.filter((p) => { if (laneOf(p) !== "todo") return false; const h = openHold(p); return h.safetyHold && !h.faulted; }), [rows, laneOf]);
  const writtenCount = Math.max(0, (view.summary.todo ?? 0) - decisionRows.length), researchingCount = view.summary.research ?? 0;
  const loadedReady = useMemo(() => raw.filter((p) => laneOf(p) === "ready").length, [raw, laneOf]);
  const openTotal = Math.max(0, readyRows.filter((p) => !finished.includes(p.id)).length
    + Math.max(0, (view.summary.ready ?? 0) - loadedReady - lost));
  const remaining = Math.max(0, (moved?.total ?? view.summary.ready ?? 0) - loadedReady - lost);
  const measuring = view.countsUnavailable ? null : view.measuringCountCanonical;
  const wins = view.countsUnavailable ? null : view.wonCountCanonical ?? null;
  const rememberView = (type: string, q: string) => { if (typeof window === "undefined") return; const next = new URLSearchParams(window.location.search);
    if (type === "all") next.delete("type"); else next.set("type", type); if (q.trim()) next.set("q", q); else next.delete("q");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${next.size ? `?${next}` : ""}`); };
  const returnTo = `/changes${workFilter !== "all" || search.trim() ? `?${new URLSearchParams([...(workFilter !== "all" ? [["type", workFilter]] : []), ...(search.trim() ? [["q", search.trim()]] : [])]).toString()}` : ""}`;

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
  const [picked, setPicked] = useState<string[]>(initialPicked);
  // WHY EACH ROW THE BATCH REFUSED WAS REFUSED, kept per row: one first error under twenty cards named the problem and never which card had it.
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [bulkPending, startBulk] = useTransition();
  const pick = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const bulkRows = useMemo(() => shownReadyRows.filter(operatorUiPolicy.isBulkRecordable), [shownReadyRows]);
  const bulk = bulkSelectionOf(picked, bulkRows.map((p) => p.id));
  const markPicked = () => { if (!bulk.canSubmit) { say("Clear the selected changes hidden by this view before recording work."); return; } startBulk(async () => {
    const n = picked.length;
    say(`Recording ${n} ${n === 1 ? "change" : "changes"}…`); // said the moment the press lands; the durable answer replaces it
    const res = await markManyImplementedAction({ proposals: picked.flatMap((id) => { const row = bulkRows.find((p) => p.id === id); return row ? [{ id, expectedVersion: confirmedVersion(row) }] : []; }) }).catch(() => null);
    if (!res) { say("That could not be recorded just now. Press it again in a moment."); return; }
    const failedIds = new Set(res.failed.map((f) => f.id));
    setFinished((prev) => [...prev, ...picked.filter((id) => !failedIds.has(id))]); // FAILED ROWS STAY SELECTED AND VISIBLE; recorded rows leave the list only after the durable answer
    setRecordedNotes((prev) => ({ ...prev, ...Object.fromEntries(res.results.filter((r) => r.outcome !== "failed").map((r) => [r.id, r.note ?? "Recorded. Open Results for its current verification and measurement state."])) }));
    setPicked(picked.filter((id) => failedIds.has(id)));
    // THE COUNT AND THE CARDS MOVE TOGETHER. Every id this press sent gets its answer on its own card: a recorded one flips to "Done. Measuring from ..." where it sits, and a refused one carries its own reason and stays pressable. The count dropping while the cards it counted still offer Copy and Mark done is the one thing a batch may never do.
    setProblems((prev) => ({ ...prev, ...Object.fromEntries(picked.map((id) => [id, ""])), ...Object.fromEntries(res.failed.map((f) => [f.id, f.error])) }));
    const doneWord = res.done > 0 ? `${res.done} ${res.done === 1 ? "change" : "changes"} recorded.` : "";
    say([doneWord, res.already > 0 ? `${res.already} already being measured.` : "", res.failed.length > 0 ? `${res.failed.length} could not be recorded, and each one says why on its own card.` : ""].filter(Boolean).join(" ") || res.note);
  }); };

  return (
    <div className="space-y-5">
      {moved ? <p data-list-moved="true" className="text-[12px] text-amber-800">{moved.note}</p> : null}

      {/* READY NOW: complete, executable work only, best first. The count counts exactly what sits here. */}
      <section className="space-y-3" data-lane-ready="true">
        {/* NO BARE ZERO AS A HEADING (audit 3.9): "Ready now: 0 finished changes" printed as a heading over an empty lane; the empty lane says what happens next instead. */}
        {openTotal > 0 ? <p className="text-[14px] font-semibold tabular-nums text-foreground" data-open-count="true">
          Ready now: {openTotal.toLocaleString("en-US")} finished {openTotal === 1 ? "change" : "changes"}
        </p> : null}
        {readyRows.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-accent-primary/10 via-surface-raised to-surface-raised shadow-sm" data-change-workbench="true">
            <div className="grid gap-3 border-b border-border px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-primary">Operator workbench</p>
                <p className="mt-1 text-[18px] font-semibold text-foreground" role="status" aria-live="polite">{shownReadyRows.length.toLocaleString("en-US")} shown · {visibleMinutes > 0 ? `about ${visibleMinutes < 60 ? `${visibleMinutes} min` : `${Math.round(visibleMinutes / 6) / 10} hours`}` : "effort not estimated"}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Rank stays evidence-first. Filters only narrow what you want to apply right now.</p>
              </div>
              <label className="block min-w-0 sm:w-64">
                <span className="sr-only">Find a page, query, or edit</span>
                <input value={search} onChange={(event) => { setSearch(event.target.value); rememberView(workFilter, event.target.value); }} type="search" placeholder="Find page, query, or edit…"
                  className="min-h-11 w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-[13px] text-foreground outline-none ring-accent-primary/30 placeholder:text-muted-foreground focus:ring-4" />
              </label>
            </div>
            <div className="flex gap-2 overflow-x-auto px-3 py-3" role="group" aria-label="Filter loaded changes by edit type">
              {filters.map((filter) => { const count = readyRows.filter((p) => filter === "all" || workTypesOf(p).includes(filter)).length, active = workFilter === filter; return (
                <button key={filter} type="button" onClick={() => { setWorkFilter(filter); rememberView(filter, search); }} aria-pressed={active}
                  className={`min-h-11 shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 ${active ? "border-accent-primary bg-accent-primary text-white shadow-sm" : "border-border bg-surface-raised text-muted-foreground hover:border-accent-primary/50 hover:text-foreground"}`}>
                  {filter === "all" ? "All edit types" : filter} <span className={active ? "text-white/75" : "text-muted-foreground/70"}>{count}</span>
                </button>
              ); })}
            </div>
            {remaining > 0 ? <p className="border-t border-border px-4 py-2 text-[11px] leading-relaxed text-muted-foreground" data-loaded-filter-scope="true">
              Filters cover the {readyRows.length.toLocaleString("en-US")} finished changes loaded here. Load the remaining {remaining.toLocaleString("en-US")} below to include them.
            </p> : null}
          </div>
        ) : null}
        {readyRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-5 text-[13px] leading-relaxed text-muted-foreground">
            {view.readyZeroHint}{/* THE LANE'S OWN SENTENCE COMES OFF THE VIEW: a second copy here said it in different words, and two screens wording one fact two ways is the drift the one map exists to end. */}
          </p>
        ) : shownReadyRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-center">
            <p className="text-[14px] font-semibold text-foreground">No finished changes match this view.</p>
            <button type="button" onClick={() => { setSearch(""); setWorkFilter("all"); rememberView("all", ""); }} className="mt-2 inline-flex min-h-11 items-center text-[12px] font-semibold text-accent-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary">Clear filters</button>
          </div>
        ) : (
          <ul className="list-none space-y-3">
            {shownReadyRows.map((p) => (
              <ChangeCard key={p.id} proposal={p} rank={readyRows.indexOf(p) + 1} ready review={false} caseLine={caseLineOf(p)}
                onAside={putAside} onDone={(id) => setFinished((prev) => [...prev, id])} onToast={say}
                recorded={finished.includes(p.id)} recordedNote={recordedNotes[p.id]} problem={problems[p.id] || null}
                picked={picked.includes(p.id)} onPick={operatorUiPolicy.isBulkRecordable(p) ? pick : undefined} returnTo={returnTo} />
            ))}
          </ul>
        )}
        {picked.length > 0 ? (
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-accent-primary/50 bg-surface-raised px-4 py-2 shadow-lg" data-bulk-bar="true">
            <p className="min-w-0 flex-1 text-[13px] font-semibold text-foreground">{picked.length} selected{bulk.hidden.length > 0 ? ` · ${bulk.hidden.length} hidden by this view` : ""}</p>
            {bulk.hidden.length > 0 ? <button type="button" onClick={() => setPicked((prev) => prev.filter((id) => !bulk.hidden.includes(id)))} className="inline-flex min-h-11 items-center text-[12px] font-semibold text-accent-primary underline underline-offset-2">Clear hidden</button> : null}
            <button type="button" data-bulk-done="true" disabled={bulkPending || !bulk.canSubmit} onClick={markPicked}
              className="ml-auto min-h-11 rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
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
              setLost((prev) => (res.refreshed ? res.dropped : prev + res.dropped));
              setMoved((prev) => (res.refreshed ? { note: res.refreshed, total: res.total } : prev ? { ...prev, total: res.total } : prev));
              setMoreLanes((prev) => ({ ...prev, ...res.laneById }));
              setMore((prev) => (res.refreshed ? res.rows : [...prev, ...res.rows]));
            })}
            className="min-h-11 w-full rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted-foreground tabular-nums hover:text-foreground disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : `Show ${Math.min(remaining, CHANGES_PAGE_SIZE).toLocaleString("en-US")} more finished ${remaining === 1 ? "change" : "changes"}`}
          </button>
        ) : null}
      </section>

      {/* Only complete, destructive work can enter this human-decision lane. */}
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

      {/* STILL BEING WRITTEN, CHECKED OR RESEARCHED: one sentence with the counts, never a card and never a tally of internal
          states. The detail page of a held row stays reachable by its address (Today links there); this list never renders it. */}
      {writtenCount > 0 || researchingCount > 0 ? (
        <p className="text-[13px] leading-relaxed tabular-nums text-muted-foreground" data-lane-preparing="true">
          {[writtenCount > 0 ? `${writtenCount.toLocaleString("en-US")} ${writtenCount === 1 ? "change is" : "changes are"} being written and checked` : null,
            researchingCount > 0 ? `${researchingCount.toLocaleString("en-US")} ${researchingCount === 1 ? "opportunity is" : "opportunities are"} being researched` : null]
            .filter(Boolean).join(", and ")}. They move up here on their own.
        </p>
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
          className={`sticky z-20 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2 text-[12px] text-foreground shadow-sm ${picked.length > 0 ? "bottom-28 sm:bottom-20" : "bottom-3"}`}>
          <span>{toast.text}</span>
          {toast.undo ? (
            <button type="button" onClick={toast.undo} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">Undo</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
