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
import type { PrioritizedRecommendationTier } from "@/domains/recommendations/prioritize";
import type {
  PageIntentResolution,
  RecommendationAction,
  RecommendationMotive,
  ResolverTier,
} from "@/domains/recommendations/resolved-types";
import { NEEDS_NEW_PAGE } from "@/domains/recommendations/resolved-types";
import { buildResolvedRecommendationTitle } from "@/domains/recommendations/build-title";
import type { SuggestedEdit } from "@/domains/recommendations/adjudicator-schema";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { LifecycleStatusPill } from "@/components/display/lifecycle-status-pill";
import { RecConfidencePill } from "@/components/display/rec-confidence-pill";
import { summarizeEvidenceRefs } from "@/domains/recommendations/evidence-summary";

type Props = {
  queue: RecommendationQueueRow[];
  watchlist: RecommendationWatchRow[];
  matrixDate: string;
  /** Step 1.1 (master plan) — lookup so evidence chips render a prompt
   *  text snippet instead of leaking the raw UUID into operator copy. */
  promptTextById: Record<string, string>;
};

export function RecommendationsClient({
  queue,
  watchlist,
  matrixDate,
  promptTextById,
}: Props) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [feedback, setFeedback] = useState<{
    stableKey: string;
    message: string;
    isError: boolean;
  } | null>(null);

  // Hide dismissed + currently-deferred items by default. Operator can
  // toggle the "show all" switch to review past decisions.
  const visibleQueue = showDismissed
    ? queue
    : queue.filter(
        (r) =>
          !r.response ||
          r.response.status === "accepted" ||
          (r.response.status === "deferred" &&
            r.response.deferUntil &&
            new Date(r.response.deferUntil).getTime() <= Date.now()),
      );

  const groups: Array<{
    tier: PrioritizedRecommendationTier;
    label: string;
    rows: RecommendationQueueRow[];
  }> = [
    {
      tier: "now",
      label: "Now",
      rows: visibleQueue.filter((r) => r.rec.tier === "now"),
    },
    {
      tier: "this_week",
      label: "This week",
      rows: visibleQueue.filter((r) => r.rec.tier === "this_week"),
    },
    {
      tier: "later",
      label: "Later",
      rows: visibleQueue.filter((r) => r.rec.tier === "later"),
    },
  ];

  const hiddenCount = queue.length - visibleQueue.length;

  return (
    <>
      <div className="mb-5 flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-muted-foreground">
          Regenerated {matrixDate}. Queue is ranked; watchlist is passive.
        </p>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowDismissed((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {showDismissed
              ? `Hide dismissed / deferred (${hiddenCount})`
              : `Show all (${hiddenCount} hidden)`}
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div className="space-y-6">
          {groups
            .filter((g) => g.rows.length > 0)
            .map((group) => (
              <QueueSection
                key={group.tier}
                tier={group.tier}
                label={group.label}
                rows={group.rows}
                feedback={feedback}
                setFeedback={setFeedback}
                promptTextById={promptTextById}
              />
            ))}
        </div>
      )}

      {watchlist.length > 0 && (
        <WatchSection rows={watchlist} />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

const TIER_META: Record<
  PrioritizedRecommendationTier,
  { accent: string; bg: string; dot: string; lead: string }
> = {
  now: {
    accent: "text-status-danger",
    bg: "border-status-danger/30 bg-status-danger/[0.03]",
    dot: "bg-status-danger",
    lead: "Top-priority work. Accept one a day and Beacon will start watching whether it moved the needle.",
  },
  this_week: {
    accent: "text-status-warning",
    bg: "border-status-warning/30 bg-status-warning/[0.03]",
    dot: "bg-status-warning",
    lead: "Next wave. Defer to push a row out a week; dismiss if it isn't for you.",
  },
  later: {
    accent: "text-muted-foreground",
    bg: "border-border/50 bg-surface-inset/20",
    dot: "bg-muted-foreground/60",
    lead: "Backlog. Lower signal or higher effort — revisit if top-priority work thins out.",
  },
};

function QueueSection({
  tier,
  label,
  rows,
  feedback,
  setFeedback,
  promptTextById,
}: {
  tier: PrioritizedRecommendationTier;
  label: string;
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
  const meta = TIER_META[tier];
  return (
    <section
      className={cn("rounded-lg border px-5 py-4", meta.bg)}
      aria-labelledby={`rec-tier-${tier}-heading`}
    >
      <header className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
          <h2
            id={`rec-tier-${tier}-heading`}
            className={cn(
              "text-[13px] font-bold tracking-tight",
              meta.accent,
            )}
          >
            {label.toUpperCase()} · {rows.length}
          </h2>
        </div>
      </header>
      <p className="mb-3 text-[11px] text-muted-foreground leading-relaxed">
        {meta.lead}
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <RecommendationRow
            key={row.rec.stableKey}
            row={row}
            feedback={feedback}
            setFeedback={setFeedback}
            promptTextById={promptTextById}
          />
        ))}
      </ul>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

const REC_TYPE_LABEL: Record<RecommendationType, string> = {
  create_cluster_page: "Create page",
  create_single: "Create page",
  target_competitors: "Target",
  strengthen_page_copy: "Strengthen",
  watch_winning_cluster: "Watch",
};

const ACTION_LABEL: Record<RecommendationAction, string> = {
  strengthen_existing_page: "Strengthen",
  expand_existing_page: "Expand",
  add_section_or_faq: "Add section",
  create_new_page: "Create page",
  merge_or_dedupe: "Merge",
  split_or_separate_page: "Split",
  needs_review: "Review",
  watch: "Watch",
};

const MOTIVE_LABEL: Record<RecommendationMotive, string> = {
  counter_competitor: "Counter competitor",
  capture_absent_cluster: "Capture absent cluster",
  improve_close_prompt: "Close the gap",
  defend_winning_cluster: "Defend winning cluster",
  resolve_cannibalization: "Resolve cannibalization",
  improve_citation_depth: "Improve citation depth",
};

const TIER_BADGE: Record<ResolverTier, { label: string | null; className: string } | null> = {
  observation: null,
  inventory: {
    label: "Site match",
    className: "border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary",
  },
  adjudicated: {
    label: "AI-reviewed",
    className: "border-status-success/40 bg-status-success/[0.06] text-status-success",
  },
  deterministic_only: null,
};

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
  feedback,
  setFeedback,
  promptTextById,
}: {
  row: RecommendationQueueRow;
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
  const actionLabel = ACTION_LABEL[action];
  const motive = resolution?.motive ?? null;
  const motiveLabel = motive ? MOTIVE_LABEL[motive] : null;
  const tierBadge = resolution ? TIER_BADGE[resolution.tier] : null;
  const resolvedUrl =
    resolution && resolution.targetUrl !== NEEDS_NEW_PAGE
      ? resolution.targetUrl
      : null;
  // Phase 1 (2026-04-24): title ALWAYS goes through the shared builder.
  // Never fall back to rec.title — the raw generator title carries
  // Shield:/Internal: prefixes and contradicts Strengthen/Expand/Merge
  // badges when the resolver flipped the action.
  const title = buildResolvedRecommendationTitle({
    clusterLabel: rec.clusterLabel,
    promptTextFallback: rec.title,
    resolution,
  });
  const reasoning = resolution?.reasoning ?? rec.reasoning;
  const specificRecommendation = resolution?.specificRecommendation ?? null;
  const confidenceReason = resolution?.confidenceReason ?? null;
  const suggestedEdits = resolution?.suggestedEdits ?? [];
  const pageBrief = resolution?.pageBrief ?? null;
  const risks = resolution?.risks ?? [];
  const cannibalization = resolution?.cannibalization ?? null;
  const needsHumanReview = resolution?.needsHumanReview ?? false;

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

  return (
    <li
      id={`rec-${encodeURIComponent(rec.stableKey)}`}
      className={cn(
        "rounded-md border bg-background px-3 py-2.5",
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
      title={
        isStalePending
          ? `Accepted ${acceptedAgeDays} day${acceptedAgeDays === 1 ? "" : "s"} ago — still tracking. Click "Mark shipped" if it's already live.`
          : undefined
      }
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border",
            "border-border/60 bg-surface-inset/40 text-muted-foreground",
          )}
        >
          {actionLabel}
        </span>
        {/* W3 Step 3.5 (2026-05-02) — engine confidence pill.
            Operator-facing label maps high/medium/low → Strong /
            Review / Weak signal. The label NEVER implies auto-apply
            (W3 §1.5 + Step 3.3 rubric). Internal enum stays
            high/medium/low; only the visible text differs. */}
        <RecConfidencePill verdict={rec.engineConfidence} />
        {tierBadge && tierBadge.label && (
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border",
              tierBadge.className,
            )}
            title={
              resolution?.tier === "adjudicated"
                ? "Reviewed by GPT-5-mini adjudicator"
                : "Matched against site inventory"
            }
          >
            {tierBadge.label}
          </span>
        )}
        {needsHumanReview && (
          <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-status-warning/40 bg-status-warning/[0.06] text-status-warning">
            Needs review
          </span>
        )}
        <h3 className="text-[13px] font-medium text-foreground leading-snug flex-1">
          {title}
        </h3>
      </div>

      {resolvedUrl && (
        <p className="mt-1 text-[11px]">
          <span className="text-muted-foreground">→</span>{" "}
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline font-mono tabular-nums"
          >
            {shortUrl(resolvedUrl)}
          </a>
        </p>
      )}

      <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
        {reasoning}
      </p>

      {confidenceReason && (
        <p className="mt-0.5 text-[11px] text-muted-foreground/80 leading-relaxed">
          {confidenceReason}
        </p>
      )}

      {motiveLabel && (
        <p className="mt-1 text-[11px]">
          <span className="text-muted-foreground">Motive:</span>{" "}
          <span className="font-medium text-foreground/90">{motiveLabel}</span>
        </p>
      )}

      <EvidenceChips rec={rec} />

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
          // Sprint 6A.2g.F (2026-04-26) — pass the rec's resolved
          // target URL so each edit can render a "Different page than
          // rec target" warning when the LLM (or operator_edited row)
          // anchored to a different URL. Phase A locked the strict-
          // anchor contract for fresh OpenAI bundles; this surfaces
          // any pre-Phase-A edits or future drift directly in the UI.
          recommendationTargetUrl={resolution?.targetUrl ?? null}
          promptTextById={promptTextById}
        />
      )}
      {/* W3 Step 3.5 (2026-05-02) — empty-state when ALL edits were
          filtered out (e.g., the W3 Step 3.1b quarantine left the
          rec with N edits in `allEdits` but zero renderable). Tells
          the operator the rec has history but no actionable edits
          right now, instead of just dropping the section silently. */}
      {editCount === 0 && allEdits.length > 0 && (
        <div
          className="mt-2 rounded border border-border/40 bg-surface-inset/30 px-2.5 py-1.5 text-[11px] text-muted-foreground leading-relaxed"
          data-recommendations-edits-empty="true"
        >
          {allEdits.length} specific edit{allEdits.length === 1 ? "" : "s"}{" "}
          on this rec — all dismissed or no longer actionable. Re-run the
          generator to produce fresh edits, or accept the rec to track
          the change at the rec level only.
        </div>
      )}

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

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {accepted ? (
          <>
            <span className="text-[11px] text-status-success font-medium">
              ✓ Accepted
            </span>
            {isStalePending && (
              <span
                className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-status-warning/40 bg-status-warning/[0.08] text-status-warning"
                title={`Accepted ${acceptedAgeDays} day${acceptedAgeDays === 1 ? "" : "s"} ago — scan hasn't confirmed it on the page yet.`}
              >
                {acceptedAgeDays}d pending
              </span>
            )}
            {/* W2 Step 2.4 (2026-05-01) — operator-override Mark shipped.
                Only renders when at least one linked edit is still
                pre-verified; once every edit has reached verified_live
                the button vanishes (the rec is already done from the
                lifecycle's perspective). */}
            {eligibleEditCount > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  handle(
                    () => markRecommendationShipped({ stableKey: rec.stableKey }),
                    eligibleEditCount === 1
                      ? "Marked live — verdict clock started."
                      : `Marked ${eligibleEditCount} edits live — verdict clock started.`,
                  )
                }
                className="text-[11px] font-medium px-2 py-1 rounded border border-accent-primary/50 bg-accent-primary/[0.06] text-accent-primary hover:bg-accent-primary/[0.12] transition-colors disabled:opacity-50"
                title="Stamps live_at = now and live_match_kind = operator_override. Use when you've already shipped the change and want the verdict math to start before tomorrow's scan."
              >
                Mark {eligibleEditCount === 1 ? "" : `${eligibleEditCount} `}shipped
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
            >
              Undo
            </button>
          </>
        ) : dismissed ? (
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
        ) : deferred ? (
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
        ) : (
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
            >
              {editCount > 0
                ? `Accept — track ${editCount} edit${editCount === 1 ? "" : "s"}`
                : "Accept"}
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
            >
              Dismiss
            </button>
          </>
        )}
      </div>
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

function EvidenceChips({
  rec,
}: {
  rec: RecommendationQueueRow["rec"];
}) {
  const chips: Array<{ label: string; tone?: "bad" | "neutral" }> = [];

  if (rec.evidence.promptCount > 1) {
    chips.push({
      label: `${rec.evidence.promptCount} prompts`,
      tone: "neutral",
    });
  }

  const topCompetitor = rec.evidence.primaryCompetitors[0];
  if (topCompetitor && topCompetitor.totalAffectedPrompts > 0) {
    const pct = Math.round(
      (topCompetitor.promptsWherePrimary / topCompetitor.totalAffectedPrompts) *
        100,
    );
    if (pct >= 50) {
      chips.push({
        label: `${topCompetitor.name} primary · ${pct}%`,
        tone: "bad",
      });
    }
  }

  if (rec.evidence.fragmentedPromptCount > 0 && !topCompetitor) {
    chips.push({
      label: `${rec.evidence.fragmentedPromptCount} fragmented`,
      tone: "neutral",
    });
  }

  chips.push({ label: `${rec.effort} effort`, tone: "neutral" });

  if (chips.length === 0) return null;

  return (
    <ul className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((c) => (
        <li
          key={c.label}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border",
            c.tone === "bad"
              ? "border-status-danger/30 bg-status-danger/[0.05] text-status-danger"
              : "border-border/50 bg-surface-inset/30 text-muted-foreground",
          )}
        >
          {c.label}
        </li>
      ))}
    </ul>
  );
}

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
                <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground">
                  {edit.difficulty}
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
                {edit.why}
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
