/**
 * CX5 — gap detection, priority scoring, top-3 selection, payload generation.
 */

import { describe, it, expect } from "vitest";
import { detectGaps } from "@/domains/guided-execution/gap-detector";
import { scoreAllGaps, selectTopMoves } from "@/domains/guided-execution/priority-scorer";
import { generatePayload, formatAsTicket } from "@/domains/guided-execution/payload-generators";
import { assembleMoves } from "@/domains/guided-execution/assemble-moves";
import type { PageSnapshot, PageEntity } from "@/domains/pages/types";
import type { DetectedGap } from "@/domains/guided-execution/types";
import type { BeaconTenant } from "@/domains/tenants/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(url: string, overrides?: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: `snap-${url}`,
    page_id: `page-${url}`,
    observation_run_id: "run-1",
    url,
    canonical_url: url,
    fetched_at: "2026-04-10T00:00:00Z",
    http_status: 200,
    title: "Test Page",
    meta_description: "Test",
    h1: "Test Page",
    h2_list: ["Section 1", "Section 2"],
    faqs: [],
    schema_types: [],
    content_hash: "abc",
    headings_hash: "def",
    faq_hash: null,
    schema_hash: null,
    tenant_id: "tenant-test",
    ...overrides,
  } as PageSnapshot;
}

function makeTenant(overrides?: Partial<BeaconTenant>): BeaconTenant {
  return {
    id: "tenant-test",
    slug: "test-builder",
    business_name: "Test Builders",
    domain: "testbuilders.com",
    segment: "local_residential_builder",
    project_mix: ["new_construction", "whole_home_remodel"],
    cities_served: ["Palo Alto", "Menlo Park"],
    budget_range: "1m_5m",
    signup_date: "2026-04-01T00:00:00Z",
    role: "beta_customer",
    tos_accepted_at: "2026-04-01T00:00:00Z",
    discovered_competitors: ["Supple Homes", "Flegel's"],
    daily_budget_usd: 5.0,
    status: "active",
    email_frequency: "weekly",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

describe("gap detector", () => {
  it("detects missing FAQ on a service page", () => {
    const snapshots = [makeSnapshot("/services/custom-homes", { faqs: [] })];
    const gaps = detectGaps({ snapshots, pages: [] });
    const faqGap = gaps.find((g) => g.type === "missing_faq");
    expect(faqGap).toBeDefined();
    expect(faqGap!.severity).toMatch(/critical|high/);
    expect(faqGap!.fix_change_type).toBe("faq_schema");
  });

  it("detects missing FAQ schema when FAQ content exists", () => {
    const snapshots = [
      makeSnapshot("/services/remodel", {
        faqs: [
          { question: "Q1", answer_excerpt: "A1", source: "html_section" as const },
          { question: "Q2", answer_excerpt: "A2", source: "html_section" as const },
        ],
        schema_types: [],
      }),
    ];
    const gaps = detectGaps({ snapshots, pages: [] });
    const schemaGap = gaps.find((g) => g.type === "missing_faq_schema");
    expect(schemaGap).toBeDefined();
    expect(schemaGap!.primary_platform).toBe("google_aio");
  });

  it("detects missing comparison table on city page", () => {
    const snapshots = [makeSnapshot("/locations/palo-alto")];
    const gaps = detectGaps({ snapshots, pages: [] });
    const tableGap = gaps.find((g) => g.type === "missing_comparison_table");
    expect(tableGap).toBeDefined();
  });

  it("detects low internal links", () => {
    const snap = makeSnapshot("/services/kitchen") as Record<string, unknown>;
    snap.internal_link_count = 1;
    const gaps = detectGaps({ snapshots: [snap as PageSnapshot], pages: [] });
    const linkGap = gaps.find((g) => g.type === "low_internal_links");
    expect(linkGap).toBeDefined();
  });

  it("does NOT detect FAQ gap on project/portfolio pages", () => {
    const snapshots = [makeSnapshot("/explore-projects/modern-home", { faqs: [] })];
    const gaps = detectGaps({ snapshots, pages: [] });
    const faqGap = gaps.find((g) => g.type === "missing_faq");
    expect(faqGap).toBeUndefined();
  });

  it("sorts gaps by severity (critical first)", () => {
    const snapshots = [
      makeSnapshot("/", { faqs: [], schema_types: [] }),
      makeSnapshot("/about", { faqs: [] }),
    ];
    const gaps = detectGaps({
      snapshots,
      pages: [],
      citationCounts: new Map([["/", 100]]),
    });
    expect(gaps.length).toBeGreaterThan(0);
    // First gap should be critical (homepage with citations)
    expect(gaps[0].severity).toBe("critical");
  });

  it("counts affected pages per gap type", () => {
    const snapshots = [
      makeSnapshot("/services/a", { faqs: [] }),
      makeSnapshot("/services/b", { faqs: [] }),
      makeSnapshot("/services/c", { faqs: [] }),
    ];
    const gaps = detectGaps({ snapshots, pages: [] });
    const faqGaps = gaps.filter((g) => g.type === "missing_faq");
    expect(faqGaps.length).toBe(3);
    for (const g of faqGaps) {
      expect(g.affected_page_count).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

describe("priority scorer", () => {
  it("scores high-citation pages higher than low-citation pages", () => {
    const gaps: DetectedGap[] = [
      {
        type: "missing_faq",
        severity: "high",
        page_url: "/high-cit",
        description: "test",
        fix_change_type: "faq_schema",
        primary_platform: "chatgpt",
        current_state: "0 FAQ",
        target_state: "5-7 FAQ",
        affected_page_count: 1,
      },
      {
        type: "missing_faq",
        severity: "high",
        page_url: "/low-cit",
        description: "test",
        fix_change_type: "faq_schema",
        primary_platform: "chatgpt",
        current_state: "0 FAQ",
        target_state: "5-7 FAQ",
        affected_page_count: 1,
      },
    ];
    const citations = new Map([["/high-cit", 500], ["/low-cit", 2]]);
    const scored = scoreAllGaps(gaps, citations);
    expect(scored[0].gap.page_url).toBe("/high-cit");
    expect(scored[0].priority).toBeGreaterThan(scored[1].priority);
  });

  it("scores critical severity higher than medium", () => {
    const gaps: DetectedGap[] = [
      {
        type: "missing_faq",
        severity: "critical",
        page_url: "/a",
        description: "test",
        fix_change_type: "faq_schema",
        primary_platform: "chatgpt",
        current_state: "",
        target_state: "",
        affected_page_count: 1,
      },
      {
        type: "missing_faq",
        severity: "medium",
        page_url: "/b",
        description: "test",
        fix_change_type: "faq_schema",
        primary_platform: "chatgpt",
        current_state: "",
        target_state: "",
        affected_page_count: 1,
      },
    ];
    const scored = scoreAllGaps(gaps, new Map());
    expect(scored[0].gap.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Top-3 selection with diversity
// ---------------------------------------------------------------------------

describe("top-3 selector", () => {
  it("selects diverse change types", () => {
    const scored = [
      { gap: { fix_change_type: "faq_schema", page_url: "/a", type: "missing_faq" as const } as DetectedGap, priority: 90, components: { citation_impact: 0, pattern_confidence: 0, gap_severity: 0, page_importance: 0 } },
      { gap: { fix_change_type: "faq_schema", page_url: "/b", type: "missing_faq" as const } as DetectedGap, priority: 85, components: { citation_impact: 0, pattern_confidence: 0, gap_severity: 0, page_importance: 0 } },
      { gap: { fix_change_type: "content_structure", page_url: "/c", type: "missing_comparison_table" as const } as DetectedGap, priority: 80, components: { citation_impact: 0, pattern_confidence: 0, gap_severity: 0, page_importance: 0 } },
      { gap: { fix_change_type: "internal_links", page_url: "/d", type: "low_internal_links" as const } as DetectedGap, priority: 70, components: { citation_impact: 0, pattern_confidence: 0, gap_severity: 0, page_importance: 0 } },
    ];
    const top3 = selectTopMoves(scored, 3);
    expect(top3.length).toBe(3);
    const types = top3.map((m) => m.gap.fix_change_type);
    // Should be diverse: faq_schema, content_structure, internal_links
    expect(new Set(types).size).toBe(3);
    expect(types).toContain("faq_schema");
    expect(types).toContain("content_structure");
    expect(types).toContain("internal_links");
  });

  it("falls back to duplicates when fewer than 3 change types exist", () => {
    const scored = [
      { gap: { fix_change_type: "faq_schema", page_url: "/a", type: "missing_faq" as const } as DetectedGap, priority: 90, components: { citation_impact: 0, pattern_confidence: 0, gap_severity: 0, page_importance: 0 } },
      { gap: { fix_change_type: "faq_schema", page_url: "/b", type: "missing_faq" as const } as DetectedGap, priority: 85, components: { citation_impact: 0, pattern_confidence: 0, gap_severity: 0, page_importance: 0 } },
    ];
    const top3 = selectTopMoves(scored, 3);
    expect(top3.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Payload generation
// ---------------------------------------------------------------------------

describe("payload generators", () => {
  it("generates FAQ payload with questions and JSON-LD", () => {
    const gap: DetectedGap = {
      type: "missing_faq",
      severity: "high",
      page_url: "/services/custom-homes",
      description: "test",
      fix_change_type: "faq_schema",
      primary_platform: "chatgpt",
      current_state: "0 FAQ",
      target_state: "5-7 FAQ + FAQPage schema",
      affected_page_count: 1,
    };
    const tenant = makeTenant();
    const payload = generatePayload({ gap, tenant });
    expect(payload.kind).toBe("faq");
    if (payload.kind === "faq") {
      expect(payload.questions.length).toBeGreaterThanOrEqual(5);
      expect(payload.json_ld).toContain("FAQPage");
      expect(payload.json_ld).toContain("application/ld+json");
      expect(payload.placement).toBeTruthy();
    }
  });

  it("generates comparison table payload with HTML", () => {
    const gap: DetectedGap = {
      type: "missing_comparison_table",
      severity: "high",
      page_url: "/services/remodel",
      description: "test",
      fix_change_type: "content_structure",
      primary_platform: "google_aio",
      current_state: "No table",
      target_state: "Comparison table",
      affected_page_count: 1,
    };
    const tenant = makeTenant();
    const payload = generatePayload({ gap, tenant });
    expect(payload.kind).toBe("comparison");
    if (payload.kind === "comparison") {
      expect(payload.html).toContain("<table");
      expect(payload.html).toContain("Test Builders");
      expect(payload.competitors.length).toBeGreaterThan(0);
    }
  });

  it("generates dev ticket markdown", () => {
    const gap: DetectedGap = {
      type: "missing_faq",
      severity: "high",
      page_url: "/services/custom-homes",
      description: "Add FAQ section",
      fix_change_type: "faq_schema",
      primary_platform: "chatgpt",
      current_state: "0 FAQ",
      target_state: "5-7 FAQ + schema",
      affected_page_count: 1,
    };
    const tenant = makeTenant();
    const payload = generatePayload({ gap, tenant });
    const ticket = formatAsTicket({
      gap,
      payload,
      populationNarrative: "47 builders did this and 89% saw improvement",
      format: "markdown",
    });
    expect(ticket).toContain("## Add FAQ section");
    expect(ticket).toContain("47 builders");
    expect(ticket).toContain("```html");
    expect(ticket).toContain("Acceptance criteria");
    expect(ticket).toContain("Verification");
  });
});

// ---------------------------------------------------------------------------
// Full assembly
// ---------------------------------------------------------------------------

describe("assembleMoves", () => {
  it("produces up to 3 moves from page snapshots", () => {
    const tenant = makeTenant();
    const snapshots = [
      makeSnapshot("/", { faqs: [], schema_types: [] }),
      makeSnapshot("/services/custom-homes", { faqs: [] }),
      makeSnapshot("/locations/palo-alto", { faqs: [] }),
    ];
    const result = assembleMoves({
      tenant,
      snapshots,
      pages: [],
      citationCounts: new Map([["/", 100], ["/services/custom-homes", 50]]),
    });
    expect(result.moves.length).toBeGreaterThanOrEqual(1);
    expect(result.moves.length).toBeLessThanOrEqual(3);
    expect(result.total_gaps_detected).toBeGreaterThan(0);

    for (const move of result.moves) {
      expect(move.headline).toBeTruthy();
      expect(move.why).toBeTruthy();
      expect(move.guided_payload).toBeTruthy();
      expect(move.tenant_id).toBe("tenant-test");
      expect(move.priority).toBeGreaterThan(0);
    }
  });

  it("returns diverse change types in top 3", () => {
    const tenant = makeTenant();
    const snapshots = [
      makeSnapshot("/services/a", { faqs: [], schema_types: [] }),
      makeSnapshot("/services/b", { faqs: [], schema_types: [] }),
      makeSnapshot("/services/c", { faqs: [], schema_types: [] }),
    ];
    const result = assembleMoves({
      tenant,
      snapshots,
      pages: [],
      citationCounts: new Map(),
    });

    if (result.moves.length >= 2) {
      const types = result.moves.map((m) => m.action_class);
      // With service pages missing FAQ + comparison + schema,
      // we should get diverse types
      expect(new Set(types).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("includes JSON-LD in FAQ move payloads", () => {
    const tenant = makeTenant();
    const snapshots = [makeSnapshot("/services/remodel", { faqs: [] })];
    const result = assembleMoves({
      tenant,
      snapshots,
      pages: [],
      citationCounts: new Map(),
    });
    const faqMove = result.moves.find((m) => m.action_class === "faq_schema");
    if (faqMove) {
      const payload = faqMove.guided_payload as Record<string, unknown>;
      expect(payload.kind).toBe("faq");
      expect(payload.json_ld).toBeTruthy();
      expect(payload.dev_ticket_markdown).toBeTruthy();
    }
  });
});
