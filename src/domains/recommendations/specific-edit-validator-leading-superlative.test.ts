/**
 * W3 Step 3.12 (2026-05-03) — leading-superlative public-copy ban.
 *
 * Operator-locked rules (post-§3.11 query-fanout audit):
 *   1. RAW FANOUT may contain "best …" / "top …" — that's real buyer
 *      comparison-stage demand. Verified at the audit layer:
 *      `query-fanout-audit.test.ts` already pins this.
 *   2. PUBLIC GENERATED COPY (proposedText + displayLabel) MUST NOT
 *      start with a self-claim superlative — Best, Top, Leading,
 *      Premier, #1, Top-rated, Highest-rated, Most-trusted — even
 *      when the fanout query that grounded the rec contained "best …".
 *   3. A buyer-decision H2 ("How to choose …", "What to look for …",
 *      "Working with …") passes.
 *   4. Operator opt-out: BEACON_ALLOW_LEADING_SUPERLATIVE=1.
 *   5. Operator-facing fields (why, expectedImpact, measurementPlan,
 *      risks, currentText, evidence) are NOT scanned — they live on
 *      the operator side of the page and may quote raw fanout
 *      verbatim.
 */

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
} from "vitest";
import { validateSpecificEdit } from "./specific-edit-validator";
import type { SpecificEdit } from "./specific-edit-provider";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";

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
    clusterLabel: "Luxury Home Builder Bay Area",
    clusterKind: "topic",
    affectedPrompts: [
      {
        promptId: "11111111-2222-3333-4444-555555555555",
        promptText:
          "What are the best luxury home builders in the Bay Area in 2023?",
        category: "outranked",
        observationCount: 12,
        brandPrimaryShare: 0.05,
        topPrimaryCompetitor: { name: "Kasten Builders", share: 0.4 },
        descriptorsNearBrand: [],
        actualSearchQueries: ["best luxury home builders Bay Area"],
        citedSourcePages: [],
        descriptorWindows: [],
      },
    ],
    ownedPageCandidates: [],
    targetPageElements: [],
    competitorAngles: [],
    priorOutcomes: [],
    allowedTargetUrls: [
      "https://example.com/luxury-home-builder-bay-area",
    ],
    allowedActionTypes: ["add_h2_section", "add_faq", "edit_meta"],
    aiSearchSignal: {
      // Operator-locked rule 1: raw fanout MAY contain "best …".
      topSearchQueries: [
        {
          query: "best luxury home builders Bay Area 2023",
          count: 2,
          promptIds: ["11111111-2222-3333-4444-555555555555"],
          platforms: ["chatgpt"],
        },
      ],
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
    evidence: [
      { type: "prompt", promptId: "11111111-2222-3333-4444-555555555555" },
    ],
  };
}

// ── 1. RAW FANOUT may include "best" — packet stays valid ──────────────

describe("Operator-locked rule 1 — raw fanout MAY contain 'best …'", () => {
  it("packet's aiSearchSignal.topSearchQueries[0].query='best luxury home builders Bay Area 2023' is preserved verbatim", () => {
    const packet = makePacket();
    expect(packet.aiSearchSignal.topSearchQueries[0].query).toBe(
      "best luxury home builders Bay Area 2023",
    );
    // Sanity: the validator never rejects a packet for what its
    // packet-side evidence carries — only the EDIT's public-copy
    // fields. Confirm by running a buyer-decision H2 through
    // validateSpecificEdit; it should pass even though the packet
    // contains "best ..." in the fanout.
    const safeEdit = makeH2Edit(
      "How to choose a luxury custom home builder in the Bay Area\n\nRitz Builders emphasizes an architect-led design-build approach for luxury custom homes in the Bay Area.",
    );
    const result = validateSpecificEdit(safeEdit, packet);
    expect(result.ok).toBe(true);
  });

  it("operator-facing 'why' field may quote the raw fanout verbatim including 'best ...'", () => {
    const packet = makePacket();
    const edit = makeH2Edit(
      "How to choose a luxury custom home builder in the Bay Area\n\nRitz Builders coordinates architecture, engineering, and permitting for high-end homes.",
    );
    edit.why =
      "Mirrors raw query 'best luxury home builders Bay Area 2023' (count=2 on ChatGPT) without parroting it as a self-claim.";
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });
});

// ── 2. PUBLIC H2 cannot start with "Best …" / "Top …" / etc. ───────────

describe("Operator-locked rule 2 — public copy may not lead with self-claim superlative", () => {
  it("rejects H2 starting with 'Best …' (the §3.10 paid-run failure mode)", () => {
    const packet = makePacket();
    const unsafeEdit = makeH2Edit(
      "Best luxury custom home builders in the Bay Area\n\nRitz Builders emphasizes an architect-led design-build approach for luxury custom homes.",
    );
    const result = validateSpecificEdit(unsafeEdit, packet);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe("targetElement.proposedText");
    expect(result.reason).toMatch(/leading.*superlative|self-claim superlative/i);
    expect(result.reason).toMatch(/Best/);
  });

  it("rejects H2 starting with 'Top …'", () => {
    const result = validateSpecificEdit(
      makeH2Edit(
        "Top custom home builders in the Bay Area\n\nRitz Builders coordinates ...",
      ),
      makePacket(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Top/);
  });

  it("rejects H2 starting with 'Leading …' / 'Premier …'", () => {
    expect(
      validateSpecificEdit(
        makeH2Edit("Leading design-build firms in the Bay Area\n\nRitz Builders ..."),
        makePacket(),
      ).ok,
    ).toBe(false);
    expect(
      validateSpecificEdit(
        makeH2Edit("Premier custom home builder in Atherton\n\nRitz Builders ..."),
        makePacket(),
      ).ok,
    ).toBe(false);
  });

  it("rejects displayLabel starting with 'Best …' even when proposedText is safe", () => {
    const packet = makePacket();
    const unsafeEdit = makeH2Edit(
      "Working with a luxury custom home builder\n\nRitz Builders ...",
      "Best luxury custom home builders (new)",
    );
    const result = validateSpecificEdit(unsafeEdit, packet);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe("targetElement.displayLabel");
  });

  it("rejects 'Top-rated …' (hyphenated) and '#1 …'", () => {
    expect(
      validateSpecificEdit(
        makeH2Edit("Top-rated custom builder Bay Area\n\nRitz Builders ..."),
        makePacket(),
      ).ok,
    ).toBe(false);
    expect(
      validateSpecificEdit(
        makeH2Edit("#1 luxury home builder in the Bay Area\n\nRitz Builders ..."),
        makePacket(),
      ).ok,
    ).toBe(false);
  });

  it("case-insensitive: 'best ...', 'BEST ...', 'Best ...' all rejected", () => {
    for (const lead of ["best", "BEST", "Best", "BeSt"]) {
      const result = validateSpecificEdit(
        makeH2Edit(
          `${lead} luxury custom home builders in the Bay Area\n\nRitz Builders ...`,
        ),
        makePacket(),
      );
      expect(result.ok).toBe(false);
    }
  });
});

// ── 3. Buyer-decision angles pass ──────────────────────────────────────

describe("Operator-locked rule 3 — buyer-decision angles pass", () => {
  it("'How to choose …' H2 passes", () => {
    const result = validateSpecificEdit(
      makeH2Edit(
        "How to choose a luxury custom home builder in the Bay Area\n\nRitz Builders emphasizes an architect-led design-build approach for luxury custom homes in the Bay Area. Our team coordinates architectural design, engineering, permitting strategy, and construction planning early to align design intent with site constraints and long-term buildability for high-end, site-specific estates.",
      ),
      makePacket(),
    );
    expect(result.ok).toBe(true);
  });

  it("'What to look for in …' H2 passes", () => {
    const result = validateSpecificEdit(
      makeH2Edit(
        "What to look for in a luxury home builder\n\nRitz Builders evaluates feasibility and permitting on every high-end project. Our team pairs architects, engineers, and project managers to coordinate design intent and site constraints from concept through completion.",
      ),
      makePacket(),
    );
    expect(result.ok).toBe(true);
  });

  it("'Questions to ask a luxury home builder' H2 passes", () => {
    const result = validateSpecificEdit(
      makeH2Edit(
        "Questions to ask a luxury home builder\n\nRitz Builders welcomes detailed questions on permitting strategy, design coordination, and project budgeting before contract.",
      ),
      makePacket(),
    );
    expect(result.ok).toBe(true);
  });

  it("'Working with a luxury custom home builder' H2 passes", () => {
    const result = validateSpecificEdit(
      makeH2Edit(
        "Working with a luxury custom home builder in the Bay Area\n\nRitz Builders pairs architects, engineers, and project managers in-house to coordinate design and construction for high-end estates.",
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
    const result = validateSpecificEdit(edit, packet);
    expect(result.ok).toBe(true);
  });
});

// ── 4. Opt-out flag ────────────────────────────────────────────────────

describe("BEACON_ALLOW_LEADING_SUPERLATIVE=1 opts out", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.BEACON_ALLOW_LEADING_SUPERLATIVE;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.BEACON_ALLOW_LEADING_SUPERLATIVE;
    else process.env.BEACON_ALLOW_LEADING_SUPERLATIVE = original;
  });

  it("with the env flag, 'Best …' H2 is allowed (operator override)", () => {
    process.env.BEACON_ALLOW_LEADING_SUPERLATIVE = "1";
    // Suppress the brand-claim grounder too, since "Best luxury home
    // builder" trips it; we're testing the leading-superlative rule
    // in isolation.
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
      if (prevBrand === undefined)
        delete process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS;
      else process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS = prevBrand;
    }
  });
});
