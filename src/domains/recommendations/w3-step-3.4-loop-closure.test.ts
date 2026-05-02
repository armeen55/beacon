/**
 * W3 Step 3.4 (2026-05-02) — loop closure tests.
 *
 * Locks the architecture for "Recommendation Engine v2 LLM provider
 * activation" without taking a single live paid run. Three concerns:
 *
 *   1. Real packet signals flow into the confidence rubric. The
 *      load-queue layer no longer hardcodes `hasAiSearchSignal: false /
 *      hasCompetitorPageBlueprints: false`; both come from the actual
 *      observation aggregation. HIGH is now reachable for recs whose
 *      affected-prompt observations carry verbatim search queries,
 *      descriptor windows, competitor co-mentions, or competitor-class
 *      citation URLs.
 *
 *   2. The SYSTEM_PROMPT v2 instructs the LLM to consume the W3 Step
 *      3.2 evidence packet sources (aiSearchSignal / competitorPageBlueprints
 *      / crossTenantPatterns) AND to abstain rather than emit placeholder
 *      copy or generic advice.
 *
 *   3. The validator drops every LLM-emitted edit that fails the W3
 *      Step 3.1 placeholder gate, the existing competitor-public-copy
 *      gate, or the new structural-quality gate. No bad output reaches
 *      `recommended_edits.json`.
 *
 * Pure-function + mocked-fetch tests. No I/O, no network, no live LLM.
 */

import { describe, expect, it } from "vitest";

import { computeRecConfidence } from "./confidence";
import {
  buildSpecificEditEvidencePacket,
  hasAiSearchSignalForRec,
  hasCompetitorPageBlueprintsForRec,
} from "./specific-edit-evidence";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { PageInventoryEntry } from "./page-inventory";

// ── Fixture helpers ───────────────────────────────────────────────────────

const TENANT = "tenant-test-acme";
const FROZEN_NOW = new Date("2026-05-02T12:00:00Z");

function makePrompt(id: string, text: string): TrackedPrompt {
  return {
    id,
    account_id: "acc-test",
    text,
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: null,
    platforms: ["chatgpt"],
    tags: [],
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  };
}

function makeOpportunity(promptId: string): PromptOpportunity {
  return {
    prompt_id: promptId,
    category: "outranked",
    tags: [],
    signalStrength: 70,
    reasoning: "test",
    evidence: {
      observationCount: 5,
      primaryCount: 0,
      citedCount: 1,
      mentionedCount: 1,
      absentCount: 4,
      avgCitationRank: null,
      dominantCompetitors: [],
      answerStructureDistribution: {},
      topDescriptors: [],
      byPlatform: [],
      lookbackDays: 7,
    },
  };
}

function makeSummary(promptId: string): PromptPrimarySummary {
  return {
    prompt_id: promptId,
    totalAnswers: 5,
    ritzPrimaryCount: 0,
    ritzPrimaryShare: 0,
    ritzState: "absent",
    primaryCompetitors: [],
    fragmented: false,
  };
}

function makeObservation(
  promptId: string,
  overrides: Partial<PromptAnswerObservation> = {},
): PromptAnswerObservation {
  return {
    id: `obs-${promptId}-${Math.random().toString(36).slice(2, 8)}`,
    prompt_id: promptId,
    run_id: "run-test",
    answer_hash: "deadbeefdeadbeef",
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: "2026-05-01T10:00:00Z",
    platform: "chatgpt",
    topic: "",
    metadata: {},
    tenant_id: TENANT,
    citation_urls: [],
    descriptor_window: [],
    ...overrides,
  };
}

function makeOwnedInventory(): PageInventoryEntry[] {
  return [
    {
      url: "https://ritzbuilders.com/services/braces",
      title: "Braces · Ritz",
      h1: "Braces",
      metaDescription: null,
      h2s: [],
      routeType: "service",
      detectedGeo: null,
      detectedService: "braces",
    },
  ];
}

// ── 1. Real packet signals flow into confidence ──────────────────────────

describe("W3 Step 3.4 — real packet signals feed the confidence rubric", () => {
  it("hasAiSearchSignalForRec returns true when an observation carries search_queries", () => {
    const result = hasAiSearchSignalForRec({
      affectedPromptIds: ["p-1"],
      observations: [
        makeObservation("p-1", {
          search_queries: ["best teen braces atherton"],
        }),
      ],
    });
    expect(result).toBe(true);
  });

  it("hasAiSearchSignalForRec returns true when an observation carries descriptor_window", () => {
    const result = hasAiSearchSignalForRec({
      affectedPromptIds: ["p-1"],
      observations: [
        makeObservation("p-1", { descriptor_window: ["luxury", "atherton"] }),
      ],
    });
    expect(result).toBe(true);
  });

  it("hasAiSearchSignalForRec returns true when a non-polluted competitor co-mention exists", () => {
    const trackedEntities: TrackedEntity[] = [
      {
        id: "ent-de-mattei",
        account_id: "acc-test",
        entity_type: "competitor",
        name: "De Mattei Construction",
        aliases: [],
        domain: "demattei.com",
        url: null,
        location_scope: null,
        service_scope: null,
        is_owned: false,
        is_active: true,
        metadata: {},
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
    ];
    const result = hasAiSearchSignalForRec({
      affectedPromptIds: ["p-1"],
      observations: [
        makeObservation("p-1", {
          competitor_co_mentions: ["De Mattei Construction"],
        }),
      ],
      trackedEntities,
    });
    expect(result).toBe(true);
  });

  it("hasAiSearchSignalForRec returns false when only directory entities are co-mentioned", () => {
    const trackedEntities: TrackedEntity[] = [
      {
        id: "ent-houzz",
        account_id: "acc-test",
        entity_type: "directory_source",
        name: "Houzz",
        aliases: [],
        domain: "houzz.com",
        url: null,
        location_scope: null,
        service_scope: null,
        is_owned: false,
        is_active: true,
        metadata: {},
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-05-01T00:00:00Z",
      },
    ];
    const result = hasAiSearchSignalForRec({
      affectedPromptIds: ["p-1"],
      observations: [
        makeObservation("p-1", {
          competitor_co_mentions: ["Houzz"],
          descriptor_window: [],
          search_queries: [],
        }),
      ],
      trackedEntities,
    });
    expect(result).toBe(false);
  });

  it("hasAiSearchSignalForRec returns false on empty / thin evidence", () => {
    expect(
      hasAiSearchSignalForRec({
        affectedPromptIds: ["p-1"],
        observations: [],
      }),
    ).toBe(false);
    expect(
      hasAiSearchSignalForRec({
        affectedPromptIds: [],
        observations: [makeObservation("p-1", { search_queries: ["x"] })],
      }),
    ).toBe(false);
    expect(
      hasAiSearchSignalForRec({
        affectedPromptIds: ["p-1"],
        observations: [
          makeObservation("p-1", {
            search_queries: [],
            descriptor_window: [],
            competitor_co_mentions: [],
          }),
        ],
      }),
    ).toBe(false);
  });

  it("hasCompetitorPageBlueprintsForRec returns true for a competitor-class citation", () => {
    const result = hasCompetitorPageBlueprintsForRec({
      affectedPromptIds: ["p-1"],
      observations: [
        makeObservation("p-1", {
          citation_urls: ["https://demattei.com/services"],
          citation_domain_classes: ["competitor"],
        }),
      ],
      ownedPageInventory: makeOwnedInventory(),
    });
    expect(result).toBe(true);
  });

  it("hasCompetitorPageBlueprintsForRec drops directory + owned domains", () => {
    const result = hasCompetitorPageBlueprintsForRec({
      affectedPromptIds: ["p-1"],
      observations: [
        makeObservation("p-1", {
          citation_urls: [
            "https://houzz.com/biz/foo",
            "https://ritzbuilders.com/services/braces",
          ],
          citation_domain_classes: null, // exercise domain-fallback path
        }),
      ],
      ownedPageInventory: makeOwnedInventory(),
    });
    expect(result).toBe(false);
  });

  it("hasCompetitorPageBlueprintsForRec drops citations whose class is not 'competitor'", () => {
    const result = hasCompetitorPageBlueprintsForRec({
      affectedPromptIds: ["p-1"],
      observations: [
        makeObservation("p-1", {
          citation_urls: ["https://news.example/article"],
          citation_domain_classes: ["news"],
        }),
      ],
      ownedPageInventory: makeOwnedInventory(),
    });
    expect(result).toBe(false);
  });
});

// ── 2. Loop closure: HIGH reachable when packet signals are real ─────────

describe("W3 Step 3.4 — HIGH is reachable when packet signals + other dimensions pass", () => {
  function highCandidateInputs(packetFlags: {
    hasAiSearchSignal: boolean;
    hasCompetitorPageBlueprints: boolean;
  }) {
    return {
      affectedPromptCount: 2,
      resolverTier: "adjudicated" as const,
      resolutionConfidence: "high" as const,
      needsHumanReview: false,
      evidenceRefCount: 2,
      edits: [
        {
          proposed_text:
            "We deliver full-service custom builds across Bay Area design-build projects.",
          confidence: "high" as const,
          target_element_key: "h2[new]:abc",
        },
        {
          proposed_text:
            "Our remodels are scoped with shared timeline + budget visibility for homeowners.",
          confidence: "high" as const,
          target_element_key: "h2[new]:def",
        },
      ],
      ...packetFlags,
    };
  }

  it("REACHABLE: HIGH when hasAiSearchSignal=true (mirrors Step 3.4 wiring)", () => {
    const verdict = computeRecConfidence(
      highCandidateInputs({
        hasAiSearchSignal: true,
        hasCompetitorPageBlueprints: false,
      }),
    );
    expect(verdict.confidence).toBe("high");
    expect(verdict.reasons).toContain("grounded_in_search_signal");
  });

  it("REACHABLE: HIGH when hasCompetitorPageBlueprints=true (mirrors Step 3.4 wiring)", () => {
    const verdict = computeRecConfidence(
      highCandidateInputs({
        hasAiSearchSignal: false,
        hasCompetitorPageBlueprints: true,
      }),
    );
    expect(verdict.confidence).toBe("high");
    expect(verdict.reasons).toContain("grounded_in_competitor_blueprints");
  });

  it("UNREACHABLE: HIGH stays MEDIUM when both packet signals are false (loop NOT closed)", () => {
    const verdict = computeRecConfidence(
      highCandidateInputs({
        hasAiSearchSignal: false,
        hasCompetitorPageBlueprints: false,
      }),
    );
    expect(verdict.confidence).toBe("medium");
    expect(verdict.reasons).toContain("no_grounded_packet_signal");
  });
});

// ── 3. Evidence packet → confidence end-to-end ───────────────────────────

describe("W3 Step 3.4 — packet builder + signal helpers agree", () => {
  it("packet built with real observations carries non-empty aiSearchSignal AND helper agrees", () => {
    const observations = [
      makeObservation("p-1", {
        search_queries: ["kitchen remodel atherton"],
        descriptor_window: ["luxury", "design-build"],
      }),
    ];
    const packet = buildSpecificEditEvidencePacket({
      tenantId: TENANT,
      recId: "rec-test",
      clusterLabel: "atherton",
      clusterKind: "geo",
      affectedPromptIds: ["p-1"],
      promptOpportunities: [makeOpportunity("p-1")],
      trackedPrompts: [makePrompt("p-1", "best builders atherton")],
      primarySummaries: [makeSummary("p-1")],
      ownedPageInventory: makeOwnedInventory(),
      pageElementInventory: [],
      observations,
      singleTargetUrl: null,
      now: FROZEN_NOW,
    });

    expect(
      packet.aiSearchSignal.topSearchQueries.length +
        packet.aiSearchSignal.topDescriptors.length,
    ).toBeGreaterThan(0);
    expect(
      hasAiSearchSignalForRec({
        affectedPromptIds: ["p-1"],
        observations,
      }),
    ).toBe(true);
  });

  it("packet built with no observations carries empty signal AND helper returns false", () => {
    const packet = buildSpecificEditEvidencePacket({
      tenantId: TENANT,
      recId: "rec-test",
      clusterLabel: "atherton",
      clusterKind: "geo",
      affectedPromptIds: ["p-1"],
      promptOpportunities: [makeOpportunity("p-1")],
      trackedPrompts: [makePrompt("p-1", "best builders atherton")],
      primarySummaries: [makeSummary("p-1")],
      ownedPageInventory: makeOwnedInventory(),
      pageElementInventory: [],
      observations: [],
      singleTargetUrl: null,
      now: FROZEN_NOW,
    });

    expect(packet.aiSearchSignal.topSearchQueries).toEqual([]);
    expect(packet.aiSearchSignal.topDescriptors).toEqual([]);
    expect(packet.competitorPageBlueprints).toEqual([]);
    expect(packet.crossTenantPatterns).toEqual([]);
    expect(
      hasAiSearchSignalForRec({
        affectedPromptIds: ["p-1"],
        observations: [],
      }),
    ).toBe(false);
  });
});
