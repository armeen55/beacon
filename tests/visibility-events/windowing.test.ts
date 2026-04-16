/**
 * Visibility-events windowing tests — E1.3.
 *
 * Exercises the new buildVisibilityEventWindows primitive:
 *   - 1/3/7/14 day window filtering from a spike start date
 *   - Topic-scoping (infra passthrough + fuzzy topic match)
 *   - Site-change filter (excluding reviews/citations/tooling)
 *   - Optional memory-insight enrichment when snapshots are supplied
 */

import { describe, it, expect } from "vitest";
import { buildVisibilityEventWindows } from "@/domains/visibility-events/windowing";
import type { Spike } from "@/domains/visibility-events/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { ChangePattern } from "@/domains/learning/change-patterns";

function makeChange(
  id: string,
  timestamp: string,
  signal_type: string,
  description: string,
  topic: string,
  url: string | null = null,
): ChangelogEntry {
  return {
    id,
    timestamp: `${timestamp}T12:00:00Z`,
    signal_type: signal_type as ChangelogEntry["signal_type"],
    asset_type: "infrastructure" as ChangelogEntry["asset_type"],
    url,
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

function makeSpike(overrides: Partial<Spike> = {}): Spike {
  return {
    id: "test-spike",
    metric: "citations",
    platform: "chatgpt",
    scopeId: "Custom Home Builder Bay Area",
    startDate: "2026-04-13",
    peakDate: "2026-04-14",
    peakValue: 62,
    baseline: 20,
    absoluteDelta: 42,
    relativeRatio: 3.1,
    dayCount: 2,
    isEmerging: false,
    ...overrides,
  };
}

function makeSnap(
  date: string,
  platform: string,
  citations: number,
  mentions = 0,
  scopeId = "Custom Home Builder Bay Area",
): DailyMetricSnapshot {
  return {
    id: `s-${date}-${platform}-${scopeId}`,
    date,
    scope_type: "topic",
    scope_id: scopeId,
    platform,
    source_type: "derived",
    visibility_score: null,
    mention_count: mentions,
    citation_count: citations,
    share_of_voice: null,
    avg_position: null,
    total_possible: null,
    metadata: {},
    tenant_id: "tenant-test",
  };
}

describe("buildVisibilityEventWindows — temporal windowing", () => {
  it("places changes into correct 1/3/7/14 day windows relative to spike start", () => {
    const spike = makeSpike({ startDate: "2026-04-13" });
    const changelog = [
      makeChange("c1", "2026-04-12", "technical", "FAQ schema", ""), // 1 day
      makeChange("c2", "2026-04-11", "technical", "PageSpeed", ""), // 2 days
      makeChange("c3", "2026-04-09", "content", "Comparison table", ""), // 4 days
      makeChange("c4", "2026-04-06", "faq", "FAQ section", ""), // 7 days
      makeChange("c5", "2026-04-02", "page", "New page", ""), // 11 days
      makeChange("c6", "2026-03-20", "content", "Old change", ""), // outside 14 days
    ];
    const result = buildVisibilityEventWindows({ spike, changelog });
    expect(result.oneDay.length).toBe(1);
    expect(result.threeDays.length).toBe(2);
    expect(result.sevenDays.length).toBe(4);
    expect(result.fourteenDays.length).toBe(5);
    expect(result.qualityEvidence.size).toBe(0); // no snapshots/outcomes → empty
  });

  it("excludes changes that happened on or after the spike start", () => {
    const spike = makeSpike({ startDate: "2026-04-13" });
    const changelog = [
      makeChange("c1", "2026-04-12", "technical", "Before spike", ""),
      makeChange("c2", "2026-04-13", "technical", "Same day as spike", ""),
      makeChange("c3", "2026-04-14", "technical", "After spike", ""),
    ];
    const result = buildVisibilityEventWindows({ spike, changelog });
    const ids = result.fourteenDays.map((w) => w.changeId);
    expect(ids).toContain("c1");
    expect(ids).not.toContain("c2");
    expect(ids).not.toContain("c3");
  });
});

describe("buildVisibilityEventWindows — scoping", () => {
  it("includes topic-matching changes and infra (no-topic) changes", () => {
    const spike = makeSpike({ scopeId: "Custom Home Builder Bay Area" });
    const changelog = [
      makeChange(
        "match",
        "2026-04-11",
        "faq",
        "Match",
        "Custom Home Builder Bay Area",
      ),
      makeChange("infra", "2026-04-11", "technical", "Sitewide infra", ""),
      makeChange(
        "other",
        "2026-04-11",
        "faq",
        "Different topic",
        "Residential Pool Construction Phoenix",
      ),
    ];
    const result = buildVisibilityEventWindows({ spike, changelog });
    const ids = result.fourteenDays.map((w) => w.changeId);
    expect(ids).toContain("match");
    expect(ids).toContain("infra");
    expect(ids).not.toContain("other");
  });

  it("excludes off-site tooling signals (reviews, citations, profound)", () => {
    const spike = makeSpike();
    const changelog = [
      makeChange("site", "2026-04-11", "technical", "Real site change", ""),
      makeChange("review", "2026-04-11", "review", "Review response", ""),
      makeChange(
        "citation",
        "2026-04-11",
        "citation",
        "Directory update",
        "",
      ),
      makeChange(
        "tooling",
        "2026-04-11",
        "technical",
        "Profound export run",
        "",
        "https://profound.ai/run/abc",
      ),
    ];
    const result = buildVisibilityEventWindows({ spike, changelog });
    const ids = result.fourteenDays.map((w) => w.changeId);
    expect(ids).toContain("site");
    expect(ids).not.toContain("review");
    expect(ids).not.toContain("citation");
    expect(ids).not.toContain("tooling");
  });
});

describe("buildVisibilityEventWindows — memory insight enrichment", () => {
  it("populates insight map when snapshots are provided", () => {
    const spike = makeSpike({
      scopeId: "Custom Home Builder Bay Area",
      startDate: "2026-04-15",
    });

    // Changelog: one change with enough before/after metric data
    const changelog = [
      makeChange(
        "c1",
        "2026-04-01",
        "faq",
        "Added FAQ section",
        "Custom Home Builder Bay Area",
      ),
    ];

    // Build snapshots: 7 days baseline at ~4 cit/day before 2026-04-01,
    // then 10+ days after at ~8 cit/day (improving direction).
    const snapshots: DailyMetricSnapshot[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date("2026-03-25T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      snapshots.push(
        makeSnap(d.toISOString().slice(0, 10), "chatgpt", 4, 2),
      );
    }
    for (let i = 0; i < 14; i++) {
      const d = new Date("2026-04-02T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      snapshots.push(
        makeSnap(d.toISOString().slice(0, 10), "chatgpt", 10, 4),
      );
    }

    const result = buildVisibilityEventWindows({
      spike,
      changelog,
      snapshots,
    });
    // The change should be in the 14-day window (14 days before spike)
    expect(result.fourteenDays.some((w) => w.changeId === "c1")).toBe(true);
    // And the quality-evidence map should contain this changeId
    const evidence = result.qualityEvidence.get("c1");
    expect(evidence).toBeDefined();
    expect(evidence!.direction).toBe("improving");
    expect(evidence!.source).toBe("insight");
  });

  it("returns empty quality-evidence map when snapshots/outcomes omitted", () => {
    const spike = makeSpike();
    const changelog = [
      makeChange(
        "c1",
        "2026-04-11",
        "faq",
        "FAQ",
        "Custom Home Builder Bay Area",
      ),
    ];
    const result = buildVisibilityEventWindows({ spike, changelog });
    expect(result.qualityEvidence.size).toBe(0);
  });

  it("caps the window with learned engine_timing when a matching pattern is supplied (E1.5)", () => {
    const spike = makeSpike({ startDate: "2026-04-20", platform: "chatgpt" });
    const changelog = [
      // Day -3 — should always be included
      makeChange("recent", "2026-04-17", "technical", "Recent change", ""),
      // Day -12 — would be included under the hardcoded 14-day cap but
      // should be excluded once we learn that this pattern's latest_days
      // on chatgpt is 5 (tolerance +2 = cap at 7).
      makeChange("old", "2026-04-08", "technical", "Old change", ""),
    ];
    const patterns: ChangePattern[] = [
      {
        id: "technical::infrastructure",
        signal_type: "technical",
        asset_type: "infrastructure",
        sample_count: 5,
        success_count: 4,
        success_rate: 0.8,
        avg_citation_delta: 12.5,
        avg_mention_delta: 6.0,
        avg_days_to_signal: 3,
        platform_response: {},
        engine_timing: [
          {
            platform: "chatgpt",
            median_days: 3,
            earliest_days: 2,
            latest_days: 5,
            sample_count: 4,
          },
        ],
        confidence: "medium",
        computed_at: "2026-04-20T00:00:00Z",
      },
    ];
    const result = buildVisibilityEventWindows({
      spike,
      changelog,
      patterns,
    });
    const ids = result.fourteenDays.map((w) => w.changeId);
    expect(ids).toContain("recent");
    expect(ids).not.toContain("old");
  });

  it("falls back to 14-day cap when no matching pattern exists (E1.5)", () => {
    const spike = makeSpike({ startDate: "2026-04-20" });
    const changelog = [
      makeChange("c1", "2026-04-08", "faq", "12 days back", ""),
    ];
    // Pattern is for a different signal/asset — should not apply.
    const patterns: ChangePattern[] = [
      {
        id: "content::homepage",
        signal_type: "content",
        asset_type: "homepage",
        sample_count: 5,
        success_count: 4,
        success_rate: 0.8,
        avg_citation_delta: 10,
        avg_mention_delta: 5,
        avg_days_to_signal: 3,
        platform_response: {},
        engine_timing: [
          {
            platform: "chatgpt",
            median_days: 3,
            earliest_days: 2,
            latest_days: 5,
            sample_count: 4,
          },
        ],
        confidence: "medium",
        computed_at: "2026-04-20T00:00:00Z",
      },
    ];
    const result = buildVisibilityEventWindows({
      spike,
      changelog,
      patterns,
    });
    expect(result.fourteenDays.some((w) => w.changeId === "c1")).toBe(true);
  });

  it("ignores low-confidence patterns (E1.5)", () => {
    const spike = makeSpike({ startDate: "2026-04-20" });
    const changelog = [
      makeChange("c1", "2026-04-08", "technical", "12 days back", ""),
    ];
    const patterns: ChangePattern[] = [
      {
        id: "technical::infrastructure",
        signal_type: "technical",
        asset_type: "infrastructure",
        sample_count: 2,
        success_count: 1,
        success_rate: 0.5,
        avg_citation_delta: 8,
        avg_mention_delta: 4,
        avg_days_to_signal: 3,
        platform_response: {},
        engine_timing: [
          {
            platform: "chatgpt",
            median_days: 3,
            earliest_days: 2,
            latest_days: 5,
            sample_count: 2,
          },
        ],
        confidence: "low",
        computed_at: "2026-04-20T00:00:00Z",
      },
    ];
    const result = buildVisibilityEventWindows({
      spike,
      changelog,
      patterns,
    });
    // Low confidence means the pattern is ignored — fall back to 14-day cap.
    expect(result.fourteenDays.some((w) => w.changeId === "c1")).toBe(true);
  });

  it("prefers outcomes over snapshots when both are provided (E1.4)", () => {
    const spike = makeSpike();
    const changelog = [
      makeChange(
        "c1",
        "2026-04-11",
        "faq",
        "FAQ",
        "Custom Home Builder Bay Area",
      ),
    ];
    const outcomes = [
      {
        id: "c1",
        change_id: "c1",
        topic_targeted: "Custom Home Builder Bay Area",
        changed_at: "2026-04-11T12:00:00Z",
        direction: "improving" as const,
        mention_delta_pct: 12.5,
        citation_delta_pct: 25.0,
        visibility_delta_pct: 0,
        mentions_before: 2,
        mentions_after: 2.25,
        citations_before: 4,
        citations_after: 5,
        visibility_before: 0,
        visibility_after: 0,
        days_before: 3,
        days_after: 7,
        observations_before: 3,
        observations_after: 5,
        platform_deltas: {},
        computed_at: "2026-04-14T00:00:00Z",
        normalized_citation_delta_pct: 25.0,
        raw_citation_delta_pct: 25.0,
        normalized: false,
        tenant_id: "tenant-test",
      },
    ];
    // Provide empty snapshots that would NOT match — outcomes must win.
    const result = buildVisibilityEventWindows({
      spike,
      changelog,
      snapshots: [],
      outcomes,
    });
    const evidence = result.qualityEvidence.get("c1");
    expect(evidence).toBeDefined();
    expect(evidence!.source).toBe("outcome");
    expect(evidence!.direction).toBe("improving");
    expect(evidence!.citationDeltaPct).toBe(25.0);
  });
});
