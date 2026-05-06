import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/prompts/p-outranked",
}));

// Stub Supabase admin client — in-memory answer_texts lookup.
vi.mock("@/lib/persistence/supabase", () => {
  const answerTexts = new Map<string, string>([
    [
      "obs-outranked-0",
      "For whole-home renovation in the Bay Area, CRC Builders and Homestead are both strong choices. Houzz also lists several options. Bayside Builders Group is another reputable firm.",
    ],
    [
      "obs-outranked-1",
      "Bayside Builders Group, CRC Builders, and Homestead all handle full-home renovation in the Bay Area.",
    ],
  ]);
  return {
    getSupabaseAdmin: () => ({
      from: () => ({
        select: () => ({
          in: async (_col: string, ids: string[]) => ({
            data: ids
              .filter((id) => answerTexts.has(id))
              .map((id) => ({ observation_id: id, body: answerTexts.get(id) })),
            error: null,
          }),
        }),
      }),
    }),
  };
});

// Shared fixture with one OUTRANKED prompt.
vi.mock("@/storage/canonical-store", async () => {
  const trackedPrompts = [
    {
      id: "p-outranked",
      account_id: "ritz",
      text: "Best builders in the Bay Area for a whole-home renovation?",
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
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    topic: "",
    metadata: {},
    tenant_id: "t",
  } as const;

  // Relative observation dates keep the fixtures inside the classifier's
  // default 7-day lookback window regardless of when the test runs. The
  // hour offsets (14h / 13h / 12h) preserve the original chronological
  // ordering so the "Raw evidence — last 3" sort is stable.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayDay = yesterday.toISOString().slice(0, 10);
  const promptAnswerObservations = [
    {
      ...baseObs,
      id: "obs-outranked-0",
      prompt_id: "p-outranked",
      platform: "perplexity",
      observed_at: `${yesterdayDay}T14:00:00Z`,
      primary_recommendation: false,
      citation_rank: null,
      competitor_co_mentions: ["CRC Builders", "Homestead"],
      answer_structure: "ranked_list",
    },
    {
      ...baseObs,
      id: "obs-outranked-1",
      prompt_id: "p-outranked",
      platform: "chatgpt",
      observed_at: `${yesterdayDay}T13:00:00Z`,
      primary_recommendation: false,
      citation_rank: null,
      competitor_co_mentions: ["CRC Builders", "Homestead"],
      answer_structure: "ranked_list",
    },
    {
      ...baseObs,
      id: "obs-outranked-2",
      prompt_id: "p-outranked",
      platform: "chatgpt",
      observed_at: `${yesterdayDay}T12:00:00Z`,
      primary_recommendation: false,
      citation_rank: null,
      competitor_co_mentions: ["CRC Builders"],
      answer_structure: "ranked_list",
    },
  ];

  return {
    ensureCanonicalStoresSeeded: vi.fn(async () => {}),
    // Phase 4.9: render paths use loadFreshCanonicalData; mock returns
    // the same fixture set so the drilldown renders as before.
    loadFreshCanonicalData: vi.fn(async () => ({
      trackedPrompts,
      promptAnswerObservations,
      trackedEntities,
      dailyMetricSnapshots: [],
    })),
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

describe("/prompts/[id] drilldown smoke", () => {
  it("renders the 'so what' block, platform split, competitors, answer shape, raw evidence", async () => {
    const { default: Page } = await import("@/app/(shell)/prompts/[id]/page");
    const tree = await Page({ params: Promise.resolve({ id: "p-outranked" }) });
    const html = renderToStaticMarkup(tree as ReactElement);

    // 1. Header with category + decision sentence + prompt text
    expect(html).toContain("OUTRANKED");
    expect(html).toMatch(/absent/i);
    expect(html).toMatch(/competitors dominate/i);
    expect(html).toContain("Likely action");
    expect(html).toContain("Best builders in the Bay Area for a whole-home renovation");

    // 2. Topic + geo tags
    expect(html).toContain("Whole Home Renovation Builders (Bay Area)");
    expect(html).toContain("Bay Area");

    // 3. Platform split — both platforms should render
    expect(html).toContain("Your state, per platform");
    expect(html).toContain("Perplexity");
    expect(html).toContain("ChatGPT");

    // 4. Competitor leaderboard
    expect(html).toContain("Who else is here");
    expect(html).toContain("CRC Builders");
    expect(html).toContain("Homestead");
    // CRC appears in 3 of 3; Homestead in 2 of 3
    expect(html).toMatch(/3 of 3/);
    expect(html).toMatch(/2 of 3/);

    // 5. Answer shape (all 3 observations are ranked_list → 100% → dominant)
    expect(html).toContain("Answer shape");
    expect(html).toContain("ranked list");

    // 6. Raw evidence last 3
    expect(html).toContain("Raw evidence");
    expect(html).toContain("Bayside Builders Group"); // pulled from the answer text

    // Back link
    expect(html).toContain("All prompts");
    expect(html).toContain("/prompts");
  });

  it("404s when the prompt id is unknown", async () => {
    const { default: Page } = await import("@/app/(shell)/prompts/[id]/page");
    await expect(
      Page({ params: Promise.resolve({ id: "does-not-exist" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
