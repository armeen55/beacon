import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";

// ---------------------------------------------------------------------------
// Sprint 4 / Phase 4.2 regression tests — /recommendations response state
// reads fresh from the repository, not from module-level cache.
//
// Pre-fix: /recommendations/page.tsx called safeGetResponse(rec.stableKey)
// which read from the module-level `recommendationResponses` array. That
// array is seeded via `ensureRecommendationResponsesSeeded()` behind a
// `_dbSeeded` one-shot flag — cached per-lambda for the lambda's lifetime.
// Once lambda A has seeded, a write from lambda B was invisible to A even
// after `revalidatePath`. Classic cross-lambda staleness.
//
// Post-fix: the render path fetches getRepository().getRecommendationResponses()
// per request. Module-level state still exists (today-data and
// replication-engine read it) but never feeds the render decoration.
//
// These tests prove:
//   (1) source doesn't import `getResponse` from the response store
//   (2) source DOES call `getRecommendationResponses()` via repository
//   (3) force-dynamic is set
//   (4) fresh repo data decorates the queue even when module memory is stale
//   (5) stale module memory cannot override fresh repo data
//   (6) repo read failure surfaces a diagnostic banner (not stale success)
// ---------------------------------------------------------------------------

const PAGE_PATH = resolve(
  __dirname,
  "../../src/app/(shell)/recommendations/page.tsx",
);
const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");

describe("Sprint 4 / Phase 4.2 — /recommendations fresh-read invariants", () => {
  describe("structural invariants (source-level)", () => {
    it("does NOT import `getResponse` from recommendation-response-store", () => {
      // `ensureRecommendationResponsesSeeded` is allowed (it seeds state
      // still used by today-data + replication-engine, out of Sprint 4.2
      // scope). What must NOT appear is `getResponse` — which is the
      // function that reads the module-level array and caused the
      // cross-lambda staleness bug.
      const responseStoreImports = PAGE_SOURCE.match(
        /import\s+\{[^}]+\}\s+from\s+["'][^"']*recommendation-response-store["']/g,
      );
      expect(responseStoreImports).not.toBeNull();
      for (const block of responseStoreImports!) {
        expect(block).not.toMatch(/\bgetResponse\b/);
      }
    });

    it("DOES call `getRepository().getRecommendationResponses()` for decoration", () => {
      expect(PAGE_SOURCE).toMatch(
        /getRepository\(\)\.getRecommendationResponses\(\)/,
      );
    });

    it("declares `export const dynamic = \"force-dynamic\"`", () => {
      expect(PAGE_SOURCE).toMatch(
        /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
      );
    });

    it("removed the now-dead `safeGetResponse` helper", () => {
      // If this helper is still present, some caller is still using the
      // stale module path for decoration.
      expect(PAGE_SOURCE).not.toMatch(/\bsafeGetResponse\b/);
    });
  });

  describe("behavioral invariants (rendered output)", () => {
    const mockQueueRec = {
      stableKey: "rec-alpha",
      type: "strengthen_page_copy",
      title: "Strengthen /x",
      description: "",
      clusterLabel: "Alpha cluster",
      clusterKind: "topic" as const,
      resolution: null,
    };

    const buildRepoStub = (
      overrides: Record<string, () => unknown> = {},
    ) => {
      return new Proxy({} as Record<string, unknown>, {
        get(_target, prop: string) {
          if (prop in overrides) return overrides[prop];
          return async () => [];
        },
      });
    };

    beforeEach(() => {
      vi.resetModules();
      vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));

      // Canonical store — ensureCanonicalStoresSeeded is a no-op in tests.
      // trackedPrompts/observations/entities return [] so the matrix is
      // trivial but non-null.
      vi.doMock("@/storage/canonical-store", () => ({
        ensureCanonicalStoresSeeded: vi.fn(async () => {}),
        trackedPrompts: [],
        promptAnswerObservations: [],
        trackedEntities: [],
      }));

      vi.doMock("@/domains/prompts/decision-matrix", () => ({
        buildPromptDecisionMatrix: () => ({
          date: "2026-04-24",
          prompts: [],
        }),
      }));

      vi.doMock("@/domains/recommendations/generate", () => ({
        generateRecommendations: () => [],
      }));

      vi.doMock("@/domains/recommendations/page-inventory", () => ({
        buildPageInventory: () => [],
      }));

      vi.doMock("@/domains/recommendations/resolve-page-intent", () => ({
        resolvePageIntent: () => [],
      }));

      vi.doMock("@/domains/recommendations/adjudicate", () => ({
        adjudicateFromCacheOnly: async () => ({ status: "miss" as const }),
        applyAdjudicationToResolution: (c: unknown) => c,
      }));

      // Prioritize returns a single-row queue containing our test rec so
      // the decoration path actually has something to touch.
      vi.doMock("@/domains/recommendations/prioritize", () => ({
        prioritizeRecommendations: () => ({
          queue: [mockQueueRec],
          watchlist: [],
        }),
      }));

      vi.doMock("@/domains/pages/page-store", () => ({
        allPages: [],
      }));

      // Mock RecommendationsClient so tests can see the decorated `queue`
      // props without pulling in the whole client renderer. Must use the
      // absolute alias path (the page imports via "./recommendations-client"
      // but vitest resolves the mock against the source-relative path — the
      // alias path catches both).
      vi.doMock(
        "@/app/(shell)/recommendations/recommendations-client",
        () => ({
          RecommendationsClient: ({
            queue,
          }: {
            queue: Array<{
              rec: { stableKey: string };
              response: RecommendationResponse | null;
            }>;
          }) => {
            const tag = queue
              .map(
                (d) =>
                  `[${d.rec.stableKey}::${d.response ? d.response.status : "none"}]`,
              )
              .join(",");
            return createElement("div", {
              "data-decoration-summary": tag,
            });
          },
        }),
      );
      // Relative path mock too — matches page.tsx's actual import specifier.
      vi.doMock("./recommendations-client", () => ({
        RecommendationsClient: ({
          queue,
        }: {
          queue: Array<{
            rec: { stableKey: string };
            response: RecommendationResponse | null;
          }>;
        }) => {
          const tag = queue
            .map(
              (d) =>
                `[${d.rec.stableKey}::${d.response ? d.response.status : "none"}]`,
            )
            .join(",");
          return createElement("div", {
            "data-decoration-summary": tag,
          });
        },
      }));
    });

    const mockResponseStore = (options: {
      moduleArray: RecommendationResponse[];
      seedEnsure?: () => Promise<void>;
    }) => {
      vi.doMock("@/domains/product/recommendation-response-store", () => ({
        recommendationResponses: options.moduleArray,
        ensureRecommendationResponsesSeeded:
          options.seedEnsure ?? (async () => {}),
        // `getResponse` is exported for today-data + replication-engine. The
        // page MUST NOT import it (structural test above); but we still mock
        // it to match the module shape.
        getResponse: (recId: string) =>
          options.moduleArray.find((r) => r.recId === recId),
        isRecSuppressed: () => false,
      }));
    };

    const mockRepoWithResponses = (
      getRecommendationResponses: () =>
        | Promise<RecommendationResponse[]>
        | RecommendationResponse[],
    ) => {
      vi.doMock("@/lib/persistence/repositories", () => ({
        getRepository: () => buildRepoStub({ getRecommendationResponses }),
      }));
    };

    it("decorates rec with a response that exists ONLY in the repo (not in module memory)", async () => {
      mockResponseStore({ moduleArray: [] });
      mockRepoWithResponses(async () => [
        {
          recId: "rec-alpha",
          status: "accepted",
          respondedAt: "2026-04-24T10:00:00.000Z",
          deferUntil: null,
          targetPageUrl: "https://example.com/x",
          patternId: null,
        },
      ]);
      const { default: RecommendationsPage } = await import(
        "@/app/(shell)/recommendations/page"
      );
      const tree = await RecommendationsPage();
      const html = renderToStaticMarkup(tree as ReactElement);
      expect(html).toContain('data-decoration-summary="[rec-alpha::accepted]"');
    });

    it("stale module memory CANNOT override fresh repo data (repo wins)", async () => {
      mockResponseStore({
        moduleArray: [
          {
            recId: "rec-alpha",
            status: "dismissed",
            respondedAt: "2026-04-20T10:00:00.000Z",
            deferUntil: null,
            targetPageUrl: null,
            patternId: null,
          },
        ],
      });
      mockRepoWithResponses(async () => [
        {
          recId: "rec-alpha",
          status: "accepted",
          respondedAt: "2026-04-24T10:00:00.000Z",
          deferUntil: null,
          targetPageUrl: "https://example.com/x",
          patternId: null,
        },
      ]);
      const { default: RecommendationsPage } = await import(
        "@/app/(shell)/recommendations/page"
      );
      const tree = await RecommendationsPage();
      const html = renderToStaticMarkup(tree as ReactElement);
      // Fresh wins — render shows accepted, not dismissed.
      expect(html).toContain('data-decoration-summary="[rec-alpha::accepted]"');
      expect(html).not.toContain("dismissed");
    });

    it("missing response in repo produces `none` decoration even if module memory has stale data", async () => {
      // Module memory has stale response, repo has none. Fresh-read means
      // the rec decorates as `none` — operator sees the rec as un-responded,
      // not as dismissed-because-old-lambda-thought-so.
      mockResponseStore({
        moduleArray: [
          {
            recId: "rec-alpha",
            status: "dismissed",
            respondedAt: "2026-04-20T10:00:00.000Z",
            deferUntil: null,
            targetPageUrl: null,
            patternId: null,
          },
        ],
      });
      mockRepoWithResponses(async () => []);
      const { default: RecommendationsPage } = await import(
        "@/app/(shell)/recommendations/page"
      );
      const tree = await RecommendationsPage();
      const html = renderToStaticMarkup(tree as ReactElement);
      expect(html).toContain('data-decoration-summary="[rec-alpha::none]"');
    });

    it("repo read failure surfaces the diagnostic banner (not stale success)", async () => {
      mockResponseStore({
        moduleArray: [
          {
            recId: "rec-alpha",
            status: "accepted",
            respondedAt: "2026-04-20T10:00:00.000Z",
            deferUntil: null,
            targetPageUrl: null,
            patternId: null,
          },
        ],
      });
      mockRepoWithResponses(async () => {
        throw new Error("supabase timeout");
      });
      const { default: RecommendationsPage } = await import(
        "@/app/(shell)/recommendations/page"
      );
      const tree = await RecommendationsPage();
      const html = renderToStaticMarkup(tree as ReactElement);
      // Diagnostic banner is rendered.
      expect(html).toContain(
        "Some recommendation data couldn",
      );
      // Fresh-read fell back to []; decoration is `none`, NOT the stale
      // module memory's `accepted`.
      expect(html).toContain('data-decoration-summary="[rec-alpha::none]"');
    });
  });
});
