/**
 * retrieve (2026-07-02, master plan item 50) - the retrieval twin's pure math layer. Given a
 * query embedding and a set of candidate chunk embeddings (owned + competitor), ranks them by
 * cosine similarity and reports who wins. This is a local simulation of the retrieval step an
 * answer engine runs before it decides which passage to quote or cite.
 *
 * PURE. No I/O, no OpenAI, no Supabase - just vector math over already-embedded chunks.
 */

export type RetrievalCandidate = {
  source: "owned" | "competitor";
  pageUrl: string;
  chunkExcerpt: string;
  embedding: number[];
};

export type RankedCandidate = {
  source: "owned" | "competitor";
  pageUrl: string;
  chunkExcerpt: string;
  /** Cosine similarity to the query embedding, in [-1, 1] (typically (0, 1] for embeddings). */
  score: number;
  /** 1-based rank, best (highest score) first. */
  rank: number;
};

/**
 * Cosine similarity between two equal-length vectors. Returns 0 for a zero-magnitude vector
 * (rather than NaN/Infinity) so a malformed embedding never corrupts a ranking with a bogus
 * "best" score. Mismatched lengths also return 0 - defensive, since a dimension mismatch means
 * the vectors are not comparable (e.g. an embedding produced by a different model).
 */
export function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Rank every candidate chunk against a query embedding, best (highest cosine similarity)
 * first. Ties break by the candidate's original array order (stable sort). Pure.
 */
export function rankCandidates(
  queryEmbedding: ReadonlyArray<number>,
  candidates: ReadonlyArray<RetrievalCandidate>,
): RankedCandidate[] {
  const scored = candidates.map((c, i) => ({ c, i, score: cosineSimilarity(queryEmbedding, c.embedding) }));
  scored.sort((x, y) => (y.score !== x.score ? y.score - x.score : x.i - y.i));
  return scored.map((s, idx) => ({
    source: s.c.source,
    pageUrl: s.c.pageUrl,
    chunkExcerpt: s.c.chunkExcerpt,
    score: s.score,
    rank: idx + 1,
  }));
}

export type WhoWinsResult = {
  ranked: RankedCandidate[];
  /** Best-ranked OWNED candidate, or null when the tenant has no owned chunks indexed. */
  ownBest: RankedCandidate | null;
  /** The single top-ranked candidate overall (may be owned or competitor). */
  topOverall: RankedCandidate | null;
  totalCandidates: number;
};

/**
 * The full "who wins this query" verdict: the ranked list, the tenant's own best-ranked
 * passage (or null if the tenant has nothing indexed for this query), and the overall winner.
 * Pure - the caller supplies the query embedding and candidate pool (already fetched/embedded
 * by the indexer).
 */
export function whoWins(queryEmbedding: ReadonlyArray<number>, candidates: ReadonlyArray<RetrievalCandidate>): WhoWinsResult {
  const ranked = rankCandidates(queryEmbedding, candidates);
  const ownBest = ranked.find((r) => r.source === "owned") ?? null;
  return { ranked, ownBest, topOverall: ranked[0] ?? null, totalCandidates: ranked.length };
}
