import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { StatCard } from "@/components/data/stat-card";
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
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
        {label}
      </p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

const disclosureShell =
  "rounded-lg border border-border/60 bg-card [&>summary]:list-none [&>summary::-webkit-details-marker]:hidden";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold tracking-tight text-foreground mb-2">{children}</h3>;
}

function DisclosureBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={disclosureShell}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/30 rounded-lg">
        <span className="block">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{subtitle}</span>
        )}
      </summary>
      <div className="border-t border-border/40 px-4 py-4">{children}</div>
    </details>
  );
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

  const confirmedLinks = candidateLinks.filter((c) => c.status === "confirmed").length;

  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        title="Diagnostics"
        description="System specialist view: how attribution data is shaped, linked, and scored in this workspace. Technical and honest — for operators who need depth without leaving Beacon."
      />

      <p className="-mt-4 text-sm text-muted-foreground leading-relaxed">
        Day-to-day decisions live on{" "}
        <Link href="/" className="text-foreground underline-offset-4 hover:underline">
          Today
        </Link>
        ,{" "}
        <Link href="/review" className="text-foreground underline-offset-4 hover:underline">
          Review
        </Link>
        , and{" "}
        <Link href="/results" className="text-foreground underline-offset-4 hover:underline">
          History
        </Link>
        . Use this page when you need to sanity-check linkage, coverage, or model-shaped stats. Refresh evidence from{" "}
        <Link href="/import" className="text-foreground underline-offset-4 hover:underline">
          Import
        </Link>
        .
      </p>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <p className="text-xs text-muted-foreground mb-3">At a glance</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Change records" value={changelogEntries.length} />
          <StatCard label="Visibility snapshots" value={results.length} />
          <StatCard label="Outcome events" value={eventIntel.total_events} />
          <StatCard
            label="Review pending (events)"
            value={eventIntel.pending}
          />
        </div>
      </section>

      <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How to read system metrics</p>
        <p className="mt-1.5 leading-relaxed">
          <span className="text-foreground">Imported change IDs on snapshot rows</span> and{" "}
          <span className="text-foreground">event + Review drivers</span> are different layers — both appear below with clear labels.
          Queue and pattern stats describe the engine, not revenue or pilot outcomes.
        </p>
      </div>

      {/* Knows vs Suspects */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recorded in data</p>
          <div className="space-y-1 text-sm">
            <p><span className="font-medium tabular-nums text-foreground">{changelogEntries.length}</span> change records</p>
            <p><span className="font-medium tabular-nums text-foreground">{results.length}</span> visibility snapshots</p>
            <p><span className="font-medium tabular-nums text-foreground">{eventIntel.total_events}</span> outcome events (attribution-mode series)</p>
            <p><span className="font-medium tabular-nums text-foreground">{eventIntel.attributed}</span> events with Review-locked cause</p>
            <p><span className="font-medium tabular-nums text-foreground">{eventIntel.auto_resolved}</span> events auto-cleared (triage)</p>
            <p><span className="font-medium tabular-nums text-foreground">{confirmedLinks}</span> candidate links confirmed</p>
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
          <p className="text-xs font-medium text-status-warning mb-2">Open or inferred</p>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p><span className="tabular-nums text-foreground">{eventIntel.pending}</span> events awaiting Review</p>
            <p><span className="tabular-nums text-foreground">{eventIntel.no_candidates}</span> events with no scored candidates</p>
            <p><span className="tabular-nums text-foreground">{eventIntel.resolution_rate}%</span> of detected events closed (Review, auto, or no cause) — not a business outcome rate</p>
          </div>
        </div>
      </div>

      {/* Entity Inventory */}
      <DisclosureBlock
        title="Entity inventory"
        subtitle="Totals by entity type — imported vs seed"
      >
        <div className="rounded-md border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Entity</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs text-right">Imported</TableHead>
                <TableHead className="text-xs text-right">Seed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {diag.entity_counts.map((ec) => (
                <TableRow key={ec.type}>
                  <TableCell className="text-sm font-medium">{ec.type}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right">{ec.total}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right">
                    {ec.imported > 0 ? ec.imported : "—"}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-right">{ec.seed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DisclosureBlock>

      {/* Event Intelligence */}
      <div>
        <SectionTitle>Event intelligence</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Outcome events from attribution-mode time series. Events are the learning unit — not daily snapshots.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <StatBlock label="Total events" value={eventIntel.total_events} />
          <StatBlock
            label="Review locked"
            value={eventIntel.attributed}
            variant="success"
            sub="Cause saved from Review"
          />
          <StatBlock
            label="Auto-cleared"
            value={eventIntel.auto_resolved}
            sub="Triage only (no Review)"
          />
          <StatBlock
            label="No cause"
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
            label="Queue closed"
            value={`${eventIntel.resolution_rate}%`}
            sub="Of detected events"
            variant="default"
          />
        </div>

        {(Object.keys(eventIntel.by_type).length > 0 || eventIntel.top_changes.length > 0) && (
          <DisclosureBlock
            title="Breakdowns & evidence tables"
            subtitle="By event type and changes with the strongest event signal"
          >
            {Object.keys(eventIntel.by_type).length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-medium text-muted-foreground mb-2">By event type</p>
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Event type</TableHead>
                        <TableHead className="text-xs text-right">Total</TableHead>
                        <TableHead className="text-xs text-right">Resolved</TableHead>
                        <TableHead className="text-xs text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(eventIntel.by_type).map(([type, data]) => (
                        <TableRow key={type}>
                          <TableCell className="text-sm font-medium capitalize">
                            {type.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-right">
                            {data.total}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-right text-status-success">
                            {data.resolved}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-right">
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
                <p className="text-xs font-medium text-muted-foreground mb-2">Changes with strongest event evidence</p>
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Change</TableHead>
                        <TableHead className="text-xs text-right">Events</TableHead>
                        <TableHead className="text-xs">Topics</TableHead>
                        <TableHead className="text-xs">Event types</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventIntel.top_changes.map((cl) => {
                        const change = changelogEntries.find((c) => c.id === cl.change_id);
                        return (
                          <TableRow key={cl.change_id}>
                            <TableCell className="text-sm font-medium max-w-[200px] truncate">
                              {change?.asset_name ?? cl.change_id}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums text-right text-status-success font-medium">
                              {cl.events_attributed}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                              {cl.topics.join(", ")}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
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
          </DisclosureBlock>
        )}
      </div>

      {/* Cluster Intelligence */}
      {hasActiveExperiment() && (() => {
        const { clusters } = computeActionClusters(results, changelogEntries, opportunities, candidateLinks);
        const cs = summarizeClusters(clusters);
        const statusOrder: ClusterStatus[] = ["working", "review_now", "fix_data", "investigate_external", "monitor_only", "low_signal"];
        return (
          <div>
            <SectionTitle>Cluster intelligence</SectionTitle>
            <p className="text-sm text-muted-foreground mb-4">
              Action clusters group related visibility shifts to speed up Review.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <StatBlock label="Total clusters" value={cs.total} />
              <StatBlock label="Working" value={cs.working} variant="success" />
              <StatBlock label="Review now" value={cs.review_now} variant="warning" />
              <StatBlock label="Fix data" value={cs.fix_data + cs.investigate_external} variant="danger" />
              <StatBlock label="Avg score" value={cs.avgScore} />
            </div>
            <DisclosureBlock title="Cluster list & status mix" subtitle="Per-cluster scores and distribution by status">
              <div className="rounded-md border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Cluster</TableHead>
                      <TableHead className="text-xs text-center">Status</TableHead>
                      <TableHead className="text-xs text-right">Events</TableHead>
                      <TableHead className="text-xs text-right">Attributed</TableHead>
                      <TableHead className="text-xs text-right">Pending</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                      <TableHead className="text-xs text-right">Urgency</TableHead>
                      <TableHead className="text-xs">Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clusters.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-medium max-w-[180px] truncate">
                          {c.label}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs font-semibold ${CLUSTER_STATUS_COLORS[c.status]}`}>
                            {CLUSTER_STATUS_LABELS[c.status]}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right">{c.eventCount}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right text-status-success">
                          {c.attributedEventCount}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right text-status-warning">
                          {c.pendingEventCount}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right font-medium">{c.score}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right">{c.urgency}</TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">{c.confidenceBand}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">By status</p>
                <div className="space-y-1.5">
                  {statusOrder.map((status) => {
                    const count = clusters.filter((c) => c.status === status).length;
                    return (
                      <div key={status} className="flex items-center gap-2">
                        <span className={`text-xs w-28 shrink-0 ${CLUSTER_STATUS_COLORS[status]}`}>
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
            </DisclosureBlock>
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
            <SectionTitle>Pattern intelligence</SectionTitle>
            <p className="text-sm text-muted-foreground mb-4">
              Heuristics from change metadata and cluster history. Historical success % is an internal pattern score from attributed events in clusters — not revenue or closed deals.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <StatBlock label="Patterns" value={ps.total} />
              <StatBlock label="High model confidence" value={ps.highConfidence} variant="default" />
              <StatBlock label="Avg historical success %" value={`${ps.avgSuccessRate}%`} variant="default" sub="Cluster-tagged only" />
              <StatBlock label="Trend: improving" value={ps.improving} variant="default" />
              <StatBlock label="Trend: declining" value={ps.declining} variant={ps.declining > 0 ? "warning" : "default"} />
            </div>
            <DisclosureBlock title="Pattern table" subtitle="Executions, clusters, internal scores">
              <div className="rounded-md border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Pattern</TableHead>
                      <TableHead className="text-xs text-center">Confidence</TableHead>
                      <TableHead className="text-xs text-center">Trend</TableHead>
                      <TableHead className="text-xs text-right">Executions</TableHead>
                      <TableHead className="text-xs text-right">Clusters</TableHead>
                      <TableHead className="text-xs text-right">Attributed</TableHead>
                      <TableHead className="text-xs text-right">Hist. %</TableHead>
                      <TableHead className="text-xs text-right">Avg days</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                      <TableHead className="text-xs">Untapped</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patterns.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs font-medium max-w-[150px] truncate">
                          {p.label}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs font-semibold capitalize ${PATTERN_CONFIDENCE_COLORS[p.confidenceBand]}`}>
                            {p.confidenceBand}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs ${PATTERN_TREND_COLORS[p.trend]}`}>
                            {PATTERN_TREND_LABELS[p.trend]}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-right">{p.executionCount}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right">{p.clustersImpacted}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right text-status-success">{p.attributedEventCount}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right font-medium">{p.successRate}%</TableCell>
                        <TableCell className="text-xs tabular-nums text-right text-muted-foreground">{p.avgTimeToImpact || "—"}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right font-medium">{p.score}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                          {p.untappedContexts.length > 0 ? p.untappedContexts.slice(0, 2).join(", ") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DisclosureBlock>
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
            <SectionTitle>Expansion candidates (system)</SectionTitle>
            <p className="text-sm text-muted-foreground mb-4">
              System-derived opportunity candidates from pattern intelligence — surfaced here for inspection; product workflow for ideas remains separate.
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
              <StatBlock label="Total candidates" value={es.total} />
              <StatBlock label="New" value={es.new} variant="success" />
              <StatBlock label="High confidence" value={es.high} variant="success" />
              <StatBlock label="Medium" value={es.medium} variant="warning" />
              <StatBlock label="Adjacent" value={es.adjacent} />
              <StatBlock label="Expansion" value={es.expansion} />
            </div>
            <DisclosureBlock title="Candidate sample (first 20)" subtitle="Type, confidence, source pattern">
              <div className="rounded-md border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Candidate</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Confidence</TableHead>
                      <TableHead className="text-xs">Pattern</TableHead>
                      <TableHead className="text-xs">Target</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expCandidates.slice(0, 20).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium max-w-[200px] truncate">
                          {c.label}
                          {c.alreadyExists && (
                            <span className="ml-1 text-[10px] text-muted-foreground italic">exists</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium ${CANDIDATE_TYPE_COLORS[c.opportunityType]}`}>
                            {CANDIDATE_TYPE_LABELS[c.opportunityType]}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium capitalize ${CANDIDATE_CONFIDENCE_COLORS[c.confidence]}`}>
                            {c.confidence}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                          {c.sourcePatternLabel}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.targetCity ?? c.targetTopic}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{c.expectedImpact}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DisclosureBlock>
          </div>
        );
      })()}

      {/* Stored change IDs on result rows (import / workbook) */}
      <DisclosureBlock
        title="Imported change IDs on snapshot rows"
        subtitle={`${diag.coverage.with_attributions} of ${diag.coverage.total_results} rows carry workbook/import IDs — not the same layer as event + Review drivers below`}
      >
        <p className="text-sm text-muted-foreground mb-4">
          Counts rows where{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">attributed_changelog_ids</code> is non-empty.
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
          <p className="text-xs font-medium text-muted-foreground mb-2">IDs per row (density)</p>
          <div className="space-y-1.5">
            {Object.entries(diag.coverage.attribution_density).map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-6">{bucket}</span>
                <Bar value={count} max={maxDensity} color="bg-accent-primary" />
              </div>
            ))}
          </div>
        </div>
      </DisclosureBlock>

      {/* Event + Review drivers (same engine as Results table) */}
      <div>
        <SectionTitle>Event + Review drivers</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Same pipeline as{" "}
          <Link href="/results" className="font-medium text-foreground underline-offset-4 hover:underline">
            History
          </Link>{" "}
          → suggested cause. Attribution-mode snapshots only.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="Attribution-mode results" value={driverCov.attributionModeResultCount} />
          <StatBlock
            label="With stored IDs (subset)"
            value={driverCov.withStoredChangeIds}
            sub="Overlaps imported-ID counts"
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

      <DisclosureBlock
        title="Stored-ID pair scoring & model shape"
        subtitle={`${diag.inflation.total_pairs} change→result pairs from stored IDs only — confidence, factors, inflation checks, verdicts, timing`}
      >
        <div>
          <SectionTitle>Confidence distribution</SectionTitle>
          <p className="text-sm text-muted-foreground mb-3">
            {diag.inflation.total_pairs} pairs scored from stored IDs only.
            {diag.inflation.total_pairs === 0 && (
              <span className="mt-1 block text-status-warning">
                When this is zero, the blocks below are empty — use Event + Review drivers for the live pipeline.
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatBlock label="High" value={diag.confidence.high} variant="success" />
            <StatBlock label="Medium" value={diag.confidence.medium} />
            <StatBlock label="Low" value={diag.confidence.low} variant="warning" />
            <StatBlock label="Uncertain" value={diag.confidence.uncertain} variant="danger" />
          </div>
          <div className="space-y-1.5">
            {(["high", "medium", "low", "uncertain"] as const).map((level) => (
              <div key={level} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16 capitalize">{level}</span>
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

        <div className="mt-8">
          <SectionTitle>Factor contribution</SectionTitle>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Factor</TableHead>
                  <TableHead className="text-xs text-right">Strong</TableHead>
                  <TableHead className="text-xs text-right">Partial</TableHead>
                  <TableHead className="text-xs text-right">None</TableHead>
                  <TableHead className="text-xs text-right">Unknown</TableHead>
                  <TableHead className="text-xs text-right">Avg points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diag.factors.map((f) => (
                  <TableRow key={f.factor}>
                    <TableCell className="text-sm font-medium capitalize">{f.factor}</TableCell>
                    <TableCell className="text-sm tabular-nums text-right text-status-success">
                      {f.strong}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-right text-status-warning">
                      {f.partial}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-right text-muted-foreground">
                      {f.none}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-right text-muted-foreground/60">
                      {f.unknown}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-right font-medium">
                      {f.avg_contribution}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="mt-8">
          <SectionTitle>Confidence inflation risk</SectionTitle>
          <p className="text-sm text-muted-foreground mb-3">
            Null fields score as unknown (0 points). High-confidence pairs with missing structural anchors still deserve scrutiny.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatBlock
              label="Null URL rate"
              value={`${diag.inflation.null_url_rate}%`}
              variant={diag.inflation.null_url_rate > 50 ? "warning" : "default"}
            />
            <StatBlock
              label="Null geo rate"
              value={`${diag.inflation.null_geo_rate}%`}
              variant={diag.inflation.null_geo_rate > 50 ? "warning" : "default"}
            />
            <StatBlock
              label="Null topic rate"
              value={`${diag.inflation.null_topic_rate}%`}
              variant={diag.inflation.null_topic_rate > 30 ? "danger" : "default"}
            />
            <StatBlock
              label="High + nulls"
              value={diag.inflation.high_confidence_with_nulls}
              variant={diag.inflation.high_confidence_with_nulls > 0 ? "danger" : "success"}
              sub="High confidence with URL or geo null"
            />
          </div>
        </div>

        <div className="mt-8">
          <SectionTitle>Model outcome labels</SectionTitle>
          <div className="space-y-1.5">
            {Object.entries(diag.verdicts).map(([verdict, count]) => (
              <div key={verdict} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-24 capitalize">
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

        <div className="mt-8">
          <SectionTitle>Temporal analysis</SectionTitle>
          {diag.temporal.pairs_analyzed > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatBlock label="Avg days" value={diag.temporal.average_days ?? "—"} />
              <StatBlock label="Median days" value={diag.temporal.median_days ?? "—"} />
              <StatBlock label="Min days" value={diag.temporal.min_days ?? "—"} />
              <StatBlock label="Max days" value={diag.temporal.max_days ?? "—"} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No linked change→result pairs to analyze.</p>
          )}
        </div>
      </DisclosureBlock>

      {/* Unlinked Entities */}
      <div>
        <SectionTitle>Linkage gaps</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Records missing expected relationships — worth fixing before trusting downstream attribution.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <StatBlock
            label="Changes without results"
            value={diag.unlinked.changes_without_results}
            variant={diag.unlinked.changes_without_results > 0 ? "warning" : "success"}
            sub={`of ${changelogEntries.length} total changes`}
          />
          <StatBlock
            label="Results without changes"
            value={diag.unlinked.results_without_changes}
            variant={diag.unlinked.results_without_changes > 0 ? "warning" : "success"}
            sub={`of ${results.length} total results`}
          />
          <StatBlock
            label="Changes without opportunity"
            value={diag.unlinked.changes_with_no_opportunity}
            sub="No upstream linkage"
          />
          <StatBlock
            label="Changes without brief"
            value={diag.unlinked.changes_with_no_brief}
            sub="No execution context"
          />
        </div>
      </div>

      {/* Candidate linking + link review */}
      <div>
        <SectionTitle>Candidate linking</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Automated discovery of plausible causes and the link-review queue (confirmed / rejected / pending).
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="Total results" value={cdiag.total_results} />
          <StatBlock
            label="With candidates"
            value={cdiag.results_with_candidates}
            variant={cdiag.results_with_candidates > 0 ? "success" : "default"}
            sub={`${cdiag.total_results > 0 ? Math.round((cdiag.results_with_candidates / cdiag.total_results) * 100) : 0}%`}
          />
          <StatBlock
            label="No candidates"
            value={cdiag.results_without_candidates}
            variant={cdiag.results_without_candidates > cdiag.total_results / 2 ? "warning" : "default"}
          />
          <StatBlock label="Avg per result" value={cdiag.avg_candidates_per_result} />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatBlock label="Confirmed" value={cdiag.link_status.confirmed} variant="success" />
          <StatBlock label="Rejected" value={cdiag.link_status.rejected} variant="danger" />
          <StatBlock label="Pending" value={cdiag.link_status.suggested} />
        </div>
        <DisclosureBlock
          title="Distribution & score calibration"
          subtitle="Candidates per result and confirmed vs rejected score spread"
        >
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Candidates per result</p>
            <div className="space-y-1.5">
              {Object.entries(cdiag.candidate_distribution).map(([bucket, count]) => (
                <div key={bucket} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-10">{bucket}</span>
                  <Bar value={count} max={maxCandDist} color="bg-accent-primary" />
                </div>
              ))}
            </div>
          </div>
          {cdiag.score_calibration.avg_confirmed_score !== null && (
            <div className="mt-6">
              <p className="text-xs font-medium text-muted-foreground mb-2">Score calibration</p>
              <div className="grid grid-cols-2 gap-3">
                <StatBlock
                  label="Avg confirmed score"
                  value={cdiag.score_calibration.avg_confirmed_score}
                  variant="success"
                  sub="Higher is better calibrated"
                />
                <StatBlock
                  label="Avg rejected score"
                  value={cdiag.score_calibration.avg_rejected_score ?? "—"}
                  variant={cdiag.score_calibration.avg_rejected_score !== null ? "danger" : "default"}
                  sub="Lower is better calibrated"
                />
              </div>
            </div>
          )}
        </DisclosureBlock>
      </div>

      {/* Truth Labels */}
      {cdiag.truth_labels.total > 0 && (
        <DisclosureBlock
          title="Truth-set evaluation"
          subtitle={`${cdiag.truth_labels.total} human labels — model vs human agreement when available`}
        >
          <p className="text-sm text-muted-foreground mb-4">
            Ground-truth labels for attribution quality; not shown in daily surfaces.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <StatBlock label="Total labels" value={cdiag.truth_labels.total} />
            <StatBlock label="Causal" value={cdiag.truth_labels.causal} variant="success" />
            <StatBlock label="Contributing" value={cdiag.truth_labels.contributing} />
            <StatBlock label="Unrelated" value={cdiag.truth_labels.unrelated} variant="danger" />
            <StatBlock label="Unknown" value={cdiag.truth_labels.unknown} />
          </div>
          {cdiag.truth_agreement && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Model vs human agreement</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <StatBlock
                  label="True positives"
                  value={cdiag.truth_agreement.model_positive_human_positive}
                  variant="success"
                  sub="Linked + human agrees"
                />
                <StatBlock
                  label="False positives"
                  value={cdiag.truth_agreement.model_positive_human_negative}
                  variant="danger"
                  sub="Linked but human disagrees"
                />
                <StatBlock
                  label="False negatives"
                  value={cdiag.truth_agreement.model_negative_human_positive}
                  variant="warning"
                  sub="Not linked but human says yes"
                />
                <StatBlock
                  label="True negatives"
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
        </DisclosureBlock>
      )}

      {/* Model Report */}
      <div>
        <SectionTitle>Model gaps & recommendations</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Heuristic gaps for the scoring model. “Unresolved” here means{" "}
          <span className="font-medium text-foreground">no stored change IDs on the result row</span> — not “no driver” on History rows.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock
            label="Rows without stored IDs"
            value={`${modelReport.unresolved_rate}%`}
            variant="default"
            sub="Of all results — compare Event + Review drivers"
          />
          <StatBlock
            label="Topic unknown"
            value={`${modelReport.metadata_gap_rates.topic_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.topic_unknown_pct > 40 ? "warning" : "default"}
            sub="of candidate pairs"
          />
          <StatBlock
            label="URL unknown"
            value={`${modelReport.metadata_gap_rates.url_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.url_unknown_pct > 60 ? "warning" : "default"}
            sub="of candidate pairs"
          />
          <StatBlock
            label="Platform unknown"
            value={`${modelReport.metadata_gap_rates.platform_unknown_pct}%`}
            variant={modelReport.metadata_gap_rates.platform_unknown_pct > 60 ? "warning" : "default"}
            sub="of candidate pairs"
          />
        </div>

        {modelReport.factor_comparison.some((f) => f.confirmed_avg_points > 0 || f.rejected_avg_points > 0) && (
          <DisclosureBlock
            title="Factor lift: confirmed vs rejected"
            subtitle="Average points by factor for confirmed vs rejected links"
          >
            <div className="rounded-md border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Factor</TableHead>
                    <TableHead className="text-xs text-right">Confirmed avg</TableHead>
                    <TableHead className="text-xs text-right">Rejected avg</TableHead>
                    <TableHead className="text-xs text-right">Lift</TableHead>
                    <TableHead className="text-xs text-right">Confirmed strong%</TableHead>
                    <TableHead className="text-xs text-right">Confirmed unknown%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelReport.factor_comparison.map((f) => (
                    <TableRow key={f.factor}>
                      <TableCell className="text-sm font-medium capitalize">{f.factor}</TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-status-success">
                        {f.confirmed_avg_points}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-status-danger">
                        {f.rejected_avg_points}
                      </TableCell>
                      <TableCell className={`text-sm tabular-nums text-right font-medium ${f.lift > 0 ? "text-status-success" : f.lift < 0 ? "text-status-danger" : ""}`}>
                        {f.lift > 0 ? "+" : ""}{f.lift}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right">
                        {f.confirmed_strong_pct}%
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-right text-muted-foreground">
                        {f.confirmed_unknown_pct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DisclosureBlock>
        )}

        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recommendations</p>
          <div className="space-y-2">
            {modelReport.recommendations.map((rec, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
              >
                <p className="text-sm text-foreground">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
