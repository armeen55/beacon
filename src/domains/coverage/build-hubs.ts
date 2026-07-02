/**
 * build-hubs (2026-07-02, master-plan item 9) - PURE topic clustering for the
 * coverage map. Groups the demand universe (GSC queries, keyword-universe terms,
 * AI prompts, fanout sub-queries) into topic hubs by normalized token overlap.
 *
 * Rules (all deterministic, $0, no LLM, tenant-agnostic):
 *   - Unicode-aware tokenizer (reuses the Persian-aware pattern from
 *     prompt-answer-observations/extraction.ts: \p{L}\p{N} with /u so Persian,
 *     Arabic, and every other script produce real tokens; ZWNJ + Arabic-vs-
 *     Persian letterform normalization so variants match).
 *   - Two terms join a cluster when they share >= 2 significant tokens
 *     (>= 1 when either side has only one significant token).
 *   - Corpus "glue" tokens (appearing in > 25% of terms, only checked on
 *     corpora of 40+ terms) are pruned before clustering so a qualifier like a
 *     nationality word cannot chain every topic into one mega hub.
 *   - Transitive chaining can still weld a dense corpus into one giant
 *     component (ground-truthed on real data: one hub swallowed 95% of
 *     terms). Any cluster above MAX_HUB_SIZE is recursively split by anchor
 *     token (each term's most frequent non-glue token within the cluster),
 *     which converges because an anchor group can never exceed the local
 *     glue threshold.
 *   - Clusters below minClusterSize fall into one "other" bucket.
 *   - The hub label is its highest-demand member term; ordering is total
 *     demand desc then label asc, so output is stable across runs.
 *   - Em/en dashes in source texts are folded to plain hyphens (they are
 *     banned on every Beacon surface).
 */

export type HubTermSource = "search" | "keyword" | "ai_question" | "fanout";

/** One question/query/term in the demand universe, with its coverage flags. */
export type HubTerm = {
  /** The question or query text, verbatim. */
  text: string;
  /** Demand weight (GSC impressions, search volume, AI executions, fanout weight). */
  demand: number;
  source: HubTermSource;
  /** Owned URL that answers this term, or null when no owned page matches. */
  answeredBy: string | null;
  /** An AI answer for this exact term has been observed/checked. */
  aiChecked: boolean;
  /** When checked, the AI cited or recommended the tenant. */
  aiCited: boolean;
};

export type TopicHub = {
  /** Stable key from the cluster's top tokens, e.g. "hub:haft-sin-table". */
  key: string;
  /** Human label: the highest-demand member term (ASCII words title-cased). */
  label: string;
  /** Member terms, demand desc then text asc. */
  terms: HubTerm[];
  totalDemand: number;
};

export type BuildHubsResult = {
  /** Real hubs (size >= minClusterSize), total demand desc then label asc. */
  hubs: TopicHub[];
  /** Singletons + sub-threshold clusters, or null when none exist. */
  other: TopicHub | null;
};

// English function/question words. Kept close to the demand-graph STOP set so
// content-bearing words ("new" in "persian new year") are NOT over-blocked.
const EN_STOP = new Set([
  "the", "and", "for", "are", "was", "were", "with", "without", "best", "top",
  "how", "what", "why", "when", "where", "who", "which", "list", "guide",
  "your", "you", "our", "their", "this", "that", "these", "those", "from",
  "about", "near", "into", "does", "did", "can", "could", "should", "would",
  "will", "has", "have", "had", "its", "they", "them", "there", "here",
  "other", "another", "some", "any", "all", "much", "many", "more", "most",
  "than", "then", "per", "not", "versus",
  // first-person contractions (AI prompts are often phrased "I'm hosting...")
  "i'm", "i've", "i'll", "i'd", "you're", "you've", "we're", "they're",
  "it's", "what's", "who's", "how's", "let's", "don't", "doesn't", "can't",
  "won't", "isn't", "aren't", "didn't",
]);

// Persian/Farsi function + question words (3+ chars; <=2-char particles are
// dropped by the length filter). Same set family as extraction.ts, plus the
// question words a coverage universe naturally contains. ZWNJ is stripped
// before matching, so compound forms normalize to their joined spelling.
const FA_STOP = new Set([
  "این", "آن", "است", "بود", "شده", "شود", "میشود", "هست", "هستند",
  "برای", "خود", "های", "آنها", "باید", "دیگر", "همه", "نیز", "اما",
  "یعنی", "روی", "کرد", "کند", "کنید", "دارد", "داشت", "بین", "هیچ",
  "چون", "اگر", "تنها", "حتی", "بسیار", "خیلی", "چیست", "چگونه", "چطور",
  "کجا", "چرا", "کدام", "چند", "آیا", "درباره", "مورد",
]);

// Unicode-aware word pattern (letters + digits in every script, internal
// apostrophes/hyphens kept) - the repo's Persian-safe tokenizer shape.
const WORD_RE = /[\p{L}\p{N}_]+(?:['’\-][\p{L}\p{N}_]+)*/gu;

/**
 * Tokenize a topic/query string: lowercase, normalize Persian letterforms
 * (Arabic yeh/kaf to Persian, strip ZWNJ), drop pure numbers in any script,
 * drop stopwords, dedupe preserving order. Latin tokens need >= 3 chars;
 * non-Latin tokens need >= 2 (Persian content words can be 2-3 chars).
 */
export function tokenizeTopic(s: string): string[] {
  if (!s) return [];
  const normalized = s
    .toLowerCase()
    .replace(/‌/g, "") // ZWNJ: Persian compounds normalize to the joined form
    .replace(/ي/g, "ی") // Arabic yeh -> Persian yeh
    .replace(/ك/g, "ک"); // Arabic kaf -> Persian kaf
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of normalized.replace(/’/g, "'").matchAll(WORD_RE)) {
    const t = m[0];
    if (/^[\p{N}]+$/u.test(t)) continue; // pure numbers, any script (2026, ۱۴۰۵)
    const hasLatin = /[a-z]/.test(t);
    if (t.length < (hasLatin ? 3 : 2)) continue;
    if (EN_STOP.has(t) || FA_STOP.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Shared significant-token count between two token sets. */
export function sharedTokenCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) shared += 1;
  return shared;
}

/** Join threshold: 2 shared tokens, or 1 when either side has a single token. */
function joinNeeded(aSize: number, bSize: number): number {
  return aSize === 1 || bSize === 1 ? 1 : 2;
}

function titleCaseAscii(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const MAX_LABEL_CHARS = 60;

/** Hub label: the highest-demand member term, title-cased, clamped to a
 *  readable length on a word boundary (full prompts can be whole sentences). */
function hubLabel(text: string): string {
  const t = titleCaseAscii(text);
  if (t.length <= MAX_LABEL_CHARS) return t;
  const cut = t.slice(0, MAX_LABEL_CHARS).replace(/\s+\S*$/, "");
  return (cut || t.slice(0, MAX_LABEL_CHARS)).trim() + "...";
}

const DEFAULT_MIN_CLUSTER = 3;
const DEFAULT_MAX_TERMS = 1200;
/** Glue-token pruning only kicks in on real corpora, never tiny test inputs. */
const GLUE_MIN_CORPUS = 40;
const GLUE_DF_RATIO = 0.25;
/** A hub bigger than this is a chained mega component, not a topic - split it. */
const MAX_HUB_SIZE = 60;

/** Em/en dashes, built from char codes so the banned characters never appear
 *  literally in this source file. Folded to a plain hyphen. */
const DASH_RE = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`, "g");

/**
 * Split an oversized cluster by ANCHOR TOKEN: each member goes to the group of
 * its most frequent non-glue token WITHIN the cluster (ties: alpha). A group
 * can never exceed the local glue threshold (a token in more than 25% of
 * members is glue and cannot anchor), so recursion strictly shrinks. Members
 * whose every token is glue form one un-split misc group.
 */
function splitByAnchor(memberIdx: ReadonlyArray<number>, rawTokens: ReadonlyArray<Set<string>>): number[][] {
  const m = memberIdx.length;
  const df = new Map<string, number>();
  for (const i of memberIdx) for (const t of rawTokens[i]!) df.set(t, (df.get(t) ?? 0) + 1);
  const glueCut = Math.ceil(m * GLUE_DF_RATIO);
  const groups = new Map<string, number[]>();
  const misc: number[] = [];
  for (const i of memberIdx) {
    let anchor: string | null = null;
    let bestDf = 0;
    for (const t of rawTokens[i]!) {
      const d = df.get(t)!;
      if (d > glueCut) continue; // glue cannot anchor
      if (d > bestDf || (d === bestDf && anchor !== null && t.localeCompare(anchor) < 0)) {
        anchor = t;
        bestDf = d;
      }
    }
    if (anchor === null) {
      misc.push(i);
      continue;
    }
    const g = groups.get(anchor);
    if (g) g.push(i);
    else groups.set(anchor, [i]);
  }
  const out: number[][] = [];
  for (const [, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (g.length > MAX_HUB_SIZE && g.length < m) out.push(...splitByAnchor(g, rawTokens));
    else out.push(g);
  }
  if (misc.length > 0) out.push(misc);
  return out;
}

export function buildTopicHubs(
  terms: ReadonlyArray<HubTerm>,
  opts: { minClusterSize?: number; maxTerms?: number } = {},
): BuildHubsResult {
  const minClusterSize = Math.max(1, opts.minClusterSize ?? DEFAULT_MIN_CLUSTER);
  const maxTerms = Math.max(1, opts.maxTerms ?? DEFAULT_MAX_TERMS);

  // 1) Dedup by normalized text: max demand wins, coverage flags OR together,
  //    the first non-null answering page is kept.
  const byText = new Map<string, HubTerm>();
  for (const t of terms) {
    const text = (t.text ?? "").replace(DASH_RE, "-").trim().replace(/\s+/g, " ");
    if (!text) continue;
    const key = text.toLowerCase();
    const prev = byText.get(key);
    if (!prev) {
      byText.set(key, { ...t, text, demand: Math.max(0, t.demand || 0) });
    } else {
      byText.set(key, {
        text: prev.text,
        demand: Math.max(prev.demand, Math.max(0, t.demand || 0)),
        source: prev.source,
        answeredBy: prev.answeredBy ?? t.answeredBy ?? null,
        aiChecked: prev.aiChecked || t.aiChecked,
        aiCited: prev.aiCited || t.aiCited,
      });
    }
  }

  // 2) Deterministic working order + bound: demand desc, then text asc.
  const items = [...byText.values()]
    .sort((a, b) => b.demand - a.demand || a.text.localeCompare(b.text))
    .slice(0, maxTerms);
  const n = items.length;
  if (n === 0) return { hubs: [], other: null };

  // 3) Tokenize + prune corpus glue (a token in > 25% of terms is a qualifier,
  //    not a topic - it must not chain unrelated topics into one mega hub).
  const rawTokens = items.map((it) => new Set(tokenizeTopic(it.text)));
  const df = new Map<string, number>();
  for (const toks of rawTokens) for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  const glueCut = n >= GLUE_MIN_CORPUS ? Math.ceil(n * GLUE_DF_RATIO) : Number.POSITIVE_INFINITY;
  const tokens = rawTokens.map((toks) => {
    const pruned = new Set<string>();
    for (const t of toks) if ((df.get(t) ?? 0) <= glueCut) pruned.add(t);
    return pruned;
  });

  // 4) Union-find over token-overlap joins, via an inverted index so we only
  //    compare pairs that share at least one token.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    // path compression
    let c = x;
    while (parent[c] !== r) {
      const next = parent[c]!;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const postings = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const t of tokens[i]!) {
      const list = postings.get(t);
      if (list) list.push(i);
      else postings.set(t, [i]);
    }
  }
  for (let i = 0; i < n; i++) {
    const mine = tokens[i]!;
    if (mine.size === 0) continue;
    const candidates = new Set<number>();
    for (const t of mine) for (const j of postings.get(t)!) if (j > i) candidates.add(j);
    for (const j of [...candidates].sort((a, b) => a - b)) {
      const theirs = tokens[j]!;
      if (theirs.size === 0) continue;
      if (sharedTokenCount(mine, theirs) >= joinNeeded(mine.size, theirs.size)) union(i, j);
    }
  }

  // 5) Assemble clusters (terms with no significant tokens go straight to other).
  const clusters = new Map<number, number[]>();
  const otherIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (tokens[i]!.size === 0) {
      otherIdx.push(i);
      continue;
    }
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(i);
    else clusters.set(root, [i]);
  }

  // 6) Mega-component guard: recursively split any chained giant cluster into
  //    anchor-token hubs (real topics), before sizing/labeling.
  const clusterLists: number[][] = [];
  for (const memberIdx of clusters.values()) {
    if (memberIdx.length > MAX_HUB_SIZE) clusterLists.push(...splitByAnchor(memberIdx, rawTokens));
    else clusterLists.push(memberIdx);
  }

  const hubs: TopicHub[] = [];
  for (const memberIdx of clusterLists) {
    if (memberIdx.length < minClusterSize) {
      otherIdx.push(...memberIdx);
      continue;
    }
    const members = memberIdx
      .map((i) => items[i]!)
      .sort((a, b) => b.demand - a.demand || a.text.localeCompare(b.text));
    // Key: top 3 tokens by within-cluster frequency (then demand mass, then
    // alpha), alpha-sorted for stability.
    const freq = new Map<string, { count: number; demand: number }>();
    for (const i of memberIdx) {
      for (const t of tokens[i]!) {
        const e = freq.get(t) ?? { count: 0, demand: 0 };
        e.count += 1;
        e.demand += items[i]!.demand;
        freq.set(t, e);
      }
    }
    const keyTokens = [...freq.entries()]
      .sort((a, b) => b[1].count - a[1].count || b[1].demand - a[1].demand || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([t]) => t)
      .sort((a, b) => a.localeCompare(b));
    hubs.push({
      key: `hub:${keyTokens.join("-")}`,
      label: hubLabel(members[0]!.text),
      terms: members,
      totalDemand: members.reduce((s, m) => s + m.demand, 0),
    });
  }
  hubs.sort((a, b) => b.totalDemand - a.totalDemand || a.label.localeCompare(b.label));

  let other: TopicHub | null = null;
  if (otherIdx.length > 0) {
    const members = [...new Set(otherIdx)]
      .map((i) => items[i]!)
      .sort((a, b) => b.demand - a.demand || a.text.localeCompare(b.text));
    other = {
      key: "hub:other",
      label: "Everything else",
      terms: members,
      totalDemand: members.reduce((s, m) => s + m.demand, 0),
    };
  }

  return { hubs, other };
}
