/**
 * Report Generator — practical export layer for Beacon intelligence.
 *
 * Produces structured report objects from existing computed data.
 * No marketing PDFs, no branded exports — just clean, shareable data.
 */

import "server-only";

import type { BeaconReport, ReportSection } from "./report-types";
import type { BeaconScoreResult } from "./beacon-score-types";
import type { OutcomeSummary } from "./outcome-types";
import type { GeoCoverageIndex } from "@/domains/geo/types";
import type { JourneyCoverageResult } from "@/domains/prompts/journey-coverage";

export function generateVisibilityReport(opts: {
  totalCitations: number;
  totalMentions: number;
  platformBreakdown: { platform: string; label: string; citations: number }[];
  trendPct: number | null;
  dateRange: { from: string; to: string } | null;
  scoreResult: BeaconScoreResult | null;
  outcomeSummary: OutcomeSummary | null;
}): BeaconReport {
  const sections: ReportSection[] = [];

  sections.push({
    title: "Visibility overview",
    type: "stat",
    data: {
      totalCitations: opts.totalCitations,
      totalMentions: opts.totalMentions,
      trend: opts.trendPct !== null ? `${opts.trendPct > 0 ? "+" : ""}${opts.trendPct}%` : "not available",
    },
  });

  if (opts.platformBreakdown.length > 0) {
    sections.push({
      title: "Platform breakdown",
      type: "table",
      data: opts.platformBreakdown.map((p) => ({
        platform: p.label,
        citations: p.citations,
      })),
    });
  }

  if (opts.scoreResult) {
    sections.push({
      title: "Beacon Score",
      type: "stat",
      data: {
        composite: opts.scoreResult.composite,
        status: opts.scoreResult.composite_status,
        dimensions: opts.scoreResult.dimensions.map((d) => ({
          label: d.label,
          value: d.value,
          max: d.max,
          status: d.status,
        })),
      },
    });
  }

  if (opts.outcomeSummary && opts.outcomeSummary.total > 0) {
    sections.push({
      title: "Outcome track record",
      type: "stat",
      data: {
        total: opts.outcomeSummary.total,
        positiveRate: opts.outcomeSummary.positive_rate,
        avgDelta: opts.outcomeSummary.avg_citation_delta,
      },
    });
  }

  return {
    generated_at: new Date().toISOString(),
    report_type: "visibility_snapshot",
    title: "Beacon Visibility Snapshot",
    sections,
    data_freshness: opts.dateRange ? `Data through ${opts.dateRange.to}` : null,
    confidence_note: "Based on imported Profound data. Trends are observational, not predictive.",
  };
}

export function generateCompetitiveReport(opts: {
  ownedCitations: number;
  ownedShare: number | null;
  topCompetitors: { domain: string; citations: number; threat: string }[];
  geoCoverage: GeoCoverageIndex;
  journeyCoverage: JourneyCoverageResult;
}): BeaconReport {
  const sections: ReportSection[] = [];

  sections.push({
    title: "Competitive position",
    type: "stat",
    data: {
      ownedCitations: opts.ownedCitations,
      ownedShare: opts.ownedShare !== null ? `${opts.ownedShare}%` : "not available",
    },
  });

  if (opts.topCompetitors.length > 0) {
    sections.push({
      title: "Top competitors",
      type: "table",
      data: opts.topCompetitors.map((c) => ({
        domain: c.domain,
        citations: c.citations,
        threat: c.threat,
      })),
    });
  }

  sections.push({
    title: "Geographic coverage",
    type: "stat",
    data: {
      totalCities: opts.geoCoverage.total_cities,
      gaps: opts.geoCoverage.gaps.length,
      concentration: opts.geoCoverage.concentration.assessment,
    },
  });

  sections.push({
    title: "Journey stage coverage",
    type: "list",
    data: opts.journeyCoverage.stages
      .filter((s) => ["awareness", "consideration", "comparison", "decision"].includes(s.stage))
      .map((s) => ({
        stage: s.label,
        prompts: s.active_prompt_count,
        status: s.status,
      })),
  });

  return {
    generated_at: new Date().toISOString(),
    report_type: "competitive_overview",
    title: "Beacon Competitive Overview",
    sections,
    data_freshness: null,
    confidence_note: "Competitive rankings based on citation frequency in imported data, not market share.",
  };
}

/**
 * Serialize a report to a downloadable JSON string.
 */
export function serializeReport(report: BeaconReport): string {
  return JSON.stringify(report, null, 2);
}
