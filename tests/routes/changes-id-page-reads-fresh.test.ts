import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { ChangelogEntry } from "@/domains/changelog/types";

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
