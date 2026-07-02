/**
 * canonical-create-page (2026-06-29) — collapse near-duplicate create-page candidates
 * (nowruz activities USA / kids / persian-new-year; persian wedding / iranian wedding)
 * into ONE canonical card per real opportunity, so the New Pages board stops splitting
 * the same demand across sibling labels and a high-volume topic shows brief-ready when
 * any sibling's brief passed.
 *
 * CONSERVATIVE by construction — two candidates merge only on a STRONG same-topic signal:
 *  - same matched DataForSEO keyword (literally the same search demand: the 3 nowruz
 *    labels all map to "nowruz persian new year"), OR
 *  - an IDENTICAL distinguishing-token set (brand-variant only: persian wedding ≡
 *    iranian wedding, both {wedding}).
 * It does NOT merge on a single shared token or subset overlap, so "culture iran" vs
 * "iranian culture etiquette" (etiquette = its own intent) and "persian art" vs "art
 * persian literature" stay SEPARATE unless they share the exact keyword. PURE.
 *
 * Pinned by canonical-create-page.test.ts.
 */

export type CanonCandidate = {
  demandKey: string;
  /** Cleaned display label. */
  label: string;
  /** Distinguishing tokens (generic/brand/filler already stripped by the caller). */
  distinctTokens: string[];
  /** Matched cached keyword (ANY confidence) — the topic anchor for grouping. Null only
   *  when nothing matched. The matcher already requires a shared distinguishing token,
   *  so a shared keyword (even weak) means the same topic. */
  keyword: string | null;
  /** True when the keyword match is strong/exact — gates HIGH-confidence grouping +
   *  brief inheritance (a weak-keyword merge still collapses the card but won't inherit). */
  strongKeyword?: boolean;
  volume: number;
  verdict: "build" | "wait" | "reject" | null;
  hasPassingBrief: boolean;
  /** Opportunity score (R&R move score / ActionPack priorityScore) — the canonical
   *  tiebreaker so a much higher-opportunity sibling isn't dropped for one with a
   *  marginally better verdict. Defaults to 0 when unknown. */
  priority?: number;
};

export type CanonGroup = {
  canonical: CanonCandidate;
  /** Group members other than the canonical (the "also covers" variants). */
  siblings: CanonCandidate[];
  reason: string;
  confidence: "high" | "medium";
  /** demandKey of a sibling whose PASSING brief the canonical can inherit, else null. */
  inheritBriefFrom: string | null;
};

function equalSets(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((t) => sb.has(t));
}

/** Any shared distinguishing token between the two candidates THEMSELVES (not just via
 *  a shared keyword). Two candidates that both loosely touch the same noisy keyword but
 *  share NOTHING with each other are unrelated (ground-truth: "Travel Iran Beautiful
 *  Natural Wonders" and "Most Popular Sports Iran" must never merge just because both
 *  weak-matched a generic cached keyword). */
function shareOwnToken(a: CanonCandidate, b: CanonCandidate): boolean {
  const sb = new Set(b.distinctTokens);
  return a.distinctTokens.some((t) => sb.has(t));
}

/** Same matched keyword is the strongest signal (the nowruz trio all anchor on "nowruz
 *  persian new year"); an identical distinguishing-token set is the brand-variant signal
 *  (persian wedding ≡ iranian wedding). A keyword merge is "strong" only when BOTH sides
 *  matched it strongly — a weak-keyword merge still collapses the card but is "weak"
 *  (medium confidence, won't inherit a brief), and ONLY when the two candidates ALSO
 *  share a distinguishing token with each other (never merge on the keyword alone — a
 *  noisy cached keyword can loosely touch two genuinely unrelated topics). Nothing else
 *  merges. */
function mergeSignal(a: CanonCandidate, b: CanonCandidate): "keyword" | "keyword_weak" | "tokens" | null {
  if (a.keyword && b.keyword && a.keyword === b.keyword) {
    if (a.strongKeyword && b.strongKeyword) return "keyword";
    return shareOwnToken(a, b) ? "keyword_weak" : null;
  }
  if (equalSets(a.distinctTokens, b.distinctTokens)) return "tokens";
  return null;
}

/** Rank a group's members to pick the canonical representative (operator's order):
 *  BUILD verdict → has a strong/exact keyword (real volume) → higher volume →
 *  already-passing brief → higher OPPORTUNITY score (don't drop a high-value sibling
 *  for a marginally-better verdict) → shorter (cleaner) label. */
function canonicalRank(c: CanonCandidate): [number, number, number, number, number, number] {
  return [
    c.verdict === "build" ? 1 : 0,
    c.keyword ? 1 : 0,
    c.volume,
    c.hasPassingBrief ? 1 : 0,
    c.priority ?? 0,
    -c.label.length,
  ];
}
function better(a: CanonCandidate, b: CanonCandidate): boolean {
  const ra = canonicalRank(a);
  const rb = canonicalRank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i];
  }
  return false;
}

/**
 * Group create-page candidates into canonical opportunities. Union-find over the two
 * conservative merge signals; one CanonGroup per cluster with a chosen canonical,
 * its siblings, the merge reason/confidence, and a brief to inherit when the canonical
 * lacks one. Singletons (no sibling) return a group with empty siblings. PURE.
 */
export function groupCreatePageCandidates(cands: readonly CanonCandidate[]): CanonGroup[] {
  const n = cands.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // Track whether ANY strong-keyword merge formed the group → HIGH confidence (gates brief
  // inheritance). A weak-keyword or token merge is medium.
  const strongMerge = new Set<number>();

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sig = mergeSignal(cands[i], cands[j]);
      if (!sig) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) {
        parent[rj] = ri;
        if (strongMerge.has(rj)) strongMerge.add(ri); // carry strength across the union
      }
      if (sig === "keyword") strongMerge.add(find(i));
    }
  }

  const byRoot = new Map<number, CanonCandidate[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(cands[i]);
  }

  const groups: CanonGroup[] = [];
  for (const [root, members] of byRoot) {
    let canonical = members[0];
    for (const m of members) if (better(m, canonical)) canonical = m;
    const siblings = members.filter((m) => m.demandKey !== canonical.demandKey);
    const isStrong = strongMerge.has(root);
    const confidence: CanonGroup["confidence"] = isStrong ? "high" : "medium";

    // Inherit a sibling's passing brief ONLY for a high-confidence (strong-keyword) group —
    // a loose merge collapses the card but won't borrow copy.
    let inheritBriefFrom: string | null = null;
    if (!canonical.hasPassingBrief && isStrong) {
      const donor = siblings.find((s) => s.hasPassingBrief);
      if (donor) inheritBriefFrom = donor.demandKey;
    }

    const reason =
      siblings.length === 0
        ? "Unique topic"
        : isStrong
          ? `Same search demand${canonical.keyword ? ` ("${canonical.keyword}")` : ""} as ${members.length - 1} sibling${members.length === 2 ? "" : "s"}`
          : `Same topic as ${members.length - 1} sibling${members.length === 2 ? "" : "s"}`;

    groups.push({ canonical, siblings, reason, confidence, inheritBriefFrom });
  }

  // Stable, useful order: canonical volume desc (the board already re-ranks, but this
  // keeps the grouping deterministic + test-friendly).
  return groups.sort((a, b) => b.canonical.volume - a.canonical.volume);
}
