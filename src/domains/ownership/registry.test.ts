/**
 * registry.test.ts (BEACON_500 item N2 - query-to-page ownership registry).
 *
 * Pins: gsc_ranks resolution (clear leader vs close contest confidence),
 * serp_cluster resolution (only fills gaps gsc_ranks did not resolve),
 * contender floor (MIN_CONTENDER_SHARE), resolveOwner's exact + topic-token
 * fallback matching (including the strict-subset rule), the conflict list's
 * worst-first ordering, and the registryGscConflictsAsClusters adapter used
 * by the conflict-surface wiring. No I/O, this file never touches Supabase.
 */
import { describe, it, expect } from "vitest";

import {
  buildOwnershipRegistry,
  resolveOwner,
  hasKnownOwner,
  registryGscConflictsAsClusters,
  type OwnershipRegistry,
} from "./registry";
import type { GscCannibalizationCase } from "@/domains/recommendation-intelligence/gsc-cannibalization";
import type { IntentCluster } from "@/domains/serp/intent-clusters";

function cannibalCase(over: Partial<GscCannibalizationCase> & { query: string }): GscCannibalizationCase {
  return {
    competingUrls: [],
    urlCount: 0,
    totalClicks: 0,
    totalImpressions: 0,
    leadUrl: "",
    bestPosition: 0,
    weightedPosition: 0,
    ...over,
  };
}

function cluster(over: Partial<IntentCluster> & { clusterId: string }): IntentCluster {
  return {
    queries: [],
    sharedUrls: [],
    ownPagesInCluster: [],
    conflict: false,
    ...over,
  };
}

describe("buildOwnershipRegistry / gsc_ranks basis", () => {
  it("resolves a clear leader (>=25% margin, >=200 impressions) as high confidence", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "persian new year",
          totalImpressions: 1000,
          competingUrls: [
            { url: "https://x.com/nowruz", clicks: 50, impressions: 900, position: 3 },
            { url: "https://x.com/holidays", clicks: 2, impressions: 100, position: 12 },
          ],
        }),
      ],
      clusters: [],
    });
    const entry = resolveOwner(registry, "persian new year");
    expect(entry?.owner).toBe("https://x.com/nowruz");
    expect(entry?.basis).toBe("gsc_ranks");
    expect(entry?.confidence).toBe("high");
    expect(entry?.contenders.map((c) => c.url)).toEqual(["https://x.com/holidays"]);
  });

  it("resolves a close contest as medium confidence with the runner-up as a contender", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "iranian new year",
          totalImpressions: 1000,
          competingUrls: [
            { url: "https://x.com/a", clicks: 10, impressions: 550, position: 5 },
            { url: "https://x.com/b", clicks: 8, impressions: 450, position: 6 },
          ],
        }),
      ],
      clusters: [],
    });
    const entry = resolveOwner(registry, "iranian new year");
    expect(entry?.owner).toBe("https://x.com/a");
    expect(entry?.confidence).toBe("medium");
    expect(entry?.contenders.length).toBe(1);
  });

  it("drops a contender below the MIN_CONTENDER_SHARE floor (a stray 1% is noise, not cannibalization)", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "solo query",
          totalImpressions: 1000,
          competingUrls: [
            { url: "https://x.com/main", clicks: 50, impressions: 990, position: 2 },
            { url: "https://x.com/stray", clicks: 0, impressions: 10, position: 40 },
          ],
        }),
      ],
      clusters: [],
    });
    const entry = resolveOwner(registry, "solo query");
    expect(entry?.owner).toBe("https://x.com/main");
    expect(entry?.contenders.length).toBe(0);
    expect(registry.conflicts.length).toBe(0);
  });
});

describe("buildOwnershipRegistry / serp_cluster basis", () => {
  it("fills a query gsc_ranks did not resolve, from an intent cluster with 2+ own pages", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [],
      clusters: [
        cluster({
          clusterId: "c1",
          queries: ["cheetah facts", "iranian cheetah"],
          ownPagesInCluster: [
            { url: "https://x.com/cheetah", bestRank: 2, queries: ["cheetah facts"] },
            { url: "https://x.com/wildlife", bestRank: 6, queries: ["iranian cheetah"] },
          ],
          conflict: true,
        }),
      ],
    });
    const entry = resolveOwner(registry, "cheetah facts");
    expect(entry?.owner).toBe("https://x.com/cheetah");
    expect(entry?.basis).toBe("serp_cluster");
    expect(entry?.contenders.map((c) => c.url)).toEqual(["https://x.com/wildlife"]);
    // Both member queries resolve to the same owner.
    expect(resolveOwner(registry, "iranian cheetah")?.owner).toBe("https://x.com/cheetah");
  });

  it("never overrides a gsc_ranks entry for the SAME query (gsc_ranks wins ties)", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "shared query",
          totalImpressions: 500,
          competingUrls: [{ url: "https://x.com/gsc-owner", clicks: 5, impressions: 500, position: 3 }],
        }),
      ],
      clusters: [
        cluster({
          clusterId: "c1",
          queries: ["shared query"],
          ownPagesInCluster: [{ url: "https://x.com/serp-owner", bestRank: 1, queries: ["shared query"] }],
        }),
      ],
    });
    expect(resolveOwner(registry, "shared query")?.owner).toBe("https://x.com/gsc-owner");
    expect(resolveOwner(registry, "shared query")?.basis).toBe("gsc_ranks");
  });

  it("a cluster with only one own page resolves an owner with no contenders", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [],
      clusters: [
        cluster({
          clusterId: "c1",
          queries: ["q1", "q2"],
          ownPagesInCluster: [{ url: "https://x.com/only", bestRank: 4, queries: ["q1"] }],
        }),
      ],
    });
    const entry = resolveOwner(registry, "q1");
    expect(entry?.owner).toBe("https://x.com/only");
    expect(entry?.contenders.length).toBe(0);
  });
});

describe("resolveOwner normalization + topic-token fallback", () => {
  const registry = buildOwnershipRegistry({
    cannibalization: [
      cannibalCase({
        query: "best persian male names 2026",
        totalImpressions: 1000,
        competingUrls: [{ url: "https://x.com/persian-male-names", clicks: 10, impressions: 1000, position: 2 }],
      }),
    ],
    clusters: [],
  });

  it("matches an exact query case/whitespace-insensitively", () => {
    expect(resolveOwner(registry, "  Best Persian Male Names 2026 ")?.owner).toBe("https://x.com/persian-male-names");
  });

  it("resolves a free-text topic label as a strict token subset of a tracked query", () => {
    // "Persian Male Names" tokenizes to a subset of "best persian male names 2026"
    // (after stripping generic/stopword tokens) - the create_page label case.
    const entry = resolveOwner(registry, "Persian Male Names");
    expect(entry?.owner).toBe("https://x.com/persian-male-names");
  });

  it("does not match on a single generic/shared word alone", () => {
    // "best" is stripped as generic by topicTokens, so this must not spuriously match.
    expect(resolveOwner(registry, "best")).toBeNull();
  });

  it("returns null for a genuinely unrelated topic", () => {
    expect(resolveOwner(registry, "chaharshanbe suri traditions")).toBeNull();
  });

  it("hasKnownOwner mirrors resolveOwner's owner presence", () => {
    expect(hasKnownOwner(registry, "Persian Male Names")).toBe(true);
    expect(hasKnownOwner(registry, "totally unrelated topic")).toBe(false);
  });
});

describe("conflicts list ordering", () => {
  it("sorts worst-first: more contenders, then higher confidence", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "two-way",
          totalImpressions: 1000,
          competingUrls: [
            { url: "https://x.com/a", clicks: 1, impressions: 550, position: 4 },
            { url: "https://x.com/b", clicks: 1, impressions: 450, position: 5 },
          ],
        }),
        cannibalCase({
          query: "three-way",
          totalImpressions: 1000,
          competingUrls: [
            { url: "https://x.com/c", clicks: 1, impressions: 500, position: 3 },
            { url: "https://x.com/d", clicks: 1, impressions: 300, position: 6 },
            { url: "https://x.com/e", clicks: 1, impressions: 200, position: 9 },
          ],
        }),
      ],
      clusters: [],
    });
    expect(registry.conflicts.length).toBe(2);
    expect(registry.conflicts[0]!.key).toBe("three-way"); // 2 contenders beats 1
  });
});

describe("coverage reporting", () => {
  it("is honest about unresolved queries when trackedQueryCount is passed", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "resolved query",
          totalImpressions: 500,
          competingUrls: [{ url: "https://x.com/a", clicks: 1, impressions: 500, position: 1 }],
        }),
      ],
      clusters: [],
      trackedQueryCount: 5,
    });
    expect(registry.coverage.totalQueries).toBe(5);
    expect(registry.coverage.gscBasisCount).toBe(1);
    expect(registry.coverage.unresolvedCount).toBe(4);
  });
});

describe("registryGscConflictsAsClusters (conflict-surface adapter)", () => {
  it("converts gsc_ranks conflicts into IntentCluster-shaped entries, grouped by (owner, contenders)", () => {
    const registry: OwnershipRegistry = buildOwnershipRegistry({
      cannibalization: [
        cannibalCase({
          query: "q1",
          totalImpressions: 1000,
          competingUrls: [
            { url: "https://x.com/a", clicks: 1, impressions: 600, position: 2 },
            { url: "https://x.com/b", clicks: 1, impressions: 400, position: 5 },
          ],
        }),
        cannibalCase({
          query: "q2",
          totalImpressions: 1000,
          competingUrls: [
            { url: "https://x.com/a", clicks: 1, impressions: 600, position: 2 },
            { url: "https://x.com/b", clicks: 1, impressions: 400, position: 5 },
          ],
        }),
      ],
      clusters: [],
    });
    const asClusters = registryGscConflictsAsClusters(registry);
    // Both queries share the exact same (owner, contenders) -> ONE synthetic cluster.
    expect(asClusters.length).toBe(1);
    expect(asClusters[0]!.queries.sort()).toEqual(["q1", "q2"]);
    expect(asClusters[0]!.conflict).toBe(true);
    expect(asClusters[0]!.ownPagesInCluster.map((p) => p.url).sort()).toEqual(["https://x.com/a", "https://x.com/b"]);
  });

  it("never re-emits a serp_cluster-basis conflict (it is already an IntentCluster the caller has)", () => {
    const registry = buildOwnershipRegistry({
      cannibalization: [],
      clusters: [
        cluster({
          clusterId: "c1",
          queries: ["q1", "q2"],
          ownPagesInCluster: [
            { url: "https://x.com/a", bestRank: 1, queries: ["q1"] },
            { url: "https://x.com/b", bestRank: 4, queries: ["q2"] },
          ],
          conflict: true,
        }),
      ],
    });
    expect(registryGscConflictsAsClusters(registry)).toEqual([]);
  });

  it("returns [] for an empty registry", () => {
    const empty: OwnershipRegistry = {
      byQuery: new Map(),
      conflicts: [],
      coverage: { totalQueries: 0, gscBasisCount: 0, serpClusterBasisCount: 0, unresolvedCount: 0 },
    };
    expect(registryGscConflictsAsClusters(empty)).toEqual([]);
  });
});
