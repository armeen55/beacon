/**
 * R16 (P6 LLM engine pack) - prompt regression for rec.page_intent_adjudicator.
 *
 * Separate from the main harness because adjudicateRecommendation writes the
 * adjudicator-cache / adjudicator-history / llm-budget global stores: this file
 * mirrors the hermetic mkdtemp + chdir pattern of adjudicate.test.ts so no test
 * run ever touches the operator's real `.data/` (pinned by
 * tests/architecture/llm-budget-test-isolation.test.ts). The recorded fixture
 * runs through the REAL packet-build -> gateway -> strict-JSON parse path; no
 * live LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { adjudicateRecommendation } from "@/domains/recommendations/adjudicate";
import type { ResolvedRecommendationCandidate } from "@/domains/recommendations/resolved-types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import { PROMPT_REGISTRY, promptFixtureName } from "@/domains/llm/prompt-registry";

const FIXTURE = path.resolve(__dirname, "fixtures", "prompts", promptFixtureName("rec.page_intent_adjudicator"));

const ORIGINAL_CWD = process.cwd();
let workdir: string;
const originalKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "beacon-llm-regression-adj-"));
  process.chdir(workdir);
  process.env.OPENAI_API_KEY = "test-key-regression";
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.env.OPENAI_API_KEY = originalKey;
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function candidate(): ResolvedRecommendationCandidate {
  return {
    stableKey: "regression-k1",
    type: "create_cluster_page",
    title: "rec regression-k1",
    description: "desc",
    affectedPromptIds: ["p1"],
    clusterLabel: "Los Altos",
    clusterKind: "geo",
    severity: "high",
    effort: "medium",
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
    },
    resolution: {
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

const ENTITY: TrackedEntity = {
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

const PROMPT: TrackedPrompt = {
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

const MATRIX: PromptOpportunity = {
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

describe("rec.page_intent_adjudicator v1 - recorded output parses through the real adjudication path", () => {
  it(`fixture ${promptFixtureName("rec.page_intent_adjudicator")} yields a live_call ok result`, async () => {
    expect(PROMPT_REGISTRY["rec.page_intent_adjudicator"]).toBe(1);
    const fx = JSON.parse(readFileSync(FIXTURE, "utf-8")) as { response: unknown };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(fx.response), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

    const result = await adjudicateRecommendation({
      tenantId: "ritz",
      candidate: candidate(),
      matrixPrompts: [MATRIX],
      trackedPrompts: [PROMPT],
      activeEntities: [ENTITY],
      observations: [],
      pageInventory: [],
      fetchImpl,
      now: new Date("2026-07-03T10:00:00Z"),
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.source).toBe("live_call");
    expect(result.output.finalAction).toBe("strengthen_existing_page");
    expect(result.output.operatorTitle).toBe("Strengthen Los Altos page");
    expect(result.costUsd).toBeGreaterThan(0);
  });
});
