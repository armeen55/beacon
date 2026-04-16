/**
 * Visibility-events attribution tests — E1.2.
 *
 * Exercises the new triage.ts-based attribution pipeline:
 *   - Synthesized attribution matches score through computeConfidenceScore
 *   - triageCandidates classifies candidates into tiers
 *   - Cluster-level aggregation maps tiers to cluster roles
 *   - Cluster-burst fallback handles tight bursts triage scores conservatively
 *   - Verdict classification derives from aggregated cluster roles
 */

import { describe, it, expect } from "vitest";
import {
  attributeEventViaTriage,
  buildSpikeAttributionCandidates,
} from "@/domains/visibility-events/attribute";
import type { Spike, WindowedChange } from "@/domains/visibility-events/types";
import type { ChangelogEntry } from "@/domains/changelog/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChange(
  id: string,
  timestamp: string,
  signal_type: string,
  asset_type: string,
  description: string,
  topic: string,
  url: string | null = null,
  city: string | null = null,
): ChangelogEntry {
  return {
    id,
    timestamp: `${timestamp}T12:00:00Z`,
    signal_type: signal_type as ChangelogEntry["signal_type"],
    asset_type: asset_type as ChangelogEntry["asset_type"],
    url,
    asset_name: "Test",
    change_description: description,
    topic_targeted: topic,
    city_targeted: city,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: `${timestamp}T12:00:00Z`,
    updated_at: `${timestamp}T12:00:00Z`,
  };
}

function makeWindowed(
  changeId: string,
  daysBeforeSpike: number,
  cluster: WindowedChange["cluster"],
  description = "",
  topic = "Custom Home Builder Bay Area",
): WindowedChange {
  return {
    changeId,
    timestamp: "2026-04-01T12:00:00Z",
    daysBeforeSpike,
    cluster,
    signalType: "technical",
    assetType: "infrastructure",
    url: null,
    description,
    topicTargeted: topic,
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

function mapById(changes: ChangelogEntry[]): Map<string, ChangelogEntry> {
  return new Map(changes.map((c) => [c.id, c]));
}

// ---------------------------------------------------------------------------
// Insufficient
// ---------------------------------------------------------------------------

describe("attributeEventViaTriage — insufficient", () => {
  it("returns insufficient when fewer than 2 changes in window", () => {
    const spike = makeSpike();
    const changes = [
      makeChange(
        "c1",
        "2026-04-10",
        "technical",
        "infrastructure",
        "One small change",
        "Custom Home Builder Bay Area",
      ),
    ];
    const windowed = [makeWindowed("c1", 3, "faq_schema", "One small change")];
    const result = attributeEventViaTriage({
      windowedChanges: windowed,
      spike,
      changelogById: mapById(changes),
    });
    expect(result.verdict).toBe("insufficient");
    expect(result.attributions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Isolated — strong single cluster
// ---------------------------------------------------------------------------

describe("attributeEventViaTriage — isolated", () => {
  it("marks a single dominant cluster as likely_primary_trigger when topic matches", () => {
    const spike = makeSpike({ scopeId: "Custom Home Builder Bay Area" });
    const changes = [
      makeChange(
        "c1",
        "2026-04-10",
        "faq",
        "city_page",
        "Added 6-question FAQ to /locations/palo-alto",
        "Custom Home Builder Bay Area",
      ),
      makeChange(
        "c2",
        "2026-04-11",
        "faq",
        "city_page",
        "Added FAQPage schema to /locations/atherton",
        "Custom Home Builder Bay Area",
      ),
      makeChange(
        "c3",
        "2026-04-11",
        "faq",
        "city_page",
        "Added FAQPage schema to /locations/menlo-park",
        "Custom Home Builder Bay Area",
      ),
    ];
    const windowed = [
      makeWindowed("c1", 3, "faq_schema", "Added FAQ to /palo-alto"),
      makeWindowed("c2", 2, "faq_schema", "Added FAQPage schema"),
      makeWindowed("c3", 2, "faq_schema", "Added FAQPage schema"),
    ];

    const result = attributeEventViaTriage({
      windowedChanges: windowed,
      spike,
      changelogById: mapById(changes),
    });
    expect(result.verdict).toBe("isolated");
    expect(result.attributions.length).toBeGreaterThanOrEqual(1);
    const faq = result.attributions.find((a) => a.cluster === "faq_schema");
    expect(faq).toBeDefined();
    expect(faq!.role).toBe("likely_primary_trigger");
  });
});

// ---------------------------------------------------------------------------
// Cluster-burst fallback — infrastructure changes with empty topic
// ---------------------------------------------------------------------------

describe("attributeEventViaTriage — cluster-burst fallback", () => {
  it("promotes a 3+ change burst within 3 days even when individual candidates score low (sparse topic data)", () => {
    const spike = makeSpike();
    // Infrastructure changes with empty topic — triage will not pick a
    // primary because topic match is unknown for every candidate. The
    // cluster-burst fallback must step in.
    const changes = [
      makeChange(
        "c1",
        "2026-04-10",
        "technical",
        "infrastructure",
        "Added FAQPage JSON-LD schema to every sitemap page",
        "",
      ),
      makeChange(
        "c2",
        "2026-04-11",
        "technical",
        "infrastructure",
        "Sitewide FAQPage schema rollout for /locations pages",
        "",
      ),
      makeChange(
        "c3",
        "2026-04-11",
        "technical",
        "infrastructure",
        "Added FAQPage schema to /about-us",
        "",
      ),
      makeChange(
        "c4",
        "2026-04-12",
        "technical",
        "infrastructure",
        "Removed duplicate FAQPage JSON-LD blocks on homepage",
        "",
      ),
    ];
    const windowed = [
      makeWindowed("c1", 3, "faq_schema", "Sitewide FAQ schema", ""),
      makeWindowed("c2", 2, "faq_schema", "FAQ rollout /locations", ""),
      makeWindowed("c3", 2, "faq_schema", "FAQ on /about-us", ""),
      makeWindowed("c4", 1, "faq_schema", "Dedup FAQ blocks", ""),
    ];
    const result = attributeEventViaTriage({
      windowedChanges: windowed,
      spike,
      changelogById: mapById(changes),
    });
    expect(result.verdict).toBe("isolated");
    const faq = result.attributions.find((a) => a.cluster === "faq_schema");
    expect(faq).toBeDefined();
    expect(faq!.role).toBe("likely_primary_trigger");
    expect(faq!.rationale).toMatch(/burst|proximity|primary/i);
  });

  it("promotes 2+ changes in the 1-day window to likely_primary_trigger", () => {
    const spike = makeSpike();
    const changes = [
      makeChange(
        "c1",
        "2026-04-12",
        "technical",
        "infrastructure",
        "SSG prerender deployed",
        "",
      ),
      makeChange(
        "c2",
        "2026-04-12",
        "technical",
        "infrastructure",
        "Sitewide PageSpeed optimization",
        "",
      ),
    ];
    const windowed = [
      makeWindowed("c1", 1, "technical_rendering", "SSG prerender", ""),
      makeWindowed("c2", 1, "technical_rendering", "PageSpeed", ""),
    ];
    const result = attributeEventViaTriage({
      windowedChanges: windowed,
      spike,
      changelogById: mapById(changes),
    });
    const tech = result.attributions.find(
      (a) => a.cluster === "technical_rendering",
    );
    expect(tech).toBeDefined();
    expect(tech!.role).toBe("likely_primary_trigger");
  });
});

// ---------------------------------------------------------------------------
// Multi-trigger
// ---------------------------------------------------------------------------

describe("attributeEventViaTriage — multi_trigger", () => {
  it("classifies as multi_trigger when 2+ clusters both burst in the 3-day window", () => {
    const spike = makeSpike();
    const changes = [
      makeChange(
        "c1",
        "2026-04-10",
        "technical",
        "infrastructure",
        "Added FAQPage JSON-LD schema",
        "",
      ),
      makeChange(
        "c2",
        "2026-04-11",
        "technical",
        "infrastructure",
        "Sitewide FAQPage schema rollout",
        "",
      ),
      makeChange(
        "c3",
        "2026-04-11",
        "technical",
        "infrastructure",
        "Homepage FAQPage schema",
        "",
      ),
      makeChange(
        "c4",
        "2026-04-10",
        "technical",
        "infrastructure",
        "SSG prerender deployed sitewide",
        "",
      ),
      makeChange(
        "c5",
        "2026-04-11",
        "technical",
        "infrastructure",
        "PageSpeed LCP optimization",
        "",
      ),
      makeChange(
        "c6",
        "2026-04-11",
        "technical",
        "infrastructure",
        "Canonical redirect fix",
        "",
      ),
    ];
    const windowed = [
      makeWindowed("c1", 3, "faq_schema", "FAQ schema 1", ""),
      makeWindowed("c2", 2, "faq_schema", "FAQ rollout", ""),
      makeWindowed("c3", 2, "faq_schema", "Homepage FAQ", ""),
      makeWindowed("c4", 3, "technical_rendering", "SSG", ""),
      makeWindowed("c5", 2, "technical_rendering", "PageSpeed", ""),
      makeWindowed("c6", 2, "technical_rendering", "Canonical", ""),
    ];
    const result = attributeEventViaTriage({
      windowedChanges: windowed,
      spike,
      changelogById: mapById(changes),
    });
    expect(result.verdict).toBe("multi_trigger");
    const primaries = result.attributions.filter(
      (a) => a.role === "likely_primary_trigger",
    );
    expect(primaries.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Snowball — wider-window activity only
// ---------------------------------------------------------------------------

describe("attributeEventViaTriage — snowball", () => {
  it("classifies as snowball when no cluster meets burst thresholds but activity exists", () => {
    const spike = makeSpike();
    const changes = [
      makeChange(
        "c1",
        "2026-04-05",
        "content",
        "city_page",
        "Added neighborhoods section",
        "",
      ),
      makeChange(
        "c2",
        "2026-04-03",
        "faq",
        "city_page",
        "Added small FAQ",
        "",
      ),
      makeChange(
        "c3",
        "2026-04-01",
        "page",
        "city_page",
        "Rebuilt city page",
        "",
      ),
    ];
    const windowed = [
      makeWindowed("c1", 8, "content_structure", "Neighborhoods", ""),
      makeWindowed("c2", 10, "faq_schema", "Small FAQ", ""),
      makeWindowed("c3", 12, "page_launch", "Rebuild", ""),
    ];
    const result = attributeEventViaTriage({
      windowedChanges: windowed,
      spike,
      changelogById: mapById(changes),
    });
    // With 3 clusters each at weak tier and no burst, the verdict should
    // not be "isolated". Acceptable outcomes: snowball or insufficient
    // depending on triage tiering.
    expect(["snowball", "insufficient"]).toContain(result.verdict);
  });
});

// ---------------------------------------------------------------------------
// Candidate construction — direct tests
// ---------------------------------------------------------------------------

describe("buildSpikeAttributionCandidates", () => {
  it("produces one candidate per windowed change with a non-null score", () => {
    const spike = makeSpike();
    const changes = [
      makeChange(
        "c1",
        "2026-04-11",
        "faq",
        "city_page",
        "FAQ added",
        "Custom Home Builder Bay Area",
      ),
      makeChange(
        "c2",
        "2026-04-12",
        "technical",
        "infrastructure",
        "Schema rollout",
        "",
      ),
    ];
    const windowed = [
      makeWindowed("c1", 2, "faq_schema", "FAQ", "Custom Home Builder Bay Area"),
      makeWindowed("c2", 1, "faq_schema", "Schema rollout", ""),
    ];
    const candidates = buildSpikeAttributionCandidates({
      windowedChanges: windowed,
      spike,
      changelogById: mapById(changes),
    });
    expect(candidates.length).toBe(2);
    for (const c of candidates) {
      expect(c.score).toBeGreaterThan(0);
      expect(c.change).toBeDefined();
      expect(c.attribution).toBeDefined();
      expect(c.attribution.matches.temporal).toBe("strong");
    }
  });

  it("scores a matching-topic change higher than an empty-topic change", () => {
    const spike = makeSpike({ scopeId: "Custom Home Builder Bay Area" });
    const changes = [
      makeChange(
        "c1",
        "2026-04-11",
        "faq",
        "city_page",
        "FAQ matching topic",
        "Custom Home Builder Bay Area",
      ),
      makeChange(
        "c2",
        "2026-04-11",
        "technical",
        "infrastructure",
        "Empty topic change",
        "",
      ),
    ];
    const windowed = [
      makeWindowed("c1", 2, "faq_schema", "matching", "Custom Home Builder Bay Area"),
      makeWindowed("c2", 2, "faq_schema", "empty", ""),
    ];
    const candidates = buildSpikeAttributionCandidates({
      windowedChanges: windowed,
      spike,
      changelogById: mapById(changes),
    });
    expect(candidates.length).toBe(2);
    const matchedScore = candidates.find((c) => c.change.id === "c1")!.score;
    const emptyScore = candidates.find((c) => c.change.id === "c2")!.score;
    expect(matchedScore).toBeGreaterThan(emptyScore);
  });
});
