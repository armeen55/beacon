/**
 * Today "Off-site authority" tile — Section 7 C7d (2026-05-22).
 *
 * The first CUSTOMER-FACING off-site surface. Read-only. Summarizes the
 * tenant's off-site presence (the profiles + directories that sit beyond
 * their own website) using the now-tenant-correct off-site detection
 * snapshot (MT-2 made `loadOffSitePresenceSnapshot` resolve per-tenant).
 *
 * Pure presentation. No hooks, no interactivity, no Accept/Defer/Dismiss
 * actions — off-site rows stay `diagnostic_only` (locked
 * `recommendation-intelligence-offsite-contract`); this tile never
 * promotes anything into the recommendation queue.
 *
 * Safety contract (pinned by
 * `tests/architecture/off-site-customer-tile-safe-copy.test.ts` +
 * `tests/architecture/off-site-customer-tile-no-queue.test.ts`):
 *   • Renders NOTHING when `is_local_service === false`.
 *   • Positive/neutral framing only. NEVER "missing", "we checked",
 *     "automatically", "request reviews now", "improve rankings", or
 *     revenue/lead causal language.
 *   • Surfaces ONLY non-policy-risk review opportunities
 *     (claim_gbp / claim_or_optimize_yelp / optimize_gbp_profile).
 *     request_gbp_reviews + pursue_local_pr are EXCLUDED (operator-only).
 *   • Never renders raw profile URLs.
 *   • `claimed === false` / `null` channels are simply omitted from the
 *     "connected profiles" list — never framed as a deficiency.
 */

import type {
  OffSiteChannelState,
  OffSitePresenceChannel,
  OffSitePresenceSnapshot,
} from "@/domains/off-site-authority/types";
import type { OffSiteCandidateAction } from "@/domains/off-site-authority/recommendation-rules";
import type { ActionType } from "@/domains/recommendations/action-types";

/**
 * All customer-visible heading copy lives in string constants (not raw
 * JSX text) so the safe-copy invariant's literal extractor reliably
 * scans every visible phrase. Positive/neutral framing only.
 */
const COPY = {
  heading: "Off-site authority",
  subtitle: "Your presence on local profiles and directories.",
  connectedHeading: "Connected profiles",
  reviewHeading: "Worth a manual review",
} as const;

const CHANNEL_DISPLAY_NAMES: Record<OffSitePresenceChannel, string> = {
  gbp: "Google Business Profile",
  yelp: "Yelp",
  houzz: "Houzz",
  angi: "Angi",
  bbb: "Better Business Bureau",
  industry_directory: "Industry directory",
  local_press: "Local press",
};

/**
 * Only these non-policy-risk off-site actions surface on the customer
 * tile. `request_gbp_reviews` (review-solicitation policy) and
 * `pursue_local_pr` (PR-outreach policy) are intentionally excluded —
 * they stay operator-only. Positive allowlist so the tile never even
 * names a policy-risk action.
 */
const ALLOWED_REVIEW_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "claim_gbp",
  "claim_or_optimize_yelp",
  "optimize_gbp_profile",
]);

/** Caller passes only `claimed === true` channels here. */
function presenceLabel(channel: OffSiteChannelState): string {
  return channel.source === "connector_api" ? "Connected" : "Configured";
}

/** Review count + rating shown ONLY for GBP/Yelp at high confidence. */
function reviewMetricLabel(channel: OffSiteChannelState): string | null {
  if (
    (channel.channel === "gbp" || channel.channel === "yelp") &&
    channel.confidence === "high" &&
    channel.review_count != null
  ) {
    const rating = channel.rating != null ? ` · ${channel.rating}★` : "";
    return `${channel.review_count} reviews${rating}`;
  }
  return null;
}

export type OffSiteAuthorityTileProps = {
  /** Tenant-correct snapshot from `loadOffSitePresenceSnapshot` (MT-2).
   *  `null` on loader soft-fail → tile renders nothing. */
  snapshot: OffSitePresenceSnapshot | null;
  /** Operator-rule candidates; the tile filters to the safe allowlist. */
  candidates: readonly OffSiteCandidateAction[];
};

export function OffSiteAuthorityTile({
  snapshot,
  candidates,
}: OffSiteAuthorityTileProps) {
  // is_local_service gate — render nothing for non-local-service tenants
  // (and on loader soft-fail / placeholder config).
  if (snapshot == null || !snapshot.is_local_service) return null;

  const connected = snapshot.channels.filter((c) => c.claimed === true);
  const reviewOpportunities = candidates.filter(
    (c) => ALLOWED_REVIEW_ACTIONS.has(c.actionType) && c.policy_risk === false,
  );

  // No useful off-site signal → render nothing (avoid Today noise).
  if (connected.length === 0 && reviewOpportunities.length === 0) return null;

  return (
    <section
      data-today-off-site-tile="true"
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-4"
      aria-labelledby="off-site-authority-heading"
    >
      <h3
        id="off-site-authority-heading"
        className="text-sm font-medium text-foreground"
      >
        {COPY.heading}
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{COPY.subtitle}</p>

      {connected.length > 0 ? (
        <div className="mt-3" data-off-site-section="connected">
          <p className="text-xs font-medium text-muted-foreground">
            {COPY.connectedHeading}
          </p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {connected.map((c) => {
              const metric = reviewMetricLabel(c);
              return (
                <li
                  key={c.channel}
                  data-off-site-channel={c.channel}
                  className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-foreground"
                >
                  <span className="font-medium">
                    {CHANNEL_DISPLAY_NAMES[c.channel]}
                  </span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {presenceLabel(c)}
                  </span>
                  {metric ? (
                    <span className="text-muted-foreground">
                      {" · "}
                      {metric}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {reviewOpportunities.length > 0 ? (
        <div className="mt-3" data-off-site-section="review-opportunities">
          <p className="text-xs font-medium text-muted-foreground">
            {COPY.reviewHeading}
          </p>
          <ul className="mt-1 space-y-1">
            {reviewOpportunities.map((op) => (
              <li
                key={op.id}
                data-off-site-review-op={op.actionType}
                className="text-xs text-foreground"
              >
                {op.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
