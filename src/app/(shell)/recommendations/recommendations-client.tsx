"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  acceptRecommendation,
  deferRecommendation,
  dismissRecommendation,
  markRecommendationShipped,
  undoRecommendationResponse,
  type RecommendationActionPayload,
  type RecommendationActionResponse,
} from "./actions";
import type {
  RecommendationQueueRow,
  RecommendationWatchRow,
} from "./page";
import type { RecommendationType } from "@/domains/recommendations/generate";
import type {
  PageIntentResolution,
  RecommendationAction,
  RecommendationMotive,
} from "@/domains/recommendations/resolved-types";
import { NEEDS_NEW_PAGE } from "@/domains/recommendations/resolved-types";
import type { SuggestedEdit } from "@/domains/recommendations/adjudicator-schema";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { LifecycleStatusPill } from "@/components/display/lifecycle-status-pill";
import { RecConfidencePill } from "@/components/display/rec-confidence-pill";
import { summarizeEvidenceRefs } from "@/domains/recommendations/evidence-summary";
import { shouldExcludeFromCompetitorRanking } from "@/domains/recommendations/entity-pollution-filter";
import {
  classifyRecDisplayState,
  laneForDisplayState,
  REC_LANE_LABEL,
  REC_LANE_LEAD,
  REC_LANE_TONE,
  type RecLane,
} from "@/domains/recommendations/display-state";
import {
  humanizeRecTitle,
  pageNameFromUrl,
  extractTopicTag,
} from "@/domains/recommendations/recommendation-title-humanizer";
import {
  composeEvidencePreview,
  composeRecommendedMove,
} from "@/domains/recommendations/recommendation-evidence-preview";

type Props = {
  queue: RecommendationQueueRow[];
  watchlist: RecommendationWatchRow[];
  matrixDate: string;
  /** Step 1.1 (master plan) — lookup so evidence chips render a prompt
   *  text snippet instead of leaking the raw UUID into operator copy. */
  promptTextById: Record<string, string>;
};

/**
 * W3 Step 3.5d (2026-05-02) — lane-based decision queue.
 *
 * Operator scope (browser audit, third pass): replace the priority
 * gradient (NOW · 5 / THIS WEEK · 5 / LATER · 5) with semantic lanes
 * that tell the operator "what kind of action this is, and what to do
 * with it." Five lanes:
 *   1. Ready to ship — has exact usable edits, Accept+Track surface
 *   2. Needs decision — operator chooses direction, no fake edit
 *   3. Needs fresh edit — opportunity exists but edits dismissed
 *   4. Tracking — already accepted; no Accept/Defer/Dismiss
 *   5. Backlog — collapsed by default
 *
 * One display state per rec (`classifyRecDisplayState`) → one lane
 * (`laneForDisplayState`). The page sums lane counts into a summary
 * strip operators read in 5 seconds.
 */
export function RecommendationsClient({
  queue,
  watchlist,
  matrixDate,
  promptTextById,
}: Props) {
  const [showBacklog, setShowBacklog] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [feedback, setFeedback] = useState<{
    stableKey: string;
    message: string;
    isError: boolean;
  } | null>(null);

  // Classify every rec into a display state + lane. Reuses the same
  // classifier the rec card renders against, so lane assignment and
  // card behavior stay in lock-step.
  type ClassifiedRow = {
    row: RecommendationQueueRow;
    lane: RecLane | null;
  };
  const classified: ClassifiedRow[] = queue.map((row) => {
    const renderable = row.edits.filter((e) => {
      const s = e.implementation_status ?? "recommended";
      return s !== "dismissed" && s !== "not_found_after_7d";
    });
    const state = classifyRecDisplayState({
      resolvedAction: row.rec.resolution?.action ?? null,
      needsHumanReview: row.rec.resolution?.needsHumanReview ?? false,
      response: row.response
        ? {
            status: row.response.status,
            deferUntil: row.response.deferUntil,
          }
        : null,
      allEdits: row.edits.map((e) => ({
        implementation_status: e.implementation_status,
      })),
      renderableEdits: renderable.map((e) => ({
        implementation_status: e.implementation_status,
      })),
    });
    return { row, lane: laneForDisplayState(state) };
  });

  const inLane = (lane: RecLane): RecommendationQueueRow[] =>
    classified.filter((c) => c.lane === lane).map((c) => c.row);

  const lanes: ReadonlyArray<{ lane: RecLane; rows: RecommendationQueueRow[] }> =
    [
      { lane: "ready_to_ship", rows: inLane("ready_to_ship") },
      { lane: "needs_decision", rows: inLane("needs_decision") },
      { lane: "needs_fresh_edit", rows: inLane("needs_fresh_edit") },
      { lane: "tracking", rows: inLane("tracking") },
      { lane: "backlog", rows: inLane("backlog") },
    ];
  const suppressedCount = classified.filter((c) => c.lane === null).length;

  const summaryParts = lanes
    .filter((l) => l.rows.length > 0)
    .map(
      (l) =>
        `${l.rows.length} ${REC_LANE_LABEL[l.lane].toLowerCase()}`,
    );
  const summary =
    summaryParts.length > 0
      ? summaryParts.join(" · ")
      : "No active recommendations right now.";

  return (
    <>
      <div className="mb-4">
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Accept an action to track whether it moves AI visibility.
          Open evidence when you want the why.
        </p>
        <div className="mt-3 flex items-baseline justify-between gap-3 flex-wrap">
          <p
            className="text-[13px] font-medium text-foreground"
            data-recommendations-summary="true"
          >
            {summary}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Last refresh: {matrixDate}
          </p>
        </div>
        {suppressedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowSuppressed((v) => !v)}
            className="mt-2 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {showSuppressed
              ? `Hide dismissed / deferred (${suppressedCount})`
              : `Show ${suppressedCount} dismissed / deferred`}
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div className="space-y-8">
          {lanes
            .filter((l) => l.rows.length > 0 && l.lane !== "backlog")
            .map((l) => (
              <LaneSection
                key={l.lane}
                lane={l.lane}
                rows={l.rows}
                feedback={feedback}
                setFeedback={setFeedback}
                promptTextById={promptTextById}
              />
            ))}
          {/* Backlog is collapsed by default — operator scope. */}
          {inLane("backlog").length > 0 && (
            <BacklogSection
              rows={inLane("backlog")}
              expanded={showBacklog}
              onToggle={() => setShowBacklog((v) => !v)}
              feedback={feedback}
              setFeedback={setFeedback}
              promptTextById={promptTextById}
            />
          )}
        </div>
      )}

      {watchlist.length > 0 && <WatchSection rows={watchlist} />}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

/**
 * W3 Step 3.5d (2026-05-02) — lane-specific styling. Replaces the
 * pre-3.5d TIER_META gradient (red/yellow/grey by priority) with a
 * tone palette per lane semantic (success/warning/info/muted).
 */
const LANE_META: Record<
  RecLane,
  { accent: string; bg: string; dot: string }
> = {
  ready_to_ship: {
    accent: "text-status-success",
    bg: "border-status-success/30 bg-status-success/[0.03]",
    dot: "bg-status-success",
  },
  needs_decision: {
    accent: "text-status-warning",
    bg: "border-status-warning/30 bg-status-warning/[0.03]",
    dot: "bg-status-warning",
  },
  needs_fresh_edit: {
    accent: "text-status-warning",
    bg: "border-status-warning/30 bg-status-warning/[0.03]",
    dot: "bg-status-warning",
  },
  tracking: {
    accent: "text-accent-primary",
    bg: "border-accent-primary/30 bg-accent-primary/[0.03]",
    dot: "bg-accent-primary",
  },
  backlog: {
    accent: "text-muted-foreground",
    bg: "border-border/50 bg-surface-inset/20",
    dot: "bg-muted-foreground/60",
  },
};

function LaneSection({
  lane,
  rows,
  feedback,
  setFeedback,
  promptTextById,
}: {
  lane: RecLane;
  rows: RecommendationQueueRow[];
  feedback: {
    stableKey: string;
    message: string;
    isError: boolean;
  } | null;
  setFeedback: (
    f: { stableKey: string; message: string; isError: boolean } | null,
  ) => void;
  promptTextById: Record<string, string>;
}) {
  const meta = LANE_META[lane];
  return (
    <section
      className={cn("rounded-lg border px-5 py-4", meta.bg)}
      aria-labelledby={`rec-lane-${lane}-heading`}
      data-rec-lane={lane}
    >
      <header className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
          <h2
            id={`rec-lane-${lane}-heading`}
            className={cn(
              "text-[13px] font-bold tracking-tight",
              meta.accent,
            )}
          >
            {REC_LANE_LABEL[lane].toUpperCase()} · {rows.length}
          </h2>
        </div>
      </header>
      <p className="mb-3 text-[11px] text-muted-foreground leading-relaxed">
        {REC_LANE_LEAD[lane]}
      </p>
      <ul className="space-y-3">
        {rows.map((row) => (
          <RecommendationRow
            key={row.rec.stableKey}
            row={row}
            lane={lane}
            feedback={feedback}
            setFeedback={setFeedback}
            promptTextById={promptTextById}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * W3 Step 3.5d (2026-05-02) — backlog is collapsed by default
 * (operator scope: "Backlog collapsed by default or below the
 * fold"). When expanded, it renders the same LaneSection layout.
 */
function BacklogSection({
  rows,
  expanded,
  onToggle,
  feedback,
  setFeedback,
  promptTextById,
}: {
  rows: RecommendationQueueRow[];
  expanded: boolean;
  onToggle: () => void;
  feedback: {
    stableKey: string;
    message: string;
    isError: boolean;
  } | null;
  setFeedback: (
    f: { stableKey: string; message: string; isError: boolean } | null,
  ) => void;
  promptTextById: Record<string, string>;
}) {
  const meta = LANE_META.backlog;
  return (
    <section
      className={cn("rounded-lg border px-5 py-3", meta.bg)}
      aria-labelledby="rec-lane-backlog-heading"
      data-rec-lane="backlog"
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 flex-wrap text-left"
      >
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
          <h2
            id="rec-lane-backlog-heading"
            className={cn(
              "text-[13px] font-bold tracking-tight",
              meta.accent,
            )}
          >
            {REC_LANE_LABEL.backlog.toUpperCase()} · {rows.length}
          </h2>
        </div>
        <span className="text-[11px] text-muted-foreground select-none">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>
      {expanded && (
        <>
          <p className="mt-2 mb-3 text-[11px] text-muted-foreground leading-relaxed">
            {REC_LANE_LEAD.backlog}
          </p>
          <ul className="space-y-3">
            {rows.map((row) => (
              <RecommendationRow
                key={row.rec.stableKey}
                row={row}
                lane="backlog"
                feedback={feedback}
                setFeedback={setFeedback}
                promptTextById={promptTextById}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

/**
 * W3 Step 3.5b.D (2026-05-02) — motive copy humanized.
 *
 * Operator browser audit (2026-05-02) flagged the previous values
 * ("Capture absent cluster", "Counter competitor") as internal jargon.
 * Replaced with operator-readable "what Beacon noticed" sentences.
 * Internal motive enum keys stay unchanged so logs / DB / changelog
 * notes don't drift.
 *
 * W3 Step 3.5d (2026-05-02) — motive label is no longer rendered on
 * the default card; the lane badge replaces it. The map stays alive
 * because the expansion drawer surfaces it as "Why this matters" for
 * power users.
 */
const MOTIVE_LABEL: Record<RecommendationMotive, string> = {
  counter_competitor: "A competitor is currently winning this answer.",
  capture_absent_cluster: "AI is not citing Ritz for this topic yet.",
  improve_close_prompt:
    "Ritz is close, but the page needs more coverage.",
  defend_winning_cluster:
    "Ritz is currently the primary answer — keep it that way.",
  resolve_cannibalization:
    "Multiple Ritz pages compete for the same answer.",
  improve_citation_depth:
    "Ritz is cited but ranks low — strengthen the page.",
};

/* W3 Step 3.5d (2026-05-02) — `REC_TYPE_LABEL`, `ACTION_LABEL`, and
 * `TIER_BADGE` removed. The lane badge in the rec card header
 * replaced all three; internal taxonomy is preserved on `data-rec-*`
 * attributes for tests + diagnostics. */

/**
 * W3 Step 3.5b.E (2026-05-02) — strip bracketed diagnostic suffixes
 * from operator-facing copy. Resolver helpers like
 * `confidenceReason` sometimes append `[reason1; reason2; ...]`
 * scoring detail (e.g., "[1/1 label tokens match page; all label
 * tokens appear in URL path; geo cluster → location-route page]").
 * That detail is useful in evidence expansion, NOT on the default
 * rec card.
 *
 * Pure. Removes ALL bracketed segments. If the bracket is the whole
 * string, returns the trimmed remainder (which may be empty) so the
 * caller can branch on render.
 */
function stripBracketedDiagnostics(text: string): string {
  return text
    .replace(/\s*\[[^\]]*\]\s*\.?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * W3 Step 3.5c (2026-05-02) — defensive scrubber that removes raw
 * prompt-id references (UUIDs or 8+ hex prefixes) from operator-
 * facing text. Operator browser audit (2026-05-02) caught
 * "prompt 319557d1" in a default-card Why field — likely from a
 * resolver / LLM-edit text that snuck a partial prompt id past the
 * UUID-rendering helpers.
 *
 * Patterns scrubbed (case-insensitive):
 *   - `prompt 319557d1` / `prompt: 319557d1` (8+ hex prefix)
 *   - `prompt 319557d1-aaaa-bbbb-cccc-dddddddddddd` (full UUID)
 *
 * Replacement: "an affected prompt" — preserves grammar without
 * leaking ids. Pure / deterministic.
 */
function scrubRawPromptIds(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  // Full UUID v4-style: 8-4-4-4-12 hex with optional `prompt[:\s]+`
  // prefix.
  let out = text.replace(
    /\bprompt\s*:?\s*[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,
    "an affected prompt",
  );
  // Bare UUID without the "prompt" prefix.
  out = out.replace(
    /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,
    "an affected prompt",
  );
  // 8+ hex prefix with explicit "prompt" prefix (e.g., "prompt
  // 319557d1"). Word-boundary anchored to avoid matching real words
  // like "prompted".
  out = out.replace(
    /\bprompt\s*:?\s*[a-f0-9]{8,}\b/gi,
    "an affected prompt",
  );
  return out;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
}

function RecommendationRow({
  row,
  lane,
  feedback,
  setFeedback,
  promptTextById,
}: {
  row: RecommendationQueueRow;
  lane: RecLane;
  feedback: {
    stableKey: string;
    message: string;
    isError: boolean;
  } | null;
  setFeedback: (
    f: { stableKey: string; message: string; isError: boolean } | null,
  ) => void;
  promptTextById: Record<string, string>;
}) {
  const { rec, response, edits: allEdits } = row;
  // W3 Step 3.1b (2026-05-01) — filter dismissed + not_found_after_7d
  // edits from the rendered queue. Dismissed rows include the
  // pre-W3 placeholder rows quarantined by
  // scripts/quarantine-pre-w3-placeholder-edits.ts; their proposed_text
  // still contains the original placeholder copy and the operator
  // must never see it again. not_found_after_7d is similarly
  // unactionable. The lifecycle classifier on /changes already
  // treats both as `unclassified` (not surfaced); this brings
  // /recommendations into parity.
  const edits = allEdits.filter((e) => {
    const s = e.implementation_status ?? "recommended";
    return s !== "dismissed" && s !== "not_found_after_7d";
  });
  const editCount = edits.length;
  // W2 Step 2.4 (2026-05-01) — operator-override eligibility + staleness.
  // Eligible edits = those still pre-verified (recommended | accepted).
  // The Mark-shipped button only renders when at least one eligible edit
  // exists; otherwise the rec is already past the override.
  // editLifecycleStatus is inlined to keep this file client-safe (the
  // helper module is `server-only`).
  const eligibleEditCount = edits.filter((e) => {
    const s = e.implementation_status ?? "recommended";
    return s === "recommended" || s === "accepted";
  }).length;

  // W3 Step 3.5c (2026-05-02) — display-state classifier drives the
  // chip + action surface. accepted_tracking suppresses the
  // Accept/Defer/Dismiss row; needs_fresh_edit shows the empty-edits
  // hint; manual_review surfaces the operator-judgment surface.
  const displayState = classifyRecDisplayState({
    resolvedAction: rec.resolution?.action ?? null,
    needsHumanReview: rec.resolution?.needsHumanReview ?? false,
    response: response
      ? { status: response.status, deferUntil: response.deferUntil }
      : null,
    allEdits: allEdits.map((e) => ({
      implementation_status: e.implementation_status,
    })),
    renderableEdits: edits.map((e) => ({
      implementation_status: e.implementation_status,
    })),
  });
  const [pending, startTransition] = useTransition();

  const showFeedback = feedback && feedback.stableKey === rec.stableKey;

  // Payload built below after `resolution` is resolved.

  function handle(
    action: () => Promise<RecommendationActionResponse>,
    successMsg: string,
  ) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.success) {
          setFeedback({
            stableKey: rec.stableKey,
            message: res.changeId
              ? `${successMsg} — changelog entry created (${res.changeId}).`
              : successMsg,
            isError: false,
          });
        } else {
          setFeedback({
            stableKey: rec.stableKey,
            message: res.error ?? "Action failed.",
            isError: true,
          });
        }
      } catch (e) {
        setFeedback({
          stableKey: rec.stableKey,
          message: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        });
      }
    });
  }

  const accepted = response?.status === "accepted";
  const dismissed = response?.status === "dismissed";
  const deferred = response?.status === "deferred";

  // W2 Step 2.4 (2026-05-01) — day-3 stale tint.
  // If operator accepted ≥3 days ago and at least one edit is still
  // pre-verified, surface a warning tint + tooltip so the rec doesn't
  // sit idle forever. The 3-day threshold matches the lifecycle spec
  // (RECOMMENDATION_LIFECYCLE_OS_SPEC.md §6 — pre-day-7 escalation).
  const STALE_PENDING_DAYS = 3;
  const acceptedAt =
    response?.status === "accepted" && response.respondedAt
      ? new Date(response.respondedAt)
      : null;
  const acceptedAgeDays = acceptedAt
    ? Math.floor((Date.now() - acceptedAt.getTime()) / 86_400_000)
    : 0;
  const isStalePending =
    accepted && eligibleEditCount > 0 && acceptedAgeDays >= STALE_PENDING_DAYS;

  // v7 Commit 4: prefer resolved fields when the resolver attached them.
  // Falls back to the candidate's generator-stage labels for safety.
  const resolution = rec.resolution;
  const action: RecommendationAction =
    resolution?.action ?? actionFromCandidateType(rec.type);
  // W3 Step 3.5d (2026-05-02) — operator browser audits flagged
  // ACTION_LABEL ("Strengthen" / "Expand") + MOTIVE_LABEL +
  // TIER_BADGE ("Site match" / "AI-reviewed") as internal jargon
  // visible in the default card. The lane badge replaces all three
  // — operators read "READY TO SHIP" / "NEEDS DECISION" / "TRACKING"
  // / "BACKLOG" / "NEEDS FRESH EDIT" instead. Internal labels stay
  // available in the expansion drawer for power users + diagnostics.
  const resolvedUrl =
    resolution && resolution.targetUrl !== NEEDS_NEW_PAGE
      ? resolution.targetUrl
      : null;
  // W3 Step 3.5d (2026-05-02) — title goes through the new domain-
  // specific humanizer. LLM operatorTitle still wins (the humanizer
  // short-circuits there). Falls back to deterministic topic + geo
  // detection so titles like "Create an Atherton older-home rebuild
  // page" ship without LLM cost on the page render path.
  const title = humanizeRecTitle({
    clusterLabel: rec.clusterLabel,
    promptTextFallback: rec.title,
    resolution: resolution ?? null,
  });
  const labelSource =
    rec.clusterLabel ?? rec.title ?? "";
  const topicTag = extractTopicTag(labelSource);
  const pageName = pageNameFromUrl(resolvedUrl);
  // W3 Step 3.5d (2026-05-02) — recommended-move + evidence-preview
  // sentences replace the old reasoning + confidenceReason +
  // motiveLabel triplet on the default card. Each is one sentence.
  const recommendedMove = composeRecommendedMove({
    action,
    topic: topicTag,
    pageName,
    resolution: resolution ?? null,
  });
  // Why-now copy comes from resolution.reasoning (the resolver-
  // emitted prose), scrubbed for raw prompt-ids + bracketed
  // diagnostics. Falls back to rec.reasoning when resolution is null.
  const whyNowRaw = resolution?.reasoning ?? rec.reasoning;
  const whyNow = scrubRawPromptIds(stripBracketedDiagnostics(whyNowRaw));
  const evidencePreview = composeEvidencePreview({
    affectedPromptCount: rec.evidence.promptCount,
    observationCount: rec.evidence.observationCount,
    brandPrimaryShare:
      rec.evidence.brandPrimaryPromptCount > 0 &&
      rec.evidence.promptCount > 0
        ? rec.evidence.brandPrimaryPromptCount / rec.evidence.promptCount
        : null,
    primaryCompetitors: rec.evidence.primaryCompetitors,
    resolvedAction: action,
    resolvedTargetUrl: resolution?.targetUrl ?? null,
    hasResolvedTarget: resolvedUrl !== null,
  });
  // Diagnostic content moved entirely behind expansion (operator
  // scope: default card never shows debug paragraphs). These feed
  // the expansion drawer below.
  const specificRecommendation = resolution?.specificRecommendation ?? null;
  const confidenceReason = resolution?.confidenceReason ?? null;
  const suggestedEdits = resolution?.suggestedEdits ?? [];
  const pageBrief = resolution?.pageBrief ?? null;
  const risks = resolution?.risks ?? [];
  const cannibalization = resolution?.cannibalization ?? null;
  const needsHumanReview = resolution?.needsHumanReview ?? false;
  // W3 Step 3.5d (2026-05-02) — motive copy is no longer on the
  // default card (operator: "internal jargon"). Kept as a local for
  // the expansion drawer so power users still see *why* Beacon
  // surfaced the rec.
  const motive = resolution?.motive ?? null;
  const motiveLabel = motive ? MOTIVE_LABEL[motive] : null;
  // Lane badge tone palette (mirror LANE_META).
  const laneBadgeClass =
    REC_LANE_TONE[lane] === "success"
      ? "border-status-success/40 bg-status-success/[0.08] text-status-success"
      : REC_LANE_TONE[lane] === "warning"
        ? "border-status-warning/40 bg-status-warning/[0.08] text-status-warning"
        : REC_LANE_TONE[lane] === "info"
          ? "border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary"
          : "border-border/60 bg-surface-inset/40 text-muted-foreground";

  // Phase 1 (2026-04-24): payload ships the already-resolved title so the
  // server action writes it directly to the changelog. Never ship the raw
  // generator title — it contradicts the resolved action and leaks
  // internal taxonomy prefixes.
  const payload: RecommendationActionPayload = {
    stableKey: rec.stableKey,
    type: rec.type,
    title,
    description: rec.description,
    clusterLabel: rec.clusterLabel,
    clusterKind: rec.clusterKind,
    resolution: resolution
      ? {
          action: resolution.action,
          motive: resolution.motive,
          targetUrl: resolution.targetUrl,
          reasoning: resolution.reasoning,
          // Phase 5 (2026-04-24): confidence reaches changelog notes.
          confidence: resolution.confidence,
          operatorTitle: title,
          specificRecommendation: resolution.specificRecommendation,
          suggestedEdits: resolution.suggestedEdits,
          pageBrief: resolution.pageBrief ?? null,
          proposedSlug: resolution.proposedSlug ?? null,
          risks: resolution.risks,
        }
      : undefined,
  };

  // W3 Step 3.5d (2026-05-02) — operator-readable effort label.
  // Replaces the prior raw enum chip ("low" / "medium" / "high").
  // Internal enum stays on rec.effort for tests + diagnostics.
  const effortLabel =
    rec.effort === "low"
      ? "Quick win"
      : rec.effort === "high"
        ? "Heavy lift"
        : rec.effort === "medium"
          ? "Medium effort"
          : `${rec.effort} effort`;

  // Real top competitor for the diagnostic chip-row inside expansion
  // — the entity-pollution-filter drops generic nouns + directories.
  // Surfaced ONLY in the expansion drawer; the default card's evidence
  // line is the operator-facing surface.
  const topCompetitor = rec.evidence.primaryCompetitors.find((c) => {
    if (!c || typeof c.name !== "string" || c.name.trim().length === 0) {
      return false;
    }
    return !shouldExcludeFromCompetitorRanking(c.name);
  });

  // Whether the expansion drawer has any content worth showing. When
  // every diagnostic field is empty there's no point rendering the
  // "Show evidence" toggle — keep the card terminal.
  const hasExpansionContent =
    (whyNowRaw.length > 0 && whyNowRaw !== whyNow) ||
    !!confidenceReason ||
    !!motiveLabel ||
    !!specificRecommendation ||
    suggestedEdits.length > 0 ||
    !!pageBrief ||
    risks.length > 0 ||
    (cannibalization !== null && cannibalization.length > 0) ||
    edits.length > 0 ||
    allEdits.length > 0 ||
    !!topCompetitor;

  return (
    <li
      id={`rec-${encodeURIComponent(rec.stableKey)}`}
      className={cn(
        "rounded-md border bg-background px-3.5 py-3",
        accepted
          ? isStalePending
            ? "border-status-warning/50 bg-status-warning/[0.03]"
            : "border-status-success/40"
          : dismissed
            ? "border-border/30 opacity-60"
            : deferred
              ? "border-border/50 opacity-80"
              : "border-border/50",
      )}
      data-stale-pending={isStalePending ? "true" : undefined}
      data-rec-display-state={displayState}
      data-rec-lane={lane}
      data-rec-action={action}
      data-rec-tier={resolution?.tier ?? "deterministic_only"}
      data-rec-engine-confidence={rec.engineConfidence}
      data-rec-effort={rec.effort}
      title={
        isStalePending
          ? `Accepted ${acceptedAgeDays} day${acceptedAgeDays === 1 ? "" : "s"} ago — still tracking. Click "Mark shipped" if it's already live.`
          : undefined
      }
    >
      {/* Header: Lane badge + Confidence pill + status chips + Title.
          Operator scope (W3 §3.5d): the lane badge replaces the prior
          ACTION_LABEL ("Strengthen" / "Expand"), MOTIVE_LABEL prose,
          and TIER_BADGE ("Site match" / "AI-reviewed"). All three were
          internal jargon; the lane name (READY TO SHIP / NEEDS DECISION
          / TRACKING / BACKLOG / NEEDS FRESH EDIT) tells the operator
          what to DO with the rec at a glance. Internal taxonomy is
          preserved on `data-rec-*` attributes for tests + diagnostics. */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap",
            laneBadgeClass,
          )}
          data-rec-lane-badge={lane}
        >
          {REC_LANE_LABEL[lane]}
        </span>
        <RecConfidencePill verdict={rec.engineConfidence} />
        {needsHumanReview && (
          <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-status-warning/40 bg-status-warning/[0.06] text-status-warning">
            Needs your judgment
          </span>
        )}
        {isStalePending && (
          <span
            className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-status-warning/40 bg-status-warning/[0.08] text-status-warning"
            title={`Accepted ${acceptedAgeDays} day${acceptedAgeDays === 1 ? "" : "s"} ago — scan hasn't confirmed it on the page yet.`}
          >
            {acceptedAgeDays}d pending
          </span>
        )}
        <h3 className="text-[13px] font-semibold text-foreground leading-snug flex-1 min-w-[200px]">
          {title}
        </h3>
      </div>

      {/* Target URL — operator can click to inspect the page in
          context. New-tab so triage isn't disrupted. */}
      {resolvedUrl && (
        <p className="mt-1.5 text-[11px]">
          <span className="text-muted-foreground">Target:</span>{" "}
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline font-mono tabular-nums"
            data-recommendations-target-url="true"
          >
            {shortUrl(resolvedUrl)}
          </a>
        </p>
      )}

      {/* Recommended move — single sentence describing what Beacon
          wants the operator to do. Composed deterministically by
          `composeRecommendedMove` from action + topic + page name. */}
      <p
        className="mt-2 text-[12px] text-foreground leading-relaxed"
        data-recommendations-recommended-move="true"
      >
        <span className="text-muted-foreground font-medium">
          Recommended move:
        </span>{" "}
        {recommendedMove}
      </p>

      {/* Why now — strongest metric/evidence sentence. Derived from
          the resolver's reasoning, with diagnostic brackets + raw
          prompt-ids scrubbed before render. Empty when the resolver
          didn't emit reasoning. */}
      {whyNow.length > 0 && (
        <p
          className="mt-1 text-[12px] text-muted-foreground leading-relaxed"
          data-recommendations-why-now="true"
        >
          <span className="font-medium">Why now:</span> {whyNow}
        </p>
      )}

      {/* Evidence preview — single-sentence facts (Ritz cited X%;
          competitor winning; etc). `composeEvidencePreview` filters
          generic competitors so "General Contractors winning" never
          surfaces here. */}
      <p
        className="mt-1 text-[11px] text-muted-foreground/90 leading-relaxed"
        data-recommendations-evidence-preview="true"
      >
        <span className="font-medium">Evidence:</span> {evidencePreview}
      </p>

      {/* Effort chip — single compact fact alongside evidence. */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-surface-inset/30 text-muted-foreground"
          data-rec-effort-chip={rec.effort}
        >
          {effortLabel}
        </span>
      </div>

      {/* Inline feedback (success/error). */}
      {showFeedback && (
        <p
          className={cn(
            "mt-2 text-[11px]",
            feedback!.isError ? "text-status-danger" : "text-status-success",
          )}
        >
          {feedback!.message}
        </p>
      )}

      {/* Lane-aware action buttons. Each lane shows a different button
          surface (REC_LANE_BUTTONS contract). When the rec already
          carries a non-suppressed response (e.g., deferred-expired),
          the post-decision UI takes precedence over the lane buttons. */}
      <div
        className="mt-3 flex items-center gap-2 flex-wrap"
        data-rec-button-row={lane}
      >
        {dismissed ? (
          <>
            <span className="text-[11px] text-muted-foreground">Dismissed</span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => undoRecommendationResponse(rec.stableKey),
                  "Un-dismissed.",
                )
              }
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
            >
              Undo
            </button>
          </>
        ) : deferred && lane !== "tracking" ? (
          <>
            <span className="text-[11px] text-muted-foreground">
              Deferred until{" "}
              {response?.deferUntil
                ? new Date(response.deferUntil).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                : "later"}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => undoRecommendationResponse(rec.stableKey),
                  "Un-deferred.",
                )
              }
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
            >
              Undo
            </button>
          </>
        ) : lane === "tracking" ? (
          <>
            <span className="text-[11px] text-status-success font-medium">
              ✓ Tracking
            </span>
            {/* W2 Step 2.4 (2026-05-01) — operator-override Mark
                shipped. Only renders when at least one linked edit is
                still pre-verified; once every edit has reached
                verified_live the button vanishes (the rec is already
                done from the lifecycle's perspective). */}
            {eligibleEditCount > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  handle(
                    () =>
                      markRecommendationShipped({ stableKey: rec.stableKey }),
                    eligibleEditCount === 1
                      ? "Marked live — verdict clock started."
                      : `Marked ${eligibleEditCount} edits live — verdict clock started.`,
                  )
                }
                className="text-[11px] font-medium px-2 py-1 rounded border border-accent-primary/50 bg-accent-primary/[0.06] text-accent-primary hover:bg-accent-primary/[0.12] transition-colors disabled:opacity-50"
                title="Stamps live_at = now and live_match_kind = operator_override. Use when you've already shipped the change and want the verdict math to start before tomorrow's scan."
                data-rec-action-button="mark_shipped"
              >
                Mark {eligibleEditCount === 1 ? "" : `${eligibleEditCount} `}
                shipped
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => undoRecommendationResponse(rec.stableKey),
                  "Acceptance undone.",
                )
              }
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
              data-rec-action-button="undo"
            >
              Undo
            </button>
          </>
        ) : lane === "needs_decision" ? (
          <>
            <span className="text-[11px] text-status-warning font-medium">
              You decide the direction
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => deferRecommendation(rec.stableKey),
                  "Deferred 7 days.",
                )
              }
              className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
              data-rec-action-button="defer"
            >
              Defer
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => dismissRecommendation(rec.stableKey),
                  "Dismissed.",
                )
              }
              className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
              data-rec-action-button="dismiss"
            >
              Dismiss
            </button>
          </>
        ) : lane === "needs_fresh_edit" ? (
          <>
            <span className="text-[11px] text-muted-foreground">
              Regenerate when you're ready
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => dismissRecommendation(rec.stableKey),
                  "Dismissed.",
                )
              }
              className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
              data-rec-action-button="dismiss"
            >
              Dismiss
            </button>
          </>
        ) : lane === "backlog" ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => acceptRecommendation(payload),
                  editCount > 0
                    ? `Promoted — ${editCount} edit${editCount === 1 ? "" : "s"} tracked.`
                    : "Promoted — Beacon will watch for results.",
                )
              }
              className="text-[11px] font-medium px-2 py-1 rounded border border-accent-primary/50 bg-accent-primary/[0.05] text-accent-primary hover:bg-accent-primary/[0.1] transition-colors disabled:opacity-50"
              data-rec-action-button="promote"
            >
              Promote
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => deferRecommendation(rec.stableKey),
                  "Deferred 7 days.",
                )
              }
              className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
              data-rec-action-button="defer"
            >
              Defer
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => dismissRecommendation(rec.stableKey),
                  "Dismissed.",
                )
              }
              className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
              data-rec-action-button="dismiss"
            >
              Dismiss
            </button>
          </>
        ) : (
          // ready_to_ship — default lane.
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => acceptRecommendation(payload),
                  editCount > 0
                    ? `Accepted — ${editCount} edit${editCount === 1 ? "" : "s"} tracked.`
                    : "Accepted — Beacon will watch for results.",
                )
              }
              className="text-[11px] font-medium px-2 py-1 rounded border border-status-success/50 bg-status-success/[0.05] text-status-success hover:bg-status-success/[0.1] transition-colors disabled:opacity-50"
              data-rec-action-button="accept_and_track"
            >
              {editCount > 0
                ? `Accept + Track (${editCount} edit${editCount === 1 ? "" : "s"})`
                : "Accept + Track"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => deferRecommendation(rec.stableKey),
                  "Deferred 7 days.",
                )
              }
              className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
              data-rec-action-button="defer"
            >
              Defer
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                handle(
                  () => dismissRecommendation(rec.stableKey),
                  "Dismissed.",
                )
              }
              className="text-[11px] px-2 py-1 rounded border border-border/60 bg-background hover:bg-surface-inset/40 transition-colors disabled:opacity-50"
              data-rec-action-button="dismiss"
            >
              Dismiss
            </button>
          </>
        )}
      </div>

      {/* Expansion drawer — every diagnostic stays here. Operator
          scope (W3 §3.5d): default card never shows debug paragraphs;
          power users + diagnostics open this drawer for the resolver's
          full reasoning, motive, page brief, suggested edits, risks,
          cannibalization, and per-edit detail. */}
      {hasExpansionContent && (
        <details
          className="mt-2.5 rounded border border-border/40 bg-surface-inset/15 group"
          data-rec-expansion="true"
        >
          <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground select-none list-none flex items-center gap-1.5">
            <span className="group-open:hidden">▸ Show evidence + diagnostics</span>
            <span className="hidden group-open:inline">▾ Hide details</span>
          </summary>
          <div className="px-2.5 pb-2.5 pt-1 space-y-3 text-[11px]">
            {whyNowRaw.length > 0 && whyNowRaw !== whyNow && (
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                  Full reasoning
                </p>
                <p className="text-foreground/85 leading-relaxed">
                  {scrubRawPromptIds(whyNowRaw)}
                </p>
              </div>
            )}
            {confidenceReason && (
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                  Confidence reason
                </p>
                <p className="text-foreground/85 leading-relaxed">
                  {scrubRawPromptIds(confidenceReason)}
                </p>
              </div>
            )}
            {motiveLabel && (
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                  Why this matters
                </p>
                <p className="text-foreground/85 leading-relaxed">
                  {motiveLabel}
                </p>
              </div>
            )}
            {topCompetitor &&
              topCompetitor.totalAffectedPrompts > 0 &&
              (() => {
                const pct = Math.round(
                  (topCompetitor.promptsWherePrimary /
                    topCompetitor.totalAffectedPrompts) *
                    100,
                );
                return (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
                      Top competitor
                    </p>
                    <p className="text-foreground/85 leading-relaxed">
                      {topCompetitor.name} primary in {pct}% of affected
                      prompts
                    </p>
                  </div>
                );
              })()}
            {(specificRecommendation ||
              suggestedEdits.length > 0 ||
              pageBrief ||
              risks.length > 0 ||
              (cannibalization && cannibalization.length > 0)) && (
              <AdjudicatorDetails
                stableKey={rec.stableKey}
                specificRecommendation={specificRecommendation}
                suggestedEdits={suggestedEdits}
                pageBrief={pageBrief ?? null}
                risks={risks}
                cannibalization={cannibalization}
              />
            )}
            {editCount > 0 && (
              <SpecificEditsSection
                edits={edits}
                recommendationTargetUrl={resolution?.targetUrl ?? null}
                promptTextById={promptTextById}
              />
            )}
            {editCount === 0 && allEdits.length > 0 && (
              <div
                className="rounded border border-border/40 bg-surface-inset/30 px-2.5 py-1.5 text-foreground/80 leading-relaxed"
                data-recommendations-edits-empty="true"
              >
                {allEdits.length} specific edit
                {allEdits.length === 1 ? "" : "s"} on this rec — all dismissed
                or no longer actionable. Re-run the generator to produce fresh
                edits, or accept the rec to track the change at the rec level
                only.
              </div>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

/** Map the generator's candidate type to a default RecommendationAction
 *  for the UI when the resolver didn't produce a resolution. Defensive
 *  fallback — every v7-pipeline render should hit the resolver. */
function actionFromCandidateType(type: RecommendationType): RecommendationAction {
  switch (type) {
    case "create_cluster_page":
    case "create_single":
    case "target_competitors":
      return "create_new_page";
    case "strengthen_page_copy":
      return "strengthen_existing_page";
    case "watch_winning_cluster":
      return "watch";
  }
}

/* ─────────────────────────────────────────────────────────────────── */

const EDIT_TYPE_LABEL: Record<SuggestedEdit["type"], string> = {
  new_page: "New page",
  section: "Section",
  faq: "FAQ",
  heading: "Heading",
  meta_description: "Meta description",
  schema_markup: "Schema",
  internal_link: "Internal link",
};

function AdjudicatorDetails({
  stableKey,
  specificRecommendation,
  suggestedEdits,
  pageBrief,
  risks,
  cannibalization,
}: {
  stableKey: string;
  specificRecommendation: string | null;
  suggestedEdits: SuggestedEdit[];
  pageBrief: PageIntentResolution["pageBrief"];
  risks: string[];
  cannibalization: string[] | null;
}) {
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
        <span className="group-open:hidden">Show brief + suggested edits</span>
        <span className="hidden group-open:inline">Hide details</span>
      </summary>
      <div className="mt-2 space-y-3 text-[12px] leading-relaxed">
        {specificRecommendation && (
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
              Do this
            </p>
            <p className="text-foreground">{specificRecommendation}</p>
          </div>
        )}
        {pageBrief && (
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
              Page brief
            </p>
            <ul className="space-y-0.5 text-foreground/90">
              <li>
                <span className="text-muted-foreground">Title:</span>{" "}
                {pageBrief.recommendedTitle}
              </li>
              <li>
                <span className="text-muted-foreground">H1:</span>{" "}
                {pageBrief.recommendedH1}
              </li>
              {pageBrief.mustCoverAngles.length > 0 && (
                <li>
                  <span className="text-muted-foreground">
                    Must cover:
                  </span>{" "}
                  {pageBrief.mustCoverAngles.join(" · ")}
                </li>
              )}
              {pageBrief.competitorAnglesToCounter.length > 0 && (
                <li>
                  <span className="text-muted-foreground">
                    Counter competitors:
                  </span>{" "}
                  {pageBrief.competitorAnglesToCounter.join(" · ")}
                </li>
              )}
              {pageBrief.internalLinksToAdd.length > 0 && (
                <li>
                  <span className="text-muted-foreground">
                    Link internally:
                  </span>{" "}
                  {pageBrief.internalLinksToAdd.join(" · ")}
                </li>
              )}
            </ul>
          </div>
        )}
        {suggestedEdits.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
              Suggested edits
            </p>
            <ul className="space-y-1.5">
              {suggestedEdits.map((edit, i) => (
                <li
                  key={`${stableKey}-edit-${i}`}
                  className="border-l-2 border-border/60 pl-2"
                >
                  <p className="text-foreground/90">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mr-1.5">
                      {EDIT_TYPE_LABEL[edit.type]}
                    </span>
                    {edit.title && (
                      <span className="font-medium">{edit.title}</span>
                    )}
                  </p>
                  {edit.body && (
                    <p className="text-foreground/80 mt-0.5">{edit.body}</p>
                  )}
                  <p className="text-muted-foreground text-[11px] mt-0.5">
                    {edit.why}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {risks.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-status-warning mb-0.5">
              Risks
            </p>
            <ul className="list-disc pl-4 text-status-warning/90">
              {risks.map((r, i) => (
                <li key={`${stableKey}-risk-${i}`}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {cannibalization && cannibalization.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-status-warning mb-0.5">
              Merge with
            </p>
            <ul className="list-disc pl-4 font-mono text-[11px] tabular-nums text-foreground/80">
              {cannibalization.map((u, i) => (
                <li key={`${stableKey}-merge-${i}`}>
                  <a
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-primary hover:underline"
                  >
                    {shortUrl(u)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

/* W3 Step 3.5d (2026-05-02) — `EvidenceChips` removed.
 *
 * The 3.5c chip strip ("Tracking" / "Needs fresh edit" / "{Competitor}
 * winning · {pct}%" / "Quick win") collapsed three concerns into one
 * row:
 *   1. lane / display state (now the lane badge in the card header)
 *   2. competitor evidence (now inside `composeEvidencePreview` and
 *      surfaced in the expansion drawer's "Top competitor" block)
 *   3. effort (kept as a single chip in the default card body)
 *
 * The lane-aware card directly renders each concern in the right
 * place, so a shared chip component is no longer needed. */

/* ─────────────────────────────────────────────────────────────────── */

function WatchSection({ rows }: { rows: RecommendationWatchRow[] }) {
  return (
    <section className="mt-10 rounded-lg border border-border/40 bg-surface-inset/20 px-5 py-4">
      <header className="mb-2">
        <h2 className="text-[13px] font-bold tracking-tight text-muted-foreground uppercase">
          Watchlist · {rows.length}
        </h2>
      </header>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Winning clusters worth defending. Passive — no action required unless
        the signal drops.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.rec.stableKey}
            className="rounded-md border border-border/40 bg-background px-3 py-2"
          >
            <p className="text-[13px] font-medium text-foreground">
              {row.rec.title}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {row.rec.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function EmptyQueue() {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-inset/20 px-6 py-8 text-center">
      <p className="text-[13px] font-medium text-foreground">
        No recommendations today.
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        The queue regenerates nightly from the latest prompt observations.
        Come back tomorrow, or check{" "}
        <Link
          href="/prompts"
          className="underline underline-offset-2 hover:text-foreground"
        >
          /prompts
        </Link>{" "}
        for raw decision signals.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Sprint 6A.1 Phase 12 — typed edits surfacing                         */
/* ─────────────────────────────────────────────────────────────────── */

const ACTION_TYPE_BADGE: Record<string, string> = {
  edit_title: "Title",
  edit_meta: "Meta",
  change_h1: "H1",
  add_h2_section: "H2 (new)",
  rewrite_h2: "H2",
  add_faq: "FAQ (new)",
  rewrite_faq: "FAQ",
  add_table: "Table",
  edit_table_row: "Table row",
  add_internal_link: "Internal link",
  add_schema: "Schema",
  fix_schema: "Schema fix",
  add_answer_block: "Answer block",
  add_proof_section: "Proof",
  add_comparison_section: "Comparison",
  add_cost_section: "Cost",
  add_timeline_section: "Timeline",
  reorder_sections: "Reorder",
  split_page: "Split page",
  merge_pages: "Merge pages",
  create_page: "Create page",
  watch: "Watch",
};

// W3 Step 3.5 (2026-05-02) — humanize an action_type token when the
// registry adds a new action ahead of the badge map. Falls through to
// `Add H2 Section` style instead of leaking `add_h2_section` to the
// operator. Pure, defensive — the curated map above stays the
// preferred path for tone control.
function humanizeActionType(actionType: string): string {
  const mapped = ACTION_TYPE_BADGE[actionType];
  if (mapped) return mapped;
  return actionType
    .split("_")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// W3 Step 3.5 (2026-05-02) — operator-facing edit-source labels.
// Replaces raw enum tokens ("openai" / "deterministic") in the
// edit row's source badge with concise operator language.
const EDIT_SOURCE_LABEL: Record<string, string> = {
  deterministic: "Deterministic",
  openai: "AI-generated",
  anthropic: "AI-generated",
  operator_edited: "Operator-edited",
};

// W3 Step 3.5 (2026-05-02) — humanize per-edit confidence enum so it
// reads as natural copy, not a raw token. Per-edit `confidence` is a
// diagnostic signal; the rec-level `RecConfidencePill` is the trust
// label operators consume. Both stay aligned: HIGH = strong, MEDIUM
// = review-worthy, LOW = weak signal.
const EDIT_CONFIDENCE_LABEL: Record<string, string> = {
  high: "Strong",
  medium: "Review",
  low: "Weak signal",
};

// W3 Step 3.5b.C (2026-05-02) — humanize per-edit difficulty enum.
// Operator audit caught "low" rendering raw alongside other badges
// ("AI-generated · Review · low"). Internal enum stays low/medium/
// high; visible badge says "Easy" / "Medium" / "Hard".
const EDIT_DIFFICULTY_LABEL: Record<string, string> = {
  low: "Easy",
  medium: "Medium",
  high: "Hard",
};

// Sprint 6A.2g.F (2026-04-26) — source badge color map. Different
// hue per provider source so the operator can scan a long edit list
// and tell at a glance which rows came from the LLM, the legacy
// deterministic generator, or operator-touched provenance.
const SOURCE_BADGE_CLASS: Record<string, string> = {
  deterministic: "border-border/60 text-muted-foreground",
  openai: "border-accent-secondary/40 text-accent-secondary",
  anthropic: "border-accent-secondary/40 text-accent-secondary",
  operator_edited: "border-status-info/40 text-status-info",
};

// Sprint 6A.2g.F (2026-04-26) — turn a recommended_edits.target_url
// into a clickable link to the live site. Absolute URLs stay
// absolute; relative URLs (the common shape after Phase A's strict-
// anchor contract — e.g. "/services/whole-home-remodel") are
// resolved against the operator's domain so the operator can
// one-click open the page they're about to edit.
function resolveEditTargetHref(targetUrl: string): string {
  if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
    return targetUrl;
  }
  const path = targetUrl.startsWith("/") ? targetUrl : `/${targetUrl}`;
  return `https://ritzbuilders.com${path}`;
}

function SpecificEditsSection({
  edits,
  recommendationTargetUrl,
  promptTextById,
}: {
  edits: RecommendedEditRow[];
  recommendationTargetUrl: string | null;
  promptTextById: Record<string, string>;
}) {
  if (edits.length === 0) return null;
  const count = edits.length;
  return (
    <details className="mt-2 rounded border border-accent-primary/30 bg-accent-primary/[0.04] px-2.5 py-1.5">
      <summary className="cursor-pointer text-[11px] font-medium text-accent-primary list-none flex items-center gap-1.5">
        <span>Specific edits ({count})</span>
        <span className="text-muted-foreground/60 font-normal">— click to expand</span>
      </summary>
      <ul className="mt-2 space-y-2.5">
        {edits.map((edit) => {
          // Sprint 6A.2g.F — different-target warning fires when:
          //   (1) the rec has a resolved targetUrl,
          //   (2) the edit has a non-empty target_url,
          //   (3) the two differ,
          //   (4) the edit isn't anchored to the needs_new_page sentinel
          //       (which is a legitimate page-level outcome, not a drift).
          const showDifferentTargetWarning =
            recommendationTargetUrl !== null &&
            typeof edit.target_url === "string" &&
            edit.target_url.length > 0 &&
            edit.target_url !== recommendationTargetUrl &&
            edit.target_url !== NEEDS_NEW_PAGE;
          const sourceClass =
            SOURCE_BADGE_CLASS[edit.source] ??
            "border-border/60 text-muted-foreground";
          return (
            <li
              key={edit.id}
              className="rounded border border-border/40 bg-background px-2.5 py-2 text-[11px]"
            >
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary">
                  {humanizeActionType(edit.action_type)}
                </span>
                <span className="font-medium text-foreground/90">
                  {edit.display_label ?? humanizeActionType(edit.action_type)}
                </span>
                {/* Phase 6A.3 (2026-04-28) — per-edit lifecycle pill.
                    Surfaces verified_live / accepted / dismissed / etc.
                    so operator sees the engine's view of this edit's
                    journey at a glance. Compact mode keeps the row
                    horizontal density. */}
                <LifecycleStatusPill
                  status={edit.implementation_status}
                  compact
                />
                {/* Phase 6B.1 (2026-04-28) — needs-rewrite badge mirrors
                    the /today implementation queue + Do-Next card. The
                    deterministic FAQ generator emits a placeholder answer
                    ("Draft answer (operator: rewrite)…") that the
                    operator must replace before shipping. Surfacing the
                    badge here means an operator working from
                    /recommendations sees the warning before clicking
                    Accept's downstream actions. */}
                {edit.proposed_text?.includes(
                  "Draft answer (operator: rewrite)",
                ) && (
                  <span
                    className="inline-flex items-center rounded border border-status-warning/40 bg-status-warning/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-status-warning"
                    title="The proposed text is a generator placeholder — rewrite it before shipping."
                    data-recommendations-needs-rewrite="true"
                  >
                    needs rewrite
                  </span>
                )}
                {/* Sprint 6A.2g.F — source provenance badge.
                    W3 Step 3.5 (2026-05-02) — render humanized label
                    (e.g., "AI-generated") instead of the raw enum
                    token "openai". Internal value still passes
                    through `data-source` for tests + diagnostics. */}
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border",
                    sourceClass,
                  )}
                  title={`Source: ${edit.source}${edit.model ? ` · ${edit.model}` : ""}`}
                  data-source={edit.source}
                >
                  {EDIT_SOURCE_LABEL[edit.source] ?? edit.source}
                </span>
                {/* W3 Step 3.5 (2026-05-02) — humanized per-edit
                    confidence label so the row never shows raw
                    "low" / "medium" / "high" tokens to operators. */}
                <span
                  className={cn(
                    "ml-auto text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border",
                    edit.confidence === "high"
                      ? "border-status-success/40 text-status-success"
                      : edit.confidence === "low"
                        ? "border-status-warning/40 text-status-warning"
                        : "border-border/60 text-muted-foreground",
                  )}
                  title={`Per-edit confidence: ${edit.confidence}`}
                  data-edit-confidence={edit.confidence}
                >
                  {EDIT_CONFIDENCE_LABEL[edit.confidence] ?? edit.confidence}
                </span>
                {/* W3 Step 3.5b.C (2026-05-02) — humanized difficulty
                    badge so the row never shows raw "low" / "medium" /
                    "high" tokens. Internal enum still passes through
                    `data-edit-difficulty` for tests + diagnostics. */}
                <span
                  className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground"
                  title={`Per-edit difficulty: ${edit.difficulty}`}
                  data-edit-difficulty={edit.difficulty}
                >
                  {EDIT_DIFFICULTY_LABEL[edit.difficulty] ?? edit.difficulty}
                </span>
              </div>
              {/* Sprint 6A.2g.F — target URL link + different-page warning. */}
              {edit.target_url && (
                <div className="mt-1 text-[10px] text-muted-foreground/80 leading-relaxed flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-foreground/70">Target:</span>
                  {edit.target_url === NEEDS_NEW_PAGE ? (
                    <span className="font-mono tabular-nums">
                      {NEEDS_NEW_PAGE}
                    </span>
                  ) : (
                    <a
                      href={resolveEditTargetHref(edit.target_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono tabular-nums underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      {shortUrl(resolveEditTargetHref(edit.target_url))}
                    </a>
                  )}
                  {showDifferentTargetWarning && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-status-warning/40 text-status-warning">
                      ⚠ Different page than rec target
                    </span>
                  )}
                </div>
              )}
              {(edit.current_text || edit.proposed_text) && (
                <div className="mt-1.5 space-y-1">
                  {edit.current_text && (
                    <p className="text-muted-foreground line-through font-mono tabular-nums break-words">
                      {edit.current_text}
                    </p>
                  )}
                  {edit.proposed_text && (
                    <p className="text-foreground font-mono tabular-nums whitespace-pre-wrap break-words">
                      {edit.proposed_text}
                    </p>
                  )}
                </div>
              )}
              <p className="mt-1.5 text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground/80">Why: </span>
                {/* W3 Step 3.5c (2026-05-02) — scrub raw prompt-id
                    refs from per-edit why copy. Operator audit caught
                    "prompt 319557d1" leaking into this surface. */}
                {scrubRawPromptIds(edit.why)}
              </p>
              {edit.evidence && edit.evidence.length > 0 && (() => {
                const summary = summarizeEvidenceRefs(
                  edit.evidence,
                  promptTextById,
                );
                if (!summary) return null;
                return (
                  <p className="mt-1 text-[10px] text-muted-foreground/80 leading-relaxed">
                    Evidence: {summary}
                  </p>
                );
              })()}
              {/* Sprint 6A.2g.F — operator-facing context blocks. Only
                  rendered when the underlying field is populated, so
                  edit cards stay compact when the provider didn't
                  supply impact / measurement / risks. */}
              {edit.expected_impact && (
                <p className="mt-1 text-[10px] text-muted-foreground/80 leading-relaxed">
                  <span className="font-medium text-foreground/70">
                    Expected impact:{" "}
                  </span>
                  {edit.expected_impact}
                </p>
              )}
              {edit.measurement_plan && (
                <p className="mt-1 text-[10px] text-muted-foreground/80 leading-relaxed">
                  <span className="font-medium text-foreground/70">
                    Measurement:{" "}
                  </span>
                  {edit.measurement_plan}
                </p>
              )}
              {edit.risks && edit.risks.length > 0 && (
                <ul className="mt-1 text-[10px] text-status-warning/90 leading-relaxed list-disc ml-4 space-y-0.5">
                  {edit.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
