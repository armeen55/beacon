/**
 * Connector failure streak trigger (BEACON_500 item 84, 2026-07-03) -
 * predicate `connector_failure_streak`.
 *
 * THE GAP: a connected data source (Google Search Console, Google Analytics,
 * Clarity, Profound) has failed to sync for 3+ consecutive nights. The
 * operator otherwise only finds this out by noticing stale numbers days
 * later. `deriveProviderStreaks` (cron-streak.ts) already does the honest
 * consecutive-nights fold over the `cron_runs` ledger's per-source results -
 * this predicate is a thin, pure wrapper that turns each streak at or above
 * the alert threshold into a `RecommendationCandidateRow`, mirroring
 * sov-drop-alert.ts's exact "pure wrapper over pre-computed input" shape.
 *
 * THE PLAY: `watch` - a non-pushable, page-level directive action (like
 * profound-aeo-gap and sov-drop-alert use `add_answer_block` for their
 * topic-level, non-page-specific signals). Reconnecting a data source is not
 * a page edit; `watch` is the closest registered action that requires
 * neither current nor proposed text. Anchored on the site root (same
 * site-root anchoring convention those two triggers use for tenant-level,
 * non-page-specific issues) since a connector problem has no single owned
 * URL.
 *
 * ONE emission per (tenant, provider) streak at or above the threshold,
 * worst streak first. Card copy names the real provider, the exact night
 * count, and the real last-seen error, via `connectorFailureStreakCopy`
 * (no dashes).
 *
 * PURE FUNCTION over pre-loaded streaks.
 */

import { cooldownKey } from "../emitter/cooldown-key";
import { dedupeKey } from "../emitter/dedupe-key";
import type { RecommendationCandidateRow } from "../emitter/candidate-row";
import { connectorFailureStreakCopy } from "../customer-copy-templates";
import type { ProviderStreak } from "@/domains/ops/cron-streak";
import { FAILURE_STREAK_ALERT_THRESHOLD } from "@/domains/ops/cron-streak";

const PROVIDER_PLAIN_NAME: Record<string, string> = {
  google_gsc: "Google Search Console",
  google_ga4: "Google Analytics",
  google_gbp: "Google Business Profile",
  clarity: "Microsoft Clarity",
  profound: "Profound",
  yelp: "Yelp",
  wix: "Wix",
  callrail: "CallRail",
};

function plainName(provider: string): string {
  return PROVIDER_PLAIN_NAME[provider] ?? provider;
}

export type ConnectorFailureStreakInput = {
  tenantId: string;
  /** Pre-computed streaks from cron-streak.ts, ALREADY FILTERED to this
   *  tenant's own rows (this predicate does not filter by tenant itself -
   *  callers pass streaksAtOrAboveThreshold(...).filter(s => s.tenantId ===
   *  tenantId) so a fleet-wide streak list never leaks another tenant's
   *  provider issue onto this tenant's queue). */
  streaks: ReadonlyArray<ProviderStreak>;
  /** Site-root URL to anchor the card on, null when no configured domain
   *  (predicate then abstains - queue rules require a URL for this
   *  on-site-anchored action). */
  siteRootUrl: string | null;
  signalAt: string;
  /** Deep link path to the reconnect surface, named in the copy indirectly
   *  (the copy says "your connections page"; this is carried in evidence for
   *  the operator diagnostic and can be surfaced by the UI). Defaults to
   *  /settings/connectors. */
  reconnectPath?: string;
};

const DEFAULT_RECONNECT_PATH = "/settings/connectors";

/**
 * @no-classifier-required: tenant-level connector health, not page-scoped.
 * The unit is a (tenant, provider) sync streak, so emission anchors to the
 * always-HTML site root - neither `classifyPageType` nor `isNonHtmlAsset`
 * applies. Same sanctioned opt-out profound-aeo-gap.ts / sov-drop-alert.ts use.
 */
export function connectorFailureStreak(
  input: ConnectorFailureStreakInput,
): RecommendationCandidateRow[] {
  const { tenantId, streaks, siteRootUrl, signalAt } = input;
  if (siteRootUrl == null || siteRootUrl.length === 0) return [];
  const reconnectPath = input.reconnectPath ?? DEFAULT_RECONNECT_PATH;

  const eligible = streaks
    .filter((s) => s.tenantId === tenantId && s.consecutiveFailures >= FAILURE_STREAK_ALERT_THRESHOLD)
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);

  const actionType = "watch" as const;
  const targetUrl = siteRootUrl;

  return eligible.map((streak) => {
    const label = plainName(streak.provider);
    const topicClusterLabel = `connector_failure_streak:${streak.provider}`;
    const realError = streak.lastFailureDetail ?? "no detail recorded";

    return {
      tenant_id: tenantId,
      trigger_signal: "connector_failure_streak",
      action_type: actionType,
      generator_kind: "deterministic",
      target_url: targetUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "business_config",
          ref: `connector_failure_streak:${streak.provider}`,
          detail:
            "connector_failure_streak provider=" +
            streak.provider +
            "; consecutive_failures=" +
            streak.consecutiveFailures +
            "; last_run_at=" +
            (streak.lastRunAt ?? "unknown") +
            "; last_failure_detail=" +
            realError +
            "; reconnect_path=" +
            reconnectPath,
        },
      ],
      confidence: streak.consecutiveFailures >= FAILURE_STREAK_ALERT_THRESHOLD + 2 ? "high" : "medium",
      impact_estimate: "high",
      customer_copy: connectorFailureStreakCopy(label, streak.consecutiveFailures, realError),
      operator_evidence:
        `provider=${streak.provider} consecutive_failures=${streak.consecutiveFailures} ` +
        `last_run_at=${streak.lastRunAt ?? "unknown"} detail=${realError}`,
      dedupe_key: dedupeKey({
        tenantId,
        actionType,
        targetUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId, actionType, targetUrl }),
      created_from_signal_at: signalAt,
      safety_flags: [],
    };
  });
}
