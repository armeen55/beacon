"use client";

/**
 * StrategistAct — PHASE I (2026-06-16): the senior-strategist analysis panel,
 * layered onto the brief AFTER mount as a progressive enhancement (mirrors
 * `WhyThisMattersAct`).
 *
 * Contract:
 *   • Renders NOTHING until a non-null result arrives — so on any failure
 *     (budget blocked / API error / sanitize rejection / kill-switch), the
 *     brief is byte-identical to today (no flash, no loading state). The LLM
 *     strategist + critic are ON BY DEFAULT in production (no flag to flip).
 *   • The DETERMINISTIC verdict gates what's shown: a "rejected" verdict shows
 *     ONLY the honest caution (the reasoning that argued for it is suppressed);
 *     an approved verdict shows the full expert reasoning, clearly labelled as
 *     ANALYSIS (never source data).
 *   • Read-only: nothing here is published.
 */

import { useEffect, useState } from "react";

import {
  requestExpertStrategistAction as defaultRequestExpertStrategistAction,
  type StrategistActionResult,
} from "./llm-strategist-action";

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  needs_more_evidence: "Lower confidence, optional",
  rejected: "Not a confident target",
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: "bg-status-success/10 text-status-success",
  medium: "bg-status-warning/10 text-status-warning",
  low: "bg-muted-foreground/10 text-muted-foreground",
  needs_more_evidence: "bg-muted-foreground/10 text-muted-foreground",
  rejected: "bg-status-warning/10 text-status-warning",
};

export type StrategistActProps = {
  recId: string;
  /** DI seam for tests; defaults to the real server action. */
  requestStrategist?: (recId: string) => Promise<StrategistActionResult | null>;
};

export function StrategistAct({
  recId,
  requestStrategist = defaultRequestExpertStrategistAction,
}: StrategistActProps) {
  const [result, setResult] = useState<StrategistActionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    requestStrategist(recId)
      .then((res) => {
        if (!cancelled && res) setResult(res);
      })
      .catch(() => {
        // action already fail-closes; render nothing extra.
      });
    return () => {
      cancelled = true;
    };
  }, [recId, requestStrategist]);

  if (!result) return null;
  return <StrategistPanel result={result} />;
}

/**
 * Pure presentational panel — a function of its props (no hooks), so the
 * rendering contract (approved → full reasoning; rejected → caution only) is
 * SSR-testable without a DOM. Exported for tests.
 */
export function StrategistPanel({ result }: { result: StrategistActionResult }) {
  const { strategist, enforcedConfidence, gateNotes } = result;
  const deterministic = result.source === "deterministic";
  const rejected = enforcedConfidence === "rejected";
  const critic = result.criticReview ?? null;
  const criticRiskGroups = critic
    ? [
        { label: "Claims that may not hold up", items: critic.unsupportedClaims },
        { label: "May not match what people search for", items: critic.queryPageMismatchRisks },
        { label: "Wording to watch", items: critic.copyRisks },
        { label: "Things to check before it goes live", items: critic.publishingRisks },
        { label: "Facts to verify", items: critic.factualRisks },
        { label: "Where we're missing proof", items: critic.evidenceGaps },
      ].filter((g) => g.items.length > 0)
    : [];
  const pairs = strategist.alternativesConsidered.map((alt, i) => ({
    alt,
    why: strategist.whyNotAlternatives[i] ?? null,
  }));

  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
      data-recommendation-detail-strategist="true"
      data-recommendation-detail-strategist-confidence={enforcedConfidence}
      data-recommendation-detail-strategist-source={result.source}
    >
      <header className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            {deterministic ? "Beacon's read" : "Beacon's deeper read"}
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {deterministic
              ? "based on your data"
              : "written by AI, based on your data"}
          </span>
        </div>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
            CONFIDENCE_TONE[enforcedConfidence] ?? CONFIDENCE_TONE.low
          }`}
          data-recommendation-detail-strategist-verdict="true"
        >
          {CONFIDENCE_LABEL[enforcedConfidence] ?? enforcedConfidence}
        </span>
      </header>

      {deterministic && (
        // Trust audit C (2026-06-16): the LLM analysis is unavailable (no key /
        // budget / sanitize-reject / timeout). Be VISIBLE about it — show
        // Beacon's deterministic read instead of silently dropping the panel.
        <p
          className="mb-3 rounded-md bg-status-info/[0.06] px-3 py-2 text-[12px] leading-relaxed text-muted-foreground max-w-2xl"
          data-recommendation-detail-strategist-fallback="true"
        >
          Expert (AI) reasoning is unavailable right now — showing Beacon&apos;s
          deterministic read, grounded in your connected data.
        </p>
      )}

      {rejected ? (
        // Deterministic gate rejected — show ONLY the honest caution; suppress
        // the reasoning that argued for it.
        <p
          className="text-[13px] leading-relaxed text-foreground/85 max-w-2xl"
          data-recommendation-detail-strategist-caution="true"
        >
          Beacon&apos;s check flags this as not a confident target:{" "}
          {gateNotes[0] ?? "the evidence and page/intent fit don't yet support acting here."}
        </p>
      ) : (
        <div className="space-y-3 max-w-2xl text-[13px] leading-relaxed text-foreground/85">
          <p data-recommendation-detail-strategist-summary="true">
            {strategist.opportunitySummary}
          </p>
          <p>
            <span className="text-muted-foreground">Why now: </span>
            {strategist.whyThisNow}
          </p>
          <p>
            <span className="text-muted-foreground">Best move: </span>
            {strategist.bestAction}
          </p>
          {pairs.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">
                Why this beats the alternatives
              </p>
              <ul className="space-y-1">
                {pairs.map((p, i) => (
                  <li key={i} className="text-[12px] text-foreground/80">
                    <span className="text-foreground/90">{p.alt}</span>
                    {p.why ? <span className="text-muted-foreground"> — {p.why}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p>
            <span className="text-muted-foreground">Expected outcome: </span>
            {strategist.expectedOutcome}
          </p>
          {strategist.risks.length > 0 && (
            <p className="text-[12px] text-muted-foreground">
              <span className="uppercase tracking-wider text-[10px] font-semibold">
                Risk ({strategist.riskLevel}):{" "}
              </span>
              {strategist.risks.join(" ")}
            </p>
          )}
        </div>
      )}

      {/* Trust audit C (2026-06-16): the deterministic fallback surfaces the
          evidence RECEIPT (what backs this) + the honest gaps (what's missing),
          so "showing deterministic QA" is concrete, not a hand-wave. */}
      {deterministic &&
        (result.evidenceSupports.length > 0 ||
          result.evidenceMissing.length > 0) && (
          <div
            className="mt-4 pt-3 border-t border-border/50 max-w-2xl grid gap-3 sm:grid-cols-2"
            data-recommendation-detail-strategist-receipt="true"
          >
            {result.evidenceSupports.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  What backs this
                </p>
                <ul className="list-disc pl-4">
                  {result.evidenceSupports.map((it, i) => (
                    <li key={i} className="text-[12px] text-foreground/80 leading-snug">
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.evidenceMissing.length > 0 && (
              <div data-recommendation-detail-strategist-missing="true">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  What&apos;s missing
                </p>
                <ul className="list-disc pl-4">
                  {result.evidenceMissing.map((it, i) => (
                    <li key={i} className="text-[12px] text-muted-foreground leading-snug">
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

      {/* GQA-3 — the adversarial "Expert QA review": what might be WRONG with
          this recommendation. Visibly separate from the reasoning + source
          evidence; confidence is already clamped lower-only by the critic. */}
      {critic && (
        <div
          className="mt-4 pt-3 border-t border-border/50 max-w-2xl"
          data-recommendation-detail-adversarial-qa="true"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-status-warning/90 mb-1.5">
            Things to double-check
          </p>
          <p
            className="text-[12px] text-foreground/80 leading-relaxed mb-2"
            data-recommendation-detail-qa-note="true"
          >
            {critic.humanReviewNote}
          </p>
          {criticRiskGroups.map((g) => (
            <div key={g.label} className="mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {g.label}
              </p>
              <ul className="list-disc pl-4">
                {g.items.map((it, i) => (
                  <li key={i} className="text-[12px] text-foreground/75 leading-snug">
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {critic.whatWouldMakeThisHighConfidence.length > 0 && (
            <div
              className="mt-2 rounded-md bg-status-info/5 px-3 py-2"
              data-recommendation-detail-qa-upgrade="true"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-status-info/90">
                What would make this high-confidence
              </p>
              <ul className="list-disc pl-4">
                {critic.whatWouldMakeThisHighConfidence.map((it, i) => (
                  <li key={i} className="text-[12px] text-foreground/80 leading-snug">
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
