/**
 * Reads-fresh route invariants - merged suite (Core 100K Phase 6).
 * Absorbs: routes/changes-page-reads-fresh, routes/changes-id-page-reads-fresh,
 * routes/today-recommendation-responses-fresh, routes/canonical-store-fresh.
 * Render paths must read fresh per request (no stale module memory, no ISR),
 * and canonical-store reads stay tenant-scoped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import {
  getResponseFromMap,
  isRecSuppressedFromMap,
} from "@/domains/product/recommendation-response-store";

describe("/changes reads fresh", () => {

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

  // IA consolidation (2026-06-23): the fresh-read timeline body moved from
  // changes/page.tsx into changes/results-timeline.tsx (embedded in Results /results).
  // The /changes index is now a thin redirect. The fresh-read invariants below
  // therefore target results-timeline.tsx; force-dynamic lives on the /results page.
  const PAGE_PATH = resolve(
    __dirname,
    "../../src/app/(shell)/changes/results-timeline.tsx",
  );
  const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");
  const PROOF_PAGE_SOURCE = readFileSync(
    resolve(__dirname, "../../src/app/(shell)/results/page.tsx"),
    "utf8",
  );

  describe("Sprint 1 / Phase 1.3 — /changes fresh-read invariants", () => {
    describe("structural invariants (source-level)", () => {
      it("does NOT import mutable `changelogEntries` from seed-data.server", () => {
        // The mutable array `changelogEntries` lives at module scope in
        // seed-data.server and is hydrated once per lambda cold start. Any
        // render-visible import of it re-introduces the cross-lambda stale-read
        // bug. Verdict-engine consolidation (2026-07-21) removed the timeline's
        // seed-data.server imports entirely (getResults/getOpportunities fed the
        // retired scorecard), so today there is no import block at all; if one
        // ever returns it must not carry the mutable array.
        const importBlocks = PAGE_SOURCE.match(
          /import\s+\{[^}]+\}\s+from\s+["']@\/lib\/seed-data\.server["']/g,
        );
        for (const block of importBlocks ?? []) {
          expect(block).not.toMatch(/\bchangelogEntries\b/);
        }
      });

      it("DOES use `repository.getChangelogEntries()` for the main list", () => {
        expect(PAGE_SOURCE).toMatch(/getChangelogEntries\(\)/);
        expect(PAGE_SOURCE).toMatch(/const\s+repository\s*=\s*getRepository\(\)/);
      });

      it("the /results Results page (which embeds the timeline) declares force-dynamic", () => {
        expect(PROOF_PAGE_SOURCE).toMatch(
          /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
        );
        // And it embeds the extracted timeline component.
        expect(PROOF_PAGE_SOURCE).toMatch(/ResultsTimeline/);
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
        vi.doMock("@/domains/product/url-watcher", () => ({
          maybeRefreshUrlWatcher: vi.fn(async () => {}),
        }));
        // Verdict-engine consolidation (2026-07-21): the timeline joins rows to
        // the request-memoized /results measured-ledger snapshot. Stub it empty
        // so this suite pins the fresh changelog read, not the proof join.
        vi.doMock("@/app/(shell)/results/results-ledger-data", () => ({
          loadResultsLedgerSurface: vi.fn(async () => ({
            ledger: [],
            computedAt: null,
            closedContaminationById: new Map(),
          })),
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
        const { ResultsTimeline } = await import(
          "@/app/(shell)/changes/results-timeline"
        );
        // IA consolidation (2026-06-23): the timeline runs the SAME fresh
        // `getChangelogEntries()` read — this pins that the read flows through to
        // the rendered V2 timeline rather than the honest-error branch.
        const tree = await ResultsTimeline();
        const html = renderToStaticMarkup(tree as ReactElement);

        // The V2 proof-timeline container renders when the page consumed a
        // non-empty changelog read (both mock entries flow through to the
        // enriched rows the timeline cards project from).
        expect(html).toContain('data-changes-layout="v2-proof-timeline"');
        // Confirm we did not hit the honest-error branch.
        expect(html).not.toContain("Couldn&#x27;t load changes");
        expect(html).not.toContain("Couldn't load changes");
      });

      it("shows honest error state when the repository read throws", async () => {
        mockRepoWithChangelog(async () => {
          throw new Error("supabase connection refused");
        });
        const { ResultsTimeline } = await import(
          "@/app/(shell)/changes/results-timeline"
        );
        const tree = await ResultsTimeline();
        const html = renderToStaticMarkup(tree as ReactElement);

        // Honest error surface, NOT a silent fallback to cached stale data, and
        // NOT a leak of the raw exception. The heading + next step render, while
        // the raw error (store name, "connection refused", table names) is logged
        // server-side only and must never reach the operator's HTML.
        expect(html).toContain("I could not read your change history just now.");
        expect(html).toContain("Try again in a minute.");
        expect(html).not.toContain("supabase connection refused");
        expect(html).not.toContain("supabase");
        expect(html).not.toContain("connection refused");
        expect(html).not.toContain("changelog_entries");
        // Phase 6A.2 (2026-04-28): the at-a-glance strip's "live verified"
        // label and the dedupe banner MUST NOT render in error state. Pre-6A.2
        // this asserted on "changes tracked" — same intent, new copy.
        expect(html).not.toContain("live verified");
        expect(html).not.toContain("possible duplicate");
      });
    });
  });
});

describe("/changes/[id] reads fresh", () => {

  // ---------------------------------------------------------------------------
  // Sprint 1 / Phase 1.6 regression tests — /changes/[id] detail route.
  //
  // /changes/[id] was one click away from /changes and still read the module-
  // level `changelogEntries` array from @/lib/seed-data.server. After Phase
  // 1.2 fixed /changes, a scan_detection row written by a different lambda
  // would appear on the main list but 404 on its own detail page. This file
  // proves the route reads from the repository per request, redirects to the
  // canonical Results surface, and shows an honest error on read failure / a
  // standard notFound when the id is genuinely absent from Supabase.
  //
  // Surface collapse (2026-06-15) + dead-body removal (2026-07-20): the route
  // renders no detail body of its own — it resolves the entry and redirects.
  // ---------------------------------------------------------------------------

  const PAGE_PATH = resolve(
    __dirname,
    "../../src/app/(shell)/changes/[id]/page.tsx",
  );
  const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");

  describe("Sprint 1 / Phase 1.6 — /changes/[id] fresh-read invariants", () => {
    describe("structural invariants (source-level)", () => {
      it("does NOT import mutable `changelogEntries` from seed-data.server", () => {
        // The route no longer imports from seed-data.server at all after the
        // dead-body removal. The invariant that must hold either way: no
        // `changelogEntries` import from seed-data.server (the root of the
        // cross-lambda stale-read bug).
        const importBlocks =
          PAGE_SOURCE.match(
            /import\s+\{[^}]+\}\s+from\s+["']@\/lib\/seed-data\.server["']/g,
          ) ?? [];
        for (const block of importBlocks) {
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
        // notFound() / redirect() throw special sentinels in Next.js.
        // Represent with typed errors so tests can assert on them.
        vi.doMock("next/navigation", () => ({
          notFound: () => {
            const err = new Error("NEXT_NOT_FOUND");
            (err as unknown as { digest: string }).digest = "NEXT_NOT_FOUND";
            throw err;
          },
          redirect: (href: string) => {
            throw new Error(`NEXT_REDIRECT:${href}`);
          },
        }));
        vi.doMock("@/domains/proof-gsc/load-ledger", () => ({
          loadProofLedgerPersisted: async () => [],
        }));
      });

      const mockRepoWithChangelog = (
        getChangelogEntries: () => Promise<ChangelogEntry[]> | ChangelogEntry[],
      ) => {
        vi.doMock("@/lib/persistence/repositories", () => ({
          getRepository: () => buildRepoStub({ getChangelogEntries }),
        }));
      };

      it("finds a repository-only scan row and sends it to the canonical Results surface", async () => {
        mockRepoWithChangelog(async () => [mockEntry]);
        const { default: ChangeDetailPage } = await import(
          "@/app/(shell)/changes/[id]/page"
        );
        await expect(ChangeDetailPage({
          params: Promise.resolve({ id: mockEntry.id }),
        })).rejects.toThrow("NEXT_REDIRECT:/results");
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
});

describe("Today recommendation responses read fresh", () => {

  // ---------------------------------------------------------------------------
  // Sprint 4 / Phase 4.3 regression tests — Today's recommendation response
  // freshness across Vercel lambdas.
  //
  // today-data.ts used to call isRecSuppressed / getResponse / read
  // `recommendationResponses` directly from the module-level array. Same
  // cross-lambda staleness bug as Phase 4.2 fixed on /recommendations. A rec
  // the operator dismissed on lambda B would reappear as Top Pick on lambda A
  // whose `_dbSeeded=true` was already cached.
  //
  // Phase 4.3 adds pure `getResponseFromMap` / `isRecSuppressedFromMap`
  // helpers in the response store, and today-data fetches responses fresh
  // from the repository per render, builds a Map, and uses the pure helpers.
  //
  // 2026-07-01 (FINAL PREMIUM PLAN item 101): the legacy today-data.ts
  // loader was deleted. 2026-07-21 (Lane S): the today-v2-data.ts section
  // loaders (the structural-pin subject that replaced it) were dead code and
  // were also deleted, so only the pure-helper unit pins remain here.
  //
  // These tests prove:
  //   Pure helpers (unit):
  //     (5) `isRecSuppressedFromMap` suppresses a dismissed rec
  //     (6) `isRecSuppressedFromMap` suppresses a deferred rec while
  //         `deferUntil` is in the future
  //     (7) `isRecSuppressedFromMap` does NOT suppress a deferred rec after
  //         `deferUntil` has passed
  //     (8) `isRecSuppressedFromMap` does NOT suppress an accepted rec
  //     (9) `isRecSuppressedFromMap` does NOT suppress a rec that has no
  //         response in the map (fresh repo truth)
  //    (10) `getResponseFromMap` returns the exact record stored in the map
  //    (11) `getResponseFromMap` returns undefined when rec is absent —
  //         meaning a stale module-level dismissal CANNOT bleed through the
  //         fresh map (the helper only sees what was passed in)
  // ---------------------------------------------------------------------------

  describe("Sprint 4 / Phase 4.3 — Today fresh-read invariants", () => {
    describe("pure helpers (unit)", () => {
      const makeMap = (rows: RecommendationResponse[]) =>
        new Map(rows.map((r) => [r.recId, r]));

      const baseRow = (
        overrides: Partial<RecommendationResponse>,
      ): RecommendationResponse => ({
        recId: "rec-1",
        status: "accepted",
        respondedAt: "2026-04-24T10:00:00.000Z",
        deferUntil: null,
        targetPageUrl: null,
        patternId: null,
        ...overrides,
      });

      it("suppresses a dismissed rec", () => {
        const m = makeMap([baseRow({ status: "dismissed" })]);
        expect(isRecSuppressedFromMap("rec-1", m)).toBe(true);
      });

      it("suppresses a deferred rec while deferUntil is in the future", () => {
        const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
        const m = makeMap([
          baseRow({ status: "deferred", deferUntil: future }),
        ]);
        expect(isRecSuppressedFromMap("rec-1", m)).toBe(true);
      });

      it("does NOT suppress a deferred rec once deferUntil has passed", () => {
        const past = new Date(Date.now() - 86_400_000).toISOString();
        const m = makeMap([
          baseRow({ status: "deferred", deferUntil: past }),
        ]);
        expect(isRecSuppressedFromMap("rec-1", m)).toBe(false);
      });

      it("does NOT suppress an accepted rec (operator saw it; keeps visible in Today card with state)", () => {
        const m = makeMap([baseRow({ status: "accepted" })]);
        expect(isRecSuppressedFromMap("rec-1", m)).toBe(false);
      });

      it("does NOT suppress a rec that has no response in the map", () => {
        const m = makeMap([]);
        expect(isRecSuppressedFromMap("rec-1", m)).toBe(false);
      });

      it("getResponseFromMap returns the exact record stored in the map", () => {
        const row = baseRow({ status: "deferred", deferUntil: "2026-05-01T00:00:00.000Z" });
        const m = makeMap([row]);
        expect(getResponseFromMap("rec-1", m)).toEqual(row);
      });

      it("getResponseFromMap returns undefined when rec is absent — stale module memory cannot leak through", () => {
        // The key invariant: callers passing the fresh Map will ONLY see
        // what the fresh repo fetch returned. A stale module-level dismissal
        // cannot bleed into this call because the helper has no access to
        // that array.
        const m = makeMap([]);
        expect(getResponseFromMap("rec-1", m)).toBeUndefined();
      });

      it("suppresses a rec dismissed on /recommendations (stableKey key-space) — canonical-key alignment", () => {
        // Exact production scenario that hotfix addresses:
        //
        // Operator dismisses on /recommendations. /recommendations/actions.ts
        // writes `recommendation_responses.rec_id = payload.stableKey` which
        // has the shape `{type}:{clusterKind}:{clusterLabel}`.
        //
        // Today fetches fresh responses into a Map keyed by recId. When
        // Today's new-pipeline queue item is passed to suppression,
        // `rec.stableKey` must match. If Today used `rec.id` from the OLD
        // engine (different key space), the Map lookup would miss and
        // suppression would silently no-op.
        //
        // This test pins the canonical-key contract: a stableKey-formatted
        // key in the Map suppresses via the same stableKey lookup.
        const stableKey =
          "create_cluster_page:topic:Shield: Custom Home Builder Bay Area";
        const m = makeMap([
          baseRow({ recId: stableKey, status: "dismissed" }),
        ]);
        expect(isRecSuppressedFromMap(stableKey, m)).toBe(true);
        // And if Today were (wrongly) to call with a different key (e.g.
        // old-engine `rec.id` shape), suppression would NOT fire — the
        // helper only sees what you pass. This pins the mismatch failure
        // mode so a future regression (swapping rec.stableKey for rec.id)
        // would flip this assertion visibly.
        expect(
          isRecSuppressedFromMap("rec-strengthen-custom-home-builder", m),
        ).toBe(false);
      });
    });
  });
});

describe("canonical-store fresh-per-render + tenant scoping", () => {

  // ---------------------------------------------------------------------------
  // Sprint 4 / Phase 4.9 regression tests — canonical-store fresh-per-render.
  //
  // The module-level arrays in src/storage/canonical-store.ts are seeded
  // exactly once per Vercel lambda behind `_canonSeeded`. After the 07:00 UTC
  // poll writes fresh observations/snapshots to Supabase, already-warm
  // lambdas kept serving yesterday's data for Today, Recommendations,
  // Prompts, Prompt-detail, Settings/prompts.
  //
  // Phase 4.9 adds `loadFreshCanonicalData()` — a Supabase-bypass helper
  // that pulls all four canonical tables fresh every render. Render paths
  // use it; non-render consumers (prompt-library, url-citation-history,
  // poll pipeline) still read the module-level arrays.
  //
  // These tests prove:
  //   (1) `loadFreshCanonicalData` fetches all four tables fresh via the
  //       repository abstraction (bypasses `_canonSeeded`)
  //   (2) /recommendations source uses it + doesn't import the module
  //       arrays directly
  //   (3) /prompts source uses it + doesn't import the module arrays
  //   (4) /prompts/[id] source uses it
  //   (5) /settings/prompts source uses it
  //   (6) [retired 2026-07-21, Lane S] the /today section loaders that read
  //       the canonical bundle fresh per render (today-v2-data.ts) were dead
  //       code and were deleted; NO render path calls loadFreshCanonicalData
  //       any more, which is pinned as a stronger invariant below and in
  //       tests/architecture/13-egress-boundary.test.ts.
  // ---------------------------------------------------------------------------

  const FILES = {
    canonicalStore: resolve(__dirname, "../../src/storage/canonical-store.ts"),
    recommendations: resolve(
      __dirname,
      "../../src/app/(shell)/recommendations/page.tsx",
    ),
    // Surface-collapse (2026-07-21): the standalone /prompts + /prompts/[id]
    // render paths AND the /settings/prompts management UI were deleted; their
    // fresh-per-render pins went with them. Lane S then deleted the dead
    // today-v2-data.ts loaders; the surviving /today gate loader is pinned below.
    todayGate: resolve(__dirname, "../../src/app/(shell)/today-gate-data.ts"),
  };

  const SRC = Object.fromEntries(
    Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, "utf8")]),
  ) as Record<keyof typeof FILES, string>;

  describe("Sprint 4 / Phase 4.9 — canonical-store fresh-per-render", () => {
    // The "loadFreshCanonicalData helper" describes were retired 2026-07-21
    // (CORE 100K): the helper was deleted after its last render-time callers
    // died with the today-v2 loader family. The tenant-scoping invariants on
    // the surviving seeding path stay below.

    describe("Sprint 7 Phase 7.5c/2 — canonical-store tenant-scoping invariants", () => {
      const CANONICAL_STORE_PATH = resolve(
        __dirname,
        "../../src/storage/canonical-store.ts",
      );
      const CANONICAL_STORE_SOURCE = readFileSync(CANONICAL_STORE_PATH, "utf8");

      it("Tier A reads (getPromptAnswerObservations + getDailyMetricSnapshots) go through .forTenant(...)", () => {
        // The canonical-store.ts source must contain a `forTenant` chain that
        // covers both Tier A methods. We don't anchor the exact line because
        // the file has 2 functions doing this; we just assert the patterns
        // exist somewhere in the file.
        expect(CANONICAL_STORE_SOURCE).toMatch(
          /tenantRepo\.getPromptAnswerObservations\(/,
        );
        expect(CANONICAL_STORE_SOURCE).toMatch(
          /tenantRepo\.getDailyMetricSnapshots\(/,
        );
        // The construction must come from forTenant.
        expect(CANONICAL_STORE_SOURCE).toMatch(
          /const\s+tenantRepo\s*=\s*repo\.forTenant\(/,
        );
      });

      it("Tier A reads are NEVER called on the unscoped repo (must go through tenantRepo)", () => {
        // The unscoped form on Tier A methods is the leak path. Catches drift.
        expect(CANONICAL_STORE_SOURCE).not.toMatch(
          /\brepo\.getPromptAnswerObservations\(/,
        );
        expect(CANONICAL_STORE_SOURCE).not.toMatch(
          /\brepo\.getDailyMetricSnapshots\(/,
        );
        expect(CANONICAL_STORE_SOURCE).not.toMatch(
          /getRepository\(\)\.getPromptAnswerObservations\(/,
        );
        expect(CANONICAL_STORE_SOURCE).not.toMatch(
          /getRepository\(\)\.getDailyMetricSnapshots\(/,
        );
      });

      it("tracked_prompts + tracked_entities go through the tenant-scoped facade (customer-2 isolation fix, 2026-05-06)", () => {
        // FLIP of the pre-2026-05-06 invariant. Earlier the Phase 7.5a audit
        // claimed tracked_* tables had no tenant_id column and so could only
        // be read unscoped on the plain repo. The 2026-05-06 customer-2
        // onboarding audit re-checked this and found:
        //   - Both stores are TENANT_SCOPED in store-classification.ts.
        //   - Rows on disk carry tenant_id (operator's stamping migration).
        //   - The Supabase schema scopes via account_id (the slug), not
        //     tenant_id. The fix resolves the slug via getTenant(tenantId).
        // Both backends now implement tenant-scoped getTrackedPrompts /
        // getTrackedEntities, and the canonical fresh-load path reads them
        // through tenantRepo to keep customer-2 isolated from Ritz.
        // Sibling guard: tests/architecture/canonical-store-tenant-isolation.test.ts
        expect(CANONICAL_STORE_SOURCE).toMatch(
          /tenantRepo\.getTrackedPrompts\s*\(/,
        );
        expect(CANONICAL_STORE_SOURCE).toMatch(
          /tenantRepo\.getTrackedEntities\s*\(/,
        );
        // Negative invariant: no raw repo.getTracked* in the canonical
        // fresh-load path. Falls back to the architecture-invariant check.
        expect(CANONICAL_STORE_SOURCE).not.toMatch(
          /\brepo\.getTrackedEntities\s*\(/,
        );
        expect(CANONICAL_STORE_SOURCE).not.toMatch(
          /\brepo\.getTrackedPrompts\s*\(/,
        );
      });
    });

    describe("render-path structural invariants", () => {
      it("/recommendations index redirects; the persisted loader never touches the canonical fan-out", () => {
        // Move 5 (2026-07-01): the /recommendations index is now a redirect to
        // /changes?status=ready (a duplicate of the canonical Changes list).
        // CORE 100K Lane A (2026-07-21): the dead in-file LLM queue builder
        // (`loadLiveRecommendationQueue`) was the ONLY load-queue caller of
        // `loadFreshCanonicalData`; it was deleted. The surviving persisted
        // loader reads the tenant repo directly, so the STRONGER guarantee is
        // that load-queue never performs the 4-table canonical fan-out at all
        // (also pinned by tests/architecture/13-egress-boundary).
        expect(SRC.recommendations).toMatch(/\bredirect\(/);
        const loadQueueSrc = readFileSync(
          resolve(
            __dirname,
            "../../src/domains/recommendations/load-queue.ts",
          ),
          "utf8",
        );
        expect(loadQueueSrc).not.toMatch(/loadFreshCanonicalData/);
      });

      // Surface-collapse (2026-07-21): the "/prompts" and "/prompts/[id]"
      // direct-tenant-repo-read pins were removed with those deleted render
      // paths. Their scoped-read perf invariants covered pages that no longer
      // exist; the tenant-repo read patterns they exercised remain pinned by
      // the surviving settings/prompts + today-v2-data assertions here and by
      // tests/architecture/*scoped-reads*.

      it("the /today gate loader never imports canonical-store (statically or dynamically)", () => {
        // Lane S (2026-07-21): the dead today-v2-data.ts section loaders were
        // the LAST render-time callers of `loadFreshCanonicalData`. The
        // surviving gate loader reads only lean tenant-scoped repo projections,
        // so the render path must not regrow a canonical-store dependency.
        expect(SRC.todayGate).not.toMatch(/@\/storage\/canonical-store/);
        expect(SRC.todayGate).not.toMatch(/loadFreshCanonicalData/);
        expect(SRC.recommendations).toMatch(/\bredirect\(/);
      });
    });

    describe("non-render callers preserved", () => {
      it("canonical-store.ts exports cached async getters for non-render consumers", () => {
        // Phase 7.8e-2 (2026-04-26): the module-level mutable-array exports
        // were lifted to cached async getters. Non-render consumers
        // (url-citation-history, import-orchestrator, scanning, etc.) now
        // call `await getX()` instead of importing the array reference.
        expect(SRC.canonicalStore).toMatch(
          /export\s+const\s+getTrackedPrompts\s*=\s*cache\(/,
        );
        expect(SRC.canonicalStore).toMatch(
          /export\s+const\s+getPromptAnswerObservations\s*=\s*cache\(/,
        );
        expect(SRC.canonicalStore).toMatch(
          /export\s+const\s+getTrackedEntities\s*=\s*cache\(/,
        );
        expect(SRC.canonicalStore).toMatch(
          /export\s+const\s+getDailyMetricSnapshots\s*=\s*cache\(/,
        );
      });

      it("canonical-store.ts still exports ensureCanonicalStoresSeeded", () => {
        // Non-render consumers still call this at their boundary. Phase 4.9
        // does NOT deprecate it — the render paths moved to fresh reads,
        // but the seed function is still active for module-array consumers.
        expect(SRC.canonicalStore).toMatch(
          /export\s+async\s+function\s+ensureCanonicalStoresSeeded/,
        );
      });
    });
  });
});
