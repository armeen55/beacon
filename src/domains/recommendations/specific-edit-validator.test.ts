import { describe, it, expect, afterEach } from "vitest";
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
  buildCompetitorAliases,
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
      // Sprint 6A.2g.B (2026-04-26) — proposedText must NOT name a
      // competitor. The packet's primarySummaries include "AcmeOrtho",
      // so any AcmeOrtho-bearing copy would fail the new gate.
      // Differentiation goes in the why; the visible copy stays
      // generic.
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

  it("accepts ALL non-FAQ outputs of the deterministic provider with Phase-6A.2g opt-outs set (Phase 9 generators predate Rules 12/13)", async () => {
    // Sprint 6A.2g.B/C (2026-04-26) — the Phase 9 deterministic
    // generators predate the new Rule 12 (no competitor names in copy)
    // and Rule 13 (FAQ questions must end in "?"). Their outputs
    // legitimately fail the new gates. Filter FAQ rows AND set the
    // competitor-copy opt-out to assert that everything else (which
    // wasn't in scope for either rule) still validates cleanly.
    // Operator-approved scoping: the deterministic generator rewrite
    // is a separate sprint; the new gates protect LLM provider
    // outputs from day one.
    const original = process.env.BEACON_ALLOW_COMPETITOR_COPY;
    process.env.BEACON_ALLOW_COMPETITOR_COPY = "1";
    try {
      const packet = buildPacket();
      const bundle = await deterministicProvider.generate(packet);
      expect(bundle.recommendations.length).toBeGreaterThan(0);
      for (const edit of bundle.recommendations) {
        if (
          edit.actionType === "add_faq" ||
          edit.actionType === "rewrite_faq"
        ) {
          continue;
        }
        expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
      }
    } finally {
      if (original === undefined) {
        delete process.env.BEACON_ALLOW_COMPETITOR_COPY;
      } else {
        process.env.BEACON_ALLOW_COMPETITOR_COPY = original;
      }
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
    // Slice 4.5.B.α₀ (2026-05-19): `edit_meta` flipped to
    // generatorActive=true, so it's now in the default v1
    // allowedActionTypes set. Slice 4.5.E.α₁a (2026-05-21):
    // `rewrite_h2` flipped active. Use a still-inactive type
    // for the negative case — `rewrite_faq` stays
    // `generatorActive: false` until Slice 4.5.E.α₂.
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

// ── Sprint 6A.2g.C — FAQ intent rewriting ───────────────────────────────

/**
 * The packet's affected prompt is "What are the best teen braces?" —
 * already grammatical question form. The validator's stem check
 * normalizes both to "what are the best teen braces" (first 50 chars,
 * lowercased, punctuation stripped). Any FAQ proposedText whose
 * normalized prefix matches this stem is rejected unless
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

describe("Sprint 6A.2g.C — FAQ intent rewriting (validateFaqIntentRewriting)", () => {
  // Restore env after every test — the opt-out gate is process-global.
  const ORIGINAL = process.env.BEACON_ALLOW_SYNTHETIC_FAQ_COPY;
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.BEACON_ALLOW_SYNTHETIC_FAQ_COPY;
    } else {
      process.env.BEACON_ALLOW_SYNTHETIC_FAQ_COPY = ORIGINAL;
    }
  });

  it("ACCEPT — paraphrased customer-voice FAQ question on add_faq", () => {
    const packet = buildPacket();
    const edit = validAddFaqQuestionFixture(packet);
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("REJECT — proposedText does not end in '?'", () => {
    const packet = buildPacket();
    const edit = validAddFaqQuestionFixture(packet, {
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText: "How long do braces take",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.proposedText");
      expect(r.reason).toMatch(/must end with "\?"/);
    }
  });

  it("REJECT — proposedText lifts synthetic prompt stem verbatim (add_faq)", () => {
    const packet = buildPacket();
    // basePacketArgs uses prompt text "What are the best teen braces?".
    // Lifting it as the FAQ question is exactly the pattern Rule 13
    // forbids — it ends in ? but is the synthetic prompt verbatim.
    const edit = validAddFaqQuestionFixture(packet, {
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText: "What are the best teen braces?",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.proposedText");
      expect(r.reason).toMatch(/lifts synthetic prompt text verbatim/);
      expect(r.reason).toMatch(/BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1 to override/);
    }
  });

  it("REJECT — proposedText lifts synthetic prompt stem (rewrite_faq path)", () => {
    const packet = buildPacket({ allowedActionTypes: ["rewrite_faq"] });
    const edit = validAddFaqQuestionFixture(packet, {
      actionType: "rewrite_faq",
      targetElement: {
        elementKey: "faq_question[0]:hash-existing",
        displayLabel: "Existing FAQ question",
        currentText: "Old FAQ question?",
        proposedText: "What are the best teen braces options?",
      },
    });
    // rewrite_faq requires the elementKey to exist in inventory; we
    // don't have a faq_question in basePacketArgs's pageElementInventory.
    // Use the additive form instead — but rewrite_faq has
    // requiresCurrentText=true, which rejects [new] keys (rule 3c).
    // Switch to the additive add_faq path for the lift check.
    const edit2 = validAddFaqQuestionFixture(packet, {
      actionType: "add_faq",
      targetElement: {
        elementKey: "faq_question[new]:zzz",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText: "What are the best teen braces?",
      },
    });
    // basePacketArgs allowedActionTypes defaults exclude rewrite_faq, so
    // run through with add_faq + lifted prompt:
    const packet2 = buildPacket();
    const r2 = validateSpecificEdit(edit2, packet2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.reason).toMatch(/lifts synthetic prompt text verbatim/);
    }

    // Reference unused `edit` to keep the function signature audit
    // honest (no unused fixture variables).
    expect(edit.actionType).toBe("rewrite_faq");
  });

  it("ACCEPT — verbatim stem allowed when BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1 (still enforces '?')", () => {
    process.env.BEACON_ALLOW_SYNTHETIC_FAQ_COPY = "1";
    const packet = buildPacket();
    const edit = validAddFaqQuestionFixture(packet, {
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText: "What are the best teen braces?",
      },
    });
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("REJECT — opt-out is set BUT proposedText still doesn't end in '?'", () => {
    process.env.BEACON_ALLOW_SYNTHETIC_FAQ_COPY = "1";
    const packet = buildPacket();
    const edit = validAddFaqQuestionFixture(packet, {
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText: "What are the best teen braces",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/must end with "\?"/);
  });

  it("UNAFFECTED — faq_answer element bypasses the FAQ-question rule (answers don't end in '?')", () => {
    // W3 §3.8 (2026-05-03): faq_answer rows now have their own
    // word-floor gate (≥ 30 words). Provide a substantive 30+ word
    // answer so the new gate doesn't fire — the test's intent is to
    // verify the FAQ-question rule (must end with "?") doesn't fire
    // on answer rows, not to exercise the answer-length floor.
    const packet = buildPacket();
    const edit = validAddFaqQuestionFixture(packet, {
      targetElement: {
        elementKey: "faq_answer[new]:abc123def456",
        displayLabel: "FAQ answer (new)",
        currentText: null,
        proposedText:
          "Choosing the best teen braces depends on alignment goals, treatment timeline, and household budget. Most families balance aesthetics, comfort, and total cost across at least three options including traditional metal, ceramic, and clear-aligner systems before making a final selection with their orthodontist.",
      },
    });
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

  it("ACCEPT — paraphrase that prepends a question word evades the stem prefix match", () => {
    const packet = buildPacket();
    // Affected prompt: "What are the best teen braces?"
    // Normalized: "what are the best teen braces"
    // Paraphrase: "Which teen braces options are best for the visitor?"
    // Normalized: "which teen braces options are best for the visitor"
    // Different prefix → no match → accepted.
    const edit = validAddFaqQuestionFixture(packet, {
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText: "Which teen braces options are best for the visitor?",
      },
    });
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("ACCEPT — proposedText that incidentally contains the stem mid-sentence (not at start)", () => {
    const packet = buildPacket();
    // Stem appears mid-sentence — the rule only blocks PREFIX matches.
    const edit = validAddFaqQuestionFixture(packet, {
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText:
          "Cost-wise, what are the best teen braces in this market?",
      },
    });
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("REJECT — punctuation differences alone don't escape the stem check (normalize strips punctuation)", () => {
    const packet = buildPacket();
    const edit = validAddFaqQuestionFixture(packet, {
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        // Same words as the affected prompt with extra commas — the
        // normalize step strips punctuation so the stem still matches.
        proposedText: "What, are, the best teen braces?",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/lifts synthetic prompt text verbatim/);
  });

  it("ACCEPT — empty affected prompts list bypasses the stem check (graceful)", () => {
    // Edge case: rec with no affected prompts can't have its stem
    // matched. Validator must not crash.
    const packet = buildPacket({
      affectedPromptIds: [],
      promptOpportunities: [],
      trackedPrompts: [],
      primarySummaries: [],
    });
    // Build the edit inline since validAddFaqQuestionFixture references
    // packet.affectedPrompts[0].promptId, which doesn't exist here.
    const edit: SpecificEdit = {
      actionType: "add_faq",
      targetUrl: URL_BRACES,
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText: "Any well-formed customer question?",
      },
      why: "Smoke check for empty-affected-prompts edge case.",
      evidence: [{ type: "owned_page", url: URL_BRACES }],
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
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });
});

// ── Sprint 6A.2g.B — Competitor public-copy safety ──────────────────────

describe("Sprint 6A.2g.B — buildCompetitorAliases (alias generation)", () => {
  it("includes the full trimmed name first (always)", () => {
    expect(buildCompetitorAliases("De Mattei Construction")).toEqual([
      "De Mattei Construction",
      "De Mattei",
    ]);
  });

  it("strips closed-set suffixes iteratively", () => {
    expect(buildCompetitorAliases("Acme Builders Inc")).toEqual([
      "Acme Builders Inc",
      "Acme Builders",
      "Acme",
    ]);
  });

  it("does NOT strip suffixes outside the closed set (e.g., 'Solutions')", () => {
    expect(buildCompetitorAliases("Acme Solutions")).toEqual(["Acme Solutions"]);
  });

  it("does NOT split mid-name on closed-set words at non-trailing position", () => {
    // "Pacific" isn't in the closed set; stripping stops.
    expect(buildCompetitorAliases("Co Pacific")).toEqual(["Co Pacific"]);
  });

  it("skips suffix-stripped aliases shorter than 3 characters", () => {
    // "X Co" → strip "Co" → "X" (1 char) → guard kicks in, only the
    // full name is kept.
    expect(buildCompetitorAliases("X Co")).toEqual(["X Co"]);
  });

  it("ALSO works with single-suffix LLC", () => {
    // W3 §3.8.6: alias floor raised 3 → 4. Stripped "ABC" (3 chars)
    // no longer makes the cut; only the full name remains.
    expect(buildCompetitorAliases("ABC LLC")).toEqual(["ABC LLC"]);
  });

  it("ALSO works with longer base names: 'ABCD LLC' produces ['ABCD LLC', 'ABCD']", () => {
    // The stripped 4-char alias passes the new floor.
    expect(buildCompetitorAliases("ABCD LLC")).toEqual(["ABCD LLC", "ABCD"]);
  });

  it("dedupes when iterative stripping produces a duplicate (4+ char floor)", () => {
    // W3 §3.8.6: 'Foo' (3 chars) is now below the alias floor; only
    // the full name remains. Use a 4-char base to verify dedupe still
    // works on longer names.
    const a = buildCompetitorAliases("Foo Group");
    expect(a).toEqual(["Foo Group"]);
    const b = buildCompetitorAliases("Quux Group");
    expect(b).toEqual(["Quux Group", "Quux"]);
  });

  it("caps aliases at 5 per competitor", () => {
    // No realistic competitor name produces 6+ aliases with the closed
    // set, but the cap is contractual.
    const a = buildCompetitorAliases("A Builders Construction Group LLC Co");
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a[0]).toBe("A Builders Construction Group LLC Co");
  });

  it("returns empty when name is empty / whitespace / non-string", () => {
    expect(buildCompetitorAliases("")).toEqual([]);
    expect(buildCompetitorAliases("   ")).toEqual([]);
    expect(
      buildCompetitorAliases(null as unknown as string),
    ).toEqual([]);
  });

  it("includes the full name even when it would be too short for a stripped alias", () => {
    // 2-char full name — kept as the full alias regardless of length.
    expect(buildCompetitorAliases("AB")).toEqual(["AB"]);
  });

  it("case-preserving on the full name (regex check is case-insensitive at match time)", () => {
    expect(buildCompetitorAliases("de mattei construction")).toEqual([
      "de mattei construction",
      "de mattei",
    ]);
  });

  it("trims trailing period on suffix (e.g., 'Inc.')", () => {
    expect(buildCompetitorAliases("Acme Inc.")).toEqual(["Acme Inc.", "Acme"]);
  });
});

/**
 * Helper: build a packet whose competitorAngles contains the given
 * competitor name(s). Builds on basePacketArgs which already populates
 * "AcmeOrtho" via the primary summary. We can extend it.
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
  // T4.1 (2026-05-06): seed grounding so abstention contract passes;
  // these tests target competitor public-copy validator, not abstention.
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
  // Restore env after every test — opt-out gate is process-global.
  const ORIGINAL = process.env.BEACON_ALLOW_COMPETITOR_COPY;
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.BEACON_ALLOW_COMPETITOR_COPY;
    } else {
      process.env.BEACON_ALLOW_COMPETITOR_COPY = ORIGINAL;
    }
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

  it("REJECT — suffix-stripped alias appears in proposedText (e.g., 'vs De Mattei' from 'De Mattei Construction')", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why teams choose us vs De Mattei",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/De Mattei/);
      expect(r.reason).toMatch(/matched alias "De Mattei"/);
    }
  });

  it("REJECT — competitor alias appears in displayLabel", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why teams choose a board-certified design-build partner.",
      "vs De Mattei",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.displayLabel");
      expect(r.reason).toMatch(/displayLabel contains competitor name/);
    }
  });

  it("ACCEPT — proposedText with no competitor names passes", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why Bay Area homeowners choose a design-build partner.",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("REJECT — possessive form catches alias (e.g., 'De Mattei's pricing')", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "We compete on transparency and timeline beyond De Mattei's pricing model.",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/De Mattei/);
    }
  });

  it("ACCEPT — env opt-out BEACON_ALLOW_COMPETITOR_COPY=1 skips the rule entirely", () => {
    process.env.BEACON_ALLOW_COMPETITOR_COPY = "1";
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why teams choose us over De Mattei Construction",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("WORD-BOUNDARY — alias 'Reno' does NOT match 'Renovation' (no false positive)", () => {
    const packet = buildPacketWithCompetitors(["Reno"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Renovation timelines for Bay Area projects.",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("WORD-BOUNDARY — alias 'Reno' DOES match standalone 'Reno' (true positive)", () => {
    const packet = buildPacketWithCompetitors(["Reno"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "We've completed projects in Reno before.",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Reno/);
  });

  it("CLOSED SUFFIX — competitor 'Acme Solutions' does NOT generate 'Acme' alias (Solutions not in closed set)", () => {
    const packet = buildPacketWithCompetitors(["Acme Solutions"]);
    // Bare "Acme" should NOT be rejected — the full name is the only
    // alias, and the proposedText doesn't contain "Acme Solutions".
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Acme is a great word and Acme Anvils Inc is unrelated.",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("CLOSED SUFFIX — competitor 'Acme Solutions' DOES match 'Acme Solutions' verbatim in copy", () => {
    const packet = buildPacketWithCompetitors(["Acme Solutions"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Choose us over Acme Solutions for design-build expertise.",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Acme Solutions/);
  });

  it("SHORT ALIAS GUARD — competitor 'X Co' generates only ['X Co'] (not 'X')", () => {
    const packet = buildPacketWithCompetitors(["X Co"]);
    // "X" alone must not match — the bare-X alias was suppressed by
    // the MIN_COMPETITOR_ALIAS_LENGTH guard (raised 3 → 4 in W3
    // §3.8.6 to suppress short-fragment false positives like
    // "Bay Builders" → "Bay" matching "Bay Area" geo copy).
    // proposedText intentionally avoids brand-claim regex hits so
    // the competitor-alias check is the only thing under test.
    const edit = makeAddH2EditWithProposedText(
      packet,
      "X marks the spot in our design-build process.",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("SHORT ALIAS GUARD — 'Bay Builders' competitor does NOT trip on 'Bay Area' copy (W3 §3.8.6)", () => {
    // Operator-caught regression on the Luxury Home Builder Bay Area
    // dry-run: bare-"Bay" alias of "Bay Builders" matched every
    // "Bay Area" mention in legitimate geo copy. Raising the alias
    // floor from 3 → 4 chars suppresses bare "Bay". The full name
    // "Bay Builders" still matches when actually present in copy.
    const packet = buildPacketWithCompetitors(["Bay Builders"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Ritz Builders emphasizes an architect-led design-build approach for luxury custom homes in the Bay Area. Our team coordinates architecture, engineering, and permitting from concept through construction.",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("SHORT ALIAS GUARD — 'Bay Builders' STILL matches the full name in copy", () => {
    // The floor only suppresses the suffix-stripped derivative.
    // Full-name mentions still trip the gate as before.
    const packet = buildPacketWithCompetitors(["Bay Builders"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Ritz Builders emphasizes design-build, unlike Bay Builders.",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Bay Builders/);
  });

  it("NO TOKEN-LEVEL SCAN — 'De' alone does NOT match 'De Mattei Construction'", () => {
    // "De Mattei Construction" → aliases ["De Mattei Construction", "De Mattei"].
    // Neither alias matches a bare "De" in copy — we don't decompose
    // by tokens.
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "De facto, we lead the market for design-build projects.",
    );
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("CASE-INSENSITIVE — 'de mattei' lowercased in copy still matches alias 'De Mattei'", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why teams choose us over de mattei",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/De Mattei/);
  });

  it("MULTIPLE COMPETITORS — all aliases of all competitors are scanned", () => {
    const packet = buildPacketWithCompetitors([
      "De Mattei Construction",
      "Supple Homes",
    ]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why teams choose us over Supple Homes.",
    );
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Supple Homes/);
  });

  it("WHY field with competitor names is allowed (rule does NOT scan why)", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why we lead in design-build.",
    );
    // Override why to name the competitor explicitly.
    edit.why =
      "Differentiates against De Mattei Construction (3/5 prompts primary).";
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("EVIDENCE refs with competitor names are allowed (rule does NOT scan evidence)", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Why we lead in design-build.",
    );
    edit.evidence = [
      { type: "competitor", competitorName: "De Mattei Construction" },
    ];
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("PAGE-LEVEL action — null targetElement bypasses the rule (no copy to scan)", () => {
    const packet = buildPacketWithCompetitors(["De Mattei Construction"]);
    const widened: SpecificEditEvidencePacket = {
      ...packet,
      allowedActionTypes: [...packet.allowedActionTypes, "watch"],
    };
    const edit: SpecificEdit = {
      actionType: "watch",
      targetUrl: URL_BRACES,
      targetElement: null,
      why: "Watching De Mattei Construction trend.",
      evidence: [{ type: "owned_page", url: URL_BRACES }],
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

  it("EMPTY competitorAngles — rule passes trivially", () => {
    const packet = buildPacketWithCompetitors([]);
    const edit = makeAddH2EditWithProposedText(
      packet,
      "Anything is fine here, even De Mattei Construction.",
    );
    // No competitor in packet → no aliases to match → ACCEPT.
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });
});

// ── Bundle validator ───────────────────────────────────────────────────────

describe("Phase 6A.1.10 — validateSpecificEditBundle", () => {
  it("accepts a deterministic provider's bundle in full (FAQ rows filtered + competitor-copy opt-out set for Phase-9 H2 generator)", async () => {
    // Sprint 6A.2g.B/C (2026-04-26) — see the Phase-9-predates-rules
    // note on the analogous test above. This bundle-level test does
    // the same filter + opt-out so the rest of the bundle still
    // round-trips through validateSpecificEditBundle cleanly.
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
      if (original === undefined) {
        delete process.env.BEACON_ALLOW_COMPETITOR_COPY;
      } else {
        process.env.BEACON_ALLOW_COMPETITOR_COPY = original;
      }
    }
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
    // Sprint 6A.2g.B/C (2026-04-26) — start from a deterministic bundle
    // that's already filtered to non-FAQ rows + run with the
    // competitor-copy opt-out set, so the natural-rejections from the
    // Phase-9 generators don't mask the deliberate-tamper count.
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
    } finally {
      if (original === undefined) {
        delete process.env.BEACON_ALLOW_COMPETITOR_COPY;
      } else {
        process.env.BEACON_ALLOW_COMPETITOR_COPY = original;
      }
    }
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

// ── W3 Step 3.1 — placeholder + FAQ structural-quality gate ────────────────

describe("W3 Step 3.1 — validateNoPlaceholder (phrase rejection)", () => {
  it("REJECT — proposedText contains 'Draft answer'", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "Draft answer (operator: rewrite)",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.proposedText");
      expect(r.reason).toMatch(/placeholder pattern/);
      expect(r.reason).toMatch(/draft_answer/);
    }
  });

  it("REJECT — proposedText contains '[insert ...]'", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "Pricing is [insert price] per square foot",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/insert_bracket/);
  });

  it("REJECT — proposedText contains 'TBD'", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "Pricing TBD for new patients",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/tbd/);
  });

  it("REJECT — proposedText contains 'rewrite below'", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "Stub copy. Rewrite below.",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/rewrite_below/);
  });

  it("REJECT — proposedText contains 'placeholder'", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "This is just a placeholder for now",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/placeholder_word/);
  });

  it("REJECT — proposedText contains 'TODO:'", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "TODO: write the real title",
      },
    });
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/todo_marker/);
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

  it("ACCEPT — clean copy with no placeholder phrases", () => {
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("ACCEPT — copy contains placeholder-adjacent words but no exact phrase", () => {
    const packet = buildPacket();
    // "operator" and "draft" appear separately, not as the placeholder phrases.
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

describe("W3 Step 3.1 — validateNoPlaceholder (FAQ structural quality)", () => {
  // W3 §3.8 (2026-05-03): bundled `Q: …\n\nA: …` proposedText on a
  // faq_question[new] row is now operator-locked OUT — the new gate
  // rejects bundled rows BEFORE the structural-quality (parseFaqProposedText)
  // gate can run. The tests below were rewritten to use the modern
  // PAIRED FAQ shape: faq_question[new] holds question-only text,
  // faq_answer[new] holds answer-only text. The new W3 §3.8 gate's
  // word-floor / question-shape checks substitute for the old
  // structural-quality reasons (too_short / repeats_question).

  it("REJECT — bundled `Q: … \\n A: …` on a faq_question row (W3 §3.8)", () => {
    const packet = buildPacket();
    const edit: SpecificEdit = {
      actionType: "add_faq",
      targetUrl: URL_BRACES,
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        proposedText:
          "Q: How much does treatment cost in Atherton?\n\nA: Costs vary by complexity.",
      },
      why: "No FAQ section addresses cost intent.",
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
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.proposedText");
      // W3 §3.8 rejects the bundled shape with a clear actionable
      // reason; the structural-quality check no longer runs on
      // bundled rows.
      expect(r.reason).toMatch(
        /(Q:\s*\/\s*A:\s*bundled format|contains an answer body)/,
      );
    }
  });

  it("REJECT — FAQ answer row under 30 words is too short (W3 §3.8)", () => {
    const packet = buildPacket();
    const edit: SpecificEdit = {
      actionType: "add_faq",
      targetUrl: URL_BRACES,
      targetElement: {
        elementKey: "faq_answer[new]:abc123def456",
        displayLabel: "FAQ answer (new)",
        currentText: null,
        proposedText: "Costs vary by complexity and timeline.",
      },
      why: "No FAQ section addresses cost intent.",
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
    const r = validateSpecificEdit(edit, packet);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe("targetElement.proposedText");
      expect(r.reason).toMatch(/too short/);
    }
  });

  it("ACCEPT — paired FAQ answer with specific 30+ word content passes (W3 §3.8)", () => {
    const packet = buildPacket();
    const edit: SpecificEdit = {
      actionType: "add_faq",
      targetUrl: URL_BRACES,
      targetElement: {
        elementKey: "faq_answer[new]:abc123def456",
        displayLabel: "FAQ answer (new)",
        currentText: null,
        // 50+ word substantive answer that is NOT a bare question
        // and meets the W3 §3.8 word floor. Brand-name + voice rules
        // are preserved (uses third-person service-focused phrasing,
        // avoids "Ritz Builders" so the brand-name-first gate stays
        // inert under this fixture's tenant config).
        proposedText:
          "A typical full-gut kitchen remodel in Atherton takes twelve to sixteen weeks once permits clear: roughly three weeks for demolition and rough framing, four for cabinet and millwork installation, and five for finishes plus appliance commissioning. The schedule shifts when permits or supplier lead times slip.",
      },
      why: "No FAQ addresses timeline intent.",
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
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("UNAFFECTED — non-FAQ edits don't go through the structural test", () => {
    // edit_title proposedText is intentionally short; the structural
    // FAQ rule should NOT fire on titles.
    const packet = buildPacket();
    const edit = validEditTitleFixture(packet);
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });

  it("UNAFFECTED — FAQ proposedText that doesn't match Q:/A: shape skips structural test", () => {
    // If an LLM emits FAQ copy in a different shape (no "Q:" prefix),
    // the structural test silently passes. The phrase rejection still
    // runs; the existing 6A.2g.C ? + verbatim-stem rules still run.
    const packet = buildPacket();
    const edit: SpecificEdit = {
      actionType: "add_faq",
      targetUrl: URL_BRACES,
      targetElement: {
        elementKey: "faq_question[new]:abc123def456",
        displayLabel: "FAQ question (new)",
        currentText: null,
        // Just the question, no "A:" half. The 6A.2g.C rule already
        // enforces "?" so this passes; structural test sees no Q+A
        // shape and skips.
        proposedText: "Which option is best for my situation?",
      },
      why: "No FAQ addresses this intent.",
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
    expect(validateSpecificEdit(edit, packet)).toEqual({ ok: true });
  });
});
