/**
 * R16 (P6 LLM engine pack) - the PROMPT REGRESSION harness.
 *
 * Every production prompt is registered in src/domains/llm/prompt-registry.ts
 * with a version. This suite:
 *
 *   1. Requires a recorded fixture at fixtures/prompts/<promptId>.v<version>
 *      .json for EVERY registry entry - so bumping a prompt version without
 *      recording a new fixture fails the named test below.
 *   2. Runs each fixture through the REAL parsing/validation path (the same
 *      functions production calls: callStructuredLLM, the demand-graph
 *      drafters, the why/strategist/critic passes, the page-surgeon judge +
 *      SERP hypothesis, the specific-edit provider, the cluster factory, the
 *      engine poll client). No live LLM calls anywhere: every runner injects
 *      the recorded response.
 *
 * The page-intent adjudicator runner lives in its own hermetic file
 * (prompt-regression-adjudicator.test.ts) because it needs a chdir'd store
 * sandbox; its fixture presence is still enforced HERE.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: vi.fn(async () => ({ allowed: true, remaining: 10 })),
  recordSpend: vi.fn(async () => {}),
}));
vi.mock("@/domains/llm/winner-memory", () => ({
  buildWinnerFewShots: vi.fn(async () => ""),
  buildWinnerFewShotsWithPattern: vi.fn(async () => ({ fragment: "", patternHint: null })),
}));

import { PROMPT_REGISTRY, promptFixtureName, type PromptId } from "@/domains/llm/prompt-registry";
import { callStructuredLLM, type CompleteFn } from "@/domains/llm/structured-drafter";
import type { StructuredDraftKind } from "@/domains/llm/schemas";
import { draftAnswerBlockWithLLM, draftFaqSchemaWithLLM } from "@/domains/demand-graph/llm-answer-block";
import { composeLlmWhyThisMatters } from "@/domains/recommendations/llm-why-narrative";
import { composeExpertStrategy } from "@/domains/recommendations/llm-expert-strategist";
import type { WhyThisMattersInput } from "@/domains/recommendations/why-this-matters-narrative";
import { judgePageAtomicChange } from "@/domains/recommendation-intelligence/page-surgeon/llm-judge";
import type { EvidencePacket } from "@/domains/recommendation-intelligence/page-surgeon/contract";
import { generateSerpHypothesis } from "@/domains/recommendation-intelligence/page-surgeon/serp-hypothesis";
import { generateOpenAIBundle } from "@/domains/recommendations/providers/openai";
import { buildSpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";
import { generateClusterCards, type ClusterPlan } from "@/domains/push/cluster-factory";
import { buildOpenAiEngineClient } from "@/domains/ai-visibility/run-engine-poll";

const FIXTURE_DIR = resolve(__dirname, "fixtures", "prompts");

function fixturePath(id: PromptId): string {
  return resolve(FIXTURE_DIR, promptFixtureName(id));
}

function loadFixture(id: PromptId): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath(id), "utf-8")) as Record<string, unknown>;
}

/** A fetch that replays the fixture's recorded response envelope(s). */
function replayFetch(...envelopes: unknown[]): typeof fetch {
  let i = 0;
  return (async () =>
    new Response(JSON.stringify(envelopes[Math.min(i++, envelopes.length - 1)]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

const registryIds = Object.keys(PROMPT_REGISTRY) as PromptId[];

describe("prompt registry - version discipline", () => {
  it("EVERY (promptId, version) has a recorded fixture - bumping a version without one fails here", () => {
    const missing = registryIds.filter((id) => !existsSync(fixturePath(id)));
    expect(
      missing.map((id) => promptFixtureName(id)),
      "Add the missing fixture(s) under tests/llm-regression/fixtures/prompts/ when you bump a prompt version.",
    ).toEqual([]);
  });
});

// ── environment for the gated paths ───────────────────────────────────────────

const ENV_KEYS = ["OPENAI_API_KEY", "BEACON_LLM_PROVIDER", "BEACON_LLM_WHY", "BEACON_LLM_CRITIC", "BEACON_LLM_STRATEGIST"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of ENV_KEYS) saved.set(k, process.env[k]);
  process.env.OPENAI_API_KEY = "test-key-regression";
  process.env.BEACON_LLM_PROVIDER = "openai";
  process.env.BEACON_LLM_WHY = "1";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── structured drafter kinds (draft.*) ────────────────────────────────────────

const draftIds = registryIds.filter((id) => id.startsWith("draft."));

describe("draft.* prompts - recorded outputs pass the REAL validate + firewall path", () => {
  for (const id of draftIds) {
    it(`${id} v${PROMPT_REGISTRY[id]} drafts from its fixture`, async () => {
      const fx = loadFixture(id);
      const kind = fx.kind as StructuredDraftKind;
      const value = JSON.parse(readFileSync(resolve(__dirname, "fixtures", fx.valueFixture as string), "utf-8")) as unknown;
      const complete: CompleteFn = async () => ({ text: JSON.stringify(value) });
      const r = await callStructuredLLM({
        kind,
        system: "recorded-fixture system prompt",
        user: "recorded-fixture user prompt",
        grounded: String(fx.grounded ?? ""),
        complete,
      });
      expect(r.status, `draft.${kind}: ${JSON.stringify((r as { errors?: string[] }).errors ?? [])}`).toBe("drafted");
      if (r.status === "drafted") {
        expect(r.kind).toBe(kind);
        expect(r.retried).toBe(false); // the recorded output must pass FIRST try
      }
    });
  }
});

// ── demand-graph drafters ─────────────────────────────────────────────────────

describe("answer_block.* prompts (demand-graph drafters)", () => {
  it("answer_block.text v2 (W5: 80-150 words) - recorded answer passes gating + firewalls", async () => {
    const fx = loadFixture("answer_block.text");
    const r = await draftAnswerBlockWithLLM(
      { query: "persian wedding traditions", pageLabel: "Persian Wedding", brief: "sofreh aghd ceremony jashn reception canopy", outline: [], faqs: [] },
      { fetchImpl: replayFetch(fx.response) },
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.text).toContain("sofreh aghd");
  });

  it("answer_block.faq_schema v1 - recorded pairs become valid FAQPage JSON-LD", async () => {
    const fx = loadFixture("answer_block.faq_schema");
    const r = await draftFaqSchemaWithLLM(
      { query: "chaharshanbe suri", pageLabel: "Chaharshanbe Suri", faqs: ["What do people say when jumping over the fire?"] },
      { fetchImpl: replayFetch(fx.response) },
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.pairs).toHaveLength(1);
      expect(JSON.parse(r.jsonLd)["@type"]).toBe("FAQPage");
    }
  });
});

// ── recommendation reasoning passes ───────────────────────────────────────────

const WHY_INPUT: WhyThisMattersInput = {
  actionType: "add_faq",
  targetLabel: "Chaharshanbe Suri page",
  why: null,
  affectedPromptTexts: [],
  competitor: null,
  gscEvidenceLines: [{ key: "demand", label: "Search demand", value: "strong", detail: "the date question drives the page" }],
  clarityEvidenceLines: [],
  aeoEvidenceLines: [],
  promptCount: 0,
  observationCount: 0,
  derivedConfidence: "moderate_evidence",
};

describe("rec.* reasoning prompts", () => {
  it("rec.why_narrative v1 - recorded sentences survive the sanitize firewall", async () => {
    const fx = loadFixture("rec.why_narrative");
    const r = await composeLlmWhyThisMatters(WHY_INPUT, { fetchImpl: replayFetch(fx.response) });
    expect(r).not.toBeNull();
    expect(r!.sentences.length).toBeGreaterThanOrEqual(1);
    expect(r!.sentences.length).toBeLessThanOrEqual(3);
  });

  it("rec.strategist v1 - recorded take parses + sanitizes through composeExpertStrategy", async () => {
    process.env.BEACON_LLM_CRITIC = "0";
    const fx = loadFixture("rec.strategist");
    const r = await composeExpertStrategy(
      { why: WHY_INPUT, topicFit: null },
      { fetchImpl: replayFetch(fx.response) },
    );
    expect(r).not.toBeNull();
    expect(r!.strategist.opportunitySummary).toContain("earns attention");
    expect(r!.strategist.riskLevel).toBe("low");
  });

  it("rec.critic v1 - recorded review parses + is applied lower-only", async () => {
    delete process.env.BEACON_LLM_CRITIC; // default ON
    const strategist = loadFixture("rec.strategist");
    const critic = loadFixture("rec.critic");
    const r = await composeExpertStrategy(
      { why: WHY_INPUT, topicFit: null },
      { fetchImpl: replayFetch(strategist.response, critic.response) },
    );
    expect(r).not.toBeNull();
    expect(r!.criticReview).not.toBeNull();
    expect(r!.criticReview!.criticVerdict).toBe("lower_confidence");
    expect(r!.criticReview!.confidenceCeiling).toBe("medium");
  });

  it("rec.specific_edit_bundle v1 - recorded strict-schema bundle parses through the provider", async () => {
    const fx = loadFixture("rec.specific_edit_bundle");
    const packet = buildSpecificEditEvidencePacket({
      tenantId: "tenant-regression",
      recId: "rec-regression",
      clusterLabel: "Koobideh kabob recipe",
      clusterKind: "topic",
      affectedPromptIds: [],
      promptOpportunities: [],
      trackedPrompts: [],
      primarySummaries: [],
      ownedPageInventory: [],
      pageElementInventory: [],
      observations: [],
      singleTargetUrl: null,
      now: new Date("2026-07-03T12:00:00Z"),
    });
    const bundle = await generateOpenAIBundle(packet, { fetchImpl: replayFetch(fx.response), now: new Date("2026-07-03T12:00:00Z") });
    expect(bundle.recommendations).toHaveLength(1);
    expect(bundle.recommendations[0]!.targetElement?.proposedText).toContain("Koobideh Kabob Recipe");
    expect(bundle.totalCostUsd).toBeGreaterThan(0);
  });
});

// ── page surgeon ──────────────────────────────────────────────────────────────

function judgePacket(): EvidencePacket {
  return {
    current: {
      tenantId: "t",
      pageUrl: "https://example.com/pedar-sag",
      changeType: "title",
      elementKey: null,
      sectionLabel: null,
      currentText: "Pedar Sag Meaning",
      cmsFieldMapped: true,
      publishChannel: "wix_cms",
    },
    sourcesPresent: [],
    sourcesConnectedButEmpty: ["gsc", "clarity", "profound", "ga4", "semrush"],
  } as unknown as EvidencePacket;
}

describe("page_surgeon.* prompts", () => {
  it("page_surgeon.judge v1 - recorded verdict parses through sanitize + the deterministic gate", async () => {
    const fx = loadFixture("page_surgeon.judge");
    const decision = await judgePageAtomicChange({ packet: judgePacket(), brand: null, fetchImpl: replayFetch(fx.response) });
    expect(decision.decided_by).toBe("llm_judge");
    expect(decision.operator_insight).toContain("Bottleneck:");
  });

  it("page_surgeon.serp_hypothesis v1 - recorded hypothesis parses, stays synthetic + suspected", async () => {
    const fx = loadFixture("page_surgeon.serp_hypothesis");
    const hyp = await generateSerpHypothesis(
      {
        pagePath: "/derafsh-kaviani",
        queries: [{ query: "derafsh kaviani flag", position: 6.2, impressions: 900, ctr: 0.01 }],
      },
      { fetchImpl: replayFetch(fx.response) },
    );
    expect(hyp).not.toBeNull();
    expect(hyp!.source).toBe("synthetic");
    expect(hyp!.serpStatus).toBe("suspected");
    expect(hyp!.queries[0]!.likelyFeatures).toContain("image_pack");
    expect(hyp!.featureLikelyOwnsAnswer).toBe(true);
  });
});

// ── other production egress ───────────────────────────────────────────────────

describe("push + ai-visibility prompts", () => {
  it("push.cluster_factory v1 - recorded CMS record passes the content rules", async () => {
    const fx = loadFixture("push.cluster_factory");
    const plan: ClusterPlan = {
      name: "Persian Food",
      dataCollectionId: "Foods",
      slugField: "slug",
      urlPrefix: "/persian-food",
      siteBaseUrl: "https://www.iranopedia.com",
      fields: [
        { field: "title", instruction: "Dish name", maxWords: 8 },
        { field: "description", instruction: "What it is plus key ingredients", maxWords: 120 },
      ],
      items: [{ slug: "ghormeh-sabzi", title: "Ghormeh Sabzi", brief: "the herb stew" }],
      contentRules: ["Call the language Persian, never Farsi."],
      flaggedTerms: ["Farsi"],
    };
    const r = await generateClusterCards(plan, { apiKey: "k", fetchImpl: replayFetch(fx.response) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.drafts).toHaveLength(1);
      expect(r.rejected).toBe(0);
    }
  });

  it("ai_visibility.engine_poll_openai v1 - recorded web-search answer yields cited URLs", async () => {
    const fx = loadFixture("ai_visibility.engine_poll_openai");
    const client = buildOpenAiEngineClient({ OPENAI_API_KEY: "k" } as unknown as NodeJS.ProcessEnv, replayFetch(fx.response));
    expect(client).not.toBeNull();
    const answer = await client!("when is chaharshanbe suri");
    expect(answer).not.toBeNull();
    expect(answer!.answerText).toContain("Iranopedia");
    // Annotation URL + the same prose URL dedupe to ONE citation.
    expect(answer!.citedUrls).toEqual(["https://www.iranopedia.com/chaharshanbe-suri"]);
  });
});
