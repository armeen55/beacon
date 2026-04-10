import Link from "next/link";
import { cn } from "@/lib/utils";
import { ThreatBadge } from "@/components/display/threat-badge";
import { PLATFORM_LABELS } from "@/lib/constants";
import type { CompetitiveThreat } from "@/domains/opportunities/competitive";

type CompetitiveLandscapeProps = {
  threats: CompetitiveThreat[];
  className?: string;
};

const trendIcons: Record<string, { label: string; color: string }> = {
  improving: { label: "Gaining", color: "text-status-danger" },
  declining: { label: "Losing", color: "text-status-success" },
  stable: { label: "Stable", color: "text-muted-foreground" },
  unknown: { label: "Unknown", color: "text-muted-foreground" },
};

export function CompetitiveLandscape({ threats, className }: CompetitiveLandscapeProps) {
  if (threats.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {threats.map((threat) => {
        const trend = trendIcons[threat.trend];
        return (
          <div
            key={threat.competitor.id}
            className={cn(
              "rounded-md border border-border p-3",
              threat.isPrimary && "border-status-danger/30 bg-status-danger/5"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  href={`/competitors/${threat.competitor.id}`}
                  className="text-[13px] font-medium hover:text-accent-primary transition-colors truncate"
                >
                  {threat.competitor.name}
                </Link>
                {threat.isPrimary && (
                  <span className="text-[10px] font-medium text-muted-foreground shrink-0">
                    Primary
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ThreatBadge level={threat.threatLevel} />
              </div>
            </div>

            <div className="flex items-center gap-4 mt-2 text-[12px] text-muted-foreground">
              <span className="font-mono">
                {threat.competitor.domain}
              </span>
              {threat.latestSnapshot && (
                <>
                  {threat.latestSnapshot.visibility_rank != null && (
                    <span>
                      Rank #{threat.latestSnapshot.visibility_rank} on{" "}
                      {PLATFORM_LABELS[threat.latestSnapshot.platform]}
                    </span>
                  )}
                  {threat.latestSnapshot.citation_share != null && (
                    <span>
                      {threat.latestSnapshot.citation_share}% citation
                    </span>
                  )}
                </>
              )}
              <span className={trend.color}>
                {trend.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
