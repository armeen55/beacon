import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NarrativeBanner } from "@/components/data/narrative-banner";
import { StatCard } from "@/components/data/stat-card";
import { TriageList } from "@/components/data/triage-list";
import { WinsList } from "@/components/data/wins-list";
import { InMotionList, WaitingList } from "@/components/data/in-motion-list";
import { RiskList } from "@/components/data/risk-list";
import { LoopHealthBar } from "@/components/data/loop-health-bar";
import {
  computeNarrativeBanner,
  computeNeedsAttention,
  computeWins,
  computeInMotion,
  computeWaitingForEvidence,
  computeRisks,
  computeLoopHealth,
} from "@/domains/dashboard/triage";
import {
  opportunities,
  changelogEntries,
  results,
  weeklySummaries,
  hasActiveExperiment,
  importRuns,
} from "@/lib/seed-data.server";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import {
  resolveEvents,
  computeEventIntelligence,
  computeChangeLearning,
} from "@/domains/attribution/event-resolution";
import {
  computeRecommendations,
  CATEGORY_LABELS,
} from "@/domains/dashboard/recommendations";
import type { RecommendationCategory } from "@/domains/dashboard/recommendations";
import { candidateLinks } from "@/domains/attribution/store";

function SectionHeader({
  title,
  href,
  linkLabel = "View all",
  count,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {count != null && count > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            ({count})
          </span>
        )}
      </div>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {linkLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

const CATEGORY_COLORS: Record<RecommendationCategory, string> = {
  review: "border-status-warning/30 bg-status-warning/5",
  double_down: "border-status-success/30 bg-status-success/5",
  fix_metadata: "border-accent-primary/30 bg-accent-primary/5",
  deprioritize: "border-border bg-surface-raised",
  investigate: "border-status-danger/30 bg-status-danger/5",
};

const CATEGORY_TEXT_COLORS: Record<RecommendationCategory, string> = {
  review: "text-status-warning",
  double_down: "text-status-success",
  fix_metadata: "text-accent-primary",
  deprioritize: "text-muted-foreground",
  investigate: "text-status-danger",
};

export default function DashboardPage() {
  const experimentActive = hasActiveExperiment();
  const now = new Date();

  if (experimentActive) {
    return <ExperimentDashboard now={now} />;
  }

  return <DemoDashboard now={now} />;
}

function ExperimentDashboard({ now }: { now: Date }) {
  const latestRun = importRuns[importRuns.length - 1];

  const { attribution: attrResults, visibility } =
    partitionResultsByMode(results);
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
  const resolved = resolveEvents(
    events,
    candidateLinks,
    triageMap,
    candCountMap
  );
  const eventIntel = computeEventIntelligence(resolved);
  const changeLearning = computeChangeLearning(resolved);
  const recs = computeRecommendations(
    resolved,
    changeLearning,
    changelogEntries,
    results,
    opportunities
  );

  const attributedEvents = resolved.filter(
    (r) => r.status === "attributed" || r.status === "auto_resolved"
  );
  const pendingEvents = resolved.filter((r) => r.status === "pending");

  return (
    <div className="space-y-8">
      {/* Experiment Banner */}
      <NarrativeBanner
        variant={
          pendingEvents.length > 0
            ? "warning"
            : attributedEvents.length > 0
              ? "success"
              : "default"
        }
      >
        <span className="font-medium text-foreground">Active Experiment</span>
        {" — "}
        {pendingEvents.length > 0
          ? `${pendingEvents.length} event${pendingEvents.length !== 1 ? "s" : ""} pending review. ${attributedEvents.length} attributed.`
          : attributedEvents.length > 0
            ? `${attributedEvents.length} event${attributedEvents.length !== 1 ? "s" : ""} attributed. Review is up to date.`
            : events.length > 0
              ? `${events.length} outcome events detected. Start reviewing to learn what worked.`
              : `${results.length} results imported. Detecting outcome events...`}
      </NarrativeBanner>

      {/* Run Context */}
      <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Current Run
            </p>
            <p className="text-[13px] font-medium mt-0.5">
              {latestRun?.source_system ?? "Workbook Import"} · {latestRun?.id?.slice(0, 8) ?? "—"}
            </p>
          </div>
          <Link
            href="/import"
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            Import History
          </Link>
        </div>
      </div>

      {/* Next Best Actions */}
      {recs.length > 0 && (
        <div>
          <SectionHeader title="Next Best Actions" count={recs.length} />
          <div className="space-y-2">
            {recs.slice(0, 4).map((rec) => (
              <div
                key={rec.id}
                className={`rounded-md border px-4 py-3 ${CATEGORY_COLORS[rec.category]}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider ${CATEGORY_TEXT_COLORS[rec.category]}`}
                      >
                        {CATEGORY_LABELS[rec.category]}
                      </span>
                    </div>
                    <p className="text-[13px] font-medium">{rec.title}</p>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {rec.detail}
                    </p>
                  </div>
                  {rec.href && (
                    <Link
                      href={rec.href}
                      className="flex-shrink-0 mt-1 text-[12px] text-accent-primary hover:underline font-medium"
                    >
                      Go
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Events Pending Review */}
      {pendingEvents.length > 0 && (
        <div>
          <SectionHeader
            title="Events Pending Review"
            href="/review"
            linkLabel="Review all"
            count={pendingEvents.length}
          />
          <div className="space-y-2">
            {pendingEvents.slice(0, 4).map((r) => (
              <Link
                key={r.event.id}
                href={`/results/${r.event.anchor_result_id}`}
                className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-3 py-2 hover:bg-surface-inset transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-[12px] font-medium truncate">
                    {r.event.description}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.event.trigger_date} · {r.candidate_count} candidate
                    {r.candidate_count !== 1 ? "s" : ""}
                  </p>
                </div>
                <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0 ml-2" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* What Worked */}
      {attributedEvents.length > 0 && (
        <div>
          <SectionHeader
            title="What Worked"
            href="/diagnostics"
            linkLabel="Full diagnostics"
          />
          <div className="space-y-2">
            {attributedEvents.slice(0, 4).map((r) => {
              const change = r.primary_change_id
                ? changelogEntries.find((c) => c.id === r.primary_change_id)
                : null;
              return (
                <Link
                  key={r.event.id}
                  href={`/results/${r.event.anchor_result_id}`}
                  className="flex items-center justify-between rounded-md border border-status-success/20 bg-status-success/5 px-3 py-2 hover:bg-status-success/10 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium truncate">
                      {r.event.description}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {change
                        ? `Attributed to: ${change.asset_name}`
                        : r.status === "auto_resolved"
                          ? "Auto-resolved by triage"
                          : "Resolved"}
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold text-status-success flex-shrink-0 ml-2">
                    {r.status === "attributed" ? "Confirmed" : "Auto"}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="border-t border-border pt-6">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
          <StatCard label="Outcome Events" value={eventIntel.total_events} />
          <StatCard
            label="Resolution Rate"
            value={`${eventIntel.resolution_rate}%`}
          />
          <StatCard label="Opportunities" value={opportunities.length} />
          <StatCard label="Results" value={results.length} />
          <StatCard label="Changes" value={changelogEntries.length} />
          <StatCard
            label="Changes with Evidence"
            value={eventIntel.changes_with_evidence}
          />
        </div>
      </div>
    </div>
  );
}

function DemoDashboard({ now }: { now: Date }) {
  const banner = computeNarrativeBanner(now);
  const attention = computeNeedsAttention(now);
  const wins = computeWins();
  const inMotion = computeInMotion(now);
  const waiting = computeWaitingForEvidence(now);
  const risks = computeRisks(now);
  const loopHealth = computeLoopHealth(now);

  const latestWeek = weeklySummaries[0];
  const activeOpportunities = opportunities.filter(
    (o) =>
      o.current_status !== "captured" &&
      o.current_status !== "closed" &&
      o.current_status !== "deferred"
  );

  return (
    <div className="space-y-8">
      <NarrativeBanner variant={banner.variant}>
        <span className="font-medium text-foreground">Today:</span>{" "}
        {banner.text}
      </NarrativeBanner>

      {attention.length > 0 && (
        <div>
          <SectionHeader title="Needs Attention" count={attention.length} />
          <TriageList items={attention} />
        </div>
      )}

      {wins.length > 0 && (
        <div>
          <SectionHeader title="Wins" href="/results" />
          <WinsList items={wins} />
        </div>
      )}

      {(inMotion.length > 0 || waiting.length > 0) && (
        <div className="grid gap-8 lg:grid-cols-2">
          {inMotion.length > 0 && (
            <div>
              <SectionHeader title="In Motion" count={inMotion.length} />
              <InMotionList items={inMotion} />
            </div>
          )}
          {waiting.length > 0 && (
            <div>
              <SectionHeader
                title="Waiting for Evidence"
                count={waiting.length}
              />
              <WaitingList items={waiting} />
            </div>
          )}
        </div>
      )}

      {risks.length > 0 && (
        <div>
          <SectionHeader title="Risks" count={risks.length} />
          <RiskList items={risks} />
        </div>
      )}

      <div className="border-t border-border pt-6">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active Opportunities"
            value={activeOpportunities.length}
          />
          <StatCard label="Total Results" value={results.length} />
          <StatCard label="Total Changes" value={changelogEntries.length} />
          <StatCard
            label="Changes This Week"
            value={latestWeek?.changes_count ?? 0}
          />
        </div>
      </div>

      <LoopHealthBar health={loopHealth} />

      {/* Call to action */}
      <div className="rounded-md border border-border bg-surface-raised p-6 text-center">
        <p className="text-[13px] font-medium mb-1">
          This is demo data. Import a Ritz workbook to start a real experiment.
        </p>
        <Link
          href="/import"
          className="text-[12px] text-accent-primary hover:underline font-medium"
        >
          Go to Import
        </Link>
      </div>
    </div>
  );
}
