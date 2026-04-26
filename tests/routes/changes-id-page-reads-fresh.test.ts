import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ChangelogEntry } from "@/domains/changelog/types";

// ---------------------------------------------------------------------------
// Sprint 1 / Phase 1.6 regression tests — /changes/[id] detail page.
//
// /changes/[id] was one click away from /changes and still read the module-
// level `changelogEntries` array from @/lib/seed-data.server. After Phase
// 1.2 fixed /changes, a scan_detection row written by a different lambda
// would appear on the main list but 404 on its own detail page. This file
// proves the detail page reads from the repository per request and shows
// an honest error on read failure / a standard notFound when the id is
// genuinely absent from Supabase.
// ---------------------------------------------------------------------------

const PAGE_PATH = resolve(
  __dirname,
  "../../src/app/(shell)/changes/[id]/page.tsx",
);
const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");

describe("Sprint 1 / Phase 1.6 — /changes/[id] fresh-read invariants", () => {
  describe("structural invariants (source-level)", () => {
    it("does NOT import mutable `changelogEntries` from seed-data.server", () => {
      // Enrichment imports (`results`, `opportunities`) remain in scope —
      // they feed the scorecard/coverage display, and Phase 1.6 explicitly
      // limits itself to the core `changelogEntries` read path. What must
      // NOT appear is any `changelogEntries` import from seed-data.server,
      // which is the root of the cross-lambda stale-read bug.
      const importBlocks = PAGE_SOURCE.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/lib\/seed-data\.server["']/g,
      );
      expect(importBlocks).not.toBeNull();
      for (const block of importBlocks!) {
        expect(block).not.toMatch(/\bchangelogEntries\b/);
      }
    });

    it("DOES use `repository.getChangelogEntries()` to find the entry", () => {
      expect(PAGE_SOURCE).toMatch(/getChangelogEntries\(\)/);
      expect(PAGE_SOURCE).toMatch(/const\s+repository\s*=\s*getRepository\(\)/);
    });

    it("declares `export const dynamic = \"force-dynamic\"` to prevent ISR caching", () => {
      expect(PAGE_SOURCE).toMatch(
        /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
      );
    });
  });

  describe("behavioral invariants (rendered output)", () => {
    const mockEntry: ChangelogEntry = {
      id: "cl-moda36fcnit6nf",
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
    };

    // Default repo: every getX method returns []. Individual tests override
    // getChangelogEntries via the backing object below.
    // Sprint 7 Phase 7.5b Commit 5 (2026-04-25) — `forTenant(tenantId)`
    // returns the same proxy so overrides apply to both unscoped and
    // tenant-scoped reads.
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

    beforeEach(() => {
      vi.resetModules();
      vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
      // notFound() throws a special NEXT_NOT_FOUND sentinel in Next.js.
      // Represent with a typed error so tests can assert on it.
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
        citationEvidenceIndex: null,
      }));
      // Sprint 7 Phase 7.5c/3 (2026-04-25) — page-store now exports a lazy
      // async function instead of a module-level array.
      vi.doMock("@/domains/pages/page-store", () => ({
        getOwnedPages: async () => [],
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
      }));
      vi.doMock("@/domains/observations/read", () => ({
        latestWebsiteCrawlRun: () => null,
      }));
      vi.doMock("@/domains/attribution/change-outcome-store", () => ({
        loadChangeOutcomeById: () => null,
      }));
      // computeScorecard builds the drilldown row; wrap it to a trivial
      // pass-through so the test doesn't depend on the full attribution
      // engine. `row.change.id === id` is what /changes/[id] checks.
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
    });

    const mockRepoWithChangelog = (
      getChangelogEntries: () => Promise<ChangelogEntry[]> | ChangelogEntry[],
    ) => {
      vi.doMock("@/lib/persistence/repositories", () => ({
        getRepository: () => buildRepoStub({ getChangelogEntries }),
      }));
    };

    it("renders a scan_detection entry that exists only in the repository, not in module-level seed data", async () => {
      mockRepoWithChangelog(async () => [mockEntry]);
      const { default: ChangeDetailPage } = await import(
        "@/app/(shell)/changes/[id]/page"
      );
      const tree = await ChangeDetailPage({
        params: Promise.resolve({ id: mockEntry.id }),
      });
      const html = renderToStaticMarkup(tree as ReactElement);

      // Entry's core fields must appear in the detail body.
      expect(html).toContain("/faq");
      expect(html).toContain("FAQ expanded from 10 to 34 questions");
      // Must not have hit the honest-error branch.
      expect(html).not.toContain("Couldn&#x27;t load this change");
    });

    it("shows honest error state when the repository read throws", async () => {
      mockRepoWithChangelog(async () => {
        throw new Error("supabase connection refused");
      });
      const { default: ChangeDetailPage } = await import(
        "@/app/(shell)/changes/[id]/page"
      );
      const tree = await ChangeDetailPage({
        params: Promise.resolve({ id: mockEntry.id }),
      });
      const html = renderToStaticMarkup(tree as ReactElement);

      // Honest error surface, not a silent fallback to cached stale data.
      expect(html).toMatch(/Couldn(&#x27;|')t load this change/);
      expect(html).toContain("supabase connection refused");
      // Detail body content MUST NOT render in the error branch.
      expect(html).not.toContain("FAQ expanded from 10 to 34 questions");
    });

    it("calls notFound() — not silent-fallback to stale cache — when the id is absent from the repo", async () => {
      // Fresh repo returns zero entries; the operator clicked a link for an
      // id that the DB does not know about. Must land on notFound(), not
      // on a row reconstituted from module-level seed data.
      mockRepoWithChangelog(async () => []);
      const { default: ChangeDetailPage } = await import(
        "@/app/(shell)/changes/[id]/page"
      );
      await expect(
        ChangeDetailPage({
          params: Promise.resolve({ id: "cl-nonexistent" }),
        }),
      ).rejects.toThrowError(/NEXT_NOT_FOUND/);
    });
  });
});
