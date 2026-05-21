/**
 * Slice 4.5.E.α₁b₁ (2026-05-21) — thin packet builder unit tests.
 *
 * Pure-function coverage. No mocks, no I/O. Verifies:
 *   • 8 fail-loud preconditions throw with the stable `[build-thin-
 *     packet]` prefix.
 *   • Happy-path returns a structurally valid
 *     `SpecificEditEvidencePacket` with locked field assignments
 *     (resolution: null · affectedPrompts: [] · allowedTargetUrls /
 *     allowedActionTypes single-entry · targetPageElements
 *     synthesized · recId preview-prefixed · evidenceHash
 *     deterministic).
 *   • Empty `brandAssertions` does NOT throw — the validator handles
 *     the empty-grounding case downstream via the abstention
 *     contract.
 *   • Lowest-index selection when operator_evidence carries multiple
 *     `h2[<n>]=` tokens.
 *   • Determinism — same inputs produce the same evidenceHash;
 *     changing the H2 text flips the hash.
 *
 * 18 test cases total.
 */

import { describe, it, expect } from "vitest";

import type { BusinessConfig } from "@/lib/business-config";
import type { PageSnapshot } from "@/domains/pages/types";
import type { BrandAssertion } from "@/domains/recommendations/specific-edit-evidence";

import { buildThinPacketForCandidate } from "@/domains/recommendation-intelligence/build-thin-packet";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-05-21T12:00:00.000Z");

function makeBusinessConfig(): BusinessConfig {
  // Cast through `unknown` — the builder accepts the type but does
  // not read any field. Tests only need the slot filled.
  return {
    name: "Test Co",
    domain: "test.example",
  } as unknown as BusinessConfig;
}

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://test.example/services/kitchen",
    canonical_url: null,
    fetched_at: "2026-05-21T11:00:00.000Z",
    http_status: 200,
    title: "Kitchen Remodeling",
    meta_description: null,
    h1: "Kitchen Remodeling",
    h2_list: ["Why Choose Us", "Our Process"],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "h",
    faq_hash: "h",
    schema_hash: "h",
    tenant_id: "tenant-a",
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<RecommendationCandidateRow> = {},
): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-a",
    trigger_signal: "weak_h2",
    action_type: "rewrite_h2",
    generator_kind: "llm_assisted",
    target_url: "https://test.example/services/kitchen",
    topic_cluster_label: "H2 heading",
    evidence: [
      {
        kind: "page_snapshot",
        ref: "https://test.example/services/kitchen",
        detail: "h2 on service page lacks any service term (1 weak h2)",
      },
    ],
    confidence: "low",
    impact_estimate: "medium",
    customer_copy: "Beacon flagged an H2 that may be too generic.",
    operator_evidence:
      'page_type=service; missing_dimension=service; weak_h2_count=1; h2[0]="Why Choose Us"',
    dedupe_key: "abcdef0123456789abcdef0123456789",
    cooldown_key: "fedcba9876543210fedcba9876543210",
    created_from_signal_at: "2026-05-21T11:00:00.000Z",
    safety_flags: [],
    ...overrides,
  };
}

function makeBrandAssertions(): BrandAssertion[] {
  return [
    {
      id: "ba-1",
      phrase: "architect-led design-build",
      category: "positioning",
    },
  ];
}

// ---------------------------------------------------------------------------
// Preconditions (8) — each throws with [build-thin-packet] prefix
// ---------------------------------------------------------------------------

describe("build-thin-packet — fail-loud preconditions", () => {
  it("1. throws when candidate.target_url is null", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate({ target_url: null }),
        pageSnapshot: makeSnapshot(),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] candidate\.target_url/);
  });

  it("1b. throws when candidate.target_url is empty string", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate({ target_url: "" }),
        pageSnapshot: makeSnapshot(),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] candidate\.target_url/);
  });

  it("1c. throws when candidate.target_url is the needs_new_page sentinel", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate({ target_url: "needs_new_page" }),
        pageSnapshot: makeSnapshot(),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] candidate\.target_url/);
  });

  it("2. throws when candidate.action_type is not rewrite_h2", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate({ action_type: "edit_title" }),
        pageSnapshot: makeSnapshot(),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] only action_type "rewrite_h2"/);
  });

  it("3. throws when candidate.tenant_id is empty", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate({ tenant_id: "" }),
        pageSnapshot: makeSnapshot(),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] candidate\.tenant_id must be non-empty/);
  });

  it("4. throws when pageSnapshot.url does not match candidate.target_url", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate(),
        pageSnapshot: makeSnapshot({ url: "https://other.example/x" }),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] pageSnapshot\.url/);
  });

  it("5. throws when pageSnapshot.h2_list is empty", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate(),
        pageSnapshot: makeSnapshot({ h2_list: [] }),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] pageSnapshot\.h2_list must be non-empty/);
  });

  it("6. throws when operator_evidence has no h2[<n>]= token", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate({
          operator_evidence: "page_type=service; missing_dimension=service",
        }),
        pageSnapshot: makeSnapshot(),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] candidate\.operator_evidence missing/);
  });

  it("7. throws when parsed h2 index is out of range", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate({
          operator_evidence: 'h2[5]="Way Off"',
        }),
        pageSnapshot: makeSnapshot({ h2_list: ["a", "b"] }),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] parsed h2 index 5 out of range/);
  });

  it("8. throws when H2 text at the parsed index is blank", () => {
    expect(() =>
      buildThinPacketForCandidate({
        candidate: makeCandidate({ operator_evidence: 'h2[0]=""' }),
        pageSnapshot: makeSnapshot({ h2_list: ["   ", "Real H2"] }),
        businessConfig: makeBusinessConfig(),
        brandAssertions: makeBrandAssertions(),
        now: FIXED_NOW,
      }),
    ).toThrow(/\[build-thin-packet\] pageSnapshot\.h2_list\[0\] is blank/);
  });
});

// ---------------------------------------------------------------------------
// Happy path + locked field assignments (10 cases)
// ---------------------------------------------------------------------------

describe("build-thin-packet — happy path + locked fields", () => {
  it("returns a packet with schemaVersion: specific-edit/v1", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.schemaVersion).toBe("specific-edit/v1");
  });

  it("resolution is null (bypasses abstention Rule A)", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.resolution).toBeNull();
  });

  it("affectedPrompts is empty (bypasses abstention Rule C)", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.affectedPrompts).toEqual([]);
  });

  it("allowedTargetUrls is [candidate.target_url] and allowedActionTypes is [rewrite_h2]", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.allowedTargetUrls).toEqual([
      "https://test.example/services/kitchen",
    ]);
    expect(packet.allowedActionTypes).toEqual(["rewrite_h2"]);
  });

  it("targetPageElements synthesizes one h2 block from h2_list[lowestIndex]", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.targetPageElements).toHaveLength(1);
    const el = packet.targetPageElements[0]!;
    expect(el.url).toBe("https://test.example/services/kitchen");
    expect(el.elementType).toBe("h2");
    expect(el.displayLabel).toBe("H2 #1");
    expect(el.elementText).toBe("Why Choose Us");
    expect(el.elementKey).toMatch(/^h2\[0\]:[0-9a-f]{12}$/);
    expect(el.elementMetadata).toEqual({});
  });

  it("recId is preview-prefixed with the first 16 chars of dedupe_key", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate({
        dedupe_key: "abcdef0123456789ZZZ_truncated_tail",
      }),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.recId).toBe("preview-abcdef0123456789");
  });

  it("brandAssertions passes through with empty array allowed (no throw)", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: [],
      now: FIXED_NOW,
    });
    expect(packet.brandAssertions).toEqual([]);
  });

  it("non-empty brandAssertions passes through verbatim", () => {
    const ba = makeBrandAssertions();
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: ba,
      now: FIXED_NOW,
    });
    expect(packet.brandAssertions).toEqual(ba);
  });

  it("all empty-block fields populate to empty arrays / zero-cap signal block", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.ownedPageCandidates).toEqual([]);
    expect(packet.competitorAngles).toEqual([]);
    expect(packet.priorOutcomes).toEqual([]);
    expect(packet.competitorPageBlueprints).toEqual([]);
    expect(packet.crossTenantPatterns).toEqual([]);
    expect(packet.aiSearchSignal).toEqual({
      topSearchQueries: [],
      topDescriptors: [],
      topCompetitorCoMentions: [],
      caps: {
        maxSearchQueries: 0,
        maxDescriptors: 0,
        maxCompetitorCoMentions: 0,
      },
    });
  });

  it("clusterId / clusterLabel / clusterKind all null", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.clusterId).toBeNull();
    expect(packet.clusterLabel).toBeNull();
    expect(packet.clusterKind).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lowest-index selection (2 cases) + determinism (3 cases)
// ---------------------------------------------------------------------------

describe("build-thin-packet — lowest-index selection", () => {
  it("picks the lowest h2 index when operator_evidence has multiple tokens", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate({
        operator_evidence: 'h2[2]="Last" | h2[0]="First" | h2[1]="Middle"',
      }),
      pageSnapshot: makeSnapshot({
        h2_list: ["First H2", "Middle H2", "Last H2"],
      }),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.targetPageElements[0]!.elementText).toBe("First H2");
    expect(packet.targetPageElements[0]!.displayLabel).toBe("H2 #1");
  });

  it("picks the only index when operator_evidence has one token", () => {
    const packet = buildThinPacketForCandidate({
      candidate: makeCandidate({
        operator_evidence: 'weak_h2_count=1; h2[1]="Only Weak One"',
      }),
      pageSnapshot: makeSnapshot({
        h2_list: ["Strong H2", "Weak H2 Text"],
      }),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(packet.targetPageElements[0]!.elementText).toBe("Weak H2 Text");
    expect(packet.targetPageElements[0]!.displayLabel).toBe("H2 #2");
  });
});

describe("build-thin-packet — determinism", () => {
  it("same inputs produce the same evidenceHash", () => {
    const a = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    const b = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(a.evidenceHash).toBe(b.evidenceHash);
  });

  it("changing the H2 text flips the evidenceHash", () => {
    const a = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot({ h2_list: ["Why Choose Us", "x"] }),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    const b = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot({ h2_list: ["A Different Heading", "x"] }),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });

  it("changing brandAssertions flips the evidenceHash", () => {
    const a = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: [],
      now: FIXED_NOW,
    });
    const b = buildThinPacketForCandidate({
      candidate: makeCandidate(),
      pageSnapshot: makeSnapshot(),
      businessConfig: makeBusinessConfig(),
      brandAssertions: makeBrandAssertions(),
      now: FIXED_NOW,
    });
    expect(a.evidenceHash).not.toBe(b.evidenceHash);
  });
});
