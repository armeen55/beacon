"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  acceptRecommendation,
  deferRecommendation,
  dismissRecommendation,
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

type Props = {
  queue: RecommendationQueueRow[];
  watchlist: RecommendationWatchRow[];
  matrixDate: string;
};

export function RecommendationsClient({ queue, watchlist, matrixDate }: Props) {
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
}) {
  const { rec, response } = row;
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
          ? "border-status-success/40"
          : dismissed
            ? "border-border/30 opacity-60"
            : deferred
              ? "border-border/50 opacity-80"
              : "border-border/50",
      )}
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
                  "Accepted — Beacon will watch for results.",
                )
              }
              className="text-[11px] font-medium px-2 py-1 rounded border border-status-success/50 bg-status-success/[0.05] text-status-success hover:bg-status-success/[0.1] transition-colors disabled:opacity-50"
            >
              Accept
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
