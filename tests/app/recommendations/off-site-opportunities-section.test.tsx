/**
 * Recommendations "Off-site opportunities" section render contract —
 * Section 7 C7e (2026-05-22).
 *
 * The section is an async server component that loads the tenant-correct
 * off-site snapshot, derives candidates via the REAL pure rule engine
 * (only the I/O loader is mocked), and reuses the C7d
 * `OffSiteAuthorityTile` for presentation.
 *
 * Pins:
 *   • is_local_service gate — renders nothing for non-local-service.
 *   • Soft-fail — loader throw → renders nothing.
 *   • Defensive empty gate — no connected channels + no review
 *     opportunities → renders nothing (no empty labeled wrapper).
 *   • Positive path — renders the "Off-site opportunities" context
 *     label + the reused tile.
 *   • Policy-risk exclusion carries through — a snapshot that yields
 *     only request_gbp_reviews still renders (connected presence) but
 *     never shows that policy-risk action.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OffSiteOpportunitiesSection } from "@/app/(shell)/recommendations/off-site-opportunities-section";
import { loadOffSitePresenceSnapshot } from "@/domains/off-site-authority/load-snapshot";
import type {
  OffSiteChannelState,
  OffSitePresenceChannel,
  OffSitePresenceConfidence,
  OffSitePresenceSnapshot,
  OffSitePresenceSource,
} from "@/domains/off-site-authority/types";

vi.mock("@/domains/off-site-authority/load-snapshot", () => ({
  loadOffSitePresenceSnapshot: vi.fn(),
}));

const mockedLoad = vi.mocked(loadOffSitePresenceSnapshot);
const ISO = "2026-05-22T00:00:00.000Z";

function channel(
  ch: OffSitePresenceChannel,
  opts: {
    claimed: boolean | null;
    source: OffSitePresenceSource;
    confidence: OffSitePresenceConfidence;
    review_count?: number | null;
    rating?: number | null;
  },
): OffSiteChannelState {
  return {
    channel: ch,
    claimed: opts.claimed,
    review_count: opts.review_count ?? null,
    rating: opts.rating ?? null,
    profile_url: null,
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

async function render(): Promise<string> {
  const node = await OffSiteOpportunitiesSection();
  return renderToStaticMarkup(node);
}

beforeEach(() => {
  mockedLoad.mockReset();
});

describe("OffSiteOpportunitiesSection (Section 7 C7e)", () => {
  it("renders nothing for a non-local-service tenant", async () => {
    mockedLoad.mockResolvedValue(
      snapshot(false, [
        channel("gbp", { claimed: false, source: "inferred", confidence: "low" }),
      ]),
    );
    expect(await render()).toBe("");
  });

  it("renders nothing when the loader throws (soft-fail)", async () => {
    mockedLoad.mockRejectedValue(new Error("transient supabase error"));
    expect(await render()).toBe("");
  });

  it("renders nothing when there are no connected channels and no review opportunities", async () => {
    // is_local_service true but empty channels → real compute yields no
    // candidates → defensive empty gate.
    mockedLoad.mockResolvedValue(snapshot(true, []));
    expect(await render()).toBe("");
  });

  it("renders the off-site opportunities section with the context label + reused tile", async () => {
    // Local-service tenant with an unclaimed GBP → the real rule engine
    // produces a claim_gbp candidate (non-policy-risk).
    mockedLoad.mockResolvedValue(
      snapshot(true, [
        channel("gbp", { claimed: false, source: "inferred", confidence: "low" }),
      ]),
    );
    const html = await render();
    expect(html).toContain('data-recommendations-off-site="true"');
    expect(html).toContain("Off-site opportunities");
    expect(html).toContain("manual follow-up");
    // Reused C7d tile is present.
    expect(html).toContain('data-today-off-site-tile="true"');
    expect(html).toContain('data-off-site-review-op="claim_gbp"');
  });

  it("shows connected presence but never a policy-risk action (request_gbp_reviews)", async () => {
    // claimed GBP with 5 reviews → real rules emit request_gbp_reviews
    // (policy_risk). The section still renders (connected presence); the
    // reused tile excludes the policy-risk action.
    mockedLoad.mockResolvedValue(
      snapshot(true, [
        channel("gbp", {
          claimed: true,
          source: "connector_api",
          confidence: "high",
          review_count: 5,
          rating: 4.6,
        }),
      ]),
    );
    const html = await render();
    expect(html).toContain('data-recommendations-off-site="true"');
    expect(html).toContain('data-off-site-channel="gbp"');
    expect(html).toContain("Connected");
    expect(html).not.toContain("request_gbp_reviews");
    expect(html).not.toContain('data-off-site-review-op="request_gbp_reviews"');
  });

  it("never renders an Accept/Defer/Dismiss affordance", async () => {
    mockedLoad.mockResolvedValue(
      snapshot(true, [
        channel("gbp", { claimed: false, source: "inferred", confidence: "low" }),
      ]),
    );
    const html = await render();
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
});
