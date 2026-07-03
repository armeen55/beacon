/**
 * teardown-commonality (2026-07-02, master plan item D2; "our difference is we
 * scrape the top 5 results for each prompt to see what they have in common").
 *
 * PURE / no I/O / no LLM. Given 2-5 competitor teardown facts for the SAME
 * prompt/topic (from `auditCompetitorPage` in competitor-page-audit.ts; either
 * Profound-cited or native-poll-cited targets), extracts what the winners
 * actually SHARE: a consensus outline, a shared answer shape, a median word-count
 * band, common schema types, and the opening move most of them make. This is
 * "the best ideologies" the operator asked for; never a copy of any one
 * competitor's page, only the STRUCTURE + facts multiple independent winners
 * agree on.
 *
 * Contract (never violate): this module NEVER emits prose a drafter could paste
 * verbatim. `CommonalityBrief` describes shape + facts to cover (heading TOPICS,
 * not competitor sentences; a word-count BAND, not a competitor's paragraph).
 * The actual drafter (a later step) writes 100% original content from this
 * brief; copying competitor text is explicitly out of scope everywhere in this
 * file.
 */

import type { CompetitorPageFacts } from "./competitor-page-audit";

/**
 * The minimal structural shape needed to compare an OWNED page against the
 * competitor consensus. `CompetitorPageFacts` satisfies this directly;
 * `PageStructureFacts` (the owned-snapshot shape from evidence-packet.ts)
 * satisfies it too once `hasToolOrCalculator` defaults to false; callers
 * comparing an owned snapshot pass `{ ...snapshotFacts, hasToolOrCalculator:
 * false }` rather than this module depending on that other type.
 */
export type OwnedPageFactsForCommonality = {
  outline: string[];
  schemaTypes: string[];
  hasFaq: boolean;
  hasAnswerBlock: boolean;
  wordCount: number;
  hasToolOrCalculator: boolean;
};

export type AnswerShape = "definition_first" | "table" | "faq" | "steps" | "narrative";

export type OpeningPattern =
  | "direct_definition"
  | "direct_answer_stat"
  | "question_restated"
  | "narrative_lead";

export type SharedHeading = {
  /** Normalized heading topic (lowercased, generic-token-stripped for comparison
   *  but shown in original casing from the FIRST winner that used it). */
  label: string;
  /** How many of the analyzed winners have a heading covering this topic. */
  winners: number;
};

export type CommonalityBrief = {
  /** How many competitor pages fed this brief (2-5 by contract). */
  sourceCount: number;
  /** Heading topics that appear across a MAJORITY (>50%) of winners, ranked by
   *  how many winners share them. Structure to cover, never competitor prose. */
  sharedHeadings: SharedHeading[];
  /** The dominant answer-presentation pattern among the winners. */
  answerShape: AnswerShape;
  /** How many winners exhibit each shape (for the "why" line). */
  answerShapeVotes: Record<AnswerShape, number>;
  /** Median word count across winners, banded to a round range so it reads as
   *  guidance ("1200-1600 words"), never a copy-exact target. */
  wordBand: { low: number; high: number; median: number };
  /** Schema types present on a MAJORITY of winners. */
  schemaTypes: string[];
  /** The opening move most winners make (how the page starts). */
  openingPattern: OpeningPattern;
  /** True when a majority of winners ship an FAQ block. */
  hasFaqConsensus: boolean;
  /** True when a majority of winners ship an interactive tool/calculator. */
  hasToolConsensus: boolean;
  /**
   * When we OWN a matching page: the shared elements our page is missing,
   * vs the winners' consensus (only populated when `ownedFacts` is passed).
   * Empty array when we own nothing comparable, or already match everything.
   */
  whatTheyAllHaveThatWeDont: string[];
};

const MIN_SOURCES = 2;
const MAX_SOURCES = 5;
const MAX_HEADINGS = 10;

const GENERIC_HEADING_STOP = new Set([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are", "was",
  "with", "best", "top", "how", "what", "why", "list", "guide", "your", "you", "this",
  "that", "from", "by", "at", "as", "it", "be", "we", "our", "their", "they", "have",
  "has", "can", "will", "more", "all", "about", "into", "out", "up", "if", "but",
  "final", "conclusion", "faq", "faqs",
]);

/** Normalize a heading to comparable tokens (order-independent, stopword-free). */
function headingKey(h: string): string {
  const toks = h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !GENERIC_HEADING_STOP.has(t))
    .sort();
  return toks.join(" ");
}

/**
 * Cluster headings across winners by normalized-token overlap so "How much
 * does X cost?" and "X pricing" collapse to one shared topic when they share a
 * distinguishing token. Conservative; requires at least one non-generic token
 * shared. Pure.
 */
export function extractSharedHeadings(pages: readonly CompetitorPageFacts[]): SharedHeading[] {
  const majority = Math.ceil(pages.length / 2);
  // key -> { label (first-seen casing), winners: Set<pageIndex> }
  const clusters: { key: string; label: string; winners: Set<number> }[] = [];

  pages.forEach((p, idx) => {
    const seenThisPage = new Set<string>();
    for (const raw of p.outline ?? []) {
      const key = headingKey(raw);
      if (!key || seenThisPage.has(key)) continue;
      seenThisPage.add(key);
      const keyToks = new Set(key.split(" "));
      // Find an existing cluster that shares at least one token (loose match:
      // "cost of a wedding" vs "wedding costs" both reduce to overlapping tokens).
      let cluster = clusters.find((c) => {
        if (c.winners.has(idx)) return false; // one heading per page per cluster
        const cToks = c.key.split(" ");
        return cToks.some((t) => keyToks.has(t));
      });
      if (!cluster) {
        cluster = { key, label: raw.trim(), winners: new Set() };
        clusters.push(cluster);
      }
      cluster.winners.add(idx);
    }
  });

  return clusters
    .filter((c) => c.winners.size >= majority && c.winners.size >= 2)
    .map((c) => ({ label: c.label, winners: c.winners.size }))
    .sort((a, b) => b.winners - a.winners || a.label.localeCompare(b.label))
    .slice(0, MAX_HEADINGS);
}

/** Vote on the dominant answer shape per page, then across pages. Pure. */
function classifyPageAnswerShape(p: CompetitorPageFacts): AnswerShape {
  // A table-heavy page: many short headings + no dominant FAQ signal is a weak
  // proxy without raw HTML here, so we key off the strongest DETECTABLE facts
  // in order of specificity: FAQ > answer-block(definition) > steps-shaped
  // outline > narrative fallback.
  if (p.hasFaq && p.faqQuestionCount >= 3) return "faq";
  const stepsLike = (p.outline ?? []).filter((h) => /^(step|how to|\d+[.)]\s)/i.test(h.trim())).length;
  if (stepsLike >= 2) return "steps";
  if (p.hasAnswerBlock) return "definition_first";
  return "narrative";
}

function voteAnswerShape(pages: readonly CompetitorPageFacts[]): { shape: AnswerShape; votes: Record<AnswerShape, number> } {
  const votes: Record<AnswerShape, number> = { definition_first: 0, table: 0, faq: 0, steps: 0, narrative: 0 };
  for (const p of pages) votes[classifyPageAnswerShape(p)] += 1;
  const shape = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] as AnswerShape) ?? "narrative";
  return { shape, votes };
}

function classifyOpeningPattern(p: CompetitorPageFacts): OpeningPattern {
  if (p.hasAnswerBlock && p.h1 && /\b(what|who|when|where|why|how)\b/i.test(p.h1)) return "question_restated";
  if (p.hasAnswerBlock) return "direct_definition";
  if (p.wordCount > 0 && p.hasFaq) return "direct_answer_stat";
  return "narrative_lead";
}

function voteOpeningPattern(pages: readonly CompetitorPageFacts[]): OpeningPattern {
  const votes = new Map<OpeningPattern, number>();
  for (const p of pages) {
    const pat = classifyOpeningPattern(p);
    votes.set(pat, (votes.get(pat) ?? 0) + 1);
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "narrative_lead";
}

/** Median of a numeric array. Pure. */
function median(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

/** Round a word-count band to a readable range (nearest 100) so it reads as
 *  guidance, never a single competitor's exact count. */
function wordBandOf(counts: readonly number[]): { low: number; high: number; median: number } {
  const positive = counts.filter((n) => n > 0);
  if (positive.length === 0) return { low: 0, high: 0, median: 0 };
  const med = median(positive);
  const lo = Math.min(...positive);
  const hi = Math.max(...positive);
  const round100 = (n: number) => Math.round(n / 100) * 100;
  return { low: round100(Math.min(lo, med * 0.8)), high: round100(Math.max(hi, med * 1.2)), median: round100(med) };
}

function schemaConsensus(pages: readonly CompetitorPageFacts[]): string[] {
  const majority = Math.ceil(pages.length / 2);
  const counts = new Map<string, number>();
  for (const p of pages) for (const t of p.schemaTypes ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= majority)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
}

/**
 * Build the CommonalityBrief from 2-5 competitor teardown facts for the same
 * prompt/topic. Fewer than 2 usable facts returns null (not enough winners to
 * find a consensus; never fabricate agreement from a single page). More than
 * 5 are truncated to the first 5 (caller's job to pass the top 5).
 *
 * When `ownedFacts` is supplied, also computes `whatTheyAllHaveThatWeDont`:
 * the shared elements a MAJORITY of winners have that our own page lacks.
 */
export function buildCommonalityBrief(
  facts: readonly (CompetitorPageFacts | null | undefined)[],
  opts: { ownedFacts?: OwnedPageFactsForCommonality | null } = {},
): CommonalityBrief | null {
  const usable = facts.filter((f): f is CompetitorPageFacts => !!f).slice(0, MAX_SOURCES);
  if (usable.length < MIN_SOURCES) return null;

  const sharedHeadings = extractSharedHeadings(usable);
  const { shape: answerShape, votes: answerShapeVotes } = voteAnswerShape(usable);
  const wordBand = wordBandOf(usable.map((p) => p.wordCount));
  const schemaTypes = schemaConsensus(usable);
  const openingPattern = voteOpeningPattern(usable);
  const majority = Math.ceil(usable.length / 2);
  const hasFaqConsensus = usable.filter((p) => p.hasFaq).length >= majority;
  const hasToolConsensus = usable.filter((p) => p.hasToolOrCalculator).length >= majority;

  const whatTheyAllHaveThatWeDont: string[] = [];
  const owned = opts.ownedFacts ?? null;
  if (owned) {
    for (const h of sharedHeadings) {
      const ownedToks = new Set(headingKey(h.label).split(" "));
      const covered = (owned.outline ?? []).some((oh) => {
        const oToks = new Set(headingKey(oh).split(" "));
        return [...ownedToks].some((t) => oToks.has(t));
      });
      if (!covered) whatTheyAllHaveThatWeDont.push(`a section covering "${h.label}"`);
    }
    if (hasFaqConsensus && !owned.hasFaq) whatTheyAllHaveThatWeDont.push("an FAQ section");
    if (hasToolConsensus && !owned.hasToolOrCalculator) whatTheyAllHaveThatWeDont.push("an interactive tool/calculator");
    for (const t of schemaTypes) if (!(owned.schemaTypes ?? []).includes(t)) whatTheyAllHaveThatWeDont.push(`${t} structured data`);
    if (wordBand.median > 0 && owned.wordCount > 0 && owned.wordCount < wordBand.low) {
      whatTheyAllHaveThatWeDont.push(`more depth (you're at ${owned.wordCount} words, winners run ${wordBand.low}-${wordBand.high})`);
    }
    if (answerShape === "definition_first" && !owned.hasAnswerBlock) {
      whatTheyAllHaveThatWeDont.push("a direct answer near the top of the page");
    }
  }

  return {
    sourceCount: usable.length,
    sharedHeadings,
    answerShape,
    answerShapeVotes,
    wordBand,
    schemaTypes,
    openingPattern,
    hasFaqConsensus,
    hasToolConsensus,
    whatTheyAllHaveThatWeDont,
  };
}

const ANSWER_SHAPE_PLAIN: Record<AnswerShape, string> = {
  definition_first: "leads with a direct definition/answer",
  table: "leads with a comparison table",
  faq: "leads with common-questions (FAQ)",
  steps: "walks through numbered steps",
  narrative: "reads as a narrative/story",
};

const OPENING_PLAIN: Record<OpeningPattern, string> = {
  direct_definition: "opens by defining the topic in the first lines",
  direct_answer_stat: "opens with a direct answer or number",
  question_restated: "opens by restating the question, then answering it",
  narrative_lead: "opens with a narrative lead-in before the answer",
};

/**
 * One plain-language sentence for a Move/new-page card; the operator-journey
 * render point. Deterministic, no LLM, never quotes competitor prose (only
 * shape + counts). Mirrors the style of aeoEvidenceSentence /
 * teardownView so every surface stays consistent.
 */
export function commonalitySentence(brief: CommonalityBrief): string {
  const n = brief.sourceCount;
  const headingPart =
    brief.sharedHeadings.length > 0
      ? `, and ${brief.sharedHeadings.length} of the same section${brief.sharedHeadings.length === 1 ? "" : "s"} (like "${brief.sharedHeadings[0]!.label}")`
      : "";
  const faqPart = brief.hasFaqConsensus ? " and an FAQ block" : "";
  const opening = OPENING_PLAIN[brief.openingPattern];
  const openingSentence = opening.charAt(0).toUpperCase() + opening.slice(1);
  return `${n} of the top pages for this topic agree: most ${ANSWER_SHAPE_PLAIN[brief.answerShape]}${headingPart}${faqPart}, running ${brief.wordBand.low}-${brief.wordBand.high} words. ${openingSentence}.`;
}
