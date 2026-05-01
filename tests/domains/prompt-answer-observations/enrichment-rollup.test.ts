import { describe, it, expect } from "vitest";

import {
  buildEnrichmentRollup,
  buildEnrichmentWindowRollup,
  buildCompetitorEnrichmentRollup,
  buildPlatformPrimaryRateSparklines,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

function obs(
  overrides: Partial<PromptAnswerObservation> & {
    id: string;
    platform: string;
    observed_at: string;
  },
): PromptAnswerObservation {
  return {
    prompt_id: "p",
    run_id: "r",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    topic: "",
    metadata: {},
    tenant_id: "t",
    ...overrides,
  };
}

describe("buildEnrichmentRollup", () => {
  const DATE = "2026-04-23";

  it("returns empty rollup when no observations fall on the target date", () => {
    const out = buildEnrichmentRollup({
      observations: [obs({ id: "a", platform: "perplexity", observed_at: "2026-04-22T12:00:00Z" })],
      date: DATE,
    });
    expect(out.date).toBe(DATE);
    expect(out.totalObservations).toBe(0);
    expect(out.byPlatform).toEqual([]);
    expect(out.topDescriptors).toEqual([]);
    expect(out.answerStructures).toEqual([]);
    expect(out.observationsWithDescriptors).toBe(0);
  });

  it("aggregates per-platform primary-recommendation rate + average citation rank", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "a1",
        platform: "perplexity",
        observed_at: `${DATE}T10:00:00Z`,
        primary_recommendation: true,
        citation_rank: 1,
      }),
      obs({
        id: "a2",
        platform: "perplexity",
        observed_at: `${DATE}T11:00:00Z`,
        primary_recommendation: false,
        citation_rank: 3,
      }),
      obs({
        id: "a3",
        platform: "perplexity",
        observed_at: `${DATE}T12:00:00Z`,
        primary_recommendation: true,
        citation_rank: null,
      }),
      obs({
        id: "b1",
        platform: "chatgpt",
        observed_at: `${DATE}T10:00:00Z`,
        primary_recommendation: false,
        citation_rank: null,
      }),
    ];
    const out = buildEnrichmentRollup({ observations, date: DATE });
    expect(out.totalObservations).toBe(4);
    const perplexity = out.byPlatform.find((p) => p.platform === "perplexity");
    const chatgpt = out.byPlatform.find((p) => p.platform === "chatgpt");
    expect(perplexity?.observations).toBe(3);
    expect(perplexity?.primaryCount).toBe(2);
    expect(perplexity?.primaryRate).toBe(0.67);
    expect(perplexity?.citedCount).toBe(2);
    expect(perplexity?.avgCitationRank).toBe(2); // (1+3)/2
    expect(chatgpt?.observations).toBe(1);
    expect(chatgpt?.primaryCount).toBe(0);
    expect(chatgpt?.citedCount).toBe(0);
    expect(chatgpt?.avgCitationRank).toBeNull();
  });

  it("aggregates descriptor counts across observations (with per-obs dedup)", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "a1",
        platform: "perplexity",
        observed_at: `${DATE}T10:00:00Z`,
        descriptor_window: ["luxury", "custom", "luxury", "award-winning"],
      }),
      obs({
        id: "a2",
        platform: "perplexity",
        observed_at: `${DATE}T11:00:00Z`,
        descriptor_window: ["luxury", "modern"],
      }),
    ];
    const out = buildEnrichmentRollup({ observations, date: DATE });
    expect(out.observationsWithDescriptors).toBe(2);
    // "luxury" appears in both obs — counts as 2 (not 3, despite appearing
    // twice within obs a1).
    const luxury = out.topDescriptors.find((d) => d.word === "luxury");
    expect(luxury?.count).toBe(2);
    const custom = out.topDescriptors.find((d) => d.word === "custom");
    expect(custom?.count).toBe(1);
    const modern = out.topDescriptors.find((d) => d.word === "modern");
    expect(modern?.count).toBe(1);
    const awardWinning = out.topDescriptors.find(
      (d) => d.word === "award-winning",
    );
    expect(awardWinning?.count).toBe(1);
  });

  it("truncates topDescriptors to maxDescriptors and orders by frequency", () => {
    const words = [
      "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
    ];
    const observations: PromptAnswerObservation[] = words.flatMap((w, i) =>
      // Word i appears in (i+1) observations — so "a" appears 1×, "o" 15×.
      Array.from({ length: i + 1 }, (_, k) =>
        obs({
          id: `${w}-${k}`,
          platform: "perplexity",
          observed_at: `${DATE}T10:00:${k.toString().padStart(2, "0")}Z`,
          descriptor_window: [w],
        }),
      ),
    );
    const out = buildEnrichmentRollup({
      observations,
      date: DATE,
      maxDescriptors: 5,
    });
    expect(out.topDescriptors).toHaveLength(5);
    // Top 5 by frequency: o (15), n (14), m (13), l (12), k (11).
    expect(out.topDescriptors.map((d) => d.word)).toEqual([
      "o", "n", "m", "l", "k",
    ]);
  });

  it("aggregates answer structures, sorted by count descending", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "a1", platform: "p", observed_at: `${DATE}T10:00:00Z`, answer_structure: "bullet_list" }),
      obs({ id: "a2", platform: "p", observed_at: `${DATE}T11:00:00Z`, answer_structure: "bullet_list" }),
      obs({ id: "a3", platform: "p", observed_at: `${DATE}T12:00:00Z`, answer_structure: "narrative" }),
      obs({ id: "a4", platform: "p", observed_at: `${DATE}T13:00:00Z`, answer_structure: "narrative" }),
      obs({ id: "a5", platform: "p", observed_at: `${DATE}T14:00:00Z`, answer_structure: "narrative" }),
      obs({ id: "a6", platform: "p", observed_at: `${DATE}T15:00:00Z`, answer_structure: "ranked_list" }),
    ];
    const out = buildEnrichmentRollup({ observations, date: DATE });
    expect(out.answerStructures).toEqual([
      { structure: "narrative", count: 3 },
      { structure: "bullet_list", count: 2 },
      { structure: "ranked_list", count: 1 },
    ]);
  });

  it("skips observations whose date doesn't match", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "a1", platform: "p", observed_at: `${DATE}T10:00:00Z`, primary_recommendation: true }),
      obs({ id: "a2", platform: "p", observed_at: "2026-04-22T10:00:00Z", primary_recommendation: true }),
      obs({ id: "a3", platform: "p", observed_at: "2026-04-24T10:00:00Z", primary_recommendation: true }),
    ];
    const out = buildEnrichmentRollup({ observations, date: DATE });
    expect(out.totalObservations).toBe(1);
    expect(out.byPlatform[0]?.observations).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// W2 Step 2.2 — windowed brand rollup with prior-window deltas
// ---------------------------------------------------------------------------

describe("buildEnrichmentWindowRollup — brand descriptor rank deltas", () => {
  const END = "2026-05-01";

  it("returns 0/0 sampled-day counts + empty descriptors when no observations", () => {
    const out = buildEnrichmentWindowRollup({
      observations: [],
      endDate: END,
      windowDays: 7,
    });
    expect(out.windowEndDate).toBe(END);
    expect(out.windowDays).toBe(7);
    expect(out.currentSampledDays).toBe(0);
    expect(out.priorSampledDays).toBe(0);
    expect(out.topDescriptorsWithDelta).toEqual([]);
    expect(out.currentWindow.totalObservations).toBe(0);
  });

  it("computes rank delta vs prior window — descriptor moved up = positive delta", () => {
    // Prior window (Apr 18-24): 'innovative' is dominant descriptor (3 obs);
    // 'luxury' is #2 (2 obs). Current window (Apr 25-May 1): 'luxury' takes
    // over (4 obs); 'innovative' drops to #2 (1 obs).
    // Expected delta for 'luxury' = priorRank(2) - currentRank(1) = +1.
    const observations: PromptAnswerObservation[] = [
      // PRIOR WINDOW
      obs({ id: "p1", platform: "perplexity", observed_at: "2026-04-19T10:00:00Z", descriptor_window: ["innovative", "design-build"] }),
      obs({ id: "p2", platform: "perplexity", observed_at: "2026-04-20T10:00:00Z", descriptor_window: ["innovative", "luxury"] }),
      obs({ id: "p3", platform: "perplexity", observed_at: "2026-04-22T10:00:00Z", descriptor_window: ["innovative", "luxury"] }),
      // CURRENT WINDOW
      obs({ id: "c1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z", descriptor_window: ["luxury", "innovative"] }),
      obs({ id: "c2", platform: "perplexity", observed_at: "2026-04-27T10:00:00Z", descriptor_window: ["luxury", "atherton"] }),
      obs({ id: "c3", platform: "perplexity", observed_at: "2026-04-28T10:00:00Z", descriptor_window: ["luxury"] }),
      obs({ id: "c4", platform: "perplexity", observed_at: "2026-04-30T10:00:00Z", descriptor_window: ["luxury", "atherton"] }),
    ];
    const out = buildEnrichmentWindowRollup({
      observations,
      endDate: END,
      windowDays: 7,
      maxDescriptors: 5,
    });
    const luxury = out.topDescriptorsWithDelta.find((d) => d.word === "luxury");
    expect(luxury).toBeDefined();
    expect(luxury!.rankThisWindow).toBe(1);
    expect(luxury!.rankPriorWindow).toBe(2);
    expect(luxury!.delta).toBe(1); // moved up

    const innovative = out.topDescriptorsWithDelta.find(
      (d) => d.word === "innovative",
    );
    expect(innovative).toBeDefined();
    expect(innovative!.rankPriorWindow).toBe(1);
    // innovative moved DOWN
    expect(innovative!.delta).toBeLessThan(0);
  });

  it("returns rankPriorWindow=null + delta=null for descriptors brand-new in current window", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "c1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z", descriptor_window: ["custom", "modernist"] }),
    ];
    const out = buildEnrichmentWindowRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    expect(out.topDescriptorsWithDelta.length).toBeGreaterThan(0);
    for (const d of out.topDescriptorsWithDelta) {
      expect(d.rankPriorWindow).toBeNull();
      expect(d.delta).toBeNull();
    }
  });

  it("counts sampled days correctly across both windows", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "p1", platform: "perplexity", observed_at: "2026-04-19T10:00:00Z", descriptor_window: ["x"] }),
      obs({ id: "p2", platform: "perplexity", observed_at: "2026-04-22T10:00:00Z", descriptor_window: ["x"] }),
      obs({ id: "c1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z", descriptor_window: ["x"] }),
      obs({ id: "c2", platform: "perplexity", observed_at: "2026-04-29T10:00:00Z", descriptor_window: ["x"] }),
      obs({ id: "c3", platform: "perplexity", observed_at: "2026-05-01T10:00:00Z", descriptor_window: ["x"] }),
    ];
    const out = buildEnrichmentWindowRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    expect(out.currentSampledDays).toBe(3); // Apr 26, 29, May 1
    expect(out.priorSampledDays).toBe(2);   // Apr 19, 22
  });
});

// ---------------------------------------------------------------------------
// W2 Step 2.2 — competitor descriptor rollup w/ explicit empty states
// ---------------------------------------------------------------------------

describe("buildCompetitorEnrichmentRollup — three-regime data layer", () => {
  const END = "2026-05-01";
  const COMPETITOR = "De Mattei Construction";

  it("returns 'no_observations_in_window' when no observations land in window", () => {
    const out = buildCompetitorEnrichmentRollup({
      observations: [
        obs({ id: "old", platform: "perplexity", observed_at: "2026-04-01T10:00:00Z" }),
      ],
      competitorName: COMPETITOR,
      endDate: END,
      windowDays: 7,
    });
    expect(out.totalObservations).toBe(0);
    expect(out.emptyStateReason).toBe("no_observations_in_window");
    expect(out.topDescriptors).toEqual([]);
  });

  it("returns 'no_descriptor_field_yet' when observations exist but ALL legacy (regime: older native rows without the field)", () => {
    // Pre-Step-2.1 native rows have the field undefined. The competitor
    // shows up via competitor_co_mentions but no descriptors recoverable.
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "legacy1",
        platform: "perplexity",
        observed_at: "2026-04-26T10:00:00Z",
        competitor_co_mentions: [COMPETITOR, "Kasten Builders"],
        // competitor_descriptor_windows: undefined
      }),
      obs({
        id: "legacy2",
        platform: "perplexity",
        observed_at: "2026-04-28T10:00:00Z",
        competitor_co_mentions: [COMPETITOR],
      }),
    ];
    const out = buildCompetitorEnrichmentRollup({
      observations,
      competitorName: COMPETITOR,
      endDate: END,
      windowDays: 7,
    });
    expect(out.totalObservations).toBe(2);
    expect(out.observationsMentioningCompetitor).toBe(2);
    expect(out.observationsWithFieldAvailable).toBe(0);
    expect(out.observationsWithDescriptors).toBe(0);
    expect(out.emptyStateReason).toBe("no_descriptor_field_yet");
    expect(out.topDescriptors).toEqual([]);
  });

  it("returns 'competitor_not_mentioned' when field is present but THIS competitor never appeared", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "n1",
        platform: "perplexity",
        observed_at: "2026-04-26T10:00:00Z",
        competitor_descriptor_windows: { "Kasten Builders": ["contemporary"] },
      }),
      obs({
        id: "n2",
        platform: "perplexity",
        observed_at: "2026-04-28T10:00:00Z",
        competitor_descriptor_windows: { "Kasten Builders": ["modernist"] },
      }),
    ];
    const out = buildCompetitorEnrichmentRollup({
      observations,
      competitorName: COMPETITOR,
      endDate: END,
      windowDays: 7,
    });
    expect(out.totalObservations).toBe(2);
    expect(out.observationsWithFieldAvailable).toBe(2);
    expect(out.observationsWithDescriptors).toBe(0);
    expect(out.emptyStateReason).toBe("competitor_not_mentioned");
    expect(out.topDescriptors).toEqual([]);
  });

  it("captures top competitor descriptors when field is populated (regime: new native rows)", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "n1",
        platform: "perplexity",
        observed_at: "2026-04-26T10:00:00Z",
        competitor_co_mentions: [COMPETITOR],
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury", "atherton"] },
      }),
      obs({
        id: "n2",
        platform: "perplexity",
        observed_at: "2026-04-28T10:00:00Z",
        competitor_co_mentions: [COMPETITOR],
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury", "design-build"] },
      }),
      obs({
        id: "n3",
        platform: "chatgpt",
        observed_at: "2026-04-30T10:00:00Z",
        competitor_co_mentions: [COMPETITOR],
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury", "boutique"] },
      }),
    ];
    const out = buildCompetitorEnrichmentRollup({
      observations,
      competitorName: COMPETITOR,
      endDate: END,
      windowDays: 7,
    });
    expect(out.observationsWithDescriptors).toBe(3);
    expect(out.observationsMentioningCompetitor).toBe(3);
    expect(out.topDescriptors[0]?.word).toBe("luxury");
    expect(out.topDescriptors[0]?.count).toBe(3);
    expect(out.emptyStateReason).toBeNull();
  });

  it("handles MIXED regime: new native + future historical_recovered + legacy rows together", () => {
    // Three regimes co-existing in the same observation array.
    // The rollup sums descriptors only from rows that have the field;
    // legacy rows contribute to mention count but NOT descriptor counts.
    const observations: PromptAnswerObservation[] = [
      // New native (Step 2.1 forward)
      obs({
        id: "native_new",
        platform: "perplexity",
        observed_at: "2026-04-26T10:00:00Z",
        competitor_co_mentions: [COMPETITOR],
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury", "atherton"] },
      }),
      // Future historical_recovered (W4) — same shape, different regime metadata.
      obs({
        id: "historical_recovered",
        platform: "google_aio",
        observed_at: "2026-04-27T10:00:00Z",
        competitor_co_mentions: [COMPETITOR],
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury", "award-winning"] },
        metadata: { regime: "historical_recovered" },
      }),
      // Legacy native (pre-Step-2.1) — competitor mentioned but no field.
      obs({
        id: "native_legacy",
        platform: "perplexity",
        observed_at: "2026-04-28T10:00:00Z",
        competitor_co_mentions: [COMPETITOR],
      }),
    ];
    const out = buildCompetitorEnrichmentRollup({
      observations,
      competitorName: COMPETITOR,
      endDate: END,
      windowDays: 7,
    });
    expect(out.totalObservations).toBe(3);
    expect(out.observationsMentioningCompetitor).toBe(3); // all three mention
    expect(out.observationsWithFieldAvailable).toBe(2);   // only new + recovered
    expect(out.observationsWithDescriptors).toBe(2);
    expect(out.emptyStateReason).toBeNull();
    // Top descriptor: luxury (2 obs); award-winning + atherton (1 obs each).
    expect(out.topDescriptors[0]?.word).toBe("luxury");
    expect(out.topDescriptors[0]?.count).toBe(2);
  });

  it("computes rank-delta-vs-prior-window for competitor descriptors too", () => {
    // Prior window: 'luxury' #1 (2), 'atherton' #2 (1).
    // Current window: 'luxury' #1 (3), 'modernist' #2 (1).
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "p1",
        platform: "perplexity",
        observed_at: "2026-04-19T10:00:00Z",
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury", "atherton"] },
      }),
      obs({
        id: "p2",
        platform: "perplexity",
        observed_at: "2026-04-21T10:00:00Z",
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury"] },
      }),
      obs({
        id: "c1",
        platform: "perplexity",
        observed_at: "2026-04-26T10:00:00Z",
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury", "modernist"] },
      }),
      obs({
        id: "c2",
        platform: "perplexity",
        observed_at: "2026-04-28T10:00:00Z",
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury"] },
      }),
      obs({
        id: "c3",
        platform: "perplexity",
        observed_at: "2026-04-30T10:00:00Z",
        competitor_descriptor_windows: { [COMPETITOR]: ["luxury"] },
      }),
    ];
    const out = buildCompetitorEnrichmentRollup({
      observations,
      competitorName: COMPETITOR,
      endDate: END,
      windowDays: 7,
    });
    const luxury = out.topDescriptorsWithDelta.find((d) => d.word === "luxury");
    expect(luxury).toBeDefined();
    expect(luxury!.rankThisWindow).toBe(1);
    expect(luxury!.rankPriorWindow).toBe(1);
    expect(luxury!.delta).toBe(0);

    const modernist = out.topDescriptorsWithDelta.find(
      (d) => d.word === "modernist",
    );
    expect(modernist).toBeDefined();
    expect(modernist!.rankPriorWindow).toBeNull();
    expect(modernist!.delta).toBeNull();
  });

  it("does NOT fall back to brand descriptor_window for competitor (no fabrication)", () => {
    // Observation has the brand's descriptor_window but no
    // competitor_descriptor_windows for this competitor. Brand tokens must
    // never be reported as competitor descriptors.
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "n1",
        platform: "perplexity",
        observed_at: "2026-04-26T10:00:00Z",
        competitor_co_mentions: [COMPETITOR],
        descriptor_window: ["award-winning", "modernist", "luxury"],
        competitor_descriptor_windows: { "Kasten Builders": ["contemporary"] },
      }),
    ];
    const out = buildCompetitorEnrichmentRollup({
      observations,
      competitorName: COMPETITOR,
      endDate: END,
      windowDays: 7,
    });
    expect(out.topDescriptors).toEqual([]);
    expect(out.emptyStateReason).toBe("competitor_not_mentioned");
    // Brand tokens never appear in the competitor's rollup.
    const allTokens = out.topDescriptors.map((d) => d.word);
    expect(allTokens).not.toContain("award-winning");
    expect(allTokens).not.toContain("modernist");
    expect(allTokens).not.toContain("luxury");
  });
});

// ---------------------------------------------------------------------------
// W2 Step 2.2 — per-platform primary-rate sparkline data path
// ---------------------------------------------------------------------------

describe("buildPlatformPrimaryRateSparklines — daily series for v2 chart", () => {
  const END = "2026-05-01";

  it("returns [] when no observations carry primary_recommendation field at all", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "n1", platform: "perplexity", observed_at: "2026-04-30T10:00:00Z" }),
    ];
    const out = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END,
      windowDays: 14,
    });
    expect(out).toEqual([]);
  });

  it("emits one sparkline per platform with windowDays points (chronological order)", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "n1", platform: "perplexity", observed_at: "2026-04-30T10:00:00Z", primary_recommendation: true }),
      obs({ id: "n2", platform: "chatgpt", observed_at: "2026-04-30T10:00:00Z", primary_recommendation: false }),
    ];
    const out = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END,
      windowDays: 14,
    });
    expect(out).toHaveLength(2);
    for (const series of out) {
      expect(series.points).toHaveLength(14);
      // Chronological — earliest first.
      expect(series.points[0].date < series.points[13].date).toBe(true);
      // Last point lands on the endDate.
      expect(series.points[13].date).toBe(END);
    }
  });

  it("renders zero-observation days as primaryRate=null (not 0)", () => {
    // One observation 5 days before END; the rest of the window should be null.
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "n1",
        platform: "perplexity",
        observed_at: "2026-04-26T10:00:00Z",
        primary_recommendation: true,
      }),
    ];
    const out = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END,
      windowDays: 7,
    });
    const perplexity = out.find((s) => s.platform === "perplexity");
    expect(perplexity).toBeDefined();
    const apr26 = perplexity!.points.find((p) => p.date === "2026-04-26");
    expect(apr26?.primaryRate).toBe(1);
    expect(apr26?.observations).toBe(1);
    const apr30 = perplexity!.points.find((p) => p.date === "2026-04-30");
    expect(apr30?.primaryRate).toBeNull();
    expect(apr30?.observations).toBe(0);
  });

  it("computes primaryRate = primary_count / observations per platform-day", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "a", platform: "perplexity", observed_at: "2026-04-30T10:00:00Z", primary_recommendation: true }),
      obs({ id: "b", platform: "perplexity", observed_at: "2026-04-30T11:00:00Z", primary_recommendation: false }),
      obs({ id: "c", platform: "perplexity", observed_at: "2026-04-30T12:00:00Z", primary_recommendation: true }),
      obs({ id: "d", platform: "perplexity", observed_at: "2026-04-30T13:00:00Z", primary_recommendation: false }),
    ];
    const out = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END,
      windowDays: 14,
    });
    const apr30 = out[0].points.find((p) => p.date === "2026-04-30");
    expect(apr30?.observations).toBe(4);
    expect(apr30?.primaryRate).toBe(0.5); // 2/4
  });

  it("respects platforms filter when supplied", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "a", platform: "perplexity", observed_at: "2026-04-30T10:00:00Z", primary_recommendation: true }),
      obs({ id: "b", platform: "chatgpt", observed_at: "2026-04-30T10:00:00Z", primary_recommendation: true }),
      obs({ id: "c", platform: "google_aio", observed_at: "2026-04-30T10:00:00Z", primary_recommendation: true }),
    ];
    const out = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END,
      windowDays: 14,
      platforms: ["perplexity", "chatgpt"],
    });
    expect(out.map((s) => s.platform).sort()).toEqual(["chatgpt", "perplexity"]);
  });
});
