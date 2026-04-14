import { describe, it, expect } from "vitest";
import {
  computeMemoryInsights,
  type MemoryInsight,
} from "./memory";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

let _entryId = 0;
function makeChange(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  _entryId++;
  return {
    id: `change-${_entryId}`,
    timestamp: "2026-03-01T12:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "/services/kitchen-remodel",
    asset_name: "Kitchen Remodel Page",
    change_description: "Added FAQ section about timeline and pricing",
    topic_targeted: "kitchen remodel",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-03-01T12:00:00Z",
    updated_at: "2026-03-01T12:00:00Z",
    ...overrides,
  };
}

let _snapId = 0;
function makeSnapshot(
  overrides: Partial<DailyMetricSnapshot> = {},
): DailyMetricSnapshot {
  _snapId++;
  return {
    id: `snap-${_snapId}`,
    date: "2026-03-10",
    scope_type: "topic",
    scope_id: "kitchen remodel",
    platform: "chatgpt",
    source_type: "derived",
    visibility_score: null,
    mention_count: 1,
    citation_count: 0,
    share_of_voice: null,
    avg_position: null,
    total_possible: null,
    metadata: {},
    ...overrides,
  };
}

/**
 * Generate snapshots for a range of dates.
 * `startDate` is inclusive, generates `numDays` consecutive days.
 */
function makeSnapshotsForDays(opts: {
  topic: string;
  startDate: string;
  numDays: number;
  mentionCount?: number;
  citationCount?: number;
  platform?: string;
}): DailyMetricSnapshot[] {
  const snapshots: DailyMetricSnapshot[] = [];
  const start = new Date(opts.startDate + "T00:00:00Z");
  for (let i = 0; i < opts.numDays; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    snapshots.push(
      makeSnapshot({
        date: dateStr,
        scope_id: opts.topic,
        mention_count: opts.mentionCount ?? 1,
        citation_count: opts.citationCount ?? 0,
        platform: opts.platform ?? "chatgpt",
      }),
    );
  }
  return snapshots;
}

// Helper: add days to a date string
function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeMemoryInsights", () => {
  // A "now" date far enough in the future for most tests
  const NOW = new Date("2026-04-01T12:00:00Z");

  // -----------------------------------------------------------------------
  // Empty / no-data cases
  // -----------------------------------------------------------------------

  it("returns empty array when no changes exist", () => {
    const result = computeMemoryInsights({
      changes: [],
      snapshots: [],
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("returns empty when changes have no topic_targeted", () => {
    const result = computeMemoryInsights({
      changes: [makeChange({ topic_targeted: "" })],
      snapshots: makeSnapshotsForDays({
        topic: "",
        startDate: "2026-02-20",
        numDays: 30,
      }),
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Filtering: signal types & tooling URLs
  // -----------------------------------------------------------------------

  it("filters out 'measurement' signal type", () => {
    const result = computeMemoryInsights({
      changes: [makeChange({ signal_type: "measurement" })],
      snapshots: makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-20",
        numDays: 30,
      }),
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("filters out off-site signal types (review, citation, off_page_seo)", () => {
    for (const signalType of ["review", "citation", "off_page_seo"] as const) {
      const result = computeMemoryInsights({
        changes: [makeChange({ signal_type: signalType })],
        snapshots: makeSnapshotsForDays({
          topic: "kitchen remodel",
          startDate: "2026-02-20",
          numDays: 30,
        }),
        now: NOW,
      });
      expect(result).toEqual([]);
    }
  });

  it("filters out tooling URLs (Profound, Google Business Profile, etc.)", () => {
    const toolingUrls = [
      "Profound dashboard",
      "Google Business Profile",
      "Yelp listing",
      "Houzz profile",
      "BuildZoom page",
      "Facebook page",
      "Bing Places listing",
      "LinkedIn company",
      "Instagram profile",
      "Nextdoor page",
      "BBB listing",
    ];
    for (const url of toolingUrls) {
      const result = computeMemoryInsights({
        changes: [
          makeChange({
            url,
            signal_type: "content",
          }),
        ],
        snapshots: makeSnapshotsForDays({
          topic: "kitchen remodel",
          startDate: "2026-02-20",
          numDays: 30,
        }),
        now: NOW,
      });
      expect(result).toEqual([]);
    }
  });

  // -----------------------------------------------------------------------
  // Inclusion: page-path & site-wide changes
  // -----------------------------------------------------------------------

  it("includes page-path changes (/services/foo)", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      // Before window: 7 days before change (Feb 22 - Feb 28)
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      // After window: 7 days after change (Mar 02 - Mar 08)
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 4,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [
        makeChange({
          timestamp: changeDate + "T12:00:00Z",
          url: "/services/kitchen-remodel",
        }),
      ],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    expect(result[0].pagePath).toBe("/services/kitchen-remodel");
  });

  it("includes site-wide changes (All Pages, Sitewide navigation)", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 4,
      }),
    ];

    for (const url of ["All Pages", "Sitewide navigation"]) {
      const result = computeMemoryInsights({
        changes: [
          makeChange({
            timestamp: changeDate + "T12:00:00Z",
            url,
          }),
        ],
        snapshots,
        now: NOW,
      });
      expect(result.length).toBe(1);
    }
  });

  // -----------------------------------------------------------------------
  // Minimum data requirements
  // -----------------------------------------------------------------------

  it("returns empty when insufficient before-window days (< 3 distinct days)", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      // Only 2 before days
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-27",
        numDays: 2,
        mentionCount: 2,
      }),
      // Enough after days
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 4,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("returns empty when insufficient after-window days (< 5 distinct days)", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      // Enough before days
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      // Only 4 after days
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 4,
        mentionCount: 4,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("returns empty when insufficient observations per window (< 3)", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      // 3 distinct before days but only 2 total snapshots (one day has two
      // snapshots, but that won't help if total < 3). Actually let's make
      // it 3 days with 1 snap each = 3 snaps, that's fine.
      // For this test: before has enough days but after has < 3 observations.
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      // 5 distinct after days but only 2 snapshots total
      makeSnapshot({
        date: "2026-03-02",
        scope_id: "kitchen remodel",
        mention_count: 4,
      }),
      makeSnapshot({
        date: "2026-03-03",
        scope_id: "kitchen remodel",
        mention_count: 4,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });
    // After window has only 2 observations and 2 distinct days — fails both checks
    expect(result).toEqual([]);
  });

  it("requires change to be at least MIN_AFTER_DAYS (5) old", () => {
    const now = new Date("2026-03-04T12:00:00Z"); // Only 3 days after change
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 14,
        mentionCount: 2,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now,
    });
    expect(result).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Direction classification
  // -----------------------------------------------------------------------

  function makeScenarioWithMentions(
    beforeMentions: number,
    afterMentions: number,
  ) {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: beforeMentions,
        citationCount: 0,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: afterMentions,
        citationCount: 0,
      }),
    ];
    return computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });
  }

  it("classifies direction as 'improving' when mentions increase >= 15%", () => {
    // 2 -> 4 = +100% -> improving
    const result = makeScenarioWithMentions(2, 4);
    expect(result.length).toBe(1);
    expect(result[0].direction).toBe("improving");
  });

  it("classifies direction as 'declining' when mentions decrease <= -15%", () => {
    // 4 -> 2 = -50% -> declining
    const result = makeScenarioWithMentions(4, 2);
    expect(result.length).toBe(1);
    expect(result[0].direction).toBe("declining");
  });

  it("classifies direction as 'stable' when change is within +-15%", () => {
    // 10 -> 11 = +10% -> stable
    const result = makeScenarioWithMentions(10, 11);
    expect(result.length).toBe(1);
    expect(result[0].direction).toBe("stable");
  });

  it("uses citation delta as primary when citations exist", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      // Before: mentions high, citations low
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 10,
        citationCount: 2,
      }),
      // After: mentions same, citations much higher
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 10,
        citationCount: 5,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    // Citation delta = (5-2)/2 = 150% -> improving
    expect(result[0].direction).toBe("improving");
  });

  // -----------------------------------------------------------------------
  // Metrics computation: per-day aggregation across platforms
  // -----------------------------------------------------------------------

  it("correctly computes before/after averages with per-day aggregation across platforms", () => {
    const changeDate = "2026-03-01";
    const beforeDays = 5;
    const afterDays = 6;

    // Two platforms for the before window
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-24",
        numDays: beforeDays,
        mentionCount: 2,
        platform: "chatgpt",
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-24",
        numDays: beforeDays,
        mentionCount: 3,
        platform: "perplexity",
      }),
      // Two platforms for after window
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: afterDays,
        mentionCount: 4,
        platform: "chatgpt",
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: afterDays,
        mentionCount: 6,
        platform: "perplexity",
      }),
    ];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    // Before: each day has 2 + 3 = 5 mentions. Avg across 5 days = 5.
    expect(result[0].metricsBefore.avgMentions).toBe(5);
    // After: each day has 4 + 6 = 10 mentions. Avg across 6 days = 10.
    expect(result[0].metricsAfter.avgMentions).toBe(10);
    // Total observations: before = 5 * 2 = 10, after = 6 * 2 = 12
    expect(result[0].metricsBefore.totalObservations).toBe(10);
    expect(result[0].metricsAfter.totalObservations).toBe(12);
  });

  // -----------------------------------------------------------------------
  // Deduplication & sorting
  // -----------------------------------------------------------------------

  it("deduplicates by topic (keeps first seen after sort — most impactful)", () => {
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-15",
        numDays: 40,
        mentionCount: 3,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [
        makeChange({
          id: "older",
          timestamp: "2026-02-25T12:00:00Z",
          topic_targeted: "kitchen remodel",
        }),
        makeChange({
          id: "newer",
          timestamp: "2026-03-01T12:00:00Z",
          topic_targeted: "kitchen remodel",
        }),
      ],
      snapshots,
      now: NOW,
    });

    // Both target same topic, only one should remain
    expect(result.length).toBe(1);
  });

  it("sorts by direction: improving first, then declining, then stable", () => {
    const makeScenario = (
      topic: string,
      beforeMentions: number,
      afterMentions: number,
    ) => {
      const changeDate = "2026-03-01";
      return {
        change: makeChange({
          timestamp: changeDate + "T12:00:00Z",
          topic_targeted: topic,
          url: `/services/${topic.replace(/\s+/g, "-")}`,
        }),
        snapshots: [
          ...makeSnapshotsForDays({
            topic,
            startDate: "2026-02-22",
            numDays: 7,
            mentionCount: beforeMentions,
          }),
          ...makeSnapshotsForDays({
            topic,
            startDate: "2026-03-02",
            numDays: 7,
            mentionCount: afterMentions,
          }),
        ],
      };
    };

    const stable = makeScenario("stable topic", 10, 11); // +10% = stable
    const improving = makeScenario("improving topic", 2, 4); // +100% = improving
    const declining = makeScenario("declining topic", 4, 2); // -50% = declining

    const result = computeMemoryInsights({
      changes: [stable.change, declining.change, improving.change],
      snapshots: [
        ...stable.snapshots,
        ...declining.snapshots,
        ...improving.snapshots,
      ],
      now: NOW,
    });

    expect(result.length).toBe(3);
    expect(result[0].direction).toBe("improving");
    expect(result[1].direction).toBe("declining");
    expect(result[2].direction).toBe("stable");
  });

  // -----------------------------------------------------------------------
  // Headline generation
  // -----------------------------------------------------------------------

  it("generates correct headline text for improving direction", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 4,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [
        makeChange({
          timestamp: changeDate + "T12:00:00Z",
          url: "/services/kitchen-remodel",
        }),
      ],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    expect(result[0].headline).toContain("days ago");
    expect(result[0].headline).toContain("/services/kitchen-remodel");
    expect(result[0].headline).toContain("up");
    expect(result[0].headline).toContain("mentions");
  });

  it("generates correct headline text for declining direction", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 4,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 2,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [
        makeChange({
          timestamp: changeDate + "T12:00:00Z",
          url: "/services/kitchen-remodel",
        }),
      ],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    expect(result[0].headline).toContain("down");
    expect(result[0].headline).toContain("worth investigating");
  });

  it("generates correct headline text for stable direction", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 10,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 11,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [
        makeChange({
          timestamp: changeDate + "T12:00:00Z",
          url: "/services/kitchen-remodel",
        }),
      ],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    expect(result[0].headline).toContain("holding steady");
  });

  // -----------------------------------------------------------------------
  // Trend line
  // -----------------------------------------------------------------------

  it("builds trend line with correct number of points", () => {
    const changeDate = "2026-03-01";
    const beforeSnaps = makeSnapshotsForDays({
      topic: "kitchen remodel",
      startDate: "2026-02-22",
      numDays: 7,
      mentionCount: 2,
    });
    const afterSnaps = makeSnapshotsForDays({
      topic: "kitchen remodel",
      startDate: "2026-03-02",
      numDays: 7,
      mentionCount: 4,
    });
    const snapshots = [...beforeSnaps, ...afterSnaps];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    // Total unique dates = 14 (7 before + 7 after)
    expect(result[0].trendLine.length).toBe(14);
    // Each point should have date, mentions, citations
    for (const point of result[0].trendLine) {
      expect(point).toHaveProperty("date");
      expect(point).toHaveProperty("mentions");
      expect(point).toHaveProperty("citations");
    }
  });

  it("sets correct changeIndex for the trend line", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 4,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    // changeDate is 2026-03-01. The before dates are Feb 22-28, after dates Mar 02-08.
    // changeIndex = first date >= 2026-03-01 = 2026-03-02 which is index 7 (0-based)
    expect(result[0].changeIndex).toBe(7);
  });

  // -----------------------------------------------------------------------
  // isSiteChange integration
  // -----------------------------------------------------------------------

  it("treats null URL as site-wide change (included)", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 4,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [
        makeChange({
          timestamp: changeDate + "T12:00:00Z",
          url: null,
        }),
      ],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    expect(result[0].pagePath).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Topic normalization and fuzzy matching
  // -----------------------------------------------------------------------

  it("normalizes topic keys: strips (Bay Area) and Shield: prefix", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 4,
      }),
    ];

    // Change uses "Shield: Kitchen Remodel (Bay Area)" but snapshots use "kitchen remodel"
    const result = computeMemoryInsights({
      changes: [
        makeChange({
          timestamp: changeDate + "T12:00:00Z",
          topic_targeted: "Shield: Kitchen Remodel (Bay Area)",
        }),
      ],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    expect(result[0].topicTargeted).toBe(
      "Shield: Kitchen Remodel (Bay Area)",
    );
  });

  // -----------------------------------------------------------------------
  // Output shape
  // -----------------------------------------------------------------------

  it("returns all expected fields on a MemoryInsight", () => {
    const changeDate = "2026-03-01";
    const snapshots = [
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-02-22",
        numDays: 7,
        mentionCount: 2,
      }),
      ...makeSnapshotsForDays({
        topic: "kitchen remodel",
        startDate: "2026-03-02",
        numDays: 7,
        mentionCount: 4,
      }),
    ];

    const result = computeMemoryInsights({
      changes: [makeChange({ timestamp: changeDate + "T12:00:00Z" })],
      snapshots,
      now: NOW,
    });

    expect(result.length).toBe(1);
    const insight = result[0];

    expect(insight).toHaveProperty("changeId");
    expect(insight).toHaveProperty("changeDescription");
    expect(insight).toHaveProperty("changeSummary");
    expect(insight).toHaveProperty("pageUrl");
    expect(insight).toHaveProperty("pagePath");
    expect(insight).toHaveProperty("topicTargeted");
    expect(insight).toHaveProperty("changedAt");
    expect(insight).toHaveProperty("daysSince");
    expect(insight).toHaveProperty("direction");
    expect(insight).toHaveProperty("headline");
    expect(insight).toHaveProperty("detail");
    expect(insight).toHaveProperty("metricsBefore");
    expect(insight).toHaveProperty("metricsAfter");
    expect(insight).toHaveProperty("platformBreakdown");
    expect(insight).toHaveProperty("trendLine");
    expect(insight).toHaveProperty("changeIndex");

    expect(typeof insight.daysSince).toBe("number");
    expect(insight.daysSince).toBe(31); // Mar 1 -> Apr 1
  });
});
