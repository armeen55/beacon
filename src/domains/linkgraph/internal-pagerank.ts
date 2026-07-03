/**
 * internal-pagerank (2026-07-03, BEACON_500 R18 / N23 - internal authority +
 * click-depth engine).
 *
 * PURE / no I/O / no LLM. Given the tenant's own page_snapshots' internal_links
 * adjacency (each snapshot carries `internal_links: [{href, anchor_text}]`), it
 * computes, deterministically:
 *
 *   (a) authorityScore - a simplified iterative PageRank per page (damping 0.85,
 *       ITERATIONS passes). This is how much internal link equity a page
 *       accumulates from the rest of the site: a page many other pages point to,
 *       from pages that are themselves pointed to, scores high. Never surfaced as
 *       a number to a customer ("PageRank" is a lab word); it only RANKS pages so
 *       the highest-demand buried page surfaces first.
 *   (b) clickDepth - the fewest link hops from the homepage to reach the page
 *       (BFS over the same adjacency). The homepage is depth 0; a page linked
 *       directly from it is depth 1; and so on. Unreachable pages get
 *       clickDepth = null (nothing on the site leads to them from the front door).
 *   (c) orphaned - true when NO other owned page links to the page (zero inbound).
 *       This is the strict inbound-orphan definition orphan-page.ts already uses,
 *       recomputed here so the authority engine and the existing orphan trigger
 *       never disagree about who is an orphan.
 *
 * The homepage is inferred structurally (shortest owned path, then the bare-root
 * "/" path) rather than from BusinessConfig, so this core stays pure and testable
 * without a config. The loader may override it.
 *
 * CONTRACT (pinned by tests): an empty adjacency (no snapshot has any usable
 * owned->owned link) yields an EMPTY result - never "every page is an orphan"
 * off missing link data (the same global-emptiness guard orphan-page.ts uses).
 * Determinism: the same input graph always yields byte-identical scores (fixed
 * iteration count, sorted node order, no Map iteration-order dependence in the
 * math).
 */

export type PageRankInputPage = {
  /** Canonical (or at least stable) URL - the node identity. */
  url: string;
  /** Owned->owned outbound links FROM this page (already resolved+canonicalized
   *  to owned-page node ids by the caller). Off-tenant / external / unresolved
   *  hrefs must be dropped before calling; self-links are ignored here too. */
  outbound: readonly string[];
};

export type PageAuthority = {
  url: string;
  /** Simplified PageRank in [0,1], summing to ~1 across all pages. Ranking key
   *  only - never a customer-facing number. */
  authorityScore: number;
  /** Fewest link hops from the homepage, or null when unreachable from it. */
  clickDepth: number | null;
  /** No other owned page links to this one (zero inbound). */
  orphaned: boolean;
  /** Distinct owned pages that link TO this one. */
  inboundCount: number;
};

export type InternalPageRankResult = {
  pages: PageAuthority[];
  /** The node treated as the homepage (depth 0), or null when none inferred. */
  homepage: string | null;
  /** Total distinct owned->owned links that resolved (the emptiness-guard base:
   *  0 means the adjacency was unusable and `pages` is empty). */
  totalEdges: number;
  builtAt: string;
};

/** PageRank damping factor - the canonical 0.85. */
export const DAMPING = 0.85;
/** Deterministic iteration count - enough for convergence on site-sized graphs. */
export const ITERATIONS = 20;

/**
 * Infer the homepage node from the graph shape alone (pure). Preference order:
 * an exact bare-root path ("https://x.com" or "https://x.com/"), else the URL
 * with the SHORTEST path segment count (tie broken lexicographically) - the
 * classic "closest to the root" heuristic. Returns null on an empty node set.
 */
export function inferHomepage(urls: readonly string[]): string | null {
  if (urls.length === 0) return null;
  const rootLike: string[] = [];
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      const path = parsed.pathname.replace(/\/+$/, "");
      if (path === "" || path === "/") rootLike.push(u);
    } catch {
      /* not a parseable absolute URL - skip root test, still eligible below */
    }
  }
  if (rootLike.length > 0) {
    return [...rootLike].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!;
  }
  const segCount = (u: string): number => {
    try {
      return new URL(u).pathname.split("/").filter(Boolean).length;
    } catch {
      return u.split("/").filter(Boolean).length;
    }
  };
  return [...urls].sort((a, b) => segCount(a) - segCount(b) || a.length - b.length || a.localeCompare(b))[0]!;
}

/**
 * Compute internal authority + click-depth + orphan status for one tenant's
 * owned-page adjacency. Pure and deterministic.
 *
 * @param pages   one entry per owned page, with its owned->owned outbound edges.
 * @param opts.homepage  override the inferred homepage (the loader passes the
 *                       config homepage when known). Ignored if not a known node.
 * @param opts.now       injected clock for a deterministic builtAt in tests.
 */
export function computeInternalPageRank(
  pages: readonly PageRankInputPage[],
  opts: { homepage?: string | null; now?: Date } = {},
): InternalPageRankResult {
  const builtAt = (opts.now ?? new Date()).toISOString();

  // Node universe: sorted for determinism (the iteration math walks this order).
  const nodes = [...new Set(pages.map((p) => p.url).filter(Boolean))].sort();
  if (nodes.length === 0) {
    return { pages: [], homepage: null, totalEdges: 0, builtAt };
  }
  const nodeSet = new Set(nodes);
  const index = new Map<string, number>();
  nodes.forEach((u, i) => index.set(u, i));

  // Adjacency: for each source node, the DISTINCT owned target nodes it links to
  // (self-links and off-node targets dropped). Also the inbound source set per
  // target (drives orphan detection + inboundCount).
  const outboundSets: Set<string>[] = nodes.map(() => new Set<string>());
  const inboundSets: Set<string>[] = nodes.map(() => new Set<string>());
  let totalEdges = 0;
  for (const p of pages) {
    const si = index.get(p.url);
    if (si == null) continue;
    for (const raw of p.outbound) {
      if (!nodeSet.has(raw) || raw === p.url) continue;
      const ti = index.get(raw)!;
      if (!outboundSets[si]!.has(raw)) {
        outboundSets[si]!.add(raw);
        inboundSets[ti]!.add(p.url);
        totalEdges += 1;
      }
    }
  }

  // Global emptiness guard: no owned->owned link resolved anywhere. The link
  // capture is unusable; returning "every page orphaned/unreachable" would be a
  // false verdict across the board. Emit nothing (same rule as orphan-page.ts).
  if (totalEdges === 0) {
    return { pages: [], homepage: null, totalEdges: 0, builtAt };
  }

  const n = nodes.length;
  const outDeg = outboundSets.map((s) => s.size);

  // Iterative PageRank. rank[i] starts uniform; each pass redistributes rank
  // along outbound edges with damping, and dangling nodes (no outbound) spill
  // their rank uniformly so total mass is conserved (the standard correction).
  let rank = new Array<number>(n).fill(1 / n);
  const base = (1 - DAMPING) / n;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const next = new Array<number>(n).fill(base);
    let dangling = 0;
    for (let i = 0; i < n; i++) if (outDeg[i] === 0) dangling += rank[i]!;
    const danglingShare = DAMPING * (dangling / n);
    for (let i = 0; i < n; i++) next[i]! += danglingShare;
    for (let i = 0; i < n; i++) {
      const deg = outDeg[i]!;
      if (deg === 0) continue;
      const contribution = (DAMPING * rank[i]!) / deg;
      for (const target of outboundSets[i]!) {
        next[index.get(target)!]! += contribution;
      }
    }
    rank = next;
  }

  // Click-depth: BFS from the homepage over the outbound adjacency.
  const homepage =
    opts.homepage && nodeSet.has(opts.homepage) ? opts.homepage : inferHomepage(nodes);
  const depth = new Array<number | null>(n).fill(null);
  if (homepage) {
    const start = index.get(homepage)!;
    depth[start] = 0;
    const queue: number[] = [start];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      const curDepth = depth[cur]!;
      // Walk targets in sorted order for a deterministic BFS tree.
      const targets = [...outboundSets[cur]!].sort();
      for (const t of targets) {
        const ti = index.get(t)!;
        if (depth[ti] == null) {
          depth[ti] = curDepth + 1;
          queue.push(ti);
        }
      }
    }
  }

  const out: PageAuthority[] = nodes.map((url, i) => ({
    url,
    authorityScore: rank[i]!,
    clickDepth: depth[i] ?? null,
    orphaned: inboundSets[i]!.size === 0,
    inboundCount: inboundSets[i]!.size,
  }));

  return { pages: out, homepage, totalEdges, builtAt };
}
