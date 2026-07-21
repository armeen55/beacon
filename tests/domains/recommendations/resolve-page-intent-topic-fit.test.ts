/**
 * Expert-rec-engine GQA-4 (2026-06-16) — generation-time page/query intent fit
 * attached by resolvePageIntent against the FULL page snapshot.
 *
 * Pins the operator's acceptance behavior:
 *   • a legitimate related cluster→page match is preserved (shouldUse true);
 *   • an observation-led pick to a topically-UNRELATED page is flagged
 *     (shouldUse false) — generically, before ranking;
 *   • a new-page target (no inventory snapshot) → topicFit null (the row
 *     builder then falls back to its row-evidence proxy);
 *   • brand/locale terms come from the args (config), not baked.
 */

import { describe, it, expect } from "vitest";

import {
  resolvePageIntent,
  canonicalizeUrl,
} from "@/domains/recommendations/resolve-page-intent";
import type { PageInventoryEntry } from "@/domains/recommendations/page-inventory";
import type { RecommendationCandidate } from "@/domains/recommendations/recommendation-types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

const RITZ: TrackedEntity = {
  id: "e-r",
  name: "Site",
  account_id: "t",
  entity_type: "brand",
  domain: "example.com",
  url: null,
  aliases: [],
  location_scope: null,
  service_scope: null,
  is_owned: true,
  is_active: true,
  metadata: {},
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

function mkCandidate(o: Partial<RecommendationCandidate> & { stableKey: string }): RecommendationCandidate {
  return {
    stableKey: o.stableKey,
    type: o.type ?? "create_cluster_page",
    title: o.title ?? "rec",
    description: "desc",
    affectedPromptIds: o.affectedPromptIds ?? ["p1"],
    clusterLabel: o.clusterLabel ?? null,
    clusterKind: o.clusterKind ?? "topic",
    severity: o.severity ?? "high",
    effort: o.effort ?? "medium",
    evidence: {
      promptCount: 1,
      observationCount: 3,
      categoryBreakdown: {},
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 60,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    } as unknown as RecommendationCandidate["evidence"],
  };
}

function mkInv(o: Partial<PageInventoryEntry> & { url: string }): PageInventoryEntry {
  return {
    url: o.url,
    title: o.title ?? null,
    h1: o.h1 ?? null,
    metaDescription: o.metaDescription ?? null,
    h2s: o.h2s ?? [],
    routeType: o.routeType ?? "other",
    detectedGeo: o.detectedGeo ?? null,
    detectedService: o.detectedService ?? null,
  };
}

function mkObs(promptId: string, citationUrl: string): PromptAnswerObservation {
  return {
    id: `o-${citationUrl}`,
    run_id: "r",
    prompt_id: promptId,
    observed_at: "2026-06-01T00:00:00Z",
    citation_urls: [citationUrl],
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 1,
    owned_citation_count: 1,
    citation_domains: ["example.com"],
    citation_categories: {},
    mentions: [],
    platform: "perplexity",
    topic: "",
    metadata: {},
    tenant_id: "t",
  } as PromptAnswerObservation;
}

describe("resolvePageIntent — generation-time topicFit", () => {
  it("preserves a legitimate related cluster→page match (shouldUse true)", () => {
    const url = canonicalizeUrl("https://example.com/persian-rug-cleaning")!;
    const [resolved] = resolvePageIntent({
      candidates: [mkCandidate({ stableKey: "c1", clusterLabel: "Persian Rug Cleaning" })],
      observations: [],
      activeEntities: [RITZ],
      pageInventory: [
        mkInv({
          url,
          title: "Persian Rug Cleaning Guide",
          h1: "Persian Rug Cleaning",
          metaDescription: "How to clean a persian rug.",
          h2s: ["Hand washing", "Drying a persian rug"],
        }),
      ],
    });
    expect(resolved.resolution.topicFit).not.toBeNull();
    expect(resolved.resolution.topicFit!.shouldUseQueryForOptimization).toBe(true);
  });

  it("flags an observation-led pick to a topically UNRELATED page (shouldUse false)", () => {
    const cheetahUrl = canonicalizeUrl("https://example.com/wildlife/asiatic-cheetah")!;
    const [resolved] = resolvePageIntent({
      // AI cited the cheetah page for a rug-cleaning cluster — wrong page.
      candidates: [
        mkCandidate({
          stableKey: "c2",
          clusterLabel: "Persian Rug Cleaning",
          affectedPromptIds: ["p1", "p2", "p3"],
        }),
      ],
      observations: [
        mkObs("p1", "https://example.com/wildlife/asiatic-cheetah"),
        mkObs("p2", "https://example.com/wildlife/asiatic-cheetah"),
        mkObs("p3", "https://example.com/wildlife/asiatic-cheetah"),
      ],
      activeEntities: [RITZ],
      pageInventory: [
        mkInv({
          url: cheetahUrl,
          title: "Asiatic Cheetah Conservation in Iran",
          h1: "Saving the Asiatic Cheetah",
          metaDescription: "The last asiatic cheetahs.",
          h2s: ["Habitat", "Population"],
        }),
      ],
    });
    // It resolved to the cheetah page (observation-led), but the generation
    // fit catches that the rug-cleaning cluster doesn't fit that page.
    expect(resolved.resolution.targetUrl).toBe(cheetahUrl);
    expect(resolved.resolution.topicFit).not.toBeNull();
    expect(resolved.resolution.topicFit!.shouldUseQueryForOptimization).toBe(false);
  });

  it("a new-page target (no inventory snapshot) → topicFit null", () => {
    const [resolved] = resolvePageIntent({
      candidates: [mkCandidate({ stableKey: "c3", clusterLabel: "Totally New Topic Cluster" })],
      observations: [],
      activeEntities: [RITZ],
      pageInventory: [],
    });
    expect(resolved.resolution.topicFit ?? null).toBeNull();
  });
});
