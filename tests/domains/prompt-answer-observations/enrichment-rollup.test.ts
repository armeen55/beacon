import { describe, it, expect } from "vitest";

import {
  buildEnrichmentRollup,
  buildEnrichmentWindowRollup,
  buildCompetitorEnrichmentRollup,
  buildPlatformPrimaryRateSparklines,
  buildFormatWinsRollup,
  buildCompetitorDropdown,
  canonicalizePlatform,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

function entity(overrides: Partial<TrackedEntity>): TrackedEntity {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 6)}`,
    account_id: "acct-test",
    entity_type: overrides.entity_type ?? "competitor",
    name: overrides.name ?? "Sample Co",
    aliases: overrides.aliases,
    domain: overrides.domain ?? null,
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: overrides.is_owned ?? false,
    is_active: overrides.is_active ?? true,
    metadata: overrides.metadata ?? {},
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}
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

  it("sampleStatus reflects total observations across the window per platform", () => {
    // 1 obs in window for perplexity → "thin"; chatgpt has 12 obs → "enough".
    const observations: PromptAnswerObservation[] = [
      obs({ id: "p", platform: "perplexity", observed_at: "2026-04-30T10:00:00Z", primary_recommendation: true }),
      ...Array.from({ length: 12 }, (_, i) =>
        obs({
          id: `c${i}`,
          platform: "chatgpt",
          observed_at: `2026-04-${String(20 + (i % 11)).padStart(2, "0")}T10:00:00Z`,
          primary_recommendation: i % 2 === 0,
        }),
      ),
    ];
    const out = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: "2026-05-01",
      windowDays: 14,
    });
    const perplexity = out.find((s) => s.platform === "perplexity");
    const chatgpt = out.find((s) => s.platform === "chatgpt");
    expect(perplexity?.totalObservations).toBe(1);
    expect(perplexity?.sampleStatus).toBe("thin");
    expect(chatgpt?.totalObservations).toBeGreaterThanOrEqual(10);
    expect(chatgpt?.sampleStatus).toBe("enough");
  });
});

// ---------------------------------------------------------------------------
// W2 Step 2.2b — sample-status added to brand + competitor rollups
// ---------------------------------------------------------------------------

describe("sampleStatus on brand + competitor rollups (Step 2.2b)", () => {
  const END = "2026-05-01";

  it("brand rollup: empty observations → sampleStatus='empty'", () => {
    const out = buildEnrichmentWindowRollup({
      observations: [],
      endDate: END,
      windowDays: 7,
    });
    expect(out.sampleStatus).toBe("empty");
  });

  it("brand rollup: 1-9 obs with descriptors → sampleStatus='thin'", () => {
    const observations: PromptAnswerObservation[] = Array.from(
      { length: 5 },
      (_, i) =>
        obs({
          id: `n${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(26 + i).padStart(2, "0")}T10:00:00Z`,
          descriptor_window: ["luxury"],
        }),
    );
    const out = buildEnrichmentWindowRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    expect(out.currentWindow.observationsWithDescriptors).toBe(5);
    expect(out.sampleStatus).toBe("thin");
  });

  it("brand rollup: 10+ obs with descriptors → sampleStatus='enough'", () => {
    const observations: PromptAnswerObservation[] = Array.from(
      { length: 12 },
      (_, i) =>
        obs({
          id: `n${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(25 + (i % 7)).padStart(2, "0")}T10:00:00Z`,
          descriptor_window: ["luxury", "atherton"],
        }),
    );
    const out = buildEnrichmentWindowRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    expect(out.currentWindow.observationsWithDescriptors).toBeGreaterThanOrEqual(10);
    expect(out.sampleStatus).toBe("enough");
  });

  it("competitor rollup: sampleStatus tracks observationsWithDescriptors not totalObservations", () => {
    // 5 obs in window mention competitor, but only 3 carry descriptor field.
    // sampleStatus should be "thin" (3), not "thin" based on a different
    // counter — explicitly tracking descriptor-bearing rows.
    const observations: PromptAnswerObservation[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        obs({
          id: `desc${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(26 + i).padStart(2, "0")}T10:00:00Z`,
          competitor_co_mentions: ["De Mattei Construction"],
          competitor_descriptor_windows: {
            "De Mattei Construction": ["luxury"],
          },
        }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        obs({
          id: `mention_only${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(28 + i).padStart(2, "0")}T10:00:00Z`,
          competitor_co_mentions: ["De Mattei Construction"],
          // No competitor_descriptor_windows.
        }),
      ),
    ];
    const out = buildCompetitorEnrichmentRollup({
      observations,
      competitorName: "De Mattei Construction",
      endDate: END,
      windowDays: 7,
    });
    expect(out.observationsMentioningCompetitor).toBe(5);
    expect(out.observationsWithDescriptors).toBe(3);
    expect(out.sampleStatus).toBe("thin");
  });

  it("competitor rollup: 0 descriptor-bearing rows → sampleStatus='empty' (matches empty-state)", () => {
    const out = buildCompetitorEnrichmentRollup({
      observations: [
        obs({
          id: "n1",
          platform: "perplexity",
          observed_at: "2026-04-26T10:00:00Z",
          competitor_co_mentions: ["De Mattei Construction"],
        }),
      ],
      competitorName: "De Mattei Construction",
      endDate: END,
      windowDays: 7,
    });
    expect(out.observationsWithDescriptors).toBe(0);
    expect(out.sampleStatus).toBe("empty");
    expect(out.emptyStateReason).toBe("no_descriptor_field_yet");
  });
});

// ---------------------------------------------------------------------------
// W2 Step 2.2b — buildFormatWinsRollup
// ---------------------------------------------------------------------------

describe("buildFormatWinsRollup — per-platform answer-structure mix", () => {
  const END = "2026-05-01";

  it("returns dominant structure per platform with pct + sampleStatus", () => {
    // Perplexity: 6 ranked_list, 4 narrative → dominant ranked_list 60%.
    // ChatGPT: 8 qa_format, 2 bullet_list → dominant qa_format 80%.
    const observations: PromptAnswerObservation[] = [
      ...Array.from({ length: 6 }, (_, i) =>
        obs({
          id: `p_rl_${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(26 + (i % 5)).padStart(2, "0")}T10:00:00Z`,
          answer_structure: "ranked_list",
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        obs({
          id: `p_n_${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(26 + (i % 5)).padStart(2, "0")}T11:00:00Z`,
          answer_structure: "narrative",
        }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        obs({
          id: `c_qa_${i}`,
          platform: "chatgpt",
          observed_at: `2026-04-${String(26 + (i % 5)).padStart(2, "0")}T10:00:00Z`,
          answer_structure: "qa_format",
        }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        obs({
          id: `c_bl_${i}`,
          platform: "chatgpt",
          observed_at: `2026-04-${String(26 + (i % 5)).padStart(2, "0")}T11:00:00Z`,
          answer_structure: "bullet_list",
        }),
      ),
    ];
    const out = buildFormatWinsRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    expect(out).toHaveLength(2);

    const perplexity = out.find((s) => s.platform === "perplexity");
    expect(perplexity?.dominantStructure).toBe("ranked_list");
    expect(perplexity?.dominantPct).toBe(0.6);
    expect(perplexity?.sampleCount).toBe(10);
    expect(perplexity?.sampleStatus).toBe("enough");

    const chatgpt = out.find((s) => s.platform === "chatgpt");
    expect(chatgpt?.dominantStructure).toBe("qa_format");
    expect(chatgpt?.dominantPct).toBe(0.8);
    expect(chatgpt?.sampleCount).toBe(10);
    expect(chatgpt?.sampleStatus).toBe("enough");
    // structures sorted by count desc.
    expect(chatgpt?.structures[0].structure).toBe("qa_format");
    expect(chatgpt?.structures[1].structure).toBe("bullet_list");
  });

  it("mixed structures: every structure value gets a bucket with correct pct", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z", answer_structure: "ranked_list" }),
      obs({ id: "2", platform: "perplexity", observed_at: "2026-04-26T11:00:00Z", answer_structure: "ranked_list" }),
      obs({ id: "3", platform: "perplexity", observed_at: "2026-04-27T10:00:00Z", answer_structure: "comparison" }),
      obs({ id: "4", platform: "perplexity", observed_at: "2026-04-28T10:00:00Z", answer_structure: "narrative" }),
    ];
    const out = buildFormatWinsRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    expect(out).toHaveLength(1);
    const p = out[0];
    expect(p.sampleCount).toBe(4);
    expect(p.structures.map((s) => s.structure).sort()).toEqual([
      "comparison",
      "narrative",
      "ranked_list",
    ]);
    expect(p.structures[0].structure).toBe("ranked_list");
    expect(p.structures[0].pct).toBe(0.5);
  });

  it("thin sample status fires when sampleCount < 10", () => {
    const observations: PromptAnswerObservation[] = Array.from(
      { length: 5 },
      (_, i) =>
        obs({
          id: `t${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(26 + i).padStart(2, "0")}T10:00:00Z`,
          answer_structure: "ranked_list",
        }),
    );
    const out = buildFormatWinsRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    expect(out[0].sampleCount).toBe(5);
    expect(out[0].sampleStatus).toBe("thin");
  });

  it("returns empty/zero structure when no observations carry answer_structure", () => {
    // Observations exist but ALL have answer_structure undefined → emit
    // platforms when caller supplies them, else nothing.
    const observations: PromptAnswerObservation[] = [
      obs({ id: "1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z" }),
    ];
    const out = buildFormatWinsRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    expect(out).toHaveLength(0);

    // With explicit platforms list, emit empty rollups so UI can render
    // "no data yet" for known-existent platforms.
    const explicit = buildFormatWinsRollup({
      observations,
      endDate: END,
      windowDays: 7,
      platforms: ["perplexity", "chatgpt"],
    });
    expect(explicit).toHaveLength(2);
    expect(explicit[0].sampleStatus).toBe("empty");
    expect(explicit[0].sampleCount).toBe(0);
    expect(explicit[0].dominantStructure).toBeNull();
    expect(explicit[0].dominantPct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// W2 Step 2.2b — buildCompetitorDropdown (default selection + filtering)
// ---------------------------------------------------------------------------

describe("buildCompetitorDropdown — Step 2.2b", () => {
  const END = "2026-05-01";

  const REAL_BUILDERS: TrackedEntity[] = [
    entity({ name: "De Mattei Construction", entity_type: "competitor", domain: "demattei.com" }),
    entity({ name: "Kasten Builders", entity_type: "competitor", domain: "kastenbuilders.com" }),
    entity({ name: "Supple Homes", entity_type: "competitor", domain: "supplehomesinc.com" }),
  ];
  const DIRECTORIES: TrackedEntity[] = [
    entity({ name: "Houzz", entity_type: "directory_source", domain: "houzz.com" }),
    entity({ name: "Yelp", entity_type: "directory_source", domain: "yelp.com" }),
    entity({ name: "Angi", entity_type: "directory_source", domain: "angi.com" }),
    entity({ name: "BuildZoom", entity_type: "directory_source", domain: "buildzoom.com" }),
  ];

  it("excludes directories from the dropdown", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "n1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z", competitor_co_mentions: ["Houzz"] }),
      obs({ id: "n2", platform: "perplexity", observed_at: "2026-04-26T11:00:00Z", competitor_co_mentions: ["Yelp"] }),
      obs({ id: "n3", platform: "perplexity", observed_at: "2026-04-27T10:00:00Z", competitor_co_mentions: ["Angi"] }),
      obs({ id: "n4", platform: "perplexity", observed_at: "2026-04-28T10:00:00Z", competitor_co_mentions: ["BuildZoom"] }),
    ];
    const out = buildCompetitorDropdown({
      observations,
      trackedEntities: [...DIRECTORIES],
      endDate: END,
      windowDays: 7,
    });
    expect(out).toEqual([]);
  });

  it("excludes generic-noun entities by name when no metadata", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "n1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z", competitor_co_mentions: ["General Contractors"] }),
      obs({ id: "n2", platform: "perplexity", observed_at: "2026-04-27T10:00:00Z", competitor_co_mentions: ["Local Contractors"] }),
    ];
    const out = buildCompetitorDropdown({
      observations,
      trackedEntities: [], // no metadata to override the name filter
      endDate: END,
      windowDays: 7,
    });
    expect(out.map((e) => e.name)).not.toContain("General Contractors");
    expect(out.map((e) => e.name)).not.toContain("Local Contractors");
  });

  it("retains real competitors and ranks by descriptor data + mentions", () => {
    // De Mattei: 3 mentions, 3 with descriptors
    // Kasten: 5 mentions, 1 with descriptors
    // Supple: 4 mentions, 0 with descriptors
    // Expected sort: De Mattei (best descriptors), Kasten (1 descriptor),
    // then Supple (0 descriptors but most mentions among the no-descriptor
    // tier — but Kasten beats it because Kasten has descriptors).
    const observations: PromptAnswerObservation[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        obs({
          id: `dm${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(26 + i).padStart(2, "0")}T10:00:00Z`,
          competitor_co_mentions: ["De Mattei Construction"],
          competitor_descriptor_windows: {
            "De Mattei Construction": ["luxury"],
          },
        }),
      ),
      obs({
        id: "k_descriptor",
        platform: "perplexity",
        observed_at: "2026-04-26T11:00:00Z",
        competitor_co_mentions: ["Kasten Builders"],
        competitor_descriptor_windows: { "Kasten Builders": ["modern"] },
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        obs({
          id: `k${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(27 + i).padStart(2, "0")}T10:00:00Z`,
          competitor_co_mentions: ["Kasten Builders"],
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        obs({
          id: `s${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(26 + i).padStart(2, "0")}T12:00:00Z`,
          competitor_co_mentions: ["Supple Homes"],
        }),
      ),
    ];
    const out = buildCompetitorDropdown({
      observations,
      trackedEntities: REAL_BUILDERS,
      endDate: END,
      windowDays: 7,
    });
    expect(out.map((e) => e.name)).toEqual([
      "De Mattei Construction",
      "Kasten Builders",
      "Supple Homes",
    ]);
    expect(out[0].isDefault).toBe(true);
    expect(out[0].hasDescriptorData).toBe(true);
    expect(out[1].hasDescriptorData).toBe(true);
    expect(out[2].hasDescriptorData).toBe(false);
  });

  it("default prefers competitors WITH descriptor data over those without", () => {
    // De Mattei has more mentions but no descriptors. Kasten has 1
    // descriptor. Default should be Kasten.
    const observations: PromptAnswerObservation[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        obs({
          id: `dm${i}`,
          platform: "perplexity",
          observed_at: `2026-04-${String(25 + (i % 7)).padStart(2, "0")}T10:00:00Z`,
          competitor_co_mentions: ["De Mattei Construction"],
        }),
      ),
      obs({
        id: "k1",
        platform: "perplexity",
        observed_at: "2026-04-26T10:00:00Z",
        competitor_co_mentions: ["Kasten Builders"],
        competitor_descriptor_windows: { "Kasten Builders": ["modern"] },
      }),
    ];
    const out = buildCompetitorDropdown({
      observations,
      trackedEntities: REAL_BUILDERS,
      endDate: END,
      windowDays: 7,
    });
    expect(out[0].name).toBe("Kasten Builders");
    expect(out[0].isDefault).toBe(true);
    expect(out[0].hasDescriptorData).toBe(true);
    // De Mattei is second — defaults to fallback ordering by mentions.
    expect(out[1].name).toBe("De Mattei Construction");
    expect(out[1].isDefault).toBe(false);
    expect(out[1].hasDescriptorData).toBe(false);
  });

  it("falls back to strongest real competitor by mentions when NO descriptors exist yet", () => {
    // All competitors lack descriptor field (simulating pre-Step 2.1
    // window). Default should still land on a real competitor — the one
    // with the most mentions.
    const observations: PromptAnswerObservation[] = [
      obs({ id: "k1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z", competitor_co_mentions: ["Kasten Builders"] }),
      obs({ id: "k2", platform: "perplexity", observed_at: "2026-04-27T10:00:00Z", competitor_co_mentions: ["Kasten Builders"] }),
      obs({ id: "dm1", platform: "perplexity", observed_at: "2026-04-26T11:00:00Z", competitor_co_mentions: ["De Mattei Construction"] }),
      obs({ id: "dm2", platform: "perplexity", observed_at: "2026-04-27T11:00:00Z", competitor_co_mentions: ["De Mattei Construction"] }),
      obs({ id: "dm3", platform: "perplexity", observed_at: "2026-04-28T11:00:00Z", competitor_co_mentions: ["De Mattei Construction"] }),
    ];
    const out = buildCompetitorDropdown({
      observations,
      trackedEntities: REAL_BUILDERS,
      endDate: END,
      windowDays: 7,
    });
    expect(out[0].name).toBe("De Mattei Construction");
    expect(out[0].isDefault).toBe(true);
    expect(out[0].hasDescriptorData).toBe(false);
    expect(out[0].comentionCount).toBe(3);
  });

  it("filters mixed (real + directories) — keeps real builders, drops Houzz/Yelp/Angi/BuildZoom", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "h1", platform: "perplexity", observed_at: "2026-04-26T10:00:00Z", competitor_co_mentions: ["Houzz"] }),
      obs({ id: "y1", platform: "perplexity", observed_at: "2026-04-26T11:00:00Z", competitor_co_mentions: ["Yelp"] }),
      obs({ id: "a1", platform: "perplexity", observed_at: "2026-04-27T10:00:00Z", competitor_co_mentions: ["Angi"] }),
      obs({ id: "b1", platform: "perplexity", observed_at: "2026-04-27T11:00:00Z", competitor_co_mentions: ["BuildZoom"] }),
      obs({ id: "dm1", platform: "perplexity", observed_at: "2026-04-26T12:00:00Z", competitor_co_mentions: ["De Mattei Construction"] }),
      obs({ id: "k1", platform: "perplexity", observed_at: "2026-04-27T12:00:00Z", competitor_co_mentions: ["Kasten Builders"] }),
    ];
    const out = buildCompetitorDropdown({
      observations,
      trackedEntities: [...REAL_BUILDERS, ...DIRECTORIES],
      endDate: END,
      windowDays: 7,
    });
    const names = out.map((e) => e.name);
    expect(names).not.toContain("Houzz");
    expect(names).not.toContain("Yelp");
    expect(names).not.toContain("Angi");
    expect(names).not.toContain("BuildZoom");
    expect(names).toContain("De Mattei Construction");
    expect(names).toContain("Kasten Builders");
  });

  it("returns empty array when no observations land in the window", () => {
    const out = buildCompetitorDropdown({
      observations: [
        obs({ id: "old", platform: "perplexity", observed_at: "2026-04-01T10:00:00Z", competitor_co_mentions: ["De Mattei Construction"] }),
      ],
      trackedEntities: REAL_BUILDERS,
      endDate: END,
      windowDays: 7,
    });
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// W2 Step 2.2b — window alignment across helpers
// ---------------------------------------------------------------------------

describe("all rollup helpers honor the same windowDays + endDate window", () => {
  const END = "2026-05-01";
  const observations: PromptAnswerObservation[] = [
    // In window
    obs({
      id: "in",
      platform: "perplexity",
      observed_at: "2026-04-26T10:00:00Z",
      descriptor_window: ["luxury"],
      competitor_co_mentions: ["De Mattei Construction"],
      competitor_descriptor_windows: {
        "De Mattei Construction": ["modern"],
      },
      answer_structure: "ranked_list",
      primary_recommendation: true,
    }),
    // Out of window (older than 7 days from END)
    obs({
      id: "out",
      platform: "perplexity",
      observed_at: "2026-04-15T10:00:00Z",
      descriptor_window: ["legacy"],
      competitor_co_mentions: ["De Mattei Construction"],
      competitor_descriptor_windows: { "De Mattei Construction": ["legacy"] },
      answer_structure: "narrative",
      primary_recommendation: true,
    }),
  ];
  const trackedEntities: TrackedEntity[] = [
    entity({ name: "De Mattei Construction", entity_type: "competitor", domain: "demattei.com" }),
  ];

  it("brand rollup, competitor rollup, format-wins, dropdown, sparkline ALL filter to [endDate-6, endDate]", () => {
    const brand = buildEnrichmentWindowRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    const competitor = buildCompetitorEnrichmentRollup({
      observations,
      competitorName: "De Mattei Construction",
      endDate: END,
      windowDays: 7,
    });
    const format = buildFormatWinsRollup({
      observations,
      endDate: END,
      windowDays: 7,
    });
    const dropdown = buildCompetitorDropdown({
      observations,
      trackedEntities,
      endDate: END,
      windowDays: 7,
    });
    const sparkline = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: END,
      windowDays: 7,
    });

    // Each helper sees ONLY the in-window observation.
    expect(brand.currentWindow.totalObservations).toBe(1);
    expect(competitor.totalObservations).toBe(1);
    expect(format[0].sampleCount).toBe(1);
    expect(dropdown[0].comentionCount).toBe(1);
    expect(sparkline[0].totalObservations).toBe(1);

    // Token from out-of-window observation does NOT leak into any rollup.
    expect(brand.currentWindow.topDescriptors.map((d) => d.word)).not.toContain(
      "legacy",
    );
    expect(competitor.topDescriptors.map((d) => d.word)).not.toContain("legacy");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Bug-2 fix (2026-05-04): canonicalizePlatform — collapse platform-name
// case variants into one bucket so /today's "Where AI ranks you" + "What
// format wins" don't render duplicate rows for ChatGPT and Perplexity.
// ──────────────────────────────────────────────────────────────────────
//
// Operator-reported (post-W4 publish):
//   "Where AI ranks you" showed:
//     ChatGPT Primary 39%
//     Google AI Overviews Primary 66%
//     Perplexity Primary 42%
//     ChatGPT Primary 56%      ← duplicate
//     Perplexity Primary 39%   ← duplicate
//
// Root cause: the rollup used `o.platform ?? "unknown"` directly as the
// bucket key. Native polls (Apr 22+) wrote `"chatgpt"` (lowercase); the
// W4 publish wrote `"ChatGPT"` (capitalized). Two distinct buckets →
// two rendered rows.
//
// Fix: canonicalize before bucket-keying. The `PLATFORM_LABEL` map in
// `src/lib/structure-labels.ts` already keys on lowercase forms, so the
// UI display continues to work.

describe("Bug-2 — canonicalizePlatform", () => {
  it("maps both 'chatgpt' and 'ChatGPT' (and 'openai' / 'OpenAI') to 'chatgpt'", () => {
    expect(canonicalizePlatform("chatgpt")).toBe("chatgpt");
    expect(canonicalizePlatform("ChatGPT")).toBe("chatgpt");
    expect(canonicalizePlatform("CHATGPT")).toBe("chatgpt");
    expect(canonicalizePlatform("openai")).toBe("chatgpt");
    expect(canonicalizePlatform("OpenAI")).toBe("chatgpt");
  });

  it("maps 'perplexity' / 'Perplexity' to 'perplexity'", () => {
    expect(canonicalizePlatform("perplexity")).toBe("perplexity");
    expect(canonicalizePlatform("Perplexity")).toBe("perplexity");
    expect(canonicalizePlatform("PERPLEXITY")).toBe("perplexity");
  });

  it("maps W4 'Google AI Overviews' display variant to canonical 'google_aio'", () => {
    expect(canonicalizePlatform("Google AI Overviews")).toBe("google_aio");
    expect(canonicalizePlatform("google ai overviews")).toBe("google_aio");
    expect(canonicalizePlatform("google-ai-overviews")).toBe("google_aio");
    expect(canonicalizePlatform("google_ai_overviews")).toBe("google_aio");
    expect(canonicalizePlatform("google_aio")).toBe("google_aio");
    expect(canonicalizePlatform("aio")).toBe("google_aio");
  });

  it("maps 'claude' to 'claude'", () => {
    expect(canonicalizePlatform("Claude")).toBe("claude");
    expect(canonicalizePlatform("claude")).toBe("claude");
  });

  it("returns 'unknown' for null/undefined", () => {
    expect(canonicalizePlatform(null)).toBe("unknown");
    expect(canonicalizePlatform(undefined)).toBe("unknown");
  });

  it("falls back to lowercased input for unknown new platforms", () => {
    expect(canonicalizePlatform("Gemini")).toBe("gemini");
    expect(canonicalizePlatform("CoPilot")).toBe("copilot");
  });

  it("trims whitespace before mapping", () => {
    expect(canonicalizePlatform("  ChatGPT  ")).toBe("chatgpt");
  });
});

describe("Bug-2 — buildEnrichmentRollup collapses case variants into one platform bucket", () => {
  it("'chatgpt' (native) + 'ChatGPT' (W4 historical) bucket as ONE platform", () => {
    const observations: PromptAnswerObservation[] = [
      // 2 native lowercase rows
      obs({
        id: "o1",
        platform: "chatgpt",
        observed_at: "2026-05-01T10:00:00Z",
        primary_recommendation: true,
      }),
      obs({
        id: "o2",
        platform: "chatgpt",
        observed_at: "2026-05-01T10:01:00Z",
        primary_recommendation: false,
      }),
      // 1 W4 capitalized row
      obs({
        id: "o3",
        platform: "ChatGPT",
        observed_at: "2026-05-01T10:02:00Z",
        primary_recommendation: true,
      }),
    ];
    const rollup = buildEnrichmentRollup({ observations, date: "2026-05-01" });
    // Should be ONE bucket with platform = "chatgpt" (canonical form),
    // observations = 3, primaryCount = 2, primaryRate = 0.67.
    expect(rollup.byPlatform).toHaveLength(1);
    expect(rollup.byPlatform[0].platform).toBe("chatgpt");
    expect(rollup.byPlatform[0].observations).toBe(3);
    expect(rollup.byPlatform[0].primaryCount).toBe(2);
  });

  it("native + W4 perplexity ALSO collapses (parity with chatgpt)", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "p1",
        platform: "perplexity",
        observed_at: "2026-05-01T10:00:00Z",
      }),
      obs({
        id: "p2",
        platform: "Perplexity",
        observed_at: "2026-05-01T10:01:00Z",
      }),
    ];
    const rollup = buildEnrichmentRollup({ observations, date: "2026-05-01" });
    expect(rollup.byPlatform).toHaveLength(1);
    expect(rollup.byPlatform[0].platform).toBe("perplexity");
    expect(rollup.byPlatform[0].observations).toBe(2);
  });

  it("Google AI Overviews stays as ONE row even alongside ChatGPT + Perplexity", () => {
    const observations: PromptAnswerObservation[] = [
      obs({ id: "c1", platform: "chatgpt", observed_at: "2026-05-01T10:00:00Z" }),
      obs({ id: "c2", platform: "ChatGPT", observed_at: "2026-05-01T10:01:00Z" }),
      obs({ id: "p1", platform: "perplexity", observed_at: "2026-05-01T10:02:00Z" }),
      obs({ id: "p2", platform: "Perplexity", observed_at: "2026-05-01T10:03:00Z" }),
      obs({
        id: "g1",
        platform: "Google AI Overviews",
        observed_at: "2026-05-01T10:04:00Z",
      }),
    ];
    const rollup = buildEnrichmentRollup({ observations, date: "2026-05-01" });
    const platforms = rollup.byPlatform.map((p) => p.platform).sort();
    // Exactly 3 canonical platforms.
    expect(platforms).toEqual(["chatgpt", "google_aio", "perplexity"]);
  });
});

describe("Bug-2 — buildPlatformPrimaryRateSparklines collapses case variants", () => {
  it("'chatgpt' + 'ChatGPT' across days share one sparkline", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "n1",
        platform: "chatgpt",
        observed_at: "2026-04-30T10:00:00Z",
        primary_recommendation: true,
      }),
      obs({
        id: "n2",
        platform: "ChatGPT",
        observed_at: "2026-04-29T10:00:00Z",
        primary_recommendation: false,
      }),
    ];
    const sparklines = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: "2026-04-30",
      windowDays: 7,
    });
    expect(sparklines.length).toBe(1);
    expect(sparklines[0].platform).toBe("chatgpt");
    // Both observations contributed → totalObservations === 2
    expect(sparklines[0].totalObservations).toBe(2);
  });

  it("operator's exact symptom: 5 observations across 3 platforms (2 case variants on each of chatgpt + perplexity) → 3 rows not 5", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "a",
        platform: "chatgpt",
        observed_at: "2026-04-30T10:00:00Z",
        primary_recommendation: true,
      }),
      obs({
        id: "b",
        platform: "ChatGPT",
        observed_at: "2026-04-30T10:01:00Z",
        primary_recommendation: true,
      }),
      obs({
        id: "c",
        platform: "perplexity",
        observed_at: "2026-04-30T10:02:00Z",
        primary_recommendation: true,
      }),
      obs({
        id: "d",
        platform: "Perplexity",
        observed_at: "2026-04-30T10:03:00Z",
        primary_recommendation: false,
      }),
      obs({
        id: "e",
        platform: "Google AI Overviews",
        observed_at: "2026-04-30T10:04:00Z",
        primary_recommendation: true,
      }),
    ];
    const sparklines = buildPlatformPrimaryRateSparklines({
      observations,
      endDate: "2026-04-30",
      windowDays: 14,
    });
    const platforms = sparklines.map((s) => s.platform).sort();
    expect(platforms).toEqual(["chatgpt", "google_aio", "perplexity"]);
  });
});

describe("Bug-2 — buildFormatWinsRollup collapses case variants", () => {
  it("'chatgpt' + 'ChatGPT' answer_structures bucket together", () => {
    const observations: PromptAnswerObservation[] = [
      obs({
        id: "f1",
        platform: "chatgpt",
        observed_at: "2026-04-30T10:00:00Z",
        answer_structure: "ranked_list",
      }),
      obs({
        id: "f2",
        platform: "ChatGPT",
        observed_at: "2026-04-29T10:00:00Z",
        answer_structure: "ranked_list",
      }),
      obs({
        id: "f3",
        platform: "ChatGPT",
        observed_at: "2026-04-28T10:00:00Z",
        answer_structure: "narrative",
      }),
    ];
    const rollups = buildFormatWinsRollup({
      observations,
      endDate: "2026-04-30",
      windowDays: 7,
    });
    expect(rollups.length).toBe(1);
    expect(rollups[0].platform).toBe("chatgpt");
    // Total observations carrying answer_structure = 3, ranked_list = 2 (66%),
    // narrative = 1 (33%).
    expect(rollups[0].sampleCount).toBe(3);
    expect(rollups[0].dominantStructure).toBe("ranked_list");
  });
});
