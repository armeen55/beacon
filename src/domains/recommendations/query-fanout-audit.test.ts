/**
 * W3 Step 3.11 (2026-05-03) — query-fanout-audit tests.
 *
 * Pin the operator-locked rules:
 *   - "best luxury home builders" raw query maps to a buyer-decision
 *     angle starting with "How to choose a luxury home builder".
 *   - Raw queries MAY contain "best", "top", etc. — they're real
 *     fanout. But the proposed PUBLIC copy MUST NOT start with
 *     "Best ..." / "Top ..." — the audit flags those as
 *     `unsafePhrasings`.
 *   - When `aiSearchSignal.topSearchQueries` is empty, coverage is
 *     "none" and confidence falls back to prompt-backed-only or
 *     competitor-page-backed; never "fanout-backed".
 *   - Forbidden inline modifiers ("award-winning", "top-rated", etc.)
 *     in the proposed text are flagged regardless of coverage.
 */

import { describe, expect, it } from "vitest";
import {
  buildQueryFanoutAudit,
  detectUnsafePhrasings,
  transformForbiddenQueryToBuyerAngle,
} from "./query-fanout-audit";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";
import type { SpecificEdit } from "./specific-edit-provider";

// ── Fixtures ───────────────────────────────────────────────────────────

function makeEdit(overrides: Partial<SpecificEdit> = {}): SpecificEdit {
  const base: SpecificEdit = {
    actionType: "add_h2_section",
    targetUrl: "https://ritzbuilders.com/luxury-home-builder-bay-area",
    targetElement: {
      elementKey: "h2[new]:abc12345",
      displayLabel: "H2: Luxury custom home builder (new)",
      currentText: null,
      proposedText:
        "Working with a luxury custom home builder in the Bay Area\n\nRitz Builders coordinates architecture, engineering, permitting, and construction planning for high-end custom homes in the Bay Area.",
    },
    why: "test why",
    evidence: [
      { type: "prompt", promptId: "acf7c35a-7a80-42e7-84d8-fc368c8c42d5" },
    ],
    expectedImpact: null,
    difficulty: "low",
    confidence: "medium",
    measurementPlan: null,
    risks: [],
    source: "openai",
    providerName: "openai",
    model: "gpt-5-mini",
    costUsd: 0.005,
  };
  return { ...base, ...overrides };
}

function makePacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  const base: SpecificEditEvidencePacket = {
    schemaVersion: "specific-edit/v1",
    generatedAt: "2026-05-03T00:00:00Z",
    tenantId: "tenant-ritz-founder",
    recId: "rec-test",
    clusterId: null,
    clusterLabel: "Luxury Home Builder Bay Area",
    clusterKind: "topic",
    affectedPrompts: [
      {
        promptId: "acf7c35a-7a80-42e7-84d8-fc368c8c42d5",
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
      "https://ritzbuilders.com/luxury-home-builder-bay-area",
    ],
    allowedActionTypes: ["add_h2_section", "add_faq"],
    aiSearchSignal: {
      topSearchQueries: [
        {
          query: "best luxury home builders Bay Area",
          count: 7,
          promptIds: ["acf7c35a-7a80-42e7-84d8-fc368c8c42d5"],
          platforms: ["chatgpt"],
        },
        {
          query: "top custom home builders Atherton",
          count: 4,
          promptIds: ["acf7c35a-7a80-42e7-84d8-fc368c8c42d5"],
          platforms: ["chatgpt"],
        },
        {
          query: "luxury home builder Bay Area",
          count: 2,
          promptIds: ["acf7c35a-7a80-42e7-84d8-fc368c8c42d5"],
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
    evidenceHash: "deadbeefcafebabe",
  };
  return { ...base, ...overrides };
}

// ── Operator-locked rule 1: "best ..." raw → "How to choose a ..." ─────

describe("transformForbiddenQueryToBuyerAngle", () => {
  it("'best luxury home builders' maps to 'How to choose a luxury home builder'", () => {
    const t = transformForbiddenQueryToBuyerAngle("best luxury home builders");
    expect(t).not.toBeNull();
    expect(t!.publicCopyPhrase).toBe(
      "How to choose a luxury home builder",
    );
    expect(t!.rawPhrase).toBe("best luxury home builders");
    expect(t!.reason).toMatch(/strips the "best" superlative/i);
  });

  it("lifts known geos ('Bay Area') into 'in the {Geo}' suffix", () => {
    const t = transformForbiddenQueryToBuyerAngle(
      "best luxury home builders Bay Area",
    );
    expect(t).not.toBeNull();
    expect(t!.publicCopyPhrase).toBe(
      "How to choose a luxury home builder in the Bay Area",
    );
  });

  it("strips trailing year tokens ('2023')", () => {
    const t = transformForbiddenQueryToBuyerAngle(
      "best luxury home builders Bay Area 2023",
    );
    expect(t).not.toBeNull();
    expect(t!.publicCopyPhrase).toBe(
      "How to choose a luxury home builder in the Bay Area",
    );
  });

  it("handles 'top' as well as 'best', cities use 'in {Geo}' not 'in the {Geo}'", () => {
    const t = transformForbiddenQueryToBuyerAngle(
      "top custom home builders Atherton",
    );
    expect(t).not.toBeNull();
    expect(t!.publicCopyPhrase).toBe(
      "How to choose a custom home builder in Atherton",
    );
  });

  it("city geos do not take 'the' article ('Cupertino' not 'the Cupertino')", () => {
    const t = transformForbiddenQueryToBuyerAngle(
      "best home renovation builders Cupertino",
    );
    expect(t).not.toBeNull();
    expect(t!.publicCopyPhrase).toBe(
      "How to choose a home renovation builder in Cupertino",
    );
  });

  it("returns null when the query has no forbidden modifier", () => {
    expect(
      transformForbiddenQueryToBuyerAngle("luxury home builders Bay Area"),
    ).toBeNull();
    expect(
      transformForbiddenQueryToBuyerAngle("custom home renovation cost Cupertino"),
    ).toBeNull();
  });

  it("handles articles ('the best ...', 'a top ...')", () => {
    const t1 = transformForbiddenQueryToBuyerAngle(
      "the best luxury home builders",
    );
    expect(t1!.publicCopyPhrase).toBe("How to choose a luxury home builder");
    const t2 = transformForbiddenQueryToBuyerAngle("a top custom home builder");
    expect(t2!.publicCopyPhrase).toBe("How to choose a custom home builder");
  });

  it("returns null for empty / whitespace input", () => {
    expect(transformForbiddenQueryToBuyerAngle("")).toBeNull();
    expect(transformForbiddenQueryToBuyerAngle("   ")).toBeNull();
  });
});

// ── Operator-locked rule 2: public copy may not start with "Best..." ───

describe("detectUnsafePhrasings", () => {
  it("flags H2 starting with 'Best ...'", () => {
    const hits = detectUnsafePhrasings(
      "Best luxury custom home builders in the Bay Area\n\nRitz Builders ...",
    );
    expect(hits).toContain("starts with 'Best ...'");
  });

  it("flags H2 starting with 'Top ...' / 'Leading ...'", () => {
    expect(detectUnsafePhrasings("Top custom home builders ...")).toContain(
      "starts with 'Top ...'",
    );
    expect(detectUnsafePhrasings("Leading design-build firms ...")).toContain(
      "starts with 'Leading ...'",
    );
  });

  it("flags inline 'award-winning' / 'top-rated' / etc.", () => {
    const hits = detectUnsafePhrasings(
      "Ritz Builders is an award-winning, top-rated custom home builder.",
    );
    expect(hits).toContain("'award-winning'");
    expect(hits).toContain("'top-rated'");
  });

  it("flags 'frequently recommended' / 'most trusted' / 'most popular'", () => {
    expect(
      detectUnsafePhrasings("Ritz is frequently recommended in the Bay Area"),
    ).toContain("'frequently recommended'");
    expect(detectUnsafePhrasings("Ritz is the most trusted ...")).toContain(
      "'most trusted'",
    );
    expect(detectUnsafePhrasings("Ritz is the most popular ...")).toContain(
      "'most popular'",
    );
  });

  it("flags subject-of-sentence 'best builder/firm/etc.'", () => {
    expect(
      detectUnsafePhrasings(
        "Ritz Builders is one of the best home builders in the Bay Area.",
      ),
    ).toContain("subject 'best builder/firm/etc.'");
  });

  it("returns empty array on safe public copy", () => {
    const hits = detectUnsafePhrasings(
      "Working with a luxury custom home builder in the Bay Area\n\nRitz Builders coordinates architecture, engineering, and permitting for high-end homes.",
    );
    expect(hits).toEqual([]);
  });

  it("returns empty array on empty / non-string input", () => {
    expect(detectUnsafePhrasings("")).toEqual([]);
    expect(detectUnsafePhrasings(undefined as unknown as string)).toEqual([]);
  });

  it("de-dupes hits", () => {
    const hits = detectUnsafePhrasings(
      "award-winning award-winning award-winning",
    );
    expect(hits.filter((h) => h === "'award-winning'")).toHaveLength(1);
  });
});

// ── Full audit shape + coverage gates ──────────────────────────────────

describe("buildQueryFanoutAudit", () => {
  it("rich coverage (≥3 fanout queries) produces fanout-backed confidence", () => {
    const audit = buildQueryFanoutAudit(makePacket(), makeEdit());
    expect(audit.queryFanoutCoverage).toBe("rich");
    expect(audit.confidence).toBe("fanout-backed");
    expect(audit.rawQueries.length).toBe(3);
    // First raw query is "best ..." — surfaces a transformed term.
    expect(audit.transformedTerms.length).toBeGreaterThanOrEqual(2);
    expect(audit.transformedTerms[0].rawPhrase).toBe(
      "best luxury home builders Bay Area",
    );
    expect(audit.transformedTerms[0].publicCopyPhrase).toBe(
      "How to choose a luxury home builder in the Bay Area",
    );
  });

  it("partial coverage (1–2 fanout queries) still confidence=fanout-backed", () => {
    const packet = makePacket({
      aiSearchSignal: {
        topSearchQueries: [
          {
            query: "luxury home builder Bay Area",
            count: 1,
            promptIds: ["acf7c35a-7a80-42e7-84d8-fc368c8c42d5"],
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
    });
    const audit = buildQueryFanoutAudit(packet, makeEdit());
    expect(audit.queryFanoutCoverage).toBe("partial");
    expect(audit.confidence).toBe("fanout-backed");
  });

  it("no fanout reports queryFanoutCoverage=none, never invents queries", () => {
    const packet = makePacket({
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
    });
    const audit = buildQueryFanoutAudit(packet, makeEdit());
    expect(audit.queryFanoutCoverage).toBe("none");
    expect(audit.rawQueries).toEqual([]);
    expect(audit.transformedTerms).toEqual([]);
    expect(audit.confidence).toBe("prompt-backed only");
    expect(audit.normalizedIntent).toMatch(/Prompt-only intent/);
  });

  it("no fanout + no prompts + no competitor blueprints = thin evidence", () => {
    const packet = makePacket({
      affectedPrompts: [],
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
    });
    const audit = buildQueryFanoutAudit(packet, makeEdit());
    expect(audit.confidence).toBe("thin evidence");
    expect(audit.recommendedSafeAngle).toMatch(/abstain/i);
    expect(audit.normalizedIntent).toMatch(/abstain/i);
  });

  it("competitor blueprints present (no fanout, no prompt) = competitor-page-backed", () => {
    const packet = makePacket({
      affectedPrompts: [],
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
      competitorPageBlueprints: [
        {
          url: "https://kastenbuilders.com/luxury-bay-area",
          domain: "kastenbuilders.com",
          topic: "Luxury Home Builders Bay Area",
          citationCount: 5,
          promptsCitedOn: ["acf7c35a-7a80-42e7-84d8-fc368c8c42d5"],
          pageTitle: "Luxury Home Builders Bay Area | Kasten Builders",
          h1: null,
          topH2s: [],
          faqQuestions: [],
          metaDescription: null,
        },
      ],
    });
    const audit = buildQueryFanoutAudit(packet, makeEdit());
    expect(audit.confidence).toBe("competitor-page-backed");
    expect(audit.evidenceSourcesUsed).toContain("competitor_page_blueprint");
  });

  it("flags unsafe public-copy 'Best ...' H2 even when fanout coverage is rich", () => {
    const unsafeEdit = makeEdit({
      targetElement: {
        elementKey: "h2[new]:bb12cc34",
        displayLabel: "H2: Best luxury custom home builders (new)",
        currentText: null,
        proposedText:
          "Best luxury custom home builders in the Bay Area\n\nRitz Builders emphasizes an architect-led design-build approach for luxury custom homes.",
      },
    });
    const audit = buildQueryFanoutAudit(makePacket(), unsafeEdit);
    expect(audit.unsafePhrasings).toContain("starts with 'Best ...'");
    // Coverage is rich; the unsafe phrasing is independent of coverage.
    expect(audit.queryFanoutCoverage).toBe("rich");
  });

  it("no unsafe phrasings on a clean buyer-decision H2", () => {
    const audit = buildQueryFanoutAudit(makePacket(), makeEdit());
    expect(audit.unsafePhrasings).toEqual([]);
  });

  it("evidenceSourcesUsed reflects packet blocks + edit refs (stable order)", () => {
    const packet = makePacket({
      targetPageElements: [
        {
          url: "https://ritzbuilders.com/luxury-home-builder-bay-area",
          elementKey: "h2[0]:f07dfb74c383",
          elementType: "h2",
          displayLabel: "Architect-led design-build for luxury homes",
          elementText: "Architect-led design-build for luxury homes",
          elementMetadata: {},
        },
      ],
      competitorPageBlueprints: [
        {
          url: "https://kastenbuilders.com/luxury-bay-area",
          domain: "kastenbuilders.com",
          topic: "Luxury Home Builders Bay Area",
          citationCount: 5,
          promptsCitedOn: ["acf7c35a-7a80-42e7-84d8-fc368c8c42d5"],
          pageTitle: null,
          h1: null,
          topH2s: [],
          faqQuestions: [],
          metaDescription: null,
        },
      ],
    });
    const audit = buildQueryFanoutAudit(packet, makeEdit());
    expect(audit.evidenceSourcesUsed).toEqual([
      "query_fanout",
      "prompt_text",
      "competitor_page_blueprint",
      "citation_evidence",
      "site_inventory",
    ]);
  });

  it("recommendedSafeAngle echoes the first transformed term when forbidden queries exist", () => {
    const audit = buildQueryFanoutAudit(makePacket(), makeEdit());
    expect(audit.recommendedSafeAngle).toBe(
      "How to choose a luxury home builder in the Bay Area",
    );
  });

  it("recommendedSafeAngle mirrors top fanout query when no forbidden modifiers present", () => {
    const packet = makePacket({
      aiSearchSignal: {
        topSearchQueries: [
          {
            query: "luxury home builder Bay Area",
            count: 5,
            promptIds: ["acf7c35a-7a80-42e7-84d8-fc368c8c42d5"],
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
    });
    const audit = buildQueryFanoutAudit(packet, makeEdit());
    expect(audit.recommendedSafeAngle).toMatch(
      /Mirror top fanout phrasing.*luxury home builder Bay Area/,
    );
  });

  it("proposedEdit summary captures the audit-relevant fields", () => {
    const audit = buildQueryFanoutAudit(makePacket(), makeEdit());
    expect(audit.proposedEdit.actionType).toBe("add_h2_section");
    expect(audit.proposedEdit.targetUrl).toBe(
      "https://ritzbuilders.com/luxury-home-builder-bay-area",
    );
    expect(audit.proposedEdit.elementKey).toBe("h2[new]:abc12345");
  });

  it("page-level edit (no targetElement) is handled cleanly", () => {
    const pageLevelEdit = makeEdit({
      actionType: "create_page",
      targetElement: null,
    });
    const audit = buildQueryFanoutAudit(makePacket(), pageLevelEdit);
    expect(audit.proposedEdit.elementKey).toBe("(page-level)");
    expect(audit.proposedEdit.proposedText).toBe("");
    expect(audit.unsafePhrasings).toEqual([]);
  });
});
