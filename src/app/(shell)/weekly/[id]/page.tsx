import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusDot } from "@/components/display/status-dot";
import { DeltaIndicator } from "@/components/display/delta-indicator";
import { ChangeVerdictBadge } from "@/components/display/change-verdict-badge";
import { ConfidenceBadge } from "@/components/display/confidence-badge";
import { EntityLinkCard } from "@/components/data/entity-link-card";
import { weeklySummaries, opportunities, results as allResults } from "@/lib/seed-data.server";
import { getChangesForWeek, getResultsForWeek } from "@/lib/lookups";
import {
  computeChangeVerdict,
  computeAttribution,
} from "@/domains/attribution/compute";
import { changelogEntries } from "@/lib/seed-data.server";
import {
  SIGNAL_TYPE_LABELS,
  PLATFORM_LABELS,
  METRIC_TYPE_LABELS,
  METRIC_DIRECTION,
} from "@/lib/constants";

export default async function WeeklyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const week = weeklySummaries.find((w) => w.id === id);
  if (!week) notFound();

  const topOpps = opportunities.filter((o) =>
    week.top_opportunities.includes(o.id)
  );
  const changesThisWeek = getChangesForWeek(week.id);
  const resultsThisWeek = getResultsForWeek(week.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{week.title}</h2>
        <div className="flex items-center gap-3 mt-2">
          <StatusDot
            status={week.status === "published" ? "success" : "neutral"}
            label={week.status === "published" ? "Published" : "Draft"}
          />
          <span className="text-[12px] text-muted-foreground">
            {new Date(week.week_start).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            –{" "}
            {new Date(week.week_end).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span className="text-[12px] text-muted-foreground">
            · {week.changes_count} changes
          </span>
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-semibold mb-2">Highlights</h3>
        <p className="text-[13px] text-foreground-secondary leading-relaxed">
          {week.highlights}
        </p>
      </div>

      {week.lowlights && (
        <div>
          <h3 className="text-[13px] font-semibold mb-2">Lowlights</h3>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {week.lowlights}
          </p>
        </div>
      )}

      <div className="border-t border-border pt-5">
        <h3 className="text-[13px] font-semibold mb-3">Key Metric Deltas</h3>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(week.key_metric_deltas).map(([key, value]) => (
            <div
              key={key}
              className="rounded-md border border-border p-3 flex items-center justify-between"
            >
              <span className="text-[12px] text-muted-foreground capitalize">
                {key.replace(/_/g, " ")}
              </span>
              <span
                className={`text-[13px] font-semibold tabular-nums ${
                  value > 0
                    ? "text-status-success"
                    : value < 0
                      ? "text-status-danger"
                      : "text-muted-foreground"
                }`}
              >
                {value > 0 ? "+" : ""}
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {topOpps.length > 0 && (
        <div className="border-t border-border pt-5">
          <h3 className="text-[13px] font-semibold mb-2">
            Top Opportunities This Week
          </h3>
          <div className="space-y-2">
            {topOpps.map((opp) => (
              <EntityLinkCard
                key={opp.id}
                type="opportunity"
                href={`/opportunities/${opp.id}`}
                title={opp.title}
                meta={opp.topic}
              />
            ))}
          </div>
        </div>
      )}

      {changesThisWeek.length > 0 && (
        <div className="border-t border-border pt-5">
          <h3 className="text-[13px] font-semibold mb-2">
            Changes This Week
          </h3>
          <div className="space-y-2">
            {changesThisWeek.map((change) => {
              const verdict = computeChangeVerdict(
                change,
                allResults,
                opportunities
              );
              return (
                <Link
                  key={change.id}
                  href={`/changes/${change.id}`}
                  className="block rounded-md border border-border p-3 hover:border-accent-primary/30 transition-colors"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-foreground-secondary uppercase tracking-wider">
                        Change
                      </span>
                      <span className="text-border">·</span>
                      <span className="text-[11px] text-muted-foreground">
                        {SIGNAL_TYPE_LABELS[change.signal_type]}
                      </span>
                    </div>
                    <ChangeVerdictBadge verdict={verdict.verdict} />
                  </div>
                  <p className="text-[13px] font-medium">{change.asset_name}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-1">
                    {change.change_description}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {resultsThisWeek.length > 0 && (
        <div className="border-t border-border pt-5">
          <h3 className="text-[13px] font-semibold mb-2">
            Results This Week
          </h3>
          <div className="space-y-2">
            {resultsThisWeek.map((result) => {
              const isInverted =
                METRIC_DIRECTION[result.metric_type] === "lower_is_better";
              const linkedChanges = changelogEntries.filter((c) =>
                result.attributed_changelog_ids.includes(c.id)
              );
              const primaryChange = linkedChanges[0] ?? null;
              const attribution = primaryChange
                ? computeAttribution(primaryChange, result, opportunities)
                : null;

              return (
                <Link
                  key={result.id}
                  href={`/results/${result.id}`}
                  className="block rounded-md border border-border p-3 hover:border-accent-primary/30 transition-colors"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-status-success uppercase tracking-wider">
                        Result
                      </span>
                      <span className="text-border">·</span>
                      <span className="text-[11px] text-muted-foreground">
                        {PLATFORM_LABELS[result.platform]}
                      </span>
                    </div>
                    <DeltaIndicator
                      value={result.delta_percentage}
                      invertColor={isInverted}
                    />
                  </div>
                  <p className="text-[13px] font-medium">
                    {METRIC_TYPE_LABELS[result.metric_type]}
                  </p>
                  <div className="mt-1">
                    {attribution ? (
                      <ConfidenceBadge
                        confidence={attribution.confidence}
                        explanation={attribution.explanation}
                      />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        No attributed changes
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {week.recommendations && (
        <div className="border-t border-border pt-5">
          <h3 className="text-[13px] font-semibold mb-2">
            Recommendations for Next Week
          </h3>
          <p className="text-[13px] text-foreground-secondary leading-relaxed bg-surface-inset rounded-md p-3">
            {week.recommendations}
          </p>
        </div>
      )}
    </div>
  );
}
