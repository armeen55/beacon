import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ChangelogEntry } from "@/domains/changelog/types";

// ---------------------------------------------------------------------------
// Sprint 1 / Phase 1.3 regression tests.
//
// These prove that /changes renders from a fresh repository read per request
// and never from the module-level `changelogEntries` array in
// @/lib/seed-data.server. That module is hydrated once per Vercel lambda
// cold start; writes from other lambdas stayed invisible until the warm
// lambda reset, which is exactly why operator Confirm clicks produced no
// visible row on /changes even though Supabase already had the entries.
//
// Structural invariants (1-3) protect the fix from being silently reverted.
// Behavioral invariants (4-5) prove the rendered page actually reads from
// the repository and shows an honest error when the read fails.
// ---------------------------------------------------------------------------

const PAGE_PATH = resolve(__dirname, "../../src/app/(shell)/changes/page.tsx");
const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");

describe("Sprint 1 / Phase 1.3 — /changes fresh-read invariants", () => {
  describe("structural invariants (source-level)", () => {
    it("does NOT import mutable `changelogEntries` from seed-data.server", () => {
      // The mutable array `changelogEntries` lives at module scope in
      // seed-data.server and is hydrated once per lambda cold start. Any
      // render-visible import of it re-introduces the cross-lambda stale-read
      // bug. Type-only imports of `ChangelogEntry` are fine because they
      // disappear at compile time.
      const importBlocks = PAGE_SOURCE.match(
        /import\s+\{[^}]+\}\s+from\s+["']@\/lib\/seed-data\.server["']/g,
      );
      expect(importBlocks).not.toBeNull();
      for (const block of importBlocks!) {
        expect(block).not.toMatch(/\bchangelogEntries\b/);
      }
    });

    it("DOES use `repository.getChangelogEntries()` for the main list", () => {
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
    const mockEntries: ChangelogEntry[] = [
      {
        id: "cl-fresh-faq-1",
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
      },
      {
        id: "cl-fresh-ourprocess-1",
        timestamp: "2026-04-22T18:21:08.931Z",
        signal_type: "faq",
        asset_type: "service_page",
        url: "https://ritzbuilders.com/our-process",
        asset_name: "/our-process",
        change_description: "Our-process FAQ deduped to single block",
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
      },
    ];

    // Default repo: every getX method returns []. Individual tests override
    // getChangelogEntries via a custom property on the backing object below.
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
      // Phase 6A.8 (2026-04-28) — scorecard-client now uses
      // next/navigation hooks (useRouter + useSearchParams) for tab
      // deep-link support. Stub both for SSR smoke renders.
      vi.doMock("next/navigation", () => ({
        useRouter: () => ({
          push: () => {},
          replace: () => {},
          refresh: () => {},
          back: () => {},
          forward: () => {},
          prefetch: () => {},
        }),
        useSearchParams: () => new URLSearchParams(),
        usePathname: () => "/changes",
      }));
      vi.doMock("@/lib/seed-data.server", () => ({
        getOpportunities: vi.fn(async () => []),
        getResults: vi.fn(async () => []),
        hasActiveExperiment: vi.fn(async () => true),
      }));
      vi.doMock("@/domains/attribution/store", () => ({
        getEventDecisions: vi.fn(async () => []),
      }));
      vi.doMock("@/domains/product/url-watcher", () => ({
        maybeRefreshUrlWatcher: vi.fn(async () => {}),
      }));
      vi.doMock("@/domains/product/url-citation-history", () => ({
        buildUrlCitationHistory: () => ({
          series_by_url: {},
          date_range: { first: null, last: null },
        }),
        getSeriesForUrl: () => null,
        denseSeries: () => [],
        normalizeUrl: (u: string) => u,
      }));
      vi.doMock("@/domains/observations/read", () => ({
        latestWebsiteCrawlRun: () => null,
      }));
      vi.doMock("@/domains/attribution/change-outcome-store", () => ({
        loadAllChangeOutcomes: () => [],
      }));
      vi.doMock("@/lib/persistence/json-store", () => ({
        readStore: () => [],
        writeStore: vi.fn(async () => {}),
      }));
      vi.doMock("@/domains/pages/citation-evidence-store", () => ({
        getCitationEvidenceIndex: vi.fn(async () => null),
      }));
      vi.doMock("@/lib/flags", () => ({
        isEventTruthPreviewEnabled: () => false,
        // Phase 6A.6 (2026-04-28) — page now reads this flag to drive the
        // attribution-copy resolver's verdict_off vs verdict_baked branches.
        // Default OFF in tests matches production default.
        isLifecycleVerdictEnabled: () => false,
      }));
      // Sprint 7 Phase 7.5c/3 (2026-04-25) — page-store now exports a lazy
      // async function instead of a module-level array.
      vi.doMock("@/domains/pages/page-store", () => ({
        getOwnedPages: async () => [],
      }));
    });

    // Helper to inject a custom getChangelogEntries override into the repo
    // Proxy after beforeEach runs (so each test can pick its own behavior).
    const mockRepoWithChangelog = (
      getChangelogEntries: () => Promise<ChangelogEntry[]> | ChangelogEntry[],
    ) => {
      vi.doMock("@/lib/persistence/repositories", () => ({
        getRepository: () => buildRepoStub({ getChangelogEntries }),
      }));
    };

    it("renders changelog rows returned by getRepository().getChangelogEntries()", async () => {
      mockRepoWithChangelog(async () => mockEntries);
      const { default: ChangeScorecardPage } = await import(
        "@/app/(shell)/changes/page"
      );
      // 2026-06-15 — v2 is now the production default. This test pins the
      // LEGACY at-a-glance strip ("detected by scan" / "live verified"),
      // so force the legacy branch via the `?legacy=1` escape hatch. The
      // fresh-repo-read under test runs identically on both branches.
      const tree = await ChangeScorecardPage({
        searchParams: Promise.resolve({ legacy: "1" }),
      });
      const html = renderToStaticMarkup(tree as ReactElement);

      // Phase 6A.2 (2026-04-28): the at-a-glance strip is now lifecycle-tab
      // driven, not the legacy "changes tracked" total. Both mock entries
      // carry source_system="scan_detection", so the classifier puts them
      // both in the scan_confirmed bucket. Count of 2 must appear next to
      // the rendered label, proving the page actually consumed the
      // repo read.
      // 2026-05-06 demo-path fix: rendered label changed from
      // "scan-confirmed" → "detected by scan" (customer-friendly copy).
      expect(html).toMatch(/2\s*detected by scan/);
      // The at-a-glance strip leads with the "live verified" headline,
      // independent of how many rows are in any tab.
      expect(html).toContain("live verified");
      // Confirm we did not hit the honest-error branch.
      expect(html).not.toContain("Couldn&#x27;t load changes");
      expect(html).not.toContain("Couldn't load changes");
    });

    it("shows honest error state when the repository read throws", async () => {
      mockRepoWithChangelog(async () => {
        throw new Error("supabase connection refused");
      });
      const { default: ChangeScorecardPage } = await import(
        "@/app/(shell)/changes/page"
      );
      const tree = await ChangeScorecardPage();
      const html = renderToStaticMarkup(tree as ReactElement);

      // Honest error surface, NOT a silent fallback to cached stale data.
      // HTML-entity-encoded apostrophe (&#x27;) covers the React output case.
      expect(html).toMatch(/Couldn(&#x27;|')t load changes/);
      expect(html).toContain("supabase connection refused");
      // Phase 6A.2 (2026-04-28): the at-a-glance strip's "live verified"
      // label and the dedupe banner MUST NOT render in error state. Pre-6A.2
      // this asserted on "changes tracked" — same intent, new copy.
      expect(html).not.toContain("live verified");
      expect(html).not.toContain("possible duplicate");
    });
  });
});
