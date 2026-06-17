/**
 * Expert-rec-engine PHASE D (2026-06-16) — keyword/fanout merge.
 *
 * Pins the directive's PHASE-D/J rules:
 *   • GSC + SEMrush + fanout merge & dedupe into one portfolio;
 *   • prefer high-volume/low-difficulty ONLY when intent matches the page;
 *   • a high-volume WRONG-INTENT keyword is NOT chased (do-not-target + reason);
 *   • an off-topic keyword is rejected (not stuffed);
 *   • a topically-adjacent high-demand keyword becomes a new-page candidate;
 *   • question-shaped terms land as question targets;
 *   • rejected keywords carry a reason. No hardcoded keyword lists.
 */

import { describe, it, expect } from "vitest";

import {
  buildKeywordPortfolio,
  type PortfolioInputKeyword,
} from "@/domains/recommendations/keyword-portfolio";

// A Persian koobideh-kabob RECIPE page (informational).
const PAGE_TOKENS = ["persian", "koobideh", "kabob", "recipe", "grilling", "beef"];

const KEYWORDS: PortfolioInputKeyword[] = [
  { term: "koobideh kabob recipe", source: "gsc", volume: 1800, position: 6 },
  { term: "Koobideh Kabob Recipe", source: "semrush", volume: 2000, difficulty: 22 }, // dup (case)
  { term: "how to grill koobideh", source: "fanout" },
  { term: "buy koobideh kabob skewers", source: "semrush", volume: 500, difficulty: 30 }, // wrong intent
  { term: "persian rug cleaning", source: "semrush", volume: 900, difficulty: 18 }, // adjacent topic
  { term: "current time in tehran", source: "gsc", volume: 5000 }, // high-volume, off-topic
];

describe("buildKeywordPortfolio", () => {
  const portfolio = buildKeywordPortfolio({
    keywords: KEYWORDS,
    pageIntentClass: "informational",
    pageTopicTokens: PAGE_TOKENS,
  });

  it("merges duplicate terms and leads with the best on-intent demand", () => {
    expect(portfolio.primaryTarget).toBe("koobideh kabob recipe");
    // the dup (case variant) must NOT appear as a separate secondary
    expect(portfolio.secondaryTargets).not.toContain("Koobideh Kabob Recipe");
  });

  it("does NOT chase a high-volume WRONG-INTENT keyword (transactional on an info page)", () => {
    const buy = portfolio.doNotTargetHere.find((d) => d.term === "buy koobideh kabob skewers");
    expect(buy).toBeDefined();
    expect(buy!.reason).toMatch(/intent mismatch/i);
  });

  it("rejects a high-volume OFF-TOPIC keyword rather than stuffing it", () => {
    const off = portfolio.doNotTargetHere.find((d) => d.term === "current time in tehran");
    expect(off).toBeDefined();
    expect(off!.reason).toMatch(/off-topic/i);
    expect(portfolio.primaryTarget).not.toBe("current time in tehran");
  });

  it("routes a topically-adjacent high-demand keyword to a NEW PAGE", () => {
    expect(portfolio.newPageCandidates).toContain("persian rug cleaning");
  });

  it("captures a question-shaped term as a question target", () => {
    expect(portfolio.questionTargets).toContain("how to grill koobideh");
  });

  it("explains the portfolio + leaves the LLM-only fields structured-empty", () => {
    expect(portfolio.reasoning).toContain("koobideh kabob recipe");
    expect(portfolio.reasoning.length).toBeGreaterThan(10);
    expect(portfolio.entityAliases).toEqual([]);
    expect(portfolio.transliterationVariants).toEqual([]);
  });

  it("no input → an empty, safe portfolio (null primary, no throw)", () => {
    const empty = buildKeywordPortfolio({
      keywords: [],
      pageIntentClass: "mixed",
      pageTopicTokens: [],
    });
    expect(empty.primaryTarget).toBeNull();
    expect(empty.secondaryTargets).toEqual([]);
    expect(empty.reasoning.length).toBeGreaterThan(0);
  });

  it("brand-dominant term is classified navigational via passed-in config (no hardcoding)", () => {
    const p = buildKeywordPortfolio({
      keywords: [{ term: "iranopedia", source: "gsc", volume: 300 }],
      pageIntentClass: "navigational",
      pageTopicTokens: ["iranopedia", "persian", "food"],
      brandTerms: ["Iranopedia"],
    });
    // navigational query on a navigational page → compatible → targeted, not rejected
    expect(p.doNotTargetHere.find((d) => d.term === "iranopedia")).toBeUndefined();
  });
});
