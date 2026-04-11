/**
 * Journey View Model — transforms journey coverage into chart-ready props.
 */

import type { DonutChartProps, BarChartProps, KpiProps } from "@/components/viz/chart-types";
import type { JourneyCoverageResult } from "@/domains/prompts/journey-coverage";

export function journeyDonut(coverage: JourneyCoverageResult): DonutChartProps {
  const covered = coverage.stages.filter((s) => s.active_prompt_count > 0);
  return {
    segments: covered.map((s) => ({
      label: s.label,
      value: s.active_prompt_count,
      color: s.status === "strong" ? "stroke-status-success"
        : s.status === "moderate" ? "stroke-accent-primary" : "stroke-status-warning",
    })),
    centerValue: coverage.total_active,
    centerLabel: "prompts",
  };
}

export function journeyBars(coverage: JourneyCoverageResult): BarChartProps {
  const core = coverage.stages.filter((s) =>
    ["awareness", "consideration", "comparison", "decision"].includes(s.stage),
  );
  return {
    entries: core.map((s) => ({
      label: s.label,
      value: s.active_prompt_count,
      color: s.status === "absent" ? "bg-status-danger/30"
        : s.status === "strong" ? "bg-status-success"
        : s.status === "moderate" ? "bg-accent-primary" : "bg-status-warning",
      meta: s.status === "absent" ? "No prompts tracked" : `${s.pct_of_total}% of total`,
    })),
  };
}
