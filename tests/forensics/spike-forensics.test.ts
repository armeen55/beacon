/**
 * Spike Forensics tests.
 *
 * Validates detection, clustering, windowing, and attribution against
 * controlled synthetic scenarios that mimic real Ritz data patterns.
 */

import { describe, it, expect } from "vitest";
import {
  detectSpikes,
  clusterChange,
  buildEventWindows,
  attributeSpike,
  analyzeSpike,
} from "@/domains/forensics/spike-forensics";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { ChangelogEntry } from "@/domains/changelog/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snap(
  date: string,
  platform: string,
  citations: number,
  mentions = 0,
  visibility: number | null = null,
  scopeId = "Atherton Construction",
): DailyMetricSnapshot {
  return {
    id: `snap-${date}-${platform}-${scopeId}`,
    date,
    scope_type: "topic",
    scope_id: scopeId,
    platform,
    source_type: "derived",
    visibility_score: visibility,
    mention_count: mentions,
    citation_count: citations,
    share_of_voice: null,
    avg_position: null,
    total_possible: null,
    metadata: {},
    tenant_id: "tenant-test",
  };
}

function change(
  timestamp: string,
  signal_type: string,
  description: string,
  topic = "Custom Home Builder Bay Area",
  asset_type = "infrastructure",
  url: string | null = null,
): ChangelogEntry {
  return {
    id: `cl-${timestamp}-${description.slice(0, 10)}`.replace(/\W/g, "-"),
    timestamp: `${timestamp}T12:00:00Z`,
    signal_type: signal_type as ChangelogEntry["signal_type"],
    asset_type: asset_type as ChangelogEntry["asset_type"],
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

// ---------------------------------------------------------------------------
// Detection tests
// ---------------------------------------------------------------------------

describe("detectSpikes", () => {
  it("detects a 2x jump above baseline with sustained peak", () => {
    // 7 days of baseline ~2, then jump to 6 (3x) sustained for 2 days
    const snaps: DailyMetricSnapshot[] = [
      snap("2026-03-05", "ChatGPT", 2),
      snap("2026-03-06", "ChatGPT", 2),
      snap("2026-03-07", "ChatGPT", 2),
      snap("2026-03-08", "ChatGPT", 2),
      snap("2026-03-09", "ChatGPT", 2),
      snap("2026-03-10", "ChatGPT", 2),
      snap("2026-03-11", "ChatGPT", 2),
      snap("2026-03-12", "ChatGPT", 7), // spike day — 3.5x baseline
      snap("2026-03-13", "ChatGPT", 8), // sustained
      snap("2026-03-14", "ChatGPT", 9),
    ];

    const spikes = detectSpikes({ snapshots: snaps, metric: "citations" });
    expect(spikes.length).toBeGreaterThanOrEqual(1);
    const spike = spikes[0];
    expect(spike.platform).toBe("chatgpt");
    expect(spike.metric).toBe("citations");
    expect(spike.relativeRatio).toBeGreaterThanOrEqual(1.75);
    expect(spike.peakValue).toBeGreaterThanOrEqual(7);
  });

  it("does NOT detect a single-day blip that collapses", () => {
    // Baseline 2, single-day spike to 10, back to 2 immediately
    const snaps: DailyMetricSnapshot[] = [
      snap("2026-03-05", "ChatGPT", 2),
      snap("2026-03-06", "ChatGPT", 2),
      snap("2026-03-07", "ChatGPT", 2),
      snap("2026-03-08", "ChatGPT", 2),
      snap("2026-03-09", "ChatGPT", 2),
      snap("2026-03-10", "ChatGPT", 2),
      snap("2026-03-11", "ChatGPT", 2),
      snap("2026-03-12", "ChatGPT", 10), // blip
      snap("2026-03-13", "ChatGPT", 2),  // full collapse
      snap("2026-03-14", "ChatGPT", 2),
      snap("2026-03-15", "ChatGPT", 2),
    ];

    const spikes = detectSpikes({ snapshots: snaps, metric: "citations" });
    expect(spikes.length).toBe(0);
  });

  it("detects emerging signal from zero baseline when above floor", () => {
    // 7 zero days, then 5 sustained days above emerging floor
    const snaps: DailyMetricSnapshot[] = [
      snap("2026-03-05", "Perplexity", 0),
      snap("2026-03-06", "Perplexity", 0),
      snap("2026-03-07", "Perplexity", 0),
      snap("2026-03-08", "Perplexity", 0),
      snap("2026-03-09", "Perplexity", 0),
      snap("2026-03-10", "Perplexity", 0),
      snap("2026-03-11", "Perplexity", 0),
      snap("2026-03-12", "Perplexity", 4), // emerging
      snap("2026-03-13", "Perplexity", 5),
      snap("2026-03-14", "Perplexity", 6),
    ];

    const spikes = detectSpikes({ snapshots: snaps, metric: "citations" });
    expect(spikes.length).toBeGreaterThanOrEqual(1);
    expect(spikes[0].isEmerging).toBe(true);
    expect(spikes[0].platform).toBe("perplexity");
  });

  it("merges consecutive spike days into a single event", () => {
    const snaps: DailyMetricSnapshot[] = [
      snap("2026-03-05", "Google AI Overviews", 3),
      snap("2026-03-06", "Google AI Overviews", 3),
      snap("2026-03-07", "Google AI Overviews", 3),
      snap("2026-03-08", "Google AI Overviews", 3),
      snap("2026-03-09", "Google AI Overviews", 3),
      snap("2026-03-10", "Google AI Overviews", 3),
      snap("2026-03-11", "Google AI Overviews", 3),
      snap("2026-03-12", "Google AI Overviews", 10), // day 1
      snap("2026-03-13", "Google AI Overviews", 12), // day 2 (peak)
      snap("2026-03-14", "Google AI Overviews", 11), // day 3
      snap("2026-03-15", "Google AI Overviews", 10), // day 4
    ];

    const spikes = detectSpikes({ snapshots: snaps, metric: "citations" });
    expect(spikes.length).toBe(1);
    expect(spikes[0].dayCount).toBeGreaterThanOrEqual(2);
    expect(spikes[0].peakValue).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Clustering tests
// ---------------------------------------------------------------------------

describe("clusterChange", () => {
  it("classifies FAQ schema changes", () => {
    expect(
      clusterChange(change("2026-04-10", "faq", "Added 6-question FAQ section")),
    ).toBe("faq_schema");
    expect(
      clusterChange(
        change("2026-04-10", "technical", "Added FAQPage JSON-LD schema to homepage"),
      ),
    ).toBe("faq_schema");
  });

  it("classifies page launches", () => {
    expect(
      clusterChange(change("2026-03-10", "page", "Created new city page")),
    ).toBe("page_launch");
    expect(
      clusterChange(change("2026-03-10", "content", "Rebuilt /our-process page")),
    ).toBe("page_launch");
  });

  it("classifies technical rendering changes", () => {
    expect(
      clusterChange(
        change("2026-04-10", "technical", "SSG prerender deployed sitewide"),
      ),
    ).toBe("technical_rendering");
    expect(
      clusterChange(
        change("2026-04-10", "technical", "Completed sitewide PageSpeed optimization targeting LCP<4s"),
      ),
    ).toBe("technical_rendering");
  });

  it("classifies content structure changes", () => {
    expect(
      clusterChange(
        change("2026-03-12", "content", "Added builder comparison table"),
      ),
    ).toBe("content_structure");
    expect(
      clusterChange(
        change("2026-03-12", "content", "Added Neighborhoods section to Palo Alto page"),
      ),
    ).toBe("content_structure");
  });

  it("classifies internal links", () => {
    expect(
      clusterChange(
        change("2026-03-10", "content", "Added internal link to /our-difference"),
      ),
    ).toBe("internal_links");
  });

  it("falls through to other for unknown signals", () => {
    expect(
      clusterChange(change("2026-03-10", "measurement", "Updated tracking setup")),
    ).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// Event window tests
// ---------------------------------------------------------------------------

describe("buildEventWindows", () => {
  it("places changes into correct day-windows", () => {
    const spike = {
      id: "test-spike",
      metric: "citations" as const,
      platform: "chatgpt" as const,
      scopeId: "Atherton Construction",
      startDate: "2026-04-12",
      peakDate: "2026-04-14",
      peakValue: 62,
      baseline: 20,
      absoluteDelta: 42,
      relativeRatio: 3.1,
      dayCount: 3,
      isEmerging: false,
    };

    const changelog = [
      change("2026-04-11", "technical", "FAQ schema deployed"), // -1 day
      change("2026-04-10", "technical", "PageSpeed optimization"), // -2 days
      change("2026-04-08", "content", "Added comparison table"), // -4 days (7-day window)
      change("2026-04-05", "content", "Added FAQ to /about"), // -7 days
      change("2026-04-01", "page", "Created new page"), // -11 days (14-day only)
      change("2026-03-15", "content", "Old change"), // outside 14-day
    ];

    const windows = buildEventWindows({ spike, changelog });

    expect(windows.oneDay.length).toBe(1); // -1
    expect(windows.threeDays.length).toBe(2); // -1, -2
    expect(windows.sevenDays.length).toBe(4); // -1, -2, -4, -7
    expect(windows.fourteenDays.length).toBe(5); // -1, -2, -4, -7, -11
  });
});

// ---------------------------------------------------------------------------
// Attribution tests
// ---------------------------------------------------------------------------

describe("attributeSpike", () => {
  it("classifies as isolated when one cluster dominates the 1-day window", () => {
    const windows = {
      oneDay: [
        mockWindow(1, "faq_schema", "Added FAQPage schema"),
        mockWindow(1, "faq_schema", "Sitewide FAQ schema deployment"),
        mockWindow(1, "faq_schema", "Added FAQ to homepage"),
      ],
      threeDays: [
        mockWindow(1, "faq_schema", "Added FAQPage schema"),
        mockWindow(1, "faq_schema", "Sitewide FAQ schema deployment"),
        mockWindow(1, "faq_schema", "Added FAQ to homepage"),
      ],
      sevenDays: [
        mockWindow(1, "faq_schema", "Added FAQPage schema"),
        mockWindow(1, "faq_schema", "Sitewide FAQ schema deployment"),
        mockWindow(1, "faq_schema", "Added FAQ to homepage"),
      ],
      fourteenDays: [
        mockWindow(1, "faq_schema", "Added FAQPage schema"),
        mockWindow(1, "faq_schema", "Sitewide FAQ schema deployment"),
        mockWindow(1, "faq_schema", "Added FAQ to homepage"),
      ],
    };

    const { attributions, verdict } = attributeSpike(windows);
    expect(verdict).toBe("isolated");
    expect(attributions.length).toBeGreaterThanOrEqual(1);
    expect(attributions[0].role).toBe("likely_primary_trigger");
    expect(attributions[0].cluster).toBe("faq_schema");
  });

  it("classifies as multi_trigger when 2+ clusters have primary-level activity", () => {
    const windows = {
      oneDay: [
        mockWindow(1, "faq_schema", "FAQ schema"),
        mockWindow(1, "faq_schema", "FAQ schema 2"),
        mockWindow(1, "technical_rendering", "PageSpeed"),
        mockWindow(1, "technical_rendering", "SSG prerender"),
      ],
      threeDays: [
        mockWindow(1, "faq_schema", "FAQ schema"),
        mockWindow(1, "faq_schema", "FAQ schema 2"),
        mockWindow(1, "technical_rendering", "PageSpeed"),
        mockWindow(1, "technical_rendering", "SSG prerender"),
      ],
      sevenDays: [
        mockWindow(1, "faq_schema", "FAQ schema"),
        mockWindow(1, "faq_schema", "FAQ schema 2"),
        mockWindow(1, "technical_rendering", "PageSpeed"),
        mockWindow(1, "technical_rendering", "SSG prerender"),
      ],
      fourteenDays: [
        mockWindow(1, "faq_schema", "FAQ schema"),
        mockWindow(1, "faq_schema", "FAQ schema 2"),
        mockWindow(1, "technical_rendering", "PageSpeed"),
        mockWindow(1, "technical_rendering", "SSG prerender"),
      ],
    };

    const { verdict, attributions } = attributeSpike(windows);
    expect(verdict).toBe("multi_trigger");
    const primaries = attributions.filter((a) => a.role === "likely_primary_trigger");
    expect(primaries.length).toBeGreaterThanOrEqual(2);
  });

  it("classifies as snowball when only amplifiers exist across wider windows", () => {
    const windows = {
      oneDay: [],
      threeDays: [],
      sevenDays: [
        mockWindow(5, "faq_schema", "FAQ schema"),
        mockWindow(6, "faq_schema", "FAQ schema 2"),
        mockWindow(5, "content_structure", "Comparison table"),
        mockWindow(6, "content_structure", "Neighborhoods section"),
      ],
      fourteenDays: [
        mockWindow(5, "faq_schema", "FAQ schema"),
        mockWindow(6, "faq_schema", "FAQ schema 2"),
        mockWindow(5, "content_structure", "Comparison table"),
        mockWindow(6, "content_structure", "Neighborhoods section"),
        mockWindow(12, "page_launch", "Page launch"),
      ],
    };

    const { verdict } = attributeSpike(windows);
    expect(verdict).toBe("snowball");
  });

  it("classifies as insufficient when fewer than 2 changes in 14-day window", () => {
    const windows = {
      oneDay: [],
      threeDays: [],
      sevenDays: [],
      fourteenDays: [mockWindow(10, "other", "Some change")],
    };

    const { verdict } = attributeSpike(windows);
    expect(verdict).toBe("insufficient");
  });
});

function mockWindow(daysBefore: number, cluster: string, description: string) {
  return {
    changeId: `c-${Math.random()}`,
    timestamp: "2026-04-01T00:00:00Z",
    daysBeforeSpike: daysBefore,
    cluster: cluster as "faq_schema" | "technical_rendering" | "content_structure" | "page_launch" | "other",
    signalType: "faq",
    assetType: "infrastructure",
    url: null,
    description,
    topicTargeted: "Test",
  };
}

// ---------------------------------------------------------------------------
// End-to-end analyzeSpike test — replicates a known pattern
// ---------------------------------------------------------------------------

describe("analyzeSpike — end-to-end", () => {
  it("produces a ChatGPT stepwise interpretation with FAQ schema as primary trigger", () => {
    // Replicate the real Apr 10-14 ChatGPT pattern:
    // Baseline ~20 citations, spike to 60+ after FAQ schema deployment
    const snaps: DailyMetricSnapshot[] = [];
    // Baseline days
    for (let i = 0; i < 7; i++) {
      const d = `2026-04-0${3 + i}`;
      snaps.push(snap(d, "ChatGPT", 20, 10));
    }
    // Spike days — Apr 12 onward
    snaps.push(snap("2026-04-12", "ChatGPT", 39, 20));
    snaps.push(snap("2026-04-13", "ChatGPT", 57, 30));
    snaps.push(snap("2026-04-14", "ChatGPT", 62, 32));

    const spikes = detectSpikes({ snapshots: snaps, metric: "citations" });
    expect(spikes.length).toBeGreaterThanOrEqual(1);
    const spike = spikes[0];

    // Realistic changelog: FAQ schema burst Apr 10-12, no other changes
    const changelog = [
      change("2026-04-10", "technical", "Added FAQPage JSON-LD schema to every sitemap page", ""),
      change("2026-04-10", "technical", "Added FAQPage JSON-LD schema matching visible FAQ content on /about-us", ""),
      change("2026-04-11", "technical", "Sitewide FAQPage schema rollout for /locations pages", ""),
      change("2026-04-12", "technical", "Removed duplicate FAQPage JSON-LD blocks on homepage", ""),
    ];

    const report = analyzeSpike({ spike, changelog });

    expect(report.spike.platform).toBe("chatgpt");
    expect(report.interpretation).toBe("stepwise_threshold");
    expect(report.verdict).toMatch(/isolated|multi_trigger/);
    const faqAttribution = report.attributions.find((a) => a.cluster === "faq_schema");
    expect(faqAttribution).toBeDefined();
    expect(faqAttribution!.role).toBe("likely_primary_trigger");
    expect(report.explanation).toContain("ChatGPT");
    expect(report.explanation).not.toContain("caused");
    expect(report.explanation).not.toContain("proved");
  });
});
