import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/prompts",
}));

// Seed canonical-store with deterministic fixture data so the route
// render is fully offline. Covers: empty, all-early, mixed-category.
vi.mock("@/storage/canonical-store", async () => {
  const now = new Date("2026-04-24T12:00:00Z");
  const todayIso = now.toISOString().slice(0, 10);
  const yesterdayIso = "2026-04-23";

  const trackedPrompts = [
    {
      id: "p-winning",
      account_id: "ritz",
      text: "What is the best teardown-rebuild custom home builder in Atherton?",
      topic_id: "Atherton Construction",
      location_scope: "Atherton",
      service_scope: null,
      intent_type: "recommendation",
      platforms: ["perplexity", "chatgpt"],
      tags: [],
      is_active: true,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    },
    {
      id: "p-absent-1",
      account_id: "ritz",
      text: "Best builders to renovate a whole home in the Bay Area?",
      topic_id: "Whole Home Renovation Builders (Bay Area)",
      location_scope: "Bay Area",
      service_scope: null,
      intent_type: "recommendation",
      platforms: ["perplexity", "chatgpt"],
      tags: [],
      is_active: true,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    },
    {
      id: "p-absent-2",
      account_id: "ritz",
      text: "Bay Area full-home modernization builders?",
      topic_id: "Whole Home Renovation Builders (Bay Area)",
      location_scope: "Bay Area",
      service_scope: null,
      intent_type: "recommendation",
      platforms: ["perplexity", "chatgpt"],
      tags: [],
      is_active: true,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    },
    {
      id: "p-absent-3",
      account_id: "ritz",
      text: "Who renovates Bay Area luxury homes end-to-end?",
      topic_id: "Whole Home Renovation Builders (Bay Area)",
      location_scope: "Bay Area",
      service_scope: null,
      intent_type: "recommendation",
      platforms: ["perplexity", "chatgpt"],
      tags: [],
      is_active: true,
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    },
  ];

  const trackedEntities = [
    {
      id: "ent-ritz",
      account_id: "ritz",
      entity_type: "brand",
      name: "Ritz Builders",
      domain: "ritzbuilders.com",
      url: null,
      aliases: ["Ritz"],
      location_scope: null,
      service_scope: null,
      is_owned: true,
      is_active: true,
      metadata: {},
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    },
    {
      id: "ent-crc",
      account_id: "ritz",
      entity_type: "competitor",
      name: "CRC Builders",
      domain: "crcbuilders.com",
      url: null,
      aliases: [],
      location_scope: null,
      service_scope: null,
      is_owned: false,
      is_active: true,
      metadata: {},
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    },
    {
      id: "ent-hm",
      account_id: "ritz",
      entity_type: "competitor",
      name: "Homestead",
      domain: "homestead.com",
      url: null,
      aliases: [],
      location_scope: null,
      service_scope: null,
      is_owned: false,
      is_active: true,
      metadata: {},
      created_at: "2026-04-20T00:00:00Z",
      updated_at: "2026-04-20T00:00:00Z",
    },
  ];

  const baseObs = {
    run_id: "r",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    topic: "",
    metadata: {},
    tenant_id: "t",
  } as const;

  const promptAnswerObservations = [
    // p-winning: 3 native Perplexity, all primary_recommendation=true
    ...Array.from({ length: 3 }, (_, i) => ({
      ...baseObs,
      id: `o-w-${i}`,
      prompt_id: "p-winning",
      platform: "perplexity",
      observed_at: `${yesterdayIso}T${String(10 + i).padStart(2, "0")}:00:00Z`,
      primary_recommendation: true,
      tracked_brand_mentioned: true,
      citation_rank: 1,
    })),
    // 3 absent+outranked prompts (≥3 forms a topic cluster)
    ...["p-absent-1", "p-absent-2", "p-absent-3"].flatMap((pid, idx) =>
      Array.from({ length: 3 }, (_, i) => ({
        ...baseObs,
        id: `o-a-${idx}-${i}`,
        prompt_id: pid,
        platform: i === 0 ? "perplexity" : "chatgpt",
        observed_at: `${yesterdayIso}T${String(12 + i).padStart(2, "0")}:00:00Z`,
        primary_recommendation: false,
        tracked_brand_mentioned: false,
        citation_rank: null,
        competitor_co_mentions: ["CRC Builders", "Homestead"],
      })),
    ),
  ];

  void todayIso;
  return {
    ensureCanonicalStoresSeeded: vi.fn(async () => {}),
    trackedPrompts,
    trackedEntities,
    promptAnswerObservations,
    dailyMetricSnapshots: [],
    observationRuns: [],
    outcomeEvents: [],
    candidateCauses: [],
    eventDecisions: [],
  };
});

describe("/prompts route smoke", () => {
  it("renders grouped sections with category headers, counts, and cluster notes", async () => {
    const { default: PromptsPage } = await import("@/app/(shell)/prompts/page");
    const tree = await PromptsPage();
    const html = renderToStaticMarkup(tree as ReactElement);

    // Page header
    expect(html).toContain("Prompts");
    expect(html).toContain("Decision view across your tracked prompts");

    // At-a-glance strip
    expect(html).toMatch(/4<\/span>.*prompts/); // 4 prompts total

    // Group headers with counts
    expect(html).toContain("WINNING · 1");
    // The 3 absent+outranked prompts all have dominant competitors, so they
    // classify as OUTRANKED, not ABSENT.
    expect(html).toMatch(/OUTRANKED · 3/);

    // Cluster note in Outranked section
    expect(html).toContain("cluster to Whole Home Renovation Builders (Bay Area)");

    // Row reasoning
    expect(html).toContain("Primary on Perplexity");
    expect(html).toContain("competitors dominate");

    // Category lead lines (HTML escapes apostrophes as &#x27;)
    expect(html).toMatch(/primary on at least one platform/);
    expect(html).toContain("Competitors dominate here");

    // Drilldown links
    expect(html).toContain("/prompts/p-winning");
    expect(html).toContain("/prompts/p-absent-1");
  });

  it("prompt rows carry cluster tags when the prompt is part of a detected cluster", async () => {
    const { default: PromptsPage } = await import("@/app/(shell)/prompts/page");
    const tree = await PromptsPage();
    const html = renderToStaticMarkup(tree as ReactElement);
    // The 3 absent-prompts cluster by topic → every row should carry the
    // topic cluster tag.
    expect(html).toMatch(/Whole Home Renovation Builders \(Bay Area\)/g);
  });
});
