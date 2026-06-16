/**
 * Expert-rec-engine Slice 3 (2026-06-16) — page-topic intent-fit scorer.
 *
 * Pins the directive PHASE C / PHASE J contract DETERMINISTICALLY (no LLM):
 *   • an unrelated query/page mismatch is rejected GENERICALLY (no hardcoded
 *     example — token coverage ≈ 0 drives it),
 *   • a high-volume but WRONG-INTENT query cannot clear the optimize gate,
 *   • intent classification covers all six classes from universal markers,
 *   • brand/locale detection comes from PASSED-IN config, never baked,
 *   • an adjacent-but-not-main query surfaces a "consider a new page" risk.
 */

import { describe, it, expect } from "vitest";

import {
  scorePageTopicFit,
  classifyQueryIntent,
  TOPIC_FIT_FLOOR,
  INTENT_FIT_FLOOR,
  type PageTopicFitInput,
} from "@/domains/recommendations/page-topic-fit";

const recipePage: PageTopicFitInput["page"] = {
  title: "Authentic Persian Koobideh Kabob Recipe",
  h1: "Persian Koobideh Kabob",
  metaDescription:
    "How to make authentic Persian koobideh kabob — ground beef, sumac, onion, and a charcoal sear.",
  urlPath: "/persian-food/koobideh-kabob",
  collectionOrCategory: "Recipes",
};

describe("classifyQueryIntent — universal markers, config-driven brand/locale", () => {
  it("informational (question words / recipe)", () => {
    expect(classifyQueryIntent("how to make koobideh kabob")).toBe("informational");
    expect(classifyQueryIntent("koobideh kabob recipe")).toBe("informational");
  });
  it("transactional (buy/price/order)", () => {
    expect(classifyQueryIntent("buy persian rugs online")).toBe("transactional");
    expect(classifyQueryIntent("persian rug price")).toBe("transactional");
  });
  it("commercial (best/review/vs)", () => {
    expect(classifyQueryIntent("best persian rugs")).toBe("commercial");
    expect(classifyQueryIntent("tabriz vs kashan rugs")).toBe("commercial");
  });
  it("local (near me / passed-in locale term)", () => {
    expect(classifyQueryIntent("persian restaurant near me")).toBe("local");
    expect(
      classifyQueryIntent("persian restaurant westwood", { localeTerms: ["Westwood"] }),
    ).toBe("local");
  });
  it("navigational only when a config brand term DOMINATES the query", () => {
    expect(classifyQueryIntent("iranopedia", { brandTerms: ["Iranopedia"] })).toBe(
      "navigational",
    );
    // brand present but not dominant → stays commercial, not navigational
    expect(
      classifyQueryIntent("best iranopedia alternative", { brandTerms: ["Iranopedia"] }),
    ).toBe("commercial");
  });
  it("mixed for conflicting families and for marker-less bare nouns", () => {
    expect(classifyQueryIntent("how to buy persian rugs")).toBe("mixed"); // info + buy
    expect(classifyQueryIntent("persian rugs")).toBe("mixed"); // ambiguous
  });
});

describe("scorePageTopicFit — generic mismatch rejection (mission #1)", () => {
  it("rejects a totally unrelated query for a page GENERICALLY (no hardcoded rule)", () => {
    // Directive's spirit: a time/utility query must not optimize an animal
    // conservation page. Driven purely by ≈0 token coverage.
    const fit = scorePageTopicFit({
      page: {
        title: "Asiatic Cheetah Conservation in Iran",
        h1: "Saving the Asiatic Cheetah",
        urlPath: "/wildlife/asiatic-cheetah",
      },
      query: "current time in tehran now",
    });
    expect(fit.topicMatchScore).toBeLessThan(TOPIC_FIT_FLOOR);
    expect(fit.shouldUseQueryForOptimization).toBe(false);
    expect(fit.mismatchRisks.length).toBeGreaterThan(0);
    expect(fit.mismatchRisks[0]).toContain("dedicated page");
  });

  it("accepts a strong, on-topic, intent-aligned query", () => {
    const fit = scorePageTopicFit({
      page: recipePage,
      query: "koobideh kabob recipe",
    });
    expect(fit.topicMatchScore).toBeGreaterThanOrEqual(TOPIC_FIT_FLOOR);
    expect(fit.intentMatchScore).toBeGreaterThanOrEqual(INTENT_FIT_FLOOR);
    expect(fit.shouldUseQueryForOptimization).toBe(true);
    expect(fit.intentClass).toBe("informational");
  });
});

describe("scorePageTopicFit — high-volume but WRONG-INTENT cannot clear the gate", () => {
  it("a transactional query on an informational recipe page fails the intent gate", () => {
    // The page's topic overlaps ('koobideh kabob'), but the query intent is
    // transactional ('price') while the page is an informational recipe —
    // Beacon must not chase it just because the words overlap.
    const fit = scorePageTopicFit({
      page: recipePage,
      query: "koobideh kabob price",
    });
    expect(fit.topicMatchScore).toBeGreaterThanOrEqual(TOPIC_FIT_FLOOR); // words overlap
    expect(fit.intentClass).toBe("transactional");
    expect(fit.intentMatchScore).toBeLessThan(INTENT_FIT_FLOOR); // but intent conflicts
    expect(fit.shouldUseQueryForOptimization).toBe(false);
    expect(fit.mismatchRisks.some((r) => r.includes("transactional"))).toBe(true);
  });

  it("keywordIntentHint reconciles the query intent when provided", () => {
    const fit = scorePageTopicFit({
      page: recipePage,
      query: "koobideh kabob", // bare → mixed without a hint
      keywordIntentHint: "informational",
    });
    expect(fit.intentClass).toBe("informational");
  });
});

describe("scorePageTopicFit — adjacent topic surfaces a 'new page' nudge", () => {
  it("a topically-adjacent query not in the title/H1 flags a softer risk", () => {
    const fit = scorePageTopicFit({
      page: recipePage,
      // related to Persian food but the page is specifically koobideh
      query: "persian ghormeh sabzi stew",
    });
    // It should NOT be a confident target for THIS page.
    expect(fit.shouldUseQueryForOptimization).toBe(false);
    expect(fit.mismatchRisks.length).toBeGreaterThan(0);
  });
});

describe("scorePageTopicFit — output contract", () => {
  it("returns the full PHASE C JSON shape with bounded scores", () => {
    const fit = scorePageTopicFit({ page: recipePage, query: "koobideh kabob recipe" });
    expect(fit).toMatchObject({
      pageTopic: expect.any(String),
      queryIntent: expect.stringContaining("koobideh"),
      intentClass: expect.any(String),
      matchExplanation: expect.any(String),
    });
    expect(fit.topicMatchScore).toBeGreaterThanOrEqual(0);
    expect(fit.topicMatchScore).toBeLessThanOrEqual(100);
    expect(fit.intentMatchScore).toBeGreaterThanOrEqual(0);
    expect(fit.intentMatchScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(fit.mismatchRisks)).toBe(true);
  });
});
