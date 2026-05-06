/**
 * LLM-DryRun-2 (operator audit, 2026-05-05) — validator hardening.
 *
 * DryRun-1 found 7 raw prompt UUIDs in `why` text across 2 of 5 LLM
 * samples. The render-time sanitizer scrubs them at draw time, but
 * persisted DB rows would carry the leak. This bundle adds a validator
 * gate so the FUTURE bundles never persist UUID-in-why edits, even if
 * a SYSTEM_PROMPT regression re-introduces the pattern.
 *
 * Pinned contracts:
 *   • `validateSpecificEdit` rejects edits whose `why`,
 *     `expectedImpact`, or `measurementPlan` contains a UUID-shaped
 *     substring (Schema-v4 RFC 4122 8-4-4-4-12 hex with hyphens,
 *     case-insensitive).
 *   • `evidence: [{ type:"prompt", promptId: UUID }]` is the canonical
 *     home for raw IDs and is NOT scanned.
 *   • Pre-existing rules (placeholder, competitor public copy, brand-
 *     claim grounding) still pass on a clean edit.
 *   • A clean edit (no UUID anywhere in why/expectedImpact/measurementPlan,
 *     just snippet-shaped citation like "the 'best whole home remodel
 *     builders bay area' prompt") still passes.
 */

import { describe, expect, it } from "vitest";
import { validateSpecificEdit } from "./specific-edit-validator";
import type {
  SpecificEdit,
  SpecificEditEvidenceRef,
} from "./specific-edit-provider";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";

const KNOWN_UUID = "7ee3216b-327c-4de9-9efb-3a92f8a2ad11";
const TENANT = "tenant-test";

function packetWithPrompt(uuid: string = KNOWN_UUID): SpecificEditEvidencePacket {
  // Minimal packet shape — only the fields validateSpecificEdit reads.
  return {
    schemaVersion: "specific-edit/v1",
    generatedAt: "2026-05-05T00:00:00.000Z",
    tenantId: TENANT,
    recId: "rec-test",
    clusterId: null,
    clusterLabel: "Test Cluster",
    clusterKind: "topic",
    affectedPrompts: [
      {
        promptId: uuid,
        promptText: "best whole home remodel builders bay area",
        actualSearchQueries: [],
        citedSourcePages: [],
        descriptorWindows: [],
      } as unknown as SpecificEditEvidencePacket["affectedPrompts"][number],
    ],
    ownedPageCandidates: [],
    targetPageElements: [],
    competitorAngles: [],
    priorOutcomes: [],
    allowedTargetUrls: ["https://ritzbuilders.com/services/whole-home-remodel"],
    allowedActionTypes: ["add_h2_section", "add_faq", "rewrite_faq", "edit_title"],
    aiSearchSignal: {
      topSearchQueries: [],
      topDescriptors: [],
      topCompetitorCoMentions: [],
      caps: {
        maxSearchQueries: 10,
        maxDescriptors: 10,
        maxCompetitorCoMentions: 10,
      },
    },
    competitorPageBlueprints: [],
    crossTenantPatterns: [],
    brandAssertions: [],
    evidenceHash: "test_hash",
  };
}

function cleanEdit(overrides?: Partial<SpecificEdit>): SpecificEdit {
  const base: SpecificEdit = {
    actionType: "add_h2_section",
    targetUrl: "https://ritzbuilders.com/services/whole-home-remodel",
    targetElement: {
      elementKey: "h2[new]:abc12345",
      displayLabel: "Architect-led design-build H2",
      currentText: null,
      proposedText:
        "Architect-led design-build for whole home remodels in the Bay Area\n\nRitz Builders coordinates architectural design, structural engineering, permitting strategy, and construction planning under one roof. Our process focuses on early feasibility and clear milestones so design intent stays buildable as projects move from feasibility into construction.",
    },
    why:
      "Drawn from actualSearchQueries on the 'best whole home remodel builders bay area' prompt; competitor pages cite the same intent.",
    evidence: [
      { type: "prompt", promptId: KNOWN_UUID } as SpecificEditEvidenceRef,
    ],
    expectedImpact:
      "Improves relevance for whole-home-remodel queries from a Bay-Area buyer.",
    difficulty: "medium",
    confidence: "medium",
    measurementPlan:
      "Watch the 'best whole home remodel builders bay area' prompt over the next 14 days for primary-recommendation rate and citation lift.",
    risks: [],
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.012,
    ...overrides,
  };
  return base;
}

describe("LLM-DryRun-2 — validator rejects raw UUID in `why`", () => {
  it("rejects an edit whose `why` contains a raw prompt UUID", () => {
    const edit = cleanEdit({
      why: `Drawn from actualSearchQueries on prompt ${KNOWN_UUID}`,
    });
    const result = validateSpecificEdit(edit, packetWithPrompt());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("why");
      expect(result.reason).toMatch(/UUID/i);
      expect(result.reason).toMatch(/snippet/);
    }
  });

  it("rejects when UUID appears mid-sentence with surrounding context", () => {
    const edit = cleanEdit({
      why: `Top aiSearchSignal queries and the outranking prompt (${KNOWN_UUID}) show strong user interest in teardown and replacement.`,
    });
    const result = validateSpecificEdit(edit, packetWithPrompt());
    expect(result.ok).toBe(false);
  });

  it("rejects truncated UUID-with-trailing-... form (the LLM sometimes emits this)", () => {
    const edit = cleanEdit({
      why: `for prompt ${KNOWN_UUID}...`,
    });
    const result = validateSpecificEdit(edit, packetWithPrompt());
    expect(result.ok).toBe(false);
  });

  it("rejects raw UUID in `expectedImpact`", () => {
    const edit = cleanEdit({
      expectedImpact: `Lifts citation rate on prompt ${KNOWN_UUID}.`,
    });
    const result = validateSpecificEdit(edit, packetWithPrompt());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("expectedImpact");
    }
  });

  it("rejects raw UUID in `measurementPlan`", () => {
    const edit = cleanEdit({
      measurementPlan: `Watch prompt ${KNOWN_UUID} over the next 14 days.`,
    });
    const result = validateSpecificEdit(edit, packetWithPrompt());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("measurementPlan");
    }
  });

  it("ALLOWS UUID in `evidence: [{ type:'prompt', promptId: UUID }]` (canonical home)", () => {
    // This is the SHAPE the LLM is supposed to use. The full UUID
    // belongs in evidence[].promptId; only the operator-visible copy
    // fields must be UUID-free.
    const edit = cleanEdit({
      evidence: [
        { type: "prompt", promptId: KNOWN_UUID } as SpecificEditEvidenceRef,
      ],
    });
    const result = validateSpecificEdit(edit, packetWithPrompt());
    expect(result.ok).toBe(true);
  });

  it("ALLOWS a clean edit (snippet citation, no UUID anywhere in copy)", () => {
    const result = validateSpecificEdit(cleanEdit(), packetWithPrompt());
    expect(result.ok).toBe(true);
  });

  it("ALLOWS a UUID-shaped string that's NOT actually a UUID (stays UUID-free)", () => {
    // Random-looking hex that doesn't match the 8-4-4-4-12 RFC 4122 shape.
    const edit = cleanEdit({
      why: "Drawn from prompt 7ee3216b-327c-4de9-9efb (truncated identifier, not full UUID)",
    });
    const result = validateSpecificEdit(edit, packetWithPrompt());
    // The truncated form does NOT match the UUID regex (missing the
    // 12-digit suffix), so the validator MUST allow it. The operator
    // brief said: only full UUID-shaped substrings are rejected.
    expect(result.ok).toBe(true);
  });
});
