/**
 * W3 Step 3.5b.F (2026-05-02) — buildResolvedRecommendationTitle tests.
 *
 * Locks the prompt-shaped-label fix the operator's browser audit
 * caught: "Create a If I buy a property…" (broken grammar). Now
 * sentence-shaped labels wrap as `Create a page for "<label>"`.
 *
 * Pure-function tests over the title builder.
 */

import { describe, expect, it } from "vitest";

import {
  buildResolvedRecommendationTitle,
  looksLikePromptText,
} from "./build-title";

describe("looksLikePromptText — prompt-shaped detection", () => {
  it("flags sentences starting with prompt-starter words", () => {
    expect(looksLikePromptText("If I buy a property")).toBe(true);
    expect(looksLikePromptText("When should I remodel?")).toBe(true);
    expect(looksLikePromptText("How much does a kitchen cost")).toBe(true);
    expect(looksLikePromptText("Who builds custom homes")).toBe(true);
    expect(looksLikePromptText("What is the best contractor")).toBe(true);
    expect(looksLikePromptText("Should I rebuild or remodel")).toBe(true);
  });

  it("flags labels with first-person pronouns", () => {
    expect(looksLikePromptText("Choose me a contractor")).toBe(true);
    expect(looksLikePromptText("My older home rebuild")).toBe(true);
    expect(looksLikePromptText("Help me with my project")).toBe(true);
  });

  it("flags labels with question marks", () => {
    expect(looksLikePromptText("Cost of remodel?")).toBe(true);
  });

  it("flags labels longer than 50 characters", () => {
    expect(
      looksLikePromptText(
        "Custom home builders for high-end Bay Area projects",
      ),
    ).toBe(true);
  });

  it("does NOT flag short category-noun labels", () => {
    expect(looksLikePromptText("Atherton kitchen remodel")).toBe(false);
    expect(looksLikePromptText("Whole home renovation")).toBe(false);
    expect(looksLikePromptText("Los Altos")).toBe(false);
    expect(looksLikePromptText("custom home builders")).toBe(false);
  });

  it("returns false for empty / blank labels", () => {
    expect(looksLikePromptText("")).toBe(false);
    expect(looksLikePromptText("   ")).toBe(false);
  });
});

describe("buildResolvedRecommendationTitle — Create page action", () => {
  it("category-noun label → inline form: 'Create a {label} page'", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Atherton kitchen remodel",
    });
    expect(title).toBe("Create a Atherton kitchen remodel page");
  });

  // W3 Step 3.5c (2026-05-02) — operator browser re-audit failed
  // the wrapped-quote form `Create a page for "<label>"` because it
  // still exposes raw prompt copy in the title. Operator scope:
  // deterministic-cleanup-first; fall back to a scenario-class
  // heading like "this buying scenario" — never raw prompt quotes.
  it("prompt-shaped buying label → 'Create a page for this buying scenario'", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "If I buy a property with an older house",
    });
    expect(title).toBe("Create a page for this buying scenario");
    // Must NOT produce the broken grammar form OR the raw-quote form.
    expect(title).not.toMatch(/Create a If I/);
    expect(title).not.toContain('"If I buy');
  });

  it("very long category label → scenario-fallback (still no raw quote)", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel:
        "Best builders for high-end whole home remodels in the Bay Area peninsula",
    });
    expect(title.startsWith("Create a page for ")).toBe(true);
    // No raw prompt quote in the title.
    expect(title).not.toContain('"');
    // The label hints at remodeling.
    expect(title).toContain("remodeling scenario");
  });

  it("cost-question label → 'this cost question'", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "How much does a kitchen remodel cost?",
    });
    expect(title).toBe("Create a page for this cost question");
    expect(title).not.toContain('"');
  });

  it("comparison label → 'this comparison scenario'", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel:
        "For a custom home in Atherton, is it better to design-build or hire architect",
    });
    expect(title).toBe("Create a page for this comparison scenario");
  });

  it("rebuild label → 'this rebuild scenario'", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "I bought a steep lot to tear down and build new",
    });
    expect(title).toBe("Create a page for this rebuild scenario");
  });

  it("first-person-pronoun label without intent hint → generic decision fallback", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Help me find a contractor",
    });
    expect(title).toBe("Create a page for this decision scenario");
    expect(title).not.toContain('"');
  });

  it("operator audit regression — 'Create a If I…' bug stays fixed", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "If I buy a property",
    });
    expect(title).not.toMatch(/Create a If I/);
    // Buying intent → buying scenario fallback.
    expect(title).toBe("Create a page for this buying scenario");
  });

  it("LLM operatorTitle still wins over the prompt-shape detection", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "If I buy a property",
      resolution: {
        action: "create_new_page",
        motive: "capture_absent_cluster",
        targetUrl: "needs_new_page",
        confidence: "medium",
        confidenceReason: "test",
        tier: "adjudicated",
        reasoning: "test",
        cannibalization: null,
        evidenceRefs: [],
        operatorTitle: "Add a page about rebuilding older Bay Area homes",
      },
    });
    expect(title).toBe("Add a page about rebuilding older Bay Area homes");
  });
});
