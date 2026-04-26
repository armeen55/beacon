import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

import { adjudicateFromCacheOnly } from "@/domains/recommendations/adjudicate";
import { writeCacheEntry } from "@/domains/recommendations/adjudicator-cache";
import { buildEvidencePacket } from "@/domains/recommendations/evidence-packet";
import { hashEvidencePacket } from "@/domains/recommendations/adjudicator-cache";
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
    await writeStore(s, []);
  }
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
  text: "best custom home builder in Palo Alto?",
  topic_id: null,
  location_scope: "Palo Alto",
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
  reasoning: "Absent.",
  evidence: {
    observationCount: 0,
    primaryCount: 0,
    citedCount: 0,
    mentionedCount: 0,
    absentCount: 0,
    avgCitationRank: null,
    dominantCompetitors: [],
    answerStructureDistribution: {},
    topDescriptors: [],
    byPlatform: [],
    lookbackDays: 7,
  },
};

function mkResolvedCandidate(
  stableKey: string,
): ResolvedRecommendationCandidate {
  return {
    stableKey,
    type: "create_cluster_page",
    title: "Create a Palo Alto page",
    description: "desc",
    affectedPromptIds: ["p1"],
    clusterLabel: "Palo Alto",
    clusterKind: "geo",
    severity: "high",
    effort: "medium",
    evidence: {
      promptCount: 1,
      observationCount: 0,
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
      confidenceReason: "No signal yet",
      tier: "deterministic_only",
      reasoning: "Nothing yet",
      cannibalization: null,
      evidenceRefs: [],
    },
  };
}

describe("adjudicateFromCacheOnly — never hits network", () => {
  beforeEach(async () => {
    await cleanupTestStores();
  });
  afterEach(async () => {
    await cleanupTestStores();
  });

  it("returns skipped when no cache entry exists (no API call)", async () => {
    const candidate = mkResolvedCandidate("k1");
    const args = {
      tenantId: "ritz",
      candidate,
      matrixPrompts: [MATRIX_PROMPT],
      trackedPrompts: [TRACKED_PROMPT],
      activeEntities: [RITZ],
      observations: [],
      pageInventory: [],
    };
    const result = await adjudicateFromCacheOnly(args);
    expect(result.status).toBe("skipped");
  });

  it("returns ok + cache_hit when a cache entry exists for the evidence packet", async () => {
    const candidate = mkResolvedCandidate("k2");
    const args = {
      tenantId: "ritz",
      candidate,
      matrixPrompts: [MATRIX_PROMPT],
      trackedPrompts: [TRACKED_PROMPT],
      activeEntities: [RITZ],
      observations: [],
      pageInventory: [],
    };
    const packet = buildEvidencePacket({ ...args, now: new Date() });
    const evidenceHash = hashEvidencePacket(packet);
    const cachedOutput: AdjudicatorOutput = {
      finalAction: "strengthen_existing_page",
      primaryMotive: "capture_absent_cluster",
      targetUrl: "needs_new_page",
      confidence: "medium",
      confidenceReason: "cached",
      needsHumanReview: false,
      operatorTitle: "Strengthen something",
      why: "why",
      specificRecommendation: "do x",
      suggestedEdits: [],
      pageBrief: null,
      proposedSlug: null,
      evidenceRefs: [],
      risks: [],
      mergeWithUrls: null,
      noActionReason: null,
    };
    await writeCacheEntry({
      evidenceHash,
      stableKey: candidate.stableKey,
      model: "test",
      output: cachedOutput,
      inputTokens: 100,
      outputTokens: 100,
      costUsd: 0.001,
      cachedAt: new Date().toISOString(),
    });
    const result = await adjudicateFromCacheOnly(args);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.source).toBe("cache_hit");
    expect(result.costUsd).toBe(0);
    expect(result.output.finalAction).toBe("strengthen_existing_page");
  });

  it("still succeeds when OPENAI_API_KEY is missing (cache-only path doesn't touch it)", async () => {
    const prev = process.env.OPENAI_API_KEY;
    try {
      delete process.env.OPENAI_API_KEY;
      const candidate = mkResolvedCandidate("k3");
      const result = await adjudicateFromCacheOnly({
        tenantId: "ritz",
        candidate,
        matrixPrompts: [MATRIX_PROMPT],
        trackedPrompts: [TRACKED_PROMPT],
        activeEntities: [RITZ],
        observations: [],
        pageInventory: [],
      });
      expect(result.status).toBe("skipped");
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});
