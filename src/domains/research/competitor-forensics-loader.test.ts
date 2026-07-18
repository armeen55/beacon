import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenant-context", () => ({ runWithTenant: async (_tenantId: string, fn: () => unknown) => fn() }));

import { loadCompetitorForensicsForTenant } from "./competitor-forensics-loader";

describe("loadCompetitorForensicsForTenant", () => {
  it("builds a tenant-filtered structural why-them report without doing research", async () => {
    const report = await loadCompetitorForensicsForTenant("tenant-iranopedia", {
      readUniverse: async () => ({
        origin: "configured_file",
        entries: [{ id: "winner", domain: "winner.example", display_name: "Winner", status: "active" }],
        domainToLabel: { "winner.example": "Winner" },
        pin: { universe_version: 1, universe_fingerprint: "x", legacy_unversioned_file: false, fingerprint_mismatch: false },
      }),
      readEvidence: async () => [{
        competitorEvidenceId: "e1", frontierKey: "nowruz", topic: "nowruz traditions",
        domain: "winner.example", pageUrl: "https://winner.example/nowruz", pageTitle: "Nowruz",
        sourceType: "guide_article", sourceTypeInferred: false, citationCount: 5,
        evidenceType: "repeatedly_cited", observedAt: "2026-07-17", structuralSignals: "",
        contentSignals: "", comparisonSignals: "", notes: null,
      }],
      readCompetitorSnapshots: async () => [{
        id: "s1", tenant_id: "tenant-iranopedia", url: "https://winner.example/nowruz/",
        canonical_url: null, fetched_at: "2026-07-17", http_status: 200, title: "Nowruz guide",
        meta_description: "A complete guide", h1: "Nowruz traditions", h2_list: ["Haft sin meaning"],
        faq_questions: ["What is haft sin?"], extraction_certainty: "confirmed",
      }],
      readOwnedSnapshots: async () => [{
        id: "o1", page_id: "p1", tenant_id: "tenant-iranopedia", url: "https://iranopedia.com/nowruz",
        canonical_url: null, fetched_at: "2026-07-17", http_status: 200, title: "Nowruz traditions",
        meta_description: null, h1: "Nowruz traditions", h2_list: [], h3_count: 0, faqs: [], schema_types: [],
        location_terms: [], service_terms: [], internal_link_count: 0, external_link_count: 0, word_count: 100,
        robots_meta: null, has_canonical_mismatch: false, content_hash: "", headings_hash: "", faq_hash: "", schema_hash: "",
      }],
      readObservations: async () => [
        { id: "other", tenant_id: "tenant-other", prompt_id: "p1", run_id: "r", answer_hash: null, position: null, tracked_brand_mentioned: false, tracked_brand_cited: false, citation_count: 1, owned_citation_count: 0, citation_domains: ["winner.example"], citation_categories: {}, mentions: [], observed_at: "2026-07-17", platform: "chatgpt", topic: "nowruz", metadata: {} },
        { id: "ours", tenant_id: "tenant-iranopedia", prompt_id: "p1", run_id: "r", answer_hash: null, position: null, tracked_brand_mentioned: false, tracked_brand_cited: false, citation_count: 1, owned_citation_count: 0, citation_domains: ["winner.example"], citation_categories: {}, mentions: [], observed_at: "2026-07-17", platform: "chatgpt", topic: "nowruz", metadata: {} },
      ],
      readPrompts: async () => [{ id: "p1", account_id: "a", tenant_id: "tenant-iranopedia", text: "What are Nowruz traditions?", topic_id: null, location_scope: null, service_scope: null, intent_type: "informational", platforms: ["chatgpt"], tags: [], is_active: true, created_at: "2026-07-17", updated_at: "2026-07-17" }],
    });
    expect(report).toHaveLength(1);
    expect(report[0]?.equivalentPageUrl).toBe("https://iranopedia.com/nowruz");
    expect(report[0]?.gaps.map((gap) => gap.dimension)).toEqual(["faq", "section_coverage", "meta_description"]);
    expect(report[0]?.prompts).toHaveLength(1);
  });
});
