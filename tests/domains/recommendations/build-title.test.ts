import { describe, it, expect } from "vitest";
import { buildResolvedRecommendationTitle } from "@/domains/recommendations/build-title";
import type { PageIntentResolution } from "@/domains/recommendations/resolved-types";

/**
 * Phase 1 (2026-04-24) — regression contract for the shared title builder.
 *
 * Rules pinned here:
 *   1. Strengthen/Expand/Merge/Add section rows never render a title that
 *      starts with "Create" or the raw generator-style "Create a X page".
 *   2. Internal taxonomy tokens ("Shield:", "Internal:") never surface in
 *      any title, from any input path.
 *   3. Raw generator titles are never used as-is — even when passed as
 *      promptTextFallback, they get sanitized and reframed by the action.
 */

function resolutionWith(
  overrides: Partial<PageIntentResolution> & { action: PageIntentResolution["action"] },
): PageIntentResolution {
  return {
    action: overrides.action,
    motive: overrides.motive ?? "improve_close_prompt",
    targetUrl: overrides.targetUrl ?? "needs_new_page",
    confidence: overrides.confidence ?? "medium",
    confidenceReason: overrides.confidenceReason ?? "",
    tier: overrides.tier ?? "observation",
    reasoning: overrides.reasoning ?? "",
    cannibalization: overrides.cannibalization ?? null,
    evidenceRefs: overrides.evidenceRefs ?? [],
    operatorTitle: overrides.operatorTitle,
    specificRecommendation: overrides.specificRecommendation,
    suggestedEdits: overrides.suggestedEdits,
    pageBrief: overrides.pageBrief,
    proposedSlug: overrides.proposedSlug,
    risks: overrides.risks,
    needsHumanReview: overrides.needsHumanReview,
  };
}

describe("buildResolvedRecommendationTitle — action consistency", () => {
  it("Strengthen row never says Create, uses resolved URL path", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Palo Alto",
      resolution: resolutionWith({
        action: "strengthen_existing_page",
        targetUrl: "https://ritzbuilders.com/locations/palo-alto",
      }),
    });
    expect(title).not.toMatch(/^Create /i);
    expect(title).toMatch(/^Strengthen /);
    expect(title).toContain("/locations/palo-alto");
  });

  it("Expand row never says Create, uses resolved URL path", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Luxury Home Builder Bay Area",
      resolution: resolutionWith({
        action: "expand_existing_page",
        targetUrl: "https://ritzbuilders.com/luxury-home-builder-bay-area",
      }),
    });
    expect(title).not.toMatch(/^Create /i);
    expect(title).toMatch(/^Expand /);
  });

  it("Merge row never says Create, uses resolved URL path", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Custom Home Builder Bay Area",
      resolution: resolutionWith({
        action: "merge_or_dedupe",
        targetUrl: "https://ritzbuilders.com/custom-home-builder-bay-area",
      }),
    });
    expect(title).not.toMatch(/^Create /i);
    expect(title).toMatch(/^Merge /);
  });

  it("Add section row never says Create, references URL path", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Los Altos",
      resolution: resolutionWith({
        action: "add_section_or_faq",
        targetUrl: "https://ritzbuilders.com/locations/los-altos",
      }),
    });
    expect(title).not.toMatch(/^Create /i);
    expect(title).toMatch(/^Add section /);
  });

  it("Review row never says Create", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Whole Home Renovation Builders (Bay Area)",
      resolution: resolutionWith({ action: "needs_review" }),
    });
    expect(title).not.toMatch(/^Create /i);
    expect(title).toMatch(/^Review /);
  });

  it("Watch row never says Create", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Teardown / Rebuild",
      resolution: resolutionWith({ action: "watch" }),
    });
    expect(title).not.toMatch(/^Create /i);
    expect(title).toMatch(/^Watch /);
  });

  it("Create row only appears when action is create_new_page", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Brand New Absent Cluster",
      resolution: resolutionWith({
        action: "create_new_page",
        targetUrl: "needs_new_page",
      }),
    });
    expect(title).toMatch(/^Create a /);
  });
});

describe("buildResolvedRecommendationTitle — taxonomy sanitization", () => {
  it("strips Shield: prefix from clusterLabel", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Shield: Luxury Home Builder Bay Area",
      resolution: resolutionWith({
        action: "strengthen_existing_page",
        targetUrl: "https://ritzbuilders.com/luxury-home-builder-bay-area",
      }),
    });
    expect(title).not.toMatch(/Shield:/i);
    expect(title).toContain("Luxury Home Builder Bay Area");
  });

  it("strips Internal: prefix from clusterLabel", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Internal: Experimental Cluster",
      resolution: resolutionWith({ action: "create_new_page" }),
    });
    expect(title).not.toMatch(/Internal:/i);
    expect(title).toContain("Experimental Cluster");
  });

  it("strips stacked prefixes", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Shield: Internal: Something",
      resolution: resolutionWith({ action: "create_new_page" }),
    });
    expect(title).not.toMatch(/Shield:|Internal:/i);
    expect(title).toContain("Something");
  });

  it("sanitizes promptTextFallback too (when clusterLabel is null)", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: null,
      promptTextFallback: "Shield: some prompt text",
      resolution: resolutionWith({ action: "create_new_page" }),
    });
    expect(title).not.toMatch(/Shield:/i);
  });

  it("sanitizes adjudicator operatorTitle too (defense in depth)", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Palo Alto",
      resolution: resolutionWith({
        action: "strengthen_existing_page",
        targetUrl: "https://ritzbuilders.com/locations/palo-alto",
        operatorTitle: "Shield: buggy adjudicator output",
      }),
    });
    expect(title).not.toMatch(/Shield:/i);
  });
});

describe("buildResolvedRecommendationTitle — no raw generator title leak", () => {
  it("does NOT pass through 'Create a Shield: X page' when resolver override would apply", () => {
    const raw = "Create a Shield: Luxury Home Builder Bay Area page";
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Luxury Home Builder Bay Area",
      promptTextFallback: raw,
      resolution: resolutionWith({
        action: "strengthen_existing_page",
        targetUrl: "https://ritzbuilders.com/luxury-home-builder-bay-area",
      }),
    });
    expect(title).not.toBe(raw);
    expect(title).not.toMatch(/Shield:/i);
    expect(title).toMatch(/^Strengthen /);
  });

  it("handles missing resolution with safe default", () => {
    const title = buildResolvedRecommendationTitle({
      clusterLabel: "Palo Alto",
      resolution: undefined,
    });
    expect(title).toBe("Create a Palo Alto page");
    expect(title).not.toMatch(/Shield:/i);
  });

  it("extremely long labels never produce overflowing titles (W3 Step 3.5c — scenario fallback)", () => {
    // W3 Step 3.5c (2026-05-02) — operator browser audit failed
    // the prior "truncate label + ellipsis" behavior because raw
    // prompt-quote chunks still leaked into titles. The new
    // contract: any label > 50 chars triggers prompt-shape detection
    // and falls back to a scenario-class phrase (no ellipsis
    // needed; the phrase is intentionally short and operator-
    // readable).
    const longLabel = "A".repeat(200);
    const title = buildResolvedRecommendationTitle({
      clusterLabel: longLabel,
      resolution: resolutionWith({ action: "create_new_page" }),
    });
    expect(title.length).toBeLessThan(longLabel.length + 20);
    // Scenario-class fallback ships; raw long-label fragments do not.
    expect(title).toContain("Create a page for");
    expect(title).not.toContain("AAAAAA");
  });
});
