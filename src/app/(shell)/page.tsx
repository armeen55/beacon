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

  return (
    <div className="space-y-8">
      {/* 1. Narrative Banner */}
      <NarrativeBanner variant={banner.variant}>
        <span className="font-medium text-foreground">Today:</span>{" "}
        {banner.text}
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

      {/* 3. Wins */}
      {wins.length > 0 && (
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

      {/* 6. Stats row (de-emphasized) */}
      <div className="border-t border-border pt-6">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
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
            label="Changes This Week"
            value={latestWeek?.changes_count ?? 0}
          />
        </div>
      </div>

      {/* 7. Loop Health */}
      <LoopHealthBar health={loopHealth} />
    </div>
  );
}
