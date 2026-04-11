/**
 * Conversion Path — scaffold for future conversion intelligence.
 *
 * Currently Beacon can observe: prompt → answer presence → citation.
 * Visit and conversion stages require external analytics integration.
 *
 * This module defines the readiness assessment and path shape so
 * future phases can extend without architecture rewrites.
 */

import "server-only";

import type {
  ConversionPathStage,
  ConversionPathSummary,
} from "./conversion-path-types";

const OBSERVABLE_NOW: ConversionPathStage[] = [
  "prompt_triggered",
  "answer_present",
  "citation_earned",
];

const FUTURE_STAGES: ConversionPathStage[] = [
  "visit_observed",
  "conversion_recorded",
];

/**
 * Assess conversion path readiness without pretending full paths exist.
 */
export function assessConversionPathReadiness(opts: {
  hasPromptData: boolean;
  hasAnswerData: boolean;
  hasCitationData: boolean;
  hasAnalyticsIntegration: boolean;
}): ConversionPathSummary {
  const observableCount = [
    opts.hasPromptData,
    opts.hasAnswerData,
    opts.hasCitationData,
  ].filter(Boolean).length;

  const byStage: Record<ConversionPathStage, number> = {
    prompt_triggered: opts.hasPromptData ? 1 : 0,
    answer_present: opts.hasAnswerData ? 1 : 0,
    citation_earned: opts.hasCitationData ? 1 : 0,
    visit_observed: 0,
    conversion_recorded: 0,
  };

  let assessment: string;
  if (observableCount >= 3) {
    assessment = "Beacon can track prompts → answers → citations. Visit and conversion tracking requires external analytics integration (not yet connected).";
  } else if (observableCount >= 1) {
    assessment = `${observableCount}/3 observable stages have data. Full path tracking requires prompt library, answer snapshots, and citation evidence.`;
  } else {
    assessment = "No conversion path data available. Requires prompt library, native querying, and citation evidence.";
  }

  return {
    computed_at: new Date().toISOString(),
    total_paths: 0,
    by_furthest_stage: byStage,
    observable_stages: OBSERVABLE_NOW,
    future_stages: FUTURE_STAGES,
    readiness: observableCount >= 2 ? "partial" : "not_ready",
    assessment,
  };
}
