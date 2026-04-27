import { describe, it, expect } from "vitest";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { PageInventoryEntry } from "./page-inventory";
import {
  buildSpecificEditEvidencePacket,
  type BuildSpecificEditEvidencePacketArgs,
  type SpecificEditEvidencePacket,
} from "./specific-edit-evidence";
import type { SpecificEdit, SpecificEditBundle } from "./specific-edit-provider";
import { deterministicProvider } from "./providers/deterministic";
import {
  isAdditiveElementKey,
  parseElementTypeFromKey,
  validateSerializable,
  validateSpecificEdit,
  validateSpecificEditBundle,
} from "./specific-edit-validator";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 10 — output validation layer.
//
// Covers per-edit validator + bundle validator + key-parsing helpers.
// Fixtures are neutral (orthodontics) so the no-Ritz-hardcoding
// invariant holds at the test layer too.
// ---------------------------------------------------------------------------

const FROZEN_NOW = new Date("2026-04-24T12:00:00Z");
const TENANT = "tenant-test";
const REC = "rec-2026-04-24-1";
const URL_BRACES = "https://example.com/services/braces";

// ── Fixture builders ───────────────────────────────────────────────────────

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
  return buildSpecificEditEvidencePacket({ ...basePacketArgs(), ...overrides });
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
      proposedText: "Why teams choose us over AcmeOrtho",
    },
    why: "Top competitor not mentioned in any H2.",
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

// ── validateSpecificEdit ──────────────────────────────────────────────────

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

  it("accepts ALL outputs of the deterministic provider (Phase 9 generators are valid by construction)", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    expect(bundle.recommendations.length).toBeGreaterThan(0);
    for (const edit of bundle.recommendations) {
      expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
    }
  });

  it("accepts a page-level lifecycle edit with targetElement=null (watch)", () => {
    const packet = buildPacket();
    // Need to allow `watch` action type — Phase 9 default allowedActionTypes
    // doesn't include it. Patch the packet:
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
    // edit_meta is a valid ACTION_TYPES member but not in the v1 allowed
    // set (generatorActive=false).
    const bad = validEditTitleFixture(packet, {
      actionType: "edit_meta",
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
    // edit_title's domain is ["title"]. Passing an h2 inventory key
    // should fail.
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

  it("rejects unparseable elementKey", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "totally-not-a-key",
        displayLabel: "x",
        currentText: "x",
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

describe("Phase 6A.1.10 — validateSpecificEdit (negative — enums + types)", () => {
  it("rejects invalid difficulty enum", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      // @ts-expect-error — testing runtime rejection
      difficulty: "epic",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("difficulty");
  });

  it("rejects invalid confidence enum", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      // @ts-expect-error — testing runtime rejection
      confidence: "very_high",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("confidence");
  });

  it("rejects invalid source enum", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      // @ts-expect-error — testing runtime rejection
      source: "vibes",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("source");
  });
});

describe("Phase 6A.1.10 — validateSpecificEdit (negative — coherence)", () => {
  it("rejects deterministic source with non-null model", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      model: "gpt-5-mini-2026-04",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("model");
  });

  it("rejects deterministic source with non-null costUsd", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, { costUsd: 0.12 });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("costUsd");
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

  it("rejects negative costUsd for openai-sourced edit", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      source: "openai",
      providerName: "openai",
      model: "gpt-5-mini",
      costUsd: -1,
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("costUsd");
  });
});

describe("Phase 6A.1.10 — validateSpecificEdit (negative — non-serializable)", () => {
  it("rejects an edit containing a Date object somewhere", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      // @ts-expect-error — testing runtime rejection
      expectedImpact: new Date(),
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
    // expectedImpact has a type-level guard before serializability, so
    // it lands on the type check field.
    if (!r.ok) expect(r.field).toBe("expectedImpact");
  });

  it("rejects an edit containing a function in why field", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      // @ts-expect-error — testing runtime rejection
      why: () => "lazy",
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
  });

  it("rejects an edit containing a Map deep inside risks", () => {
    const packet = buildPacket();
    const bad = validEditTitleFixture(packet, {
      // @ts-expect-error — testing runtime rejection
      risks: [new Map()],
    });
    const r = validateSpecificEdit(bad, packet);
    expect(r.ok).toBe(false);
  });
});

// ── Bundle validator ───────────────────────────────────────────────────────

describe("Phase 6A.1.10 — validateSpecificEditBundle", () => {
  it("accepts a deterministic provider's bundle in full", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    const result = validateSpecificEditBundle(bundle, packet);
    expect(result.ok).toBe(true);
    expect(result.bundleErrors).toEqual([]);
    expect(result.rejectedCount).toBe(0);
    expect(result.acceptedCount).toBe(bundle.recommendations.length);
  });

  it("accepts an empty-recommendations bundle", () => {
    const packet = buildPacket();
    const bundle: SpecificEditBundle = {
      schemaVersion: "specific-edit-bundle/v1",
      generatedAt: FROZEN_NOW.toISOString(),
      tenantId: packet.tenantId,
      recId: packet.recId,
      evidenceHash: packet.evidenceHash,
      providerName: "deterministic",
      recommendations: [],
      totalCostUsd: 0,
    };
    expect(validateSpecificEditBundle(bundle, packet).ok).toBe(true);
  });

  it("flags bundle.tenantId mismatch as a bundle-level error", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    const tampered = { ...bundle, tenantId: "tenant-other" };
    const result = validateSpecificEditBundle(tampered, packet);
    expect(result.ok).toBe(false);
    expect(result.bundleErrors.some((e) => e.field === "tenantId")).toBe(true);
  });

  it("flags bundle.recId mismatch", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    const tampered = { ...bundle, recId: "rec-other" };
    const result = validateSpecificEditBundle(tampered, packet);
    expect(result.ok).toBe(false);
    expect(result.bundleErrors.some((e) => e.field === "recId")).toBe(true);
  });

  it("flags bundle.evidenceHash mismatch", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    const tampered = { ...bundle, evidenceHash: "deadbeef00000000" };
    const result = validateSpecificEditBundle(tampered, packet);
    expect(result.ok).toBe(false);
    expect(
      result.bundleErrors.some((e) => e.field === "evidenceHash"),
    ).toBe(true);
  });

  it("flags negative totalCostUsd", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    const tampered = { ...bundle, totalCostUsd: -1 };
    const result = validateSpecificEditBundle(tampered, packet);
    expect(result.ok).toBe(false);
    expect(
      result.bundleErrors.some((e) => e.field === "totalCostUsd"),
    ).toBe(true);
  });

  it("aggregates rejected per-edit results into rejectedCount + accepts the rest", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    expect(bundle.recommendations.length).toBeGreaterThan(0);
    // Mutate one edit to be invalid.
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
  });
});

// ── Validator never mutates inputs ────────────────────────────────────────

describe("Phase 6A.1.10 — validator never mutates inputs", () => {
  it("validateSpecificEdit does not mutate the edit or packet", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    const beforeEdit = JSON.stringify(edit);
    const beforePacket = JSON.stringify(packet);
    validateSpecificEdit(edit, packet);
    expect(JSON.stringify(edit)).toBe(beforeEdit);
    expect(JSON.stringify(packet)).toBe(beforePacket);
  });

  it("validateSpecificEditBundle does not mutate the bundle or packet", async () => {
    const packet = buildPacket();
    const bundle = await deterministicProvider.generate(packet);
    const beforeBundle = JSON.stringify(bundle);
    const beforePacket = JSON.stringify(packet);
    validateSpecificEditBundle(bundle, packet);
    expect(JSON.stringify(bundle)).toBe(beforeBundle);
    expect(JSON.stringify(packet)).toBe(beforePacket);
  });
});
