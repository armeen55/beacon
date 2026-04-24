import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  adjudicateRecommendation,
  shouldAdjudicate,
  applyAdjudicationToResolution,
} from "@/domains/recommendations/adjudicate";
import { buildAdjudicatorJsonSchema } from "@/domains/recommendations/adjudicator-schema";
import type { AdjudicatorOutput } from "@/domains/recommendations/adjudicator-schema";
import type { ResolvedRecommendationCandidate } from "@/domains/recommendations/resolved-types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import { writeStore } from "@/lib/persistence/json-store";

const DATA_DIR = path.resolve(process.cwd(), ".data");

async function cleanupTestStores() {
  const stores = [
    "adjudicator-cache",
    "adjudicator-history",
    "llm-budget",
  ];
  for (const s of stores) {
    try {
      await fs.unlink(path.join(DATA_DIR, `${s}.json`));
    } catch {
      /* ignore */
    }
    // json-store caches the file contents in-process; writing empty array
    // clears both the cached array and the on-disk file so the next test
    // starts from a clean readStore.
    await writeStore(s, []);
  }
}

function mkResolvedCandidate(
  overrides: Partial<ResolvedRecommendationCandidate> & { stableKey: string },
): ResolvedRecommendationCandidate {
  return {
    stableKey: overrides.stableKey,
    type: overrides.type ?? "create_cluster_page",
    title: overrides.title ?? `rec ${overrides.stableKey}`,
    description: overrides.description ?? "desc",
    affectedPromptIds: overrides.affectedPromptIds ?? ["p1"],
    clusterLabel: overrides.clusterLabel ?? "Los Altos",
    clusterKind: overrides.clusterKind ?? "geo",
    severity: overrides.severity ?? "high",
    effort: overrides.effort ?? "medium",
    evidence: {
      promptCount: 1,
      observationCount: 3,
      categoryBreakdown: { absent: 1 },
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 50,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
      ...overrides.evidence,
    },
    resolution: overrides.resolution ?? {
      action: "create_new_page",
      motive: "capture_absent_cluster",
      targetUrl: "needs_new_page",
      confidence: "low",
      confidenceReason: "no signal",
      tier: "deterministic_only",
      reasoning: "No data yet",
      cannibalization: null,
      evidenceRefs: [],
    },
  };
}

const RITZ: TrackedEntity = {
  id: "e-r",
  account_id: "ritz",
  entity_type: "brand",
  name: "Ritz Builders",
  aliases: [],
  domain: "ritzbuilders.com",
  url: null,
  location_scope: null,
  service_scope: null,
  is_owned: true,
  is_active: true,
  metadata: {},
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

const TRACKED_PROMPT: TrackedPrompt = {
  id: "p1",
  account_id: "ritz",
  text: "best custom home builder in Los Altos?",
  topic_id: null,
  location_scope: "Los Altos",
  service_scope: null,
  intent_type: "recommendation",
  platforms: ["perplexity"],
  tags: [],
  is_active: true,
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

const MATRIX_PROMPT: PromptOpportunity = {
  prompt_id: "p1",
  category: "absent",
  tags: [],
  signalStrength: 50,
  reasoning: "Ritz absent across observations.",
  evidence: {
    observationCount: 3,
    primaryCount: 0,
    citedCount: 0,
    mentionedCount: 0,
    absentCount: 3,
    avgCitationRank: null,
    dominantCompetitors: [],
    answerStructureDistribution: {},
    topDescriptors: [],
    byPlatform: [],
    lookbackDays: 7,
  },
};

const SAMPLE_OUTPUT: AdjudicatorOutput = {
  finalAction: "strengthen_existing_page",
  primaryMotive: "capture_absent_cluster",
  targetUrl: "needs_new_page",
  confidence: "medium",
  confidenceReason: "Packet shows strong URL match",
  needsHumanReview: false,
  operatorTitle: "Strengthen Los Altos page",
  why: "AI already favors this page area",
  specificRecommendation: "Add Los Altos-specific content",
  suggestedEdits: [
    {
      type: "section",
      scope: "body",
      title: "Why Los Altos",
      body: "…",
      why: "prompts ask about Los Altos specifically",
    },
  ],
  pageBrief: null,
  proposedSlug: null,
  evidenceRefs: [{ type: "prompt", id: "p1" }],
  risks: [],
  mergeWithUrls: null,
  noActionReason: null,
};

function mockOpenAIFetch(output: AdjudicatorOutput): typeof fetch {
  return (async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(output), refusal: null },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 2000, completion_tokens: 500 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("adjudicateRecommendation", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  beforeEach(async () => {
    process.env.OPENAI_API_KEY = "test-key";
    await cleanupTestStores();
  });
  afterEach(async () => {
    process.env.OPENAI_API_KEY = originalKey;
    await cleanupTestStores();
  });

  it("calls the model, parses strict JSON, caches output, records spend", async () => {
    const candidate = mkResolvedCandidate({ stableKey: "k1" });
    const result = await adjudicateRecommendation({
      customerId: "ritz",
      candidate,
      matrixPrompts: [MATRIX_PROMPT],
      trackedPrompts: [TRACKED_PROMPT],
      activeEntities: [RITZ],
      observations: [],
      pageInventory: [],
      fetchImpl: mockOpenAIFetch(SAMPLE_OUTPUT),
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.source).toBe("live_call");
    expect(result.output.finalAction).toBe("strengthen_existing_page");
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("returns cached output on repeated call with same packet (no network)", async () => {
    const candidate = mkResolvedCandidate({ stableKey: "k2" });
    const args = {
      customerId: "ritz",
      candidate,
      matrixPrompts: [MATRIX_PROMPT],
      trackedPrompts: [TRACKED_PROMPT],
      activeEntities: [RITZ],
      observations: [],
      pageInventory: [],
    };
    const liveFetch = mockOpenAIFetch(SAMPLE_OUTPUT);
    await adjudicateRecommendation({
      ...args,
      fetchImpl: liveFetch,
      now: new Date("2026-04-23T10:00:00Z"),
    });
    const spy = vi.fn(liveFetch);
    const result2 = await adjudicateRecommendation({
      ...args,
      fetchImpl: spy as unknown as typeof fetch,
      now: new Date("2026-04-23T10:01:00Z"),
    });
    expect(result2.status).toBe("ok");
    if (result2.status !== "ok") return;
    expect(result2.source).toBe("cache_hit");
    expect(result2.costUsd).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns skipped when budget is exceeded", async () => {
    process.env.BEACON_ADJUDICATOR_FORCE_BUDGET = "0";
    const { setBudgetCap, recordSpend } = await import(
      "@/domains/recommendations/adjudicator-budget"
    );
    await setBudgetCap(0.001);
    await recordSpend(0.002);

    const candidate = mkResolvedCandidate({ stableKey: "k3" });
    const result = await adjudicateRecommendation({
      customerId: "ritz",
      candidate,
      matrixPrompts: [MATRIX_PROMPT],
      trackedPrompts: [TRACKED_PROMPT],
      activeEntities: [RITZ],
      observations: [],
      pageInventory: [],
      fetchImpl: mockOpenAIFetch(SAMPLE_OUTPUT),
    });
    expect(result.status).toBe("skipped");
  });

  it("returns error when OpenAI returns a non-200", async () => {
    const failingFetch: typeof fetch = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const candidate = mkResolvedCandidate({ stableKey: "k4" });
    const result = await adjudicateRecommendation({
      customerId: "ritz",
      candidate,
      matrixPrompts: [MATRIX_PROMPT],
      trackedPrompts: [TRACKED_PROMPT],
      activeEntities: [RITZ],
      observations: [],
      pageInventory: [],
      fetchImpl: failingFetch,
    });
    expect(result.status).toBe("error");
  });

  it("returns error on refusal from the model", async () => {
    const refusingFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: null, refusal: "I can't help with that." },
              finish_reason: "content_filter",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;
    const candidate = mkResolvedCandidate({ stableKey: "k5" });
    const result = await adjudicateRecommendation({
      customerId: "ritz",
      candidate,
      matrixPrompts: [MATRIX_PROMPT],
      trackedPrompts: [TRACKED_PROMPT],
      activeEntities: [RITZ],
      observations: [],
      pageInventory: [],
      fetchImpl: refusingFetch,
    });
    expect(result.status).toBe("error");
  });
});

describe("buildAdjudicatorJsonSchema", () => {
  it("enum-constrains targetUrl to the allowedTargetUrls list", () => {
    const schema = buildAdjudicatorJsonSchema({
      allowedTargetUrls: [
        "needs_new_page",
        "https://ritzbuilders.com/locations/los-altos",
      ],
    });
    const props = (schema as Record<string, unknown>).properties as Record<
      string,
      Record<string, unknown>
    >;
    expect((props.targetUrl.enum as string[])).toEqual([
      "needs_new_page",
      "https://ritzbuilders.com/locations/los-altos",
    ]);
    expect(props.finalAction.enum).toContain("strengthen_existing_page");
    expect(props.primaryMotive.enum).toContain("counter_competitor");
  });

  it("marks additionalProperties=false on the top-level object", () => {
    const schema = buildAdjudicatorJsonSchema({ allowedTargetUrls: [] });
    expect((schema as Record<string, unknown>).additionalProperties).toBe(false);
  });
});

describe("shouldAdjudicate", () => {
  function resolutionWith(fields: Partial<ResolvedRecommendationCandidate["resolution"]>) {
    return mkResolvedCandidate({
      stableKey: "x",
      resolution: {
        action: "strengthen_existing_page",
        motive: "improve_close_prompt",
        targetUrl: "https://ritzbuilders.com/x",
        confidence: "high",
        confidenceReason: "",
        tier: "observation",
        reasoning: "",
        cannibalization: null,
        evidenceRefs: [],
        ...fields,
      },
    });
  }

  it("fires on needs_review", () => {
    expect(
      shouldAdjudicate(resolutionWith({ action: "needs_review" }), {
        alreadyFiredCount: 0,
        maxPerRequest: 5,
      }).fire,
    ).toBe(true);
  });

  it("fires on merge_or_dedupe", () => {
    expect(
      shouldAdjudicate(resolutionWith({ action: "merge_or_dedupe" }), {
        alreadyFiredCount: 0,
        maxPerRequest: 5,
      }).fire,
    ).toBe(true);
  });

  it("fires on low confidence (non-watch)", () => {
    expect(
      shouldAdjudicate(resolutionWith({ confidence: "low" }), {
        alreadyFiredCount: 0,
        maxPerRequest: 5,
      }).fire,
    ).toBe(true);
  });

  it("fires on create_new_page with inventory tier (partial match rescued)", () => {
    expect(
      shouldAdjudicate(
        resolutionWith({
          action: "create_new_page",
          tier: "inventory",
          confidence: "medium",
          targetUrl: "needs_new_page",
        }),
        { alreadyFiredCount: 0, maxPerRequest: 5 },
      ).fire,
    ).toBe(true);
  });

  it("fires when Accept would create a URL-less changelog entry", () => {
    expect(
      shouldAdjudicate(
        resolutionWith({
          action: "create_new_page",
          tier: "observation",
          confidence: "medium",
          targetUrl: "needs_new_page",
        }),
        { alreadyFiredCount: 0, maxPerRequest: 5 },
      ).fire,
    ).toBe(true);
  });

  it("does not fire on a high-confidence observation strengthen with resolved URL", () => {
    expect(
      shouldAdjudicate(
        resolutionWith({
          action: "strengthen_existing_page",
          tier: "observation",
          confidence: "high",
          targetUrl: "https://ritzbuilders.com/locations/palo-alto",
        }),
        { alreadyFiredCount: 0, maxPerRequest: 5 },
      ).fire,
    ).toBe(false);
  });

  it("does not fire once the max per-request quota is reached", () => {
    expect(
      shouldAdjudicate(resolutionWith({ action: "needs_review" }), {
        alreadyFiredCount: 5,
        maxPerRequest: 5,
      }).fire,
    ).toBe(false);
  });
});

describe("applyAdjudicationToResolution", () => {
  it("upgrades resolution to adjudicated tier and swaps in LLM output fields", () => {
    const candidate = mkResolvedCandidate({ stableKey: "k1" });
    const applied = applyAdjudicationToResolution(candidate, SAMPLE_OUTPUT);
    expect(applied.resolution.tier).toBe("adjudicated");
    expect(applied.resolution.action).toBe(SAMPLE_OUTPUT.finalAction);
    expect(applied.resolution.motive).toBe(SAMPLE_OUTPUT.primaryMotive);
    expect(applied.resolution.targetUrl).toBe(SAMPLE_OUTPUT.targetUrl);
    expect(applied.resolution.reasoning).toBe(SAMPLE_OUTPUT.why);
  });
});
