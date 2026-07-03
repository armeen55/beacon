"use client";

/**
 * ChangesListClient (2026-07-02; UX3 dense inbox) - the canonical Changes list. ONE compact,
 * action-first row per change; strategy control + status views + goal filter + search, pure client
 * filtering over the server-built CanonicalChange[]. Advanced detail opens in a split side panel
 * (desktop) so clicking a row never loses the list's scroll position; the existing MoveCard renders
 * unchanged inside that panel. Tonight's applied batch (every change selected for today that has
 * moved to verify/measuring/result) collapses to one summary row, expandable to the individual
 * receipts. Multi-select adds a checkbox per row + a floating bulk bar reusing the same per-row
 * done/skip actions in a bounded, sequential loop. Move 3: responsive control cluster (no clip/
 * overflow on mobile), keyboard + screen-reader semantics (aria-pressed/expanded, focus rings,
 * role=status), state shown by text + border (not color alone), and cause-specific empty states.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Hourglass, TriangleAlert } from "lucide-react";
import type { ChangesView } from "./changes-data";
import type { CanonicalChange, Strategy, Goal, StatusView } from "@/domains/changes/canonical-change";
import { EVIDENCE_LABEL, statusView } from "@/domains/changes/canonical-change";
import { rankChanges, goalMatches, inStatusView } from "@/domains/changes/strategy";
import { MoveCard } from "./today-moves-card";
import { Sparkline } from "@/components/data/sparkline";
import { formatMetric, formatMetricCompact } from "@/lib/format-metric";
import { dossierHref } from "@/lib/page-dossier-link";
import { respondToRecommendation } from "./recommendation-actions";
import { useWorklistSession, WorklistSessionBanner } from "./worklist-session-strip";
import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";

// UX3 - buyer language for the strategy picker (display-only; the underlying Strategy union
// and its ranking math in strategy.ts are untouched, this only renames what the operator reads).
const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: "balanced", label: "Best opportunities", hint: "Best mix of upside, effort, risk, and evidence (recommended)." },
  { id: "growth", label: "Fastest growth", hint: "Prioritize impact, even when the proof will be less exact." },
  { id: "clean", label: "Safest bets", hint: "Only changes Beacon can measure most confidently." },
];
const TABS: { id: StatusView; label: string }[] = [
  { id: "todo", label: "To do" }, { id: "ready", label: "Ready" }, { id: "measuring", label: "Measuring" }, { id: "results", label: "Results" },
];
const GOALS: { id: Goal; label: string }[] = [
  { id: "recommended", label: "Recommended" }, { id: "quick_wins", label: "Quick wins" }, { id: "biggest_upside", label: "Biggest upside" },
  { id: "recover_traffic", label: "Recover traffic" }, { id: "ai_visibility", label: "AI visibility" }, { id: "new_pages", label: "New pages" },
];

// B2 (worklist fix batch) - the status CHIP shows one of only 4 display words, never the 8-word
// internal-status vocabulary. "To do" = not yet prepared; "In progress" = Beacon or the operator
// is actively moving it (ready to ship, awaiting the Wix edit, or verifying); "Measuring";
// "Done" = a settled result. The precise underlying state is still available (used for the CTA
// label and secondary text below), just never shown as its own status-pill word. State is
// communicated by TEXT (the chip label) + BORDER, never color alone (WCAG).
// Maps every underlying status onto one of the six Pill intents: "To do" is neutral
// (nothing is happening yet), the three "In progress" states share the waiting/amber
// intent (Beacon or the operator is actively moving them), Measuring uses the dedicated
// measuring/blue intent, and a settled Result is neutral (won/lost isn't known from the
// status alone - see EVIDENCE_LABEL / c.result for the actual verdict).
const STATUS_CHIP: Record<CanonicalChange["status"], { label: string; intent: PillIntent }> = {
  suggested: { label: "To do", intent: "neutral" },
  ready: { label: "In progress", intent: "waiting" },
  apply: { label: "In progress", intent: "waiting" },
  verify: { label: "In progress", intent: "waiting" },
  measuring: { label: "Measuring", intent: "measuring" },
  result: { label: "Done", intent: "neutral" },
  blocked: { label: "To do", intent: "neutral" },
  skipped: { label: "To do", intent: "neutral" },
};
// The precise sub-state, shown as small secondary text next to the chip ONLY for apply/verify
// (that distinction adds real action info: "awaiting your Wix edit" vs "Beacon is confirming it
// went live" - a bare "ready" or "suggested" needs no extra word beyond the chip itself).
const STATUS_DETAIL: Partial<Record<CanonicalChange["status"], string>> = {
  apply: "awaiting your Wix edit",
  verify: "confirming it's live",
};
const EVIDENCE_CLS: Record<string, string> = { strong: "text-status-success", directional: "text-status-warning", tracking: "text-muted-foreground" };

// Item 55 - one identity chip per lever family so rows scan by shape, not by reading. These
// are content-type identities, not verdicts, so each family keeps its own distinguishable
// hue (kept deliberately) rather than collapsing onto the six Pill intents.
const FAMILY_CHIP: Record<string, { label: string; cls: string }> = {
  meta: { label: "Description", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  title: { label: "Title", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  title_meta: { label: "Title + description", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  h1: { label: "Headline", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  answer: { label: "Direct answer", cls: "bg-pink-50 text-pink-700 ring-pink-200" },
  link: { label: "Internal link", cls: "bg-teal-50 text-teal-700 ring-teal-200" },
  schema: { label: "Structured data", cls: "bg-slate-50 text-slate-600 ring-slate-200" },
  new_page: { label: "New page", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cro: { label: "Experience", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  other: { label: "Page edit", cls: "bg-status-neutral-bg text-muted-foreground ring-border" },
};

// Item 57 - the goal groups the default view reads in (business language first).
const GOAL_GROUPS: { id: string; title: string; match: (c: CanonicalChange) => boolean }[] = [
  { id: "clicks", title: "Win more clicks", match: (c) => c.opportunityType === "Capture clicks" },
  { id: "ai", title: "Get cited by AI", match: (c) => c.opportunityType === "Win AI citations" },
  { id: "experience", title: "Fix the experience", match: (c) => c.opportunityType === "Fix experience" },
  { id: "pages", title: "Build new pages", match: (c) => c.opportunityType === "New page" },
];

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

// Item 18 - ONE formatter discipline: compact in chips, full number on hover (title attr).
function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  return formatMetricCompact(n);
}

// B9 (worklist fix batch) - a raw slug ("/persian-male-names") is not a page title. Whatever
// upstream source produced it, the row must show a real title when one is available (the
// move's target query/topic reads like actual words), and otherwise humanize the slug itself
// rather than showing the bare path. The raw path stays as secondary text underneath.
function looksLikeSlug(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("/") || /^[a-z0-9]+(-[a-z0-9]+)+$/.test(t)) && !t.includes(" ");
}
function humanizeSlug(s: string): string {
  return s.replace(/^\/+/, "").replace(/[-_]+/g, " ").trim();
}
function displayPageLabel(c: CanonicalChange, move: ChangesView["movesById"][string] | undefined): { title: string; secondary: string | null } {
  if (!looksLikeSlug(c.pageLabel)) return { title: c.pageLabel, secondary: null };
  const humanQuery = move?.query && !looksLikeSlug(move.query) ? move.query : null;
  const title = humanQuery ?? humanizeSlug(c.pageLabel);
  return { title, secondary: c.pageLabel !== title ? c.pageLabel : null };
}

/** UX3 - the row's full detail content (paste text, roundtable, evidence, forecasts, buttons),
 *  factored out so it can render either inline (mobile, when a side panel would fight the
 *  layout) or inside the split detail panel (desktop) without duplicating a single line of it. */
function RowDetailContent({
  c,
  move,
  rank,
  onAction,
}: {
  c: CanonicalChange;
  move: ChangesView["movesById"][string] | undefined;
  rank: number;
  onAction?: (kind: "done" | "skip") => void;
}) {
  return move ? (
    <MoveCard m={move} rank={rank} onAction={(kind) => onAction?.(kind === "shipped" ? "done" : "skip")} />
  ) : (
    <div className="px-3 py-2 text-body">
      {c.before != null && <div className="break-words text-meta"><span className="text-muted-foreground">Current: </span>{c.before || "(none)"}</div>}
      {c.after != null && <div className="break-words text-meta"><span className="text-muted-foreground">Proposed: </span><strong>{c.after}</strong></div>}
      {c.exactInstructions && <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-surface-raised p-2 text-meta font-mono text-foreground-secondary">{c.exactInstructions}</pre>}
      <div className="mt-2 text-meta text-muted-foreground">{c.measurementMethod}{c.selectedForToday ? " · selected for today - apply it in the “Today’s changes” panel above" : ""}</div>
    </div>
  );
}

function Row({
  c,
  move,
  rank,
  highlighted,
  keyboardActive,
  onAction,
  registerRef,
  selected,
  onToggleSelect,
  detailOpen,
  onToggleDetail,
  topPick,
}: {
  c: CanonicalChange;
  move: ChangesView["movesById"][string] | undefined;
  rank: number;
  /** D6 - true when this is the "next best" row the session banner is pointing at; gets a
   *  visible ring so "auto-scroll/highlight the next unblocked top item" is honest, not just a
   *  scroll with nothing to look at once you land. */
  highlighted?: boolean;
  /** D6 - true when j/k keyboard navigation has this row focused (independent of `highlighted`,
   *  which tracks the session's next-best pointer, not keyboard position). */
  keyboardActive?: boolean;
  /** D6 - fires once MoveCard's own ship/stage/snooze action actually persists, so the session
   *  loop can advance + count it. Undefined when this row has no expandable MoveCard (nothing
   *  to reuse), which is fine - not every row is markable from here. */
  onAction?: (kind: "done" | "skip") => void;
  /** D6 - hands the row's DOM node up so keyboard nav (enter) and auto-scroll (next-best) can
   *  target it without a brittle document.querySelector by id. */
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
  /** UX3 - multi-select checkbox state, owned by the list (so the floating bulk bar can act on
   *  every checked row at once). Undefined selection handler = no checkbox rendered at all. */
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** UX3 - whether THIS row is the one the split detail panel is showing. On small screens
   *  (no room for a side panel) the same content renders inline below the row instead. */
  detailOpen?: boolean;
  onToggleDetail?: (id: string) => void;
  /** FP9 (2026-07-02, killer finding 4) - true for the top 3 rows of the default flat view.
   *  Same card, same actions, same everything - just visually dominant (a "Start here" label +
   *  a stronger border/padding) so "pick the top few" reads as true instead of ~136 equal rows. */
  topPick?: boolean;
}) {
  const open = detailOpen ?? false;
  const setOpen = onToggleDetail ? () => onToggleDetail(c.id) : () => {};
  const chip = STATUS_CHIP[c.status] ?? STATUS_CHIP.suggested;
  const statusDetail = STATUS_DETAIL[c.status];
  const isMeasure = c.status === "measuring" || c.status === "result";
  // B2 - "Apply in Wix" is the precise action, spoken as the BUTTON label (not a status pill).
  const cta = isMeasure ? (c.status === "result" ? "View result" : "View measurement") : c.status === "apply" ? "Apply in Wix" : c.status === "verify" ? "Apply" : "Review";
  const panelId = `change-detail-${c.id}`;
  const effort = Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : null;
  const label = displayPageLabel(c, move);
  const href = dossierHref(c.pagePath || c.pageUrl);
  // D6 - the ring makes "auto-scroll/highlight the next unblocked top item" honest: landing on
  // a row that looks identical to every other row would defeat the point of pointing at it.
  // Keyboard focus gets its own (subtler) ring so j/k navigation is visible without being
  // confused for the session's "next best" pointer.
  const ringCls = highlighted
    ? "ring-2 ring-status-success/60"
    : keyboardActive
      ? "ring-2 ring-status-info/40"
      : "";
  return (
    <div
      ref={(el) => registerRef?.(c.id, el)}
      id={`change-row-${c.id}`}
      data-change-row={c.id}
      tabIndex={-1}
      className={`rounded-lg bg-card transition-shadow ${
        topPick
          ? "border-2 border-status-info/30 shadow-sm"
          : "border border-border-subtle"
      } ${c.status === "blocked" ? "opacity-70" : ""} ${ringCls}`}
    >
      {topPick ? (
        <div className="flex items-center gap-1.5 rounded-t-md bg-status-info-bg px-3 py-1 text-meta font-bold uppercase tracking-wide text-status-info">
          Start here
        </div>
      ) : null}
      <div className={`flex items-center gap-3 px-3 ${topPick ? "py-3.5" : "py-2.5"}`}>
        {/* UX3 - multi-select checkbox. Absent (no reflow) on rows the list doesn't offer
            selection for (Not-now/blocked rows keep their own trailing control instead). */}
        {onToggleSelect ? (
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={() => onToggleSelect(c.id)}
            aria-label={`Select ${label.title}`}
            className={`h-3.5 w-3.5 shrink-0 rounded border-border text-status-info ${FOCUS}`}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {(() => {
              const fam = FAMILY_CHIP[c.changeFamily] ?? FAMILY_CHIP.other!;
              return <span className={`shrink-0 rounded px-1.5 py-0.5 text-meta font-semibold ring-1 ${fam.cls}`}>{fam.label}</span>;
            })()}
            {href ? (
              <Link
                href={href}
                className={`min-w-0 break-words font-semibold capitalize text-foreground underline-offset-2 hover:underline ${topPick ? "text-section" : "text-body"}`}
                title={label.secondary ?? undefined}
              >
                {label.title}
              </Link>
            ) : (
              <span className={`min-w-0 break-words font-semibold capitalize text-foreground ${topPick ? "text-section" : "text-body"}`} title={label.secondary ?? undefined}>{label.title}</span>
            )}
            {label.secondary ? <span className="shrink-0 text-meta text-muted-foreground">{label.secondary}</span> : null}
            {move?.sparkline && move.sparkline.length >= 5 ? <Sparkline points={move.sparkline} width={56} height={14} className="inline-block opacity-70" /> : null}
            <Pill intent={chip.intent}>{chip.label}</Pill>
            {statusDetail ? <span className="shrink-0 text-meta text-muted-foreground">{statusDetail}</span> : null}
            {c.selectedForToday && <Pill intent="neutral" className="border-indigo-200 bg-indigo-100 text-indigo-700">Today</Pill>}
          </div>
          <div className="mt-0.5 break-words text-meta text-muted-foreground">
            {c.measurementHeadline ? (
              <>
                <span className="font-medium text-foreground-secondary">{c.measurementHeadline}</span>
                {c.status === "measuring" && c.nextCheckpoint ? <span className="text-muted-foreground"> · next read {c.nextCheckpoint}</span> : null}
                {c.attributionLimited ? <span className="text-status-warning"> · overlapping edit</span> : null}
              </>
            ) : (
              c.recommendation
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-muted-foreground">
            <span>{c.opportunityType}</span>
            {effort != null ? <span>~{effort} min</span> : null}
            {/* UX0 (2026-07-02) - c.upside is GSC impressions (times shown on Google), never
                true market search volume (that only ever comes from DataForSEO) - the two
                numbers must never share a label or they read as the same thing. */}
            {fmt(c.upside) ? <span className="text-status-info" title={`${formatMetric(c.upside)} times shown on Google a month, at stake`}>{fmt(c.upside)} shown on Google/mo at stake</span> : null}
            {c.expectedOutcome && (c.status === "ready" || c.status === "suggested") ? <span className="text-status-success">{c.expectedOutcome}</span> : null}
            <span className={EVIDENCE_CLS[c.evidenceStrength] ?? "text-muted-foreground"}>{EVIDENCE_LABEL[c.evidenceStrength] ?? "Tracking only"}</span>
            {/* D4/N1 (unified allocator, 2026-07-02) - when 2+ opportunity lanes independently
                found the SAME page, say so in plain words. This is the operator's "everything
                working together" signal - a page confirmed by both AI answers and Google results
                is a higher-confidence move than either alone. */}
            {c.sources && c.sources.length > 1 ? (
              <span className="text-indigo-600" title="Multiple opportunity sources agree on this page">{c.sources.join(" + ")} agree</span>
            ) : null}
            {c.blockedReason ? <span className="inline-flex items-center gap-1 text-muted-foreground" title={c.blockedReason}><Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden />wait</span> : null}
            {c.qualityDecision === "flagged" ? <span className="inline-flex items-center gap-1 text-status-warning" title={c.qualityNote ?? "Review before shipping"}><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />Flagged</span> : c.qualityDecision === "caution" ? <span className="text-status-warning" title={c.qualityNote ?? "Quality caution"}>quality caution</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isMeasure ? (
            <Link href={`/proof?page=${encodeURIComponent(c.pageUrl)}`} className={`inline-flex min-h-[34px] items-center rounded-md border border-border px-2.5 py-1 text-body font-medium text-foreground-secondary hover:bg-surface-raised ${FOCUS}`}>{cta} →</Link>
          ) : c.status === "blocked" ? (
            <span className="text-meta text-muted-foreground" title={c.blockedReason ?? "Not actionable right now"}>Not now</span>
          ) : (
            <>
              <button type="button" onClick={() => setOpen()} aria-expanded={open} aria-controls={panelId} className={`inline-flex min-h-[34px] items-center rounded-md border border-border px-2.5 py-1 text-body font-medium text-foreground-secondary hover:bg-surface-raised ${FOCUS}`}>{open ? "Hide" : cta}</button>
              {/* D6 - a bare skip button for rows the operator wants to pass on WITHOUT opening
                  the full card (e.g. no draft to review yet). Feeds the same dismissal-learning
                  path ("deferred") the MoveCard's own "Not now" already uses, and, like every
                  other row action, always hands off to the next best row - never a dead end. */}
              {onAction ? (
                <button
                  type="button"
                  onClick={() => {
                    // Same dismissal-learning path MoveCard's own snooze() uses (the "deferred"
                    // status respondToRecommendation already records), reused rather than
                    // duplicated. When there's no matching worklist move (rare - a change with
                    // no sourceIds entry), this still advances the session; there's just nothing
                    // server-side to defer.
                    if (move) void respondToRecommendation(move.id, "deferred", { targetPageUrl: move.targetUrl });
                    onAction("skip");
                  }}
                  className={`inline-flex min-h-[34px] items-center rounded-md px-2 py-1 text-meta font-medium text-muted-foreground hover:text-foreground-secondary ${FOCUS}`}
                  title="Not now - I will pick this up another day"
                >
                  Skip
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {/* UX3 - on screens with room for the split detail panel (lg+), the full content renders
          there instead, so opening a row never reflows or loses the list's scroll position. On
          narrow screens (no room for a side panel without fighting the layout) it renders right
          here, same as before. */}
      {open && (
        <div id={panelId} className="border-t border-border-subtle px-1 py-1 lg:hidden">
          <RowDetailContent c={c} move={move} rank={rank} onAction={onAction} />
        </div>
      )}
    </div>
  );
}

const STRATEGY_IDS = new Set<string>(STRATEGIES.map((s) => s.id));
const TAB_IDS = new Set<string>(TABS.map((t) => t.id));
const GOAL_IDS = new Set<string>(GOALS.map((g) => g.id));

export function ChangesListClient({ view }: { view: ChangesView }) {
  // Move 5 backfill - deep-link support: legacy routes (/recommendations, /experiments)
  // and Today links land here with ?status=/?strategy=/?goal=/?search=, so the list opens
  // on the right slice. Falls back to sensible defaults when a param is absent/invalid.
  const params = useSearchParams();
  const pStrategy = params.get("strategy");
  const pStatus = params.get("status");
  const pGoal = params.get("goal");
  const [strategy, setStrategy] = useState<Strategy>(pStrategy && STRATEGY_IDS.has(pStrategy) ? (pStrategy as Strategy) : "balanced");
  const initialTab: StatusView = pStatus && TAB_IDS.has(pStatus) ? (pStatus as StatusView) : view.summary.ready > 0 ? "ready" : "todo";
  const [tab, setTab] = useState<StatusView>(initialTab);
  const [goal, setGoal] = useState<Goal>(pGoal && GOAL_IDS.has(pGoal) ? (pGoal as Goal) : "recommended");
  const [q, setQ] = useState(params.get("search") ?? "");
  // Item 57 - group by GOAL is the default read ("Win more clicks" before "Ready"); picking a
  // status tab switches to the flat status view. A deep-linked ?status= starts flat.
  const [grouped, setGrouped] = useState<boolean>(!(pStatus && TAB_IDS.has(pStatus)));
  // Item 56 - "Tonight's 30 minutes": the accepted plan + top ready items that fit a 30-minute budget.
  const [tonight, setTonight] = useState(false);

  const ranked = useMemo(() => rankChanges(view.changes, strategy), [view.changes, strategy]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Item 59 - search that actually finds: page, query, why, teammate claims, verdicts, outcomes.
    const hay = (c: CanonicalChange): string => {
      const m = c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined;
      return [
        c.pageLabel, c.pagePath, c.recommendation, c.rationale, c.opportunityType, c.changeType,
        c.measurementHeadline ?? "", c.result ?? "", c.expectedOutcome ?? "",
        m?.query ?? "", m?.why ?? "", m?.rankWhy ?? "",
      ].join(" ").toLowerCase();
    };
    // Grouped (by goal) reads the actionable slice (to do + ready + apply); flat view uses the tab.
    const statusOk = (c: CanonicalChange) => (grouped ? inStatusView(c, "todo") || inStatusView(c, "ready") : inStatusView(c, tab));
    let rows = ranked.filter((c) => statusOk(c) && goalMatches(c, goal) && (!needle || hay(c).includes(needle)));
    if (tonight) {
      const actionable = rows.filter((c) => c.selectedForToday || c.status === "ready" || c.status === "apply");
      const picked: CanonicalChange[] = [];
      let budget = 30;
      for (const c of [...actionable].sort((a, b) => (b.selectedForToday ? 1 : 0) - (a.selectedForToday ? 1 : 0))) {
        const mins = Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : 5;
        if (mins <= budget) { picked.push(c); budget -= mins; }
      }
      rows = picked;
    }
    return rows;
  }, [ranked, tab, goal, q, tonight, grouped, view.movesById]);

  // D6 (daily ritual loop) - the session loop: after ANY row action (done/skip/not-now), always
  // point at the next best row + count it. Walks the SAME `visible` (already ranked + filtered)
  // list every row renders from, so "next best" never disagrees with what the list shows.
  const session = useWorklistSession(visible);
  const rowAction = useCallback(
    (id: string, kind: "done" | "skip") => session.handleRowAction(id, kind === "done" ? "done" : "skip"),
    [session],
  );

  // UX3 - the split detail panel: which row's full content is open. On lg+ screens that
  // content renders in the side panel (list never reflows, scroll position never moves); on
  // narrow screens the SAME `open` flag drives the existing inline expansion under the row.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const toggleDetail = useCallback((id: string) => setSelectedId((cur) => (cur === id ? null : id)), []);
  const selectedChange = selectedId ? (visible.find((c) => c.id === selectedId) ?? null) : null;
  const selectedMove = selectedChange?.sourceIds[0] ? view.movesById[selectedChange.sourceIds[0]] : undefined;

  // UX3 - multi-select: a checkbox per row + a floating bar for "Mark done" / "Skip" in a
  // bounded, sequential loop over exactly the checked ids, reusing the same rowAction (and its
  // underlying respondToRecommendation calls) a single row's buttons already use.
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const runBulk = useCallback(
    async (kind: "done" | "skip") => {
      const ids = [...checkedIds].filter((id) => visible.some((c) => c.id === id));
      if (ids.length === 0) return;
      setBulkPending(true);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        setBulkProgress(`${kind === "done" ? "Marking done" : "Skipping"} ${i + 1} of ${ids.length}...`);
        const c = visible.find((v) => v.id === id);
        const move = c?.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined;
        if (move) {
          if (kind === "done") {
            await respondToRecommendation(move.id, "accepted", { targetPageUrl: move.targetUrl, actionType: move.action, query: move.query });
          } else {
            await respondToRecommendation(move.id, "deferred", { targetPageUrl: move.targetUrl });
          }
        }
        rowAction(id, kind);
      }
      setBulkProgress(`${kind === "done" ? "Marked" : "Skipped"} ${ids.length} change${ids.length === 1 ? "" : "s"}.`);
      setCheckedIds(new Set());
      setBulkPending(false);
    },
    [checkedIds, visible, view.movesById, rowAction],
  );

  // Keyboard: j/k move a lightweight "keyboard focus" between visible rows, enter opens the
  // focused row's detail, d marks it done (only when it has a real MoveCard to reuse - ship()
  // there is the actual mark-edited affordance; a row with no matching move has nothing to
  // "d" into, so d silently no-ops rather than fabricating a fake done state). Native listeners
  // on this existing list client - no new framework.
  const [kbIndex, setKbIndex] = useState<number>(-1);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      const tag = (el as HTMLElement | null)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (visible.length === 0) return;
      if (e.key === "j") {
        e.preventDefault();
        setKbIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setKbIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (kbIndex < 0 || kbIndex >= visible.length) return;
        const el = rowRefs.current.get(visible[kbIndex].id);
        el?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click();
      } else if (e.key === "d") {
        if (kbIndex < 0 || kbIndex >= visible.length) return;
        const c = visible[kbIndex];
        const move = c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined;
        if (!move) return; // nothing markable without a real MoveCard - honest no-op, not fake state
        e.preventDefault();
        void respondToRecommendation(move.id, "accepted", { targetPageUrl: move.targetUrl, actionType: move.action, query: move.query });
        rowAction(c.id, "done");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, kbIndex, view.movesById, rowAction]);

  // Auto-scroll to the next-best row once the session points at one (after a mark/skip), so
  // "immediately surface the next best row" is a real scroll, not just a banner off-screen.
  useEffect(() => {
    if (!session.nextBest) return;
    const el = rowRefs.current.get(session.nextBest.id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [session.nextBest]);

  // UX3 - "tonight's batch" collapse: every change selected for today that has moved past
  // suggested/ready into verify/measuring/result is one applied receipt. Collapsing them to a
  // single summary row keeps the list dense once the plan has been worked; the individual
  // receipts stay one click away, never deleted or hidden for good. Only collapses in the flat
  // (non-grouped, non-tonight) status views, so "By goal" and "Tonight's 30 minutes" keep
  // showing every row exactly as they do today.
  const [batchExpanded, setBatchExpanded] = useState(false);
  const canCollapseBatch = !grouped && !tonight;
  const batchRows = useMemo(
    () => (canCollapseBatch ? visible.filter((c) => c.selectedForToday && (c.status === "verify" || c.status === "measuring" || c.status === "result")) : []),
    [canCollapseBatch, visible],
  );
  const batchVerifiedCount = batchRows.filter((c) => c.status === "measuring" || c.status === "result").length;
  const rowsWithoutBatch = canCollapseBatch && batchRows.length >= 2 ? visible.filter((c) => !batchRows.some((b) => b.id === c.id)) : visible;
  const showBatchSummary = canCollapseBatch && batchRows.length >= 2 && !batchExpanded;

  // FP9 (2026-07-02, killer finding 4) - "pick the top few" must be true, not just said: the flat
  // status view opens with the top 3 picks visually dominant ("Start here"), then the rest of the
  // ranked list capped at ~20 with an honest expander ("I keep them ranked so nothing is lost").
  // Only applies to the flat, non-tonight view - "By goal" already curates by category, and
  // "Tonight's 30 minutes" is already a small, deliberately-bounded set.
  const CURATION_CAP = 20;
  const [showAllRanked, setShowAllRanked] = useState(false);
  const curationRows = canCollapseBatch ? rowsWithoutBatch : visible;
  const applyCuration = canCollapseBatch && !showBatchSummary;
  const topPicks = applyCuration ? curationRows.slice(0, 3) : [];
  const afterTop = applyCuration ? curationRows.slice(3) : curationRows;
  const cappedRows = applyCuration && !showAllRanked ? afterTop.slice(0, CURATION_CAP) : afterTop;
  const hiddenRankedCount = applyCuration ? afterTop.length - cappedRows.length : 0;

  const s = view.summary;
  const isFiltered = q.trim().length > 0 || goal !== "recommended";
  // Distinguish WHY a view is empty: clean-strategy eligibility vs filtered vs genuinely-empty
  // status vs (for results/measuring) cause-specific copy.
  const emptyMessage = (): { title: string; hint: string | null; action: { label: string; onClick: () => void } | null } => {
    if (strategy === "clean" && view.changes.length > 0) {
      return { title: "No clean tests are available right now.", hint: "Switch to Balanced to include changes Beacon can track directionally.", action: { label: "Switch to Balanced", onClick: () => setStrategy("balanced") } };
    }
    if (isFiltered) {
      return { title: "No changes match these filters.", hint: "Try another status, strategy, or goal.", action: { label: "Reset filters", onClick: () => { setGoal("recommended"); setQ(""); } } };
    }
    if (tab === "results") return { title: "No mature results yet.", hint: "Your active changes are still collecting data. Early checkpoints stay in Measuring.", action: null };
    if (tab === "measuring") {
      // UX0 (2026-07-02) - never say "none measuring" when the canonical ledger count
      // says otherwise; this worklist's list is a subset (e.g. a page-factory or
      // AI-visibility measurement with no matching worklist move).
      if (view.measuringCountCanonical > 0) {
        return { title: `${view.measuringCountCanonical} change${view.measuringCountCanonical === 1 ? " is" : "s are"} measuring tenant-wide.`, hint: "None of them have a matching item in this worklist yet, check Today for the full list.", action: null };
      }
      return { title: "No changes are measuring yet.", hint: "Applied and verified changes will appear here.", action: null };
    }
    if (tab === "ready") return { title: "No changes are fully prepared.", hint: "Prepare a recommendation from To do, or accept today’s plan above.", action: null };
    return { title: "No changes to do right now.", hint: "Once your Google + AI demand data syncs, ranked changes appear here.", action: null };
  };
  const em = emptyMessage();

  return (
    <div className="flex items-start gap-4">
    <div className="min-w-0 flex-1 space-y-3">
      {/* Strategy */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span id="strategy-label" className="text-body font-medium text-muted-foreground">How should Beacon prioritize?</span>
        <div role="group" aria-labelledby="strategy-label" className="flex flex-wrap rounded-lg border border-border p-0.5">
          {STRATEGIES.map((st) => {
            const active = strategy === st.id;
            return (
              <button key={st.id} type="button" onClick={() => setStrategy(st.id)} title={st.hint} aria-pressed={active}
                className={`min-h-[32px] rounded-md px-2.5 py-1 text-body font-medium ${FOCUS} ${active ? "bg-foreground text-background hover:opacity-90" : "text-foreground-secondary hover:bg-surface-raised"}`}>{st.label}</button>
            );
          })}
        </div>
      </div>
      {/* Status tabs (scrollable on mobile) + goal + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="-mx-1 max-w-full overflow-x-auto px-1">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <button type="button" onClick={() => setGrouped(true)} aria-pressed={grouped}
              className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-body font-medium ${FOCUS} ${grouped ? "bg-foreground text-background hover:opacity-90" : "text-foreground-secondary hover:bg-surface-raised"}`}>
              By goal
            </button>
            {TABS.map((t) => {
              const active = !grouped && tab === t.id;
              // UX0 (2026-07-02) - the Measuring tab shows the SAME canonical count Today
              // shows (the proof ledger's own verdict field), never a separately-derived
              // number that can silently disagree (ground-truth: Today said 16, this tab
              // said 10). When this worklist only has a subset of the tenant's measuring
              // changes, the badge is honest about it ("10 of 16").
              const displayCount = t.id === "measuring" ? view.measuringCountCanonical : s[t.id];
              const badgeLabel = t.id === "measuring" && view.measuringCountCanonical > s.measuring
                ? `${s.measuring} of ${view.measuringCountCanonical}`
                : String(displayCount);
              return (
                <button key={t.id} type="button" onClick={() => { setTab(t.id); setGrouped(false); }} aria-pressed={active} aria-label={`${t.label}, ${displayCount} ${displayCount === 1 ? "change" : "changes"}`}
                  className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-body font-medium ${FOCUS} ${active ? "bg-status-info text-background hover:opacity-90" : "text-foreground-secondary hover:bg-surface-raised"}`}>
                  {t.label} <span aria-hidden className={active ? "text-background/80" : "text-muted-foreground"}>{badgeLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={() => setTonight((v) => !v)} aria-pressed={tonight}
          title="Just the accepted plan plus the top ready items that fit 30 minutes."
          className={`min-h-[32px] rounded-md border px-2.5 py-1 text-body font-medium ${FOCUS} ${tonight ? "border-indigo-300 bg-indigo-600 text-background hover:bg-indigo-500" : "border-border text-foreground-secondary hover:bg-surface-raised"}`}>
          Tonight&apos;s 30 minutes
        </button>
        <select aria-label="Filter by goal" value={goal} onChange={(e) => setGoal(e.target.value as Goal)} className={`min-h-[32px] rounded-md border border-border px-2 py-1 text-body text-foreground-secondary ${FOCUS}`}>
          {GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <input aria-label="Search pages" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages…" className={`min-h-[32px] w-full rounded-md border border-border px-2 py-1 text-body sm:ml-auto sm:w-44 ${FOCUS}`} />
      </div>
      {/* D6 - the daily ritual loop's session strip: "You have shipped N changes today" +
          "Next best: <exactWhat>" once an action fires. Self-hides on a fresh session. */}
      <WorklistSessionBanner
        shippedCount={session.shippedCount}
        banner={session.banner}
        onDismiss={session.dismissBanner}
        onOpenNext={
          session.nextBest
            ? () => rowRefs.current.get(session.nextBest!.id)?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click()
            : undefined
        }
      />
      {/* Item 66 - the invisible gate, made visible: protected pages are trust, not absence. */}
      {s.protectedPages > 0 ? (
        <p className="text-meta text-muted-foreground tabular-nums">
          {s.protectedPages} page{s.protectedPages === 1 ? " is" : "s are"} protected right now (mid-measurement or serving as comparisons). I will not suggest changes there until their results settle.
        </p>
      ) : null}
      {/* B7 / FP2 (killer finding 6) - "Ready 0" with no reason reads as broken. This is the
          answer to "why is this zero", not a footnote - it renders as a real, readable sentence
          (text-body, not a text-meta caption easy to miss) with its own visual weight. */}
      {view.readyZeroHint ? (
        <p className="rounded-md border border-border-subtle bg-surface-raised px-2.5 py-1.5 text-body text-foreground-secondary">
          {view.readyZeroHint}
          {view.readyZeroHint.includes("Wix pages aren't mapped") ? (
            <>
              {" "}
              <Link href="/settings/connectors" className={`rounded-sm font-medium text-status-info underline underline-offset-2 hover:opacity-80 ${FOCUS}`}>
                Check your Wix connection →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {/* FP2 (killer finding 5) - "Fix the experience rows silently vanish": one quiet
          acknowledgment line instead of silence when a row type got filtered upstream. */}
      {view.suppressedRowsNote ? (
        <p className="text-meta text-muted-foreground">{view.suppressedRowsNote}</p>
      ) : null}
      {/* List */}
      {visible.length === 0 ? (
        <div role="status">
          <EmptyState headline={em.title} nextStep={em.hint ?? undefined} />
          {em.action ? (
            <button type="button" onClick={em.action.onClick} className={`mt-3 inline-flex min-h-[34px] items-center rounded-md border border-border px-3 py-1 text-body font-medium text-foreground-secondary hover:bg-surface-raised ${FOCUS}`}>{em.action.label}</button>
          ) : null}
        </div>
      ) : grouped && !tonight ? (
        // Item 57 - the default read: goals first, business language, status still on each row.
        <div className="space-y-4">
          {GOAL_GROUPS.map((g) => {
            const rows = visible.filter(g.match);
            if (rows.length === 0) return null;
            return (
              <section key={g.id} aria-label={g.title}>
                <SectionHeader title={g.title} count={rows.length} level="h3" className="mb-1.5" />
                <div className="space-y-1.5">
                  {rows.map((c, i) => (
                    <Row
                      key={c.id}
                      c={c}
                      move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined}
                      rank={i + 1}
                      highlighted={session.nextBest?.id === c.id}
                      keyboardActive={visible[kbIndex]?.id === c.id}
                      onAction={(kind) => rowAction(c.id, kind)}
                      registerRef={registerRowRef}
                      selected={checkedIds.has(c.id)}
                      onToggleSelect={toggleChecked}
                      detailOpen={selectedId === c.id}
                      onToggleDetail={toggleDetail}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {(() => {
            const other = visible.filter((c) => !GOAL_GROUPS.some((g) => g.match(c)));
            if (other.length === 0) return null;
            return (
              <section aria-label="Other improvements">
                <SectionHeader title="Other improvements" count={other.length} level="h3" className="mb-1.5" />
                <div className="space-y-1.5">
                  {other.map((c, i) => (
                    <Row
                      key={c.id}
                      c={c}
                      move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined}
                      rank={i + 1}
                      highlighted={session.nextBest?.id === c.id}
                      keyboardActive={visible[kbIndex]?.id === c.id}
                      onAction={(kind) => rowAction(c.id, kind)}
                      registerRef={registerRowRef}
                      selected={checkedIds.has(c.id)}
                      onToggleSelect={toggleChecked}
                      detailOpen={selectedId === c.id}
                      onToggleDetail={toggleDetail}
                    />
                  ))}
                </div>
              </section>
            );
          })()}
        </div>
      ) : (
        <div className="space-y-1.5">
          {tonight ? (
            <p className="text-meta text-muted-foreground tabular-nums">
              Tonight&apos;s set: {visible.length} change{visible.length === 1 ? "" : "s"}, about {visible.reduce((t, c) => t + (Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : 5), 0)} minutes.
            </p>
          ) : null}
          {/* UX3 - the applied-batch summary row: "Tonight's batch: N applied, all verified"
              (or "M of N verified" while some are still confirming), expandable to the
              individual receipts. Only appears once 2+ of tonight's picks have moved past
              suggested/ready, so a fresh or barely-started plan still shows every row plainly. */}
          {showBatchSummary ? (
            <button
              type="button"
              onClick={() => setBatchExpanded(true)}
              aria-expanded={false}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border border-status-success/20 bg-status-success-bg px-3 py-2.5 text-left text-body font-medium text-status-success hover:opacity-90 ${FOCUS}`}
            >
              <span>
                Tonight&apos;s batch: {batchRows.length} applied{batchVerifiedCount === batchRows.length ? ", all verified" : `, ${batchVerifiedCount} of ${batchRows.length} verified`}.
              </span>
              <span className="shrink-0 text-meta font-semibold underline underline-offset-2">Show receipts</span>
            </button>
          ) : canCollapseBatch && batchRows.length >= 2 ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-status-success/15 bg-status-success-bg/60 px-3 py-1.5 text-meta font-medium text-status-success">
              <span>Tonight&apos;s batch, {batchRows.length} receipts</span>
              <button type="button" onClick={() => setBatchExpanded(false)} className={`shrink-0 underline underline-offset-2 ${FOCUS}`}>Collapse</button>
            </div>
          ) : null}
          {/* FP9 - the top 3 picks, visually dominant ("Start here"), before the ranked rest. */}
          {topPicks.map((c, i) => (
            <Row
              key={c.id}
              c={c}
              move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined}
              rank={i + 1}
              highlighted={session.nextBest?.id === c.id}
              keyboardActive={visible[kbIndex]?.id === c.id}
              onAction={(kind) => rowAction(c.id, kind)}
              registerRef={registerRowRef}
              selected={checkedIds.has(c.id)}
              onToggleSelect={toggleChecked}
              detailOpen={selectedId === c.id}
              onToggleDetail={toggleDetail}
              topPick
            />
          ))}
          {cappedRows.map((c, i) => (
            <Row
              key={c.id}
              c={c}
              move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined}
              rank={topPicks.length + i + 1}
              highlighted={session.nextBest?.id === c.id}
              keyboardActive={visible[kbIndex]?.id === c.id}
              onAction={(kind) => rowAction(c.id, kind)}
              registerRef={registerRowRef}
              selected={checkedIds.has(c.id)}
              onToggleSelect={toggleChecked}
              detailOpen={selectedId === c.id}
              onToggleDetail={toggleDetail}
            />
          ))}
          {/* FP9 - the honest expander: lower-priority ideas are capped from view, never lost. */}
          {applyCuration && hiddenRankedCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllRanked(true)}
              className={`flex w-full items-center justify-center rounded-lg border border-dashed border-border px-3 py-2 text-body font-medium text-muted-foreground hover:bg-surface-raised ${FOCUS}`}
            >
              {hiddenRankedCount} more lower-priority idea{hiddenRankedCount === 1 ? "" : "s"}. I keep them ranked so nothing is lost.
            </button>
          ) : applyCuration && showAllRanked && afterTop.length > CURATION_CAP ? (
            <button
              type="button"
              onClick={() => setShowAllRanked(false)}
              className={`flex w-full items-center justify-center rounded-lg border border-dashed border-border px-3 py-2 text-body font-medium text-muted-foreground hover:bg-surface-raised ${FOCUS}`}
            >
              Show fewer
            </button>
          ) : null}
          {batchExpanded && canCollapseBatch && batchRows.length >= 2 ? (
            <div className="space-y-1.5 border-t border-dashed border-border pt-1.5">
              {batchRows.map((c, i) => (
                <Row
                  key={c.id}
                  c={c}
                  move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined}
                  rank={i + 1}
                  highlighted={session.nextBest?.id === c.id}
                  keyboardActive={visible[kbIndex]?.id === c.id}
                  onAction={(kind) => rowAction(c.id, kind)}
                  registerRef={registerRowRef}
                  selected={checkedIds.has(c.id)}
                  onToggleSelect={toggleChecked}
                  detailOpen={selectedId === c.id}
                  onToggleDetail={toggleDetail}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
    {/* UX3 - the split detail panel: full existing card content (paste text, roundtable,
        evidence, forecasts, buttons) for whichever row is selected, without the list itself
        reflowing or losing scroll position. Hidden below lg (the row's own inline expansion
        covers narrow screens instead - see Row's `lg:hidden` inline panel). */}
    {selectedChange ? (
      <div className="sticky top-4 hidden max-h-[calc(100vh-2rem)] w-[380px] shrink-0 overflow-y-auto rounded-lg border border-border bg-card shadow-sm lg:block">
        <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
          <span className="text-body font-semibold text-muted-foreground">Change detail</span>
          <button type="button" onClick={() => setSelectedId(null)} className={`rounded-sm text-body font-medium text-muted-foreground hover:text-foreground-secondary ${FOCUS}`}>
            Close
          </button>
        </div>
        <div className="px-1 py-1">
          <RowDetailContent
            c={selectedChange}
            move={selectedMove}
            rank={visible.findIndex((c) => c.id === selectedChange.id) + 1}
            onAction={(kind) => rowAction(selectedChange.id, kind)}
          />
        </div>
      </div>
    ) : null}
    {/* UX3 - the floating bulk bar: appears once at least one row is checked, acts on exactly
        the checked set via the SAME per-row done/skip actions, sequentially and with honest
        progress text (never a silent bulk mutation). */}
    {checkedIds.size > 0 ? (
      <div className="fixed inset-x-0 bottom-4 z-20 flex justify-center px-4">
        <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-lg">
          <span className="text-body font-semibold text-foreground-secondary tabular-nums">
            {checkedIds.size} selected
          </span>
          {bulkProgress ? (
            <span role="status" aria-live="polite" className="text-meta text-muted-foreground">{bulkProgress}</span>
          ) : (
            <>
              <button type="button" disabled={bulkPending} onClick={() => runBulk("done")} className={`rounded-full bg-foreground px-3 py-1 text-body font-semibold text-background hover:opacity-90 disabled:opacity-60 ${FOCUS}`}>
                Mark done
              </button>
              <button type="button" disabled={bulkPending} onClick={() => runBulk("skip")} className={`rounded-full border border-border px-3 py-1 text-body font-medium text-foreground-secondary hover:bg-surface-raised disabled:opacity-60 ${FOCUS}`}>
                Skip
              </button>
              <button type="button" disabled={bulkPending} onClick={() => setCheckedIds(new Set())} className={`text-meta text-muted-foreground hover:text-foreground-secondary disabled:opacity-60 ${FOCUS}`}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>
    ) : null}
    </div>
  );
}
