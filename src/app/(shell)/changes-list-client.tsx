"use client";

/**
 * ChangesListClient (2026-07-02; UX3 dense inbox) - the canonical Changes list. ONE compact,
 * action-first row per change; status views (incl. the Watching evidence-hold tab) + goal filter +
 * search, pure client filtering over the server-built CanonicalChange[]. The list is ONE flat,
 * opportunity-ranked list (operator spec 2026-07-09 C-16/C-23: no strategy picker, no goal-bucket
 * section headers). Advanced detail opens in a split side panel
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
import { ChevronDown, Hourglass, RefreshCw, TriangleAlert } from "lucide-react";
import type { ChangesView } from "./changes-data";
import type { CanonicalChange, Goal, StatusView } from "@/domains/changes/canonical-change";
import { buildForecastInputLines, statusView } from "@/domains/changes/canonical-change";
import { difficultyLabel } from "@/domains/changes/difficulty";
import { WATCHING_SENTENCE } from "@/domains/recommendations/abstention";
import { ReceiptLine } from "@/components/data/receipt-line";
import { rankChanges, goalMatches, inStatusView } from "@/domains/changes/strategy";
import { MoveCard } from "./today-moves-card";
import { Sparkline } from "@/components/data/sparkline";
import { formatMetric, formatMetricCompact } from "@/lib/format-metric";
import { dossierHref } from "@/lib/page-dossier-link";
import { respondToRecommendation } from "./recommendation-actions";
import { useWorklistSession, WorklistSessionBanner } from "./worklist-session-strip";
import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import {
  rankReasonAt,
  honestMinutesLabel,
  sessionMinutesLine,
  resolveDiffPair,
  wordDiff,
  SNOOZE_DURATIONS,
} from "./worklist-row-helpers";

// operator spec 2026-07-09 C-23 - the priority/strategy mode picker is KILLED. The list always
// ranks by the default "balanced" strategy. The Strategy union and rankChanges' ranking math in
// strategy.ts are untouched (other callers still use them); this client just no longer offers a
// mode toggle.

// operator spec 2026-07-09 C-17 - the status tabs, plus a last, lower-priority "Watching" tab for
// changes Beacon is holding for insufficient evidence. "watching" is a view id, not a lifecycle
// status (it never maps to a CanonicalStatus), so it rides alongside StatusView as a TabId.
type TabId = StatusView | "watching";
const TABS: { id: TabId; label: string }[] = [
  { id: "todo", label: "To do" }, { id: "ready", label: "Ready" }, { id: "measuring", label: "Measuring" }, { id: "results", label: "Results" },
  { id: "watching", label: "Watching" },
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

// operator spec 2026-07-09 C-16 - the goal-bucket section headers are KILLED. The list renders as
// ONE flat, opportunity-ranked list (rankChanges' balanced order, unchanged); each card carries
// its own small type tag (FAMILY_CHIP) instead of a section header, so a title edit reads as
// "Title" inline rather than being sorted under a bucket.

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

// Item 18 - ONE formatter discipline: compact in chips, full number on hover (title attr).
function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  return formatMetricCompact(n);
}

// operator spec 2026-07-09 C-20 - the single most specific evidence sentence for a card, replacing
// the old "Directional signal" strength chip + the "X + Y agree" chip. Prefer the sized-forecast /
// basis sentence (expectedOutcome), fall back to the rank-reason line, and when only one of the
// two carries a number pick the one that does, so a card always shows a digit when the data has
// one. Returns null when neither sentence exists (the line self-hides). PURE.
function pickEvidenceSentence(expectedOutcome: string | null | undefined, rankReason: string | null): string | null {
  const eo = expectedOutcome?.trim() || null;
  const rr = rankReason?.trim() || null;
  const hasDigit = (s: string) => /\d/.test(s);
  if (eo && hasDigit(eo)) return eo;
  if (rr && hasDigit(rr)) return rr;
  return eo ?? rr ?? null;
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

// P13 word-level diff (v1 349/397) - "see exactly what changes". Renders a change's before -> after
// as a single readable line where removed words are struck through and added words are emphasized,
// so the operator sees the EXACT edit before shipping. State is carried by text weight + a "was/now"
// legend, never color alone (WCAG). Deterministic segments come from the pure wordDiff helper.
export function WordLevelDiff({ before, after }: { before: string; after: string }) {
  const segs = wordDiff(before, after);
  if (!segs) return null;
  return (
    <div className="mt-0.5 space-y-0.5 pl-4 text-meta">
      <p className="leading-relaxed text-foreground-secondary">
        {segs.map((s, i) =>
          s.type === "same" ? (
            <span key={i}>{s.text}</span>
          ) : s.type === "del" ? (
            <span key={i} className="text-muted-foreground line-through" title="Removed">
              {s.text}
            </span>
          ) : (
            <span key={i} className="font-semibold text-status-success" title="Added">
              {s.text}
            </span>
          ),
        )}
      </p>
      <p className="text-muted-foreground">Struck-through words go away, bold words are new.</p>
    </div>
  );
}

// P13 not-now durations + one-click re-draft (v1 350/351). Replaces the bare "Skip" with an honest
// menu: the DEFAULT action (the button itself, or the first menu item) is byte-identical to the old
// skip - it calls the SAME respondToRecommendation('deferred') path, which defers for a week, so
// "remind me in a week" is the true label for the unchanged behavior. The extra durations frame the
// same deferral (a custom remind date is a shared-store follow-up). "Redraft this" opens the row's
// detail, which carries the existing in-place Regenerate control - no new write path, no new widget.
export function NotNowMenu({
  onSnooze,
  onRedraft,
  canRedraft,
}: {
  /** Fires the deferral (same path the old bare Skip used) then advances the session. */
  onSnooze: () => void;
  /** Opens the row detail so the operator reaches the existing Regenerate affordance. */
  onRedraft: () => void;
  /** Only offer "Redraft this" when there is a matching move to regenerate. */
  canRedraft: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={`inline-flex min-h-[34px] items-center gap-1 rounded-md px-2 py-1 text-meta font-medium text-muted-foreground hover:text-foreground-secondary ${FOCUS}`}
        title="Not now, or redraft it"
      >
        Not now
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {SNOOZE_DURATIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                // Every duration routes through the SAME deferral the old Skip used (the store
                // defers a week regardless); the labels frame it honestly for the operator.
                onSnooze();
              }}
              className={`block w-full px-3 py-1.5 text-left text-meta text-foreground-secondary hover:bg-surface-raised ${FOCUS}`}
            >
              {d.label}
            </button>
          ))}
          {canRedraft ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onRedraft();
              }}
              className={`flex w-full items-center gap-1.5 border-t border-border-subtle px-3 py-1.5 text-left text-meta font-medium text-status-info hover:bg-surface-raised ${FOCUS}`}
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Redraft this instead
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
  // operator spec 2026-07-09 C-21 - the bare suggested/ready card action reads "See draft" (was
  // "Review"); "Approve & Push" never appears on a card, only in the detail view.
  const cta = isMeasure ? (c.status === "result" ? "View result" : "View measurement") : c.status === "apply" ? "Apply in Wix" : c.status === "verify" ? "Apply" : "See draft";
  const panelId = `change-detail-${c.id}`;
  const effort = Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : null;
  const label = displayPageLabel(c, move);
  const href = dossierHref(c.pagePath || c.pageUrl);
  // P13 honest minute math (v1 592) - a truthful bucket ("about 5 minutes") from the effort
  // field, self-hiding when there is no honest figure. Replaces the raw "~5 min" chip.
  const minuteLabel = honestMinutesLabel(c);
  // P13 rank explanation (v1 348/398) - one plain sentence for why this row sits where it does,
  // derived from the demand + winnability already on the change. Self-hides when unknown. Only on
  // actionable rows (measuring/result rows already speak in outcome language, not rank).
  const rankReason = isMeasure ? null : rankReasonAt(c, move, rank);
  // operator spec 2026-07-09 C-19 - difficulty FIRST, then time ("easy, about 2 minutes"), both
  // from the SAME effort estimate, on actionable rows only (measuring/result rows speak in outcome
  // language, not effort). Self-hides when there is no honest effort figure.
  const difficulty = isMeasure ? null : difficultyLabel(effort);
  // operator spec 2026-07-09 C-20 - the ONE evidence sentence this card shows, chosen so it always
  // carries a number when the data has one. Replaces the strength + "agree" chips below.
  const evidenceSentence = isMeasure ? null : pickEvidenceSentence(c.expectedOutcome, rankReason);
  // P13 word-level diff (v1 349/397) - resolve the before -> after pair for a diffable edit
  // (title/description/headline/answer). Null for non-edit rows, which self-hide the disclosure.
  const diffPair = isMeasure ? null : resolveDiffPair(c, move);
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
            {/* operator spec 2026-07-09 C-19 - difficulty FIRST, then time ("easy, about 2
                minutes"), both from the same effort estimate; exact minutes on hover. Falls back to
                time alone when there is no difficulty bucket, then to the raw minutes. */}
            {difficulty && minuteLabel ? (
              <span title={effort != null ? `${effort} minutes, estimated from the change type` : undefined}>{difficulty}, {minuteLabel}</span>
            ) : minuteLabel ? (
              <span title={effort != null ? `${effort} minutes, estimated from the change type` : undefined}>{minuteLabel}</span>
            ) : effort != null ? (
              <span>~{effort} min</span>
            ) : null}
            {/* audit #5 (2026-07-09) - c.upside is the MIDPOINT of the forecast CLICK range
                (opportunity-math lowPerMonth/highPerMonth), not impressions/volume. It was
                mislabeled "shown on Google/mo" which read as impressions and contradicted the
                adjacent "usually adds X clicks a month" basis. Label it as forecast clicks. */}
            {fmt(c.upside) ? <span className="text-status-info" title={`about ${formatMetric(c.upside)} extra clicks a month if this wins`}>~{fmt(c.upside)} clicks/mo upside</span> : null}
            {/* operator spec 2026-07-09 C-20 - the "Directional signal" strength chip, the separate
                expectedOutcome chip, and the "X + Y agree" chip are all GONE. They are replaced by
                the SINGLE evidence sentence rendered on its own line below this meta row. */}
            {c.blockedReason ? <span className="inline-flex items-center gap-1 text-muted-foreground" title={c.blockedReason}><Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden />wait</span> : null}
            {c.qualityDecision === "flagged" ? <span className="inline-flex items-center gap-1 text-status-warning" title={c.qualityNote ?? "Review before shipping"}><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />Flagged</span> : c.qualityDecision === "caution" ? <span className="text-status-warning" title={c.qualityNote ?? "Quality caution"}>quality caution</span> : null}
            {/* N46 (R6, 2026-07-03) - a quiet chip naming how old this row's evidence is, never a
                bare status word. Only "aging" rows show it; "expired" rows don't reach this render
                path by default (folded into the expander above). */}
            {c.freshness === "aging" && c.agingChip ? <span className="text-muted-foreground">{c.agingChip}</span> : null}
          </div>
          {/* operator spec 2026-07-09 C-20 - the ONE evidence sentence per card: the sized-forecast
              basis when it carries a number, else the rank-reason line ("This is first because it
              has real demand (1,200 times shown on Google a month)..."). Self-hides when there is
              no concrete sentence to stand on, so a card never shows a hand-wavy claim. */}
          {evidenceSentence ? (
            <p className="mt-0.5 text-meta text-foreground-secondary">{evidenceSentence}</p>
          ) : null}
          {/* P13 word-level diff (v1 349/397) - "see exactly what changes": before -> after as a
              word-level diff so the operator sees the EXACT edit before shipping. Only for diffable
              edits (title/description/headline/answer) with a real before AND after; self-hides
              otherwise. */}
          {diffPair ? (
            <details className="mt-0.5">
              <summary className={`cursor-pointer text-meta text-muted-foreground hover:text-foreground ${FOCUS}`}>
                See exactly what changes
              </summary>
              <WordLevelDiff before={diffPair.before} after={diffPair.after} />
            </details>
          ) : null}
          {/* R14b (see-the-math) - the sized forecast opens into its own inputs: times
              shown, current position, and which click-rate curve sized it. Same label
              convention as the Results cards. Absent for honest-fallback rows. */}
          {c.expectedOutcome && c.forecastInputs && (c.status === "ready" || c.status === "suggested") ? (
            <details className="mt-0.5">
              <summary className={`cursor-pointer text-meta text-muted-foreground hover:text-foreground ${FOCUS}`}>
                See the math
              </summary>
              <ul className="mt-0.5 space-y-0.5 pl-4 text-meta text-muted-foreground">
                {buildForecastInputLines(c.forecastInputs).map((line) => (
                  <li key={line} className="list-disc">{line}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isMeasure ? (
            <Link href={`/results?page=${encodeURIComponent(c.pageUrl)}`} className={`inline-flex min-h-[34px] items-center rounded-md border border-border px-2.5 py-1 text-body font-medium text-foreground-secondary hover:bg-surface-raised ${FOCUS}`}>{cta} →</Link>
          ) : c.status === "blocked" ? (
            <span className="text-meta text-muted-foreground" title={c.blockedReason ?? "Not actionable right now"}>Not now</span>
          ) : (
            <>
              <button type="button" onClick={() => setOpen()} aria-expanded={open} aria-controls={panelId} className={`inline-flex min-h-[34px] items-center rounded-md border border-border px-2.5 py-1 text-body font-medium text-foreground-secondary hover:bg-surface-raised ${FOCUS}`}>{open ? "Hide" : cta}</button>
              {/* P13 not-now durations + one-click re-draft (v1 350/351) - replaces the bare Skip
                  with an honest snooze menu ("remind me in a week", the true default) plus a
                  "Redraft this instead" affordance. The snooze feeds the SAME dismissal-learning
                  path ("deferred") the MoveCard's own "Not now" uses and always advances the session
                  (never a dead end); "Redraft this" opens the row detail, which carries the existing
                  in-place Regenerate control - no new write path. */}
              {onAction ? (
                <NotNowMenu
                  canRedraft={Boolean(move)}
                  onSnooze={() => {
                    // Same dismissal-learning path MoveCard's own snooze() uses (the "deferred"
                    // status respondToRecommendation already records), reused rather than
                    // duplicated. When there's no matching worklist move (rare - a change with
                    // no sourceIds entry), this still advances the session; there's just nothing
                    // server-side to defer.
                    if (move) void respondToRecommendation(move.id, "deferred", { targetPageUrl: move.targetUrl });
                    onAction("skip");
                  }}
                  onRedraft={() => setOpen()}
                />
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

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));
const GOAL_IDS = new Set<string>(GOALS.map((g) => g.id));

export function ChangesListClient({ view }: { view: ChangesView }) {
  // Move 5 backfill - deep-link support: legacy routes (/recommendations, /experiments)
  // and Today links land here with ?status=/?goal=/?search=, so the list opens on the right
  // slice. Falls back to sensible defaults when a param is absent/invalid.
  // operator spec 2026-07-09 C-23 - the ?strategy= deep-link param is gone with the picker; the
  // list always ranks by "balanced".
  const params = useSearchParams();
  const pStatus = params.get("status");
  const pGoal = params.get("goal");
  const initialTab: TabId = pStatus && TAB_IDS.has(pStatus) ? (pStatus as TabId) : view.summary.ready > 0 ? "ready" : "todo";
  const [tab, setTab] = useState<TabId>(initialTab);
  const [goal, setGoal] = useState<Goal>(pGoal && GOAL_IDS.has(pGoal) ? (pGoal as Goal) : "recommended");
  const [q, setQ] = useState(params.get("search") ?? "");
  // Item 56 - "Tonight's 30 minutes": the accepted plan + top ready items that fit a 30-minute budget.
  const [tonight, setTonight] = useState(false);

  // operator spec 2026-07-09 C-16/C-23 - ONE flat, opportunity-ranked list under the default
  // "balanced" strategy (no picker, no goal buckets). The Strategy union + rankChanges are
  // untouched; this caller just always asks for "balanced".
  const ranked = useMemo(() => rankChanges(view.changes, "balanced"), [view.changes]);
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
    // The flat list shows the current status tab. The "Watching" tab (C-17) renders its own held
    // items separately (view.watching), never the ranked action list, so it filters to empty here.
    const statusOk = (c: CanonicalChange) => (tab === "watching" ? false : inStatusView(c, tab));
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
  }, [ranked, tab, goal, q, tonight, view.movesById]);

  // D6 (daily ritual loop) - the session loop: after ANY row action (done/skip/not-now), always
  // point at the next best row + count it. Walks the SAME `visible` (already ranked + filtered)
  // list every row renders from, so "next best" never disagrees with what the list shows.
  // R20 (D6 dynamic auto-mode) - feed the session strip the server-truth FP3 lifecycle numbers
  // (prepared-but-not-shipped, whole-tenant measuring, shipped this week) so its live counter
  // agrees with every other surface. All three come from the ChangesView the server already built.
  const session = useWorklistSession(visible, {
    ready: view.readyCount,
    measuring: view.measuringCountCanonical,
    shippedThisWeek: view.shippedThisWeekCount,
  });
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
  // status views (never inside "Tonight's 30 minutes", which is already a bounded set).
  const [batchExpanded, setBatchExpanded] = useState(false);
  // operator spec 2026-07-09 C-16 - the goal-bucket grouping is gone; the batch collapse now only
  // steps aside for the Tonight budget view.
  const canCollapseBatch = !tonight;
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
  // Only applies to the flat, non-tonight view - "Tonight's 30 minutes" is already a small,
  // deliberately-bounded set.
  const CURATION_CAP = 20;
  const [showAllRanked, setShowAllRanked] = useState(false);
  // N46 (R6) - opportunity expiration: an EXPIRED row sinks to the tail of the curated pool
  // (never removed, never re-ranked among its fresh/aging peers - a stable partition, so
  // rankChanges's own order is untouched within each group) so it naturally falls into the
  // SAME honest expander rather than occupying one of the top/capped slots with a pitch Beacon
  // no longer trusts. It still shows up in full once the operator clicks "show all".
  const curationRows = useMemo(() => {
    const rows = canCollapseBatch ? rowsWithoutBatch : visible;
    const fresh = rows.filter((c) => c.freshness !== "expired");
    const expired = rows.filter((c) => c.freshness === "expired");
    return expired.length > 0 ? [...fresh, ...expired] : rows;
  }, [canCollapseBatch, rowsWithoutBatch, visible]);
  const applyCuration = canCollapseBatch && !showBatchSummary;
  const topPicks = applyCuration ? curationRows.slice(0, 3) : [];
  const afterTop = applyCuration ? curationRows.slice(3) : curationRows;
  const cappedRows = applyCuration && !showAllRanked ? afterTop.slice(0, CURATION_CAP) : afterTop;
  const hiddenRankedCount = applyCuration ? afterTop.length - cappedRows.length : 0;
  const expiredHiddenCount = applyCuration && !showAllRanked ? afterTop.filter((c) => c.freshness === "expired").length : 0;

  // P13 honest minute math (v1 592) - the session-total sentence for the flat working view, over
  // the picks actually shown at the top (top 3 + the capped rest), so it matches what the operator
  // is looking at. Only the To do / Ready working tabs get it (results/measuring aren't work to do).
  const sessionTotalChanges = applyCuration ? [...topPicks, ...cappedRows] : visible;
  const sessionTotalLine =
    tab === "todo" || tab === "ready"
      ? sessionMinutesLine(sessionTotalChanges)
      : null;

  const s = view.summary;
  const isFiltered = q.trim().length > 0 || goal !== "recommended";
  // Distinguish WHY a view is empty: filtered vs genuinely-empty status vs (for results/measuring)
  // cause-specific copy. (operator spec 2026-07-09 C-23 - the clean-strategy empty case is gone
  // with the picker; the list is always the balanced ranking.)
  const emptyMessage = (): { title: string; hint: string | null; action: { label: string; onClick: () => void } | null } => {
    if (goal === "new_pages") {
      // FP5b - new-page ideas' single home is the New Pages board on this same page;
      // a bare "no matches" here would read as "Beacon has no page ideas", a lie.
      return { title: "New page ideas live on the New pages board below.", hint: "Every topic worth building has one card there, with the competitor teardown and a draft.", action: null };
    }
    if (isFiltered) {
      return { title: "No changes match these filters.", hint: "Try another status, strategy, or goal.", action: { label: "Reset filters", onClick: () => { setGoal("recommended"); setQ(""); } } };
    }
    if (tab === "results") {
      // FP3 - never say "no results" when the canonical count says otherwise; this
      // list is a subset (a decided change may have no matching worklist move).
      if (view.decidedCountCanonical > 0) {
        return { title: `${view.decidedCountCanonical} change${view.decidedCountCanonical === 1 ? " has" : "s have"} a final read.`, hint: "None of them have a matching item in this list. They all live on the Results page.", action: null };
      }
      return { title: "No mature results yet.", hint: "Your active changes are still collecting data. Early checkpoints stay in Measuring.", action: null };
    }
    if (tab === "measuring") {
      // UX0 (2026-07-02) - never say "none measuring" when the canonical ledger count
      // says otherwise; this worklist's list is a subset (e.g. a page-factory or
      // AI-visibility measurement with no matching worklist move).
      if (view.measuringCountCanonical > 0) {
        // FP5d - the measuring list's single home is Results; this tab only ever
        // holds the subset with a matching worklist item.
        return { title: `${view.measuringCountCanonical} change${view.measuringCountCanonical === 1 ? " is" : "s are"} measuring right now.`, hint: "None of them have a matching item in this list. The full measuring list lives on the Results page.", action: null };
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
      {/* operator spec 2026-07-09 C-23 - the priority/strategy mode picker is GONE. The list is
          always the balanced ranking. Status tabs + goal filter + search remain. */}
      {/* Status tabs (scrollable on mobile) + goal + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="-mx-1 max-w-full overflow-x-auto px-1">
          {/* operator spec 2026-07-09 C-16/C-17 - no goal-bucket grouping toggle (ONE flat list);
              the last tab, "Watching", is the lower-priority evidence-hold view. */}
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {TABS.map((t) => {
              const active = tab === t.id;
              const isWatching = t.id === "watching";
              // UX0/FP3 (2026-07-02) - the Measuring and Results tabs show the SAME
              // canonical counts Today and the Results page show (the ONE-COUNT RULE in
              // domains/changes/lifecycle-counts.ts), never a separately-derived number
              // that can silently disagree (ground-truth: Today said 16, this tab said
              // 10). When this worklist only has a subset of the tenant's measuring or
              // decided changes, the badge is honest about it ("10 of 16"). The Watching
              // tab counts the held items (C-17), which summary does not track.
              const summaryCount = isWatching ? (view.watching?.length ?? 0) : s[t.id as StatusView];
              const canonical =
                t.id === "measuring" ? view.measuringCountCanonical : t.id === "results" ? view.decidedCountCanonical : null;
              const displayCount = canonical ?? summaryCount;
              const badgeLabel = canonical != null && canonical > summaryCount
                ? `${summaryCount} of ${canonical}`
                : String(displayCount);
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={active} aria-label={`${t.label}, ${displayCount} ${displayCount === 1 ? "change" : "changes"}`}
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
        progressLine={session.progressLine}
        weeklyLine={session.weeklyLine}
        prepareStatus={session.prepareStatus}
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
      {/* R14b (receipts everywhere) - when this ranked list was computed and from what
          source, built server-side in changes-data.ts so it never drifts on hydration. */}
      <ReceiptLine line={view.receiptLine} />
      {/* List */}
      {tab === "watching" ? (
        // operator spec 2026-07-09 C-17 - the Watching tab: changes Beacon is holding because it
        // does not yet have enough evidence (the N49 abstention hold). Each shows its page label,
        // its type tag, and the honest WATCHING_SENTENCE. Never a confident move, never deleted.
        // The empty state is honest, never a bare zero.
        <div role="status" className="space-y-1.5">
          {(view.watching ?? []).length === 0 ? (
            <EmptyState headline="Nothing is waiting for more evidence right now." />
          ) : (
            (view.watching ?? []).map((c) => {
              const move = c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined;
              const wLabel = displayPageLabel(c, move);
              const fam = FAMILY_CHIP[c.changeFamily] ?? FAMILY_CHIP.other!;
              return (
                <div key={c.id} className="rounded-lg border border-border-subtle bg-card px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-meta font-semibold ring-1 ${fam.cls}`}>{fam.label}</span>
                    <span className="min-w-0 break-words text-body font-semibold capitalize text-foreground" title={wLabel.secondary ?? undefined}>{wLabel.title}</span>
                  </div>
                  <p className="mt-0.5 text-meta text-muted-foreground">{WATCHING_SENTENCE}</p>
                </div>
              );
            })
          )}
        </div>
      ) : visible.length === 0 ? (
        <div role="status">
          <EmptyState headline={em.title} nextStep={em.hint ?? undefined} />
          {em.action ? (
            <button type="button" onClick={em.action.onClick} className={`mt-3 inline-flex min-h-[34px] items-center rounded-md border border-border px-3 py-1 text-body font-medium text-foreground-secondary hover:bg-surface-raised ${FOCUS}`}>{em.action.label}</button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          {tonight ? (
            <p className="text-meta text-muted-foreground tabular-nums">
              Tonight&apos;s set: {visible.length} change{visible.length === 1 ? "" : "s"}, about {visible.reduce((t, c) => t + (Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : 5), 0)} minutes.
            </p>
          ) : null}
          {/* P13 honest minute math (v1 592) - the session total across the picks shown at the top,
              in the SAME per-change effort fallback the "Tonight's 30 minutes" budget uses, so the
              two never disagree. Only on the flat working view (the Tonight view has its own). */}
          {!tonight && sessionTotalLine ? (
            <p className="text-meta text-muted-foreground tabular-nums">{sessionTotalLine}</p>
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
          {/* FP9 - the honest expander: lower-priority ideas are capped from view, never lost.
              N46 (R6) - when some of those hidden ideas expired, the SAME expander says so with
              an honest sub-line instead of a second expander or a bare status word. */}
          {applyCuration && hiddenRankedCount > 0 ? (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setShowAllRanked(true)}
                className={`flex w-full items-center justify-center rounded-lg border border-dashed border-border px-3 py-2 text-body font-medium text-muted-foreground hover:bg-surface-raised ${FOCUS}`}
              >
                {hiddenRankedCount} more lower-priority idea{hiddenRankedCount === 1 ? "" : "s"}. I keep them ranked so nothing is lost.
              </button>
              {expiredHiddenCount > 0 && view.expiredSubline ? (
                <p className="text-center text-meta text-muted-foreground">{view.expiredSubline}</p>
              ) : null}
            </div>
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
