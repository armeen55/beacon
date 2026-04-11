/**
 * Beacon Pulse — restrained notification system for meaningful events.
 *
 * Aggregates signals from existing intelligence layers into a deduplicated
 * pulse summary. Only surfaces events that cross meaningful thresholds.
 * No spam, no aggressive badges, no background-job theater.
 */

import "server-only";

import type { PulseEvent, PulseSummary, PulseEventType, PulseSeverity } from "./pulse-types";
import type { CitationDecayResult } from "@/domains/attribution/decay-types";
import type { DiscrepancyReport } from "@/domains/entity/discrepancy-types";
import type { GeoCoverageIndex } from "@/domains/geo/types";
import type { JourneyCoverageResult } from "@/domains/prompts/journey-coverage";
import type { SnippetIntelligence } from "@/domains/competitors/snippet-types";

function pulseId(type: PulseEventType, key: string): string {
  return `pulse-${type}-${key}`;
}

/**
 * Compute the pulse summary from all existing intelligence signals.
 */
export function computePulse(opts: {
  decayAlerts: CitationDecayResult[];
  discrepancyReport: DiscrepancyReport;
  geoCoverage: GeoCoverageIndex;
  journeyCoverage: JourneyCoverageResult;
  snippetIntel: SnippetIntelligence | null;
  lastSamplingDate: string | null;
}): PulseSummary {
  const events: PulseEvent[] = [];
  const now = new Date().toISOString();

  // Citation decline
  const meaningfulDecline = opts.decayAlerts.filter((d) => d.status === "meaningful_decline");
  if (meaningfulDecline.length > 0) {
    events.push({
      id: pulseId("citation_decline", `${meaningfulDecline.length}`),
      type: "citation_decline",
      severity: meaningfulDecline.length >= 3 ? "high" : "medium",
      title: `${meaningfulDecline.length} page${meaningfulDecline.length !== 1 ? "s" : ""} with significant citation decline`,
      detail: `Citation momentum has dropped ≥30% on these pages. Consider refreshing content.`,
      href: "/diagnostics",
      created_at: now,
    });
  }

  // Discrepancies
  const notable = opts.discrepancyReport.discrepancies.filter((d) => d.severity === "notable");
  if (notable.length > 0) {
    events.push({
      id: pulseId("discrepancy_detected", `${notable.length}`),
      type: "discrepancy_detected",
      severity: notable.length >= 3 ? "high" : "medium",
      title: `${notable.length} notable representation ${notable.length === 1 ? "discrepancy" : "discrepancies"}`,
      detail: `AI answers may contain inconsistencies with your owned data.`,
      href: "/diagnostics",
      created_at: now,
    });
  }

  // Local gaps
  if (opts.geoCoverage.gaps.length >= 3) {
    events.push({
      id: pulseId("local_gap", `${opts.geoCoverage.gaps.length}`),
      type: "local_gap",
      severity: opts.geoCoverage.gaps.length >= 5 ? "high" : "medium",
      title: `${opts.geoCoverage.gaps.length} local markets with competitor pressure`,
      detail: `Markets where competitors have pages but you have limited or no presence.`,
      href: "/competitors",
      created_at: now,
    });
  }

  // Journey gaps
  if (opts.journeyCoverage.absent_stages.length >= 2) {
    events.push({
      id: pulseId("journey_gap", `${opts.journeyCoverage.absent_stages.length}`),
      type: "journey_gap",
      severity: "medium",
      title: `${opts.journeyCoverage.absent_stages.length} journey stages with no coverage`,
      detail: opts.journeyCoverage.assessment,
      href: "/diagnostics",
      created_at: now,
    });
  }

  // Extractability gaps
  const highPriSnippets = opts.snippetIntel?.signals.filter((s) => s.priority === "high") ?? [];
  if (highPriSnippets.length >= 2) {
    events.push({
      id: pulseId("extractability_gap", `${highPriSnippets.length}`),
      type: "extractability_gap",
      severity: "medium",
      title: `${highPriSnippets.length} high-priority extractability gaps`,
      detail: `Cited pages that could benefit from structural improvements for AI extractability.`,
      href: "/diagnostics",
      created_at: now,
    });
  }

  // Sampling freshness
  if (opts.lastSamplingDate) {
    const daysSince = Math.floor((Date.now() - new Date(opts.lastSamplingDate).getTime()) / 86_400_000);
    if (daysSince >= 7) {
      events.push({
        id: pulseId("sampling_stale", `${daysSince}`),
        type: "sampling_stale",
        severity: "info",
        title: `Native sampling is ${daysSince} days old`,
        detail: `Run \`npm run data:sample\` to refresh answer snapshots.`,
        href: "/diagnostics",
        created_at: now,
      });
    }
  }

  events.sort((a, b) => {
    const sevOrder: Record<PulseSeverity, number> = { high: 0, medium: 1, info: 2 };
    return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
  });

  return {
    computed_at: now,
    events,
    high_count: events.filter((e) => e.severity === "high").length,
    medium_count: events.filter((e) => e.severity === "medium").length,
    info_count: events.filter((e) => e.severity === "info").length,
    total: events.length,
  };
}
