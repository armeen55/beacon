/**
 * Reads-fresh route invariants - merged suite (Core 100K Phase 6).
 * Absorbs: routes/changes-page-reads-fresh, routes/changes-id-page-reads-fresh,
 * routes/today-recommendation-responses-fresh, routes/canonical-store-fresh.
 * Render paths must read fresh per request (no stale module memory, no ISR),
 * and canonical-store reads stay tenant-scoped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import {
  getResponseFromMap,
  isRecSuppressedFromMap,
} from "@/domains/product/recommendation-response-store";

// Default repo: every getX method returns []. Individual tests override a
// method (e.g. getChangelogEntries) via the overrides map.
// `forTenant(tenantId)` returns the same proxy so overrides apply to both
// unscoped and tenant-scoped reads.
const buildRepoStub = (overrides: Record<string, () => unknown> = {}) => {
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

const mockRepoWithChangelog = (
  getChangelogEntries: () => Promise<ChangelogEntry[]> | ChangelogEntry[],
) => {
  vi.doMock("@/lib/persistence/repositories", () => ({
    getRepository: () => buildRepoStub({ getChangelogEntries }),
  }));
};

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

  describe("Sprint 1 / Phase 1.3 — /changes fresh-read invariants", () => {
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

  describe("Sprint 1 / Phase 1.6 — /changes/[id] fresh-read invariants", () => {
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

// canonical-store fresh-per-render + tenant-scoping source-scans removed
// (Core 100K): these were implementation-detail source-text pins duplicated by
// the constitutional guards in tests/architecture/canonical-store-tenant-isolation
// and tests/architecture/13-egress-boundary. The behavioral fresh-read + pure
// suppression coverage above stays.
