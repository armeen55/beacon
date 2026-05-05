/**
 * T1 (operator audit, 2026-05-05) — descriptor quality filter at rollup.
 *
 * Pre-T1: hosted /today still showed "custom · home · builder · closed
 * · area" as top descriptors because pre-W4 observations carry
 * descriptor_window tokens extracted before recent stopword additions.
 * Re-extracting every observation is expensive; instead we apply the
 * SAME stopword filter at rollup time so legacy data renders clean.
 *
 * These tests pin the contract:
 *
 *   1. Hard global stopwords (custom, home, builder, area, closed,
 *      etc.) NEVER appear in `topDescriptors` regardless of how
 *      common they are in observation data.
 *
 *   2. Tenant business-config `stripWords` (city names, brand parts)
 *      are also dropped — same filter, additive.
 *
 *   3. Meaningful descriptors (luxury, award-winning, design-build,
 *      sustainable, modern) survive.
 *
 *   4. Competitor rollup uses the SAME filter — the brand and
 *      competitor columns can't be filtered differently.
 *
 *   5. When fewer than `MIN_USEFUL_DESCRIPTORS` survive the filter,
 *      the rollup still returns the rest (the UI handles the empty
 *      state — see enrichment-v2.test.tsx).
 */

import { describe, expect, it } from "vitest";
import {
  buildEnrichmentRollup,
  buildEnrichmentWindowRollup,
  buildCompetitorEnrichmentRollup,
  MIN_USEFUL_DESCRIPTORS,
} from "./enrichment-rollup";
import type { PromptAnswerObservation } from "./types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function obs(
  date: string,
  descriptor_window: string[],
  competitor_descriptor_windows?: Record<string, string[]> | null,
): PromptAnswerObservation {
  return {
    id: `obs-${date}-${Math.random().toString(36).slice(2, 8)}`,
    prompt_id: "p-1",
    run_id: "run-1",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: true,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: `${date}T00:00:00.000Z`,
    platform: "perplexity",
    topic: "",
    descriptor_window,
    competitor_descriptor_windows: competitor_descriptor_windows ?? null,
  } as unknown as PromptAnswerObservation;
}

const TODAY = "2026-05-05";

// ---------------------------------------------------------------------------
// 1. Hard global stopwords are filtered
// ---------------------------------------------------------------------------

describe("T1 — generic global stopwords are filtered from buildEnrichmentRollup", () => {
  it("custom / home / builder / area / closed never appear as top descriptors", () => {
    // 30 observations, each carrying the operator-reported pollution
    // tokens. Only "luxury" should survive as a real descriptor.
    const observations = Array.from({ length: 30 }, () =>
      obs(TODAY, [
        "custom",
        "home",
        "builder",
        "area",
        "closed",
        "luxury",
      ]),
    );
    const rollup = buildEnrichmentRollup({ observations, date: TODAY });
    const words = rollup.topDescriptors.map((d) => d.word);
    expect(words).not.toContain("custom");
    expect(words).not.toContain("home");
    expect(words).not.toContain("builder");
    expect(words).not.toContain("area");
    expect(words).not.toContain("closed");
    // The meaningful one survives.
    expect(words).toContain("luxury");
  });

  it("T1-additions (bay, inc, include, local, best, top) are filtered", () => {
    const observations = Array.from({ length: 20 }, () =>
      obs(TODAY, [
        "bay",
        "inc",
        "include",
        "local",
        "best",
        "top",
        "award-winning",
      ]),
    );
    const rollup = buildEnrichmentRollup({ observations, date: TODAY });
    const words = rollup.topDescriptors.map((d) => d.word);
    expect(words).not.toContain("bay");
    expect(words).not.toContain("inc");
    expect(words).not.toContain("include");
    expect(words).not.toContain("local");
    expect(words).not.toContain("best");
    expect(words).not.toContain("top");
    expect(words).toContain("award-winning");
  });

  it("filter is case-insensitive — 'Custom' / 'CUSTOM' / 'custom' all dropped", () => {
    const observations = [
      obs(TODAY, ["Custom", "luxury"]),
      obs(TODAY, ["CUSTOM", "luxury"]),
      obs(TODAY, ["custom", "luxury"]),
    ];
    const rollup = buildEnrichmentRollup({ observations, date: TODAY });
    const words = rollup.topDescriptors.map((d) => d.word.toLowerCase());
    expect(words).not.toContain("custom");
    expect(words).toContain("luxury");
  });
});

// ---------------------------------------------------------------------------
// 2. Tenant stripWords are also dropped
// ---------------------------------------------------------------------------

describe("T1 — tenant business-config stripWords are also filtered", () => {
  it("Bay-Area city names (atherton, palo, alto) are dropped via tenantStripWords", () => {
    const observations = Array.from({ length: 20 }, () =>
      obs(TODAY, ["atherton", "palo", "alto", "luxury", "design-build"]),
    );
    const rollup = buildEnrichmentRollup({
      observations,
      date: TODAY,
      tenantStripWords: ["atherton", "palo", "alto"],
    });
    const words = rollup.topDescriptors.map((d) => d.word);
    expect(words).not.toContain("atherton");
    expect(words).not.toContain("palo");
    expect(words).not.toContain("alto");
    expect(words).toContain("luxury");
    expect(words).toContain("design-build");
  });

  it("brand parts (ritz, builders) are dropped via tenantStripWords", () => {
    const observations = Array.from({ length: 20 }, () =>
      obs(TODAY, ["ritz", "builders", "premier", "trusted"]),
    );
    const rollup = buildEnrichmentRollup({
      observations,
      date: TODAY,
      tenantStripWords: ["ritz", "builders"],
    });
    const words = rollup.topDescriptors.map((d) => d.word);
    expect(words).not.toContain("ritz");
    expect(words).not.toContain("builders");
    expect(words).toContain("premier");
    expect(words).toContain("trusted");
  });

  it("undefined / empty tenantStripWords still applies the global filter", () => {
    const observations = Array.from({ length: 10 }, () =>
      obs(TODAY, ["custom", "home", "luxury"]),
    );
    const rollupUndefined = buildEnrichmentRollup({
      observations,
      date: TODAY,
    });
    const rollupEmpty = buildEnrichmentRollup({
      observations,
      date: TODAY,
      tenantStripWords: [],
    });
    for (const r of [rollupUndefined, rollupEmpty]) {
      expect(r.topDescriptors.map((d) => d.word)).not.toContain("custom");
      expect(r.topDescriptors.map((d) => d.word)).not.toContain("home");
      expect(r.topDescriptors.map((d) => d.word)).toContain("luxury");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Meaningful descriptors survive
// ---------------------------------------------------------------------------

describe("T1 — meaningful Ritz-style descriptors survive the filter", () => {
  it("luxury / award-winning / design-build / sustainable / modern all pass through", () => {
    const meaningful = [
      "luxury",
      "award-winning",
      "design-build",
      "sustainable",
      "modern",
      "bespoke",
      "high-end",
      "trusted",
      "premier",
      "boutique",
    ];
    const observations = Array.from({ length: 5 }, () =>
      obs(TODAY, [...meaningful, "custom", "home"]), // mix in pollution
    );
    const rollup = buildEnrichmentRollup({
      observations,
      date: TODAY,
      maxDescriptors: 20,
      tenantStripWords: ["ritz", "builders", "atherton"],
    });
    const words = rollup.topDescriptors.map((d) => d.word);
    for (const m of meaningful) {
      expect(
        words,
        `meaningful descriptor "${m}" must survive the T1 quality filter`,
      ).toContain(m);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Competitor rollup uses the same filter
// ---------------------------------------------------------------------------

describe("T1 — competitor rollup applies the same quality filter", () => {
  it("competitor descriptors drop the same global pollution tokens", () => {
    const competitorName = "De Mattei Construction";
    const observations = Array.from({ length: 20 }, () =>
      obs(
        TODAY,
        [], // brand window doesn't matter for this test
        {
          [competitorName]: ["custom", "home", "builder", "area", "luxury"],
        },
      ),
    );
    // Mark them as having co-mentioned the competitor.
    for (const o of observations) {
      (o as { competitor_co_mentions?: string[] }).competitor_co_mentions = [
        competitorName,
      ];
    }
    const rollup = buildCompetitorEnrichmentRollup({
      observations,
      competitorName,
      endDate: TODAY,
    });
    const words = rollup.topDescriptors.map((d) => d.word);
    expect(words).not.toContain("custom");
    expect(words).not.toContain("home");
    expect(words).not.toContain("builder");
    expect(words).not.toContain("area");
    expect(words).toContain("luxury");
  });

  it("competitor rollup honors tenantStripWords", () => {
    const competitorName = "Supple Homes";
    const observations = Array.from({ length: 20 }, () =>
      obs(
        TODAY,
        [],
        {
          [competitorName]: ["atherton", "palo", "modern", "sustainable"],
        },
      ),
    );
    for (const o of observations) {
      (o as { competitor_co_mentions?: string[] }).competitor_co_mentions = [
        competitorName,
      ];
    }
    const rollup = buildCompetitorEnrichmentRollup({
      observations,
      competitorName,
      endDate: TODAY,
      tenantStripWords: ["atherton", "palo"],
    });
    const words = rollup.topDescriptors.map((d) => d.word);
    expect(words).not.toContain("atherton");
    expect(words).not.toContain("palo");
    expect(words).toContain("modern");
    expect(words).toContain("sustainable");
  });
});

// ---------------------------------------------------------------------------
// 5. Window rollup + delta math respects the filter
// ---------------------------------------------------------------------------

describe("T1 — buildEnrichmentWindowRollup applies the filter to BOTH windows", () => {
  it("a token in only the prior window cannot inflate the current rank-delta", () => {
    // Prior window has ONLY "custom" (filtered) + "luxury" (kept).
    // Current window has only "luxury".
    // After filter, prior-window has just "luxury" rank=1, current rank=1.
    // delta = priorRank(1) - currentRank(1) = 0 → "—" not "↑".
    const priorDate = "2026-04-25";
    const currentDate = "2026-05-05";
    const observations = [
      ...Array.from({ length: 5 }, () =>
        obs(priorDate, ["custom", "luxury"]),
      ),
      ...Array.from({ length: 5 }, () =>
        obs(currentDate, ["luxury"]),
      ),
    ];
    const rollup = buildEnrichmentWindowRollup({
      observations,
      endDate: currentDate,
      windowDays: 7,
      maxDescriptors: 5,
    });
    const luxury = rollup.topDescriptorsWithDelta.find(
      (d) => d.word === "luxury",
    );
    expect(luxury).toBeDefined();
    expect(luxury!.rankPriorWindow).toBe(1);
    expect(luxury!.rankThisWindow).toBe(1);
    expect(luxury!.delta).toBe(0);
    // And custom must NOT appear in either side.
    expect(rollup.topDescriptorsWithDelta.map((d) => d.word)).not.toContain(
      "custom",
    );
  });
});

// ---------------------------------------------------------------------------
// 6. MIN_USEFUL_DESCRIPTORS export
// ---------------------------------------------------------------------------

describe("T1 — MIN_USEFUL_DESCRIPTORS threshold is exported and operator-locked", () => {
  it("MIN_USEFUL_DESCRIPTORS === 3", () => {
    // Operator brief: "If fewer than 3 useful descriptors remain,
    // show: 'Not enough distinctive description signal yet.'"
    expect(MIN_USEFUL_DESCRIPTORS).toBe(3);
  });
});
