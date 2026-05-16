/**
 * /changes/[id] v1/v2 switcher contract.
 *
 * Pins the routing rules implemented in
 * `src/app/(shell)/changes/[id]/page.tsx`:
 *
 *   - Default (no query, env unset)   → legacy detail (current production)
 *   - `?legacy=1`                      → legacy detail (escape hatch)
 *   - `?v2=1`                          → v2 proof brief (preview hatch)
 *   - `BEACON_CHANGES_V2=true` (env)   → v2 proof brief (default flip)
 *
 * The two render branches are stubbed so the test focuses on the
 * routing decision, not on the full data render. The legacy branch
 * is harder to stub end-to-end because it has many downstream
 * components; we mock the v2 client to a stable marker and verify
 * the legacy header text appears (or doesn't) on the other branches.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ChangelogEntry } from "@/domains/changelog/types";

const mockEntry: ChangelogEntry = {
  id: "cl-test-1",
  timestamp: "2026-04-22T18:21:08.931Z",
  signal_type: "faq",
  asset_type: "service_page",
  url: "https://ritzbuilders.com/faq",
  asset_name: "/faq",
  change_description: "FAQ expanded from 10 to 34 questions",
  topic_targeted: "faq",
  city_targeted: null,
  hypothesis: null,
  hypothesis_source: "inferred",
  expected_impact_window: null,
  brief_id: null,
  opportunity_id: null,
  notes: null,
  created_at: "2026-04-22T18:21:08.931Z",
  updated_at: "2026-04-22T18:21:08.931Z",
  source_system: "scan_detection",
  archived: false,
  tenant_id: "ritz",
} as ChangelogEntry;

const buildRepoStub = (
  overrides: Record<string, () => unknown> = {},
) => {
  const repo: Record<string, unknown> = new Proxy(
    {} as Record<string, unknown>,
    {
      get(_target, prop: string) {
        if (prop === "forTenant") return () => repo;
        if (prop in overrides) return overrides[prop];
        return async () => [];
      },
    },
  );
  return repo;
};

async function render(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<string> {
  const { default: ChangeDetailPage } = await import(
    "@/app/(shell)/changes/[id]/page"
  );
  const tree = await ChangeDetailPage({
    params: Promise.resolve({ id: mockEntry.id }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(tree as ReactElement);
}

describe("/changes/[id] switcher contract", () => {
  const originalEnv = process.env.BEACON_CHANGES_V2;

  beforeEach(() => {
    delete process.env.BEACON_CHANGES_V2;
    vi.resetModules();
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("next/navigation", () => ({
      notFound: () => {
        const err = new Error("NEXT_NOT_FOUND");
        (err as unknown as { digest: string }).digest = "NEXT_NOT_FOUND";
        throw err;
      },
    }));
    vi.doMock("@/lib/seed-data.server", () => ({
      getOpportunities: vi.fn(async () => []),
      getResults: vi.fn(async () => []),
    }));
    vi.doMock("@/domains/attribution/store", () => ({
      getEventDecisions: vi.fn(async () => []),
    }));
    vi.doMock("@/lib/persistence/json-store", () => ({
      readStore: () => [],
      writeStore: vi.fn(async () => {}),
    }));
    vi.doMock("@/domains/pages/citation-evidence-store", () => ({
      getCitationEvidenceIndex: vi.fn(async () => null),
    }));
    vi.doMock("@/domains/pages/page-store", () => ({
      getOwnedPages: async () => [],
      // Perf+egress bundle 2 (2026-05-12) — /changes/[id] legacy
      // branch now reads via the projected helper. The mock must
      // export both shapes so the switcher's legacy-branch render
      // doesn't blow up on a missing export.
      getOwnedPageSummaries: async () => [],
    }));
    vi.doMock("@/domains/pages/issues", () => ({
      getRolloutExecutions: vi.fn(async () => []),
      getPatternEvidence: vi.fn(async () => []),
    }));
    vi.doMock("@/domains/pages/playbook", () => ({
      minePatterns: () => [],
      generateBriefs: () => [],
    }));
    vi.doMock("@/domains/product/recommendation-engine", () => ({
      computeRecommendations: () => [],
    }));
    vi.doMock("@/domains/product/recommendation-tracker", () => ({
      computeTrackRecord: () => ({ patterns: [] }),
      wasChangeRecommended: () => null,
    }));
    vi.doMock("@/lib/business-config", () => ({
      getSectionAnalyzerConfig: () => ({}),
      // Section 6 C6b (2026-05-15) — page.tsx now reads
      // `getBusinessConfig().name` to thread the brandName arg into
      // the C6a evidence loader. Return a minimal config that supplies
      // the `name` field; the rest of the BusinessConfig shape is not
      // touched by the switcher test.
      getBusinessConfig: () => ({ name: "Test Brand" }),
    }));
    // Section 6 C6b (2026-05-15) — page.tsx invokes
    // loadChangePrimaryEvidence inside the v2 branch. The switcher
    // test exercises the route-mode dispatch only; the evidence
    // pipeline is covered by its own dedicated runtime tests. Stub
    // the loader to return the silent default so this test stays
    // focused on the v1↔v2 contract.
    vi.doMock("@/domains/citation-lifecycle/load-change-primary-evidence", () => ({
      loadChangePrimaryEvidence: async () => ({
        available: false,
        lines: null,
        raw: {
          modeA: {
            status: "silent",
            cited_here_count: 0,
            primary_count: 0,
            primary_share_pct: null,
          },
          modeB: {
            per_platform: {
              chatgpt: {
                status: "silent",
                pre_count: 0,
                pre_total: 0,
                pre_share_pct: null,
                post_count: 0,
                post_total: 0,
                post_share_pct: null,
                delta_pp: null,
              },
              perplexity: {
                status: "silent",
                pre_count: 0,
                pre_total: 0,
                pre_share_pct: null,
                post_count: 0,
                post_total: 0,
                post_share_pct: null,
                delta_pp: null,
              },
            },
          },
        },
      }),
    }));
    vi.doMock("@/domains/observations/read", () => ({
      latestWebsiteCrawlRun: () => null,
    }));
    vi.doMock("@/domains/attribution/change-outcome-store", () => ({
      loadChangeOutcomeById: async () => null,
    }));
    vi.doMock("@/domains/attribution/url-change-outcome", () => ({
      getUrlChangeOutcomes: async () => [],
    }));
    vi.doMock("@/domains/attribution/scorecard", () => ({
      computeScorecard: (changes: ChangelogEntry[]) =>
        changes.map((c) => ({
          change: c,
          daysSinceChange: 1,
          topics: [],
          platforms: [],
          eventAttributions: [],
          evidenceTier: "probable",
          verdict: "too_early",
          verdictSummary: "pending",
          operatorConfirmedCount: 0,
          topTrust: null,
          topScore: null,
          topConfidence: null,
        })),
    }));
    vi.doMock("@/domains/attribution/change-impact", () => ({
      enrichWithImpact: (rows: unknown[]) => rows,
      computeChangeImpact: () => ({
        confidence: "low",
        direction: "none",
        whyExplanation: "",
        nextAction: "",
      }),
    }));
    vi.doMock("@/lib/persistence/repositories", () => ({
      getRepository: () =>
        buildRepoStub({
          getChangelogEntries: async () => [mockEntry],
          getRecommendedEdits: async () => [],
          getPageSnapshots: async () => [],
        }),
    }));
    // Mock the v2 client so we can detect routing by marker.
    vi.doMock(
      "@/app/(shell)/changes/[id]/change-detail-v2-client",
      () => {
        const React = require("react") as typeof import("react");
        return {
          ChangeDetailV2Client: function ChangeDetailV2ClientStub() {
            return React.createElement(
              "div",
              {
                "data-change-detail-stub": "v2",
              },
              "change-detail-v2-stub",
            );
          },
        };
      },
    );
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BEACON_CHANGES_V2;
    } else {
      process.env.BEACON_CHANGES_V2 = originalEnv;
    }
  });

  it("renders the legacy detail by default (no query, env unset)", async () => {
    const html = await render({});
    // No v2 stub.
    expect(html).not.toContain('data-change-detail-stub="v2"');
    // Legacy detail rendered the changelog row's description (a
    // unique-enough marker that doesn't appear in the v2 stub).
    expect(html).toContain("FAQ expanded from 10 to 34 questions");
  }, 15_000);

  it("renders the v2 proof brief when ?v2=1 is set", async () => {
    const html = await render({ v2: "1" });
    expect(html).toContain('data-change-detail-stub="v2"');
    // Legacy body must NOT render.
    expect(html).not.toContain("FAQ expanded from 10 to 34 questions");
  }, 15_000);

  it("renders the legacy detail when ?legacy=1 is set (escape hatch)", async () => {
    const html = await render({ legacy: "1" });
    expect(html).not.toContain('data-change-detail-stub="v2"');
    expect(html).toContain("FAQ expanded from 10 to 34 questions");
  }, 15_000);

  it("?legacy=1 wins over BEACON_CHANGES_V2=true (escape hatch overrides env)", async () => {
    process.env.BEACON_CHANGES_V2 = "true";
    const html = await render({ legacy: "1" });
    expect(html).not.toContain('data-change-detail-stub="v2"');
    expect(html).toContain("FAQ expanded from 10 to 34 questions");
  }, 15_000);

  it("renders v2 when BEACON_CHANGES_V2=true (env default flip)", async () => {
    process.env.BEACON_CHANGES_V2 = "true";
    const html = await render({});
    expect(html).toContain('data-change-detail-stub="v2"');
    expect(html).not.toContain("FAQ expanded from 10 to 34 questions");
  }, 15_000);
});
