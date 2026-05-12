/**
 * Perf bundle 3 (2026-05-12) — direct path vs rollup path equivalence.
 *
 * The rollup is a performance optimization; the contract is that public
 * output (`computeVisibilityTimeSeries`, `computeLeaderboard`,
 * `computeCompetitorSeries`, `computeVisibilityTimeSeriesByPlatform`)
 * must be IDENTICAL whether or not the caller supplies `rollup`.
 *
 * These tests build a small synthetic observation set covering:
 *   • multiple dates within and outside the window
 *   • multiple platforms (chatgpt, perplexity, gemini, claude)
 *   • brand mentions via the flag AND via mentions[]
 *   • brand citations with varied positions (1, 4, 7, null)
 *   • competitors with raw vs deduped mention counts
 *   • directories that the competitor filter excludes
 *
 * Then it runs each public function BOTH ways and asserts JSON-level
 * equality. If a future edit drifts one path from the other, every
 * spec here fails simultaneously.
 */
import { describe, expect, it } from "vitest";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import {
  computeVisibilityTimeSeries,
  computeVisibilityTimeSeriesByPlatform,
  computeLeaderboard,
  computeCompetitorSeries,
  type VisibilityMetric,
} from "@/domains/product/visibility-score";
import { buildObservationRollup } from "@/domains/today/observation-rollup";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function obs(p: {
  id: string;
  date: string; // YYYY-MM-DD
  platform: string;
  flag?: boolean | null; // tracked_brand_mentioned
  cited?: boolean | null; // tracked_brand_cited
  pos?: number | null;
  mentions?: string[];
}): PromptAnswerObservation {
  return {
    id: p.id,
    prompt_id: "p",
    run_id: "r",
    answer_hash: null,
    position: p.pos ?? null,
    tracked_brand_mentioned: p.flag ?? null,
    tracked_brand_cited: p.cited ?? null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: p.mentions ?? [],
    observed_at: `${p.date}T12:00:00Z`,
    platform: p.platform,
    topic: "topic",
    metadata: {},
    tenant_id: "tenant-test",
  };
}

const BRAND_ALIASES = ["Ritz Builders", "Ritz", "ritzbuilders.com"];

/**
 * 25 observations spanning 2026-04-25 → 2026-05-04 across 4 platforms.
 * Mixture of brand mentions, brand citations, competitor mentions, and
 * mentions with duplicates inside one obs (to exercise raw vs deduped).
 */
const FIXTURE: PromptAnswerObservation[] = [
  // 2026-04-25
  obs({ id: "1", date: "2026-04-25", platform: "chatgpt", flag: true, cited: true, pos: 1, mentions: ["Ritz Builders", "Acme", "Acme"] }),
  obs({ id: "2", date: "2026-04-25", platform: "chatgpt", cited: false, mentions: ["Beta Constructors", "Beta Constructors", "Beta Constructors"] }),
  obs({ id: "3", date: "2026-04-25", platform: "perplexity", flag: false, cited: true, pos: 5, mentions: ["Ritz Builders", "Gamma Builders"] }),

  // 2026-04-26
  obs({ id: "4", date: "2026-04-26", platform: "chatgpt", mentions: ["Acme", "Delta Inc"] }),
  obs({ id: "5", date: "2026-04-26", platform: "gemini", flag: true, mentions: ["Ritz", "Acme"] }),
  obs({ id: "6", date: "2026-04-26", platform: "gemini", cited: true, pos: 8, mentions: ["Houzz", "Yelp"] }), // directories — should be filtered

  // 2026-04-27 — sampled gap then full day
  obs({ id: "7", date: "2026-04-27", platform: "chatgpt", flag: true, cited: true, pos: null, mentions: ["RITZ BUILDERS", "Acme Inc"] }),
  obs({ id: "8", date: "2026-04-27", platform: "claude", mentions: ["Beta Constructors"] }),
  obs({ id: "9", date: "2026-04-27", platform: "perplexity", cited: true, pos: 2, mentions: ["Acme"] }),

  // 2026-04-28
  obs({ id: "10", date: "2026-04-28", platform: "chatgpt", mentions: [] }),
  obs({ id: "11", date: "2026-04-28", platform: "chatgpt", flag: true, mentions: ["Ritz Builders"] }),

  // 2026-04-29
  obs({ id: "12", date: "2026-04-29", platform: "perplexity", cited: true, pos: 1, mentions: ["Ritz", "Gamma Builders", "Gamma Builders"] }),
  obs({ id: "13", date: "2026-04-29", platform: "gemini", mentions: ["Acme Inc"] }),

  // 2026-04-30
  obs({ id: "14", date: "2026-04-30", platform: "chatgpt", flag: true, cited: true, pos: 4, mentions: ["Ritz Builders", "Beta Constructors"] }),
  obs({ id: "15", date: "2026-04-30", platform: "claude", flag: true, mentions: ["Ritz"] }),

  // 2026-05-01
  obs({ id: "16", date: "2026-05-01", platform: "chatgpt", cited: false, mentions: ["Beta Constructors", "Acme"] }),
  obs({ id: "17", date: "2026-05-01", platform: "perplexity", flag: true, cited: true, pos: 3 }),
  obs({ id: "18", date: "2026-05-01", platform: "gemini", mentions: ["Gamma Builders"] }),

  // 2026-05-02
  obs({ id: "19", date: "2026-05-02", platform: "chatgpt", flag: true, cited: true, pos: 1, mentions: ["Ritz Builders"] }),
  obs({ id: "20", date: "2026-05-02", platform: "claude", mentions: ["Acme", "Delta Inc"] }),

  // 2026-05-03
  obs({ id: "21", date: "2026-05-03", platform: "perplexity", cited: true, pos: 6, mentions: ["Ritz", "Beta Constructors"] }),
  obs({ id: "22", date: "2026-05-03", platform: "chatgpt", mentions: ["Gamma Builders", "Acme"] }),

  // 2026-05-04
  obs({ id: "23", date: "2026-05-04", platform: "chatgpt", flag: true, mentions: ["Ritz"] }),
  obs({ id: "24", date: "2026-05-04", platform: "perplexity", cited: true, pos: 1, mentions: ["Ritz Builders"] }),
  obs({ id: "25", date: "2026-05-04", platform: "gemini", mentions: ["Acme Inc", "Acme Inc"] }),
];

function te(p: {
  id: string;
  name: string;
  entity_type: TrackedEntity["entity_type"];
  is_owned?: boolean;
}): TrackedEntity {
  return {
    id: p.id,
    account_id: "a",
    tenant_id: "t",
    entity_type: p.entity_type,
    name: p.name,
    aliases: [],
    domain: null,
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: p.is_owned ?? false,
    is_active: true,
    metadata: {},
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  };
}

const TRACKED_ENTITIES: TrackedEntity[] = [
  te({ id: "te-1", name: "Ritz Builders", entity_type: "brand", is_owned: true }),
  te({ id: "te-2", name: "Acme", entity_type: "competitor" }),
  te({ id: "te-3", name: "Beta Constructors", entity_type: "competitor" }),
  te({ id: "te-4", name: "Gamma Builders", entity_type: "competitor" }),
  te({ id: "te-5", name: "Delta Inc", entity_type: "competitor" }),
  // Directory rows — the competitor-ranking filter excludes these from
  // leaderboard rows.
  te({ id: "te-6", name: "Houzz", entity_type: "directory_source" }),
  te({ id: "te-7", name: "Yelp", entity_type: "directory_source" }),
];

const ROLLUP = buildObservationRollup({
  observations: FIXTURE,
  brandAliases: BRAND_ALIASES,
});

const METRICS: VisibilityMetric[] = ["mention_rate", "citation_rate", "composite"];
const WINDOWS: number[] = [7, 14, 30, 60];

// ---------------------------------------------------------------------------
// Equivalence specs
// ---------------------------------------------------------------------------

describe("Direct path vs rollup path equivalence", () => {
  describe("computeVisibilityTimeSeries (brand)", () => {
    for (const metric of METRICS) {
      it(`metric=${metric} → both paths identical`, () => {
        const direct = computeVisibilityTimeSeries({
          observations: FIXTURE,
          metric,
          brandAliases: BRAND_ALIASES,
          startDate: "2026-04-25",
          endDate: "2026-05-04",
        });
        const viaRollup = computeVisibilityTimeSeries({
          observations: FIXTURE,
          metric,
          brandAliases: BRAND_ALIASES,
          startDate: "2026-04-25",
          endDate: "2026-05-04",
          rollup: ROLLUP,
        });
        expect(viaRollup).toEqual(direct);
      });
    }

    it("window outside the data → both paths return []", () => {
      const direct = computeVisibilityTimeSeries({
        observations: FIXTURE,
        metric: "composite",
        brandAliases: BRAND_ALIASES,
        startDate: "2026-06-01",
        endDate: "2026-06-30",
      });
      const viaRollup = computeVisibilityTimeSeries({
        observations: FIXTURE,
        metric: "composite",
        brandAliases: BRAND_ALIASES,
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        rollup: ROLLUP,
      });
      expect(direct).toEqual([]);
      expect(viaRollup).toEqual([]);
    });
  });

  describe("computeVisibilityTimeSeries (competitor)", () => {
    for (const name of ["Acme", "Beta Constructors", "Gamma Builders"]) {
      for (const metric of METRICS) {
        it(`competitor=${name} metric=${metric} → both paths identical`, () => {
          const direct = computeVisibilityTimeSeries({
            observations: FIXTURE,
            metric,
            brandAliases: BRAND_ALIASES,
            startDate: "2026-04-25",
            endDate: "2026-05-04",
            competitorName: name,
          });
          const viaRollup = computeVisibilityTimeSeries({
            observations: FIXTURE,
            metric,
            brandAliases: BRAND_ALIASES,
            startDate: "2026-04-25",
            endDate: "2026-05-04",
            competitorName: name,
            rollup: ROLLUP,
          });
          expect(viaRollup).toEqual(direct);
        });
      }
    }
  });

  describe("computeVisibilityTimeSeriesByPlatform", () => {
    it("partial-platform sampling: both paths produce identical platform → series map", () => {
      const direct = computeVisibilityTimeSeriesByPlatform({
        observations: FIXTURE,
        brandAliases: BRAND_ALIASES,
        startDate: "2026-04-25",
        endDate: "2026-05-04",
      });
      const viaRollup = computeVisibilityTimeSeriesByPlatform({
        observations: FIXTURE,
        brandAliases: BRAND_ALIASES,
        startDate: "2026-04-25",
        endDate: "2026-05-04",
        rollup: ROLLUP,
      });
      // Same set of platforms, same points per platform.
      expect(Object.keys(viaRollup).sort()).toEqual(Object.keys(direct).sort());
      for (const p of Object.keys(direct)) {
        expect(viaRollup[p]).toEqual(direct[p]);
      }
    });
  });

  describe("computeLeaderboard", () => {
    for (const metric of METRICS) {
      for (const windowDays of WINDOWS) {
        it(`metric=${metric} window=${windowDays}d → both paths identical (with trackedEntities filter)`, () => {
          const direct = computeLeaderboard({
            observations: FIXTURE,
            brandAliases: BRAND_ALIASES,
            windowEndDate: "2026-05-04",
            windowDays,
            metric,
            trackedEntities: TRACKED_ENTITIES,
            limit: 5,
          });
          const viaRollup = computeLeaderboard({
            observations: FIXTURE,
            brandAliases: BRAND_ALIASES,
            windowEndDate: "2026-05-04",
            windowDays,
            metric,
            trackedEntities: TRACKED_ENTITIES,
            limit: 5,
            rollup: ROLLUP,
          });
          expect(viaRollup).toEqual(direct);
        });
      }
    }

    it("without trackedEntities filter → both paths identical", () => {
      const direct = computeLeaderboard({
        observations: FIXTURE,
        brandAliases: BRAND_ALIASES,
        windowEndDate: "2026-05-04",
        windowDays: 14,
        metric: "composite",
        limit: 5,
      });
      const viaRollup = computeLeaderboard({
        observations: FIXTURE,
        brandAliases: BRAND_ALIASES,
        windowEndDate: "2026-05-04",
        windowDays: 14,
        metric: "composite",
        limit: 5,
        rollup: ROLLUP,
      });
      expect(viaRollup).toEqual(direct);
    });

    it("previous window sparse → both paths return null delta identically", () => {
      // 60d window forces the previous window into pre-fixture territory (sparse).
      const direct = computeLeaderboard({
        observations: FIXTURE,
        brandAliases: BRAND_ALIASES,
        windowEndDate: "2026-05-04",
        windowDays: 60,
        metric: "composite",
        trackedEntities: TRACKED_ENTITIES,
      });
      const viaRollup = computeLeaderboard({
        observations: FIXTURE,
        brandAliases: BRAND_ALIASES,
        windowEndDate: "2026-05-04",
        windowDays: 60,
        metric: "composite",
        trackedEntities: TRACKED_ENTITIES,
        rollup: ROLLUP,
      });
      expect(viaRollup).toEqual(direct);
      // And confirm at least one row has null delta in the sparse-prev case.
      const someNull = viaRollup.some((row) => row.delta === null);
      expect(someNull).toBe(true);
    });
  });

  describe("computeCompetitorSeries", () => {
    for (const metric of METRICS) {
      it(`metric=${metric} → both paths identical (brand + 3 competitors)`, () => {
        const direct = computeCompetitorSeries({
          observations: FIXTURE,
          brandAliases: BRAND_ALIASES,
          competitorNames: ["Acme", "Beta Constructors", "Gamma Builders"],
          metric,
          startDate: "2026-04-25",
          endDate: "2026-05-04",
        });
        const viaRollup = computeCompetitorSeries({
          observations: FIXTURE,
          brandAliases: BRAND_ALIASES,
          competitorNames: ["Acme", "Beta Constructors", "Gamma Builders"],
          metric,
          startDate: "2026-04-25",
          endDate: "2026-05-04",
          rollup: ROLLUP,
        });
        expect(viaRollup).toEqual(direct);
      });
    }

    it("empty competitor list → both paths return only the brand series", () => {
      const direct = computeCompetitorSeries({
        observations: FIXTURE,
        brandAliases: BRAND_ALIASES,
        competitorNames: [],
        metric: "composite",
        startDate: "2026-04-25",
        endDate: "2026-05-04",
      });
      const viaRollup = computeCompetitorSeries({
        observations: FIXTURE,
        brandAliases: BRAND_ALIASES,
        competitorNames: [],
        metric: "composite",
        startDate: "2026-04-25",
        endDate: "2026-05-04",
        rollup: ROLLUP,
      });
      expect(viaRollup).toEqual(direct);
      expect(viaRollup).toHaveLength(1);
      expect(viaRollup[0].isOwned).toBe(true);
    });
  });

  describe("empty inputs", () => {
    const EMPTY_ROLLUP = buildObservationRollup({
      observations: [],
      brandAliases: BRAND_ALIASES,
    });

    it("computeVisibilityTimeSeries with empty obs → both paths return []", () => {
      const direct = computeVisibilityTimeSeries({
        observations: [],
        metric: "composite",
        brandAliases: BRAND_ALIASES,
        startDate: "2026-04-25",
        endDate: "2026-05-04",
      });
      const viaRollup = computeVisibilityTimeSeries({
        observations: [],
        metric: "composite",
        brandAliases: BRAND_ALIASES,
        startDate: "2026-04-25",
        endDate: "2026-05-04",
        rollup: EMPTY_ROLLUP,
      });
      expect(direct).toEqual([]);
      expect(viaRollup).toEqual([]);
    });

    it("computeLeaderboard with empty obs → both paths return []", () => {
      const direct = computeLeaderboard({
        observations: [],
        brandAliases: BRAND_ALIASES,
        windowEndDate: "2026-05-04",
        windowDays: 14,
        metric: "composite",
        trackedEntities: TRACKED_ENTITIES,
      });
      const viaRollup = computeLeaderboard({
        observations: [],
        brandAliases: BRAND_ALIASES,
        windowEndDate: "2026-05-04",
        windowDays: 14,
        metric: "composite",
        trackedEntities: TRACKED_ENTITIES,
        rollup: EMPTY_ROLLUP,
      });
      expect(direct).toEqual(viaRollup);
    });
  });
});
