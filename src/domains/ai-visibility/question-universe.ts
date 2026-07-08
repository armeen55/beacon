/**
 * question-universe (2026-07-01, master plan item 8) - PURE builder for the
 * nightly poll's question set. Item 4 polled only the top 25 prompt-library
 * questions; this merges in (1) the tenant's REAL Profound tracked prompts and
 * (2) the ranked fanout sub-queries AI engines actually expand those prompts
 * into, so the poll asks what real people ask, not just what we seeded.
 *
 * COST DISCIPLINE: the combined set is deduped, junk-filtered, ranked and
 * CAPPED at NIGHTLY_PROMPT_CAP (25). The cap argument is CLAMPED to that
 * ceiling in code - callers cannot raise the nightly spend by passing a bigger
 * number. Ordering is stable and deterministic: library first (curated,
 * cache-continuous ids), then Profound prompts (volume desc, recency desc,
 * input order), then fanouts (weight desc, text asc).
 *
 * Junk gate (narrow-reject, borrowed-account reality): the hackathon Profound
 * workspace seeds "Evaluate the Frontier Models company ChatGPT on ..." style
 * sentiment prompts inside the tenant topic. Those are about AI brands, not
 * the tenant, so they are excluded here even if the topic filter let them
 * through. The gate is deliberately narrow so real tenant questions are never
 * silently dropped. No I/O - fully unit-testable.
 */

import { NIGHTLY_PROMPT_CAP } from "./engine-types";

export type QuestionSource = "library" | "profound" | "fanout";

/** A prompt-library question (curated by the operator, always trusted). */
export type LibraryQuestionInput = {
  id: string;
  prompt_text: string;
  topic?: string | null;
};

/** A Profound tracked prompt, already topic-scoped by the loader. */
export type ProfoundQuestionInput = {
  /** Stable id (the Profound prompt id). Used for cache + observation keys. */
  id: string;
  text: string;
  topic?: string | null;
  /** Optional ranking signal (e.g. answer volume in the window); higher first. */
  volume?: number;
  /** Optional recency signal (ISO date); newer first when volumes tie. */
  lastSeenAt?: string | null;
};

/** A ranked fanout sub-query (what the engine actually searches for). */
export type FanoutQuestionInput = {
  subQuery: string;
  weight: number;
};

export type UniverseQuestion = {
  /** Stable key for the 20h answer cache + observation identity. */
  id: string;
  /** The exact question sent to every engine, verbatim. */
  text: string;
  topic: string | null;
  source: QuestionSource;
};

export type QuestionUniverse = {
  questions: UniverseQuestion[];
  /** Accepted questions per source (post junk filter, dedupe and cap). */
  counts: Record<QuestionSource, number>;
  /** Honest accounting of what was excluded and why. */
  dropped: { junk: number; duplicate: number; overCap: number };
};

// ---------------------------------------------------------------------------
// Normalization + token overlap (the dedupe currency)
// ---------------------------------------------------------------------------

const STOP = new Set([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are",
  "what", "how", "why", "when", "where", "who", "which", "do", "does", "did",
  "i", "you", "your", "my", "me", "we", "us", "it", "its", "at", "by", "from",
  "with", "about", "can", "should", "would", "will", "there", "their", "be",
  "com", "www", "http", "https",
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeQuestion(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant tokens for overlap math. Numeric tokens COUNT as significant:
 *  a year or a count is real demand ("nowruz 2026" is not "nowruz 2025"), so
 *  questions differing only by a number must NOT collapse. Falls back to ALL
 *  tokens when the question is too short to have 3 significant ones (so short
 *  questions still dedupe against each other instead of degenerating to empty
 *  sets). */
export function significantTokens(text: string): Set<string> {
  const all = normalizeQuestion(text).split(" ").filter((t) => t.length > 0);
  const sig = all.filter((t) => (t.length > 2 && !STOP.has(t)) || /^\d+$/.test(t));
  return new Set(sig.length >= 3 ? sig : all);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Two questions are near-identical when their normalized significant tokens
 *  overlap at Jaccard >= 0.8 (or the normalized strings are equal). */
export const NEAR_DUP_JACCARD = 0.8;

// ---------------------------------------------------------------------------
// Junk gate (applies to profound + fanout questions; library is curated)
// ---------------------------------------------------------------------------

export type JunkReason = "too_short" | "brand_sentiment_template" | "off_topic_ai_brand";

/** "Evaluate the Frontier Models company ChatGPT on ..." and friends - the
 *  borrowed-account sentiment seeds. Narrow on purpose. */
const BRAND_SENTIMENT_RE = /^\s*(evaluate|rate|assess|review)\b[^.?!]*\bcompany\b/i;

/** Tenant-agnostic: is this the "Evaluate the Frontier Models company X" borrowed-account
 *  junk that a Profound import leaks into a tenant's tracked prompts? Exported so the
 *  prompt RUN path and the reseed SEED path both drop it, not just the question universe. */
export function isBorrowedAccountSentinelPrompt(text: string): boolean {
  return BRAND_SENTIMENT_RE.test(text);
}

/** AI-company markers for the off-topic gate. Bare "claude" and "gemini" are
 *  intentionally excluded (person names, zodiac); the phrase forms cover the
 *  AI products. */
const AI_BRAND_RE =
  /\b(openai|chatgpt|gpt-\d|anthropic|claude ai|gemini ai|google gemini|perplexity|copilot|frontier models|deepseek|grok|mistral ai)\b/i;

/**
 * Why a candidate question is junk, or null when it is fine. The off-topic
 * gate only fires when a relevance pool exists AND the question names an AI
 * company AND shares zero significant tokens with the pool - a question about
 * the tenant that happens to mention ChatGPT survives.
 */
export function questionJunkReason(
  text: string,
  relevancePool: ReadonlySet<string>,
): JunkReason | null {
  const norm = normalizeQuestion(text);
  if (norm.length < 8 || significantTokens(text).size < 2) return "too_short";
  if (BRAND_SENTIMENT_RE.test(text)) return "brand_sentiment_template";
  if (relevancePool.size > 0 && AI_BRAND_RE.test(text)) {
    const toks = significantTokens(text);
    let shared = 0;
    for (const t of toks) if (relevancePool.has(t)) shared += 1;
    if (shared === 0) return "off_topic_ai_brand";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stable fanout ids (FNV-1a over the normalized text)
// ---------------------------------------------------------------------------

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function fanoutQuestionId(subQuery: string): string {
  return `fan-${fnv1a(normalizeQuestion(subQuery))}`;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export type BuildQuestionUniverseArgs = {
  libraryPrompts: readonly LibraryQuestionInput[];
  profoundPrompts?: readonly ProfoundQuestionInput[];
  fanoutSeeds?: readonly FanoutQuestionInput[];
  /** Clamped to NIGHTLY_PROMPT_CAP - the nightly ceiling can NEVER be raised
   *  from a call site, only lowered. */
  cap?: number;
  /** Tenant tokens (brand name, domain root, topic label) that seed the
   *  relevance pool for the off-topic junk gate. Library prompt tokens are
   *  always added to the pool automatically. */
  relevanceTokens?: readonly string[];
};

export function buildQuestionUniverse(args: BuildQuestionUniverseArgs): QuestionUniverse {
  const cap = Math.max(1, Math.min(args.cap ?? NIGHTLY_PROMPT_CAP, NIGHTLY_PROMPT_CAP));

  // Relevance pool: explicit tenant tokens + everything the curated library
  // already talks about. Empty pool switches the off-topic gate off.
  const relevancePool = new Set<string>();
  for (const t of args.relevanceTokens ?? []) {
    for (const tok of significantTokens(t)) relevancePool.add(tok);
    // Short brand tokens ("iran") matter too; significantTokens may drop them.
    const bare = normalizeQuestion(t);
    if (bare.length >= 3 && !bare.includes(" ")) relevancePool.add(bare);
  }
  for (const p of args.libraryPrompts) {
    for (const tok of significantTokens(`${p.prompt_text} ${p.topic ?? ""}`)) relevancePool.add(tok);
  }

  // Rank inside each source, then concatenate library -> profound -> fanout.
  const profound = [...(args.profoundPrompts ?? [])]
    .map((p, idx) => ({ p, idx }))
    .sort(
      (a, b) =>
        (b.p.volume ?? 0) - (a.p.volume ?? 0) ||
        (b.p.lastSeenAt ?? "").localeCompare(a.p.lastSeenAt ?? "") ||
        a.idx - b.idx,
    )
    .map(({ p }) => p);
  const fanouts = [...(args.fanoutSeeds ?? [])].sort(
    (a, b) => b.weight - a.weight || a.subQuery.localeCompare(b.subQuery),
  );

  type Candidate = { q: UniverseQuestion; junkGated: boolean };
  const candidates: Candidate[] = [
    ...args.libraryPrompts.map((p) => ({
      q: { id: p.id, text: p.prompt_text, topic: p.topic ?? null, source: "library" as const },
      junkGated: false,
    })),
    ...profound.map((p) => ({
      q: { id: p.id, text: p.text, topic: p.topic ?? null, source: "profound" as const },
      junkGated: true,
    })),
    ...fanouts.map((f) => ({
      q: { id: fanoutQuestionId(f.subQuery), text: f.subQuery, topic: null, source: "fanout" as const },
      junkGated: true,
    })),
  ];

  const accepted: Array<{ q: UniverseQuestion; norm: string; toks: Set<string> }> = [];
  const seenIds = new Set<string>();
  const counts: Record<QuestionSource, number> = { library: 0, profound: 0, fanout: 0 };
  const dropped = { junk: 0, duplicate: 0, overCap: 0 };

  for (const { q, junkGated } of candidates) {
    const norm = normalizeQuestion(q.text);
    if (norm.length === 0 || !q.id.trim()) continue; // unusable either way
    if (junkGated && questionJunkReason(q.text, relevancePool) !== null) {
      dropped.junk += 1;
      continue;
    }
    const toks = significantTokens(q.text);
    const dup =
      seenIds.has(q.id) ||
      accepted.some((a) => a.norm === norm || jaccard(a.toks, toks) >= NEAR_DUP_JACCARD);
    if (dup) {
      dropped.duplicate += 1;
      continue;
    }
    if (accepted.length >= cap) {
      dropped.overCap += 1;
      continue;
    }
    accepted.push({ q, norm, toks });
    seenIds.add(q.id);
    counts[q.source] += 1;
  }

  return { questions: accepted.map((a) => a.q), counts, dropped };
}
