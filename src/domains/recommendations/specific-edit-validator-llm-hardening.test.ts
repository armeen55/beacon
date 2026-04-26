/**
 * Sprint 6A.2d (2026-04-26) — validator LLM hardening tests.
 *
 * Pin the new defense-in-depth behaviors in
 * `validateSpecificEdit` / `validateSpecificEditBundle`:
 *
 *   - Reject `confidence="low"` from openai/anthropic unless
 *     `BEACON_LLM_LOW_CONF=1`. Deterministic + operator_edited rows
 *     are NOT affected.
 *   - Per-edit max-length checks: proposedText ≤ 2000, currentText
 *     ≤ 4000, why ≤ 500, expectedImpact ≤ 200, measurementPlan ≤ 300,
 *     each risk ≤ 200, displayLabel ≤ 200.
 *   - Validator returns ValidationFail (no throw) for all of the above
 *     so the caller can route them into the rejected list.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { validateSpecificEdit } from "./specific-edit-validator";
import type { SpecificEdit } from "./specific-edit-provider";
import { buildSpecificEditEvidencePacket } from "./specific-edit-evidence";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PageInventoryEntry } from "./page-inventory";

// ── Fixture builders (kept self-contained so these tests aren't
//    coupled to the recommended-edits-persistence test suite) ─────────────

const FROZEN_NOW = new Date("2026-04-26T12:00:00Z");
const TENANT = "tenant-test-acme";
const REC = "rec-2026-04-26-validator-1";
const URL_BRACES = "https://example.com/services/braces";

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
    updated_at: "2026-04-26T00:00:00Z",
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
    observed_at: "2026-04-26T10:00:00Z",
    source_snapshot_id: "snap",
    ...overrides,
  };
}

function makePacket(): SpecificEditEvidencePacket {
  const promptId = "prompt-1";
  return buildSpecificEditEvidencePacket({
    tenantId: TENANT,
    recId: REC,
    clusterLabel: "teen braces",
    clusterKind: "topic",
    affectedPromptIds: [promptId],
    promptOpportunities: [makeOpportunity(promptId)],
    trackedPrompts: [makePrompt(promptId, "What are the best teen braces?")],
    primarySummaries: [makeSummary(promptId)],
    ownedPageInventory: [makeInventoryEntry()],
    pageElementInventory: [makeElement({})],
    now: FROZEN_NOW,
  });
}

/**
 * Build a fully-valid edit_title edit. Lets each test override fields
 * that should fail validation to keep the per-test surface small.
 */
function makeEdit(
  packet: SpecificEditEvidencePacket,
  overrides: Partial<SpecificEdit> = {},
): SpecificEdit {
  const element = packet.targetPageElements.find(
    (e) => e.elementType === "title",
  );
  if (!element) throw new Error("test fixture: no title element in packet");
  return {
    actionType: "edit_title",
    targetUrl: element.url,
    targetElement: {
      elementKey: element.elementKey,
      displayLabel: "Title tag",
      currentText: element.elementText,
      proposedText: "Braces · Acme · proposed",
    },
    why: "Cited prompt indicates city missing in title",
    evidence: [{ type: "prompt", promptId: "prompt-1" }],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.001,
    ...overrides,
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.BEACON_LLM_LOW_CONF;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ── LLM low-confidence gate ──────────────────────────────────────────────

describe("validateSpecificEdit — LLM low-confidence gate (Sprint 6A.2d)", () => {
  it("rejects confidence=low from openai by default", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      source: "openai",
      providerName: "openai",
      confidence: "low",
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("confidence");
      expect(result.reason).toMatch(/BEACON_LLM_LOW_CONF/);
    }
  });

  it("rejects confidence=low from anthropic by default", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      source: "anthropic",
      providerName: "anthropic",
      confidence: "low",
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("confidence");
    }
  });

  it("accepts confidence=low from openai when BEACON_LLM_LOW_CONF=1", () => {
    process.env.BEACON_LLM_LOW_CONF = "1";
    const packet = makePacket();
    const edit = makeEdit(packet, {
      source: "openai",
      providerName: "openai",
      confidence: "low",
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });

  it("accepts confidence=medium from openai (default)", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, { confidence: "medium" });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });

  it("accepts confidence=high from openai (default)", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, { confidence: "high" });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });

  it("DOES NOT gate confidence=low for source=deterministic (gate is LLM-only)", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      source: "deterministic",
      providerName: "deterministic",
      model: null,
      costUsd: null,
      confidence: "low",
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });

  it("DOES NOT gate confidence=low for source=operator_edited (gate is LLM-only)", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      source: "operator_edited",
      providerName: "openai", // originator preserved per spec
      confidence: "low",
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });

  it("env value 'true' (not '1') does NOT open the gate", () => {
    process.env.BEACON_LLM_LOW_CONF = "true";
    const packet = makePacket();
    const edit = makeEdit(packet, { confidence: "low" });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
  });

  it("returns a fail object — never throws", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, { confidence: "low" });
    expect(() => validateSpecificEdit(edit, packet)).not.toThrow();
  });
});

// ── Length caps ──────────────────────────────────────────────────────────

describe("validateSpecificEdit — defense-in-depth length caps (Sprint 6A.2d)", () => {
  it("rejects proposedText > 2000 chars", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "x".repeat(2001),
      },
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("targetElement.proposedText");
      expect(result.reason).toMatch(/2000/);
    }
  });

  it("accepts proposedText exactly 2000 chars (boundary)", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "Braces · Acme",
        proposedText: "x".repeat(2000),
      },
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });

  it("rejects currentText > 4000 chars", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "Title tag",
        currentText: "x".repeat(4001),
        proposedText: "Braces · Acme · proposed",
      },
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("targetElement.currentText");
    }
  });

  it("rejects why > 500 chars", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, { why: "x".repeat(501) });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("why");
    }
  });

  it("accepts why exactly 500 chars (boundary)", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, { why: "x".repeat(500) });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });

  it("rejects expectedImpact > 200 chars", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, { expectedImpact: "x".repeat(201) });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("expectedImpact");
    }
  });

  it("rejects measurementPlan > 300 chars", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, { measurementPlan: "x".repeat(301) });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("measurementPlan");
    }
  });

  it("rejects a single risk entry > 200 chars (others may be fine)", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      risks: ["short risk", "x".repeat(201)],
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("risks[1]");
    }
  });

  it("rejects displayLabel > 200 chars", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
      targetElement: {
        elementKey: "title[0]:hash-title",
        displayLabel: "x".repeat(201),
        currentText: "Braces · Acme",
        proposedText: "Braces · Acme · proposed",
      },
    });
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("targetElement.displayLabel");
    }
  });

  it("accepts a fully valid edit at all length boundaries", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, {
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
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });

  it("returns a fail object — never throws on length violations", () => {
    const packet = makePacket();
    const edit = makeEdit(packet, { why: "x".repeat(501) });
    expect(() => validateSpecificEdit(edit, packet)).not.toThrow();
  });
});
