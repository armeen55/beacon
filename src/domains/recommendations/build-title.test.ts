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

  it("prompt-shaped label → wrapped form: 'Create a page for \"{label}\"'", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "If I buy a property with an older house",
    });
    expect(title).toBe(
      'Create a page for "If I buy a property with an older house"',
    );
    // Must NOT produce the broken grammar form.
    expect(title).not.toBe(
      "Create a If I buy a property with an older house page",
    );
  });

  it("very long category label → truncated AND wrapped", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel:
        "Best builders for high-end whole home remodels in the Bay Area peninsula",
    });
    // 73 chars; truncated at 67 + "…"; treated as prompt-shaped.
    expect(title.startsWith('Create a page for "')).toBe(true);
    expect(title).toContain("…");
  });

  it("question-shaped label → wrapped form", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "How much does a kitchen remodel cost?",
    });
    expect(title.startsWith('Create a page for "')).toBe(true);
    expect(title.endsWith('"')).toBe(true);
  });

  it("first-person-pronoun label → wrapped form", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Help me find a contractor",
    });
    expect(title).toBe('Create a page for "Help me find a contractor"');
  });

  it("operator audit regression — 'Create a If I…' bug fixed", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "If I buy a property",
    });
    expect(title).not.toMatch(/Create a If I/);
    expect(title).toMatch(/Create a page for "If I buy a property"/);
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
