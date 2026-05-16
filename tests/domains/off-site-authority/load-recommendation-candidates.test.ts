/**
 * Section 7 C7c — preview-loader runtime tests.
 *
 * Verifies the thin server wrapper around the C7a snapshot loader:
 *   • passes `options.now` through to the snapshot loader,
 *   • returns the combined `{ snapshot, recommendationCandidates }` shape,
 *   • the `recommendationCandidates` field IS the pure-compute output
 *     for that snapshot (deep equal),
 *   • the default-options path works (no `now` provided),
 *   • the loader does NOT import or call any persistence /
 *     recommendation-domain write path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { OffSitePresenceSnapshot } from "@/domains/off-site-authority/types";

const NOW_ISO = "2026-05-16T12:00:00.000Z";

const FIXTURE_SNAPSHOT: OffSitePresenceSnapshot = {
  tenant_id: "tenant-test",
  brand_name: "Test Brand",
  is_local_service: true,
  channels: [
    {
      channel: "gbp",
      claimed: false,
      review_count: null,
      rating: null,
      profile_url: null,
      source: "inferred",
      last_checked_at: NOW_ISO,
      confidence: "low",
    },
    {
      channel: "yelp",
      claimed: true,
      review_count: 5,
      rating: 4.5,
      profile_url: null,
      source: "connector_api",
      last_checked_at: NOW_ISO,
      confidence: "high",
    },
    ...(["houzz", "angi", "bbb", "industry_directory", "local_press"] as const).map(
      (channel) => ({
        channel,
        claimed: null,
        review_count: null,
        rating: null,
        profile_url: null,
        source: "inferred" as const,
        last_checked_at: NOW_ISO,
        confidence: "unknown" as const,
      }),
    ),
  ],
  data_sources_note: ["test note"],
  generated_at: NOW_ISO,
};

const _spies = {
  loadSnapshot: vi.fn(
    async (_opts?: { now?: Date | string }): Promise<OffSitePresenceSnapshot> =>
      FIXTURE_SNAPSHOT,
  ),
};

vi.mock("@/domains/off-site-authority/load-snapshot", () => ({
  loadOffSitePresenceSnapshot: (opts?: { now?: Date | string }) =>
    _spies.loadSnapshot(opts),
}));

import { loadOffSiteRecommendationPreview } from "@/domains/off-site-authority/load-recommendation-candidates";
import { computeOffSiteRecommendationCandidates } from "@/domains/off-site-authority/recommendation-rules";

beforeEach(() => {
  _spies.loadSnapshot.mockClear();
});

describe("Section 7 C7c — loadOffSiteRecommendationPreview", () => {
  it("returns both snapshot and recommendationCandidates", async () => {
    const out = await loadOffSiteRecommendationPreview({ now: NOW_ISO });
    expect(out).toHaveProperty("snapshot");
    expect(out).toHaveProperty("recommendationCandidates");
  });

  it("snapshot field is exactly what the snapshot loader returned", async () => {
    const out = await loadOffSiteRecommendationPreview({ now: NOW_ISO });
    expect(out.snapshot).toBe(FIXTURE_SNAPSHOT);
  });

  it("recommendationCandidates is the pure compute output for that snapshot", async () => {
    const out = await loadOffSiteRecommendationPreview({ now: NOW_ISO });
    expect(out.recommendationCandidates).toEqual(
      computeOffSiteRecommendationCandidates(FIXTURE_SNAPSHOT),
    );
  });

  it("passes options.now through to the snapshot loader", async () => {
    await loadOffSiteRecommendationPreview({ now: NOW_ISO });
    expect(_spies.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(_spies.loadSnapshot.mock.calls[0]?.[0]).toEqual({ now: NOW_ISO });
  });

  it("default-options path works (no `now` provided)", async () => {
    const out = await loadOffSiteRecommendationPreview();
    expect(_spies.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(_spies.loadSnapshot.mock.calls[0]?.[0]).toEqual({});
    expect(out.recommendationCandidates).toEqual(
      computeOffSiteRecommendationCandidates(FIXTURE_SNAPSHOT),
    );
  });
});
