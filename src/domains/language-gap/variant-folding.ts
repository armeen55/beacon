/**
 * language-gap/variant-folding (2026-07-02, master plan item 24) - PURE.
 *
 * The many Latin spellings of one Farsi phrase ("chaharshanbe soori",
 * "chaharshanbeh suri", "4shanbe soori", "char shanbeh soori"...) are the
 * SAME demand fractured across GSC rows by inconsistent romanization. This
 * module folds those spelling families down to one canonical key so they can
 * be clustered and their impressions summed, and reports which spellings
 * exist so a page can be told exactly which ones it is missing.
 *
 * TENANT-AGNOSTIC STRUCTURE: `foldVariant` takes a folding TABLE as data (an
 * ordered list of {pattern, replacement} rewrite rules over a normalized
 * string), not hardcoded logic. `PERSIAN_FOLDING_TABLE` is the first shipped
 * table; a Spanish-restaurant tenant would ship a different table (e.g.
 * accent folding, "ñ" -> "n", double-consonant collapse) through the exact
 * same `foldVariant(text, table)` function.
 *
 * Deterministic, $0, no I/O.
 */

/** One rewrite rule in a folding table: replace every match of `pattern`
 *  with `replacement` in the normalized (lowercased, trimmed) string. Rules
 *  apply in array order, each over the PREVIOUS rule's output, so earlier
 *  rules can set up patterns later rules rely on. */
export type FoldingRule = {
  pattern: RegExp;
  replacement: string;
  /** Short human label for why this rule exists (debugging / tests only). */
  label: string;
};

/**
 * Persian romanization folding table (the first shipped table). Collapses
 * the spelling families a Latin-keyboard Farsi typist produces for the same
 * underlying word, so "chaharshanbe", "chaharshanbeh", "char shanbeh", and
 * "4shanbe" all fold to the same key. Order matters: digit-for-word rules run
 * first (before whitespace/hyphen collapse would hide the digit), then
 * word-boundary-sensitive digraph/vowel folding (while spaces/hyphens still
 * mark word edges), then whitespace normalization last (so separator style
 * itself never fractures a family).
 */
export const PERSIAN_FOLDING_TABLE: readonly FoldingRule[] = [
  // Digit-for-word: Finglish typists sometimes spell the Farsi number word
  // with the digit it sounds like ("4shanbe" = chahar+shanbe, "se shanbeh"
  // sometimes typed "3shanbe"). Expand back to the letter form BEFORE other
  // folding runs, so "4shanbe" and "chaharshanbe" converge.
  { pattern: /\b4\s*-?\s*shanbe/gi, replacement: "chaharshanbe", label: "digit-4-for-chahar" },
  { pattern: /\b3\s*-?\s*shanbe/gi, replacement: "seshanbe", label: "digit-3-for-se" },
  // "char" is a common clipped elision of "chahar" (the Farsi word for four) -
  // both spellings feed the same "chaharshanbe" family. Expand it back BEFORE
  // other folding runs, mirroring the digit-for-word expansion above.
  { pattern: /\bchar(?=\s*-?\s*shanbe)/gi, replacement: "chahar", label: "char-elision-for-chahar" },
  // Word-final "eh" and bare "e" both spell the same short vowel Farsi words
  // often end on (chaharshanbeh / chaharshanbe, hafteh / hafte). Runs BEFORE
  // separator collapse, while a space/hyphen/string-end still marks the word
  // boundary the "final" test depends on.
  { pattern: /eh(?=[\s-]|$)/g, replacement: "e", label: "final-eh-to-e" },
  // Drop separators between word fragments people sometimes split
  // ("char shanbeh" / "chahar-shanbeh" / "chahar shanbe").
  { pattern: /[\s-]+/g, replacement: "", label: "collapse-separators" },
  // "kh" / "x" / "gh" all attempt the same back-of-throat Farsi sounds
  // (خ and ق/غ). Fold every variant to one marker.
  { pattern: /kh/g, replacement: "x", label: "kh-to-x" },
  { pattern: /gh/g, replacement: "x", label: "gh-to-x" },
  // Double vowels stand in for Persian's long vowels; collapse to one
  // (norooz / norouz / noroz, sabzi stays sabzi, aash / ash).
  { pattern: /aa/g, replacement: "a", label: "double-a" },
  { pattern: /ee/g, replacement: "i", label: "double-e" },
  { pattern: /oo/g, replacement: "u", label: "double-o" },
  // "ou" is a common alternate spelling of the same long-u sound ("nowruz"
  // vs "norouz" vs "norooz" - "ow"/"ou" both approximate the same vowel).
  { pattern: /ou/g, replacement: "u", label: "ou-to-u" },
  { pattern: /ow/g, replacement: "u", label: "ow-to-u" },
  // "soori" / "suri" - the long-i ending collapses the same way as above,
  // covered by double-o and the general vowel folds; "s" vs "s" is stable.
];

/**
 * A short list of common Persian-culture Latin-script word roots, shipped as
 * DATA alongside the folding table (not logic in classify-query.ts, which
 * stays language-agnostic). This is what lets classifyQuery confidently tag
 * short, otherwise-ambiguous romanizations ("chaharshanbe", "norooz",
 * "tahdig") that carry too few generic digraph/vowel signals on their own to
 * clear the conservative heuristic bar (the bar is intentionally strict,
 * because English absorbed similar consonant clusters from real loanwords -
 * "khan", "ghost", "cheetah" - and a looser bar false-positives on those).
 * A different tenant's language pair would ship its own such list alongside
 * its own folding table, passed the same way.
 */
export const PERSIAN_KNOWN_LATIN_ROOTS: readonly string[] = [
  "chaharshanbe",
  "charshanbe",
  "norooz",
  "norouz",
  "nowruz",
  "tahdig",
  "khoresht",
  "ghormeh",
  "shabeyalda",
  "shab e yalda",
  "yalda",
  "sizdah bedar",
  "sizdahbedar",
];

/**
 * Fold one query string through a folding table into a canonical key.
 * Lowercases + trims first, then applies each rule in order. Pure string
 * rewriting - never throws, never does I/O.
 */
export function foldVariant(query: string, table: readonly FoldingRule[] = PERSIAN_FOLDING_TABLE): string {
  let out = (query ?? "").trim().toLowerCase();
  // Strip punctuation that carries no phonetic meaning (quotes, question
  // marks) before folding, so "chaharshanbeh?" and "chaharshanbeh" match.
  out = out.replace(/[^\p{L}\p{N}\s-]/gu, "");
  for (const rule of table) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

export type QueryImpressions = {
  query: string;
  impressions: number;
  clicks?: number;
};

export type VariantCluster = {
  /** Canonical folded key shared by every variant in this cluster. */
  canonicalKey: string;
  /** Every distinct raw spelling seen, each with its own impression count,
   *  sorted by impressions descending (the most-typed spelling first). */
  variants: Array<{ query: string; impressions: number; clicks: number }>;
  /** Sum of impressions across every variant in the cluster. */
  totalImpressions: number;
  totalClicks: number;
  /** The most-typed spelling - the natural "canonical display form" to show
   *  the operator (never the folded key, which is not human copy). */
  topVariant: string;
};

/**
 * Group a list of (query, impressions) rows into transliteration-variant
 * clusters using a folding table. Rows whose folded key matches share a
 * cluster; each cluster's variants are ranked by impressions, and clusters
 * themselves are ranked by total impressions (biggest demand family first).
 *
 * PURE, deterministic. Never mutates input. Rows with an empty query, or a
 * query that folds to an empty string, are dropped.
 */
export function clusterVariants(
  queries: QueryImpressions[],
  table: readonly FoldingRule[] = PERSIAN_FOLDING_TABLE,
): VariantCluster[] {
  const byKey = new Map<string, Map<string, { impressions: number; clicks: number }>>();
  for (const q of queries) {
    const raw = (q.query ?? "").trim();
    if (!raw) continue;
    const key = foldVariant(raw, table);
    if (!key) continue;
    let variants = byKey.get(key);
    if (!variants) {
      variants = new Map();
      byKey.set(key, variants);
    }
    const existing = variants.get(raw) ?? { impressions: 0, clicks: 0 };
    existing.impressions += Math.max(0, q.impressions) || 0;
    existing.clicks += Math.max(0, q.clicks ?? 0) || 0;
    variants.set(raw, existing);
  }

  const clusters: VariantCluster[] = [];
  for (const [canonicalKey, variantMap] of byKey) {
    const variants = [...variantMap.entries()]
      .map(([query, agg]) => ({ query, impressions: agg.impressions, clicks: agg.clicks }))
      .sort((a, b) => b.impressions - a.impressions);
    const totalImpressions = variants.reduce((s, v) => s + v.impressions, 0);
    const totalClicks = variants.reduce((s, v) => s + v.clicks, 0);
    clusters.push({
      canonicalKey,
      variants,
      totalImpressions,
      totalClicks,
      topVariant: variants[0]?.query ?? canonicalKey,
    });
  }
  clusters.sort((a, b) => b.totalImpressions - a.totalImpressions);
  return clusters;
}
