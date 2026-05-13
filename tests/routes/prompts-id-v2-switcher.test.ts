/**
 * /prompts/[id] v2B — switcher contract.
 *
 * Pins:
 *   - Default                        → legacy drilldown
 *   - `?legacy=1`                     → legacy (escape hatch, wins over env)
 *   - `?v2=1`                         → v2 5-act brief
 *   - `BEACON_PROMPTS_V2=true` env    → v2 default flip
 *   - empty / unknown route id        → calm not-found
 *
 * The v2 client is stubbed to a stable marker. Legacy detects
 * itself by the legacy section header "Your state, per platform"
 * which is unique to the legacy renderer.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    const err = new Error("NEXT_NOT_FOUND");
    (err as unknown as { digest: string }).digest = "NEXT_NOT_FOUND";
    throw err;
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/prompts/p-test",
}));

// Stub Supabase admin client — answer_texts unused for these tests.
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        in: async () => ({ data: [], error: null }),
      }),
    }),
  }),
}));

// Mock the v2 client + not-found to stable markers.
vi.mock("@/app/(shell)/prompts/[id]/prompt-detail-v2-client", () => {
  const React = require("react") as typeof import("react");
  return {
    PromptDetailV2Client: function PromptDetailV2ClientStub() {
      return React.createElement(
        "div",
        { "data-prompts-detail-stub": "v2" },
        "prompt-detail-v2-stub",
      );
    },
  };
});

vi.mock("@/app/(shell)/prompts/[id]/prompt-detail-v2-not-found", () => {
  const React = require("react") as typeof import("react");
  return {
    PromptDetailV2NotFound: function PromptDetailV2NotFoundStub() {
      return React.createElement(
        "div",
        { "data-prompts-detail-stub": "not-found" },
        "prompt-detail-not-found-stub",
      );
    },
  };
});

// Fixture: one tracked prompt with enough perplexity readings to
// classify it as winning (so legacy renders cleanly).
vi.mock("@/storage/canonical-store", async () => {
  const now = new Date();
  const yesterdayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const trackedPrompts = [
    {
      id: "p-test",
      account_id: "ritz",
      text: "What is the best builder in Atherton?",
      topic_id: "Atherton",
      location_scope: "Atherton",
      service_scope: null,
      intent_type: "recommendation",
      platforms: ["perplexity"],
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
      aliases: [],
      location_scope: null,
      service_scope: null,
      is_owned: true,
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

  const promptAnswerObservations = Array.from({ length: 3 }, (_, i) => ({
    ...baseObs,
    id: `o-${i}`,
    prompt_id: "p-test",
    platform: "perplexity",
    observed_at: `${yesterdayIso}T${String(10 + i).padStart(2, "0")}:00:00Z`,
    primary_recommendation: true,
    tracked_brand_mentioned: true,
    citation_rank: 1,
  }));

  // Emergency P0 fix (2026-05-12) — `/prompts/[id]` reads via the
  // tenant repo. Stash fixture for the parallel mock below.
  (globalThis as Record<string, unknown>).__PROMPTS_ID_SWITCHER_FIXTURE__ = {
    trackedPrompts,
    trackedEntities,
    promptAnswerObservations,
  };

  return {
    ensureCanonicalStoresSeeded: vi.fn(async () => {}),
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

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-ritz-founder"),
  currentTenant: vi.fn(async () => "tenant-ritz-founder"),
}));

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => {
      const fixture = (globalThis as Record<string, unknown>)
        .__PROMPTS_ID_SWITCHER_FIXTURE__ as
        | { trackedPrompts: unknown[]; trackedEntities: unknown[]; promptAnswerObservations: { prompt_id: string }[] }
        | undefined;
      const promptAnswerObservations = fixture?.promptAnswerObservations ?? [];
      return {
        getTrackedPrompts: vi.fn(async () => fixture?.trackedPrompts ?? []),
        getTrackedEntities: vi.fn(async () => fixture?.trackedEntities ?? []),
        getPromptAnswerObservations: vi.fn(
          async (options?: { promptId?: string }) => {
            if (!options?.promptId) return promptAnswerObservations;
            return promptAnswerObservations.filter(
              (o) => o.prompt_id === options.promptId,
            );
          },
        ),
      };
    },
  }),
}));

async function render(
  promptId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<string> {
  const { default: PromptDrilldownPage } = await import(
    "@/app/(shell)/prompts/[id]/page"
  );
  const tree = await PromptDrilldownPage({
    params: Promise.resolve({ id: promptId }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(tree as ReactElement);
}

describe("/prompts/[id] switcher contract", () => {
  const originalEnv = process.env.BEACON_PROMPTS_V2;

  beforeEach(() => {
    delete process.env.BEACON_PROMPTS_V2;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BEACON_PROMPTS_V2;
    } else {
      process.env.BEACON_PROMPTS_V2 = originalEnv;
    }
  });

  it("renders the legacy drilldown by default (no query, env unset)", async () => {
    const html = await render("p-test", {});
    expect(html).not.toContain('data-prompts-detail-stub="v2"');
    // Legacy uses this section heading verbatim.
    expect(html).toContain("Your state, per platform");
  }, 15_000);

  it("renders the v2 brief stub when ?v2=1 is set", async () => {
    const html = await render("p-test", { v2: "1" });
    expect(html).toContain('data-prompts-detail-stub="v2"');
    expect(html).not.toContain("Your state, per platform");
  }, 15_000);

  it("renders the legacy drilldown when ?legacy=1 is set (escape hatch)", async () => {
    const html = await render("p-test", { legacy: "1" });
    expect(html).not.toContain('data-prompts-detail-stub="v2"');
    expect(html).toContain("Your state, per platform");
  }, 15_000);

  it("?legacy=1 wins over BEACON_PROMPTS_V2=true (escape hatch overrides env)", async () => {
    process.env.BEACON_PROMPTS_V2 = "true";
    const html = await render("p-test", { legacy: "1" });
    expect(html).not.toContain('data-prompts-detail-stub="v2"');
    expect(html).toContain("Your state, per platform");
  }, 15_000);

  it("renders v2 when BEACON_PROMPTS_V2=true (env default flip)", async () => {
    process.env.BEACON_PROMPTS_V2 = "true";
    const html = await render("p-test", {});
    expect(html).toContain('data-prompts-detail-stub="v2"');
    expect(html).not.toContain("Your state, per platform");
  }, 15_000);

  it("renders calm not-found when the route id is empty", async () => {
    const html = await render("   ", {});
    expect(html).toContain('data-prompts-detail-stub="not-found"');
  }, 15_000);

  it("falls through to legacy notFound() when the route id is unknown", async () => {
    await expect(render("not-a-real-prompt", {})).rejects.toThrow(
      /NEXT_NOT_FOUND/,
    );
  }, 15_000);
});
