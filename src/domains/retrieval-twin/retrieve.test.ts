import { describe, it, expect } from "vitest";
import { cosineSimilarity, rankCandidates, whoWins, type RetrievalCandidate } from "./retrieve";

describe("cosineSimilarity (pure)", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("is -1 for exactly opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("is scale-invariant (same direction, different magnitude)", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  });

  it("returns 0 (not NaN) for a zero-magnitude vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([0, 0], [0, 0]))).toBe(false);
  });

  it("returns 0 for mismatched vector lengths rather than throwing", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("rankCandidates (pure)", () => {
  const query = [1, 0, 0];

  it("ranks the closest vector first", () => {
    const candidates: RetrievalCandidate[] = [
      { source: "competitor", pageUrl: "https://wikipedia.org/nowruz", chunkExcerpt: "far", embedding: [0, 1, 0] },
      { source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkExcerpt: "close", embedding: [0.9, 0.1, 0] },
    ];
    const ranked = rankCandidates(query, candidates);
    expect(ranked[0].pageUrl).toBe("https://iranopedia.com/nowruz");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("assigns 1-based sequential ranks matching array order for ties", () => {
    const candidates: RetrievalCandidate[] = [
      { source: "owned", pageUrl: "a", chunkExcerpt: "a", embedding: [1, 0, 0] },
      { source: "competitor", pageUrl: "b", chunkExcerpt: "b", embedding: [1, 0, 0] },
    ];
    const ranked = rankCandidates(query, candidates);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
    expect(ranked[0].pageUrl).toBe("a"); // stable order on exact tie
  });

  it("returns [] for no candidates", () => {
    expect(rankCandidates(query, [])).toEqual([]);
  });

  it("is deterministic on the same input", () => {
    const candidates: RetrievalCandidate[] = [
      { source: "owned", pageUrl: "a", chunkExcerpt: "a", embedding: [0.5, 0.5, 0] },
      { source: "competitor", pageUrl: "b", chunkExcerpt: "b", embedding: [0.2, 0.8, 0] },
      { source: "competitor", pageUrl: "c", chunkExcerpt: "c", embedding: [0.9, 0.05, 0] },
    ];
    expect(rankCandidates(query, candidates)).toEqual(rankCandidates(query, candidates));
  });
});

describe("whoWins", () => {
  const query = [1, 0, 0];

  it("finds the tenant's own best-ranked passage among a mixed pool", () => {
    const candidates: RetrievalCandidate[] = [
      { source: "competitor", pageUrl: "https://wikipedia.org/nowruz", chunkExcerpt: "Wikipedia's opening definition.", embedding: [0.99, 0.01, 0] },
      { source: "competitor", pageUrl: "https://rival.com/nowruz", chunkExcerpt: "rival mid", embedding: [0.5, 0.5, 0] },
      { source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkExcerpt: "our passage", embedding: [0.7, 0.3, 0] },
    ];
    const result = whoWins(query, candidates);
    expect(result.totalCandidates).toBe(3);
    expect(result.topOverall?.pageUrl).toBe("https://wikipedia.org/nowruz");
    expect(result.ownBest?.pageUrl).toBe("https://iranopedia.com/nowruz");
    // Own page beats the weaker rival but not Wikipedia -> rank should be 2 of 3.
    expect(result.ownBest?.rank).toBe(2);
  });

  it("returns ownBest = null when the tenant has no owned chunks in the pool", () => {
    const candidates: RetrievalCandidate[] = [
      { source: "competitor", pageUrl: "https://wikipedia.org/nowruz", chunkExcerpt: "x", embedding: [1, 0, 0] },
    ];
    const result = whoWins(query, candidates);
    expect(result.ownBest).toBeNull();
    expect(result.topOverall?.pageUrl).toBe("https://wikipedia.org/nowruz");
  });

  it("returns nulls and 0 candidates for an empty pool", () => {
    const result = whoWins(query, []);
    expect(result.ownBest).toBeNull();
    expect(result.topOverall).toBeNull();
    expect(result.totalCandidates).toBe(0);
  });

  it("when the tenant's own page wins outright, ownBest and topOverall are the same candidate", () => {
    const candidates: RetrievalCandidate[] = [
      { source: "owned", pageUrl: "https://iranopedia.com/nowruz", chunkExcerpt: "great match", embedding: [1, 0, 0] },
      { source: "competitor", pageUrl: "https://rival.com/nowruz", chunkExcerpt: "weak match", embedding: [0.1, 0.9, 0] },
    ];
    const result = whoWins(query, candidates);
    expect(result.ownBest?.rank).toBe(1);
    expect(result.topOverall?.pageUrl).toBe(result.ownBest?.pageUrl);
  });
});
