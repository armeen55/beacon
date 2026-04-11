/**
 * Visibility View Model — transforms result/citation data into chart-ready props.
 *
 * Routes call these functions with domain data; they return standardized
 * chart props that any visual implementation can consume.
 */

import type { KpiProps, BarChartProps, DonutChartProps } from "@/components/viz/chart-types";

export type VisibilityVMInput = {
  totalCitations: number;
  totalMentions: number;
  trendPct: number | null;
  platformBreakdown: { platform: string; label: string; citations: number; mentions: number }[];
  dateRange: { from: string; to: string } | null;
  resultCount: number;
};

export function visibilityKpis(input: VisibilityVMInput): KpiProps[] {
  return [
    {
      label: "Citations",
      value: input.totalCitations,
      delta: input.trendPct,
      deltaSuffix: "%",
    },
    {
      label: "Mentions",
      value: input.totalMentions,
      meta: input.dateRange ? `${input.dateRange.from} → ${input.dateRange.to}` : undefined,
    },
    {
      label: "Platforms",
      value: input.platformBreakdown.length,
      meta: input.platformBreakdown.slice(0, 2).map((p) => p.label).join(", "),
    },
    {
      label: "Snapshots",
      value: input.resultCount,
    },
  ];
}

export function platformDonut(input: VisibilityVMInput): DonutChartProps {
  const COLORS: Record<string, string> = {
    chatgpt: "stroke-emerald-500",
    google_aio: "stroke-blue-500",
    perplexity: "stroke-violet-500",
  };
  return {
    segments: input.platformBreakdown.map((p) => ({
      label: p.label,
      value: p.citations > 0 ? p.citations : p.mentions,
      color: COLORS[p.platform] ?? "stroke-gray-400",
    })),
    centerValue: input.totalCitations,
    centerLabel: "citations",
  };
}

export function platformBars(input: VisibilityVMInput): BarChartProps {
  return {
    entries: input.platformBreakdown.map((p) => ({
      label: p.label,
      value: p.citations > 0 ? p.citations : p.mentions,
      meta: `${p.citations} citations, ${p.mentions} mentions`,
    })),
    title: "Platform distribution",
  };
}
