/**
 * Section 7 C7a (2026-05-16) — Off-Site Authority detection projection,
 * pure compute helper.
 *
 * Deterministic. Takes ALL inputs as arguments. Imports NO helpers (no
 * `getBusinessConfig`, no `isPlaceholderConfig`, no `readLocalReviews`,
 * no connector-token reads, no tenant-context, no `getRepository`).
 * Pinned by
 * `tests/architecture/off-site-authority-pure-module-purity.test.ts`.
 *
 * Tenant-scope reality (carried verbatim into `data_sources_note`):
 *   - business-config is tenant-scoped (MT-1+): the loader resolves it
 *     per request for the active tenant.
 *   - connector-tokens are tenant-scoped (since 2026-05-16): stored per
 *     (tenant, provider) in Supabase.
 *   - local-reviews IS request-scoped per tenant via the persistence
 *     layer's tenant-slug resolver.
 *   - industry_directory + local_press have no automated detection yet;
 *     they surface only from operator-configured profile URLs (else
 *     inferred/unknown).
 *
 * Section 7 invariant #6: `is_local_service` gates Section 7 customer
 * surfaces (C7d Today tile + C7e Recommendations section, now shipped).
 * C7a's operator diagnostic still renders for non-local-service tenants
 * but shows a "not classified" notice instead of the channel table.
 *
 * Section 7 invariant #3: no causal/scary language in customer copy;
 * the operator page rendering this output also avoids the "missing"
 * framing (use "Beacon did not find a confirmed profile").
 */

import type {
  OffSiteChannelState,
  OffSitePresenceChannel,
  OffSitePresenceConfidence,
  OffSitePresenceSnapshot,
  OffSitePresenceSource,
} from "./types";

// ─────────────────────────────────────────────────────────────────────
// Argument shapes (kept local so the pure module never imports
// `BusinessConfig`, `LocalReview`, `GoogleConnectorToken`, etc. from
// the global helper modules — see `pure-module-purity` invariant).
// ─────────────────────────────────────────────────────────────────────

export type ComputeBusinessConfigInput = {
  name: string;
  industry: string;
  yelpBusinessId: string;
  locations: ReadonlyArray<string>;
  /**
   * Section 7 C7g v1 (2026-05-16) — operator-entered off-site
   * profile URLs. Empty string = not configured; non-empty value
   * MUST be http(s) per `operatorVouchedProfileUrl` validation.
   */
  houzzProfileUrl: string;
  angiProfileUrl: string;
  bbbProfileUrl: string;
  industryDirectoryProfileUrl: string;
};

export type ComputeLocalReviewInput = {
  source: "google" | "yelp" | "bbb" | "houzz" | "other";
  rating: number;
};

export type ComputeConnectorTokenInput = {
  provider: "google" | "yelp";
} | null;

export type ComputeOffSitePresenceSnapshotArgs = {
  tenantId: string;
  brandName: string | null;
  businessConfig: ComputeBusinessConfigInput;
  /** Resolved by the loader via `isPlaceholderConfig`. */
  businessConfigIsPlaceholder: boolean;
  localReviews: ReadonlyArray<ComputeLocalReviewInput>;
  googleToken: ComputeConnectorTokenInput;
  yelpToken: ComputeConnectorTokenInput;
  /** UTC instant used for `last_checked_at` + `generated_at`. */
  now: Date;
};

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

/**
 * Deterministic render order. Stable for screenshots + tests.
 */
const CHANNEL_ORDER: ReadonlyArray<OffSitePresenceChannel> = [
  "gbp",
  "yelp",
  "houzz",
  "angi",
  "bbb",
  "industry_directory",
  "local_press",
];

const ALWAYS_INCLUDED_NOTES: ReadonlyArray<string> = [
  "business-config: tenant-scoped — resolved per request for the active tenant.",
  "connector-tokens: tenant-scoped — stored per (tenant, provider) in Supabase.",
  "local-reviews: request-scoped per tenant via the persistence-layer tenant-slug resolver.",
  "industry directory and local press: detected only from operator-configured profile URLs; no automated detection yet.",
];

const PLACEHOLDER_NOTE =
  "business-config is the neutral placeholder (no tenant config loaded).";

// ─────────────────────────────────────────────────────────────────────
// Helpers (pure)
// ─────────────────────────────────────────────────────────────────────

function aggregateReviews(
  reviews: ReadonlyArray<ComputeLocalReviewInput>,
  source: "google" | "yelp",
): { count: number | null; rating: number | null } {
  let sum = 0;
  let n = 0;
  for (const r of reviews) {
    if (r.source !== source) continue;
    sum += r.rating;
    n += 1;
  }
  if (n === 0) return { count: null, rating: null };
  return { count: n, rating: Math.round((sum / n) * 10) / 10 };
}

function confidenceForClaimed(
  claimed: boolean,
  reviewCount: number | null,
): OffSitePresenceConfidence {
  if (!claimed) return "low";
  if (reviewCount != null && reviewCount >= 1) return "high";
  return "medium";
}

function buildGbpRow(
  args: ComputeOffSitePresenceSnapshotArgs,
  isoNow: string,
): OffSiteChannelState {
  const claimed = args.googleToken != null;
  const agg = aggregateReviews(args.localReviews, "google");
  const source: OffSitePresenceSource = args.googleToken
    ? "connector_api"
    : "inferred";
  return {
    channel: "gbp",
    claimed,
    review_count: agg.count,
    rating: agg.rating,
    profile_url: null,
    source,
    last_checked_at: isoNow,
    confidence: confidenceForClaimed(claimed, agg.count),
  };
}

function buildYelpRow(
  args: ComputeOffSitePresenceSnapshotArgs,
  isoNow: string,
): OffSiteChannelState {
  const hasYelpBusinessId =
    typeof args.businessConfig.yelpBusinessId === "string" &&
    args.businessConfig.yelpBusinessId.length > 0;
  const claimed = args.yelpToken != null || hasYelpBusinessId;
  const agg = aggregateReviews(args.localReviews, "yelp");
  let source: OffSitePresenceSource;
  if (args.yelpToken) source = "connector_api";
  else if (hasYelpBusinessId) source = "business_config";
  else source = "inferred";
  return {
    channel: "yelp",
    claimed,
    review_count: agg.count,
    rating: agg.rating,
    profile_url: null,
    source,
    last_checked_at: isoNow,
    confidence: confidenceForClaimed(claimed, agg.count),
  };
}

function buildInferredRow(
  channel: OffSitePresenceChannel,
  isoNow: string,
): OffSiteChannelState {
  return {
    channel,
    claimed: null,
    review_count: null,
    rating: null,
    profile_url: null,
    source: "inferred",
    last_checked_at: isoNow,
    confidence: "unknown",
  };
}

/**
 * Section 7 C7g v1 (2026-05-16) — read the operator-entered profile
 * URL for one of the four config-driven channels (Houzz / Angi /
 * BBB / industry_directory) from `ComputeBusinessConfigInput`.
 *
 * Returns the trimmed URL ONLY when it begins with `https://` or
 * `http://`. All other inputs — empty string, whitespace-only,
 * `javascript:` / `mailto:` schemes, relative paths, bare domains
 * without protocol — are rejected (return null). v1 does NOT
 * canonicalize the URL or HTTP-verify reachability; operator
 * vouches for the listing and the diagnostic renders the row at
 * `confidence: "medium"`.
 */
function operatorVouchedProfileUrl(
  channel: "houzz" | "angi" | "bbb" | "industry_directory",
  bc: ComputeBusinessConfigInput,
): string | null {
  const raw =
    channel === "houzz"
      ? bc.houzzProfileUrl
      : channel === "angi"
        ? bc.angiProfileUrl
        : channel === "bbb"
          ? bc.bbbProfileUrl
          : bc.industryDirectoryProfileUrl;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (
    !trimmed.startsWith("https://") &&
    !trimmed.startsWith("http://")
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Build a configured-channel row for one of the four operator-
 * vouched channels. `confidence: "medium"` reflects that Beacon
 * trusts the operator's input but has NOT HTTP-verified the URL
 * (v1 contract; HTTP HEAD verification is C7g v2).
 */
function buildConfiguredRow(
  channel: "houzz" | "angi" | "bbb" | "industry_directory",
  url: string,
  isoNow: string,
): OffSiteChannelState {
  return {
    channel,
    claimed: true,
    review_count: null,
    rating: null,
    profile_url: url,
    source: "business_config",
    last_checked_at: isoNow,
    confidence: "medium",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export function computeOffSitePresenceSnapshot(
  args: ComputeOffSitePresenceSnapshotArgs,
): OffSitePresenceSnapshot {
  const isoNow = args.now.toISOString();

  const isLocalService =
    typeof args.businessConfig.industry === "string" &&
    args.businessConfig.industry.length > 0 &&
    args.businessConfig.locations.length >= 1;

  const channels: OffSiteChannelState[] = [];
  for (const c of CHANNEL_ORDER) {
    if (c === "gbp") {
      channels.push(buildGbpRow(args, isoNow));
    } else if (c === "yelp") {
      channels.push(buildYelpRow(args, isoNow));
    } else if (
      c === "houzz" ||
      c === "angi" ||
      c === "bbb" ||
      c === "industry_directory"
    ) {
      // Section 7 C7g v1 — promote inferred → operator-configured
      // when a valid http(s) profile URL is set in business-config.
      // `local_press` is intentionally excluded; it stays inferred
      // because there's no profile-URL concept for press.
      const url = operatorVouchedProfileUrl(c, args.businessConfig);
      if (url != null) {
        channels.push(buildConfiguredRow(c, url, isoNow));
      } else {
        channels.push(buildInferredRow(c, isoNow));
      }
    } else {
      channels.push(buildInferredRow(c, isoNow));
    }
  }

  const data_sources_note: string[] = [...ALWAYS_INCLUDED_NOTES];
  if (args.businessConfigIsPlaceholder) {
    data_sources_note.push(PLACEHOLDER_NOTE);
  }

  return {
    tenant_id: args.tenantId,
    brand_name: args.brandName,
    is_local_service: isLocalService,
    channels,
    data_sources_note,
    generated_at: isoNow,
  };
}
