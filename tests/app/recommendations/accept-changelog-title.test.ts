import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 1 (2026-04-24): Accept → changelog must use the resolved title,
 * never the raw generator title. We verify this by mocking
 * createChangelogEntry and asserting the FormData that reaches it.
 */

// Captured FormData fields across calls.
let capturedFormData: Record<string, string> | null = null;

vi.mock("@/domains/changelog/actions", () => ({
  createChangelogEntry: vi.fn(async (formData: FormData) => {
    const captured: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      captured[k] = typeof v === "string" ? v : String(v);
    }
    capturedFormData = captured;
    return { success: true, changeId: "cl-test" };
  }),
  updateChangelogHypothesis: vi.fn(async () => {}),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/domains/product/recommendation-response-store", () => ({
  recommendationResponses: [],
  recordResponse: vi.fn(),
  persistResponses: vi.fn(async () => {}),
  ensureRecommendationResponsesSeeded: vi.fn(async () => {}),
}));

// Silence the logger to keep test output clean.
vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("acceptRecommendation → changelog title", () => {
  beforeEach(() => {
    capturedFormData = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Strengthen: asset_name + hypothesis never say 'Create', never contain 'Shield:'", async () => {
    const { acceptRecommendation } = await import(
      "@/app/(shell)/recommendations/actions"
    );
    await acceptRecommendation({
      stableKey: "k1",
      type: "create_cluster_page",
      title: "Create a Shield: Luxury Home Builder Bay Area page",
      description: "desc",
      clusterLabel: "Shield: Luxury Home Builder Bay Area",
      clusterKind: "topic",
      resolution: {
        action: "strengthen_existing_page",
        motive: "improve_close_prompt",
        targetUrl: "https://ritzbuilders.com/luxury-home-builder-bay-area",
        reasoning: "AI already cites this page",
      },
    });
    expect(capturedFormData).not.toBeNull();
    const asset = capturedFormData!.asset_name;
    const hyp = capturedFormData!.hypothesis;
    expect(asset).not.toMatch(/^Create /i);
    expect(asset).not.toMatch(/Shield:/i);
    expect(asset).toMatch(/^Strengthen /);
    expect(hyp).not.toMatch(/^Create /i);
    expect(hyp).not.toMatch(/Shield:/i);
    expect(hyp).toMatch(/^Strengthen /);
    expect(capturedFormData!.url).toBe(
      "https://ritzbuilders.com/luxury-home-builder-bay-area",
    );
  });

  it("Expand: asset_name never says 'Create', URL attached", async () => {
    const { acceptRecommendation } = await import(
      "@/app/(shell)/recommendations/actions"
    );
    await acceptRecommendation({
      stableKey: "k2",
      type: "create_cluster_page",
      title: "Create a Shield: Los Altos page",
      description: "desc",
      clusterLabel: "Shield: Los Altos",
      clusterKind: "geo",
      resolution: {
        action: "expand_existing_page",
        motive: "improve_close_prompt",
        targetUrl: "https://ritzbuilders.com/locations/los-altos",
        reasoning: "Partial coverage",
      },
    });
    expect(capturedFormData!.asset_name).not.toMatch(/^Create /i);
    expect(capturedFormData!.asset_name).not.toMatch(/Shield:/i);
    expect(capturedFormData!.asset_name).toMatch(/^Expand /);
    expect(capturedFormData!.url).toBe(
      "https://ritzbuilders.com/locations/los-altos",
    );
  });

  it("Merge: asset_name never says 'Create', merges toward resolved URL", async () => {
    const { acceptRecommendation } = await import(
      "@/app/(shell)/recommendations/actions"
    );
    await acceptRecommendation({
      stableKey: "k3",
      type: "create_cluster_page",
      title: "Create a Custom Home Builder page",
      description: "desc",
      clusterLabel: "Custom Home Builder",
      clusterKind: "topic",
      resolution: {
        action: "merge_or_dedupe",
        motive: "resolve_cannibalization",
        targetUrl: "https://ritzbuilders.com/custom-home-builder-bay-area",
        reasoning: "Cannibalization",
      },
    });
    expect(capturedFormData!.asset_name).not.toMatch(/^Create /i);
    expect(capturedFormData!.asset_name).toMatch(/^Merge /);
  });

  it("Create: only appears for action=create_new_page", async () => {
    const { acceptRecommendation } = await import(
      "@/app/(shell)/recommendations/actions"
    );
    await acceptRecommendation({
      stableKey: "k4",
      type: "create_cluster_page",
      title: "Create a Shield: Truly Missing Cluster page",
      description: "desc",
      clusterLabel: "Shield: Truly Missing Cluster",
      clusterKind: "topic",
      resolution: {
        action: "create_new_page",
        motive: "capture_absent_cluster",
        targetUrl: "needs_new_page",
        reasoning: "No page covers this",
      },
    });
    expect(capturedFormData!.asset_name).toMatch(/^Create a /);
    expect(capturedFormData!.asset_name).not.toMatch(/Shield:/i);
    expect(capturedFormData!.url).toBeUndefined();
  });

  it("topic_targeted / city_targeted are sanitized too", async () => {
    const { acceptRecommendation } = await import(
      "@/app/(shell)/recommendations/actions"
    );
    await acceptRecommendation({
      stableKey: "k5",
      type: "create_cluster_page",
      title: "Create a page",
      description: "desc",
      clusterLabel: "Shield: Some Topic",
      clusterKind: "topic",
      resolution: {
        action: "strengthen_existing_page",
        motive: "improve_close_prompt",
        targetUrl: "https://ritzbuilders.com/some-page",
        reasoning: "...",
      },
    });
    expect(capturedFormData!.topic_targeted).not.toMatch(/Shield:/i);
  });
});
