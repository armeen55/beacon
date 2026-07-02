/**
 * intent-clusters.test.ts (BEACON_500 item N7).
 *
 * Pins: pairwise overlap math, the >=4-of-10 threshold, transitive
 * union-find clustering, own-page identification (root-domain matching),
 * conflict detection (2+ distinct own URLs in one cluster), and honest
 * coverage reporting (queries with no SERP history are never silently
 * dropped from the count). No I/O, this file never touches Supabase.
 */
import { describe, it, expect } from "vitest";

import {
  computeIntentClusters,
  conflictClusters,
  latestSnapshotPerQuery,
  overlaps,
  sharedResultCount,
  DEFAULT_OVERLAP_THRESHOLD,
  type QuerySerpSnapshot,
} from "./intent-clusters";
import type { SerpOrganicItem } from "./dataforseo-serp";

function top10(urls: string[], domainOf: (url: string) => string = (u) => new URL(u).hostname): SerpOrganicItem[] {
  return urls.map((url, i) => ({ rank: i + 1, domain: domainOf(url), url }));
}

function snap(query: string, urls: string[], capturedAt = "2026-07-01T00:00:00.000Z"): QuerySerpSnapshot {
  return { query, capturedAt, topResults: top10(urls) };
}

const TEN_SHARED = [
  "https://a.com/1",
  "https://a.com/2",
  "https://a.com/3",
  "https://a.com/4",
  "https://a.com/5",
  "https://a.com/6",
  "https://a.com/7",
  "https://a.com/8",
  "https://a.com/9",
  "https://a.com/10",
];

describe("sharedResultCount / overlaps (pure math)", () => {
  it("counts shared URLs between two sets", () => {
    const a = new Set(["x", "y", "z"]);
    const b = new Set(["y", "z", "w"]);
    expect(sharedResultCount(a, b)).toBe(2);
  });

  it("overlaps() is true at exactly the default threshold (4 of 10)", () => {
    const a = snap("q1", [...TEN_SHARED.slice(0, 4), "https://a.com/x1", "https://a.com/x2", "https://a.com/x3", "https://a.com/x4", "https://a.com/x5", "https://a.com/x6"]);
    const b = snap("q2", [...TEN_SHARED.slice(0, 4), "https://b.com/y1", "https://b.com/y2", "https://b.com/y3", "https://b.com/y4", "https://b.com/y5", "https://b.com/y6"]);
    expect(overlaps(a, b)).toBe(true);
  });

  it("overlaps() is false one below the threshold (3 of 10)", () => {
    const a = snap("q1", [...TEN_SHARED.slice(0, 3), "https://a.com/x1", "https://a.com/x2", "https://a.com/x3", "https://a.com/x4", "https://a.com/x5", "https://a.com/x6", "https://a.com/x7"]);
    const b = snap("q2", [...TEN_SHARED.slice(0, 3), "https://b.com/y1", "https://b.com/y2", "https://b.com/y3", "https://b.com/y4", "https://b.com/y5", "https://b.com/y6", "https://b.com/y7"]);
    expect(overlaps(a, b)).toBe(false);
  });

  it("respects a custom threshold", () => {
    const a = snap("q1", TEN_SHARED.slice(0, 2).concat(["https://a.com/x1"]));
    const b = snap("q2", TEN_SHARED.slice(0, 2).concat(["https://b.com/y1"]));
    expect(overlaps(a, b, 2)).toBe(true);
    expect(overlaps(a, b, 3)).toBe(false);
  });

  it("never overlaps against an empty result set", () => {
    const a = snap("q1", TEN_SHARED);
    const b: QuerySerpSnapshot = { query: "q2", capturedAt: "2026-07-01T00:00:00.000Z", topResults: [] };
    expect(overlaps(a, b)).toBe(false);
  });

  it("DEFAULT_OVERLAP_THRESHOLD is 4 (task spec)", () => {
    expect(DEFAULT_OVERLAP_THRESHOLD).toBe(4);
  });
});

describe("latestSnapshotPerQuery", () => {
  it("keeps only the most recent snapshot per normalized query", () => {
    const older = snap("Nowruz Gifts", ["https://a.com/1"], "2026-06-01T00:00:00.000Z");
    const newer = snap("nowruz gifts", ["https://a.com/2"], "2026-07-01T00:00:00.000Z");
    const map = latestSnapshotPerQuery([older, newer]);
    expect(map.size).toBe(1);
    expect(map.get("nowruz gifts")!.capturedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("computeIntentClusters", () => {
  it("abstains (no clusters) when fewer than 2 queries have usable SERP data", () => {
    const result = computeIntentClusters({
      trackedQueries: ["only one query"],
      snapshots: [snap("only one query", TEN_SHARED)],
      ownDomain: "iranopedia.com",
    });
    expect(result.clusters).toEqual([]);
    expect(result.coverage.totalQueries).toBe(1);
    expect(result.coverage.queriesWithSerpData).toBe(1);
  });

  it("groups two overlapping queries into one cluster", () => {
    const q1 = snap("what is nowruz", TEN_SHARED);
    const q2 = snap("nowruz meaning", TEN_SHARED);
    const result = computeIntentClusters({
      trackedQueries: ["what is nowruz", "nowruz meaning"],
      snapshots: [q1, q2],
      ownDomain: null,
    });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.queries.sort()).toEqual(["nowruz meaning", "what is nowruz"]);
    expect(result.clusters[0]!.sharedUrls.length).toBe(10);
  });

  it("does NOT cluster two queries with no meaningful overlap", () => {
    const q1 = snap("persian rugs", TEN_SHARED);
    const q2 = snap("chaharshanbe suri", ["https://c.com/1", "https://c.com/2", "https://c.com/3", "https://c.com/4", "https://c.com/5", "https://c.com/6", "https://c.com/7", "https://c.com/8", "https://c.com/9", "https://c.com/10"]);
    const result = computeIntentClusters({
      trackedQueries: ["persian rugs", "chaharshanbe suri"],
      snapshots: [q1, q2],
      ownDomain: null,
    });
    expect(result.clusters).toEqual([]);
  });

  it("transitively merges A-B-C into one cluster even when A and C alone do not overlap", () => {
    // A shares 4 with B; B shares 4 (different 4) with C; A and C share 0.
    const base = ["https://x.com/1", "https://x.com/2", "https://x.com/3", "https://x.com/4"];
    const aOnly = ["https://a.com/1", "https://a.com/2", "https://a.com/3", "https://a.com/4", "https://a.com/5", "https://a.com/6"];
    const cBase = ["https://y.com/1", "https://y.com/2", "https://y.com/3", "https://y.com/4"];
    const cOnly = ["https://c.com/1", "https://c.com/2", "https://c.com/3", "https://c.com/4", "https://c.com/5", "https://c.com/6"];
    const a = snap("query a", [...base, ...aOnly]);
    const b = snap("query b", [...base, ...cBase]); // shares `base` with A, `cBase` with C
    const c = snap("query c", [...cBase, ...cOnly]);
    const result = computeIntentClusters({
      trackedQueries: ["query a", "query b", "query c"],
      snapshots: [a, b, c],
      ownDomain: null,
    });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.queries.sort()).toEqual(["query a", "query b", "query c"]);
  });

  it("identifies own pages by root domain (subdomains count, look-alikes do not)", () => {
    const q1 = snap("what is nowruz", [
      "https://www.iranopedia.com/nowruz",
      ...TEN_SHARED.slice(0, 5),
      "https://notiranopedia.com/fake",
      "https://blog.iranopedia.com/nowruz-2",
      "https://c.com/9",
      "https://c.com/10",
    ]);
    const q2 = snap("nowruz meaning", TEN_SHARED.slice(0, 5).concat(["https://d.com/1", "https://d.com/2", "https://d.com/3", "https://d.com/4", "https://d.com/5"]));
    const result = computeIntentClusters({
      trackedQueries: ["what is nowruz", "nowruz meaning"],
      snapshots: [q1, q2],
      ownDomain: "iranopedia.com",
    });
    expect(result.clusters).toHaveLength(1);
    const own = result.clusters[0]!.ownPagesInCluster.map((p) => p.url);
    expect(own).toContain("https://www.iranopedia.com/nowruz");
    expect(own).toContain("https://blog.iranopedia.com/nowruz-2");
    expect(own).not.toContain("https://notiranopedia.com/fake");
  });

  it("flags conflict:true only when 2+ DISTINCT own URLs appear in one cluster", () => {
    const q1 = snap("what is nowruz", ["https://iranopedia.com/nowruz-guide", ...TEN_SHARED.slice(0, 9)]);
    const q2 = snap("nowruz meaning", ["https://iranopedia.com/nowruz-meaning", ...TEN_SHARED.slice(0, 9)]);
    const result = computeIntentClusters({
      trackedQueries: ["what is nowruz", "nowruz meaning"],
      snapshots: [q1, q2],
      ownDomain: "iranopedia.com",
    });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.conflict).toBe(true);
    expect(result.clusters[0]!.ownPagesInCluster).toHaveLength(2);
  });

  it("does not flag conflict when only ONE own page ranks in the cluster", () => {
    const q1 = snap("what is nowruz", ["https://iranopedia.com/nowruz-guide", ...TEN_SHARED.slice(0, 9)]);
    const q2 = snap("nowruz meaning", TEN_SHARED.slice(0, 9).concat(["https://competitor.com/nowruz"]));
    const result = computeIntentClusters({
      trackedQueries: ["what is nowruz", "nowruz meaning"],
      snapshots: [q1, q2],
      ownDomain: "iranopedia.com",
    });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.conflict).toBe(false);
    expect(result.clusters[0]!.ownPagesInCluster).toHaveLength(1);
  });

  it("never fabricates own pages when ownDomain is null", () => {
    const q1 = snap("what is nowruz", ["https://iranopedia.com/a", ...TEN_SHARED.slice(0, 9)]);
    const q2 = snap("nowruz meaning", ["https://iranopedia.com/b", ...TEN_SHARED.slice(0, 9)]);
    const result = computeIntentClusters({
      trackedQueries: ["what is nowruz", "nowruz meaning"],
      snapshots: [q1, q2],
      ownDomain: null,
    });
    expect(result.clusters[0]!.ownPagesInCluster).toEqual([]);
    expect(result.clusters[0]!.conflict).toBe(false);
  });

  it("reports honest coverage: queries with no SERP history are counted as missing, not silently dropped", () => {
    const q1 = snap("what is nowruz", TEN_SHARED);
    const result = computeIntentClusters({
      trackedQueries: ["what is nowruz", "no serp yet", "also missing"],
      snapshots: [q1],
      ownDomain: null,
    });
    expect(result.coverage.totalQueries).toBe(3);
    expect(result.coverage.queriesWithSerpData).toBe(1);
    expect(result.coverage.queriesMissingSerpData.sort()).toEqual(["also missing", "no serp yet"]);
    expect(result.coverage.coverageRatio).toBeCloseTo(1 / 3);
  });

  it("coverageRatio is 0 (not NaN) when there are zero tracked queries", () => {
    const result = computeIntentClusters({ trackedQueries: [], snapshots: [], ownDomain: null });
    expect(result.coverage.coverageRatio).toBe(0);
    expect(result.coverage.totalQueries).toBe(0);
  });

  it("ignores a query with an empty top-results array as unusable (not a fabricated cluster)", () => {
    const q1 = snap("what is nowruz", TEN_SHARED);
    const q2: QuerySerpSnapshot = { query: "empty results", capturedAt: "2026-07-01T00:00:00.000Z", topResults: [] };
    const result = computeIntentClusters({
      trackedQueries: ["what is nowruz", "empty results"],
      snapshots: [q1, q2],
      ownDomain: null,
    });
    expect(result.clusters).toEqual([]);
    expect(result.coverage.queriesMissingSerpData).toEqual(["empty results"]);
  });

  it("sorts conflict clusters before non-conflict clusters", () => {
    const nonConflictA = snap("nc-a", TEN_SHARED.slice(0, 5).concat(["https://q.com/1", "https://q.com/2", "https://q.com/3", "https://q.com/4", "https://q.com/5"]));
    const nonConflictB = snap("nc-b", TEN_SHARED.slice(0, 5).concat(["https://r.com/1", "https://r.com/2", "https://r.com/3", "https://r.com/4", "https://r.com/5"]));
    const conflictA = snap("c-a", ["https://iranopedia.com/x", ...TEN_SHARED.slice(0, 9)].map((u, i) => u === "https://iranopedia.com/x" ? u : u.replace("a.com", "z.com")));
    const conflictB = snap("c-b", ["https://iranopedia.com/y", ...TEN_SHARED.slice(0, 9).map((u) => u.replace("a.com", "z.com"))]);
    const result = computeIntentClusters({
      trackedQueries: ["nc-a", "nc-b", "c-a", "c-b"],
      snapshots: [nonConflictA, nonConflictB, conflictA, conflictB],
      ownDomain: "iranopedia.com",
    });
    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
    expect(result.clusters[0]!.conflict).toBe(true);
  });
});

describe("conflictClusters", () => {
  it("filters to only clusters with conflict:true", () => {
    const q1 = snap("what is nowruz", ["https://iranopedia.com/a", ...TEN_SHARED.slice(0, 9)]);
    const q2 = snap("nowruz meaning", ["https://iranopedia.com/b", ...TEN_SHARED.slice(0, 9)]);
    const result = computeIntentClusters({
      trackedQueries: ["what is nowruz", "nowruz meaning"],
      snapshots: [q1, q2],
      ownDomain: "iranopedia.com",
    });
    const conflicts = conflictClusters(result);
    expect(conflicts).toHaveLength(1);
    expect(conflicts.every((c) => c.conflict)).toBe(true);
  });

  it("returns [] when no cluster conflicts", () => {
    const q1 = snap("a query", TEN_SHARED);
    const q2 = snap("b query", TEN_SHARED);
    const result = computeIntentClusters({
      trackedQueries: ["a query", "b query"],
      snapshots: [q1, q2],
      ownDomain: null,
    });
    expect(conflictClusters(result)).toEqual([]);
  });
});
