/**
 * W3 Step 3.7 (2026-05-03) — brand-claim grounding validator tests.
 *
 * Pin the operator-locked acceptance contract for the
 * `validateBrandClaimGrounding` gate inside `validateSpecificEdit`:
 *
 *   1. Public-copy fields (proposedText + displayLabel) are scanned.
 *      Operator-facing fields (why / risks / measurementPlan /
 *      currentText / evidence refs) are NOT scanned.
 *   2. Each forbidden pattern rejects unsupported public copy with
 *      `reason="unsupported brand claim … (pattern: <id>)"`.
 *   3. A matching brand assertion in the packet UNLOCKS the
 *      otherwise-forbidden pattern.
 *   4. `guarantee_outcome` stays locked even when every assertion
 *      category is present (permanently locked).
 *   5. The `BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1` env opt-out
 *      skips the rule for operator-approved overrides.
 *   6. Synthetic prompt text inside the packet's `affectedPrompts`
 *      bypasses the validator (only LLM-generated public copy is
 *      scanned).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { validateSpecificEdit } from "./specific-edit-validator";
import type { SpecificEdit } from "./specific-edit-provider";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";
import type { BrandAssertion } from "./brand-assertions";

// ── Fixture builders ───────────────────────────────────────────────────

function makePacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  const base: SpecificEditEvidencePacket = {
    schemaVersion: "specific-edit/v1",
    generatedAt: "2026-05-03T00:00:00Z",
    tenantId: "tenant-test",
    recId: "rec-test",
    clusterId: null,
    clusterLabel: "Whole Home Renovation Builders",
    clusterKind: "topic",
    affectedPrompts: [
      {
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
      },
    ],
    ownedPageCandidates: [],
    targetPageElements: [],
    competitorAngles: [],
    priorOutcomes: [],
    allowedTargetUrls: ["https://example.com/services/whole-home-remodel"],
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
  };
  return { ...base, ...overrides };
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

// ── 1. Forbidden public copy without assertion → reject ─────────────

describe("validateBrandClaimGrounding — rejects unsupported public copy", () => {
  it("rejects 'frequently recommended' in proposedText", () => {
    const edit = makeH2Edit(
      "Ritz Builders is frequently recommended for whole-home remodels.",
    );
    const result = validateSpecificEdit(
      edit,
      makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("targetElement.proposedText");
      expect(result.reason).toMatch(/unsupported brand claim/);
      expect(result.reason).toMatch(/frequently_recommended/);
    }
  });

  it("rejects 'award-winning' when no award assertion exists", () => {
    const edit = makeH2Edit(
      "Hire an award-winning, architect-led design-build firm.",
    );
    const result = validateSpecificEdit(
      edit,
      makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/award_winning/);
    }
  });

  it("rejects 'most trusted' in displayLabel even when proposedText is clean", () => {
    const edit = makeH2Edit(
      "Architect-led design-build keeps everything coordinated.",
      "Ritz: most trusted Bay Area builder",
    );
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("targetElement.displayLabel");
      expect(result.reason).toMatch(/most_trusted/);
    }
  });

  it("rejects 'the best builder' subject-of-sentence superlative", () => {
    const edit = makeH2Edit(
      "Ritz is the best builder for whole-home remodels in Atherton.",
    );
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/best_in_market/);
    }
  });

  it("rejects '#1' superlative", () => {
    const edit = makeH2Edit(
      "Ritz is the #1 design-build firm in the Bay Area.",
    );
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/ranked_number_one/);
    }
  });

  it("rejects outcome guarantees regardless of operator assertions", () => {
    const edit = makeH2Edit(
      "Ritz guarantees on-time delivery for every project.",
    );
    const result = validateSpecificEdit(
      edit,
      // Even with EVERY category populated, guarantee_outcome stays
      // permanently locked.
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

// ── 2. Allowed copy passes ─────────────────────────────────────────

describe("validateBrandClaimGrounding — allows operator-grounded copy", () => {
  it("allows process-focused phrasing ('architect-led design-build keeps …')", () => {
    const edit = makeH2Edit(
      "Architect-led design-build keeps design, budget, and construction tightly coordinated, reducing schedule delays.",
    );
    const result = validateSpecificEdit(
      edit,
      makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows 'award-winning' when an 'award' assertion is present", () => {
    const edit = makeH2Edit(
      "Award-winning, architect-led design-build firm in Silicon Valley.",
    );
    const result = validateSpecificEdit(
      edit,
      makePacket({
        brandAssertions: [RITZ_PROCESS_ASSERTION, AWARD_ASSERTION],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows 'frequently recommended' when a 'popularity' assertion is present", () => {
    const edit = makeH2Edit(
      "Ritz is frequently recommended for whole-home remodels in the Bay Area.",
    );
    const result = validateSpecificEdit(
      edit,
      makePacket({
        brandAssertions: [POPULARITY_ASSERTION, RITZ_PROCESS_ASSERTION],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

// ── 3. Public-copy scope only ──────────────────────────────────────

describe("validateBrandClaimGrounding — operator-facing fields are NOT scanned", () => {
  it("'frequently recommended' inside `why` is fine (operator-facing)", () => {
    const edit: SpecificEdit = {
      ...makeH2Edit("Architect-led design-build keeps it coordinated."),
      why: "Ritz is frequently recommended for these queries; this section anchors that signal.",
    };
    const result = validateSpecificEdit(
      edit,
      makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
    );
    expect(result.ok).toBe(true);
  });

  it("'award-winning' inside `risks` is fine (operator-facing)", () => {
    const edit: SpecificEdit = {
      ...makeH2Edit("Architect-led design-build keeps it coordinated."),
      risks: [
        "Marketing team should verify whether the Americas Property Awards 2025 award-winning claim still applies before publishing.",
      ],
    };
    const result = validateSpecificEdit(
      edit,
      makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
    );
    expect(result.ok).toBe(true);
  });

  it("'most trusted' inside `measurementPlan` is fine (operator-facing)", () => {
    const edit: SpecificEdit = {
      ...makeH2Edit("Architect-led design-build keeps it coordinated."),
      measurementPlan:
        "Re-poll T+14; track whether Ritz becomes the most trusted on the cluster.",
    };
    const result = validateSpecificEdit(edit, makePacket());
    expect(result.ok).toBe(true);
  });

  it("packet's affectedPrompts.promptText with 'best builders' does NOT cause rejection (input data, not Beacon copy)", () => {
    // The user's tracked prompts can contain words like "best
    // builders" without making the validator reject. The validator
    // only scans the EDIT's public copy, not the packet.
    const edit = makeH2Edit(
      "Architect-led design-build keeps design, budget, and construction tightly coordinated.",
    );
    const result = validateSpecificEdit(
      edit,
      makePacket({
        affectedPrompts: [
          {
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
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

// ── 4. Env opt-out ─────────────────────────────────────────────────

describe("validateBrandClaimGrounding — BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1 opts out", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS;
  });
  afterEach(() => {
    if (original === undefined) {
      delete process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS;
    } else {
      process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS = original;
    }
  });

  it("env=1 skips the rule (operator-approved override path)", () => {
    process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS = "1";
    const edit = makeH2Edit(
      "Ritz is frequently recommended for whole-home remodels.",
    );
    const result = validateSpecificEdit(
      edit,
      makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
    );
    expect(result.ok).toBe(true);
  });

  it("env unset or env=0 keeps the rule armed", () => {
    delete process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS;
    const edit = makeH2Edit(
      "Ritz is frequently recommended for whole-home remodels.",
    );
    const result = validateSpecificEdit(
      edit,
      makePacket({ brandAssertions: [RITZ_PROCESS_ASSERTION] }),
    );
    expect(result.ok).toBe(false);
  });
});
