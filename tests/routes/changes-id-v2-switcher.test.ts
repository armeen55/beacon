/**
 * /changes/[id] — V2-only render contract.
 *
 * Surface collapse (2026-06-15): the legacy detail layout + the
 * `?legacy=1` / `?v2=1` / `BEACON_CHANGES_V2` switcher were deleted.
 * `/changes/[id]` now renders the v2 proof brief unconditionally. This
 * test pins that the route renders the v2 client (and never the deleted
 * legacy body) regardless of any query string.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ChangelogEntry } from "@/domains/changelog/types";

const redirectMock = vi.fn((href: string): never => {
  throw new Error(`NEXT_REDIRECT:${href}`);
});
let proofLedgerMockRows: Array<{
  id: string;
  page: string;
  path: string;
  shippedAt: string;
}> = [];

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

async function render(): Promise<string> {
  const { default: ChangeDetailPage } = await import(
    "@/app/(shell)/changes/[id]/page"
  );
  const tree = await ChangeDetailPage({
    params: Promise.resolve({ id: mockEntry.id }),
  });
  return renderToStaticMarkup(tree as ReactElement);
}

describe("/changes/[id] V2-only render contract", () => {
  beforeEach(() => {
    vi.resetModules();
    redirectMock.mockClear();
    proofLedgerMockRows = [];
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("next/navigation", () => ({
      notFound: () => {
        const err = new Error("NEXT_NOT_FOUND");
        (err as unknown as { digest: string }).digest = "NEXT_NOT_FOUND";
        throw err;
      },
      redirect: redirectMock,
    }));
    vi.doMock("@/domains/proof-gsc/load-ledger", () => ({
      loadProofLedgerPersisted: async () => proofLedgerMockRows,
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

  it("sends an untracked historical row to Results instead of rendering a second outcome engine", async () => {
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/results");
    expect(redirectMock).toHaveBeenCalledWith("/results");
  }, 15_000);

  it("sends a tracked change to its one canonical Results proof card", async () => {
    proofLedgerMockRows = [{
      id: "faq::2026-04-22",
      page: mockEntry.url ?? "",
      path: "/faq",
      shippedAt: "2026-04-22T00:00:00.000Z",
    }];

    await expect(render()).rejects.toThrow(
      "NEXT_REDIRECT:/results#proof-faq%3A%3A2026-04-22",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/results#proof-faq%3A%3A2026-04-22",
    );
  }, 15_000);
});
