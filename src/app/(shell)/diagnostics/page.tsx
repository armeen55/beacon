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
import { candidateLinks } from "@/domains/attribution/store";

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
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
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
        title="Attribution Diagnostics"
        description="Stress-test the attribution engine. Identify over-attribution, under-linkage, confidence inflation, and verdict quality."
      />

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
            label="Attributed"
            value={eventIntel.attributed}
            variant="success"
            sub="Human-confirmed cause"
          />
          <StatBlock
            label="Auto-Resolved"
            value={eventIntel.auto_resolved}
            sub="Triage-confirmed"
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
            label="Resolution Rate"
            value={`${eventIntel.resolution_rate}%`}
            variant={
              eventIntel.resolution_rate >= 75
                ? "success"
                : eventIntel.resolution_rate >= 40
                  ? "warning"
                  : "default"
            }
          />
        </div>

        {Object.keys(eventIntel.by_type).length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
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
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
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

      {/* Attribution Coverage */}
      <div>
        <SectionTitle>Attribution Coverage</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock label="Total Results" value={diag.coverage.total_results} />
          <StatBlock
            label="With Attribution"
            value={diag.coverage.with_attributions}
            variant="success"
            sub={`${diag.coverage.total_results > 0 ? Math.round((diag.coverage.with_attributions / diag.coverage.total_results) * 100) : 0}%`}
          />
          <StatBlock
            label="Unattributed"
            value={diag.coverage.without_attributions}
            variant={diag.coverage.without_attributions > 0 ? "warning" : "default"}
          />
          <StatBlock
            label="Over-attributed (4+)"
            value={diag.coverage.over_attributed}
            variant={diag.coverage.over_attributed > 0 ? "danger" : "default"}
          />
        </div>
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Changes per Result
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

      {/* Confidence Distribution */}
      <div>
        <SectionTitle>Confidence Distribution</SectionTitle>
        <p className="text-[12px] text-muted-foreground mb-3">
          {diag.inflation.total_pairs} change→result pairs scored
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
        <SectionTitle>Change Verdicts</SectionTitle>
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
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
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
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
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
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
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
          Automated diagnosis of attribution model quality. What to fix next.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatBlock
            label="Unresolved Rate"
            value={`${modelReport.unresolved_rate}%`}
            variant={modelReport.unresolved_rate > 50 ? "danger" : modelReport.unresolved_rate > 25 ? "warning" : "success"}
            sub="Results with no attribution"
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
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
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
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
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
