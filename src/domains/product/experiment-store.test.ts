/**
 * Experiment Store — noise floor tests.
 *
 * Verifies that experiment status transitions require sustained signal
 * above a noise threshold, not just any positive/negative delta.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  sustainedDirection,
  MIN_DELTA_PCT,
  MIN_SUSTAINED_POINTS,
  MIN_DAYS_FOR_VERDICT,
  type TimelineEntry,
  type Experiment,
  type ExperimentStatus,
} from "./experiment-store";

// ---------------------------------------------------------------------------
// Helper: build a minimal experiment for testing
// ---------------------------------------------------------------------------

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "exp-test",
    recId: "rec-test",
    headline: "Test experiment",
    recType: "replicate",
    targetPageUrl: null,
    targetPagePath: "/test-page",
    watchAfter: "Watch after shipping",
    operatorNote: "Testing",
    startedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), // 20 days ago
    status: "watching",
    baselineCitations: 100,
    latestCitations: null,
    lastCheckedAt: null,
    baselineMentions: 5,
    latestMentions: null,
    baselineVisibility: 40,
    latestVisibility: null,
    trackedTopic: "test topic",
    timeline: [],
    tenant_id: "tenant-test",
    ...overrides,
  };
}

function makeTimeline(
  entries: { date: string; citations: number; mentions?: number }[],
): TimelineEntry[] {
  return entries.map((e) => ({
    date: e.date,
    citations: e.citations,
    mentions: e.mentions ?? 5,
    visibility: 40,
    status: "watching" as ExperimentStatus,
    confidence: "low" as const,
  }));
}

// ---------------------------------------------------------------------------
// sustainedDirection
// ---------------------------------------------------------------------------

describe("sustainedDirection", () => {
  it("returns false when fewer than minPoints entries exist", () => {
    const timeline = makeTimeline([
      { date: "2026-04-01", citations: 100 },
      { date: "2026-04-02", citations: 105 },
    ]);
    expect(sustainedDirection(timeline, "up", 3)).toBe(false);
  });

  it("returns true for sustained upward direction", () => {
    const timeline = makeTimeline([
      { date: "2026-04-01", citations: 100 },
      { date: "2026-04-02", citations: 102 },
      { date: "2026-04-03", citations: 105 },
      { date: "2026-04-04", citations: 108 },
    ]);
    expect(sustainedDirection(timeline, "up", 3)).toBe(true);
  });

  it("returns true for sustained downward direction", () => {
    const timeline = makeTimeline([
      { date: "2026-04-01", citations: 100 },
      { date: "2026-04-02", citations: 97 },
      { date: "2026-04-03", citations: 94 },
      { date: "2026-04-04", citations: 91 },
    ]);
    expect(sustainedDirection(timeline, "down", 3)).toBe(true);
  });

  it("returns false when a dip breaks the upward trend", () => {
    const timeline = makeTimeline([
      { date: "2026-04-01", citations: 100 },
      { date: "2026-04-02", citations: 110 },
      { date: "2026-04-03", citations: 105 }, // dip
      { date: "2026-04-04", citations: 112 },
    ]);
    expect(sustainedDirection(timeline, "up", 3)).toBe(false);
  });

  it("uses only the last N entries", () => {
    const timeline = makeTimeline([
      { date: "2026-04-01", citations: 200 }, // old, high — should be ignored
      { date: "2026-04-02", citations: 100 }, // drop — should be ignored
      { date: "2026-04-03", citations: 102 },
      { date: "2026-04-04", citations: 105 },
      { date: "2026-04-05", citations: 108 },
    ]);
    // Last 3: 102, 105, 108 — sustained up
    expect(sustainedDirection(timeline, "up", 3)).toBe(true);
  });

  it("treats flat (equal) values as sustained direction", () => {
    const timeline = makeTimeline([
      { date: "2026-04-01", citations: 100 },
      { date: "2026-04-02", citations: 100 },
      { date: "2026-04-03", citations: 100 },
    ]);
    // Equal values: each[i] >= each[i-1] for "up", each[i] <= each[i-1] for "down"
    expect(sustainedDirection(timeline, "up", 3)).toBe(true);
    expect(sustainedDirection(timeline, "down", 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario simulations via updateExperimentMetrics
// We can't easily call updateExperimentMetrics directly in unit tests
// because it mutates the module-level `experiments` array and uses Date.now().
// Instead, we test the decision logic inline.
// ---------------------------------------------------------------------------

/**
 * Simulates the status decision logic from updateExperimentMetrics
 * without requiring module-level state mutation.
 */
function simulateStatusDecision(opts: {
  baselineCitations: number;
  latestCitations: number;
  baselineMentions: number;
  latestMentions: number;
  daysSinceStart: number;
  timeline: TimelineEntry[];
}): ExperimentStatus {
  const citDeltaPct =
    opts.baselineCitations > 0
      ? ((opts.latestCitations - opts.baselineCitations) / opts.baselineCitations) * 100
      : 0;
  const menDeltaPct =
    opts.baselineMentions > 0
      ? ((opts.latestMentions - opts.baselineMentions) / opts.baselineMentions) * 100
      : 0;

  if (opts.daysSinceStart < MIN_DAYS_FOR_VERDICT) {
    return "watching";
  }

  if (
    citDeltaPct >= MIN_DELTA_PCT &&
    sustainedDirection(opts.timeline, "up", MIN_SUSTAINED_POINTS)
  ) {
    return "promising";
  }

  if (
    citDeltaPct <= -MIN_DELTA_PCT &&
    sustainedDirection(opts.timeline, "down", MIN_SUSTAINED_POINTS)
  ) {
    return "negative";
  }

  if (
    menDeltaPct >= MIN_DELTA_PCT * 2 &&
    citDeltaPct > -MIN_DELTA_PCT &&
    sustainedDirection(opts.timeline, "up", MIN_SUSTAINED_POINTS)
  ) {
    return "promising";
  }

  if (
    opts.daysSinceStart > 21 &&
    Math.abs(citDeltaPct) < MIN_DELTA_PCT
  ) {
    return "inconclusive";
  }

  return "watching";
}

// ---------------------------------------------------------------------------
// Scenario: Noise (small fluctuation)
// ---------------------------------------------------------------------------

describe("Scenario: Noise — small fluctuation should NOT trigger status change", () => {
  it("0.5% citation increase after 10 days stays watching", () => {
    // Baseline: 1000 citations. Latest: 1005 (+0.5%)
    const timeline = makeTimeline([
      { date: "2026-04-05", citations: 1002 },
      { date: "2026-04-06", citations: 1001 },
      { date: "2026-04-07", citations: 1004 },
      { date: "2026-04-08", citations: 1003 },
      { date: "2026-04-09", citations: 1005 },
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 1005,
      baselineMentions: 5,
      latestMentions: 5.1,
      daysSinceStart: 10,
      timeline,
    });

    expect(status).toBe("watching");
  });

  it("-2% citation decrease after 10 days stays watching", () => {
    const timeline = makeTimeline([
      { date: "2026-04-05", citations: 990 },
      { date: "2026-04-06", citations: 988 },
      { date: "2026-04-07", citations: 985 },
      { date: "2026-04-08", citations: 982 },
      { date: "2026-04-09", citations: 980 },
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 980,
      baselineMentions: 5,
      latestMentions: 4.9,
      daysSinceStart: 10,
      timeline,
    });

    // -2% is below MIN_DELTA_PCT (5%), so not negative — stays watching
    expect(status).toBe("watching");
  });

  it("3% increase after only 3 days stays watching (too early)", () => {
    const timeline = makeTimeline([
      { date: "2026-04-12", citations: 1010 },
      { date: "2026-04-13", citations: 1020 },
      { date: "2026-04-14", citations: 1030 },
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 1030,
      baselineMentions: 5,
      latestMentions: 5.2,
      daysSinceStart: 3,
      timeline,
    });

    expect(status).toBe("watching");
  });

  it("2% fluctuation after 25 days becomes inconclusive", () => {
    const timeline = makeTimeline([
      { date: "2026-03-25", citations: 1010 },
      { date: "2026-03-28", citations: 1005 },
      { date: "2026-04-01", citations: 1015 },
      { date: "2026-04-05", citations: 1008 },
      { date: "2026-04-10", citations: 1020 },
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 1020,
      baselineMentions: 5,
      latestMentions: 5,
      daysSinceStart: 25,
      timeline,
    });

    // +2% is below MIN_DELTA_PCT, and daysSinceStart > 21
    expect(status).toBe("inconclusive");
  });
});

// ---------------------------------------------------------------------------
// Scenario: Real growth (sustained increase above noise floor)
// ---------------------------------------------------------------------------

describe("Scenario: Real growth — sustained increase triggers positive trend", () => {
  it("8% citation increase sustained over 5 points after 10 days → promising", () => {
    const timeline = makeTimeline([
      { date: "2026-04-05", citations: 1020 },
      { date: "2026-04-06", citations: 1035 },
      { date: "2026-04-07", citations: 1050 },
      { date: "2026-04-08", citations: 1065 },
      { date: "2026-04-09", citations: 1080 },
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 1080,
      baselineMentions: 5,
      latestMentions: 5.5,
      daysSinceStart: 10,
      timeline,
    });

    expect(status).toBe("promising");
  });

  it("-7% sustained decline over 4 points after 14 days → negative", () => {
    const timeline = makeTimeline([
      { date: "2026-04-01", citations: 980 },
      { date: "2026-04-04", citations: 960 },
      { date: "2026-04-07", citations: 945 },
      { date: "2026-04-10", citations: 930 },
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 930,
      baselineMentions: 5,
      latestMentions: 4.5,
      daysSinceStart: 14,
      timeline,
    });

    expect(status).toBe("negative");
  });
});

// ---------------------------------------------------------------------------
// Scenario: Fake spike (spike then revert)
// ---------------------------------------------------------------------------

describe("Scenario: Fake spike — spike then revert stays watching", () => {
  it("spike to +10% then back to +1% stays watching (not sustained)", () => {
    const timeline = makeTimeline([
      { date: "2026-04-05", citations: 1050 },
      { date: "2026-04-06", citations: 1100 }, // spike
      { date: "2026-04-07", citations: 1080 }, // starts reverting
      { date: "2026-04-08", citations: 1030 }, // more reversion
      { date: "2026-04-09", citations: 1010 }, // back near baseline
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 1010,
      baselineMentions: 5,
      latestMentions: 5,
      daysSinceStart: 10,
      timeline,
    });

    // +1% delta is below MIN_DELTA_PCT, and direction is NOT sustained up
    expect(status).toBe("watching");
  });

  it("spike to +15% on day 2 then flat — too early to classify", () => {
    const timeline = makeTimeline([
      { date: "2026-04-13", citations: 1050 },
      { date: "2026-04-14", citations: 1150 }, // big spike
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 1150,
      baselineMentions: 5,
      latestMentions: 5.5,
      daysSinceStart: 2,
      timeline,
    });

    // daysSinceStart < MIN_DAYS_FOR_VERDICT
    expect(status).toBe("watching");
  });

  it("10% delta but NOT sustained (zigzag) after 10 days → watching", () => {
    const timeline = makeTimeline([
      { date: "2026-04-05", citations: 1080 },
      { date: "2026-04-06", citations: 1050 }, // dip
      { date: "2026-04-07", citations: 1100 }, // up
      { date: "2026-04-08", citations: 1070 }, // dip
      { date: "2026-04-09", citations: 1100 }, // up
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 1000,
      latestCitations: 1100,
      baselineMentions: 5,
      latestMentions: 5,
      daysSinceStart: 10,
      timeline,
    });

    // +10% delta exceeds MIN_DELTA_PCT, but direction is NOT sustained (zigzag)
    expect(status).toBe("watching");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("zero baseline citations → status stays watching", () => {
    const timeline = makeTimeline([
      { date: "2026-04-05", citations: 5 },
      { date: "2026-04-06", citations: 10 },
      { date: "2026-04-07", citations: 15 },
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 0,
      latestCitations: 15,
      baselineMentions: 0,
      latestMentions: 3,
      daysSinceStart: 10,
      timeline,
    });

    // deltaPct returns 0 when baseline is 0
    expect(status).toBe("watching");
  });

  it("empty timeline stays watching", () => {
    const status = simulateStatusDecision({
      baselineCitations: 100,
      latestCitations: 120,
      baselineMentions: 5,
      latestMentions: 6,
      daysSinceStart: 10,
      timeline: [],
    });

    // sustainedDirection returns false with empty timeline
    expect(status).toBe("watching");
  });

  it("exactly at MIN_DELTA_PCT threshold with sustained direction → promising", () => {
    const timeline = makeTimeline([
      { date: "2026-04-05", citations: 102 },
      { date: "2026-04-06", citations: 103 },
      { date: "2026-04-07", citations: 105 },
    ]);

    const status = simulateStatusDecision({
      baselineCitations: 100,
      latestCitations: 105, // exactly +5%
      baselineMentions: 5,
      latestMentions: 5,
      daysSinceStart: 10,
      timeline,
    });

    expect(status).toBe("promising");
  });
});
