/**
 * Today "Off-site authority" tile render contract — Section 7 C7d
 * (2026-05-22).
 *
 * Pins:
 *   • is_local_service gate — renders nothing for non-local-service.
 *   • Positive presence: claimed===true channels render with
 *     "Connected" (connector_api) / "Configured" (business_config).
 *   • Review count + rating render ONLY for GBP/Yelp at high confidence.
 *   • "Worth a manual review" lists ONLY non-policy-risk candidates
 *     (claim_gbp / claim_or_optimize_yelp / optimize_gbp_profile).
 *   • request_gbp_reviews + pursue_local_pr are NEVER rendered.
 *   • Raw profile URLs are never rendered.
 *   • No "missing" framing; claimed===false channels are simply omitted.
 *   • Renders nothing when there's no useful off-site signal.
 *
 * Server-rendered via `renderToStaticMarkup` (parity with the other
 * Today tile tests).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OffSiteAuthorityTile } from "@/components/today/off-site-authority-tile";
import type {
  OffSiteChannelState,
  OffSitePresenceChannel,
  OffSitePresenceConfidence,
  OffSitePresenceSnapshot,
  OffSitePresenceSource,
} from "@/domains/off-site-authority/types";
import type {
  OffSiteCandidateAction,
  OffSiteCandidateConfidence,
} from "@/domains/off-site-authority/recommendation-rules";
import type { ActionType } from "@/domains/recommendations/action-types";

const ISO = "2026-05-22T00:00:00.000Z";

function channel(
  ch: OffSitePresenceChannel,
  opts: {
    claimed: boolean | null;
    source: OffSitePresenceSource;
    confidence: OffSitePresenceConfidence;
    review_count?: number | null;
    rating?: number | null;
    profile_url?: string | null;
  },
): OffSiteChannelState {
  return {
    channel: ch,
    claimed: opts.claimed,
    review_count: opts.review_count ?? null,
    rating: opts.rating ?? null,
    profile_url: opts.profile_url ?? null,
    source: opts.source,
    last_checked_at: ISO,
    confidence: opts.confidence,
  };
}

function snapshot(
  isLocalService: boolean,
  channels: OffSiteChannelState[],
): OffSitePresenceSnapshot {
  return {
    tenant_id: "tenant-test",
    brand_name: "Test Brand",
    is_local_service: isLocalService,
    channels,
    data_sources_note: [],
    generated_at: ISO,
  };
}

function candidate(
  actionType: ActionType,
  ch: OffSitePresenceChannel,
  opts: { title: string; policy_risk: boolean; confidence?: OffSiteCandidateConfidence },
): OffSiteCandidateAction {
  return {
    id: `${ch}:${actionType}`,
    actionType,
    channel: ch,
    title: opts.title,
    rationale: "Operator-safe rationale.",
    confidence: opts.confidence ?? "medium",
    source_note: `Channel "${ch}".`,
    manual_only: true,
    policy_risk: opts.policy_risk,
  };
}

function render(
  snap: OffSitePresenceSnapshot | null,
  candidates: OffSiteCandidateAction[],
): string {
  return renderToStaticMarkup(
    <OffSiteAuthorityTile snapshot={snap} candidates={candidates} />,
  );
}

describe("OffSiteAuthorityTile (Section 7 C7d)", () => {
  it("renders nothing when snapshot is null", () => {
    expect(render(null, [])).toBe("");
  });

  it("renders nothing when is_local_service === false", () => {
    const snap = snapshot(false, [
      channel("gbp", { claimed: true, source: "connector_api", confidence: "high", review_count: 12, rating: 4.8 }),
    ]);
    const cands = [candidate("claim_gbp", "gbp", { title: "Claim your Google Business Profile", policy_risk: false })];
    expect(render(snap, cands)).toBe("");
  });

  it("renders nothing when there is no useful off-site signal", () => {
    // is_local_service true, but no claimed channels and no allowed candidates.
    const snap = snapshot(true, [
      channel("gbp", { claimed: false, source: "inferred", confidence: "low" }),
    ]);
    expect(render(snap, [])).toBe("");
  });

  it("renders connected (connector_api) and configured (business_config) channels", () => {
    const snap = snapshot(true, [
      channel("gbp", { claimed: true, source: "connector_api", confidence: "medium" }),
      channel("yelp", { claimed: true, source: "business_config", confidence: "low" }),
      channel("houzz", { claimed: null, source: "inferred", confidence: "unknown" }),
    ]);
    const html = render(snap, []);
    expect(html).toContain("Off-site authority");
    expect(html).toContain('data-off-site-channel="gbp"');
    expect(html).toContain('data-off-site-channel="yelp"');
    expect(html).toContain("Google Business Profile");
    expect(html).toContain("Connected");
    expect(html).toContain("Configured");
    // Unclaimed/unknown channel is omitted (no deficiency framing).
    expect(html).not.toContain('data-off-site-channel="houzz"');
  });

  it("shows review count + rating only for high-confidence GBP/Yelp", () => {
    const high = snapshot(true, [
      channel("gbp", { claimed: true, source: "connector_api", confidence: "high", review_count: 12, rating: 4.8 }),
    ]);
    const highHtml = render(high, []);
    expect(highHtml).toContain("12 reviews");
    expect(highHtml).toContain("4.8");

    const medium = snapshot(true, [
      channel("gbp", { claimed: true, source: "connector_api", confidence: "medium", review_count: 12, rating: 4.8 }),
    ]);
    const mediumHtml = render(medium, []);
    expect(mediumHtml).not.toContain("12 reviews");
  });

  it("lists non-policy-risk review opportunities", () => {
    const snap = snapshot(true, [
      channel("gbp", { claimed: false, source: "inferred", confidence: "low" }),
    ]);
    const cands = [
      candidate("claim_gbp", "gbp", { title: "Claim your Google Business Profile", policy_risk: false }),
      candidate("claim_or_optimize_yelp", "yelp", { title: "Claim or improve your Yelp profile", policy_risk: false }),
      candidate("optimize_gbp_profile", "gbp", { title: "Review your Google Business Profile details", policy_risk: false }),
    ];
    const html = render(snap, cands);
    expect(html).toContain("Worth a manual review");
    expect(html).toContain('data-off-site-review-op="claim_gbp"');
    expect(html).toContain('data-off-site-review-op="claim_or_optimize_yelp"');
    expect(html).toContain('data-off-site-review-op="optimize_gbp_profile"');
    expect(html).toContain("Claim your Google Business Profile");
  });

  it("never renders request_gbp_reviews even when present as a candidate", () => {
    const snap = snapshot(true, [
      channel("gbp", { claimed: true, source: "connector_api", confidence: "medium" }),
    ]);
    const cands = [
      candidate("request_gbp_reviews", "gbp", { title: "Encourage new Google reviews", policy_risk: true }),
    ];
    const html = render(snap, cands);
    expect(html).not.toContain('data-off-site-review-op="request_gbp_reviews"');
    expect(html).not.toContain("Encourage new Google reviews");
    // The connected channel still renders (positive presence).
    expect(html).toContain('data-off-site-channel="gbp"');
  });

  it("never renders pursue_local_pr even when present as a candidate", () => {
    const snap = snapshot(true, [
      channel("gbp", { claimed: true, source: "connector_api", confidence: "medium" }),
    ]);
    const cands = [
      candidate("pursue_local_pr", "local_press", { title: "Pursue local press coverage", policy_risk: true }),
    ];
    const html = render(snap, cands);
    expect(html).not.toContain('data-off-site-review-op="pursue_local_pr"');
    expect(html).not.toContain("Pursue local press coverage");
  });

  it("never renders a raw profile URL", () => {
    const snap = snapshot(true, [
      channel("houzz", {
        claimed: true,
        source: "business_config",
        confidence: "medium",
        profile_url: "https://www.houzz.com/pro/test-brand",
      }),
    ]);
    const html = render(snap, []);
    expect(html).toContain('data-off-site-channel="houzz"');
    expect(html).not.toContain("houzz.com/pro");
    expect(html).not.toContain("https://");
  });

  it("never uses the scary 'missing' framing", () => {
    const snap = snapshot(true, [
      channel("gbp", { claimed: false, source: "inferred", confidence: "low" }),
      channel("yelp", { claimed: true, source: "business_config", confidence: "low" }),
    ]);
    const cands = [
      candidate("claim_gbp", "gbp", { title: "Claim your Google Business Profile", policy_risk: false }),
    ];
    const html = render(snap, cands).toLowerCase();
    expect(html).not.toContain("missing");
    expect(html).not.toContain("we checked");
  });
});
