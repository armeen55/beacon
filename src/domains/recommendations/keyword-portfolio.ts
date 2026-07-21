/**
 * Expert-rec-engine PHASE D (2026-06-16) — KEYWORD / FANOUT MERGE.
 *
 * Beacon should not optimize for the single top GSC query. This merges every
 * keyword signal for a page — GSC queries, DataForSEO keywords, and fanout
 * questions — into ONE deduped, intent-classified, ranked portfolio, and
 * buckets each term by whether it FITS this page's intent:
 *   • primaryTarget        — best on-intent, on-topic, high-value term
 *   • secondaryTargets     — the other on-intent, on-topic terms
 *   • questionTargets       — informational / question-shaped terms (FAQ fodder)
 *   • doNotTargetHere       — terms whose intent CONFLICTS with the page (a
 *                             high-volume wrong-intent query Beacon must NOT
 *                             chase here), each with a plain reason
 *   • newPageCandidates     — topically ADJACENT terms that deserve their OWN
 *                             page rather than diluting this one
 *   • entityAliases / transliterationVariants — structured but left for the
 *     LLM SEO-editor pass to populate (not deterministically derivable; the
 *     shape is present so the contract is stable).
 *
 * The directive's rule, enforced: prefer low-difficulty / high-volume keywords
 * ONLY when they match page intent; never stuff unrelated keywords; surface
 * rejected keywords + why. NO hardcoded keyword lists — intent comes from the
 * universal `classifyQueryIntent` markers + tenant brand/locale (config).
 *
 * PURE / deterministic. The LLM editor pass later sharpens this; the deterministic
 * portfolio ships value (and the safe bucketing) first.
 *
 * Pinned by tests/domains/recommendations/keyword-portfolio.test.ts.
 */

import { classifyQueryIntent, type IntentClass } from "./page-topic-fit";
import { normalizeText } from "./match-engine/normalize-text";
import { tokenize } from "./match-engine/similarity";

export type KeywordSource = "gsc" | "dataforseo" | "fanout";

export type PortfolioInputKeyword = {
  term: string;
  source: KeywordSource;
  /** Monthly searches (DataForSEO) or 90d impressions (GSC). Higher = more demand. */
  volume?: number | null;
  /** DataForSEO keyword difficulty 0–100, when known. */
  difficulty?: number | null;
  /** Current rank, when known. */
  position?: number | null;
};

export type RejectedKeyword = { term: string; reason: string };

export type KeywordPortfolio = {
  primaryTarget: string | null;
  secondaryTargets: string[];
  questionTargets: string[];
  entityAliases: string[];
  transliterationVariants: string[];
  doNotTargetHere: RejectedKeyword[];
  newPageCandidates: string[];
  reasoning: string;
};

const STOPWORDS = new Set<string>([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are",
  "with", "your", "you", "my", "it", "this", "that", "at", "by", "from", "as",
  "near", "me", "best", "how", "what", "why", "vs", "top",
]);

const QUESTION_MARKERS = new Set<string>([
  "how", "what", "why", "when", "where", "who", "which", "can", "does", "is",
  "are", "should",
]);

function contentTokens(s: string): string[] {
  return tokenize(normalizeText(s, { lowercase: true })).filter(
    (t) => !STOPWORDS.has(t) && t.length > 1,
  );
}

function isQuestionShaped(term: string): boolean {
  if (term.trim().endsWith("?")) return true;
  const first = tokenize(normalizeText(term, { lowercase: true }))[0];
  return first != null && QUESTION_MARKERS.has(first);
}

/** Intent families that are compatible enough to optimize on the same page. */
function intentCompatible(a: IntentClass, b: IntentClass): boolean {
  if (a === b) return true;
  if (a === "mixed" || b === "mixed") return true;
  const buy = new Set<IntentClass>(["commercial", "transactional"]);
  return buy.has(a) && buy.has(b);
}

/** Topical overlap of a keyword with the page's own topical tokens, 0..1. */
function topicalOverlap(keywordTokens: string[], pageTokenSet: ReadonlySet<string>): number {
  if (keywordTokens.length === 0) return 0;
  const hit = keywordTokens.filter((t) => pageTokenSet.has(t)).length;
  return hit / keywordTokens.length;
}

function valueOf(k: PortfolioInputKeyword): number {
  // Demand minus a light difficulty penalty; unknowns are neutral.
  const vol = typeof k.volume === "number" && k.volume > 0 ? k.volume : 1;
  const kd = typeof k.difficulty === "number" ? Math.max(0, Math.min(100, k.difficulty)) : 40;
  return vol * (1 - kd / 200); // KD 0 → ×1.0, KD 100 → ×0.5
}

export function buildKeywordPortfolio(input: {
  keywords: ReadonlyArray<PortfolioInputKeyword>;
  /** The page's own intent (from the page-topic-fit result). */
  pageIntentClass: IntentClass;
  /** Normalized topical tokens of the page (title/H1/meta/url/body). */
  pageTopicTokens: ReadonlyArray<string>;
  brandTerms?: ReadonlyArray<string>;
  localeTerms?: ReadonlyArray<string>;
}): KeywordPortfolio {
  const pageTokenSet = new Set(input.pageTopicTokens.map((t) => t.toLowerCase()));

  // ── merge + dedupe by normalized term (combine sources; keep best data) ──
  const byTerm = new Map<string, PortfolioInputKeyword & { display: string }>();
  for (const k of input.keywords) {
    const display = k.term.trim();
    if (display.length < 2) continue;
    const key = normalizeText(display, { lowercase: true });
    const existing = byTerm.get(key);
    if (!existing) {
      byTerm.set(key, { ...k, term: key, display });
    } else {
      // Merge: prefer the entry with the higher known volume / data.
      // audit-4: drop the trailing `|| existing.volume || k.volume` — Math.max
      // already picks the higher value, and the `||` treated a deliberate 0
      // ("zero demand") as falsy and fell through, blurring known-zero with
      // unknown. Coalesce missing to 0 explicitly and take the max.
      byTerm.set(key, {
        ...existing,
        volume: Math.max(existing.volume ?? 0, k.volume ?? 0),
        difficulty: existing.difficulty ?? k.difficulty,
        position: existing.position ?? k.position,
      });
    }
  }

  type Scored = {
    display: string;
    intent: IntentClass;
    overlap: number;
    value: number;
    question: boolean;
  };
  const scored: Scored[] = [];
  for (const k of byTerm.values()) {
    scored.push({
      display: k.display,
      intent: classifyQueryIntent(k.display, {
        brandTerms: input.brandTerms,
        localeTerms: input.localeTerms,
      }),
      overlap: topicalOverlap(contentTokens(k.display), pageTokenSet),
      value: valueOf(k),
      question: isQuestionShaped(k.display),
    });
  }

  const doNotTargetHere: RejectedKeyword[] = [];
  const newPageCandidates: Scored[] = [];
  const questionTargets: Scored[] = [];
  const onTarget: Scored[] = [];

  for (const s of scored) {
    const fits = intentCompatible(s.intent, input.pageIntentClass);
    // Off-topic entirely → wrong page (or a new page if it has real demand).
    if (s.overlap < 0.2) {
      if (s.value > 1 && s.overlap > 0) {
        newPageCandidates.push(s);
      } else {
        doNotTargetHere.push({
          term: s.display,
          reason: "Off-topic for this page — barely overlaps its subject.",
        });
      }
      continue;
    }
    // On-topic but the intent conflicts → don't chase it here.
    if (!fits) {
      doNotTargetHere.push({
        term: s.display,
        reason: `Intent mismatch — reads ${s.intent} but this page is ${input.pageIntentClass}.`,
      });
      continue;
    }
    // Topically adjacent (partial overlap) + real demand → its own page.
    if (s.overlap < 0.5 && s.value > 1) {
      newPageCandidates.push(s);
      continue;
    }
    // audit-wave4 #16: question-shaped terms are FAQ/answer-block fodder, not
    // title-target priority/support terms — route them to questionTargets only
    // (don't ALSO list them in onTarget, which feeds primary/secondary targets).
    if (s.question) {
      questionTargets.push(s);
      continue;
    }
    onTarget.push(s);
  }

  onTarget.sort((a, b) => b.value - a.value || b.overlap - a.overlap);
  newPageCandidates.sort((a, b) => b.value - a.value || b.overlap - a.overlap);
  questionTargets.sort((a, b) => b.value - a.value || b.overlap - a.overlap);
  const primaryTarget = onTarget[0]?.display ?? null;
  const secondaryTargets = onTarget.slice(1).map((s) => s.display);
  const rankedNewPageCandidates = newPageCandidates.map((s) => s.display);
  const rankedQuestionTargets = questionTargets.map((s) => s.display);

  const reasoning = (() => {
    if (primaryTarget == null && rankedNewPageCandidates.length > 0) {
      return `No keyword fits this page well; the strongest demand (${rankedNewPageCandidates[0]}) likely deserves its own page.`;
    }
    if (primaryTarget == null) {
      return "No on-topic, on-intent keyword with enough demand to target here yet.";
    }
    const parts = [`Lead with “${primaryTarget}” (best on-intent demand for this page).`];
    if (secondaryTargets.length > 0) {
      parts.push(`Support it with ${secondaryTargets.length} related term(s).`);
    }
    if (doNotTargetHere.length > 0) {
      parts.push(`${doNotTargetHere.length} keyword(s) excluded as off-topic or wrong-intent.`);
    }
    if (rankedNewPageCandidates.length > 0) {
      parts.push(`${rankedNewPageCandidates.length} adjacent topic(s) would be better as their own page.`);
    }
    return parts.join(" ");
  })();

  return {
    primaryTarget,
    secondaryTargets,
    questionTargets: rankedQuestionTargets,
    entityAliases: [],
    transliterationVariants: [],
    doNotTargetHere,
    newPageCandidates: rankedNewPageCandidates,
    reasoning,
  };
}
