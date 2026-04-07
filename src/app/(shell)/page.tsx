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
} from "@/lib/seed-data.server";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { resolveEvents, computeEventIntelligence } from "@/domains/attribution/event-resolution";
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

export default function DashboardPage() {
  const now = new Date();
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
  const hasEvents = events.length > 0;

  const attributedEvents = resolved.filter(
    (r) => r.status === "attributed" || r.status === "auto_resolved"
  );
  const pendingEvents = resolved.filter((r) => r.status === "pending");

  return (
    <div className="space-y-8">
      {/* 1. Narrative Banner */}
      <NarrativeBanner variant={banner.variant}>
        <span className="font-medium text-foreground">Today:</span>{" "}
        {hasEvents
          ? pendingEvents.length > 0
            ? `${pendingEvents.length} event${pendingEvents.length !== 1 ? "s" : ""} pending review. ${attributedEvents.length} attributed.`
            : attributedEvents.length > 0
              ? `${attributedEvents.length} event${attributedEvents.length !== 1 ? "s" : ""} attributed. Review is up to date.`
              : `${events.length} outcome events detected. Start reviewing to learn what worked.`
          : banner.text}
      </NarrativeBanner>

      {/* 2. Needs Attention */}
      {attention.length > 0 && (
        <div>
          <SectionHeader
            title="Needs Attention"
            count={attention.length}
          />
          <TriageList items={attention} />
        </div>
      )}

      {/* 2b. Pending Events */}
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
                    {r.event.trigger_date} · {r.candidate_count} candidate{r.candidate_count !== 1 ? "s" : ""}
                  </p>
                </div>
                <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0 ml-2" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 3. What Worked (event-aware wins) */}
      {attributedEvents.length > 0 && (
        <div>
          <SectionHeader title="What Worked" href="/diagnostics" linkLabel="Full diagnostics" />
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

      {/* 3b. Legacy wins (for seed data / non-event scenarios) */}
      {!hasEvents && wins.length > 0 && (
        <div>
          <SectionHeader title="Wins" href="/results" />
          <WinsList items={wins} />
        </div>
      )}

      {/* 4. In Motion + Waiting (two-column) */}
      {(inMotion.length > 0 || waiting.length > 0) && (
        <div className="grid gap-8 lg:grid-cols-2">
          {inMotion.length > 0 && (
            <div>
              <SectionHeader
                title="In Motion"
                count={inMotion.length}
              />
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

      {/* 5. Risks */}
      {risks.length > 0 && (
        <div>
          <SectionHeader title="Risks" count={risks.length} />
          <RiskList items={risks} />
        </div>
      )}

      {/* 6. Stats row */}
      <div className="border-t border-border pt-6">
        <div className={`grid gap-3 grid-cols-2 ${hasEvents ? "lg:grid-cols-6" : "lg:grid-cols-4"}`}>
          {hasEvents && (
            <>
              <StatCard label="Outcome Events" value={eventIntel.total_events} />
              <StatCard label="Resolution Rate" value={`${eventIntel.resolution_rate}%`} />
            </>
          )}
          <StatCard
            label="Active Opportunities"
            value={activeOpportunities.length}
          />
          <StatCard
            label="Total Results"
            value={results.length}
          />
          <StatCard
            label="Total Changes"
            value={changelogEntries.length}
          />
          <StatCard
            label={hasEvents ? "Changes with Evidence" : "Changes This Week"}
            value={hasEvents ? eventIntel.changes_with_evidence : (latestWeek?.changes_count ?? 0)}
          />
        </div>
      </div>

      {/* 7. Loop Health */}
      <LoopHealthBar health={loopHealth} />
    </div>
  );
}
