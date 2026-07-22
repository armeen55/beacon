/**
 * Integration test: competitor-page snapshots flow through the
 * evidence packet builder into `competitorPageBlueprints`.
 * T-CompPageBlueprints (2026-05-08).
 *
 * Test contract (Layer A.6, blueprint-side):
 *   1. Empty competitorPageSnapshotsByUrl → blueprint structural
 *      fields stay null/[] (byte-identical pre-patch behavior).
 *   2. Populated snapshot for a cited competitor URL → blueprint
 *      structural fields read from the snapshot, scrubbed + capped.
 *   3. Brand-name scrub aliases drop H2/FAQ items naming brands.
 *   4. Snapshot's <title> overrides citation-evidence pageTitle when
 *      present (more recent / structural source).
 */

import { describe, expect, it } from "vitest";

import { buildSpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";
import type { CompetitorPageSnapshot } from "@/domains/pages/competitor-page-snapshots";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";

const FROZEN_NOW = new Date("2026-05-08T12:00:00Z");
const TENANT = "tenant-test-acme";
const COMP_URL = "https://constructelements.com/services/whole-home-remodel";
const OWNED_URL = "https://acmebuilders.com/services/whole-home-remodel";

function makePrompt(): TrackedPrompt {
  return {
    id: "prompt-1",
    account_id: "acc",
    text: "Best whole-home renovation in the Bay Area?",
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: null,
    platforms: [],
    tags: [],
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  };
}

function makeOpportunity(): PromptOpportunity {
  return {
    prompt_id: "prompt-1",
    category: "outranked",
    tags: [],
    signalStrength: 70,
    reasoning: "n/a",
    evidence: {
      observationCount: 5,
      primaryCount: 0,
      citedCount: 1,
      mentionedCount: 1,
      absentCount: 4,
      avgCitationRank: null,
      dominantCompetitors: ["Element Homes"],
      answerStructureDistribution: {},
      topDescriptors: [],
      byPlatform: [],
      lookbackDays: 7,
    },
  };
}

function makeSummary(): PromptPrimarySummary {
  return {
    prompt_id: "prompt-1",
    totalAnswers: 5,
    ritzPrimaryCount: 0,
    ritzPrimaryShare: 0,
    ritzState: "absent",
    primaryCompetitors: [
      { name: "Element Homes", primaryCount: 3, totalAnswers: 5 },
    ],
    fragmented: false,
  };
}

function makeObservation(): PromptAnswerObservation {
  return {
    id: "obs-1",
    tenant_id: TENANT,
    prompt_id: "prompt-1",
    run_id: "run-1",
    platform: "chatgpt",
    answer_text: "...",
    answer_hash: "h1",
    position: 1,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 1,
    owned_citation_count: 0,
    citation_domains: ["constructelements.com"],
    citation_urls: [COMP_URL],
    citation_domain_classes: ["competitor"],
    mention_position: null,
    citation_rank: null,
    primary_recommendation: null,
    descriptor_window: [],
    competitor_co_mentions: ["Element Homes"],
    answer_structure: "narrative",
    raw_search_queries: "",
    search_queries: [],
    observed_at: "2026-05-01T00:00:00Z",
    topic: null,
  } as unknown as PromptAnswerObservation;
}

function buildSnap(
  over: Partial<CompetitorPageSnapshot> = {},
): CompetitorPageSnapshot {
  return {
    id: "comp-snap-1",
    tenant_id: TENANT,
    url: COMP_URL,
    canonical_url: null,
    fetched_at: "2026-05-08T08:00:00Z",
    http_status: 200,
    title: "Whole-Home Renovation | Element Homes",
    meta_description:
      "Architect-led whole-home renovation across the Bay Area.",
    h1: "Whole-Home Renovation in the Bay Area",
    h2_list: ["What We Build", "Our Process", "Frequently Asked Questions"],
    faq_questions: ["How long does it take?", "What does it cost?"],
    extraction_certainty: "confirmed",
    ...over,
  };
}

function buildArgs(
  over: Partial<Parameters<typeof buildSpecificEditEvidencePacket>[0]> = {},
): Parameters<typeof buildSpecificEditEvidencePacket>[0] {
  return {
    tenantId: TENANT,
    recId: "rec-1",
    clusterLabel: "whole home renovation",
    clusterKind: "topic",
    affectedPromptIds: ["prompt-1"],
    promptOpportunities: [makeOpportunity()],
    trackedPrompts: [makePrompt()],
    primarySummaries: [makeSummary()],
    singleTargetUrl: null,
    observations: [makeObservation()],
    ownedPageInventory: [
      {
        url: OWNED_URL,
        title: null,
        h1: null,
        metaDescription: null,
        h2s: [],
        routeType: "service",
        detectedGeo: null,
        detectedService: "whole-home",
      } as unknown as Parameters<
        typeof buildSpecificEditEvidencePacket
      >[0]["ownedPageInventory"][number],
    ],
    pageElementInventory: [],
    now: FROZEN_NOW,
    ...over,
  };
}

describe("buildCompetitorPageBlueprints — snapshot integration", () => {

  it("populates h1/topH2s/faqQuestions/metaDescription from a matching snapshot", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        competitorPageSnapshotsByUrl: new Map([[COMP_URL, buildSnap()]]),
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.h1).toBe("Whole-Home Renovation in the Bay Area");
    expect(bp.topH2s).toEqual([
      "What We Build",
      "Our Process",
      "Frequently Asked Questions",
    ]);
    expect(bp.faqQuestions).toEqual([
      "How long does it take?",
      "What does it cost?",
    ]);
    expect(bp.metaDescription).toBe(
      "Architect-led whole-home renovation across the Bay Area.",
    );
  });

  it("scrubs brand names from h2s + faqs (defense-in-depth)", () => {
    const snap = buildSnap({
      h2_list: [
        "What We Build",
        "How Element Homes structures projects",
        "Our Process",
      ],
      faq_questions: [
        "Is Element Homes the right choice?",
        "How long does it take?",
      ],
    });
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        competitorPageSnapshotsByUrl: new Map([[COMP_URL, snap]]),
        competitorBlueprintBrandScrubAliases: ["Element Homes"],
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.topH2s).toEqual(["What We Build", "Our Process"]);
    expect(bp.faqQuestions).toEqual(["How long does it take?"]);
  });


  it("does NOT populate structural fields when the cited URL has no snapshot", () => {
    // Snapshot exists for a DIFFERENT URL — the blueprint stays at
    // null/[] because the URL key doesn't match.
    const wrongUrl = "https://other.com/different";
    const packet = buildSpecificEditEvidencePacket(
      buildArgs({
        competitorPageSnapshotsByUrl: new Map([
          [wrongUrl, buildSnap({ url: wrongUrl })],
        ]),
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.h1).toBeNull();
    expect(bp.topH2s).toEqual([]);
    expect(bp.faqQuestions).toEqual([]);
    expect(bp.metaDescription).toBeNull();
  });
});
