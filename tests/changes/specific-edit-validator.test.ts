import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { PageInventoryEntry } from "@/domains/recommendations/page-inventory";
import {
  buildSpecificEditEvidencePacket,
  type BuildSpecificEditEvidencePacketArgs,
  type SpecificEditEvidencePacket,
  type AffectedPromptBlock,
  type OwnedPageCandidateBlock,
  type CompetitorAngleBlock,
  type AiSearchQueryAggregate,
} from "@/domains/recommendations/specific-edit-evidence";
import type { SpecificEdit, SpecificEditBundle } from "@/domains/recommendations/specific-edit-provider";
import type { BrandAssertion } from "@/domains/recommendations/brand-assertions";
import { deterministicProvider } from "@/domains/recommendations/providers/deterministic";
import {
  buildCompetitorAliases,
  checkAbstentionContract,
  isAdditiveElementKey,
  parseElementTypeFromKey,
  validateAbstentionContract,
  validateSerializable,
  validateSpecificEdit,
  validateSpecificEditBundle,
  type AbstentionRejectReason,
} from "@/domains/recommendations/specific-edit-validator";

// ---------------------------------------------------------------------------
// Consolidated validator suite (Core 100K lane R, 2026-07-21).
//
// Absorbs the former variant files as internal sections:
//   specific-edit-validator-llm-hardening.test.ts   (Sprint 6A.2d)
//   specific-edit-validator-abstention.test.ts      (Trust T4.1)
//   specific-edit-validator-brand-claims.test.ts    (W3 §3.7 / §3.7s)
//   specific-edit-validator-leading-superlative.test.ts (W3 §3.12)
//   specific-edit-validator-faq-pairing.test.ts     (W3 §3.8)
//
// Fixtures are neutral (orthodontics) except where the invariant under
// test is tenant-specific (Ritz brand-voice gates). Two fixture
// families exist: builder-based (buildSpecificEditEvidencePacket) for
// the core + LLM-hardening sections, and literal-packet based for the
// abstention / brand / superlative / FAQ-pairing sections.
// ---------------------------------------------------------------------------

const FROZEN_NOW = new Date("2026-04-24T12:00:00Z");
const TENANT = "tenant-test";
const REC = "rec-2026-04-24-1";
const URL_BRACES = "https://example.com/services/braces";

// ── Builder-based fixture family ───────────────────────────────────────────

function makePrompt(id: string, text: string): TrackedPrompt {
  return {
    id,
    account_id: "acc",
    text,
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: null,
    platforms: [],
    tags: [],
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-24T00:00:00Z",
  };
}

function makeOpportunity(promptId: string): PromptOpportunity {
  return {
    prompt_id: promptId,
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
      dominantCompetitors: ["AcmeOrtho"],
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
    primaryCompetitors: [
      { name: "AcmeOrtho", primaryCount: 3, totalAnswers: 5 },
    ],
    fragmented: false,
  };
}

function makeInventoryEntry(): PageInventoryEntry {
  return {
    url: URL_BRACES,
    title: "Braces · Acme",
    h1: "Braces",
    metaDescription: null,
    h2s: ["Treatment timeline"],
    routeType: "service",
    detectedGeo: null,
    detectedService: "braces",
  };
}

function makeElement(
  overrides: Partial<PageElementInventoryRow>,
): PageElementInventoryRow {
  return {
    id: "snap__key",
    tenant_id: TENANT,
    page_id: "pg-1",
    url: URL_BRACES,
    element_type: "title",
    element_key: "title[0]:hash-title",
    display_label: "Title tag",
    element_text: "Braces · Acme",
    element_metadata: {},
    extractor_version: 1,
    observed_at: "2026-04-24T10:00:00Z",
    source_snapshot_id: "snap",
    ...overrides,
  };
}

function basePacketArgs(): BuildSpecificEditEvidencePacketArgs {
  const promptId = "prompt-1";
  return {
    tenantId: TENANT,
    recId: REC,
    clusterLabel: "teen braces",
    clusterKind: "topic",
    affectedPromptIds: [promptId],
    promptOpportunities: [makeOpportunity(promptId)],
    trackedPrompts: [makePrompt(promptId, "What are the best teen braces?")],
    primarySummaries: [makeSummary(promptId)],
    singleTargetUrl: null,
    observations: [],
    ownedPageInventory: [makeInventoryEntry()],
    pageElementInventory: [
      makeElement({}),
      makeElement({
        element_type: "h2",
        element_key: "h2[0]:hash-h2a",
        element_text: "Treatment timeline",
        display_label: "H2",
      }),
    ],
    now: FROZEN_NOW,
  };
}

function buildPacket(
  overrides: Partial<BuildSpecificEditEvidencePacketArgs> = {},
): SpecificEditEvidencePacket {
  const built = buildSpecificEditEvidencePacket({ ...basePacketArgs(), ...overrides });
  // T4.1 (2026-05-06): seed one search query so the abstention contract
  // (Rule B / no grounding signals) passes. These tests target shape /
  // length / element-key gates, not abstention. Tests that want to
  // exercise Rule B can override `aiSearchSignal.topSearchQueries: []`.
  return {
    ...built,
    aiSearchSignal: {
      ...built.aiSearchSignal,
      topSearchQueries: [
        {
          query: "best teen braces",
          count: 3,
          promptIds: [built.affectedPrompts[0]?.promptId ?? "prompt-1"], platforms: ["chatgpt"],
        },
      ],
    },
  };
}

function validEditTitleFixture(
  packet: SpecificEditEvidencePacket,
  overrides: Partial<SpecificEdit> = {},
): SpecificEdit {
  return {
    actionType: "edit_title",
    targetUrl: URL_BRACES,
    targetElement: {
      elementKey: "title[0]:hash-title",
      displayLabel: "Title tag",
      currentText: "Braces · Acme",
      proposedText: "Teen Braces · Acme",
    },
    why: "Title missing cluster keywords.",
    evidence: [
      { type: "prompt", promptId: packet.affectedPrompts[0].promptId },
      { type: "owned_page", url: URL_BRACES },
    ],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "deterministic",
    providerName: "deterministic",
    model: null,
    costUsd: null,
    ...overrides,
  };
}

function validAddH2Fixture(): SpecificEdit {
  return {
    actionType: "add_h2_section",
    targetUrl: URL_BRACES,
    targetElement: {
      elementKey: "h2[new]:abc123def456",
      displayLabel: 'H2 heading (new): "Why teams choose us"',
      currentText: null,
      // 6A.2g.B: proposedText must NOT name a competitor — the packet's
      // primarySummaries include "AcmeOrtho".
      proposedText:
        "Why teams choose a board-certified orthodontist for their teen.",
    },
    why: "Top competitor (AcmeOrtho) primary on 3 of 5 prompts; no H2 differentiates.",
    evidence: [{ type: "competitor", competitorName: "AcmeOrtho" }],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "deterministic",
    providerName: "deterministic",
    model: null,
    costUsd: null,
  };
}

/** Restore-or-delete an env var after a test body. */
function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

// ── Literal-packet fixture family (abstention / brand / superlative / FAQ) ─

function literalSignal(
  queries: AiSearchQueryAggregate[] = [],
): SpecificEditEvidencePacket["aiSearchSignal"] {
  return {
    topSearchQueries: queries,
    topDescriptors: [],
    topCompetitorCoMentions: [],
    caps: {
      maxSearchQueries: 10,
      maxDescriptors: 12,
      maxCompetitorCoMentions: 8,
    },
  };
}

function literalPrompt(
  overrides: Partial<AffectedPromptBlock> = {},
): AffectedPromptBlock {
  return {
    promptId: "11111111-2222-3333-4444-555555555555",
    promptText: "best whole home remodel builders bay area",
    category: "absent",
    observationCount: 6,
    brandPrimaryShare: 0,
    topPrimaryCompetitor: null,
    descriptorsNearBrand: [],
    actualSearchQueries: [],
    citedSourcePages: [],
    descriptorWindows: [],
    ...overrides,
  };
}

function literalPacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  return {
    schemaVersion: "specific-edit/v1",
    generatedAt: "2026-05-03T00:00:00Z",
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
    aiSearchSignal: literalSignal(),
    competitorPageBlueprints: [],
    crossTenantPatterns: [],
    brandAssertions: [],
    evidenceHash: "deadbeef00000000",
    ...overrides,
  };
}

// ── Key-parsing helpers ────────────────────────────────────────────────────

describe("Phase 6A.1.10 — element-key parsing helpers", () => {
  it("parseElementTypeFromKey handles positional, additive, schema_type, schema_property", () => {
    expect(parseElementTypeFromKey("title[0]:abc")).toBe("title");
    expect(parseElementTypeFromKey("h2[3]:def")).toBe("h2");
    expect(parseElementTypeFromKey("h2[new]:ghi")).toBe("h2");
    expect(parseElementTypeFromKey("faq_question[new]:jkl")).toBe(
      "faq_question",
    );
    expect(parseElementTypeFromKey("schema[FAQPage]")).toBe("schema_type");
    expect(parseElementTypeFromKey("schema[FAQPage].mainEntity[2].name:xyz")).toBe(
      "schema_property",
    );
  });

  it("parseElementTypeFromKey returns null for malformed keys", () => {
    expect(parseElementTypeFromKey("")).toBeNull();
    expect(parseElementTypeFromKey("not-a-key")).toBeNull();
    expect(parseElementTypeFromKey("[abc]")).toBeNull();
    expect(parseElementTypeFromKey("unknown_type[0]:hash")).toBeNull();
  });

  it("isAdditiveElementKey detects [new]:* keys", () => {
    expect(isAdditiveElementKey("h2[new]:abc")).toBe(true);
    expect(isAdditiveElementKey("faq_question[new]:abc")).toBe(true);
    expect(isAdditiveElementKey("h2[3]:abc")).toBe(false);
    expect(isAdditiveElementKey("title[0]:abc")).toBe(false);
  });
});

// ── Serializability walker ────────────────────────────────────────────────

describe("Phase 6A.1.10 — validateSerializable", () => {
  it("accepts plain JSON values", () => {
    expect(validateSerializable({ a: 1, b: [true, "x", null] }).ok).toBe(true);
    expect(validateSerializable([]).ok).toBe(true);
    expect(validateSerializable("hello").ok).toBe(true);
  });

  it("rejects functions, undefined, symbols, bigints, Date, Map, Set, class instances", () => {
    expect(validateSerializable(() => undefined).ok).toBe(false);
    expect(validateSerializable(undefined).ok).toBe(false);
    expect(validateSerializable(Symbol("x")).ok).toBe(false);
    expect(validateSerializable(BigInt(1)).ok).toBe(false);
    expect(validateSerializable(new Date()).ok).toBe(false);
    expect(validateSerializable(new Map()).ok).toBe(false);
    expect(validateSerializable(new Set()).ok).toBe(false);
    class Foo {}
    expect(validateSerializable(new Foo()).ok).toBe(false);
  });

  it("rejects nested non-serializable values with field path", () => {
    const r = validateSerializable({ outer: { inner: new Date() } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("$.outer.inner");
    }
  });
});

// ── validateSpecificEdit — positive ───────────────────────────────────────

describe("Phase 6A.1.10 — validateSpecificEdit (positive)", () => {
  it("accepts a valid deterministic edit_title fixture", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("accepts a valid add_h2_section fixture with [new] elementKey", () => {
    const packet = buildPacket();
    const edit = validAddH2Fixture();
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });


  it("accepts a page-level lifecycle edit with targetElement=null (watch)", () => {
    const packet = buildPacket();
    const widened: SpecificEditEvidencePacket = {
      ...packet,
      allowedActionTypes: [...packet.allowedActionTypes, "watch"],
    };
    const edit: SpecificEdit = {
      actionType: "watch",
      targetUrl: URL_BRACES,
      targetElement: null,
      why: "Trend is winning — watch for regression.",
      evidence: [
        {
          type: "prompt",
          promptId: packet.affectedPrompts[0].promptId,
        },
      ],
      expectedImpact: null,
      difficulty: "low",
      confidence: "medium",
      measurementPlan: null,
      risks: [],
      source: "deterministic",
      providerName: "deterministic",
      model: null,
      costUsd: null,
    };
    expect(validateSpecificEdit(edit, widened)).toEqual({ ok: true });
  });
});

// ── validateSpecificEdit — negatives ──────────────────────────────────────

describe("Phase 6A.1.10 — validateSpecificEdit (negative — actionType)", () => {
  it("rejects unknown actionType", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      // @ts-expect-error — testing runtime rejection of bogus value
      actionType: "make_it_better",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("actionType");
  });

  it("rejects actionType not in packet.allowedActionTypes", () => {
    const packet = buildPacket();
    // `rewrite_faq` stays generatorActive: false (until Slice 4.5.E.α₂)
    // so it is NOT in the default v1 allowedActionTypes set.
    const bad = validEditTitleFixture(packet, {
      actionType: "rewrite_faq",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("actionType");
  });
});

describe("Phase 6A.1.10 — validateSpecificEdit (negative — targetUrl)", () => {
  it("rejects hallucinated targetUrl", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      targetUrl: "https://hallucinated.example/oops",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetUrl");
  });

  it("rejects empty targetUrl", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, { targetUrl: "" });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetUrl");
  });
});

describe("Phase 6A.1.10 — validateSpecificEdit (negative — targetElement)", () => {
  it("rejects element actionType when targetElement is null", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, { targetElement: null });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetElement");
  });

  it("rejects page-level actionType when targetElement is non-null", () => {
    const packet = buildPacket();
    const widened: SpecificEditEvidencePacket = {
      ...packet,
      allowedActionTypes: [...packet.allowedActionTypes, "watch"],
    };
    const bad: SpecificEdit = {
      actionType: "watch",
      targetUrl: URL_BRACES,
      targetElement: {
        elementKey: "h2[new]:abc",
        displayLabel: "x",
        currentText: null,
        proposedText: "x",
      },
      why: "x",
      evidence: [],
      expectedImpact: null,
      difficulty: "low",
      confidence: "medium",
      measurementPlan: null,
      risks: [],
      source: "deterministic",
      providerName: "deterministic",
      model: null,
      costUsd: null,
    };
    const r = validateSpecificEdit(bad, widened);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetElement");
  });

  it("rejects elementKey not in inventory (non-additive action)", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hallucinated-hash",
        displayLabel: "Title",
        currentText: "x",
        proposedText: "y",
      },
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetElement.elementKey");
  });

  it("accepts a valid [new] elementKey for an additive action", () => {
    const packet = buildPacket();
    const edit: SpecificEdit = validAddH2Fixture();
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("rejects a [new] elementKey for an action that requiresCurrentText (edit_title)", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[new]:abc123",
        displayLabel: "Title (new)",
        currentText: "x",
        proposedText: "y",
      },
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetElement.elementKey");
  });

  it("rejects element_type not in actionType's elementTypeDomain", () => {
    const packet = buildPacket();
    // edit_title's domain is ["title"]; an h2 inventory key must fail.
    const bad = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "h2[0]:hash-h2a", // present in inventory
        displayLabel: "H2",
        currentText: "Treatment timeline",
        proposedText: "y",
      },
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetElement.elementKey");
  });

});

describe("Phase 6A.1.10 — validateSpecificEdit (negative — required text)", () => {
  it("rejects missing currentText for edit_title (requiresCurrentText: true)", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title",
        currentText: null,
        proposedText: "x",
      },
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetElement.currentText");
  });

  it("rejects missing proposedText for add_h2_section (requiresProposedText: true)", () => {
    const packet = buildPacket();
    const bad: SpecificEdit = {
      ...validAddH2Fixture(),
      targetElement: {
        elementKey: "h2[new]:abc",
        displayLabel: "x",
        currentText: null,
        proposedText: null,
      },
    };
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("targetElement.proposedText");
  });
});

describe("Phase 6A.1.10 — validateSpecificEdit (negative — evidence)", () => {
  it("rejects unknown promptId in prompt ref", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      evidence: [{ type: "prompt", promptId: "made-up-prompt" }],
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toMatch(/^evidence\[/);
  });

  it("rejects element ref not in inventory", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      evidence: [
        {
          type: "element",
          elementKey: "h2[99]:hallucinated",
          url: URL_BRACES,
        },
      ],
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toMatch(/^evidence\[/);
  });

  it("rejects owned_page ref pointing to URL not in candidates", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      evidence: [
        { type: "owned_page", url: "https://hallucinated.example/x" },
      ],
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toMatch(/^evidence\[/);
  });

  it("rejects competitor ref not in competitorAngles", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      evidence: [{ type: "competitor", competitorName: "MadeUpCo" }],
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toMatch(/^evidence\[/);
  });

  it("rejects unknown evidence ref type", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      // @ts-expect-error — testing runtime rejection of bogus value
      evidence: [{ type: "wishful_thinking", note: "x" }],
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toMatch(/^evidence\[/);
  });
});

describe("Phase 6A.1.10 — validateSpecificEdit (negative — enums + coherence)", () => {
  it("rejects invalid difficulty / confidence / source enum values (field pinned each)", () => {
    const packet = buildPacket();
    const cases: Array<[Partial<SpecificEdit>, string]> = [
      // @ts-expect-error — testing runtime rejection
      [{ difficulty: "epic" }, "difficulty"],
      // @ts-expect-error — testing runtime rejection
      [{ confidence: "very_high" }, "confidence"],
      // @ts-expect-error — testing runtime rejection
      [{ source: "vibes" }, "source"],
    ];
    for (const [overrides, field] of cases) {
      const r = validateSpecificEdit(
        validEditTitleFixture(packet, overrides),
        packet,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe(field);
    }
  });



  it("rejects source/providerName mismatch (deterministic + 'openai')", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      providerName: "openai",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("providerName");
  });

});

describe("Phase 6A.1.10 — validateSpecificEdit (negative — non-serializable)", () => {
  it("rejects edits containing Date / function / Map values (never throws)", () => {
    const packet = buildPacket();
    // expectedImpact has a type-level guard before serializability, so
    // it lands on the type check field.
    const r1 = validateSpecificEdit(
      // @ts-expect-error — testing runtime rejection
      validEditTitleFixture(packet, { expectedImpact: new Date() }),
      packet,
    );
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.field).toBe("expectedImpact");
    expect(
      validateSpecificEdit(
        // @ts-expect-error — testing runtime rejection
        validEditTitleFixture(packet, { why: () => "lazy" }),
        packet,
      ).ok,
    ).toBe(false);
    expect(
      validateSpecificEdit(
        // @ts-expect-error — testing runtime rejection
        validEditTitleFixture(packet, { risks: [new Map()] }),
        packet,
      ).ok,
    ).toBe(false);
  });
});

// ── Sprint 6A.2g.C — FAQ intent rewriting ───────────────────────────────

/**
 * The packet's affected prompt is "What are the best teen braces?" —
 * the validator's stem check normalizes to "what are the best teen
 * braces" (first 50 chars, lowercased, punctuation stripped). Any FAQ
 * proposedText whose normalized prefix matches is rejected unless
 * BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1.
 */
function validAddFaqQuestionFixture(
  packet: SpecificEditEvidencePacket,
  overrides: Partial<SpecificEdit> = {},
): SpecificEdit {
  return {
    actionType: "add_faq",
    targetUrl: URL_BRACES,
    targetElement: {
      elementKey: "faq_question[new]:abc123def456",
      displayLabel: "FAQ question (new)",
      currentText: null,
      proposedText: "How long do braces typically take for teens?",
    },
    why: "No FAQ section addresses teen-treatment-duration intent.",
    evidence: [
      { type: "prompt", promptId: packet.affectedPrompts[0].promptId },
    ],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "deterministic",
    providerName: "deterministic",
    model: null,
    costUsd: null,
    ...overrides,
  };
}

/** Build the FAQ fixture with only proposedText swapped. */
function faqWithText(
  packet: SpecificEditEvidencePacket,
  proposedText: string,
  elementKey = "faq_question[new]:abc123def456",
  displayLabel = "FAQ question (new)",
): SpecificEdit {
  return validAddFaqQuestionFixture(packet, {
    targetElement: {
      elementKey,
      displayLabel,
      currentText: null,
      proposedText,
    },
  });
}

describe("Sprint 6A.2g.C — FAQ intent rewriting (validateFaqIntentRewriting)", () => {
  const ORIGINAL = process.env.BEACON_ALLOW_SYNTHETIC_FAQ_COPY;
  afterEach(() => {
    restoreEnv("BEACON_ALLOW_SYNTHETIC_FAQ_COPY", ORIGINAL);
  });

  it("ACCEPT — paraphrased customer-voice FAQ question on add_faq", () => {
    const packet = buildPacket();
    const edit = validAddFaqQuestionFixture(packet);
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("REJECT — proposedText does not end in '?'", () => {
    const packet = buildPacket();
    const r = validateSpecificEdit(
      faqWithText(packet, "How long do braces take"),
      packet,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.proposedText");
      expect(r.reason).toMatch(/must end with "\?"/);
    }
  });

  it("REJECT — proposedText lifts synthetic prompt stem verbatim (add_faq)", () => {
    const packet = buildPacket();
    // Lifting the tracked-prompt text as the FAQ question is exactly
    // the pattern Rule 13 forbids — it ends in ? but is the synthetic
    // prompt verbatim.
    const r = validateSpecificEdit(
      faqWithText(packet, "What are the best teen braces?"),
      packet,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.proposedText");
      expect(r.reason).toMatch(/lifts synthetic prompt text verbatim/);
      expect(r.reason).toMatch(/BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1 to override/);
    }
  });

  it("ACCEPT — verbatim stem allowed when BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1 (still enforces '?')", () => {
    process.env.BEACON_ALLOW_SYNTHETIC_FAQ_COPY = "1";
    const packet = buildPacket();
    expect(
      validateSpecificEdit(
        faqWithText(packet, "What are the best teen braces?"),
        packet,
      ),
    ).toEqual({ ok: true });
  });


  it("UNAFFECTED — faq_answer element bypasses the FAQ-question rule (answers don't end in '?')", () => {
    // W3 §3.8: faq_answer rows carry their own ≥30-word floor; give a
    // substantive answer so only the question-rule bypass is under test.
    const packet = buildPacket();
    const edit = faqWithText(
      packet,
      "Choosing the best teen braces depends on alignment goals, treatment timeline, and household budget. Most families balance aesthetics, comfort, and total cost across at least three options including traditional metal, ceramic, and clear-aligner systems before making a final selection with their orthodontist.",
      "faq_answer[new]:abc123def456",
      "FAQ answer (new)",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("UNAFFECTED — non-FAQ action types are not gated (edit_title with question text passes)", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title",
        currentText: "Braces · Acme",
        // Lifted prompt as a TITLE — Rule 13 doesn't apply (not FAQ).
        proposedText: "What are the best teen braces?",
      },
    });
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });



});

// ── Sprint 6A.2g.B — Competitor public-copy safety ──────────────────────

describe("Sprint 6A.2g.B — buildCompetitorAliases (alias generation)", () => {
  it("includes the full trimmed name first, strips closed-set suffixes iteratively, trims trailing periods, preserves case", () => {
    expect(buildCompetitorAliases("De Mattei Construction")).toEqual([
      "De Mattei Construction",
      "De Mattei",
    ]);
    expect(buildCompetitorAliases("Acme Builders Inc")).toEqual([
      "Acme Builders Inc",
      "Acme Builders",
      "Acme",
    ]);
    expect(buildCompetitorAliases("Acme Inc.")).toEqual(["Acme Inc.", "Acme"]);
    expect(buildCompetitorAliases("de mattei construction")).toEqual([
      "de mattei construction",
      "de mattei",
    ]);
  });


  it("suppresses stripped aliases below the 4-char floor (W3 §3.8.6) while keeping the full name", () => {
    // "X Co" → strip "Co" → "X" (1 char) → suppressed.
    expect(buildCompetitorAliases("X Co")).toEqual(["X Co"]);
    // Floor raised 3 → 4: "ABC" (3 chars) no longer makes the cut.
    expect(buildCompetitorAliases("ABC LLC")).toEqual(["ABC LLC"]);
    // The stripped 4-char alias passes the floor.
    expect(buildCompetitorAliases("ABCD LLC")).toEqual(["ABCD LLC", "ABCD"]);
    // "Foo" (3 chars) below floor; 4-char "Quux" survives.
    expect(buildCompetitorAliases("Foo Group")).toEqual(["Foo Group"]);
    expect(buildCompetitorAliases("Quux Group")).toEqual(["Quux Group", "Quux"]);
    // 2-char FULL name is kept regardless of length (floor only applies
    // to stripped derivatives).
    expect(buildCompetitorAliases("AB")).toEqual(["AB"]);
  });

  it("caps aliases at 5 per competitor (contractual)", () => {
    const a = buildCompetitorAliases("A Builders Construction Group LLC Co");
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a[0]).toBe("A Builders Construction Group LLC Co");
  });

});

/**
 * Helper: build a packet whose competitorAngles contains the given
 * competitor name(s), with grounding seeded so abstention passes.
 */
function buildPacketWithCompetitors(
  competitorNames: string[],
): SpecificEditEvidencePacket {
  const promptId = "prompt-1";
  const built = buildSpecificEditEvidencePacket({
    ...basePacketArgs(),
    primarySummaries: [
      {
        prompt_id: promptId,
        totalAnswers: 5,
        ritzPrimaryCount: 0,
        ritzPrimaryShare: 0,
        ritzState: "absent",
        primaryCompetitors: competitorNames.map((name) => ({
          name,
          primaryCount: 3,
          totalAnswers: 5,
        })),
        fragmented: false,
      },
    ],
  });
  return {
    ...built,
    aiSearchSignal: {
      ...built.aiSearchSignal,
      topSearchQueries: [
        {
          query: "best teen braces",
          count: 3,
          promptIds: [built.affectedPrompts[0]?.promptId ?? "prompt-1"],
          platforms: ["chatgpt"],
        },
      ],
    },
  };
}

function makeAddH2EditWithProposedText(
  packet: SpecificEditEvidencePacket,
  proposedText: string,
  displayLabel = "H2 (new)",
): SpecificEdit {
  return {
    actionType: "add_h2_section",
    targetUrl: URL_BRACES,
    targetElement: {
      elementKey: "h2[new]:abc123def456",
      displayLabel,
      currentText: null,
      proposedText,
    },
    why: "Operator-facing reasoning is fine to mention competitors.",
    evidence: [
      { type: "prompt", promptId: packet.affectedPrompts[0].promptId },
    ],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "deterministic",
    providerName: "deterministic",
    model: null,
    costUsd: null,
  };
}

describe("Sprint 6A.2g.B — competitor public-copy validator", () => {
  const ORIGINAL = process.env.BEACON_ALLOW_COMPETITOR_COPY;
  afterEach(() => {
    restoreEnv("BEACON_ALLOW_COMPETITOR_COPY", ORIGINAL);
  });

  it("REJECT — full competitor name appears in proposedText", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why teams choose us over De Mattei Construction",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.proposedText");
      expect(r.reason).toMatch(/De Mattei Construction/);
      expect(r.reason).toMatch(/BEACON_ALLOW_COMPETITOR_COPY=1 to override/);
    }
  });

  it("REJECT — suffix-stripped alias appears in proposedText ('vs De Mattei')", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const r = validateSpecificEdit(
      makeAddH2EditWithProposedText(packet, "Why teams choose us vs De Mattei"),
      packet,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/De Mattei/);
      expect(r.reason).toMatch(/matched alias "De Mattei"/);
    }
  });

  it("REJECT — competitor alias appears in displayLabel", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const r = validateSpecificEdit(
      makeAddH2EditWithProposedText(
        packet,
        "Why teams choose a board-certified design-build partner.",
        "vs De Mattei",
      ),
      packet,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.displayLabel");
      expect(r.reason).toMatch(/displayLabel contains competitor name/);
    }
  });

  it("ACCEPT — proposedText with no competitor names passes", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    expect(
      validateSpecificEdit(
        makeAddH2EditWithProposedText(
          packet,
          "Why Bay Area homeowners choose a design-build partner.",
        ),
        packet,
      ),
    ).toEqual({ ok: true });
  });


  it("ACCEPT — env opt-out BEACON_ALLOW_COMPETITOR_COPY=1 skips the rule entirely", () => {
    process.env.BEACON_ALLOW_COMPETITOR_COPY = "1";
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    expect(
      validateSpecificEdit(
        makeAddH2EditWithProposedText(
          packet,
          "Why teams choose us over De Mattei Construction",
        ),
        packet,
      ),
    ).toEqual({ ok: true });
  });

  it("WORD-BOUNDARY — alias 'Reno' does NOT match 'Renovation' but DOES match standalone 'Reno'", () => {
    const packet = buildPacketWithCompetitors(["Reno"]);
    expect(
      validateSpecificEdit(
        makeAddH2EditWithProposedText(
          packet,
          "Renovation timelines for Bay Area projects.",
        ),
        packet,
      ),
    ).toEqual({ ok: true });
    const r = validateSpecificEdit(
      makeAddH2EditWithProposedText(
        packet,
        "We've completed projects in Reno before.",
      ),
      packet,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Reno/);
  });


  it("SHORT ALIAS GUARD — 4-char floor suppresses bare fragments ('X', 'Bay') in legit copy (W3 §3.8.6)", () => {
    // Operator-caught regression: bare-"Bay" alias of "Bay Builders"
    // matched every "Bay Area" mention in legitimate geo copy.
    const packetX = buildPacketWithCompetitors(["X Co"]);
    expect(
      validateSpecificEdit(
        makeAddH2EditWithProposedText(
          packetX,
          "X marks the spot in our design-build process.",
        ),
        packetX,
      ),
    ).toEqual({ ok: true });
    const packetBay = buildPacketWithCompetitors(["Bay Builders"]);
    expect(
      validateSpecificEdit(
        makeAddH2EditWithProposedText(
          packetBay,
          "Ritz Builders emphasizes an architect-led design-build approach for luxury custom homes in the Bay Area. Our team coordinates architecture, engineering, and permitting from concept through construction.",
        ),
        packetBay,
      ),
    ).toEqual({ ok: true });
  });

  it("SHORT ALIAS GUARD — 'Bay Builders' STILL matches the full name in copy", () => {
    const packet = buildPacketWithCompetitors(["Bay Builders"]);
    const r = validateSpecificEdit(
      makeAddH2EditWithProposedText(
        packet,
        "Ritz Builders emphasizes design-build, unlike Bay Builders.",
      ),
      packet,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Bay Builders/);
  });




  it("WHY + EVIDENCE fields with competitor names are allowed (rule scans public copy only)", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why we lead in design-build.",
    );
    edit.why =
      "Differentiates against De Mattei Construction (3/5 prompts primary).";
    edit.evidence = [
      { type: "competitor", competitorName: "De Mattei Construction" },
    ];
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });


});

// ── Bundle validator ───────────────────────────────────────────────────────

describe("Phase 6A.1.10 — validateSpecificEditBundle", () => {
  it("accepts a deterministic provider's bundle in full (FAQ rows filtered + competitor-copy opt-out set)", async () => {
    const original = process.env.BEACON_ALLOW_COMPETITOR_COPY;
    process.env.BEACON_ALLOW_COMPETITOR_COPY = "1";
    try {
      const packet = buildPacket();
      const bundle = await deterministicProvider.generate(packet);
      const filteredBundle: typeof bundle = {
        ...bundle,
        recommendations: bundle.recommendations.filter(
          (r) => r.actionType !== "add_faq" && r.actionType !== "rewrite_faq",
        ),
      };
      const result = validateSpecificEditBundle(filteredBundle, packet);
      expect(result.ok).toBe(true);
      expect(result.bundleErrors).toEqual([]);
      expect(result.rejectedCount).toBe(0);
      expect(result.acceptedCount).toBe(filteredBundle.recommendations.length);
    } finally {
      restoreEnv("BEACON_ALLOW_COMPETITOR_COPY", original);
    }
  });


  it("flags tenantId / recId / evidenceHash mismatches and negative totalCostUsd as bundle-level errors", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    const tampers: Array<[Partial<SpecificEditBundle>, string]> = [
      [{ tenantId: "tenant-other" }, "tenantId"],
      [{ recId: "rec-other" }, "recId"],
      [{ evidenceHash: "deadbeef00000000" }, "evidenceHash"],
      [{ totalCostUsd: -1 }, "totalCostUsd"],
    ];
    for (const [tamper, field] of tampers) {
      const result = validateSpecificEditBundle({ ...bundle, ...tamper }, packet);
      expect(result.ok).toBe(false);
      expect(result.bundleErrors.some((e) => e.field === field)).toBe(true);
    }
  });

  it("aggregates rejected per-edit results into rejectedCount + accepts the rest", async () => {
    const original = process.env.BEACON_ALLOW_COMPETITOR_COPY;
    process.env.BEACON_ALLOW_COMPETITOR_COPY = "1";
    try {
      const packet = buildPacket();
      const rawBundle = await deterministicProvider.generate(packet);
      const bundle: SpecificEditBundle = {
        ...rawBundle,
        recommendations: rawBundle.recommendations.filter(
          (r) =>
            r.actionType !== "add_faq" && r.actionType !== "rewrite_faq",
        ),
      };
      expect(bundle.recommendations.length).toBeGreaterThan(0);
      const tampered: SpecificEditBundle = {
        ...bundle,
        recommendations: [
          ...bundle.recommendations.slice(0, -1),
          {
            ...bundle.recommendations[bundle.recommendations.length - 1],
            targetUrl: "https://hallucinated.example/oops",
          },
        ],
      };
      const result = validateSpecificEditBundle(tampered, packet);
      expect(result.ok).toBe(false);
      expect(result.rejectedCount).toBe(1);
      expect(result.acceptedCount).toBe(bundle.recommendations.length - 1);
    } finally {
      restoreEnv("BEACON_ALLOW_COMPETITOR_COPY", original);
    }
  });
});

// ── Validator never mutates inputs ────────────────────────────────────────

describe("Phase 6A.1.10 — validator never mutates inputs", () => {
  it("neither validateSpecificEdit nor validateSpecificEditBundle mutates edit/bundle/packet", async () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    const beforeEdit = JSON.stringify(edit);
    const beforePacket = JSON.stringify(packet);
    validateSpecificEdit(edit, packet);
    expect(JSON.stringify(edit)).toBe(beforeEdit);
    expect(JSON.stringify(packet)).toBe(beforePacket);

    const bundle = await deterministicProvider.generate(packet);
    const beforeBundle = JSON.stringify(bundle);
    validateSpecificEditBundle(bundle, packet);
    expect(JSON.stringify(bundle)).toBe(beforeBundle);
    expect(JSON.stringify(packet)).toBe(beforePacket);
  });
});

// ── W3 Step 3.1 — placeholder phrase rejection ────────────────────────────

describe("W3 Step 3.1 — validateNoPlaceholder (phrase rejection)", () => {
  const PLACEHOLDER_CASES: ReadonlyArray<[string, RegExp]> = [
    ["Draft answer (operator: rewrite)", /draft_answer/],
    ["Pricing is [insert price] per square foot", /insert_bracket/],
    ["Pricing TBD for new patients", /tbd/],
    ["Stub copy. Rewrite below.", /rewrite_below/],
    ["This is just a placeholder for now", /placeholder_word/],
    ["TODO: write the real title", /todo_marker/],
  ];

  it("REJECT — every placeholder pattern in proposedText (six pattern ids pinned)", () => {
    const packet = buildPacket();
    for (const [text, patternId] of PLACEHOLDER_CASES) {
      const edit = validEditTitleFixture(packet, {
        targetElement: {
          elementKey: "title[0]:hash-title",
          displayLabel: "Title tag",
          currentText: "Braces · Acme",
          proposedText: text,
        },
      });
      const r = validateSpecificEdit(edit, packet);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.field).toBe("targetElement.proposedText");
        expect(r.reason).toMatch(/placeholder pattern/);
        expect(r.reason).toMatch(patternId);
      }
    }
  });

  it("REJECT — displayLabel contains 'Draft answer'", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Draft answer label",
        currentText: "Braces · Acme",
        proposedText: "Teen Braces · Acme",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.displayLabel");
      expect(r.reason).toMatch(/placeholder pattern/);
    }
  });

  it("ACCEPT — clean copy, including placeholder-adjacent words without the exact phrase", () => {
    const packet = buildPacket();
    expect(validateSpecificEdit(validEditTitleFixture(packet), packet)).toEqual(
      { ok: true },
    );
    // "operator" and "draft" appear separately, not as the phrases.
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "Our crane operator drafts each plan carefully · Acme",
      },
    });
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });
});

describe("W3 Step 3.1 — FAQ structural quality (non-Ritz packet path)", () => {
  // The full W3 §3.8 shape gates (bundled Q+A, word floor, pairing) are
  // pinned in the "W3 §3.8 — FAQ Q+A pairing" section below on the
  // ritz-founder packet. These two pins are unique to this packet shape.

  it("ACCEPT — paired FAQ answer with specific 30+ word content passes (W3 §3.8)", () => {
    const packet = buildPacket();
    const edit = faqWithText(
      packet,
      "A typical full-gut kitchen remodel in Atherton takes twelve to sixteen weeks once permits clear: roughly three weeks for demolition and rough framing, four for cabinet and millwork installation, and five for finishes plus appliance commissioning. The schedule shifts when permits or supplier lead times slip.",
      "faq_answer[new]:abc123def456",
      "FAQ answer (new)",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("UNAFFECTED — non-FAQ edits skip the structural test; question-only FAQ copy skips it too", () => {
    const packet = buildPacket();
    // edit_title proposedText is intentionally short; FAQ rule must not fire.
    expect(validateSpecificEdit(validEditTitleFixture(packet), packet)).toEqual(
      { ok: true },
    );
    // Question-only text (no "A:" half) — structural test sees no Q+A
    // shape and skips; the "?" rule still passes.
    expect(
      validateSpecificEdit(
        faqWithText(packet, "Which option is best for my situation?"),
        packet,
      ),
    ).toEqual({ ok: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Absorbed section — Sprint 6A.2d LLM hardening
// (formerly specific-edit-validator-llm-hardening.test.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("Sprint 6A.2d — LLM hardening", () => {
  /** Fully-valid openai-sourced edit_title edit. */
  function makeLlmEdit(
    packet: SpecificEditEvidencePacket,
    overrides: Partial<SpecificEdit> = {},
  ): SpecificEdit {
    return validEditTitleFixture(packet, {
      source: "openai",
      providerName: "openai",
      model: "gpt-5-mini",
      costUsd: 0.001,
      ...overrides,
    });
  }

  describe("LLM low-confidence gate", () => {
    const ORIGINAL = process.env.BEACON_LLM_LOW_CONF;
    beforeEach(() => {
      delete process.env.BEACON_LLM_LOW_CONF;
    });
    afterEach(() => {
      restoreEnv("BEACON_LLM_LOW_CONF", ORIGINAL);
    });

    it("rejects confidence=low from openai by default (never throws)", () => {
      const packet = buildPacket();
      const edit = makeLlmEdit(packet, { confidence: "low" });
      expect(() => validateSpecificEdit(edit, packet)).not.toThrow();
      const result = validateSpecificEdit(edit, packet);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.field).toBe("confidence");
        expect(result.reason).toMatch(/BEACON_LLM_LOW_CONF/);
      }
    });


    it("accepts confidence=low from openai when BEACON_LLM_LOW_CONF=1", () => {
      process.env.BEACON_LLM_LOW_CONF = "1";
      const packet = buildPacket();
      expect(
        validateSpecificEdit(makeLlmEdit(packet, { confidence: "low" }), packet)
          .ok,
      ).toBe(true);
    });



    it("DOES NOT gate confidence=low for source=deterministic (gate is LLM-only)", () => {
      const packet = buildPacket();
      expect(
        validateSpecificEdit(
          validEditTitleFixture(packet, { confidence: "low" }),
          packet,
        ).ok,
      ).toBe(true);
    });

  });

  describe("defense-in-depth length caps", () => {
    function elementWith(
      overrides: Partial<NonNullable<SpecificEdit["targetElement"]>>,
    ): NonNullable<SpecificEdit["targetElement"]> {
      return {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "Braces · Acme · proposed",
        ...overrides,
      };
    }

    it("rejects every over-cap field with the field pinned (proposedText 2000 reason includes the cap)", () => {
      const packet = buildPacket();
      const cases: Array<[Partial<SpecificEdit>, string]> = [
        [
          { targetElement: elementWith({ proposedText: "x".repeat(2001) }) },
          "targetElement.proposedText",
        ],
        [
          { targetElement: elementWith({ currentText: "x".repeat(4001) }) },
          "targetElement.currentText",
        ],
        [
          { targetElement: elementWith({ displayLabel: "x".repeat(201) }) },
          "targetElement.displayLabel",
        ],
        [{ why: "x".repeat(501) }, "why"],
        [{ expectedImpact: "x".repeat(201) }, "expectedImpact"],
        [{ measurementPlan: "x".repeat(301) }, "measurementPlan"],
        [{ risks: ["short risk", "x".repeat(201)] }, "risks[1]"],
      ];
      for (const [overrides, field] of cases) {
        const edit = makeLlmEdit(packet, overrides);
        expect(() => validateSpecificEdit(edit, packet)).not.toThrow();
        const result = validateSpecificEdit(edit, packet);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.field).toBe(field);
          if (field === "targetElement.proposedText") {
            expect(result.reason).toMatch(/2000/);
          }
        }
      }
    });

    it("accepts a fully valid edit at ALL length boundaries (2000/4000/200/500/200/300/200)", () => {
      const packet = buildPacket();
      const edit = makeLlmEdit(packet, {
        why: "x".repeat(500),
        expectedImpact: "x".repeat(200),
        measurementPlan: "x".repeat(300),
        risks: ["x".repeat(200), "y".repeat(200)],
        targetElement: {
          elementKey: "title[0]:hash-title",
          displayLabel: "x".repeat(200),
          currentText: "x".repeat(4000),
          proposedText: "x".repeat(2000),
        },
      });
      expect(validateSpecificEdit(edit, packet).ok).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Absorbed section — Trust T4.1 abstention contract
// (formerly specific-edit-validator-abstention.test.ts)
//
// Validator-side enforcement of SYSTEM_PROMPT Rule 16.A. Four reject
// reasons, priority order A → B → C → D:
//   abstention_contract_low_confidence_no_brand_assertions
//   abstention_contract_no_grounding_signals
//   abstention_contract_single_prompt_thin_evidence
//   abstention_contract_thin_faq_answer
// ═══════════════════════════════════════════════════════════════════════════

describe("Trust T4.1 — abstention contract", () => {
  const sig = literalSignal;
  const abPacket = literalPacket;
  const abPrompt = (promptId: string): AffectedPromptBlock =>
    literalPrompt({ promptId });

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

  function blueprint(
    url = "https://comp.example.com/home-builder",
  ): SpecificEditEvidencePacket["competitorPageBlueprints"][number] {
    return {
      url,
      domain: new URL(url).hostname,
      topic: null,
      citationCount: 3,
      promptsCitedOn: ["p1"],
      pageTitle: null,
      h1: null,
      topH2s: [],
      faqQuestions: [],
      metaDescription: null,
    };
  }

  function abEditBase(
    overrides: Partial<SpecificEdit> & Pick<SpecificEdit, "targetElement">,
  ): SpecificEdit {
    return {
      actionType: "add_faq",
      targetUrl: "https://example.com/test",
      why: "operator-facing reasoning",
      expectedImpact: "anchors customer-voice copy",
      measurementPlan: "re-poll affected prompts at T+7 / T+14",
      risks: [],
      difficulty: "low",
      confidence: "medium",
      source: "openai",
      providerName: "openai",
      model: "gpt-5-mini",
      costUsd: 0.005,
      evidence: [{ type: "prompt", promptId: "p1" }],
      ...overrides,
    };
  }

  function makeFaqAnswerEdit(promptId: string): SpecificEdit {
    return abEditBase({
      targetElement: {
        elementKey: "faq_answer[new]:abc12345",
        displayLabel: "Test answer",
        currentText: null,
        proposedText:
          "Bay Area renovations typically take 6-12 months from design through final inspection, depending on scope and permits.",
      },
      evidence: [{ type: "prompt", promptId }],
    });
  }

  function makeFaqQuestionEdit(promptId: string): SpecificEdit {
    return abEditBase({
      targetElement: {
        elementKey: "faq_question[new]:abc12345",
        displayLabel: "Test question",
        currentText: null,
        proposedText: "How long does a whole-home renovation take in the Bay Area?",
      },
      evidence: [{ type: "prompt", promptId }],
    });
  }

  function makeH2Edit(promptId: string): SpecificEdit {
    return abEditBase({
      actionType: "add_h2_section",
      targetElement: {
        elementKey: "h2[new]:abc12345",
        displayLabel: "How to choose a builder for whole-home renovations",
        currentText: null,
        proposedText:
          "When evaluating builders for a whole-home renovation in the Bay Area, look for an architect-led design-build firm with documented permitting workflow and a fixed-fee preconstruction phase.",
      },
      costUsd: 0.0025,
      evidence: [{ type: "prompt", promptId }],
    });
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

  describe("checkAbstentionContract — Rule A: low confidence + no brand assertions", () => {
    it("rejects when resolution.confidence='low' AND brandAssertions empty", () => {
      const packet = abPacket({
        resolution: { confidence: "low", tier: "deterministic_only", action: { type: "create_cluster_page", clusterKind: "topic" } as never },
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
        ownedPageCandidates: [ownedPage()],
        competitorAngles: [competitorAngle()],
        brandAssertions: [],
      });
      const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
      expect(reason).toBe<AbstentionRejectReason>("abstention_contract_low_confidence_no_brand_assertions");
    });

    it("does NOT reject when resolution.confidence='low' but brandAssertions is non-empty", () => {
      const packet = abPacket({
        resolution: { confidence: "low", tier: "deterministic_only", action: { type: "create_cluster_page", clusterKind: "topic" } as never },
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
        ownedPageCandidates: [ownedPage()],
        brandAssertions: [brandAssertion()],
      });
      const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
      expect(reason).not.toBe("abstention_contract_low_confidence_no_brand_assertions");
    });

    it("does NOT reject when resolution is missing entirely (back-compat)", () => {
      const packet = abPacket({
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
        ownedPageCandidates: [ownedPage()],
        competitorAngles: [competitorAngle()],
        aiSearchSignal: sig([searchQuery()]),
      });
      expect(checkAbstentionContract(packet, makeH2Edit("p1"))).toBeNull();
    });
  });

  describe("checkAbstentionContract — Rule B: no grounding signals", () => {
    it("rejects when blueprints + topSearchQueries + brandAssertions are ALL empty", () => {
      const packet = abPacket({
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
        ownedPageCandidates: [ownedPage()],
        competitorAngles: [competitorAngle()],
        competitorPageBlueprints: [],
        aiSearchSignal: sig(),
        brandAssertions: [],
      });
      const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
      expect(reason).toBe<AbstentionRejectReason>("abstention_contract_no_grounding_signals");
    });

    it("passes when topSearchQueries has at least one item", () => {
      const packet = abPacket({
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
        ownedPageCandidates: [ownedPage()],
        aiSearchSignal: sig([searchQuery()]),
        brandAssertions: [],
        competitorPageBlueprints: [],
      });
      expect(checkAbstentionContract(packet, makeH2Edit("p1"))).toBeNull();
    });

  });

  describe("checkAbstentionContract — Rule C: single-prompt thin evidence", () => {
    it("single-prompt thin packet with NO grounding: Rule B fires first (priority A → B → C → D)", () => {
      const packet = abPacket({
        affectedPrompts: [abPrompt("p1")],
        ownedPageCandidates: [],
        competitorAngles: [],
        brandAssertions: [],
        aiSearchSignal: sig(),
      });
      const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
      expect(reason).toBe<AbstentionRejectReason>("abstention_contract_no_grounding_signals");
    });

    it("rejects single-prompt thin packet when blueprints satisfy Rule B (Rule C alone)", () => {
      const packet = abPacket({
        affectedPrompts: [abPrompt("p1")],
        ownedPageCandidates: [],
        competitorAngles: [],
        competitorPageBlueprints: [
          {
            ...blueprint("https://demattei.example.com/luxury-home-builders"),
            topic: "Luxury Home Builders",
            citationCount: 5,
            pageTitle: "Luxury Home Builders",
          },
        ],
        brandAssertions: [],
        aiSearchSignal: sig(),
      });
      const reason = checkAbstentionContract(packet, makeH2Edit("p1"));
      expect(reason).toBe<AbstentionRejectReason>("abstention_contract_single_prompt_thin_evidence");
    });

  });

  describe("checkAbstentionContract — Rule D: thin FAQ answer", () => {
    // Base fixture: one prompt, no owned page, no brand, no search query,
    // grounded through competitorAngles + a blueprint so Rule B passes.
    function ruleDPacket(
      overrides: Partial<SpecificEditEvidencePacket> = {},
    ): SpecificEditEvidencePacket {
      return abPacket({
        affectedPrompts: [abPrompt("p1")],
        ownedPageCandidates: [],
        competitorAngles: [competitorAngle()],
        competitorPageBlueprints: [blueprint()],
        brandAssertions: [],
        aiSearchSignal: sig(),
        ...overrides,
      });
    }

    it("rejects faq_answer when packet has only one prompt + no owned page + no brand + no search query", () => {
      const reason = checkAbstentionContract(ruleDPacket(), makeFaqAnswerEdit("p1"));
      expect(reason).toBe<AbstentionRejectReason>("abstention_contract_thin_faq_answer");
    });

    it("ALLOWS faq_question even when same packet would reject the answer", () => {
      expect(
        checkAbstentionContract(ruleDPacket(), makeFaqQuestionEdit("p1")),
      ).toBeNull();
    });

    it("ALLOWS faq_answer when packet has 2+ affected prompts (multi-prompt grounding)", () => {
      const packet = ruleDPacket({
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
      });
      expect(checkAbstentionContract(packet, makeFaqAnswerEdit("p1"))).toBeNull();
    });


  });

  describe("checkAbstentionContract — passing fixtures (sanity)", () => {
    it("medium confidence + owned page + competitor angle + search query: passes", () => {
      const packet = abPacket({
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
        ownedPageCandidates: [ownedPage()],
        competitorAngles: [competitorAngle()],
        brandAssertions: [],
        aiSearchSignal: sig([searchQuery()]),
      });
      expect(checkAbstentionContract(packet, makeH2Edit("p1"))).toBeNull();
    });


  });

  describe("validateAbstentionContract integration with validateSpecificEdit", () => {
    it("validateSpecificEdit fails with the abstention reason when packet violates Rule B", () => {
      const packet = abPacket({
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
        ownedPageCandidates: [ownedPage()],
        competitorAngles: [competitorAngle()],
        brandAssertions: [],
        aiSearchSignal: sig(),
        competitorPageBlueprints: [],
      });
      const r = validateSpecificEdit(makeH2Edit("p1"), packet);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.field).toBe("packet");
        expect(r.reason).toBe<AbstentionRejectReason>("abstention_contract_no_grounding_signals");
      }
    });


  });

  describe("validateSpecificEditBundle: rejected edits cannot persist (rejection reason visible)", () => {
    it("a Rule-B-violating bundle has acceptedCount=0 and every per-edit carries the abstention reason", () => {
      const packet = abPacket({
        affectedPrompts: [abPrompt("p1"), abPrompt("p2")],
        ownedPageCandidates: [ownedPage()],
        competitorAngles: [competitorAngle()],
        brandAssertions: [],
        aiSearchSignal: sig(),
        competitorPageBlueprints: [],
      });
      const bundle = makeBundle([makeH2Edit("p1"), makeFaqQuestionEdit("p1")], packet);
      const result = validateSpecificEditBundle(bundle, packet);
      expect(result.acceptedCount).toBe(0);
      expect(result.rejectedCount).toBeGreaterThan(0);
      const reasons = result.perEdit.map((p) => (p.result.ok ? null : p.result.reason));
      expect(reasons.every((r) => r != null && r.startsWith("abstention_contract_"))).toBe(true);
    });

  });

  describe("Architecture — abstention reasons are stable strings", () => {
    it("the four reject reasons have the exact operator-locked names", () => {
      // These strings appear in the operator runbook + audit script;
      // changing them is a breaking change. TS compilation pins each.
      const expected: ReadonlyArray<AbstentionRejectReason> = [
        "abstention_contract_low_confidence_no_brand_assertions",
        "abstention_contract_no_grounding_signals",
        "abstention_contract_single_prompt_thin_evidence",
        "abstention_contract_thin_faq_answer",
      ];
      for (const e of expected) {
        expect(typeof e).toBe("string");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Absorbed section — W3 §3.7 brand-claim grounding + §3.7s public-copy style
// (formerly specific-edit-validator-brand-claims.test.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("W3 §3.7 — brand-claim grounding validator", () => {
  function makePacket(
    overrides: Partial<SpecificEditEvidencePacket> = {},
  ): SpecificEditEvidencePacket {
    return literalPacket({
      clusterLabel: "Whole Home Renovation Builders",
      affectedPrompts: [literalPrompt()],
      allowedTargetUrls: ["https://example.com/services/whole-home-remodel"],
      // T4.1: seed one search query so abstention Rule B passes.
      aiSearchSignal: literalSignal([
        { query: "whole home remodel builders bay area", count: 3, promptIds: ["11111111-2222-3333-4444-555555555555"], platforms: ["chatgpt"] },
      ]),
      ...overrides,
    });
  }

  function makeH2Edit(
    proposedText: string,
    displayLabel = "Architect-led design-build advantage",
  ): SpecificEdit {
    return {
      actionType: "add_h2_section",
      targetUrl: "https://example.com/services/whole-home-remodel",
      targetElement: {
        elementKey: "h2[new]:abc12345",
        displayLabel,
        currentText: null,
        proposedText,
      },
      why: "evidence-grounded reasoning lives here, may reference any context",
      expectedImpact: "anchors the cluster intent",
      measurementPlan: "re-poll affected prompts at T+7 / T+14",
      risks: [],
      difficulty: "low",
      confidence: "medium",
      source: "openai",
      providerName: "openai",
      model: "gpt-5-mini",
      costUsd: 0.0025,
      evidence: [
        {
          type: "prompt",
          promptId: "11111111-2222-3333-4444-555555555555",
        },
      ],
    };
  }

  const RITZ_PROCESS_ASSERTION: BrandAssertion = {
    id: "ritz_process_design_build",
    phrase: "architect-led design-build",
    category: "process",
  };

  const AWARD_ASSERTION: BrandAssertion = {
    id: "ritz_award_2025",
    phrase: "2025 Americas Property Awards winner",
    category: "award",
    supportedBy: "https://propertyawards.net/winners/ritz-2025",
  };

  const POPULARITY_ASSERTION: BrandAssertion = {
    id: "ritz_popularity_houzz",
    phrase: "frequently recommended on Houzz with 50+ five-star reviews",
    category: "popularity",
    supportedBy: "https://houzz.com/ritz-builders",
  };

  const ritzPacket = (overrides: Partial<SpecificEditEvidencePacket> = {}) =>
    makePacket({
      tenantId: "tenant-ritz-founder",
      brandAssertions: [RITZ_PROCESS_ASSERTION],
      ...overrides,
    });

  describe("rejects unsupported public copy", () => {
    it("rejects each forbidden pattern in proposedText with its pattern id pinned", () => {
      const cases: Array<[string, RegExp, SpecificEditEvidencePacket]> = [
        [
          "Ritz Builders is frequently recommended for whole-home remodels.",
          /frequently_recommended/,
          makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
        ],
        [
          "Hire an award-winning, architect-led design-build firm.",
          /award_winning/,
          makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
        ],
        [
          "Ritz is the best builder for whole-home remodels in Atherton.",
          /best_in_market/,
          makePacket(),
        ],
        [
          "Ritz is the #1 design-build firm in the Bay Area.",
          /ranked_number_one/,
          makePacket(),
        ],
      ];
      for (const [copy, patternId, packet] of cases) {
        const result = validateSpecificEdit(makeH2Edit(copy), packet);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.field).toBe("targetElement.proposedText");
          expect(result.reason).toMatch(/unsupported brand claim/);
          expect(result.reason).toMatch(patternId);
        }
      }
    });


    it("rejects outcome guarantees regardless of operator assertions (permanently locked)", () => {
      const edit = makeH2Edit(
        "Ritz guarantees on-time delivery for every project.",
      );
      const result = validateSpecificEdit(
        edit,
        makePacket({
          brandAssertions: [
            RITZ_PROCESS_ASSERTION,
            AWARD_ASSERTION,
            POPULARITY_ASSERTION,
            { id: "x", phrase: "y", category: "trust" },
            { id: "z", phrase: "w", category: "ranking_first" },
            { id: "a", phrase: "b", category: "tenure" },
            { id: "c", phrase: "d", category: "client_outcome" },
          ],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/guarantee_outcome/);
      }
    });
  });

  describe("allows operator-grounded copy", () => {
    it("allows process phrasing, 'award-winning' with award assertion, 'frequently recommended' with popularity assertion", () => {
      expect(
        validateSpecificEdit(
          makeH2Edit(
            "Architect-led design-build keeps design, budget, and construction tightly coordinated, reducing schedule delays.",
          ),
          makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
        ).ok,
      ).toBe(true);
      expect(
        validateSpecificEdit(
          makeH2Edit(
            "Award-winning, architect-led design-build firm in Silicon Valley.",
          ),
          makePacket({
            brandAssertions: [RITZ_PROCESS_ASSERTION, AWARD_ASSERTION],
          }),
        ).ok,
      ).toBe(true);
      expect(
        validateSpecificEdit(
          makeH2Edit(
            "Ritz is frequently recommended for whole-home remodels in the Bay Area.",
          ),
          makePacket({
            brandAssertions: [POPULARITY_ASSERTION, RITZ_PROCESS_ASSERTION],
          }),
        ).ok,
      ).toBe(true);
    });
  });

  describe("operator-facing fields are NOT scanned", () => {
    it("forbidden phrases inside why / risks / measurementPlan are fine (operator-facing)", () => {
      const base = makeH2Edit("Architect-led design-build keeps it coordinated.");
      const packet = makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] });
      expect(
        validateSpecificEdit(
          {
            ...base,
            why: "Ritz is frequently recommended for these queries; this section anchors that signal.",
          },
          packet,
        ).ok,
      ).toBe(true);
      expect(
        validateSpecificEdit(
          {
            ...base,
            risks: [
              "Marketing team should verify whether the Americas Property Awards 2025 award-winning claim still applies before publishing.",
            ],
          },
          packet,
        ).ok,
      ).toBe(true);
      expect(
        validateSpecificEdit(
          {
            ...base,
            measurementPlan:
              "Re-poll T+14; track whether Ritz becomes the most trusted on the cluster.",
          },
          makePacket(),
        ).ok,
      ).toBe(true);
    });

  });

  describe("BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1 opts out", () => {
    const ORIGINAL = process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS;
    afterEach(() => {
      restoreEnv("BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS", ORIGINAL);
    });

    it("env=1 skips the rule; env unset keeps it armed", () => {
      const edit = makeH2Edit(
        "Ritz is frequently recommended for whole-home remodels.",
      );
      const packet = makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] });
      process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS = "1";
      expect(validateSpecificEdit(edit, packet).ok).toBe(true);
      delete process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS;
      expect(validateSpecificEdit(edit, packet).ok).toBe(false);
    });
  });

  describe("W3 §3.7s — public-copy style (em dash + brand-name first mention)", () => {
    it("rejects an em dash (—) and a free-standing en dash (–) in proposedText", () => {
      const em = validateSpecificEdit(
        makeH2Edit(
          "Ritz Builders emphasizes architect-led design-build — for example, basement scopes.",
        ),
        ritzPacket(),
      );
      expect(em.ok).toBe(false);
      if (!em.ok) {
        expect(em.field).toBe("targetElement.proposedText");
        expect(em.reason).toMatch(/em dash banned/);
      }
      const en = validateSpecificEdit(
        makeH2Edit(
          "Ritz Builders emphasizes architect-led design-build – this saves time.",
        ),
        ritzPacket(),
      );
      expect(en.ok).toBe(false);
      if (!en.ok) expect(en.reason).toMatch(/em dash banned/);
    });

    it("ALLOWS digit-bounded en dash ranges (10–15 weeks, 2024–2025)", () => {
      const result = validateSpecificEdit(
        makeH2Edit(
          "Ritz Builders emphasizes architect-led design-build. Project timelines run 10–15 weeks.",
        ),
        ritzPacket(),
      );
      expect(result.ok).toBe(true);
    });

    it("rejects bare 'Ritz' in proposedText for the canonical tenantId", () => {
      const result = validateSpecificEdit(
        makeH2Edit(
          "Ritz emphasizes architect-led design-build for whole-home remodels.",
        ),
        ritzPacket(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.field).toBe("targetElement.proposedText");
        expect(result.reason).toMatch(/brand short form 'Ritz' alone/);
      }
    });

    it("ALLOWS 'Ritz Builders' first mention and the 'Ritz Builders … Our team …' transition pattern", () => {
      expect(
        validateSpecificEdit(
          makeH2Edit(
            "Ritz Builders emphasizes an architect-led design-build approach for custom homes in Palo Alto, coordinating architectural design, engineering, permitting strategy, and construction planning from the earliest stages.",
          ),
          ritzPacket(),
        ).ok,
      ).toBe(true);
      expect(
        validateSpecificEdit(
          makeH2Edit(
            "Ritz Builders emphasizes an architect-led design-build approach for custom homes in Palo Alto. Our team coordinates architectural design, engineering, permitting strategy, and construction planning from concept through completion.",
          ),
          ritzPacket(),
        ).ok,
      ).toBe(true);
    });


    it("ALLOWS the gold-standard Palo Alto H2 (operator-approved shape)", () => {
      const proposedText =
        "Architect-designed custom homes in Palo Alto\n\n" +
        "Ritz Builders emphasizes an architect-led design-build approach for custom homes in Palo Alto, coordinating architectural design, engineering, permitting strategy, and construction planning from the earliest stages. " +
        "For complex Palo Alto sites, including deep foundations, basement scopes, strict city review, and feasibility constraints, our integrated process helps align the design vision with buildability before construction begins.";
      const edit = makeH2Edit(proposedText, "Architect-designed custom homes (Palo Alto)");
      expect(validateSpecificEdit(edit, ritzPacket()).ok).toBe(true);
    });



  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Absorbed section — W3 §3.12 leading-superlative public-copy ban
// (formerly specific-edit-validator-leading-superlative.test.ts)
//
// Operator-locked: raw fanout MAY contain "best …" (real buyer demand);
// PUBLIC generated copy must NOT lead with a self-claim superlative;
// buyer-decision angles pass; BEACON_ALLOW_LEADING_SUPERLATIVE=1 opts out;
// operator-facing fields are NOT scanned.
// ═══════════════════════════════════════════════════════════════════════════

describe("W3 §3.12 — leading-superlative public-copy ban", () => {
  const LUX_PROMPT_ID = "11111111-2222-3333-4444-555555555555";

  function makePacket(
    overrides: Partial<SpecificEditEvidencePacket> = {},
  ): SpecificEditEvidencePacket {
    return literalPacket({
      clusterLabel: "Luxury Home Builder Bay Area",
      affectedPrompts: [
        literalPrompt({
          promptId: LUX_PROMPT_ID,
          promptText:
            "What are the best luxury home builders in the Bay Area in 2023?",
          category: "outranked",
          observationCount: 12,
          brandPrimaryShare: 0.05,
          topPrimaryCompetitor: { name: "Kasten Builders", share: 0.4 },
          actualSearchQueries: ["best luxury home builders Bay Area"],
        }),
      ],
      allowedTargetUrls: ["https://example.com/luxury-home-builder-bay-area"],
      // Operator-locked rule 1: raw fanout MAY contain "best …".
      aiSearchSignal: literalSignal([
        {
          query: "best luxury home builders Bay Area 2023",
          count: 2,
          promptIds: [LUX_PROMPT_ID],
          platforms: ["chatgpt"],
        },
      ]),
      ...overrides,
    });
  }

  function makeH2Edit(
    proposedText: string,
    displayLabel = "Architect-led design-build for luxury homes",
  ): SpecificEdit {
    return {
      actionType: "add_h2_section",
      targetUrl: "https://example.com/luxury-home-builder-bay-area",
      targetElement: {
        elementKey: "h2[new]:abc12345",
        displayLabel,
        currentText: null,
        proposedText,
      },
      why: "Mirrors top fanout query 'best luxury home builders Bay Area 2023' (count=2)",
      expectedImpact: "Anchors the cluster intent to a buyer-decision angle",
      measurementPlan: "Re-poll affected prompts at T+7 / T+14",
      risks: [],
      difficulty: "low",
      confidence: "medium",
      source: "openai",
      providerName: "openai",
      model: "gpt-5-mini",
      costUsd: 0.005,
      evidence: [{ type: "prompt", promptId: LUX_PROMPT_ID }],
    };
  }

  describe("Rule 1 — raw fanout MAY contain 'best …'; operator fields may quote it", () => {
    it("packet fanout preserved verbatim AND a buyer-decision H2 still passes", () => {
      const packet = makePacket();
      expect(packet.aiSearchSignal.topSearchQueries[0].query).toBe(
        "best luxury home builders Bay Area 2023",
      );
      const safeEdit = makeH2Edit(
        "How to choose a luxury custom home builder in the Bay Area\n\nRitz Builders emphasizes an architect-led design-build approach for luxury custom homes in the Bay Area.",
      );
      expect(validateSpecificEdit(safeEdit, packet).ok).toBe(true);
    });

    it("operator-facing 'why' field may quote the raw fanout verbatim including 'best ...'", () => {
      const packet = makePacket();
      const edit = makeH2Edit(
        "How to choose a luxury custom home builder in the Bay Area\n\nRitz Builders coordinates architecture, engineering, and permitting for high-end homes.",
      );
      edit.why =
        "Mirrors raw query 'best luxury home builders Bay Area 2023' (count=2 on ChatGPT) without parroting it as a self-claim.";
      expect(validateSpecificEdit(edit, packet).ok).toBe(true);
    });
  });

  describe("Rule 2 — public copy may not lead with self-claim superlative", () => {
    it("rejects H2s leading with Best / Top / Leading / Premier / Top-rated / #1", () => {
      const leads = [
        "Best luxury custom home builders in the Bay Area",
        "Top custom home builders in the Bay Area",
        "Leading design-build firms in the Bay Area",
        "Premier custom home builder in Atherton",
        "Top-rated custom builder Bay Area",
        "#1 luxury home builder in the Bay Area",
      ];
      for (const lead of leads) {
        const result = validateSpecificEdit(
          makeH2Edit(`${lead}\n\nRitz Builders emphasizes an architect-led design-build approach for luxury custom homes.`),
          makePacket(),
        );
        expect(result.ok).toBe(false);
      }
      // Field + reason detail pinned on the §3.10 paid-run failure mode.
      const detailed = validateSpecificEdit(
        makeH2Edit(
          "Best luxury custom home builders in the Bay Area\n\nRitz Builders emphasizes an architect-led design-build approach for luxury custom homes.",
        ),
        makePacket(),
      );
      expect(detailed.ok).toBe(false);
      if (!detailed.ok) {
        expect(detailed.field).toBe("targetElement.proposedText");
        expect(detailed.reason).toMatch(/leading.*superlative|self-claim superlative/i);
        expect(detailed.reason).toMatch(/Best/);
      }
    });


  });

  describe("Rule 3 — buyer-decision angles pass", () => {
    it("'How to choose …' H2 passes", () => {
      const result = validateSpecificEdit(
        makeH2Edit(
          "How to choose a luxury custom home builder in the Bay Area\n\nRitz Builders emphasizes an architect-led design-build approach for luxury custom homes in the Bay Area. Our team coordinates architectural design, engineering, permitting strategy, and construction planning early to align design intent with site constraints and long-term buildability for high-end, site-specific estates.",
        ),
        makePacket(),
      );
      expect(result.ok).toBe(true);
    });

    it("'Modernizing older Cupertino homes …' H2 passes (the persisted Cupertino bytes)", () => {
      const packet = makePacket({
        clusterLabel: "Cupertino",
        allowedTargetUrls: [
          "https://example.com/locations/cupertino-custom-home-builder",
        ],
      });
      const edit = makeH2Edit(
        "Modernizing older Cupertino homes without expanding the footprint\n\nRitz Builders helps Cupertino homeowners modernize older homes without increasing the footprint. Our architect-led design-build approach focuses on interior reconfiguration, targeted structural and systems upgrades, improved energy performance, and permit coordination so you can achieve contemporary layouts and finishes while keeping the existing site and lot coverage.",
        "Modernize older Cupertino homes (no footprint increase)",
      );
      edit.targetUrl =
        "https://example.com/locations/cupertino-custom-home-builder";
      expect(validateSpecificEdit(edit, packet).ok).toBe(true);
    });
  });

  describe("BEACON_ALLOW_LEADING_SUPERLATIVE=1 opts out", () => {
    const ORIGINAL = process.env.BEACON_ALLOW_LEADING_SUPERLATIVE;
    afterEach(() => {
      restoreEnv("BEACON_ALLOW_LEADING_SUPERLATIVE", ORIGINAL);
    });

    it("with the env flag, 'Best …' H2 is allowed (operator override)", () => {
      process.env.BEACON_ALLOW_LEADING_SUPERLATIVE = "1";
      // Suppress the brand-claim grounder too — "Best luxury home
      // builder" trips it; we test the leading-superlative rule alone.
      const prevBrand = process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS;
      process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS = "1";
      try {
        const result = validateSpecificEdit(
          makeH2Edit(
            "Best luxury custom home builder in the Bay Area\n\nRitz Builders coordinates architecture, engineering, and permitting for high-end homes.",
          ),
          makePacket(),
        );
        expect(result.ok).toBe(true);
      } finally {
        restoreEnv("BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS", prevBrand);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Absorbed section — W3 §3.8 FAQ Q+A pairing
// (formerly specific-edit-validator-faq-pairing.test.ts)
//
// Operator-locked FAQ contract: question rows carry question-only text;
// answer rows carry answer-only text (≥ 30 words); bundle-level, every
// faq_question[new]:X must pair with faq_answer[new]:X; §3.7/§3.7s
// public-copy gates still run on answer bodies.
// ═══════════════════════════════════════════════════════════════════════════

describe("W3 §3.8 — FAQ Q+A pairing", () => {
  const FAQ_PROMPT_ID = "11111111-2222-3333-4444-555555555555";
  const FAQ_URL = "https://example.com/services/whole-home-remodel";

  function makePacket(
    overrides: Partial<SpecificEditEvidencePacket> = {},
  ): SpecificEditEvidencePacket {
    return literalPacket({
      tenantId: "tenant-ritz-founder",
      clusterLabel: "Whole Home Renovation Builders",
      affectedPrompts: [literalPrompt({ promptId: FAQ_PROMPT_ID })],
      allowedTargetUrls: [FAQ_URL],
      allowedActionTypes: ["add_faq", "rewrite_faq", "add_h2_section"],
      brandAssertions: [
        {
          id: "ritz_process",
          phrase: "architect-led design-build",
          category: "process",
        },
      ],
      ...overrides,
    });
  }

  function faqEdit(args: {
    kind: "question" | "answer";
    hash: string;
    proposedText: string;
    displayLabel?: string;
  }): SpecificEdit {
    return {
      actionType: "add_faq",
      targetUrl: FAQ_URL,
      targetElement: {
        elementKey: `faq_${args.kind}[new]:${args.hash}`,
        displayLabel:
          args.displayLabel ?? `Architect-led design-build ${args.kind}`,
        currentText: null,
        proposedText: args.proposedText,
      },
      why: "operator-facing reasoning lives here",
      expectedImpact: "anchors a real customer-voice FAQ row on the page",
      measurementPlan: "re-poll affected prompts at T+7 / T+14",
      risks: [],
      difficulty: "low",
      confidence: "medium",
      source: "openai",
      providerName: "openai",
      model: "gpt-5-mini",
      costUsd: 0.005,
      evidence: [{ type: "prompt", promptId: FAQ_PROMPT_ID }],
    };
  }

  const makeFaqQuestionEdit = (args: { hash: string; proposedText: string }) =>
    faqEdit({ kind: "question", ...args });
  const makeFaqAnswerEdit = (args: { hash: string; proposedText: string }) =>
    faqEdit({ kind: "answer", ...args });

  function makeBundle(
    edits: SpecificEdit[],
    packet: SpecificEditEvidencePacket,
  ): SpecificEditBundle {
    return {
      schemaVersion: "specific-edit-bundle/v1",
      generatedAt: "2026-05-03T00:00:00Z",
      tenantId: packet.tenantId,
      recId: packet.recId,
      evidenceHash: packet.evidenceHash,
      providerName: "openai",
      recommendations: edits,
      totalCostUsd: edits.reduce((s, e) => s + (e.costUsd ?? 0), 0),
    };
  }

  const VALID_QUESTION =
    "Which builders should I hire in Palo Alto for an architect-designed custom home?";

  const VALID_ANSWER =
    "Ritz Builders emphasizes an architect-led design-build approach for custom homes in Palo Alto, coordinating architecture, engineering, permitting, and construction from the earliest stages. Our team handles complex Palo Alto sites including deep foundations, basement scopes, and strict city review, so the design intent stays buildable from feasibility through completion.";

  describe("per-edit FAQ shape", () => {
    it("rejects bundled Q+A in a faq_question row (plain and 'Q: … A: …' formats)", () => {
      const plain = validateSpecificEdit(
        makeFaqQuestionEdit({
          hash: "abc12345",
          proposedText: `${VALID_QUESTION}\n${VALID_ANSWER}`,
        }),
        makePacket(),
      );
      expect(plain.ok).toBe(false);
      if (!plain.ok) {
        expect(plain.field).toBe("targetElement.proposedText");
        expect(plain.reason).toMatch(/contains an answer body/);
      }
      const qa = validateSpecificEdit(
        makeFaqQuestionEdit({
          hash: "abc12345",
          proposedText: `Q: ${VALID_QUESTION}\n\nA: ${VALID_ANSWER}`,
        }),
        makePacket(),
      );
      expect(qa.ok).toBe(false);
    });

    it("ALLOWS a clean question-only faq_question row", () => {
      const result = validateSpecificEdit(
        makeFaqQuestionEdit({ hash: "abc12345", proposedText: VALID_QUESTION }),
        makePacket(),
      );
      expect(result.ok).toBe(true);
    });

    it("rejects a faq_answer row that is just a bare question", () => {
      const result = validateSpecificEdit(
        makeFaqAnswerEdit({ hash: "abc12345", proposedText: VALID_QUESTION }),
        makePacket(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/contains question text instead of an answer/);
      }
    });

    it("rejects a faq_answer row under 30 words (operator floor)", () => {
      const result = validateSpecificEdit(
        makeFaqAnswerEdit({
          hash: "abc12345",
          proposedText:
            "Ritz Builders coordinates architecture, engineering, permitting, and construction. Our team handles complex Palo Alto sites and basement scopes.",
        }),
        makePacket(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/too short/);
      }
    });

  });

  describe("bundle-level FAQ pairing", () => {
    it("ACCEPTS a paired Q+A bundle (one question + one answer with shared hash)", () => {
      const packet = makePacket();
      const bundle = makeBundle(
        [
          makeFaqQuestionEdit({ hash: "shared12", proposedText: VALID_QUESTION }),
          makeFaqAnswerEdit({ hash: "shared12", proposedText: VALID_ANSWER }),
        ],
        packet,
      );
      const result = validateSpecificEditBundle(bundle, packet);
      expect(result.ok).toBe(true);
      expect(result.acceptedCount).toBe(2);
      expect(result.bundleErrors).toEqual([]);
    });

    it("REJECTS an orphan question (no matching answer hash)", () => {
      const packet = makePacket();
      const bundle = makeBundle(
        [makeFaqQuestionEdit({ hash: "orphan01", proposedText: VALID_QUESTION })],
        packet,
      );
      const result = validateSpecificEditBundle(bundle, packet);
      expect(result.ok).toBe(false);
      expect(result.bundleErrors.length).toBeGreaterThanOrEqual(1);
      expect(result.bundleErrors[0].reason).toMatch(
        /unpaired FAQ question[\s\S]*?orphan01/,
      );
      expect(result.perEdit[0].result.ok).toBe(false);
    });


    it("REJECTS duplicate questions (two faq_question rows with the same hash)", () => {
      // Both Q rows individually pass per-edit checks so the bundle-level
      // duplicate detection actually runs on them.
      const packet = makePacket();
      const bundle = makeBundle(
        [
          makeFaqQuestionEdit({ hash: "dup01", proposedText: VALID_QUESTION }),
          makeFaqQuestionEdit({
            hash: "dup01",
            proposedText:
              "Which builders specialize in architect-designed custom homes in Palo Alto?",
          }),
          makeFaqAnswerEdit({ hash: "dup01", proposedText: VALID_ANSWER }),
        ],
        packet,
      );
      const result = validateSpecificEditBundle(bundle, packet);
      expect(result.ok).toBe(false);
      expect(
        result.bundleErrors.some((e) => /duplicate FAQ question/.test(e.reason)),
      ).toBe(true);
    });


    it("per-edit-failed Q leaves matching A effectively orphaned (Cupertino regression)", () => {
      // W3 §3.8.6 Cupertino dry-run: when a FAQ question hits the
      // brand-claim gate, the matching answer must be flagged as orphan
      // (pairing skips per-edit-failed rows during bucketing).
      const packet = makePacket();
      const bundle = makeBundle(
        [
          makeFaqQuestionEdit({
            hash: "cupbest01",
            // "the best builders" trips the §3.7 brand-claim gate.
            proposedText:
              "Who are the best builders in Cupertino for modernizing an older home without changing the footprint?",
          }),
          makeFaqAnswerEdit({ hash: "cupbest01", proposedText: VALID_ANSWER }),
        ],
        packet,
      );
      const result = validateSpecificEditBundle(bundle, packet);
      expect(result.ok).toBe(false);
      expect(result.perEdit[0].result.ok).toBe(false);
      expect(result.perEdit[1].result.ok).toBe(false);
      if (!result.perEdit[1].result.ok) {
        expect(result.perEdit[1].result.reason).toMatch(/unpaired FAQ answer/);
      }
    });

    it("non-FAQ edits are unaffected by pairing checks", () => {
      const packet = makePacket();
      const bundle = makeBundle(
        [
          {
            actionType: "add_h2_section",
            targetUrl: FAQ_URL,
            targetElement: {
              elementKey: "h2[new]:abc123ff",
              displayLabel: "Architect-led design-build advantage",
              currentText: null,
              proposedText:
                "Ritz Builders emphasizes an architect-led design-build approach for whole-home remodels in the Bay Area. Our team coordinates architecture, engineering, and permitting from concept through construction.",
            },
            why: "x",
            expectedImpact: "x",
            measurementPlan: "x",
            risks: [],
            difficulty: "low",
            confidence: "medium",
            source: "openai",
            providerName: "openai",
            model: "gpt-5-mini",
            costUsd: 0.005,
            evidence: [{ type: "prompt", promptId: FAQ_PROMPT_ID }],
          },
        ],
        packet,
      );
      expect(validateSpecificEditBundle(bundle, packet).ok).toBe(true);
    });
  });

  describe("brand-grounding gates still apply to FAQ answer copy", () => {
    it("rejects 'Ritz' (short form) inside a faq_answer body (§3.7s gate on answers)", () => {
      const packet = makePacket();
      const bundle = makeBundle(
        [
          makeFaqQuestionEdit({ hash: "brand01", proposedText: VALID_QUESTION }),
          makeFaqAnswerEdit({
            hash: "brand01",
            proposedText:
              "Ritz emphasizes an architect-led design-build approach for custom homes in Palo Alto. Our team coordinates architecture, engineering, permitting, and construction across complex sites for the full life of the project.",
          }),
        ],
        packet,
      );
      const result = validateSpecificEditBundle(bundle, packet);
      expect(result.ok).toBe(false);
      expect(result.perEdit[1].result.ok).toBe(false);
      if (!result.perEdit[1].result.ok) {
        expect(result.perEdit[1].result.reason).toMatch(
          /brand short form 'Ritz' alone/,
        );
      }
    });


    it("ACCEPTS a 'Ritz Builders … Our team …' faq_answer body (gold pattern)", () => {
      const packet = makePacket();
      const bundle = makeBundle(
        [
          makeFaqQuestionEdit({ hash: "gold01", proposedText: VALID_QUESTION }),
          makeFaqAnswerEdit({ hash: "gold01", proposedText: VALID_ANSWER }),
        ],
        packet,
      );
      expect(validateSpecificEditBundle(bundle, packet).ok).toBe(true);
    });
  });
});
