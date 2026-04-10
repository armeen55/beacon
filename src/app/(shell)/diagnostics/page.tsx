import { PageHeader } from "@/components/data/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  opportunities,
  briefs,
  changelogEntries,
  results,
  competitors,
} from "@/lib/seed-data.server";
import {
  computeDiagnostics,
  computeCandidateDiagnostics,
  computeModelReport,
} from "@/domains/attribution/diagnostics";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { resolveEvents, computeEventIntelligence } from "@/domains/attribution/event-resolution";
import { candidateLinks, eventDecisions } from "@/domains/attribution/store";
import {
  buildAttributionDriverMap,
  summarizeDriverCoverage,
} from "@/domains/attribution/result-drivers";
import { computeActionClusters } from "@/domains/action-clusters/compute";
import { summarizeClusters } from "@/domains/action-clusters/selectors";
import {
  CLUSTER_STATUS_LABELS,
  CLUSTER_STATUS_COLORS,
} from "@/domains/action-clusters/types";
import type { ClusterStatus } from "@/domains/action-clusters/types";
import { computePatterns } from "@/domains/patterns/compute";
import { summarizePatterns } from "@/domains/patterns/selectors";
import {
  PATTERN_CONFIDENCE_COLORS,
  PATTERN_TREND_LABELS,
  PATTERN_TREND_COLORS,
} from "@/domains/patterns/types";
import { hasActiveExperiment } from "@/lib/seed-data.server";
import { computeOpportunityCandidates } from "@/domains/opportunity-candidates/compute";
import { summarizeCandidates } from "@/domains/opportunity-candidates/selectors";
import {
  CANDIDATE_TYPE_LABELS,
  CANDIDATE_TYPE_COLORS,
  CANDIDATE_CONFIDENCE_COLORS,
} from "@/domains/opportunity-candidates/types";

function StatBlock({
  label,
  value,
  sub,
  variant,
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "success" | "warning" | "danger" | "default";
}) {
  const color =
    variant === "success"
      ? "text-status-success"
      : variant === "warning"
        ? "text-status-warning"
        : variant === "danger"
          ? "text-status-danger"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border-subtle bg-surface-raised p-3">
      <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
        {label}
      </p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13px] font-semibold mb-3">{children}</h3>;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-surface-inset overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground w-8 text-right">{value}</span>
    </div>
  );
}

export default function DiagnosticsPage() {
  const diag = computeDiagnostics(results, changelogEntries, opportunities, briefs, competitors);
  const cdiag = computeCandidateDiagnostics(results, changelogEntries, opportunities);
  const modelReport = computeModelReport(results, changelogEntries, opportunities, cdiag);

  const driverMap = buildAttributionDriverMap(
    results,
    changelogEntries,
    opportunities,
    eventDecisions
  );
  const driverCov = summarizeDriverCoverage(results, driverMap);

  const { attribution: attrResults } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attrResults);
  const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const candCountMap = new Map<string, number>();
  for (const event of events) {
    const anchor = results.find((r) => r.id === event.anchor_result_id);
    if (!anchor) continue;
    const cands = discoverCandidates(anchor, changelogEntries, opportunities);
    candCountMap.set(event.anchor_result_id, cands.length);
    triageMap.set(event.anchor_result_id, triageCandidates(cands));
  }
  const resolved = resolveEvents(events, candidateLinks, triageMap, candCountMap);
  const eventIntel = computeEventIntelligence(resolved);

  const maxDensity = Math.max(...Object.values(diag.coverage.attribution_density));
  const maxConfidence = Math.max(...Object.values(diag.confidence));
  const maxVerdict = Math.max(...Object.values(diag.verdicts));
  const maxCandDist = Math.max(...Object.values(cdiag.candidate_distribution));

  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        title="Diagnostics"
        description="System-level pipeline metrics for debugging weights, coverage, and pattern stats. Not part of the daily workflow."
      />

      <div className="rounded-md border border-border bg-surface-inset/70 px-3 py-2.5 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Analyst surface.</span>{" "}
        Stored change IDs on results vs event+Review drivers are different
        layers (see sections below). Do not treat resolution rates or pattern
        blocks as product truth for pilots.
      </div>

      {/* Knows vs Suspects */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
          <p className="text-[10px] font-semibold text-muted-foreground mb-1.5">
            Recorded in data
          </p>
          <div className="space-y-0.5 text-[12px]">
            <p><span className="font-medium tabular-nums">{changelogEntries.length}</span> change records</p>
            <p><span className="font-medium tabular-nums">{results.length}</span> visibility snapshots (results)</p>
            <p><span className="font-medium tabular-nums">{eventIntel.total_events}</span> outcome events (attribution-mode time series)</p>
            <p><span className="font-medium tabular-nums">{eventIntel.attributed}</span> events with Review-locked cause</p>
            <p><span className="font-medium tabular-nums">{eventIntel.auto_resolved}</span> events auto-cleared by triage rules</p>
            <p><span className="font-medium tabular-nums">{candidateLinks.filter((c) => c.status === "confirmed").length}</span> candidate pairs marked confirmed (link workflow)</p>
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
          <p className="text-[10px] font-semibold text-status-warning mb-1.5">
            Open / inferred
          </p>
          <div className="space-y-0.5 text-[12px] text-muted-foreground">
            <p><span className="tabular-nums">{eventIntel.pending}</span> events still needing Review</p>
            <p><span className="tabular-nums">{eventIntel.no_candidates}</span> events with no scored candidates</p>
            <p><span className="tabular-nums">{eventIntel.resolution_rate}%</span> events closed (Review + auto + “no cause”) — not “proven ROI”</p>
          </div>
        </div>
      </div>

      {/* Entity Inventory */}
      <div>
        <SectionTitle>Entity Inventory</SectionTitle>
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">Entity</TableHead>
                <TableHead className="text-[11px] text-right">Total</TableHead>
                <TableHead className="text-[11px] text-right">Imported</TableHead>
                <TableHead className="text-[11px] text-right">Seed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diag.entity_counts.map((ec) => (
                <TableRow key={ec.type}>
                  <TableCell className="text-[13px] font-medium">{ec.type}</TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right">{ec.total}</TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right">
                    {ec.imported > 0 ? ec.imported : "—"}
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right">{ec.seed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Event Intelligence */}
      <div>
        <SectionTitle>Event Intelligence</SectionTitle>
        <p className="text-[12px] text-muted-foreground mb-3">
          Outcome events detected from attribution-mode time series. Events are the learning unit — not daily snapshots.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <StatBlock label="Total Events" value={eventIntel.total_events} />
          <StatBlock
            label="Review locked"
            value={eventIntel.attributed}
            variant="success"
            sub="Cause saved from Review"
          />
          <StatBlock
            label="Auto-cleared"
            value={eventIntel.auto_resolved}
            sub="Triage-only (no Review)"
          />
          <StatBlock
            label="No Cause"
            value={eventIntel.no_cause}
            sub="All candidates rejected"
          />
          <StatBlock
            label="Pending"
            value={eventIntel.pending}
            variant={eventIntel.pending > 0 ? "warning" : "default"}
            sub="Needs review"
          />
          <StatBlock
            label="Queue closed %"
            value={`${eventIntel.resolution_rate}%`}
            sub="Of detected events"
            variant="default"
          />
        </div>

        {Object.keys(eventIntel.by_type).length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-medium text-muted-foreground mb-2">
              By Event Type
            </p>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Event Type</TableHead>
                    <TableHead className="text-[11px] text-right">Total</TableHead>
                    <TableHead className="text-[11px] text-right">Resolved</TableHead>
                    <TableHead className="text-[11px] text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(eventIntel.by_type).map(([type, data]) => (
                    <TableRow key={type}>
                      <TableCell className="text-[13px] font-medium capitalize">
                        {type.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-[13px] tabular-nums text-right">
                        {data.total}
                      </TableCell>
                      <TableCell className="text-[13px] tabular-nums text-right text-status-success">
                        {data.resolved}
                      </TableCell>
                      <TableCell className="text-[13px] tabular-nums text-right">
                        {data.total > 0 ? Math.round((data.resolved / data.total) * 100) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {eventIntel.top_changes.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-2">
              What Worked — Changes with Event Evidence
            </p>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Change</TableHead>
                    <TableHead className="text-[11px] text-right">Events</TableHead>
                    <TableHead className="text-[11px]">Topics</TableHead>
                    <TableHead className="text-[11px]">Event Types</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eventIntel.top_changes.map((cl) => {
                    const change = changelogEntries.find((c) => c.id === cl.change_id);
                    return (
                      <TableRow key={cl.change_id}>
                        <TableCell className="text-[13px] font-medium max-w-[200px] truncate">
                          {change?.asset_name ?? cl.change_id}
                        </TableCell>
                        <TableCell className="text-[13px] tabular-nums text-right text-status-success font-medium">
                          {cl.events_attributed}
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground max-w-[160px] truncate">
                          {cl.topics.join(", ")}
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">
                          {cl.event_types.map((t) => t.replace(/_/g, " ")).join(", ")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Cluster Intelligence */}
      {hasActiveExperiment() && (() => {
        const { clusters } = computeActionClusters(results, changelogEntries, opportunities, candidateLinks);
        const cs = summarizeClusters(clusters);
        const statusOrder: ClusterStatus[] = ["working", "review_now", "fix_data", "investigate_external", "monitor_only", "low_signal"];
        return (
          <div>
            <SectionTitle>Cluster Intelligence</SectionTitle>
            <p className="text-[12px] text-muted-foreground mb-3">
              Action clusters group related visibility shifts to speed up Review.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <StatBlock label="Total Clusters" value={cs.total} />
              <StatBlock label="Working" value={cs.working} variant="success" />
              <StatBlock label="Review Now" value={cs.review_now} variant="warning" />
              <StatBlock label="Fix Data" value={cs.fix_data + cs.investigate_external} variant="danger" />
              <StatBlock label="Avg Score" value={cs.avgScore} />
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Cluster</TableHead>
                    <TableHead className="text-[11px] text-center">Status</TableHead>
                    <TableHead className="text-[11px] text-right">Events</TableHead>
                    <TableHead className="text-[11px] text-right">Attributed</TableHead>
                    <TableHead className="text-[11px] text-right">Pending</TableHead>
                    <TableHead className="text-[11px] text-right">Score</TableHead>
                    <TableHead className="text-[11px] text-right">Urgency</TableHead>
                    <TableHead className="text-[11px]">Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clusters.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-[12px] font-medium max-w-[180px] truncate">
                        {c.label}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-[10px] font-semibold uppercase ${CLUSTER_STATUS_COLORS[c.status]}`}>
                          {CLUSTER_STATUS_LABELS[c.status]}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right">{c.eventCount}</TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right text-status-success">
                        {c.attributedEventCount}
                      </TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right text-status-warning">
                        {c.pendingEventCount}
                      </TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right font-medium">{c.score}</TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right">{c.urgency}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground capitalize">{c.confidenceBand}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4">
              <p className="text-[11px] font-medium text-muted-foreground mb-2">
                By Status
              </p>
              <div className="space-y-1.5">
                {statusOrder.map((status) => {
                  const count = clusters.filter((c) => c.status === status).length;
                  return (
                    <div key={status} className="flex items-center gap-2">
                      <span className={`text-[12px] w-24 ${CLUSTER_STATUS_COLORS[status]}`}>
                        {CLUSTER_STATUS_LABELS[status]}
                      </span>
                      <Bar
                        value={count}
                        max={Math.max(cs.total, 1)}
                        color={
                          status === "working"
                            ? "bg-status-success"
                            : status === "review_now"
                              ? "bg-status-warning"
                              : status === "fix_data" || status === "investigate_external"
                                ? "bg-status-danger"
                                : "bg-border"
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Pattern Intelligence */}
      {hasActiveExperiment() && (() => {
        const { patterns } = computePatterns(results, changelogEntries, opportunities, candidateLinks);
        const ps = summarizePatterns(patterns);
        if (patterns.length === 0) return null;
        return (
          <div>
            <SectionTitle>Pattern Intelligence</SectionTitle>
            <p className="text-[12px] text-muted-foreground mb-3">
              Heuristics from change metadata + cluster history. “Success %” is an internal pattern score tied to attributed events in clusters — not revenue or closed deals.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <StatBlock label="Patterns" value={ps.total} />
              <StatBlock label="High model confidence" value={ps.highConfidence} variant="default" />
              <StatBlock label="Avg historical success %" value={`${ps.avgSuccessRate}%`} variant="default" sub="Cluster-tagged only" />
              <StatBlock label="Trend: improving" value={ps.improving} variant="default" />
              <StatBlock label="Trend: declining" value={ps.declining} variant={ps.declining > 0 ? "warning" : "default"} />
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Pattern</TableHead>
                    <TableHead className="text-[11px] text-center">Confidence</TableHead>
                    <TableHead className="text-[11px] text-center">Trend</TableHead>
                    <TableHead className="text-[11px] text-right">Executions</TableHead>
                    <TableHead className="text-[11px] text-right">Clusters</TableHead>
                    <TableHead className="text-[11px] text-right">Attributed</TableHead>
                    <TableHead className="text-[11px] text-right">Hist. %</TableHead>
                    <TableHead className="text-[11px] text-right">Avg Days</TableHead>
                    <TableHead className="text-[11px] text-right">Score</TableHead>
                    <TableHead className="text-[11px]">Untapped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patterns.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-[12px] font-medium max-w-[150px] truncate">
                        {p.label}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-[10px] font-semibold uppercase ${PATTERN_CONFIDENCE_COLORS[p.confidenceBand]}`}>
                          {p.confidenceBand}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-[10px] ${PATTERN_TREND_COLORS[p.trend]}`}>
                          {PATTERN_TREND_LABELS[p.trend]}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right">{p.executionCount}</TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right">{p.clustersImpacted}</TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right text-status-success">{p.attributedEventCount}</TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right font-medium">{p.successRate}%</TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right text-muted-foreground">{p.avgTimeToImpact || "—"}</TableCell>
                      <TableCell className="text-[12px] tabular-nums text-right font-medium">{p.score}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[120px] truncate">
                        {p.untappedContexts.length > 0 ? p.untappedContexts.slice(0, 2).join(", ") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })()}

      {/* Expansion Intelligence */}
      {hasActiveExperiment() && (() => {
        const expCandidates = computeOpportunityCandidates(results, changelogEntries, opportunities, candidateLinks);
        const es = summarizeCandidates(expCandidates);
        if (expCandidates.length === 0) return null;
        return (
          <div>
            <SectionTitle>Expansion Intelligence</SectionTitle>
            <p className="text-[12px] text-muted-foreground mb-3">
              System-derived opportunity candidates from pattern intelligence. Fact-checked strategies with caveats.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
              <StatBlock label="Total Candidates" value={es.total} />
              <StatBlock label="New" value={es.new} variant="success" />
              <StatBlock label="High Confidence" value={es.high} variant="success" />
              <StatBlock label="Medium" value={es.medium} variant="warning" />
              <StatBlock label="Adjacent" value={es.adjacent} />
              <StatBlock label="Expansion" value={es.expansion} />
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Pattern</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expCandidates.slice(0, 20).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-[13px] font-medium max-w-[200px] truncate">
                        {c.label}
                        {c.alreadyExists && (
                          <span className="ml-1 text-[9px] text-muted-foreground italic">exists</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`text-[11px] font-medium ${CANDIDATE_TYPE_COLORS[c.opportunityType]}`}>
                          {CANDIDATE_TYPE_LABELS[c.opportunityType]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`text-[11px] font-medium uppercase ${CANDIDATE_CONFIDENCE_COLORS[c.confidence]}`}>
                          {c.confidence}
                        </span>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[150px] truncate">
                        {c.sourcePatternLabel}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {c.targetCity ?? c.targetTopic}
                      </TableCell>
                      <TableCell className="text-right text-[11px] tabular-nums">{c.expectedImpact}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })()}

      {/* Stored change IDs on result rows (import / workbook) */}
      <div>
        <SectionTitle>Stored change IDs on results</SectionTitle>
        <p className="text-[12px] text-muted-foreground mb-3">
          Counts rows where <code className="text-[10px] bg-surface-inset px-1 rounded">attributed_changelog_ids</code> is non-empty.
          This is <span className="font-medium text-foreground">not</span> the same as the event + Review driver shown on the Results page.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="All results" value={diag.coverage.total_results} />
          <StatBlock
            label="Rows with stored IDs"
            value={diag.coverage.with_attributions}
            variant={diag.coverage.with_attributions > 0 ? "success" : "default"}
            sub={`${diag.coverage.total_results > 0 ? Math.round((diag.coverage.with_attributions / diag.coverage.total_results) * 100) : 0}% of rows`}
          />
          <StatBlock
            label="Rows without stored IDs"
            value={diag.coverage.without_attributions}
            variant={diag.coverage.without_attributions > 0 ? "warning" : "default"}
          />
          <StatBlock
            label="4+ IDs on one row"
            value={diag.coverage.over_attributed}
            variant={diag.coverage.over_attributed > 0 ? "danger" : "default"}
          />
        </div>
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-2">
            How many stored IDs per result row
          </p>
          <div className="space-y-1.5">
            {Object.entries(diag.coverage.attribution_density).map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-2">
                <span className="text-[12px] text-muted-foreground w-6">{bucket}</span>
                <Bar value={count} max={maxDensity} color="bg-accent-primary" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Event + Review drivers (same engine as Results table) */}
      <div>
        <SectionTitle>Event + Review drivers (attribution-mode results)</SectionTitle>
        <p className="text-[12px] text-muted-foreground mb-3">
          Same pipeline as <span className="font-medium text-foreground">Results → Suggested cause</span>. Only attribution-mode snapshots are counted.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="Attribution-mode results" value={driverCov.attributionModeResultCount} />
          <StatBlock
            label="With stored IDs (subset)"
            value={driverCov.withStoredChangeIds}
            sub="Also listed above"
          />
          <StatBlock
            label="With event/Review driver"
            value={driverCov.withEventDriver}
            variant={driverCov.withEventDriver > 0 ? "success" : "default"}
          />
          <StatBlock
            label="Review locked (results)"
            value={driverCov.byTrust.confirmed}
            sub="Rows with Review decision"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatBlock label="System / auto-cleared" value={driverCov.byTrust.system_primary + driverCov.byTrust.auto_cleared} />
          <StatBlock label="Contributing pick" value={driverCov.byTrust.contributing} />
          <StatBlock label="Needs review (top candidate)" value={driverCov.byTrust.unresolved} variant={driverCov.byTrust.unresolved > 0 ? "warning" : "default"} />
        </div>
      </div>

      {/* Confidence Distribution */}
      <div>
        <SectionTitle>Confidence Distribution</SectionTitle>
        <p className="text-[12px] text-muted-foreground mb-3">
          {diag.inflation.total_pairs} change→result pairs scored from <span className="font-medium text-foreground">stored IDs only</span>.
          {diag.inflation.total_pairs === 0 && (
            <span className="block mt-1 text-status-warning"> When this is zero, the charts below are empty — use the “Event + Review drivers” section above instead.</span>
          )}
        </p>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatBlock label="High" value={diag.confidence.high} variant="success" />
          <StatBlock label="Medium" value={diag.confidence.medium} />
          <StatBlock label="Low" value={diag.confidence.low} variant="warning" />
          <StatBlock label="Uncertain" value={diag.confidence.uncertain} variant="danger" />
        </div>
        <div className="space-y-1.5">
          {(["high", "medium", "low", "uncertain"] as const).map((level) => (
            <div key={level} className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground w-16 capitalize">{level}</span>
              <Bar
                value={diag.confidence[level]}
                max={maxConfidence}
                color={
                  level === "high"
                    ? "bg-status-success"
                    : level === "medium"
                      ? "bg-accent-primary"
                      : level === "low"
                        ? "bg-status-warning"
                        : "bg-status-danger"
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* Factor Contribution */}
      <div>
        <SectionTitle>Factor Contribution</SectionTitle>
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">Factor</TableHead>
                <TableHead className="text-[11px] text-right">Strong</TableHead>
                <TableHead className="text-[11px] text-right">Partial</TableHead>
                <TableHead className="text-[11px] text-right">None</TableHead>
                <TableHead className="text-[11px] text-right">Unknown</TableHead>
                <TableHead className="text-[11px] text-right">Avg Points</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diag.factors.map((f) => (
                <TableRow key={f.factor}>
                  <TableCell className="text-[13px] font-medium capitalize">{f.factor}</TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right text-status-success">
                    {f.strong}
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right text-status-warning">
                    {f.partial}
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right text-muted-foreground">
                    {f.none}
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right text-muted-foreground/60">
                    {f.unknown}
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums text-right font-medium">
                    {f.avg_contribution}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Confidence Inflation Risk */}
      <div>
        <SectionTitle>Confidence Inflation Risk</SectionTitle>
        <p className="text-[12px] text-muted-foreground mb-3">
          Null fields now score as &quot;unknown&quot; (0 points). High-confidence pairs with null structural anchors still deserve scrutiny.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatBlock
            label="Null URL Rate"
            value={`${diag.inflation.null_url_rate}%`}
            variant={diag.inflation.null_url_rate > 50 ? "warning" : "default"}
          />
          <StatBlock
            label="Null Geo Rate"
            value={`${diag.inflation.null_geo_rate}%`}
            variant={diag.inflation.null_geo_rate > 50 ? "warning" : "default"}
          />
          <StatBlock
            label="Null Topic Rate"
            value={`${diag.inflation.null_topic_rate}%`}
            variant={diag.inflation.null_topic_rate > 30 ? "danger" : "default"}
          />
          <StatBlock
            label="High + Nulls"
            value={diag.inflation.high_confidence_with_nulls}
            variant={diag.inflation.high_confidence_with_nulls > 0 ? "danger" : "success"}
            sub="High confidence with URL or geo null"
          />
        </div>
      </div>

      {/* Verdicts */}
      <div>
        <SectionTitle>Model outcome labels</SectionTitle>
        <div className="space-y-1.5">
          {Object.entries(diag.verdicts).map(([verdict, count]) => (
            <div key={verdict} className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground w-20 capitalize">
                {verdict.replace("_", " ")}
              </span>
              <Bar
                value={count}
                max={maxVerdict}
                color={
                  verdict === "validated"
                    ? "bg-status-success"
                    : verdict === "partial"
                      ? "bg-status-warning"
                      : verdict === "no_impact"
                        ? "bg-status-danger"
                        : "bg-border"
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* Temporal Analysis */}
      <div>
        <SectionTitle>Temporal Analysis</SectionTitle>
        {diag.temporal.pairs_analyzed > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatBlock label="Avg Days" value={diag.temporal.average_days ?? "—"} />
            <StatBlock label="Median Days" value={diag.temporal.median_days ?? "—"} />
            <StatBlock label="Min Days" value={diag.temporal.min_days ?? "—"} />
            <StatBlock label="Max Days" value={diag.temporal.max_days ?? "—"} />
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No linked change→result pairs to analyze.
          </p>
        )}
      </div>

      {/* Unlinked Entities */}
      <div>
        <SectionTitle>Unlinked Entities</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <StatBlock
            label="Changes without Results"
            value={diag.unlinked.changes_without_results}
            variant={diag.unlinked.changes_without_results > 0 ? "warning" : "success"}
            sub={`of ${changelogEntries.length} total changes`}
          />
          <StatBlock
            label="Results without Changes"
            value={diag.unlinked.results_without_changes}
            variant={diag.unlinked.results_without_changes > 0 ? "warning" : "success"}
            sub={`of ${results.length} total results`}
          />
          <StatBlock
            label="Changes without Opportunity"
            value={diag.unlinked.changes_with_no_opportunity}
            sub="No upstream linkage"
          />
          <StatBlock
            label="Changes without Brief"
            value={diag.unlinked.changes_with_no_brief}
            sub="No execution context"
          />
        </div>
      </div>

      {/* Candidate Discovery */}
      <div>
        <SectionTitle>Candidate Discovery</SectionTitle>
        <p className="text-[12px] text-muted-foreground mb-3">
          Automated candidate linking — how many results have plausible unconfirmed causes discovered.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="Total Results" value={cdiag.total_results} />
          <StatBlock
            label="With Candidates"
            value={cdiag.results_with_candidates}
            variant={cdiag.results_with_candidates > 0 ? "success" : "default"}
            sub={`${cdiag.total_results > 0 ? Math.round((cdiag.results_with_candidates / cdiag.total_results) * 100) : 0}%`}
          />
          <StatBlock
            label="No Candidates"
            value={cdiag.results_without_candidates}
            variant={cdiag.results_without_candidates > cdiag.total_results / 2 ? "warning" : "default"}
          />
          <StatBlock
            label="Avg per Result"
            value={cdiag.avg_candidates_per_result}
          />
        </div>
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-2">
            Candidates per Result
          </p>
          <div className="space-y-1.5">
            {Object.entries(cdiag.candidate_distribution).map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-2">
                <span className="text-[12px] text-muted-foreground w-10">{bucket}</span>
                <Bar value={count} max={maxCandDist} color="bg-accent-primary" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Link Review Status */}
      <div>
        <SectionTitle>Link Review Status</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <StatBlock
            label="Confirmed"
            value={cdiag.link_status.confirmed}
            variant="success"
          />
          <StatBlock
            label="Rejected"
            value={cdiag.link_status.rejected}
            variant="danger"
          />
          <StatBlock
            label="Pending"
            value={cdiag.link_status.suggested}
          />
        </div>
        {cdiag.score_calibration.avg_confirmed_score !== null && (
          <div className="mt-4">
            <p className="text-[11px] font-medium text-muted-foreground mb-2">
              Score Calibration
            </p>
            <div className="grid grid-cols-2 gap-3">
              <StatBlock
                label="Avg Confirmed Score"
                value={cdiag.score_calibration.avg_confirmed_score}
                variant="success"
                sub="Higher is better calibrated"
              />
              <StatBlock
                label="Avg Rejected Score"
                value={cdiag.score_calibration.avg_rejected_score ?? "—"}
                variant={cdiag.score_calibration.avg_rejected_score !== null ? "danger" : "default"}
                sub="Lower is better calibrated"
              />
            </div>
          </div>
        )}
      </div>

      {/* Truth Labels */}
      {cdiag.truth_labels.total > 0 && (
        <div>
          <SectionTitle>Truth-Set Evaluation</SectionTitle>
          <p className="text-[12px] text-muted-foreground mb-3">
            Human-labeled ground truth for attribution quality measurement.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <StatBlock label="Total Labels" value={cdiag.truth_labels.total} />
            <StatBlock label="Causal" value={cdiag.truth_labels.causal} variant="success" />
            <StatBlock label="Contributing" value={cdiag.truth_labels.contributing} />
            <StatBlock label="Unrelated" value={cdiag.truth_labels.unrelated} variant="danger" />
            <StatBlock label="Unknown" value={cdiag.truth_labels.unknown} />
          </div>
          {cdiag.truth_agreement && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-2">
                Model vs Human Agreement
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <StatBlock
                  label="True Positives"
                  value={cdiag.truth_agreement.model_positive_human_positive}
                  variant="success"
                  sub="Linked + human agrees"
                />
                <StatBlock
                  label="False Positives"
                  value={cdiag.truth_agreement.model_positive_human_negative}
                  variant="danger"
                  sub="Linked but human disagrees"
                />
                <StatBlock
                  label="False Negatives"
                  value={cdiag.truth_agreement.model_negative_human_positive}
                  variant="warning"
                  sub="Not linked but human says yes"
                />
                <StatBlock
                  label="True Negatives"
                  value={cdiag.truth_agreement.model_negative_human_negative}
                  sub="Not linked + human agrees"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatBlock
                  label="Precision"
                  value={cdiag.truth_agreement.precision !== null ? `${cdiag.truth_agreement.precision}%` : "—"}
                  sub="Of linked pairs, % human-endorsed"
                  variant={
                    cdiag.truth_agreement.precision !== null
                      ? cdiag.truth_agreement.precision >= 70 ? "success" : cdiag.truth_agreement.precision >= 40 ? "warning" : "danger"
                      : "default"
                  }
                />
                <StatBlock
                  label="Recall"
                  value={cdiag.truth_agreement.recall !== null ? `${cdiag.truth_agreement.recall}%` : "—"}
                  sub="Of human-positive, % model found"
                  variant={
                    cdiag.truth_agreement.recall !== null
                      ? cdiag.truth_agreement.recall >= 70 ? "success" : cdiag.truth_agreement.recall >= 40 ? "warning" : "danger"
                      : "default"
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Model Report */}
      <div>
        <SectionTitle>Model Report</SectionTitle>
        <p className="text-[12px] text-muted-foreground mb-3">
          Heuristic gaps for the scoring model. “Unresolved” here means <span className="font-medium text-foreground">no stored change IDs on the result row</span> — not “no driver in Results.”
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock
            label="Rows without stored IDs"
            value={`${modelReport.unresolved_rate}%`}
            variant="default"
            sub="Of all results — see Event+Review section above"
          />
          <StatBlock
            label="Topic Unknown"
            value={`${modelReport.metadata_gap_rates.topic_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.topic_unknown_pct > 40 ? "warning" : "default"}
            sub="of candidate pairs"
          />
          <StatBlock
            label="URL Unknown"
            value={`${modelReport.metadata_gap_rates.url_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.url_unknown_pct > 60 ? "warning" : "default"}
            sub="of candidate pairs"
          />
          <StatBlock
            label="Platform Unknown"
            value={`${modelReport.metadata_gap_rates.platform_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.platform_unknown_pct > 60 ? "warning" : "default"}
            sub="of candidate pairs"
          />
        </div>

        {modelReport.factor_comparison.some((f) => f.confirmed_avg_points > 0 || f.rejected_avg_points > 0) && (
          <div className="mb-4">
            <p className="text-[11px] font-medium text-muted-foreground mb-2">
              Factor Lift: Confirmed vs Rejected
            </p>
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Factor</TableHead>
                    <TableHead className="text-[11px] text-right">Confirmed Avg</TableHead>
                    <TableHead className="text-[11px] text-right">Rejected Avg</TableHead>
                    <TableHead className="text-[11px] text-right">Lift</TableHead>
                    <TableHead className="text-[11px] text-right">Confirmed Strong%</TableHead>
                    <TableHead className="text-[11px] text-right">Confirmed Unknown%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelReport.factor_comparison.map((f) => (
                    <TableRow key={f.factor}>
                      <TableCell className="text-[13px] font-medium capitalize">{f.factor}</TableCell>
                      <TableCell className="text-[13px] tabular-nums text-right text-status-success">
                        {f.confirmed_avg_points}
                      </TableCell>
                      <TableCell className="text-[13px] tabular-nums text-right text-status-danger">
                        {f.rejected_avg_points}
                      </TableCell>
                      <TableCell className={`text-[13px] tabular-nums text-right font-medium ${f.lift > 0 ? "text-status-success" : f.lift < 0 ? "text-status-danger" : ""}`}>
                        {f.lift > 0 ? "+" : ""}{f.lift}
                      </TableCell>
                      <TableCell className="text-[13px] tabular-nums text-right">
                        {f.confirmed_strong_pct}%
                      </TableCell>
                      <TableCell className="text-[13px] tabular-nums text-right text-muted-foreground">
                        {f.confirmed_unknown_pct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-2">
            Recommendations
          </p>
          <div className="space-y-2">
            {modelReport.recommendations.map((rec, i) => (
              <div
                key={i}
                className="rounded-md border border-border bg-surface-raised px-3 py-2"
              >
                <p className="text-[13px] text-foreground">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
