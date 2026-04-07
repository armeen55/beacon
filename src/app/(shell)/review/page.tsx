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
import { results, changelogEntries, opportunities } from "@/lib/seed-data.server";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import type { OutcomeEventType } from "@/domains/attribution/events";
import { resolveEvents, computeEventIntelligence } from "@/domains/attribution/event-resolution";
import { candidateLinks, truthLabels } from "@/domains/attribution/store";
import { PLATFORM_LABELS } from "@/lib/constants";

const EVENT_TYPE_LABELS: Record<OutcomeEventType, string> = {
  first_appearance: "First Appearance",
  visibility_regained: "Visibility Regained",
  mention_surge: "Mention Surge",
};

const EVENT_TYPE_COLORS: Record<OutcomeEventType, string> = {
  first_appearance: "text-status-success",
  visibility_regained: "text-accent-primary",
  mention_surge: "text-status-warning",
};

type EventReviewRow = {
  eventId: string;
  anchorResultId: string;
  eventType: OutcomeEventType;
  platform: string;
  topic: string;
  triggerDate: string;
  description: string;
  reviewCount: number;
  totalCandidates: number;
  hasPrimary: boolean;
};

export default function ReviewPage() {
  const { attribution, visibility } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attribution);
  const resultMap = new Map(results.map((r) => [r.id, r]));

  const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const candCountMap = new Map<string, number>();
  const rows: EventReviewRow[] = [];
  let totalAllCandidates = 0;

  for (const event of events) {
    const anchorResult = resultMap.get(event.anchor_result_id);
    if (!anchorResult) continue;

    const candidates = discoverCandidates(
      anchorResult,
      changelogEntries,
      opportunities
    );
    candCountMap.set(event.anchor_result_id, candidates.length);

    if (candidates.length === 0) continue;

    const triage = triageCandidates(candidates);
    triageMap.set(event.anchor_result_id, triage);
    totalAllCandidates += candidates.length;

    if (triage.autoResolved) continue;

    if (triage.needsReview.length > 0) {
      rows.push({
        eventId: event.id,
        anchorResultId: event.anchor_result_id,
        eventType: event.type,
        platform: PLATFORM_LABELS[event.platform] ?? event.platform,
        topic: event.topic,
        triggerDate: event.trigger_date,
        description: event.description,
        reviewCount: triage.needsReview.length,
        totalCandidates: candidates.length,
        hasPrimary: triage.primary !== null,
      });
    }
  }

  const resolved = resolveEvents(events, candidateLinks, triageMap, candCountMap);
  const intel = computeEventIntelligence(resolved);

  const confirmedCount = candidateLinks.filter(
    (cl) => cl.status === "confirmed"
  ).length;
  const labeled = truthLabels.length;

  const attributedRows = resolved.filter(
    (r) => r.status === "attributed" || r.status === "auto_resolved"
  );

  const sortedRows = rows.sort(
    (a, b) =>
      b.reviewCount - a.reviewCount ||
      a.triggerDate.localeCompare(b.triggerDate)
  );

  return (
    <div>
      <PageHeader
        title="Attribution Review"
        description="Outcome events from attribution-mode results. Review events, confirm causes, and build learning."
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-7 mb-6">
        <StatCard label="Events" value={intel.total_events} />
        <StatCard label="Attributed" value={intel.attributed} />
        <StatCard label="Auto-Resolved" value={intel.auto_resolved} />
        <StatCard label="Pending" value={intel.pending} />
        <StatCard label="Resolution Rate" value={`${intel.resolution_rate}%`} />
        <StatCard label="Confirmed" value={confirmedCount} />
        <StatCard label="Truth Labels" value={labeled} />
      </div>

      {/* Pending Review Table */}
      {sortedRows.length === 0 && attributedRows.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="text-[14px] font-medium">No events need review</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            {intel.auto_resolved > 0
              ? `${intel.auto_resolved} event${intel.auto_resolved !== 1 ? "s" : ""} auto-resolved. ${events.length} total events detected from ${attribution.length} attribution results.`
              : "Import data to detect outcome events for attribution review."}
          </p>
          <Link
            href="/diagnostics"
            className="inline-block mt-3 text-[12px] text-accent-primary hover:underline font-medium"
          >
            View Diagnostics
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedRows.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold mb-3">
                Needs Review ({sortedRows.length})
              </h3>
              <div className="rounded-md border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-surface-raised hover:bg-surface-raised">
                      <TableHead className="text-[11px] font-medium">Date</TableHead>
                      <TableHead className="text-[11px] font-medium">Event</TableHead>
                      <TableHead className="text-[11px] font-medium">Topic</TableHead>
                      <TableHead className="text-[11px] font-medium text-right">
                        Candidates
                      </TableHead>
                      <TableHead className="text-[11px] font-medium text-center">
                        Primary
                      </TableHead>
                      <TableHead className="text-[11px] font-medium">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map((row) => (
                      <TableRow key={row.eventId}>
                        <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                          {new Date(row.triggerDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                          <span className="block text-[11px]">{row.platform}</span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`text-[11px] font-semibold uppercase tracking-wider ${EVENT_TYPE_COLORS[row.eventType]}`}
                          >
                            {EVENT_TYPE_LABELS[row.eventType]}
                          </span>
                          <p className="text-[12px] text-muted-foreground mt-0.5 max-w-[280px] truncate">
                            {row.description}
                          </p>
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">
                          {row.topic}
                        </TableCell>
                        <TableCell className="text-[13px] tabular-nums text-right">
                          <span className="text-status-warning font-medium">
                            {row.reviewCount}
                          </span>
                          <span className="text-muted-foreground text-[11px]">
                            /{row.totalCandidates}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {row.hasPrimary ? (
                            <span className="text-[10px] font-medium text-status-success">
                              Yes
                            </span>
                          ) : (
                            <span className="text-[10px] text-status-warning font-medium">
                              No
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/results/${row.anchorResultId}`}
                            className="text-[12px] text-accent-primary hover:underline font-medium"
                          >
                            Review
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Resolved Events */}
          {attributedRows.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold mb-3">
                Resolved ({attributedRows.length})
              </h3>
              <div className="rounded-md border border-status-success/20 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-status-success/5 hover:bg-status-success/5">
                      <TableHead className="text-[11px] font-medium">Date</TableHead>
                      <TableHead className="text-[11px] font-medium">Event</TableHead>
                      <TableHead className="text-[11px] font-medium">Attributed To</TableHead>
                      <TableHead className="text-[11px] font-medium text-center">Status</TableHead>
                      <TableHead className="text-[11px] font-medium">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attributedRows.map((r) => {
                      const change = r.primary_change_id
                        ? changelogEntries.find((c) => c.id === r.primary_change_id)
                        : null;
                      return (
                        <TableRow key={r.event.id}>
                          <TableCell className="text-[12px] text-muted-foreground whitespace-nowrap">
                            {new Date(r.event.trigger_date).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-[11px] font-semibold uppercase tracking-wider ${EVENT_TYPE_COLORS[r.event.type]}`}
                            >
                              {EVENT_TYPE_LABELS[r.event.type]}
                            </span>
                            <p className="text-[12px] text-muted-foreground mt-0.5 max-w-[240px] truncate">
                              {r.event.topic}
                            </p>
                          </TableCell>
                          <TableCell className="text-[12px] max-w-[180px] truncate">
                            {change?.asset_name ?? "Auto-resolved"}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-[10px] font-semibold text-status-success">
                              {r.status === "attributed" ? "Confirmed" : "Auto"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/results/${r.event.anchor_result_id}`}
                              className="text-[12px] text-muted-foreground hover:text-accent-primary hover:underline"
                            >
                              View
                            </Link>
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
      )}
    </div>
  );
}
