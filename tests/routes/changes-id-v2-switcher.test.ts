/**
 * /changes/[id] — canonical-Results redirect contract.
 *
 * Surface collapse (2026-06-15): the legacy detail layout and the
 * `?legacy=1` / `?v2=1` / `BEACON_CHANGES_V2` switcher were deleted.
 * Dead-body removal (2026-07-20): the v2 proof-brief render and its
 * legacy-only loaders were removed too. `/changes/[id]` now resolves the
 * changelog entry and redirects to the canonical Results surface. This test
 * pins the redirect destination for both an untracked historical row (lands
 * on /results) and a tracked change (deep-links to its one proof card).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
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

async function resolveRoute(): Promise<unknown> {
  const { default: ChangeDetailPage } = await import(
    "@/app/(shell)/changes/[id]/page"
  );
  return ChangeDetailPage({
    params: Promise.resolve({ id: mockEntry.id }),
  });
}

describe("/changes/[id] canonical-Results redirect contract", () => {
  beforeEach(() => {
    vi.resetModules();
    redirectMock.mockClear();
    proofLedgerMockRows = [];
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
    vi.doMock("@/lib/persistence/repositories", () => ({
      getRepository: () =>
        buildRepoStub({
          getChangelogEntries: async () => [mockEntry],
        }),
    }));
  });

  it("sends an untracked historical row to Results instead of rendering a second outcome engine", async () => {
    await expect(resolveRoute()).rejects.toThrow("NEXT_REDIRECT:/results");
    expect(redirectMock).toHaveBeenCalledWith("/results");
  }, 15_000);

  it("sends a tracked change to its one canonical Results proof card", async () => {
    proofLedgerMockRows = [{
      id: "faq::2026-04-22",
      page: mockEntry.url ?? "",
      path: "/faq",
      shippedAt: "2026-04-22T00:00:00.000Z",
    }];

    await expect(resolveRoute()).rejects.toThrow(
      "NEXT_REDIRECT:/results#proof-faq%3A%3A2026-04-22",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/results#proof-faq%3A%3A2026-04-22",
    );
  }, 15_000);
});
