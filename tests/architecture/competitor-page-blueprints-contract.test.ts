/**
 * Architecture / contract test —
 * `competitorPageBlueprints` populated-fields contract.
 *
 * Locks in T-CompPageBlueprints (2026-05-08). Pre-patch the producer
 * at `specific-edit-evidence.ts:buildCompetitorPageBlueprints`
 * hardcoded `h1: null, topH2s: [], faqQuestions: [], metaDescription:
 * null` regardless of any snapshot input — the field shape was
 * "future-proof," the producer was a stub.
 *
 * The patch threaded `competitorPageSnapshotsByUrl` through the
 * packet builder + load-queue so blueprints get real h1/topH2s/
 * faqQuestions/metaDescription when a captured snapshot exists.
 *
 * This test PERMANENTLY locks four invariants that any future
 * refactor must preserve. If you find yourself wanting to break one,
 * write a follow-up audit-correction doc first; do not silently
 * delete the test.
 *
 * Invariants (fail-loud if violated):
 *   1. POPULATED PATH — when the snapshot map has a matching url, the
 *      blueprint emits populated h1 + non-empty topH2s + populated
 *      metaDescription (faqQuestions empty is fine — many real pages
 *      have no FAQs).
 *   2. FALLBACK — empty snapshot map preserves byte-identical null/[]
 *      behavior (so tenants that haven't run the scanner aren't
 *      affected by this code path).
 *   3. CAPS — topH2s ≤ 5, faqQuestions ≤ 5, metaDescription ≤ 200
 *      chars are operator-locked maxima. The producer must apply them
 *      regardless of snapshot size.
 *   4. SCRUB — H2/FAQ items containing operator brand OR any tracked
 *      competitor name are dropped before reaching the packet
 *      (defense-in-depth on top of the OUTPUT validators that catch
 *      generated-copy leaks).
 *
 * Plus a structural / type-level safety check:
 *   5. NO ANSWER/BODY/PARAGRAPH FIELDS — `CompetitorPageSnapshot`
 *      cannot carry FAQ answers, body paragraphs, or full content.
 *      The persisted shape literally has no place to put them, by
 *      design.
 *
 * And a separation-of-concerns lock:
 *   6. EVIDENCE-NOT-PUBLIC-COPY — competitor structure may flow IN as
 *      packet evidence, but the OUTPUT validator
 *      (`validateCompetitorPublicCopy`) still REJECTS any generated
 *      rec_edit text that contains a competitor name. The two paths
 *      are disjoint; this test exercises both ends.
 *
 * Synthetic fixtures only. Never reads the real
 * `competitor-page-snapshots.json` on disk — the contract should not
 * silently break if a future fetch produces unexpected content.
 */

import { describe, expect, it } from "vitest";

import { buildSpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";
import { validateSpecificEdit } from "@/domains/recommendations/specific-edit-validator";
import {
  COMPETITOR_BLUEPRINT_MAX_TOP_H2S,
  COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS,
  COMPETITOR_BLUEPRINT_META_MAX_CHARS,
  type CompetitorPageSnapshot,
} from "@/domains/pages/competitor-page-snapshots";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { SpecificEdit } from "@/domains/recommendations/specific-edit-provider";

const FROZEN_NOW = new Date("2026-05-08T12:00:00Z");
const TENANT = "tenant-test-acme";
const COMP_URL = "https://competitor.example/services/whole-home";
const OWNED_URL = "https://acmebuilders.example/services/whole-home";
const COMPETITOR_NAME = "Sample Competitor Inc";
const OPERATOR_BRAND = "Acme Builders";

// ─── Synthetic fixture helpers ───────────────────────────────────────────

function buildSnapshot(
  over: Partial<CompetitorPageSnapshot> = {},
): CompetitorPageSnapshot {
  return {
    id: "comp-snap-fixture-1",
    tenant_id: TENANT,
    url: COMP_URL,
    canonical_url: null,
    fetched_at: "2026-05-08T08:00:00Z",
    http_status: 200,
    title: "Whole-Home Renovation | Sample Competitor Inc",
    meta_description:
      "Architect-led whole-home renovation across the example region.",
    h1: "Whole-Home Renovation",
    h2_list: ["What We Build", "Our Process", "Frequently Asked Questions"],
    faq_questions: ["How long does it take?", "What does it cost?"],
    extraction_certainty: "confirmed",
    ...over,
  };
}

function buildPacketArgs(
  over: Partial<Parameters<typeof buildSpecificEditEvidencePacket>[0]> = {},
): Parameters<typeof buildSpecificEditEvidencePacket>[0] {
  const observation: PromptAnswerObservation = {
    id: "obs-1",
    tenant_id: TENANT,
    prompt_id: "prompt-1",
    run_id: "run-1",
    platform: "chatgpt",
    answer_text: "Synthetic answer text — not used by the test.",
    answer_hash: "h1",
    position: 1,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 1,
    owned_citation_count: 0,
    citation_domains: ["competitor.example"],
    citation_urls: [COMP_URL],
    citation_domain_classes: ["competitor"],
    mention_position: null,
    citation_rank: null,
    primary_recommendation: null,
    descriptor_window: [],
    competitor_co_mentions: [COMPETITOR_NAME],
    answer_structure: "narrative",
    raw_search_queries: "",
    search_queries: [],
    observed_at: "2026-05-01T00:00:00Z",
    topic: null,
  } as unknown as PromptAnswerObservation;

  const prompt: TrackedPrompt = {
    id: "prompt-1",
    account_id: "acc",
    text: "best whole-home renovation example?",
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
  const opportunity: PromptOpportunity = {
    prompt_id: "prompt-1",
    category: "outranked",
    tags: [],
    signalStrength: 70,
    reasoning: "n/a",
    evidence: {
      observationCount: 1,
      primaryCount: 0,
      citedCount: 1,
      mentionedCount: 1,
      absentCount: 0,
      avgCitationRank: null,
      dominantCompetitors: [COMPETITOR_NAME],
      answerStructureDistribution: {},
      topDescriptors: [],
      byPlatform: [],
      lookbackDays: 7,
    },
  };
  const summary: PromptPrimarySummary = {
    prompt_id: "prompt-1",
    totalAnswers: 1,
    ritzPrimaryCount: 0,
    ritzPrimaryShare: 0,
    ritzState: "absent",
    primaryCompetitors: [
      { name: COMPETITOR_NAME, primaryCount: 1, totalAnswers: 1 },
    ],
    fragmented: false,
  };
  return {
    tenantId: TENANT,
    recId: "rec-fixture-1",
    clusterLabel: "whole home renovation",
    clusterKind: "topic",
    affectedPromptIds: ["prompt-1"],
    promptOpportunities: [opportunity],
    trackedPrompts: [prompt],
    primarySummaries: [summary],
    singleTargetUrl: null,
    observations: [observation],
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

// ─── Invariant 1 — POPULATED PATH ────────────────────────────────────────

describe("competitorPageBlueprints contract — Invariant 1: POPULATED PATH", () => {
  it("matching url snapshot populates h1, topH2s, faqQuestions, metaDescription", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([[COMP_URL, buildSnapshot()]]),
      }),
    );
    expect(packet.competitorPageBlueprints).toHaveLength(1);
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.url).toBe(COMP_URL);
    expect(bp.h1).not.toBeNull();
    expect(bp.h1!.length).toBeGreaterThan(0);
    expect(bp.topH2s.length).toBeGreaterThan(0);
    expect(bp.faqQuestions.length).toBeGreaterThan(0);
    expect(bp.metaDescription).not.toBeNull();
    expect(bp.metaDescription!.length).toBeGreaterThan(0);
  });

  it("snapshot title overrides citation-evidence pageTitle when present", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([[COMP_URL, buildSnapshot()]]),
      }),
    );
    expect(packet.competitorPageBlueprints[0].pageTitle).toBe(
      "Whole-Home Renovation | Sample Competitor Inc",
    );
  });
});

// ─── Invariant 2 — FALLBACK ───────────────────────────────────────────────

describe("competitorPageBlueprints contract — Invariant 2: FALLBACK", () => {
  it("empty snapshot map preserves null/[] (byte-identical pre-patch)", () => {
    const packet = buildSpecificEditEvidencePacket(buildPacketArgs());
    expect(packet.competitorPageBlueprints).toHaveLength(1);
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.h1).toBeNull();
    expect(bp.topH2s).toEqual([]);
    expect(bp.faqQuestions).toEqual([]);
    expect(bp.metaDescription).toBeNull();
  });

  it("snapshot for a DIFFERENT url is treated as no-match (empty fallback)", () => {
    const wrongUrl = "https://wrong.example/x";
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([
          [wrongUrl, buildSnapshot({ url: wrongUrl })],
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

// ─── Invariant 3 — CAPS ───────────────────────────────────────────────────

describe("competitorPageBlueprints contract — Invariant 3: CAPS", () => {
  it("topH2s capped at COMPETITOR_BLUEPRINT_MAX_TOP_H2S", () => {
    const overflowing = Array.from({ length: 25 }, (_, i) => `H2 number ${i}`);
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([
          [COMP_URL, buildSnapshot({ h2_list: overflowing })],
        ]),
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.topH2s.length).toBeLessThanOrEqual(
      COMPETITOR_BLUEPRINT_MAX_TOP_H2S,
    );
  });

  it("faqQuestions capped at COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS", () => {
    const overflowing = Array.from({ length: 25 }, (_, i) => `Question ${i}?`);
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([
          [COMP_URL, buildSnapshot({ faq_questions: overflowing })],
        ]),
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.faqQuestions.length).toBeLessThanOrEqual(
      COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS,
    );
  });

  it("metaDescription capped at COMPETITOR_BLUEPRINT_META_MAX_CHARS", () => {
    const longText = "x".repeat(2000);
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([
          [COMP_URL, buildSnapshot({ meta_description: longText })],
        ]),
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.metaDescription).not.toBeNull();
    expect(bp.metaDescription!.length).toBeLessThanOrEqual(
      COMPETITOR_BLUEPRINT_META_MAX_CHARS,
    );
  });

  it("operator-locked maxima are 5 / 5 / 200 (test fails if these change without explicit decision)", () => {
    expect(COMPETITOR_BLUEPRINT_MAX_TOP_H2S).toBe(5);
    expect(COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS).toBe(5);
    expect(COMPETITOR_BLUEPRINT_META_MAX_CHARS).toBe(200);
  });
});

// ─── Invariant 4 — SCRUB ──────────────────────────────────────────────────

describe("competitorPageBlueprints contract — Invariant 4: SCRUB", () => {
  it("drops H2 items containing operator brand", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([
          [
            COMP_URL,
            buildSnapshot({
              h2_list: [
                "What We Build",
                `Why ${OPERATOR_BRAND} got it wrong`,
                "Our Process",
              ],
            }),
          ],
        ]),
        competitorBlueprintBrandScrubAliases: [OPERATOR_BRAND],
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.topH2s).toContain("What We Build");
    expect(bp.topH2s).toContain("Our Process");
    for (const h2 of bp.topH2s) {
      expect(h2.toLowerCase()).not.toContain(OPERATOR_BRAND.toLowerCase());
    }
  });

  it("drops H2 items containing competitor name", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([
          [
            COMP_URL,
            buildSnapshot({
              h2_list: [
                `How ${COMPETITOR_NAME} structures projects`,
                "Our Process",
              ],
            }),
          ],
        ]),
        competitorBlueprintBrandScrubAliases: [COMPETITOR_NAME],
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    for (const h2 of bp.topH2s) {
      expect(h2.toLowerCase()).not.toContain(COMPETITOR_NAME.toLowerCase());
    }
  });

  it("drops FAQ questions containing brand-name aliases", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([
          [
            COMP_URL,
            buildSnapshot({
              faq_questions: [
                `Should I hire ${COMPETITOR_NAME} or someone else?`,
                "How long does it take?",
              ],
            }),
          ],
        ]),
        competitorBlueprintBrandScrubAliases: [COMPETITOR_NAME],
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    for (const q of bp.faqQuestions) {
      expect(q.toLowerCase()).not.toContain(COMPETITOR_NAME.toLowerCase());
    }
    expect(bp.faqQuestions).toContain("How long does it take?");
  });
});

// ─── Invariant 5 — NO ANSWER/BODY/PARAGRAPH FIELDS ────────────────────────

describe("competitorPageBlueprints contract — Invariant 5: STRUCTURAL SAFETY", () => {
  it("the persisted CompetitorPageSnapshot type does NOT carry answer/body/paragraph fields", () => {
    // Construct a snapshot with the FULL set of allowed fields. Then
    // assert that no key in the constructed object contains an unsafe
    // substring (answer / body / paragraph / content_text). The shape
    // is defined by the type at compile time — adding such a field
    // requires editing the type, which would re-trigger this test.
    const snap = buildSnapshot();
    const keys = Object.keys(snap);
    const unsafeSubstrings = ["answer", "body", "paragraph"];
    const leakingKeys = keys.filter((k) =>
      unsafeSubstrings.some((sub) => k.toLowerCase().includes(sub)),
    );
    expect(leakingKeys).toEqual([]);
    // Also assert the explicit allowed-field set; future additions
    // must update this test before merging.
    expect(new Set(keys)).toEqual(
      new Set([
        "id",
        "tenant_id",
        "url",
        "canonical_url",
        "fetched_at",
        "http_status",
        "title",
        "meta_description",
        "h1",
        "h2_list",
        "faq_questions",
        "extraction_certainty",
      ]),
    );
  });

  it("the CompetitorPageBlueprint output also has no answer/body/paragraph fields", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([[COMP_URL, buildSnapshot()]]),
      }),
    );
    const bp = packet.competitorPageBlueprints[0];
    const keys = Object.keys(bp);
    const unsafeSubstrings = ["answer", "body", "paragraph"];
    const leakingKeys = keys.filter((k) =>
      unsafeSubstrings.some((sub) => k.toLowerCase().includes(sub)),
    );
    expect(leakingKeys).toEqual([]);
  });
});

// ─── Invariant 6 — EVIDENCE-NOT-PUBLIC-COPY SEPARATION ────────────────────

describe("competitorPageBlueprints contract — Invariant 6: EVIDENCE-NOT-PUBLIC-COPY", () => {
  it("competitor structure flows IN as packet evidence (input path)", () => {
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([[COMP_URL, buildSnapshot()]]),
      }),
    );
    // The blueprint exists in the packet's `competitorPageBlueprints`
    // — that's the input/evidence path. The test name pins the
    // architectural label.
    expect(packet.competitorPageBlueprints.length).toBeGreaterThan(0);
    const bp = packet.competitorPageBlueprints[0];
    expect(bp.h1).not.toBeNull();
  });

  it("output validator REJECTS a rec_edit whose proposedText contains a competitor name, regardless of packet input", () => {
    // Even when the packet has rich competitor structure as evidence
    // input, the OUTPUT path (a generated rec_edit) must still be
    // scrubbed of competitor names by `validateCompetitorPublicCopy`.
    // The two paths are separate by design.
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([[COMP_URL, buildSnapshot()]]),
      }),
    );
    const offendingEdit: SpecificEdit = {
      actionType: "add_h2_section",
      targetUrl: OWNED_URL,
      targetElement: {
        elementKey: "h2[new]:fixture",
        displayLabel: `H2 (new): "Why teams choose us over ${COMPETITOR_NAME}"`,
        currentText: null,
        proposedText: `Why teams choose us over ${COMPETITOR_NAME}`,
      },
      why: "fixture",
      evidence: [
        { type: "competitor", competitorName: COMPETITOR_NAME },
        { type: "owned_page", url: OWNED_URL },
      ],
      expectedImpact: "fixture",
      difficulty: "low",
      confidence: "medium",
      measurementPlan: "fixture",
      risks: [],
      source: "deterministic",
      providerName: "deterministic",
      model: null,
      costUsd: null,
    };
    const result = validateSpecificEdit(offendingEdit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Failure must point at the proposedText / displayLabel field —
      // i.e., the validator must surface the leak in the OUTPUT, not
      // mistakenly object to the input evidence.
      expect(result.field).toMatch(/targetElement\.(proposedText|displayLabel)/);
      // The reason mentions the competitor (with alias-aware match).
      expect(result.reason.toLowerCase()).toContain(
        COMPETITOR_NAME.toLowerCase(),
      );
    }
  });

  it("a rec_edit whose proposedText does NOT contain a competitor name passes the competitor gate (even with rich packet evidence)", () => {
    // Counter-test: same packet, clean output → competitor-gate is
    // happy. Confirms the validator's rejection in the prior test was
    // about the OUTPUT, not about packet evidence.
    const packet = buildSpecificEditEvidencePacket(
      buildPacketArgs({
        competitorPageSnapshotsByUrl: new Map([[COMP_URL, buildSnapshot()]]),
      }),
    );
    const cleanEdit: SpecificEdit = {
      actionType: "add_h2_section",
      targetUrl: OWNED_URL,
      targetElement: {
        elementKey: "h2[new]:fixture-clean",
        displayLabel: 'H2 (new): "What to look for in whole-home renovation"',
        currentText: null,
        proposedText: "What to look for in whole-home renovation",
      },
      why: "fixture",
      evidence: [
        { type: "competitor", competitorName: COMPETITOR_NAME },
        { type: "owned_page", url: OWNED_URL },
      ],
      expectedImpact: "fixture",
      difficulty: "low",
      confidence: "high",
      measurementPlan: "fixture",
      risks: [],
      source: "openai",
      providerName: "openai",
      model: "gpt-4o",
      costUsd: 0.001,
    };
    const result = validateSpecificEdit(cleanEdit, packet);
    // Either OK, or failure for some OTHER reason (abstention contract,
    // etc.) — but NEVER for `validateCompetitorPublicCopy`.
    if (!result.ok) {
      expect(result.field).not.toMatch(
        /targetElement\.(proposedText|displayLabel)/,
      );
      expect(result.reason.toLowerCase()).not.toContain(
        COMPETITOR_NAME.toLowerCase(),
      );
    }
  });
});
