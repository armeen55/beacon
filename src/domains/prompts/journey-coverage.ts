/**
 * Journey Coverage Intelligence — stage-aware prompt/visibility analysis.
 *
 * Uses the existing journey stage classification from journey-stages.ts
 * to understand where prompt coverage is concentrated vs absent.
 *
 * Conservative: if a stage has zero prompts, reports "no coverage"
 * rather than inferring anything. No funnel simulation.
 */

import "server-only";

import type { JourneyStage, LibraryPrompt } from "./types";
import { JOURNEY_STAGE_LABELS, JOURNEY_STAGE_ORDER } from "./journey-stages";

export type StageCoverage = {
  stage: JourneyStage;
  label: string;
  prompt_count: number;
  active_prompt_count: number;
  pct_of_total: number;
  status: "strong" | "moderate" | "weak" | "absent";
};

export type JourneyCoverageResult = {
  computed_at: string;
  total_prompts: number;
  total_active: number;
  stages: StageCoverage[];
  strongest_stage: JourneyStage | null;
  weakest_covered_stage: JourneyStage | null;
  absent_stages: JourneyStage[];
  assessment: string;
  concentration_warning: boolean;
};

const CORE_STAGES: JourneyStage[] = ["awareness", "consideration", "comparison", "decision"];

/**
 * Compute journey stage coverage from the prompt library.
 */
export function computeJourneyCoverage(
  prompts: LibraryPrompt[],
): JourneyCoverageResult {
  const active = prompts.filter((p) => p.is_active);
  const totalActive = active.length;

  const stageCounts = new Map<JourneyStage, { total: number; active: number }>();
  for (const stage of JOURNEY_STAGE_ORDER) {
    stageCounts.set(stage, { total: 0, active: 0 });
  }

  for (const p of prompts) {
    const entry = stageCounts.get(p.journey_stage)!;
    entry.total++;
    if (p.is_active) entry.active++;
  }

  const stages: StageCoverage[] = JOURNEY_STAGE_ORDER.map((stage) => {
    const data = stageCounts.get(stage)!;
    const pct = totalActive > 0 ? Math.round((data.active / totalActive) * 100) : 0;

    let status: StageCoverage["status"];
    if (data.active === 0) status = "absent";
    else if (data.active >= 10 || pct >= 20) status = "strong";
    else if (data.active >= 3 || pct >= 5) status = "moderate";
    else status = "weak";

    return {
      stage,
      label: JOURNEY_STAGE_LABELS[stage],
      prompt_count: data.total,
      active_prompt_count: data.active,
      pct_of_total: pct,
      status,
    };
  });

  const coveredStages = stages.filter((s) => s.active_prompt_count > 0);
  const absentStages = stages
    .filter((s) => s.active_prompt_count === 0 && CORE_STAGES.includes(s.stage))
    .map((s) => s.stage);

  const strongest = coveredStages.length > 0
    ? coveredStages.sort((a, b) => b.active_prompt_count - a.active_prompt_count)[0].stage
    : null;
  const weakestCovered = coveredStages.length > 0
    ? coveredStages.sort((a, b) => a.active_prompt_count - b.active_prompt_count)[0].stage
    : null;

  // Concentration: if top stage has >80% of prompts
  const topPct = coveredStages.length > 0
    ? coveredStages.sort((a, b) => b.pct_of_total - a.pct_of_total)[0].pct_of_total
    : 0;
  const concentrationWarning = topPct >= 80 && totalActive >= 10;

  // audit-wave4 #7: count covered CORE stages specifically — coveredStages spans
  // all stages, so "N of 4 core" must not borrow the all-stage covered count.
  const coreCovered = stages.filter(
    (s) => CORE_STAGES.includes(s.stage) && s.active_prompt_count > 0,
  ).length;

  let assessment: string;
  if (totalActive === 0) {
    assessment = "No active prompts in the library. Journey coverage cannot be assessed.";
  } else if (absentStages.length >= 3) {
    assessment = `Prompt coverage exists only in ${coreCovered} of ${CORE_STAGES.length} core journey stages. ${absentStages.map((s) => JOURNEY_STAGE_LABELS[s]).join(", ")} ${absentStages.length === 1 ? "has" : "have"} no prompts.`;
  } else if (concentrationWarning) {
    const topStage = coveredStages.sort((a, b) => b.pct_of_total - a.pct_of_total)[0];
    assessment = `${topPct}% of prompts are in ${topStage.label} stage. Coverage is concentrated — other stages may be underrepresented.`;
  } else if (absentStages.length > 0) {
    assessment = `Good coverage across ${coveredStages.length} stages. ${absentStages.map((s) => JOURNEY_STAGE_LABELS[s]).join(", ")} ${absentStages.length === 1 ? "is" : "are"} not yet tracked.`;
  } else {
    assessment = `Prompts cover all ${CORE_STAGES.length} core journey stages.`;
  }

  return {
    computed_at: new Date().toISOString(),
    total_prompts: prompts.length,
    total_active: totalActive,
    stages,
    strongest_stage: strongest,
    weakest_covered_stage: weakestCovered,
    absent_stages: absentStages,
    assessment,
    concentration_warning: concentrationWarning,
  };
}
