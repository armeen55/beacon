/**
 * Spike Forensics — internal diagnostics surface.
 *
 * Detects major visibility events (citations/mentions/visibility spikes),
 * windows preceding changes, clusters them, runs triage-based attribution
 * with impact weighting, and surfaces crawl alignment. All inputs come
 * from reused primitives (memory.ts, change-outcomes, change-patterns,
 * observation runs, triage.ts) — see E1 plan.
 *
 * Founder-only diagnostic — reads the visibility-events engine with
 * real tenant data. Not customer-facing (customer shell is at /audit).
 */

import { PageHeader } from "@/components/data/page-header";
import { dailyMetricSnapshots } from "@/storage/canonical-store";
import { changelogEntries } from "@/lib/seed-data.server";
import { readStore } from "@/lib/persistence/json-store";
import { listWebsiteCrawlRuns } from "@/domains/observations/read";
import {
  detectVisibilityEvents,
  analyzeVisibilityEvent,
} from "@/domains/visibility-events/engine";
import type {
  VisibilityEvent,
  ConfidenceTier,
} from "@/domains/visibility-events/types";
import { CLUSTER_LABELS } from "@/domains/visibility-events/types";
import type { ChangeOutcome } from "@/domains/attribution/change-outcome";
import type { ChangePattern } from "@/domains/learning/change-patterns";

export const dynamic = "force-dynamic";

export default async function SpikeForensicsPage() {
  // Load upstream primitives once for all events.
  const outcomes = readStore<ChangeOutcome>("change-outcomes");
  const patterns = readStore<ChangePattern>("change-patterns");
  const observationRuns = await listWebsiteCrawlRuns();

  // Detect events across all three metrics via the new engine.
  const spikes = detectVisibilityEvents({ snapshots: dailyMetricSnapshots });

  const allReports: VisibilityEvent[] = [];
  for (const spike of spikes) {
    const report = analyzeVisibilityEvent({
      spike,
      changelog: changelogEntries,
      outcomes,
      snapshots: dailyMetricSnapshots,
      patterns,
      observationRuns,
    });
    allReports.push(report);
  }

  // Sort: strongest detection tier first, then by absolute delta.
  const tierOrder: Record<ConfidenceTier, number> = {
    strong: 0,
    moderate: 1,
    weak: 2,
  };
  allReports.sort((a, b) => {
    const cmp = tierOrder[a.confidence.detection] - tierOrder[b.confidence.detection];
    if (cmp !== 0) return cmp;
    return b.spike.absoluteDelta - a.spike.absoluteDelta;
  });

  // Limit to 50 most significant for the dev page.
  const topReports = allReports.slice(0, 50);

  // Summary counts.
  const counts = {
    total: allReports.length,
    isolated: allReports.filter((r) => r.verdict === "isolated").length,
    multiTrigger: allReports.filter((r) => r.verdict === "multi_trigger").length,
    snowball: allReports.filter((r) => r.verdict === "snowball").length,
    insufficient: allReports.filter((r) => r.verdict === "insufficient").length,
    byPlatform: {
      google_aio: allReports.filter((r) => r.spike.platform === "google_aio").length,
      chatgpt: allReports.filter((r) => r.spike.platform === "chatgpt").length,
      perplexity: allReports.filter((r) => r.spike.platform === "perplexity").length,
    },
    withCrawlAlignment: allReports.filter(
      (r) => r.crawlAlignment.runId !== null,
    ).length,
    withQualityEvidence: allReports.filter((r) =>
      r.attributions.some((a) => a.impactScore > 0),
    ).length,
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Spike Forensics"
        description="Detects major visibility events, windows preceding changes, and produces directional attribution. Impact-weighted scoring via reused triage.ts + change-patterns. Internal intelligence — no fake certainty."
      />

      {/* Summary */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-[13px] font-semibold">Detection summary</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-xs">
          <Stat label="Total events" value={counts.total} />
          <Stat label="Isolated" value={counts.isolated} />
          <Stat label="Multi-trigger" value={counts.multiTrigger} />
          <Stat label="Snowball" value={counts.snowball} />
          <Stat label="Insufficient" value={counts.insufficient} />
          <Stat label="Crawl aligned" value={counts.withCrawlAlignment} />
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-border/40">
          <Stat label="Google AIO" value={counts.byPlatform.google_aio} />
          <Stat label="ChatGPT" value={counts.byPlatform.chatgpt} />
          <Stat label="Perplexity" value={counts.byPlatform.perplexity} />
        </div>
      </div>

      {/* Reports */}
      <div className="space-y-4">
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">
          Top {topReports.length} events by detection confidence
        </h2>
        {topReports.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No events detected. Either no data or no days crossed the detection thresholds.
          </p>
        )}
        {topReports.map((report) => (
          <ForensicsCard key={report.spike.id} report={report} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

function ForensicsCard({ report }: { report: VisibilityEvent }) {
  const {
    spike,
    attributions,
    verdict,
    confidence,
    explanation,
    windows,
    crawlAlignment,
  } = report;

  const platformLabel =
    spike.platform === "google_aio"
      ? "Google AIO"
      : spike.platform === "chatgpt"
        ? "ChatGPT"
        : spike.platform === "perplexity"
          ? "Perplexity"
          : "all";

  const verdictColor =
    verdict === "isolated"
      ? "bg-status-success/10 text-status-success"
      : verdict === "multi_trigger"
        ? "bg-status-warning/10 text-status-warning"
        : verdict === "snowball"
          ? "bg-accent-primary/10 text-accent-primary"
          : "bg-muted text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 p-4 border-b border-border/60">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1 text-[10px]">
            <span className="font-mono text-muted-foreground">{spike.peakDate}</span>
            <span className="px-1.5 py-0.5 rounded bg-surface-inset font-medium">{platformLabel}</span>
            <span className="px-1.5 py-0.5 rounded bg-surface-inset">{spike.metric}</span>
            <span className={`px-1.5 py-0.5 rounded font-medium ${verdictColor}`}>{verdict}</span>
          </div>
          <h3 className="text-sm font-semibold leading-snug">{spike.scopeId}</h3>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold tabular-nums">
            {spike.peakValue.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            baseline {spike.baseline.toFixed(1)} ({spike.absoluteDelta >= 0 ? "+" : ""}
            {spike.absoluteDelta.toFixed(1)})
          </div>
        </div>
      </div>

      {/* Confidence decomposition (E1.9) */}
      <div className="px-4 py-3 border-b border-border/60 bg-surface-inset/40">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[10px]">
          <ConfidenceLine label="Detection" tier={confidence.detection} />
          <ConfidenceLine label="Attribution" tier={confidence.attribution} />
          <ConfidenceLine label="Pattern match" tier={confidence.pattern_match} />
        </div>
      </div>

      {/* Explanation */}
      <div className="p-4 text-xs text-foreground leading-relaxed border-b border-border/60">
        {explanation}
      </div>

      {/* Attributions with impact scoring (E1.6) */}
      {attributions.length > 0 && (
        <div className="p-4 space-y-2 border-b border-border/60">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cluster attribution ({attributions.length})
          </h4>
          {attributions.map((a) => (
            <div key={a.cluster} className="text-xs">
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-28 text-[10px] text-muted-foreground">
                  {a.role === "likely_primary_trigger"
                    ? "PRIMARY"
                    : a.role === "likely_amplifier"
                      ? "AMPLIFIER"
                      : "WEAK"}
                </span>
                <span className="shrink-0 w-32 font-medium">
                  {CLUSTER_LABELS[a.cluster]}
                </span>
                <span className="flex-1 text-muted-foreground">{a.rationale}</span>
                <span className="shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">
                  impact {a.impactScore.toFixed(2)}
                </span>
              </div>
              <div className="ml-28 mt-0.5 text-[9px] text-muted-foreground tabular-nums">
                count {a.impactBreakdown.changeCount} ·
                cluster {a.impactBreakdown.clusterWeight.toFixed(2)} ·
                proximity {a.impactBreakdown.proximityWeight.toFixed(2)} ·
                coverage {a.impactBreakdown.coverageWeight.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Crawl alignment (E1.7) */}
      {crawlAlignment.runId !== null && (
        <div className="px-4 py-2 border-b border-border/60 text-[10px] text-muted-foreground">
          Last self-crawl: {crawlAlignment.crawlCompletedAt} ·{" "}
          {crawlAlignment.daysBeforeEvent}d before event (run {crawlAlignment.runId.slice(0, 8)}…)
        </div>
      )}

      {/* Collapsed: changes in 3-day window */}
      {windows.threeDays.length > 0 && (
        <details className="p-4 text-xs">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
            Changes in 3-day window ({windows.threeDays.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {windows.threeDays.slice(0, 15).map((c) => (
              <li key={c.changeId} className="flex gap-2">
                <span className="shrink-0 w-12 text-[10px] text-muted-foreground tabular-nums">
                  -{c.daysBeforeSpike}d
                </span>
                <span className="shrink-0 w-28 text-[10px] text-muted-foreground">{CLUSTER_LABELS[c.cluster]}</span>
                <span className="flex-1 text-foreground/90">{c.description}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ConfidenceLine({
  label,
  tier,
}: {
  label: string;
  tier: ConfidenceTier | "none";
}) {
  const color =
    tier === "strong"
      ? "text-status-success"
      : tier === "moderate"
        ? "text-status-warning"
        : tier === "weak"
          ? "text-muted-foreground"
          : "text-muted-foreground/60";
  return (
    <span className={color}>
      {label}: <span className="font-semibold uppercase">{tier}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-bold tabular-nums">{value}</div>
    </div>
  );
}
