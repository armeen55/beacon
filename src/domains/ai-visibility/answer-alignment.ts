/**
 * answer-alignment (BEACON 500 item 71) - "the passage that beat you, the line AI
 * quoted." Deterministic, NO LLM: sentence-split an AI answer and a page body, score
 * every (answer sentence, page sentence) pair by 5-gram shingle containment, and
 * return the best-aligned passages. Two callers reuse this same pure math:
 *
 *   - Competitor side: which literal words in a COMPETITOR page match the words an
 *     engine actually used in its answer ("the N words that beat you").
 *   - Owned side: which literal words in OUR OWN page match the words an engine used,
 *     once we know our page got cited ("AI quoted this line").
 *
 * PURE MODULE - no I/O, no server-only, no fetch. Callers supply plain text (answer
 * text + page text) already read from wherever it lives (Profound answer excerpts,
 * page_snapshots body samples, live-fetched competitor HTML). Deterministic and cheap
 * enough to run on every render; callers that want to skip recompute should cache by
 * contentHashOfAlignmentInputs() (see below) - e.g. via move-draft-store.
 *
 * HONESTY NOTE (ground-truth verified): the durable Profound answer store only keeps
 * a 500-char `response_excerpt`, and the native engine-poll pipeline only keeps a
 * 400-char `answer_excerpt` - neither persists the full untruncated AI answer text.
 * This module works correctly on short excerpts (shingle containment degrades
 * gracefully - fewer shingles just means fewer candidate matches, never a crash), but
 * callers should not claim "full answer" coverage than the excerpt actually gives.
 */

const SHINGLE_SIZE = 5;
/** Below this many words, a "sentence" cannot form a real 5-gram shingle - matches
 *  would just be noise (e.g. a bare "FAQ" heading or a stray fragment). */
const MIN_SENTENCE_WORDS = 4;
/** Never return an aligned passage below this containment score - avoids surfacing
 *  a "best of a bad lot" match that is really just two unrelated sentences sharing a
 *  couple of common words. */
const MIN_CONTAINMENT_SCORE = 0.2;

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

/** One sentence extracted from a body of text, with its position preserved so
 *  callers can show "the Nth sentence" or reconstruct surrounding context. */
export type SplitSentence = {
  text: string;
  /** 0-based index in the source's sentence order. */
  index: number;
  /** Word count (whitespace-split), used for the length-band summary later. */
  wordCount: number;
};

/**
 * Deterministic sentence splitter. Handles the common abbreviation traps (Mr./Dr./
 * e.g./i.e./U.S./etc.) well enough for shingle scoring purposes - this does not need
 * to be a perfect NLP sentence boundary detector, only a stable, repeatable one.
 * Also splits on newlines first (list items / headings rarely end in punctuation),
 * then on sentence-ending punctuation within each line.
 */
export function splitSentences(text: string): SplitSentence[] {
  const raw = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  const lines = raw.split(/\n+/);
  const pieces: string[] = [];
  const ABBREV = /\b(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc|e\.g|i\.e|u\.s|u\.k|no|approx|inc|corp|co|ltd|st|ave|dept)\.$/i;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    // Split on ./!/? followed by whitespace + capital/digit/quote, or end of string,
    // but protect known abbreviations from ending a sentence.
    const candidates = trimmedLine.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/);
    let buffer = "";
    for (const c of candidates) {
      buffer = buffer ? `${buffer} ${c}` : c;
      const endsAbbrev = ABBREV.test(buffer.trim().split(/\s+/).slice(-1)[0] ?? "");
      if (!endsAbbrev) {
        pieces.push(buffer.trim());
        buffer = "";
      }
    }
    if (buffer.trim()) pieces.push(buffer.trim());
  }

  const out: SplitSentence[] = [];
  let index = 0;
  for (const p of pieces) {
    const cleaned = p.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    out.push({ text: cleaned, index, wordCount });
    index += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shingles + containment
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation, collapse whitespace, split into word tokens. */
function tokenize(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Build the set of n-gram "shingles" (contiguous token windows joined by a space)
 * for a piece of text. Order-sensitive by design - two sentences that use the same
 * words in a different order should NOT score as a match; that is the whole point
 * of using shingles over a bag-of-words comparison.
 *
 * When the text has fewer than `n` tokens, falls back to the single whole-token
 * sequence as one shingle so very short sentences still produce a comparable
 * (if weak) signal instead of an empty set.
 */
export function shingles(text: string, n: number = SHINGLE_SIZE): Set<string> {
  const toks = tokenize(text);
  if (toks.length === 0) return new Set();
  if (toks.length < n) return new Set([toks.join(" ")]);
  const out = new Set<string>();
  for (let i = 0; i <= toks.length - n; i++) {
    out.add(toks.slice(i, i + n).join(" "));
  }
  return out;
}

/**
 * Containment score: what fraction of `needle`'s shingles also appear in
 * `haystack`'s shingles. Asymmetric on purpose - "did the page's words show up
 * inside the AI answer" is a containment question, not a Jaccard-overlap one (a
 * long page sentence sharing one short phrase with a short answer sentence should
 * not be diluted by the page sentence's own bulk).
 *
 * Returns 0 when either side has no shingles (nothing to compare).
 */
export function shingleContainment(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0 || haystack.size === 0) return 0;
  let hit = 0;
  for (const s of needle) if (haystack.has(s)) hit += 1;
  return hit / needle.size;
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

/** One AI answer sentence matched against its single best-aligned page sentence. */
export type AlignedPassage = {
  /** The AI answer's sentence (or the closest thing to it - an excerpt fragment). */
  answerSentence: string;
  /** The page sentence that shares the most literal wording with the answer sentence. */
  pageSentence: string;
  /** Shingle containment of the answer sentence's words inside the page sentence
   *  (0..1). Higher = more of the exact wording the engine used also lives on the
   *  page, in the same order. */
  score: number;
  /** How many literal 5-gram phrases the two sentences share (for a concrete "N
   *  words" style caption - N = (sharedShingleCount + shingleSize - 1) words at most,
   *  callers may present this directly as shared shingle count). */
  sharedShingleCount: number;
  answerSentenceIndex: number;
  pageSentenceIndex: number;
};

/**
 * Align an AI answer's sentences against a page's sentences. For each answer
 * sentence, finds the single best-matching page sentence by 5-gram shingle
 * containment (of the answer sentence's shingles inside the page sentence's
 * shingles). Skips answer sentences too short to form a real shingle (noise), and
 * drops any pair scoring below MIN_CONTAINMENT_SCORE. Sorted best-score-first.
 *
 * Pure, deterministic, no I/O, bounded (early-outs on empty input; cost is
 * answerSentences x pageSentences, both already capped by the caller's excerpt
 * length in practice).
 */
export function alignAnswerToPage(
  answerText: string,
  pageText: string,
  opts: { shingleSize?: number; minScore?: number; maxResults?: number } = {},
): AlignedPassage[] {
  const n = opts.shingleSize ?? SHINGLE_SIZE;
  const minScore = opts.minScore ?? MIN_CONTAINMENT_SCORE;
  const maxResults = opts.maxResults ?? 5;

  const answerSentences = splitSentences(answerText).filter((s) => s.wordCount >= MIN_SENTENCE_WORDS);
  const pageSentences = splitSentences(pageText).filter((s) => s.wordCount >= MIN_SENTENCE_WORDS);
  if (answerSentences.length === 0 || pageSentences.length === 0) return [];

  const pageShingles = pageSentences.map((s) => ({ sentence: s, shingles: shingles(s.text, n) }));

  const results: AlignedPassage[] = [];
  for (const a of answerSentences) {
    const aShingles = shingles(a.text, n);
    if (aShingles.size === 0) continue;
    let best: { sentence: SplitSentence; score: number; shared: number } | null = null;
    for (const p of pageShingles) {
      if (p.shingles.size === 0) continue;
      let shared = 0;
      for (const sh of aShingles) if (p.shingles.has(sh)) shared += 1;
      if (shared === 0) continue;
      const score = shared / aShingles.size;
      if (!best || score > best.score) best = { sentence: p.sentence, score, shared };
    }
    if (best && best.score >= minScore) {
      results.push({
        answerSentence: a.text,
        pageSentence: best.sentence.text,
        score: Math.round(best.score * 1000) / 1000,
        sharedShingleCount: best.shared,
        answerSentenceIndex: a.index,
        pageSentenceIndex: best.sentence.index,
      });
    }
  }

  return results.sort((x, y) => y.score - x.score).slice(0, maxResults);
}

/** The single best-aligned passage (or null when nothing clears the score floor). */
export function bestAlignedPassage(
  answerText: string,
  pageText: string,
  opts: { shingleSize?: number; minScore?: number } = {},
): AlignedPassage | null {
  const [top] = alignAnswerToPage(answerText, pageText, { ...opts, maxResults: 1 });
  return top ?? null;
}

// ---------------------------------------------------------------------------
// Winning shapes (EXPORT ONLY - consumed later by the drafter, not wired here)
// ---------------------------------------------------------------------------

export type LengthBand = "short" | "medium" | "long";
export type PassageStructure = "list" | "table" | "prose";
export type OpeningPattern = "entity_first" | "number_first" | "definition_first" | "other";

/** A deterministic read of the SHAPE of the passages engines actually lift - length,
 *  structure, and how the winning sentence opens. Used later (by another owner) to
 *  bias drafting toward shapes that have already proven to get quoted. */
export type WinningShapeSummary = {
  /** How many aligned passages fed this summary. */
  sampleSize: number;
  lengthBand: LengthBand;
  /** Average word count of the winning (page-side) sentences, rounded. */
  avgWordCount: number;
  structure: PassageStructure;
  openingPattern: OpeningPattern;
};

const DEFINITION_RE = /^(a|an|the)\s+\S+\s+(is|are|means|refers to)\b/i;
const NUMBER_FIRST_RE = /^[\d$]/;
/** A crude "entity-first" heuristic: the sentence opens with a capitalized run of
 *  1-4 words that is not itself a sentence-initial common word (which would already
 *  be capitalized just from being at the start of a sentence). */
const ENTITY_FIRST_RE = /^(?:[A-Z][a-zA-Z'.-]*\s+){0,3}[A-Z][a-zA-Z'.-]*\b/;
const COMMON_SENTENCE_STARTERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "there", "here",
  "in", "on", "for", "to", "if", "when", "while", "you", "your", "we", "our",
]);

function detectOpeningPattern(sentence: string): OpeningPattern {
  const trimmed = sentence.trim();
  if (!trimmed) return "other";
  if (NUMBER_FIRST_RE.test(trimmed)) return "number_first";
  if (DEFINITION_RE.test(trimmed)) return "definition_first";
  const firstWord = trimmed.split(/\s+/)[0]?.replace(/[^a-zA-Z]/g, "").toLowerCase() ?? "";
  if (!COMMON_SENTENCE_STARTERS.has(firstWord) && ENTITY_FIRST_RE.test(trimmed)) return "entity_first";
  return "other";
}

function detectStructure(sentence: string): PassageStructure {
  // A single sentence can't literally be a list/table, but its source line often
  // carries the tell-tale markers (bullet glyph, pipe-delimited, numbered item).
  if (/^\s*([-*•]|\d+[.)])\s+/.test(sentence)) return "list";
  if (sentence.includes("|") && sentence.split("|").length >= 3) return "table";
  return "prose";
}

function lengthBandOf(avgWords: number): LengthBand {
  if (avgWords <= 20) return "short";
  if (avgWords <= 45) return "medium";
  return "long";
}

/**
 * Summarize the SHAPE of a set of aligned passages: how long the winning sentences
 * run, whether they read as list/table/prose, and how they tend to open. Pure,
 * deterministic. Returns null on an empty input (nothing to summarize - honest
 * silence rather than a fabricated default shape).
 *
 * EXPORT ONLY per BEACON 500 item 71 scope - the structured drafter consumes this
 * later; this module does not call into structured-drafter.ts or llm-answer-block.ts.
 */
export function summarizeWinningShapes(alignedPassages: ReadonlyArray<AlignedPassage>): WinningShapeSummary | null {
  if (alignedPassages.length === 0) return null;
  const wordCounts = alignedPassages.map((p) => tokenize(p.pageSentence).length);
  const avgWordCount = Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length);

  const structureCounts = new Map<PassageStructure, number>();
  const openingCounts = new Map<OpeningPattern, number>();
  for (const p of alignedPassages) {
    const structure = detectStructure(p.pageSentence);
    structureCounts.set(structure, (structureCounts.get(structure) ?? 0) + 1);
    const opening = detectOpeningPattern(p.pageSentence);
    openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1);
  }
  const topOf = <T,>(counts: Map<T, number>, fallback: T): T => {
    let bestKey = fallback;
    let bestCount = -1;
    for (const [k, c] of counts) {
      if (c > bestCount) {
        bestKey = k;
        bestCount = c;
      }
    }
    return bestKey;
  };

  return {
    sampleSize: alignedPassages.length,
    lengthBand: lengthBandOf(avgWordCount),
    avgWordCount,
    structure: topOf(structureCounts, "prose"),
    openingPattern: topOf(openingCounts, "other"),
  };
}

// ---------------------------------------------------------------------------
// Content-hash cache key (for callers that persist via move-draft-store)
// ---------------------------------------------------------------------------

/**
 * A short, stable digest of the alignment inputs, for callers that want to cache-by-
 * content-hash and skip recompute when neither the answer text nor the page text has
 * changed. NOT a cryptographic hash - deterministic and collision-resistant enough
 * for a cache key, nothing security-sensitive rides on it. Callers own persistence;
 * this module stays pure (no I/O).
 */
export function alignmentContentHash(answerText: string, pageText: string): string {
  const input = `${(answerText ?? "").trim()} ${(pageText ?? "").trim()}`;
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  // Second pass with a different seed/stride widens the effective hash space
  // beyond a single 32-bit FNV-1a pass (still not cryptographic, just cheaper
  // collisions for a cache key over short excerpt-sized strings).
  let h2 = 0x9e3779b9;
  for (let i = input.length - 1; i >= 0; i--) {
    h2 ^= input.charCodeAt(i);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${toHex(h1)}${toHex(h2)}`;
}
