"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { REC_CONFIDENCE_LABEL, EVIDENCE_BASIS_LABEL } from "@/lib/confidence-labels";

// Phase 2 (2026-04-20): per-tier pill styling. Neutral by default; measured
// signals lean success-tone, cross-site pattern accent. No alarming colors —
// the pill is an honesty label, not a severity indicator.
const EVIDENCE_BASIS_PILL: Record<string, string> = {
  heuristic: "bg-surface-inset/50 text-muted-foreground/70",
  current_dataset: "bg-accent-primary/10 text-accent-primary",
  tenant_history: "bg-status-success/10 text-status-success",
  shared_pattern: "bg-foreground/10 text-foreground",
};

/**
 * T2 (operator audit, 2026-05-05) — translate internal `expectedMetric`
 * snake_case keys to operator-readable copy. Returns null when the value
 * looks like a raw identifier we don't have a mapping for; the caller
 * drops the chip entirely rather than leaking "citations_per_day" /
 * "primary_rate" / "mention_rate" to the customer-facing card.
 *
 * Pure / deterministic. Empty / non-string input returns null.
 */
function friendlyExpectedMetric(metric: string | null | undefined): string | null {
  if (typeof metric !== "string") return null;
  const trimmed = metric.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();
  // Known internal metric keys → operator copy.
  const map: Record<string, string> = {
    citations_per_day: "Expected: more AI citations",
    citations: "Expected: more AI citations",
    primary_rate: "Expected: higher primary-recommendation rate",
    mention_rate: "Expected: more brand mentions",
    cited_pages: "Expected: more pages cited",
  };
  if (map[lower]) return map[lower];
  // Anything that still looks like a raw snake_case / lower-case-with-
  // underscores identifier is filtered. Operator-friendly free-text
  // metrics (with spaces, capital letters, or descriptive phrases like
  // "+5 citations / week") pass through unchanged.
  const looksRawIdentifier = /^[a-z][a-z0-9_]*$/.test(trimmed) && trimmed.includes("_");
  if (looksRawIdentifier) return null;
  return trimmed;
}

export type ActionCardAction = {
  id: string;
  headline: string;
  rationale: string;
  expectedOutcome: string;
  sourceEvidence: string;
  priorityScore: number;
  bucket: "critical" | "high_leverage" | "opportunistic";
  type: string;
  confidence: "high" | "medium" | "low";
  href: string;
  responseStatus?: "accepted" | "dismissed" | "deferred" | null;
  confidenceReason?: string;
  watchAfter?: string;
  dataFreshness?: string | null;
  hasExperiment?: boolean;
  targetPageUrl?: string | null;
  targetPagePath?: string | null;
  baselineCitations?: number | null;
  sourceChangeId?: string | null;
  /** Fix 2 (2026-04-21) — carried through to the accept-response handler so
   *  the recommendation-response-store can auto-link a later-detected change
   *  on the same URL back to this acceptance. Optional: not every rec has a
   *  pattern. */
  patternId?: string | null;
  lineageBullets?: string[];
  answerContext?: string | null;
  specificMove?: string | null;
  actionClass?: string | null;
  targetSection?: string | null;
  priorSuccess?: { changeId: string; pagePath: string; description: string; citationDelta: number } | null;
  engineTiming?: { platform: string; medianDays: number; sampleCount: number }[] | null;
  expectedMetric?: string | null;
  /** Phase 2 (2026-04-20): strongest honest evidence basis for this card.
   *  One of "heuristic" | "tenant_history" | "current_dataset" | "shared_pattern". */
  evidenceBasis?: "heuristic" | "tenant_history" | "current_dataset" | "shared_pattern";
  /** Phase 3-post (2026-04-20): page-job-fit router verdict for keyword
   *  positioning recs. Drives card label overrides and badge rendering.
   *  Defaults to "keep" when absent. */
  placementMode?: "keep" | "move" | "new_page";
  /** When placementMode === "move", the path the rec was originally written
   *  against before the router swapped the target. */
  movedFromPath?: string | null;
};

export type ActionCardProps = {
  action: ActionCardAction;
  variant: "primary" | "secondary";
  onRespondToRec?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred",
    context?: { targetPageUrl?: string | null; patternId?: string | null },
  ) => Promise<{ success: boolean }>;
  onStartExperiment?: (opts: {
    recId: string;
    headline: string;
    recType: string;
    targetPageUrl: string | null;
    targetPagePath: string | null;
    watchAfter: string;
    operatorNote: string;
    baselineCitations: number | null;
  }) => Promise<{ success: boolean; experimentId: string }>;
  pending: boolean;
  startTransition: (fn: () => void | Promise<void>) => void;
  actionMsg: string | null;
  setActionMsg: (s: string | null) => void;
  dimmed?: boolean;
};

// Labels rewritten 2026-04-17 (Day 4 jargon sweep):
//   Critical → Fix now | High leverage → Biggest win | Opportunistic → Worth trying
// Internal bucket keys stay the same so nothing downstream breaks.
const BUCKET_STYLE: Record<string, { dot: string; label: string; border: string; bg: string }> = {
  critical: { dot: "bg-status-danger", label: "Fix now", border: "border-status-danger/40", bg: "bg-status-danger/[0.03]" },
  high_leverage: { dot: "bg-status-success", label: "Biggest win", border: "border-status-success/30", bg: "bg-status-success/[0.02]" },
  opportunistic: { dot: "bg-muted-foreground/60", label: "Worth trying", border: "border-border/60", bg: "bg-surface-raised/30" },
};

// Phase 3C (2026-04-20): helping_verdict cards live in the "Wins to learn
// from" stripe and must not shout "BIGGEST WIN". Render-time override —
// muted green, factual, secondary. Keeps the bucket enum unchanged.
// UX.4 (2026-05-07): label "Measured win" → "Measured lift" — matches
// the operator-locked customer-safe vocabulary.
const HELPING_VERDICT_STYLE = {
  dot: "bg-status-success/70",
  label: "Measured lift",
  border: "border-status-success/20",
  bg: "bg-status-success/[0.015]",
} as const;

// Phase 3-post (2026-04-20): new-page-opportunity cards are low-confidence
// growth signals. Render as visibly secondary with a distinct label.
const NEW_PAGE_OPPORTUNITY_STYLE = {
  dot: "bg-accent-primary/60",
  label: "New page opportunity",
  border: "border-accent-primary/25",
  bg: "bg-accent-primary/[0.02]",
} as const;

const CONFIDENCE_LABEL = REC_CONFIDENCE_LABEL;

export function ActionCard({
  action,
  variant,
  onRespondToRec,
  onStartExperiment,
  pending,
  startTransition,
  actionMsg,
  setActionMsg,
  dimmed = false,
}: ActionCardProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  // Phase 3C (2026-04-20): render-time label override for helping_verdict
  // cards so they read "Measured win" instead of the generic bucket label.
  // Phase 3-post (2026-04-20): similarly override for new-page-opportunity
  // cards routed by the page-job-fit classifier.
  const bs =
    action.type === "helping_verdict"
      ? HELPING_VERDICT_STYLE
      : action.placementMode === "new_page"
        ? NEW_PAGE_OPPORTUNITY_STYLE
        : (BUCKET_STYLE[action.bucket] ?? BUCKET_STYLE.opportunistic);
  const isPrimary = variant === "primary";

  return (
    <div
      className={cn(
        "rounded-lg border px-5 pt-4 pb-5",
        dimmed
          ? "border-border/40 bg-surface-inset/20 opacity-[0.65]"
          : cn(bs.border, bs.bg),
        !isPrimary && "border-border/50 bg-surface-raised/20 px-4 pt-3 pb-4",
      )}
    >
      {/* Header: bucket dot + label only. Confidence label ("Signal detected",
         "Strong signal") removed 2026-04-19 \u2014 uniform on every card = noise.
         Confidence still lives on the card via rationale copy (e.g. "medium
         confidence" in hurting card text) where it actually carries context. */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", dimmed ? "bg-muted-foreground/40" : bs.dot)} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {bs.label}
          </span>
        </span>
        {/* T2 (operator audit, 2026-05-05) — hide the badge when the
            evidence basis is `heuristic`. Heuristic recs come from a
            static rule, not from per-tenant evidence — labeling them
            with anything ("Pattern-based" / "Evidence-based") leaks
            internal taxonomy. The other tiers (tenant_history /
            current_dataset / shared_pattern) DO carry real evidence
            and keep their badge. */}
        {action.evidenceBasis && action.evidenceBasis !== "heuristic" && (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-medium tracking-wide",
              EVIDENCE_BASIS_PILL[action.evidenceBasis] ?? EVIDENCE_BASIS_PILL.heuristic,
            )}
          >
            {EVIDENCE_BASIS_LABEL[action.evidenceBasis] ?? "Pattern-based"}
          </span>
        )}
      </div>

      {/* Headline */}
      <p className={cn(
        "font-extrabold tracking-tight leading-snug text-foreground",
        isPrimary ? "text-[17px]" : "text-[14px]",
      )}>
        {action.headline}
      </p>

      {/* Plan C (2026-04-20): the prominent "Better fit than /x" badge was
         removed here. It exposed internal routing machinery on the card
         face. The same information now lives in the "Why we suggest this"
         expander as a single neutral bullet. */}

      {/* Prior success + expected metric chips */}
      {(action.priorSuccess || action.expectedMetric || action.engineTiming) && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {action.priorSuccess && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-success/10 text-[10px] font-medium text-status-success">
              Worked on {action.priorSuccess.pagePath}: +{Math.round(action.priorSuccess.citationDelta)}%
            </span>
          )}
          {action.expectedMetric && !action.priorSuccess && (() => {
            // T2 (operator audit, 2026-05-05) — translate internal
            // snake_case metric keys to operator-readable copy. If the
            // mapping is missing AND the value still looks like a raw
            // identifier (lowercase + underscores, no spaces), drop
            // the chip entirely rather than leaking
            // "citations_per_day" / "primary_rate" to the operator.
            const friendly = friendlyExpectedMetric(action.expectedMetric);
            if (friendly === null) return null;
            return (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-primary/10 text-[10px] font-medium text-accent-primary">
                {friendly}
              </span>
            );
          })()}
          {action.engineTiming && action.engineTiming.length > 0 && (() => {
            const sorted = [...action.engineTiming].sort((a, b) => a.medianDays - b.medianDays);
            const allSame = sorted.every(t => t.medianDays === sorted[0].medianDays);
            if (allSame && sorted.length > 1) {
              const lo = Math.max(sorted[0].medianDays - 14, 7);
              const hi = sorted[0].medianDays + 5;
              return (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-inset/50 text-[9px] text-muted-foreground/75">
                  Signal: {lo}-{hi} days
                </span>
              );
            }
            return sorted.map(t => (
              <span key={t.platform} className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-inset/50 text-[9px] text-muted-foreground/75">
                {t.platform} ~{t.medianDays}d
              </span>
            ));
          })()}
        </div>
      )}

      {/* Rationale */}
      <p className={cn(
        "text-muted-foreground leading-relaxed mt-2",
        isPrimary ? "text-[13px]" : "text-[12px]",
      )}>
        {action.rationale}
      </p>

      {/* Why we think this — confidenceReason rendered verbatim when present.
         Phase 1 (2026-04-20): surfaces the already-computed reason string that
         was previously dropped on the floor. Muted, one line, between rationale
         and CTA. */}
      {action.confidenceReason && (
        <p className={cn(
          "text-muted-foreground/70 italic leading-snug mt-1.5",
          isPrimary ? "text-[11px]" : "text-[10px]",
        )}>
          {action.confidenceReason}
        </p>
      )}

      {/* CTA row */}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {/* Verdict cards (hurting / helping) \u2014 single nav CTA + Acknowledge.
           Apply/Dismiss are semantically wrong here: the verdict is a fact,
           not a rec you apply. Phase 7 Part 1d (2026-04-19). */}
        {(action.type === "hurting_verdict" || action.type === "helping_verdict") && action.responseStatus !== "accepted" && (
          <>
            <Link
              href={action.href}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[12px] font-semibold transition-opacity",
                isPrimary
                  ? "bg-foreground text-background hover:opacity-90"
                  : "border border-foreground/20 text-foreground hover:bg-surface-inset/40",
              )}
            >
              {action.type === "hurting_verdict" ? "See the change \u2192" : "Replicate this win \u2192"}
            </Link>
            {onRespondToRec && (
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await onRespondToRec(action.id, "dismissed");
                    setActionMsg(
                      action.type === "hurting_verdict"
                        ? "Acknowledged, we'll stop surfacing until the verdict changes."
                        : "Acknowledged.",
                    );
                  })
                }
                disabled={pending}
                className="text-[11px] font-medium text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                Acknowledge
              </button>
            )}
          </>
        )}
        {/* Rec cards \u2014 standard Apply / Not now / Dismiss row. */}
        {action.type !== "hurting_verdict" && action.type !== "helping_verdict" && action.responseStatus !== "accepted" && (
          <>
            {onRespondToRec && (
              <button
                type="button"
                onClick={() => {
                  startTransition(async () => {
                    // Phase 3 (2026-04-19): "Apply this" no longer creates an
                    // experiment row. The Z-score engine watches every URL
                    // change automatically via url-watcher. This click just
                    // records that the operator accepted the rec \u2014 used for
                    // causal attribution when the next change on this URL is
                    // detected.
                    // Fix 2 (2026-04-21): pass targetPageUrl + patternId so
                    // detect-findings can auto-link a later-detected change
                    // on this URL back to this acceptance.
                    await onRespondToRec(action.id, "accepted", {
                      targetPageUrl: action.targetPageUrl ?? null,
                      patternId: action.patternId ?? null,
                    });
                    setActionMsg("Noted, we'll track the next change on this page.");
                  });
                }}
                disabled={pending}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[12px] font-semibold transition-opacity",
                  isPrimary
                    ? "bg-foreground text-background hover:opacity-90"
                    : "border border-foreground/20 text-foreground hover:bg-surface-inset/40",
                )}
              >
                Apply this
              </button>
            )}
            {onRespondToRec && (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await onRespondToRec(action.id, "deferred");
                      setActionMsg("Deferred.");
                    })
                  }
                  disabled={pending}
                  className="text-[11px] font-medium text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await onRespondToRec(action.id, "dismissed");
                      setActionMsg("Dismissed.");
                    })
                  }
                  disabled={pending}
                  className="text-[11px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  Dismiss
                </button>
              </span>
            )}
          </>
        )}
        {action.responseStatus === "accepted" && (
          <>
            <Link
              href={action.href}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[12px] font-semibold transition-opacity",
                isPrimary
                  ? "bg-foreground text-background hover:opacity-90"
                  : "border border-foreground/20 text-foreground hover:bg-surface-inset/40",
              )}
            >
              Go →
            </Link>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-status-success">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
              Accepted
            </span>
          </>
        )}
      </div>

      {/* Expandable details: evidence, prior success, timing, AI context,
         watch-after, plus Plan C move-context bullet when present. */}
      {(action.lineageBullets?.length || action.priorSuccess || (action.engineTiming && action.engineTiming.length > 0) || action.answerContext || action.watchAfter || (action.placementMode === "move" && action.movedFromPath)) && (
        <div className="mt-3 pt-2 border-t border-border/30">
          <button
            type="button"
            onClick={() => setEvidenceOpen((v) => !v)}
            className="text-[10px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {evidenceOpen ? "▾ Hide" : "▸ Why we suggest this"}
          </button>
          {evidenceOpen && (
            <div className="mt-2 space-y-2">
              {/* Plan C (2026-04-20): move-context lives in the expander, not
                 on the card face. Neutral, declarative, no color emphasis. */}
              {action.placementMode === "move" && action.movedFromPath && (
                <p className="text-[11px] text-muted-foreground/80">
                  Originally tested against{" "}
                  <code className="font-mono text-[10px]">{action.movedFromPath}</code>
                  ; swapped to the better-fitting page.
                </p>
              )}
              {action.lineageBullets && action.lineageBullets.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-muted-foreground">
                  {action.lineageBullets.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              {/* Phase 1 (2026-04-20): fuller sentences for priorSuccess + engineTiming.
                 Chips at top stay; these expand the operator's model of why. */}
              {action.priorSuccess && (
                <p className="text-[11px] text-muted-foreground/90">
                  <span className="font-medium text-foreground/80">Worked before:</span>{" "}
                  {action.priorSuccess.description ? `${action.priorSuccess.description}: ` : ""}
                  {action.priorSuccess.pagePath} saw +{Math.round(action.priorSuccess.citationDelta)}% citations.
                </p>
              )}
              {action.engineTiming && action.engineTiming.length > 0 && (
                <p className="text-[11px] text-muted-foreground/90">
                  <span className="font-medium text-foreground/80">Typical landing:</span>{" "}
                  {action.engineTiming
                    .map((t) => `${t.platform} ~${t.medianDays}d (n=${t.sampleCount})`)
                    .join(" · ")}
                </p>
              )}
              {action.answerContext && (
                <p className="text-[11px] text-muted-foreground/80">{action.answerContext}</p>
              )}
              {action.sourceChangeId && (
                <Link
                  href={`/changes/${encodeURIComponent(action.sourceChangeId)}`}
                  prefetch={false}
                  className="inline-block text-[10px] text-accent-primary hover:underline font-medium"
                >
                  See the data →
                </Link>
              )}
              {action.watchAfter && (
                <p className="text-[10px] text-muted-foreground/50">
                  Check back: {action.watchAfter.charAt(0).toLowerCase() + action.watchAfter.slice(1)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
