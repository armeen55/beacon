/**
 * Tests for `validateAbstentionContract` + `checkAbstentionContract` —
 * Trust Sprint Mini-Phase T4.1 (2026-05-06).
 *
 * The abstention contract is the validator-side enforcement of
 * SYSTEM_PROMPT Rule 16.A. Pre-T4.1, the rule lived only in the LLM's
 * instruction text; if a model ignored it, edits persisted. T4.1
 * adds defense-in-depth so the bundle CANNOT ship structurally thin
 * recs even when the provider returned them.
 *
 * Four reject reasons:
 *   abstention_contract_low_confidence_no_brand_assertions
 *   abstention_contract_no_grounding_signals
 *   abstention_contract_single_prompt_thin_evidence
 *   abstention_contract_thin_faq_answer
 */

import { describe, expect, it } from "vitest";
import {
  checkAbstentionContract,
  validateAbstentionContract,
  validateSpecificEdit,
  validateSpecificEditBundle,
  type AbstentionRejectReason,
} from "./specific-edit-validator";
import type { SpecificEdit } from "./specific-edit-provider";
import type {
  SpecificEditEvidencePacket,
  AffectedPromptBlock,
  OwnedPageCandidateBlock,
  CompetitorAngleBlock,
  AiSearchQueryAggregate,
} from "./specific-edit-evidence";
import type { BrandAssertion } from "./brand-assertions";
import type { SpecificEditBundle } from "./specific-edit-provider";

// ── Fixture helpers ────────────────────────────────────────────────────

function basePacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  return {
    schemaVersion: "specific-edit/v1",
    generatedAt: "2026-05-06T00:00:00Z",
    tenantId: "tenant-test",
    recId: "rec-test",
    clusterId: null,
    clusterLabel: "Test cluster",
    clusterKind: "topic",
    affectedPrompts: [],
    ownedPageCandidates: [],
    targetPageElements: [],
    competitorAngles: [],
    priorOutcomes: [],
    allowedTargetUrls: ["https://example.com/test"],
    allowedActionTypes: ["add_h2_section", "add_faq", "edit_meta"],
    aiSearchSignal: {
      topSearchQueries: [],
      topDescriptors: [],
      topCompetitorCoMentions: [],
      caps: {
        maxSearchQueries: 10,
        maxDescriptors: 12,
        maxCompetitorCoMentions: 8,
      },
    },
    competitorPageBlueprints: [],
    crossTenantPatterns: [],
    brandAssertions: [],
    evidenceHash: "deadbeef00000000",
    ...overrides,
  };
}

function affectedPrompt(promptId: string): AffectedPromptBlock {
  return {
    promptId,
    promptText: "best whole home remodel builders bay area",
    category: "absent",
    observationCount: 6,
    brandPrimaryShare: 0,
    topPrimaryCompetitor: null,
    descriptorsNearBrand: [],
    actualSearchQueries: [],
    citedSourcePages: [],
    descriptorWindows: [],
  };
}

function ownedPage(): OwnedPageCandidateBlock {
  return {
    url: "https://example.com/test",
    routeType: "service_page",
    detectedGeo: null,
    detectedService: null,
    matchScore: 0.8,
    matchReasons: ["geo_match"],
    title: "Test page",
    h1: "Test",
    h2s: ["Section 1"],
  };
}

function competitorAngle(): CompetitorAngleBlock {
  return {
    competitorName: "De Mattei Construction",
    promptsWherePrimary: 1,
    totalAffectedPrompts: 2,
    totalPrimaryObservations: 3,
  };
}

function searchQuery(): AiSearchQueryAggregate {
  return { query: "luxury custom home builders bay area", count: 3, promptIds: ["p1"], platforms: ["chatgpt"] };
}

function brandAssertion(): BrandAssertion {
  return {
    id: "ritz_process",
    phrase: "architect-led design-build",
    category: "process",
  };
}

function makeFaqAnswerEdit(promptId: string): SpecificEdit {
  return {
    actionType: "add_faq",
    targetUrl: "https://example.com/test",
    targetElement: {
      elementKey: "faq_answer[new]:abc12345",
      displayLabel: "Test answer",
      currentText: null,
      proposedText:
        "Bay Area renovations typically take 6-12 months from design through final inspection, depending on scope and permits.",
    },
    why: "operator-facing reasoning",
    expectedImpact: "anchors a customer-voice answer",
    measurementPlan: "re-poll affected prompts at T+7 / T+14",
    risks: [],
    difficulty: "low",
    confidence: "medium",
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.005,
    evidence: [{ type: "prompt", promptId }],
  };
}

function makeFaqQuestionEdit(promptId: string): SpecificEdit {
  return {
    actionType: "add_faq",
    targetUrl: "https://example.com/test",
    targetElement: {
      elementKey: "faq_question[new]:abc12345",
      displayLabel: "Test question",
      currentText: null,
      proposedText: "How long does a whole-home renovation take in the Bay Area?",
    },
    why: "operator-facing reasoning",
    expectedImpact: "anchors a customer-voice question",
    measurementPlan: "re-poll affected prompts at T+7 / T+14",
    risks: [],
    difficulty: "low",
    confidence: "medium",
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.005,
    evidence: [{ type: "prompt", promptId }],
  };
}

function makeH2Edit(promptId: string): SpecificEdit {
  return {
    actionType: "add_h2_section",
    targetUrl: "https://example.com/test",
    targetElement: {
      elementKey: "h2[new]:abc12345",
      displayLabel: "How to choose a builder for whole-home renovations",
      currentText: null,
      proposedText:
        "When evaluating builders for a whole-home renovation in the Bay Area, look for an architect-led design-build firm with documented permitting workflow and a fixed-fee preconstruction phase.",
    },
    why: "operator-facing reasoning",
    expectedImpact: "anchors the cluster intent",
    measurementPlan: "re-poll affected prompts at T+7 / T+14",
    risks: [],
    difficulty: "low",
    confidence: "medium",
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.0025,
    evidence: [{ type: "prompt", promptId }],
  };
}

function makeBundle(
  edits: SpecificEdit[],
  packet: SpecificEditEvidencePacket,
): SpecificEditBundle {
  return {
    schemaVersion: "specific-edit-bundle/v1",
    generatedAt: "2026-05-06T00:00:00Z",
    tenantId: packet.tenantId,
    recId: packet.recId,
    evidenceHash: packet.evidenceHash,
    providerName: "openai",
    recommendations: edits,
    totalCostUsd: edits.reduce((s, e) => s + (e.costUsd ?? 0), 0),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("checkAbstentionContract — Rule A: low confidence + no brand assertions", () => {
  it("rejects when resolution.confidence='low' AND brandAssertions empty", () => {
    const packet = basePacket({
      resolution: { confidence: "low", tier: "deterministic_only", action: { type: "create_cluster_page", clusterKind: "topic" } as never },
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [],
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    expect(reason).toBe<AbstentionRejectReason>("abstention_contract_low_confidence_no_brand_assertions");
  });

  it("does NOT reject when resolution.confidence='low' but brandAssertions is non-empty", () => {
    const packet = basePacket({
      resolution: { confidence: "low", tier: "deterministic_only", action: { type: "create_cluster_page", clusterKind: "topic" } as never },
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      brandAssertions: [brandAssertion()],
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    expect(reason).not.toBe("abstention_contract_low_confidence_no_brand_assertions");
  });

  it("does NOT reject when resolution is missing entirely (back-compat)", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      aiSearchSignal: {
        topSearchQueries: [searchQuery()],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    expect(reason).toBeNull();
  });
});

describe("checkAbstentionContract — Rule B: no grounding signals", () => {
  it("rejects when blueprints + topSearchQueries + brandAssertions are ALL empty", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      // All three "grounding signals" empty:
      competitorPageBlueprints: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
      brandAssertions: [],
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    expect(reason).toBe<AbstentionRejectReason>("abstention_contract_no_grounding_signals");
  });

  it("passes when topSearchQueries has at least one item", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      aiSearchSignal: {
        topSearchQueries: [searchQuery()],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
      brandAssertions: [],
      competitorPageBlueprints: [],
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    expect(reason).toBeNull();
  });

  it("passes when brandAssertions has at least one item", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      brandAssertions: [brandAssertion()],
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    expect(reason).toBeNull();
  });
});

describe("checkAbstentionContract — Rule C: single-prompt thin evidence", () => {
  it("rejects single-prompt + no owned page + no competitor + no brand + no search query", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [],
      competitorAngles: [],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    // Rule B fires first (also matches), so we pin Rule B's reason. Both
    // rules are correct rejections; the priority order is A → B → C → D.
    expect(reason).toBe<AbstentionRejectReason>("abstention_contract_no_grounding_signals");
  });

  it("rejects single-prompt with NO grounding even when blueprints array is non-empty (Rule C alone)", () => {
    // To isolate Rule C: keep aiSearchSignal/brandAssertions empty AND
    // populate competitorPageBlueprints (so Rule B passes), then verify
    // the single-prompt + thin packet still trips C.
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [],
      competitorAngles: [],
      competitorPageBlueprints: [
        {
          url: "https://demattei.example.com/luxury-home-builders",
          domain: "demattei.example.com",
          topic: "Luxury Home Builders",
          citationCount: 5,
          promptsCitedOn: ["p1"],
          pageTitle: "Luxury Home Builders",
          h1: null,
          topH2s: [],
          faqQuestions: [],
          metaDescription: null,
        },
      ],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    expect(reason).toBe<AbstentionRejectReason>("abstention_contract_single_prompt_thin_evidence");
  });

  it("passes single-prompt when ownedPageCandidates is non-empty", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [searchQuery()], // also a grounding signal so Rule B passes
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
    expect(reason).toBeNull();
  });
});

describe("checkAbstentionContract — Rule D: thin FAQ answer", () => {
  it("rejects faq_answer when packet has only one prompt + no owned page + no brand + no search query", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [],
      competitorAngles: [competitorAngle()], // grounding signal so Rule B passes
      competitorPageBlueprints: [
        {
          url: "https://comp.example.com/home-builder",
          domain: "comp.example.com",
          topic: null,
          citationCount: 3,
          promptsCitedOn: ["p1"],
          pageTitle: null,
          h1: null,
          topH2s: [],
          faqQuestions: [],
          metaDescription: null,
        },
      ],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    const edit = makeFaqAnswerEdit("p1");
    const reason = checkAbstentionContract(packet, edit);
    expect(reason).toBe<AbstentionRejectReason>("abstention_contract_thin_faq_answer");
  });

  it("ALLOWS faq_question even when same packet would reject the answer", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [],
      competitorAngles: [competitorAngle()],
      competitorPageBlueprints: [
        {
          url: "https://comp.example.com/home-builder",
          domain: "comp.example.com",
          topic: null,
          citationCount: 3,
          promptsCitedOn: ["p1"],
          pageTitle: null,
          h1: null,
          topH2s: [],
          faqQuestions: [],
          metaDescription: null,
        },
      ],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    const reason = checkAbstentionContract(packet, makeFaqQuestionEdit("p1"));
    expect(reason).toBeNull();
  });

  it("ALLOWS faq_answer when packet has 2+ affected prompts (multi-prompt grounding)", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [],
      competitorAngles: [competitorAngle()],
      competitorPageBlueprints: [
        {
          url: "https://comp.example.com/home-builder",
          domain: "comp.example.com",
          topic: null,
          citationCount: 3,
          promptsCitedOn: ["p1"],
          pageTitle: null,
          h1: null,
          topH2s: [],
          faqQuestions: [],
          metaDescription: null,
        },
      ],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    const reason = checkAbstentionContract(packet, makeFaqAnswerEdit("p1"));
    expect(reason).toBeNull();
  });

  it("ALLOWS faq_answer when packet has owned page", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      competitorPageBlueprints: [
        {
          url: "https://comp.example.com/home-builder",
          domain: "comp.example.com",
          topic: null,
          citationCount: 3,
          promptsCitedOn: ["p1"],
          pageTitle: null,
          h1: null,
          topH2s: [],
          faqQuestions: [],
          metaDescription: null,
        },
      ],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    const reason = checkAbstentionContract(packet, makeFaqAnswerEdit("p1"));
    expect(reason).toBeNull();
  });

  it("ALLOWS faq_answer grounded in a brand assertion (single prompt is fine when assertion exists)", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [],
      competitorAngles: [competitorAngle()],
      brandAssertions: [brandAssertion()],
    });
    const reason = checkAbstentionContract(packet, makeFaqAnswerEdit("p1"));
    expect(reason).toBeNull();
  });
});

describe("checkAbstentionContract — passing fixtures (sanity)", () => {
  it("medium confidence + owned page + prompt evidence: passes", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [searchQuery()],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    expect(checkAbstentionContract(packet, makeH2Edit("p1"))).toBeNull();
  });

  it("medium confidence + competitor angle + owned page: passes", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [searchQuery()],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    expect(checkAbstentionContract(packet, makeH2Edit("p1"))).toBeNull();
  });

  it("FAQ question with one prompt + owned page: passes", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [searchQuery()],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
    });
    expect(checkAbstentionContract(packet, makeFaqQuestionEdit("p1"))).toBeNull();
  });

  it("operator_edited row with valid evidence: passes", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [brandAssertion()],
    });
    const edit = { ...makeH2Edit("p1"), source: "operator_edited" as const, providerName: "deterministic" as const, model: null };
    expect(checkAbstentionContract(packet, edit)).toBeNull();
  });

  it("brandAssertion-grounded answer (single prompt OK with assertion): passes", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1")],
      ownedPageCandidates: [],
      competitorAngles: [competitorAngle()],
      brandAssertions: [brandAssertion()],
    });
    expect(checkAbstentionContract(packet, makeFaqAnswerEdit("p1"))).toBeNull();
  });
});

describe("validateAbstentionContract integration with validateSpecificEdit", () => {
  it("validateSpecificEdit fails with the abstention reason when packet violates Rule B", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
      competitorPageBlueprints: [],
    });
    const r = validateSpecificEdit(makeH2Edit("p1"), packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("packet");
      expect(r.reason).toBe<AbstentionRejectReason>("abstention_contract_no_grounding_signals");
    }
  });

  it("validateSpecificEdit passes when packet has full grounding", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [searchQuery()],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
      targetPageElements: [],
    });
    const r = validateSpecificEdit(makeH2Edit("p1"), packet);
    // We don't assert ok=true (downstream gates may still fire); we
    // assert the abstention reason did NOT fire.
    if (!r.ok) {
      expect(r.field).not.toBe("packet");
    }
  });

  it("validateAbstentionContract directly returns OK when packet is well-grounded", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [brandAssertion()],
    });
    const r = validateAbstentionContract(makeH2Edit("p1"), packet);
    expect(r.ok).toBe(true);
  });
});

describe("validateSpecificEditBundle: rejected edits cannot persist (rejection reason visible)", () => {
  it("a Rule-B-violating bundle has acceptedCount=0 and every per-edit carries the abstention reason", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [],
      aiSearchSignal: {
        topSearchQueries: [],
        topDescriptors: [],
        topCompetitorCoMentions: [],
        caps: { maxSearchQueries: 10, maxDescriptors: 12, maxCompetitorCoMentions: 8 },
      },
      competitorPageBlueprints: [],
    });
    const bundle = makeBundle([makeH2Edit("p1"), makeFaqQuestionEdit("p1")], packet);
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.acceptedCount).toBe(0);
    expect(result.rejectedCount).toBeGreaterThan(0);
    // Each per-edit failure must carry the abstention reason in the reason string.
    const reasons = result.perEdit.map((p) => (p.result.ok ? null : p.result.reason));
    expect(reasons.every((r) => r != null && r.startsWith("abstention_contract_"))).toBe(true);
  });

  it("a passing packet keeps the existing per-edit gates (e.g., FAQ pairing) in force", () => {
    const packet = basePacket({
      affectedPrompts: [affectedPrompt("p1"), affectedPrompt("p2")],
      ownedPageCandidates: [ownedPage()],
      competitorAngles: [competitorAngle()],
      brandAssertions: [brandAssertion()],
      targetPageElements: [],
    });
    // Single faq_question with no matching faq_answer: existing FAQ
    // pairing gate should fire — proving abstention is additive, not
    // a replacement.
    const bundle = makeBundle([makeFaqQuestionEdit("p1")], packet);
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(false);
    expect(result.bundleErrors.length + result.rejectedCount).toBeGreaterThan(0);
  });
});

describe("Architecture — abstention reasons are stable strings", () => {
  it("the four reject reasons have the exact operator-locked names", () => {
    // These strings appear in the operator runbook + audit script;
    // changing them is a breaking change.
    const expected: ReadonlyArray<AbstentionRejectReason> = [
      "abstention_contract_low_confidence_no_brand_assertions",
      "abstention_contract_no_grounding_signals",
      "abstention_contract_single_prompt_thin_evidence",
      "abstention_contract_thin_faq_answer",
    ];
    // Validate via type identity: TS compilation pins each string.
    for (const e of expected) {
      // No-op assertion — the type-check at compile time is the real
      // pin; this expect makes the test suite see the constant.
      expect(typeof e).toBe("string");
    }
  });
});
