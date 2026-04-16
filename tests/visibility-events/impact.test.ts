/**
 * Visibility-events impact scoring tests — E1.6.
 *
 * Exercises:
 *   - proximityWeight piecewise linear decay (0d=1.0, 7d=0.4, 14d=0.2)
 *   - clusterWeightForChange learned vs default lookup
 *   - computeClusterImpact aggregation semantics
 *   - Attribution verdict changes when impact weighting replaces counts
 */

import { describe, it, expect } from "vitest";
import {
  proximityWeight,
  clusterWeightForChange,
  computeClusterImpact,
  buildPatternsById,
  DEFAULT_CLUSTER_WEIGHTS,
} from "@/domains/visibility-events/impact";
import { attributeEventViaTriage } from "@/domains/visibility-events/attribute";
import type { WindowedChange } from "@/domains/visibility-events/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { ChangePattern } from "@/domains/learning/change-patterns";

// ---------------------------------------------------------------------------
// proximityWeight
// ---------------------------------------------------------------------------

describe("proximityWeight", () => {
  it("returns 1.0 at day 0", () => {
    expect(proximityWeight(0)).toBe(1.0);
  });

  it("returns 0.4 at day 7", () => {
    expect(proximityWeight(7)).toBeCloseTo(0.4, 2);
  });

  it("returns 0.2 at day 14", () => {
    expect(proximityWeight(14)).toBeCloseTo(0.2, 2);
  });

  it("decays smoothly between day 0 and day 7", () => {
    const w3 = proximityWeight(3);
    expect(w3).toBeGreaterThan(0.4);
    expect(w3).toBeLessThan(1.0);
  });

  it("decays smoothly between day 7 and day 14", () => {
    const w10 = proximityWeight(10);
    expect(w10).toBeGreaterThan(0.2);
    expect(w10).toBeLessThan(0.4);
  });

  it("floors at 0.2 for days beyond 14", () => {
    expect(proximityWeight(30)).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// clusterWeightForChange
// ---------------------------------------------------------------------------

describe("clusterWeightForChange", () => {
  it("returns default cluster weight when no pattern matches", () => {
    const w = clusterWeightForChange({
      cluster: "faq_schema",
      signalType: "faq",
      assetType: "city_page",
      patternsById: null,
    });
    expect(w).toBe(DEFAULT_CLUSTER_WEIGHTS.faq_schema);
  });

  it("uses learned pattern success_rate when confidence is medium+ and samples ≥ 3", () => {
    const patterns: ChangePattern[] = [
      {
        id: "faq::city_page",
        signal_type: "faq",
        asset_type: "city_page",
        sample_count: 5,
        success_count: 4,
        success_rate: 0.8,
        avg_citation_delta: 10,
        avg_mention_delta: 5,
        avg_days_to_signal: 3,
        platform_response: {},
        engine_timing: [],
        confidence: "medium",
        computed_at: "2026-04-20T00:00:00Z",
      },
    ];
    const w = clusterWeightForChange({
      cluster: "faq_schema",
      signalType: "faq",
      assetType: "city_page",
      patternsById: buildPatternsById(patterns),
    });
    // 0.3 + 0.8 * 1.0 = 1.1
    expect(w).toBeCloseTo(1.1, 2);
  });

  it("falls back to default when pattern confidence is low", () => {
    const patterns: ChangePattern[] = [
      {
        id: "faq::city_page",
        signal_type: "faq",
        asset_type: "city_page",
        sample_count: 2,
        success_count: 2,
        success_rate: 1.0,
        avg_citation_delta: 10,
        avg_mention_delta: 5,
        avg_days_to_signal: 3,
        platform_response: {},
        engine_timing: [],
        confidence: "low",
        computed_at: "2026-04-20T00:00:00Z",
      },
    ];
    const w = clusterWeightForChange({
      cluster: "faq_schema",
      signalType: "faq",
      assetType: "city_page",
      patternsById: buildPatternsById(patterns),
    });
    expect(w).toBe(DEFAULT_CLUSTER_WEIGHTS.faq_schema);
  });
});

// ---------------------------------------------------------------------------
// computeClusterImpact
// ---------------------------------------------------------------------------

function makeWindowed(
  changeId: string,
  daysBeforeSpike: number,
  cluster: WindowedChange["cluster"],
  signalType = "faq",
  assetType = "city_page",
): WindowedChange {
  return {
    changeId,
    timestamp: "2026-04-01T12:00:00Z",
    daysBeforeSpike,
    cluster,
    signalType,
    assetType,
    url: null,
    description: "",
    topicTargeted: "Custom Home Builder Bay Area",
  };
}

describe("computeClusterImpact", () => {
  it("returns zero score for an empty change list", () => {
    const result = computeClusterImpact({
      cluster: "faq_schema",
      changes: [],
    });
    expect(result.score).toBe(0);
    expect(result.breakdown.changeCount).toBe(0);
  });

  it("weights closer changes higher than further changes", () => {
    const close = computeClusterImpact({
      cluster: "faq_schema",
      changes: [makeWindowed("c1", 1, "faq_schema")],
    });
    const far = computeClusterImpact({
      cluster: "faq_schema",
      changes: [makeWindowed("c1", 13, "faq_schema")],
    });
    expect(close.score).toBeGreaterThan(far.score);
  });

  it("accumulates scores across multiple changes in the same cluster", () => {
    const one = computeClusterImpact({
      cluster: "faq_schema",
      changes: [makeWindowed("c1", 2, "faq_schema")],
    });
    const three = computeClusterImpact({
      cluster: "faq_schema",
      changes: [
        makeWindowed("c1", 2, "faq_schema"),
        makeWindowed("c2", 2, "faq_schema"),
        makeWindowed("c3", 2, "faq_schema"),
      ],
    });
    expect(three.score).toBeCloseTo(one.score * 3, 2);
    expect(three.breakdown.changeCount).toBe(3);
  });

  it("ranks technical_rendering above metadata when both have equal counts and proximity", () => {
    const tech = computeClusterImpact({
      cluster: "technical_rendering",
      changes: [
        makeWindowed("c1", 1, "technical_rendering", "technical", "infrastructure"),
        makeWindowed("c2", 1, "technical_rendering", "technical", "infrastructure"),
      ],
    });
    const meta = computeClusterImpact({
      cluster: "metadata",
      changes: [
        makeWindowed("c3", 1, "metadata", "technical", "infrastructure"),
        makeWindowed("c4", 1, "metadata", "technical", "infrastructure"),
      ],
    });
    expect(tech.score).toBeGreaterThan(meta.score);
  });
});

// ---------------------------------------------------------------------------
// attributeEventViaTriage with impact weighting
// ---------------------------------------------------------------------------

function makeChange(
  id: string,
  timestamp: string,
  signal: string,
  asset: string,
  description: string,
  topic = "",
): ChangelogEntry {
  return {
    id,
    timestamp: `${timestamp}T12:00:00Z`,
    signal_type: signal as ChangelogEntry["signal_type"],
    asset_type: asset as ChangelogEntry["asset_type"],
    url: null,
    asset_name: "Test",
    change_description: description,
    topic_targeted: topic,
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: `${timestamp}T12:00:00Z`,
    updated_at: `${timestamp}T12:00:00Z`,
    tenant_id: "tenant-test",
  };
}

describe("attributeEventViaTriage impact scoring (E1.6)", () => {
  it("attaches a non-zero impactScore with populated breakdown per cluster", () => {
    const spike = {
      id: "s1",
      metric: "citations" as const,
      platform: "chatgpt" as const,
      scopeId: "Custom Home Builder Bay Area",
      startDate: "2026-04-13",
      peakDate: "2026-04-14",
      peakValue: 62,
      baseline: 20,
      absoluteDelta: 42,
      relativeRatio: 3.1,
      dayCount: 2,
      isEmerging: false,
    };
    const changes = [
      makeChange("c1", "2026-04-11", "technical", "infrastructure", "FAQ schema 1"),
      makeChange("c2", "2026-04-11", "technical", "infrastructure", "FAQ schema 2"),
      makeChange("c3", "2026-04-12", "technical", "infrastructure", "FAQ schema 3"),
    ];
    const windowed: WindowedChange[] = [
      makeWindowed("c1", 2, "faq_schema", "technical", "infrastructure"),
      makeWindowed("c2", 2, "faq_schema", "technical", "infrastructure"),
      makeWindowed("c3", 1, "faq_schema", "technical", "infrastructure"),
    ];
    const result = attributeEventViaTriage({
      windowedChanges: windowed,
      spike,
      changelogById: new Map(changes.map((c) => [c.id, c])),
    });
    const faq = result.attributions.find((a) => a.cluster === "faq_schema");
    expect(faq).toBeDefined();
    expect(faq!.impactScore).toBeGreaterThan(0);
    expect(faq!.impactBreakdown.changeCount).toBe(3);
    expect(faq!.impactBreakdown.clusterWeight).toBeGreaterThan(0);
    expect(faq!.impactBreakdown.proximityWeight).toBeGreaterThan(0);
  });

  it("ranks technical_rendering above metadata given same change counts and proximity", () => {
    const spike = {
      id: "s1",
      metric: "citations" as const,
      platform: "chatgpt" as const,
      scopeId: "Custom Home Builder Bay Area",
      startDate: "2026-04-13",
      peakDate: "2026-04-14",
      peakValue: 62,
      baseline: 20,
      absoluteDelta: 42,
      relativeRatio: 3.1,
      dayCount: 2,
      isEmerging: false,
    };
    const changes = [
      makeChange("t1", "2026-04-11", "technical", "infrastructure", "SSG prerender"),
      makeChange("t2", "2026-04-11", "technical", "infrastructure", "PageSpeed LCP"),
      makeChange("t3", "2026-04-12", "technical", "infrastructure", "Canonical"),
      makeChange("m1", "2026-04-11", "technical", "infrastructure", "Updated title tag"),
      makeChange("m2", "2026-04-11", "technical", "infrastructure", "Updated meta description"),
      makeChange("m3", "2026-04-12", "technical", "infrastructure", "Updated og:image"),
    ];
    const windowed: WindowedChange[] = [
      makeWindowed("t1", 2, "technical_rendering", "technical", "infrastructure"),
      makeWindowed("t2", 2, "technical_rendering", "technical", "infrastructure"),
      makeWindowed("t3", 1, "technical_rendering", "technical", "infrastructure"),
      makeWindowed("m1", 2, "metadata", "technical", "infrastructure"),
      makeWindowed("m2", 2, "metadata", "technical", "infrastructure"),
      makeWindowed("m3", 1, "metadata", "technical", "infrastructure"),
    ];
    const result = attributeEventViaTriage({
      windowedChanges: windowed,
      spike,
      changelogById: new Map(changes.map((c) => [c.id, c])),
    });
    const tech = result.attributions.find(
      (a) => a.cluster === "technical_rendering",
    );
    const meta = result.attributions.find((a) => a.cluster === "metadata");
    expect(tech).toBeDefined();
    expect(meta).toBeDefined();
    expect(tech!.impactScore).toBeGreaterThan(meta!.impactScore);
  });
});
