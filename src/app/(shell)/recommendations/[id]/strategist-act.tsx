"use client";

/**
 * StrategistAct — PHASE I (2026-06-16): the senior-strategist analysis panel,
 * layered onto the brief AFTER mount as a progressive enhancement (mirrors
 * `WhyThisMattersAct`).
 *
 * Contract:
 *   • Renders NOTHING until a non-null result arrives — so with
 *     `BEACON_LLM_STRATEGIST` off (default), or any failure, the brief is
 *     byte-identical to today (no flash, no loading state).
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
  needs_more_evidence: "Needs more evidence",
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
  const rejected = enforcedConfidence === "rejected";
  const pairs = strategist.alternativesConsidered.map((alt, i) => ({
    alt,
    why: strategist.whyNotAlternatives[i] ?? null,
  }));

  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
      data-recommendation-detail-strategist="true"
      data-recommendation-detail-strategist-confidence={enforcedConfidence}
    >
      <header className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            Strategist analysis
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            AI-assisted · grounded in your data
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
    </section>
  );
}
