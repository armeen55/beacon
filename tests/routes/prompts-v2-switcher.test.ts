/**
 * /prompts v2A — switcher contract.
 *
 * Pins the routing rules implemented in
 * `src/app/(shell)/prompts/page.tsx`:
 *
 *   - Default (no query, env unset)   → legacy decision view (current production)
 *   - `?legacy=1`                      → legacy (escape hatch)
 *   - `?v2=1`                          → v2 strategic surface (preview hatch)
 *   - `BEACON_PROMPTS_V2=true` (env)   → v2 default flip
 *   - `?legacy=1` wins over env       (escape always wins)
 *
 * Both render branches are stubbed so the test focuses on the
 * routing decision, not full data render. The v2 client is
 * mocked to a stable marker; the legacy branch detects itself
 * by the legacy "WINNING ·" group header string (a marker that
 * is unique to the legacy table and can't appear in the v2
 * stub).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/prompts",
}));

// Mock the v2 client to a stable marker.
vi.mock("@/app/(shell)/prompts/prompts-v2-client", () => {
  const React = require("react") as typeof import("react");
  return {
    PromptsV2Client: function PromptsV2ClientStub() {
      return React.createElement(
        "div",
        {
          "data-prompts-stub": "v2",
        },
        "prompts-v2-stub",
      );
    },
  };
});

// Minimal fixture set that exercises every category.
vi.mock("@/storage/canonical-store", async () => {
  const now = new Date();
  const yesterdayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const trackedPrompts = [
    {
      id: "p-w",
      account_id: "ritz",
      text: "Best builder in Atherton?",
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
    prompt_id: "p-w",
    platform: "perplexity",
    observed_at: `${yesterdayIso}T${String(10 + i).padStart(2, "0")}:00:00Z`,
    primary_recommendation: true,
    tracked_brand_mentioned: true,
    citation_rank: 1,
  }));

  // Emergency P0 fix (2026-05-12) — `/prompts` now reads via the
  // tenant repo directly. Stash fixture on globalThis so the parallel
  // repo mock below can share it.
  (globalThis as Record<string, unknown>).__PROMPTS_V2_SWITCHER_FIXTURE__ = {
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
        .__PROMPTS_V2_SWITCHER_FIXTURE__ as
        | { trackedPrompts: unknown[]; trackedEntities: unknown[]; promptAnswerObservations: unknown[] }
        | undefined;
      return {
        getTrackedPrompts: vi.fn(async () => fixture?.trackedPrompts ?? []),
        getTrackedEntities: vi.fn(async () => fixture?.trackedEntities ?? []),
        getPromptAnswerObservations: vi.fn(
          async () => fixture?.promptAnswerObservations ?? [],
        ),
      };
    },
  }),
}));

async function render(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<string> {
  const { default: PromptsPage } = await import("@/app/(shell)/prompts/page");
  const tree = await PromptsPage({
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(tree as ReactElement);
}

describe("/prompts switcher contract", () => {
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

  it("renders the legacy decision view by default (no query, env unset)", async () => {
    const html = await render({});
    expect(html).not.toContain('data-prompts-stub="v2"');
    // Legacy section header is a marker unique to the legacy view.
    expect(html).toContain("WINNING ·");
  }, 15_000);

  it("renders the v2 strategic surface when ?v2=1 is set", async () => {
    const html = await render({ v2: "1" });
    expect(html).toContain('data-prompts-stub="v2"');
    expect(html).not.toContain("WINNING ·");
  }, 15_000);

  it("renders the legacy decision view when ?legacy=1 is set (escape hatch)", async () => {
    const html = await render({ legacy: "1" });
    expect(html).not.toContain('data-prompts-stub="v2"');
    expect(html).toContain("WINNING ·");
  }, 15_000);

  it("?legacy=1 wins over BEACON_PROMPTS_V2=true (escape hatch overrides env)", async () => {
    process.env.BEACON_PROMPTS_V2 = "true";
    const html = await render({ legacy: "1" });
    expect(html).not.toContain('data-prompts-stub="v2"');
    expect(html).toContain("WINNING ·");
  }, 15_000);

  it("renders v2 when BEACON_PROMPTS_V2=true (env default flip)", async () => {
    process.env.BEACON_PROMPTS_V2 = "true";
    const html = await render({});
    expect(html).toContain('data-prompts-stub="v2"');
    expect(html).not.toContain("WINNING ·");
  }, 15_000);
});
