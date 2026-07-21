import "server-only";

import { currentTenantId } from "@/lib/tenant-context";
import {
  getBusinessConfig,
  hydrateBusinessConfigFromSupabase,
} from "@/lib/business-config";
import { buildOwnAliasSet } from "@/domains/recommendation-intelligence/profound-topic-signals";
import {
  loadSovWeeklyForTenant,
  SOV_ENGINE_PLAIN_NAME,
  MIN_PROMPTS_PER_CELL,
  compareIsoWeeks,
  type SovTrend,
  type SovDropAlert,
} from "@/domains/ai-visibility/sov-weekly";

/**
 * SoV weekly section (BEACON 500 item 79, 2026-07-02) - self-hiding section
 * for the AI visibility page (/prompts). Shows the top topics' share of the
 * answers per engine, with a trend arrow, plus any active drop alerts.
 *
 * SELF-HIDING: renders nothing (returns null) when there is no usable native-
 * poll history yet for any topic - the section never shows an empty shell.
 * This is expected on a fresh tenant (ground-truth verified 2026-07-02:
 * tenant-iranopedia's prompt_answer_observations + profound_visibility_rows
 * are both empty, so the section stays hidden there today).
 *
 * Owns its own data: resolves the tenant, business config, and the merged
 * sov-weekly table internally, so the page mounts it with a single line and
 * no extra plumbing. Read-only, no writes.
 */
export async function SovWeeklySection() {
  const tenantId = await currentTenantId();

  let ownAliases: ReadonlySet<string>;
  try {
    const businessConfig =
      (await hydrateBusinessConfigFromSupabase(tenantId)) ?? getBusinessConfig(tenantId);
    ownAliases = buildOwnAliasSet({
      brandName: businessConfig.name,
      domain: businessConfig.domain,
    });
  } catch {
    return null; // no usable config - nothing honest to show
  }
  if (ownAliases.size === 0) return null;

  const result = await loadSovWeeklyForTenant(tenantId, ownAliases).catch(() => null);
  if (!result) return null;

  const { trends, dropAlerts } = result;
  if (trends.length === 0) return null; // no native-poll history yet - stay hidden

  // Top topics: rank by whichever series has the most prompts polled this
  // week (the ones with real weight), cap the table so it stays scannable.
  const topTrends = [...trends]
    .sort((a, b) => Number(b.latestBelowFloor) - Number(a.latestBelowFloor) || a.topic.localeCompare(b.topic))
    .slice(0, 8);

  const latestWeek = [...new Set(trends.map((t) => t.latestWeekKey))].sort(compareIsoWeeks).pop() ?? null;

  return (
    <section
      className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4"
      aria-labelledby="sov-weekly-heading"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h2 id="sov-weekly-heading" className="text-[13px] font-bold tracking-tight text-foreground">
          How much of the answers you get, by engine
        </h2>
        {latestWeek ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">Week of {latestWeek}</span>
        ) : null}
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground leading-relaxed">
        For your top topics, the share of questions I asked this week where each AI engine mentioned you. Below{" "}
        {MIN_PROMPTS_PER_CELL} questions in a week, I say &ldquo;still collecting&rdquo; instead of guessing at a percent.
      </p>

      {dropAlerts.length > 0 ? (
        <div className="mb-4 space-y-2">
          {dropAlerts.slice(0, 3).map((alert) => (
            <DropAlertRow key={`${alert.engine}-${alert.topic}-${alert.weekKey}`} alert={alert} />
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground border-b border-border/50">
              <th className="py-1.5 pr-3 font-medium">Topic</th>
              <th className="py-1.5 pr-3 font-medium">Engine</th>
              <th className="py-1.5 pr-3 font-medium">This week</th>
              <th className="py-1.5 pr-3 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {topTrends.map((t) => (
              <TrendRow key={`${t.engine}-${t.topic}`} trend={t} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
        Source: your connected AI engines (native poll). When I have separate AI answer tracking data for the same
        topic I show it separately below, since it measures share of voice differently and the two numbers are not
        the same thing.
      </p>
      <ProfoundFootnote merged={result.merged} />
    </section>
  );
}

function TrendRow({ trend }: { trend: SovTrend }) {
  const engineName = SOV_ENGINE_PLAIN_NAME[trend.engine];
  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-1.5 pr-3 text-foreground">{trend.topic}</td>
      <td className="py-1.5 pr-3 text-muted-foreground">{engineName}</td>
      <td className="py-1.5 pr-3 tabular-nums">
        {trend.latestBelowFloor ? (
          <span className="text-muted-foreground">still collecting</span>
        ) : (
          <span className="font-semibold text-foreground">{Math.round(trend.latestShare * 100)}%</span>
        )}
      </td>
      <td className="py-1.5 pr-3 tabular-nums">
        <TrendPhrase points={trend.weekOverWeekPoints} phrase={trend.trendPhrase} />
      </td>
    </tr>
  );
}

function TrendPhrase({ points, phrase }: { points: number | null; phrase: string }) {
  if (points === null) return <span className="text-muted-foreground">{phrase}</span>;
  if (points > 0) return <span className="text-status-success">{phrase}</span>;
  if (points < 0) return <span className="text-status-danger">{phrase}</span>;
  return <span className="text-muted-foreground">{phrase}</span>;
}

function DropAlertRow({ alert }: { alert: SovDropAlert }) {
  return (
    <div className="rounded-md border border-status-danger/25 bg-status-danger/[0.03] px-3 py-2.5">
      <p className="text-[12px] font-medium text-status-danger leading-snug">{alert.headline}</p>
    </div>
  );
}

/** Profound's own per-topic share-of-voice reading, when synced rows exist
 *  for the same topic. Explicitly separate from the native table above -
 *  never blended into the same percentage. */
function ProfoundFootnote({ merged }: { merged: import("@/domains/ai-visibility/sov-weekly").MergedTopicWeek[] }) {
  const withProfound = merged.filter((m) => m.profound !== null).slice(0, 4);
  if (withProfound.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-border/40 bg-surface-inset/20 px-3 py-2.5">
      <p className="text-[11px] font-medium text-foreground mb-1">AI answer tracking reading (different metric)</p>
      <ul className="space-y-1">
        {withProfound.map((m) => (
          <li key={`${m.topic}-${m.weekKey}`} className="text-[11px] text-muted-foreground">
            {m.topic}: you are {Math.round((m.profound?.ownShareOfVoice ?? 0) * 100)}% of tracked AI answers
            {m.profound?.topCompetitor
              ? `, ${m.profound.topCompetitor.assetName} is ${Math.round(m.profound.topCompetitor.shareOfVoice * 100)}%`
              : ""}
            .
          </li>
        ))}
      </ul>
    </div>
  );
}
