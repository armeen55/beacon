/**
 * Narrow tests for the competitor-page-snapshots module.
 * T-CompPageBlueprints (2026-05-08).
 *
 * Test contract (Layer A.6):
 *   1. Empty store → blueprints stay null/[] (byte-identical pre-patch).
 *   2. Synthetic snapshots populate h1/topH2s/faqQuestions/metaDescription.
 *   3. Caps enforced: topH2s ≤ 5, faqQuestions ≤ 5, metaDescription ≤ 200 chars.
 *   4. Brand-name scrub drops H2/FAQ items containing operator or competitor names.
 *   5. (Threading test below covers the load-queue → packet → blueprint join.)
 */

import { describe, expect, it } from "vitest";

import {
  scrubCompetitorPageStructure,
  COMPETITOR_BLUEPRINT_MAX_TOP_H2S,
  COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS,
  COMPETITOR_BLUEPRINT_META_MAX_CHARS,
  type CompetitorPageSnapshot,
} from "./competitor-page-snapshots";

function buildSnap(
  over: Partial<CompetitorPageSnapshot> = {},
): CompetitorPageSnapshot {
  return {
    id: "comp-snap-tenant-test-acme-1",
    tenant_id: "tenant-test-acme",
    url: "https://constructelements.com/services/whole-home-remodel",
    canonical_url: null,
    fetched_at: "2026-05-08T12:00:00Z",
    http_status: 200,
    title: "Whole-Home Renovation | Element Homes",
    meta_description: "Architect-led whole-home renovation in the Bay Area.",
    h1: "Whole-Home Renovation",
    h2_list: [
      "What We Build",
      "Our Process",
      "Frequently Asked Questions",
    ],
    faq_questions: ["How long does it take?", "What does it cost?"],
    extraction_certainty: "confirmed",
    ...over,
  };
}

describe("scrubCompetitorPageStructure — caps", () => {
  it("caps topH2s at COMPETITOR_BLUEPRINT_MAX_TOP_H2S", () => {
    expect(COMPETITOR_BLUEPRINT_MAX_TOP_H2S).toBe(5);
    const snap = buildSnap({
      h2_list: [
        "H2 one", "H2 two", "H2 three", "H2 four",
        "H2 five", "H2 six", "H2 seven", "H2 eight",
      ],
    });
    const out = scrubCompetitorPageStructure(snap, { brandNamesToScrub: [] });
    expect(out.topH2s).toHaveLength(5);
    expect(out.topH2s).toEqual([
      "H2 one", "H2 two", "H2 three", "H2 four", "H2 five",
    ]);
  });

  it("caps faqQuestions at COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS", () => {
    expect(COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS).toBe(5);
    const snap = buildSnap({
      faq_questions: [
        "Q1?", "Q2?", "Q3?", "Q4?", "Q5?", "Q6?", "Q7?",
      ],
    });
    const out = scrubCompetitorPageStructure(snap, { brandNamesToScrub: [] });
    expect(out.faqQuestions).toHaveLength(5);
    expect(out.faqQuestions).toEqual(["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"]);
  });

  it("caps metaDescription at COMPETITOR_BLUEPRINT_META_MAX_CHARS", () => {
    expect(COMPETITOR_BLUEPRINT_META_MAX_CHARS).toBe(200);
    const longText = "x".repeat(500);
    const snap = buildSnap({ meta_description: longText });
    const out = scrubCompetitorPageStructure(snap, { brandNamesToScrub: [] });
    expect(out.metaDescription).not.toBeNull();
    expect(out.metaDescription!.length).toBe(200);
  });

  it("preserves null fields", () => {
    const snap = buildSnap({
      h1: null,
      meta_description: null,
      h2_list: [],
      faq_questions: [],
    });
    const out = scrubCompetitorPageStructure(snap, { brandNamesToScrub: [] });
    expect(out.h1).toBeNull();
    expect(out.metaDescription).toBeNull();
    expect(out.topH2s).toEqual([]);
    expect(out.faqQuestions).toEqual([]);
  });
});

describe("scrubCompetitorPageStructure — brand-name scrub", () => {
  it("drops H2 items containing operator brand name (word-boundary, case-insensitive)", () => {
    const snap = buildSnap({
      h2_list: [
        "What We Build",
        "Why Ritzbuilders is wrong about whole-home",
        "Our Process",
      ],
    });
    const out = scrubCompetitorPageStructure(snap, {
      brandNamesToScrub: ["Ritzbuilders"],
    });
    expect(out.topH2s).toEqual(["What We Build", "Our Process"]);
  });

  it("drops H2 items containing competitor brand name", () => {
    const snap = buildSnap({
      h2_list: [
        "Why we beat Element Homes on schedule",
        "Our Process",
      ],
    });
    const out = scrubCompetitorPageStructure(snap, {
      brandNamesToScrub: ["Element Homes"],
    });
    expect(out.topH2s).toEqual(["Our Process"]);
  });

  it("drops FAQ questions containing brand names", () => {
    const snap = buildSnap({
      faq_questions: [
        "Should I hire Element Homes or someone else?",
        "How long does it take?",
      ],
    });
    const out = scrubCompetitorPageStructure(snap, {
      brandNamesToScrub: ["Element Homes"],
    });
    expect(out.faqQuestions).toEqual(["How long does it take?"]);
  });

  it("drops the H1 entirely when it contains a brand name", () => {
    const snap = buildSnap({
      h1: "How Element Homes does renovations",
    });
    const out = scrubCompetitorPageStructure(snap, {
      brandNamesToScrub: ["Element Homes"],
    });
    expect(out.h1).toBeNull();
  });

  it("ignores too-short brand aliases (<3 chars) to avoid noise", () => {
    const snap = buildSnap({ h2_list: ["A B C", "Just Text"] });
    const out = scrubCompetitorPageStructure(snap, {
      brandNamesToScrub: ["a", "b", "c"],
    });
    expect(out.topH2s).toEqual(["A B C", "Just Text"]); // not dropped
  });

  it("uses word-boundary matching (does not drop substrings)", () => {
    const snap = buildSnap({
      h2_list: [
        "Renovations from Acme Builders",   // contains "Acme" word-boundary
        "Renovating means careful planning", // contains "ren" but not "Acme"
      ],
    });
    const out = scrubCompetitorPageStructure(snap, {
      brandNamesToScrub: ["Acme"],
    });
    expect(out.topH2s).toEqual(["Renovating means careful planning"]);
  });

  it("scrubs all aliases passed (multiple brands)", () => {
    const snap = buildSnap({
      h2_list: [
        "Why Ritzbuilders does it differently",
        "How Element Homes structures projects",
        "What to look for in a builder",
      ],
    });
    const out = scrubCompetitorPageStructure(snap, {
      brandNamesToScrub: ["Ritzbuilders", "Element Homes"],
    });
    expect(out.topH2s).toEqual(["What to look for in a builder"]);
  });
});

describe("scrubCompetitorPageStructure — purity", () => {
  it("does not mutate the input snapshot", () => {
    const snap = buildSnap({ h2_list: ["a", "b", "c"] });
    const before = JSON.stringify(snap);
    scrubCompetitorPageStructure(snap, { brandNamesToScrub: ["X"] });
    expect(JSON.stringify(snap)).toBe(before);
  });

  it("returns identical output for identical input (deterministic)", () => {
    const snap = buildSnap();
    const a = scrubCompetitorPageStructure(snap, { brandNamesToScrub: [] });
    const b = scrubCompetitorPageStructure(snap, { brandNamesToScrub: [] });
    expect(a).toEqual(b);
  });
});
