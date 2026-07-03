import { describe, expect, it } from "vitest";

import {
  computeInternalPageRank,
  inferHomepage,
  DAMPING,
  type PageRankInputPage,
} from "./internal-pagerank";

const H = "https://x.com/";
const A = "https://x.com/a";
const B = "https://x.com/b";
const C = "https://x.com/c";
const D = "https://x.com/d";

/** A small fixture site: home links to a,b; a links to c; b links to c; c links
 *  back to home; d is an island page nothing links to. */
function fixture(): PageRankInputPage[] {
  return [
    { url: H, outbound: [A, B] },
    { url: A, outbound: [C] },
    { url: B, outbound: [C] },
    { url: C, outbound: [H] },
    { url: D, outbound: [] },
  ];
}

describe("computeInternalPageRank", () => {
  it("is deterministic - same input yields byte-identical scores", () => {
    const r1 = computeInternalPageRank(fixture(), { now: new Date(0) });
    const r2 = computeInternalPageRank(fixture(), { now: new Date(0) });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("PageRank mass sums to ~1 (converged, mass-conserving with dangling correction)", () => {
    const r = computeInternalPageRank(fixture());
    const total = r.pages.reduce((s, p) => s + p.authorityScore, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("ranks a well-linked hub above an island page", () => {
    const r = computeInternalPageRank(fixture());
    const byUrl = new Map(r.pages.map((p) => [p.url, p]));
    // C gets links from a AND b AND is on the home cycle; D gets none.
    expect(byUrl.get(C)!.authorityScore).toBeGreaterThan(byUrl.get(D)!.authorityScore);
    // The island D (no inbound) holds at least the base rank but strictly less
    // than the base+damping ceiling a linked page would clear - it never rises
    // above the well-linked hub.
    expect(byUrl.get(D)!.authorityScore).toBeGreaterThanOrEqual((1 - DAMPING) / 5);
    expect(byUrl.get(D)!.authorityScore).toBeLessThan(byUrl.get(H)!.authorityScore);
  });

  it("computes BFS click-depth from the homepage", () => {
    const r = computeInternalPageRank(fixture());
    const depth = new Map(r.pages.map((p) => [p.url, p.clickDepth]));
    expect(r.homepage).toBe(H);
    expect(depth.get(H)).toBe(0);
    expect(depth.get(A)).toBe(1);
    expect(depth.get(B)).toBe(1);
    expect(depth.get(C)).toBe(2);
    // D is unreachable from home.
    expect(depth.get(D)).toBeNull();
  });

  it("detects orphans (zero inbound owned links)", () => {
    const r = computeInternalPageRank(fixture());
    const byUrl = new Map(r.pages.map((p) => [p.url, p]));
    // D has no inbound; H has inbound (from C); A/B/C all have inbound.
    expect(byUrl.get(D)!.orphaned).toBe(true);
    expect(byUrl.get(D)!.inboundCount).toBe(0);
    expect(byUrl.get(H)!.orphaned).toBe(false);
    expect(byUrl.get(A)!.orphaned).toBe(false);
    expect(byUrl.get(C)!.inboundCount).toBe(2); // a and b both link to c
  });

  it("EMPTINESS GUARD: zero resolvable owned->owned edges yields an empty result", () => {
    // Every page links only off-node / external -> no owned edge resolves.
    const pages: PageRankInputPage[] = [
      { url: A, outbound: ["https://other.com/x"] },
      { url: B, outbound: [] },
    ];
    const r = computeInternalPageRank(pages);
    expect(r.pages).toEqual([]);
    expect(r.totalEdges).toBe(0);
    expect(r.homepage).toBeNull();
  });

  it("drops self-links and off-node targets, dedupes repeated edges", () => {
    const pages: PageRankInputPage[] = [
      { url: A, outbound: [A, B, B, "https://other.com/x"] }, // self + dup + external
      { url: B, outbound: [A] },
    ];
    const r = computeInternalPageRank(pages);
    // Only A->B and B->A count: 2 distinct edges.
    expect(r.totalEdges).toBe(2);
    const byUrl = new Map(r.pages.map((p) => [p.url, p]));
    expect(byUrl.get(A)!.inboundCount).toBe(1);
    expect(byUrl.get(B)!.inboundCount).toBe(1);
  });

  it("honors a homepage override when it is a known node", () => {
    const r = computeInternalPageRank(fixture(), { homepage: A });
    expect(r.homepage).toBe(A);
    const depth = new Map(r.pages.map((p) => [p.url, p.clickDepth]));
    expect(depth.get(A)).toBe(0);
    expect(depth.get(C)).toBe(1); // a -> c
  });

  it("falls back to structural inference when the override is not a node", () => {
    const r = computeInternalPageRank(fixture(), { homepage: "https://x.com/not-a-node" });
    expect(r.homepage).toBe(H); // inferred bare-root
  });

  it("returns empty on an empty node set", () => {
    const r = computeInternalPageRank([]);
    expect(r.pages).toEqual([]);
    expect(r.totalEdges).toBe(0);
  });
});

describe("inferHomepage", () => {
  it("prefers a bare-root path", () => {
    expect(inferHomepage([A, H, C])).toBe(H);
  });

  it("prefers the fewest path segments when no bare root exists", () => {
    expect(inferHomepage(["https://x.com/a/b/c", "https://x.com/a", "https://x.com/a/b"])).toBe(
      "https://x.com/a",
    );
  });

  it("returns null on an empty set", () => {
    expect(inferHomepage([])).toBeNull();
  });
});
