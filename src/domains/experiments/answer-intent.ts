/**
 * answer-intent (2026-06-30) — the REASONING BRAIN for answer selection. The old lever picked the
 * first *definitional* sentence and ignored what the page is actually asked; that surfaced a
 * definition on chaharshanbe-suri when its #1 query by impressions is "chaharshanbe suri 2026" (a
 * DATE question). This module fixes that class of failure deterministically ($0), and produces a
 * STRUCTURED reasoning brief (never loose prose) that a tiered LLM adjudicator can later enrich:
 *
 *   classifyQueryIntent(queries) → the dominant thing people ASK this page (weighted by impressions)
 *   scoreAnswerForIntent(sentence, intent) → how well a candidate sentence ANSWERS that intent
 *   selectIntentAwareAnswer(candidates, queries, entity) → the RIGHT answer + a cited brief, OR an
 *     honest gap ("nobody's date question is answered on-page → write it, don't move a definition")
 *
 * PURE, deterministic, no LLM, no I/O. The LLM layer (slice 2) consumes AnswerReasoningBrief.
 */

/** What a searcher is actually asking. Ordered roughly by how distinct the answer format is. */
export type QueryIntent =
  | "when" // date / "when is" / a bare year → wants a DATE
  | "cost" // price / how much / $ → wants a NUMBER+currency
  | "how" // how to / steps / guide → wants a PROCESS
  | "where" // location / near / map → wants a PLACE
  | "who" // who is / people → wants a PERSON/ORG
  | "list" // best / top / examples → wants a LIST
  | "compare" // vs / versus / difference → wants a CONTRAST
  | "what"; // what is / meaning / bare entity → wants a DEFINITION

export type IntentSignal = { query: string; impressions: number; intent: QueryIntent };

export type IntentClassification = {
  dominant: QueryIntent;
  /** impression share of the dominant intent among all classified queries (0..1). */
  dominantShare: number;
  /** per-intent impression totals, descending. */
  distribution: Array<{ intent: QueryIntent; impressions: number; queries: number }>;
  signals: IntentSignal[];
};

// ── Query-intent detection ──────────────────────────────────────────────────
const WHEN_RE = /\b(when|what time|which day|date|dates|schedule|calendar)\b|\b(19|20)\d{2}\b/i;
const COST_RE = /\b(cost|costs|price|prices|pricing|how much|fee|fees|rate|rates|\$|usd|cheap|expensive|budget)\b/i;
const HOW_RE = /\b(how to|how do|how can|steps|guide|tutorial|instructions|make|build|cook|write|learn|use|install|setup|set up|create)\b/i;
const WHERE_RE = /\b(where|location|located|near me|nearby|address|map|directions|in [a-z]+)\b/i;
const WHO_RE = /\b(who|whose|founder|author|actor|actress|singer|celebrity|celebrities|people|person)\b/i;
const LIST_RE = /\b(best|top|list|examples|ideas|types|kinds|popular|famous|greatest|\d+\s+\w+)\b/i;
const COMPARE_RE = /\b(vs\.?|versus|compared to|compare|difference between|or\b.*\bor\b|better than)\b/i;
const WHAT_RE = /\b(what is|what are|what's|meaning|definition|define|means|explained|explain)\b/i;

/** Classify ONE query's intent. Order matters: the most answer-distinct intents win ties. */
export function classifyOneQuery(query: string): QueryIntent {
  const q = ` ${query.toLowerCase().trim()} `;
  if (WHEN_RE.test(q)) return "when";
  if (COST_RE.test(q)) return "cost";
  if (COMPARE_RE.test(q)) return "compare";
  if (HOW_RE.test(q)) return "how";
  if (WHERE_RE.test(q)) return "where";
  if (WHO_RE.test(q)) return "who";
  if (WHAT_RE.test(q)) return "what";
  if (LIST_RE.test(q)) return "list";
  return "what"; // a bare entity ("chaharshanbe suri") defaults to definitional demand
}

/** Weight each intent by impressions so the DOMINANT demand (what most people actually search) wins. */
export function classifyQueryIntent(queries: Array<{ query: string; impressions: number }>): IntentClassification | null {
  const signals: IntentSignal[] = queries
    .filter((q) => q.query && q.query.trim())
    .map((q) => ({ query: q.query.trim(), impressions: Math.max(0, q.impressions || 0), intent: classifyOneQuery(q.query) }));
  if (signals.length === 0) return null;

  const byIntent = new Map<QueryIntent, { impressions: number; queries: number }>();
  let total = 0;
  for (const s of signals) {
    const cur = byIntent.get(s.intent) ?? { impressions: 0, queries: 0 };
    cur.impressions += s.impressions;
    cur.queries += 1;
    byIntent.set(s.intent, cur);
    total += s.impressions;
  }
  const distribution = [...byIntent.entries()]
    .map(([intent, v]) => ({ intent, ...v }))
    .sort((a, b) => b.impressions - a.impressions || b.queries - a.queries);
  const dominant = distribution[0]!;
  return {
    dominant: dominant.intent,
    dominantShare: total > 0 ? dominant.impressions / total : dominant.queries / signals.length,
    distribution,
    signals,
  };
}

// ── Answer-fit scoring ──────────────────────────────────────────────────────
const HAS_DATE = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b|\b\d{1,2}(st|nd|rd|th)?\b.*\b(19|20)\d{2}\b|\b(19|20)\d{2}\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const HAS_MONEY = /\$\s?\d|\b\d[\d,]*\s*(dollars|usd|per|\/)\b|\b(costs?|priced?)\b.*\b\d/i;
const HAS_PLACE = /\b(is|are|located|situated)\b.*\b(in|near|on|at)\b\s+[A-Z]/;
const HAS_STEPS = /\b(first|second|then|next|start|begin|step|to \w+ (?:it|them|this)|by \w+ing)\b/i;
const DEFINITIONAL_ANS = /\b(?:is|are|was|were|refers to|means|denotes|describes)\s+(?:a|an|the|one of|the name|written|spoken|used|celebrated|observed|practiced|known as)\b/i;

/**
 * How well `sentence` ANSWERS `intent`, 0..1. The point: a WHEN question is answered by a sentence
 * that carries a date, NOT by a definition (that was the chaharshanbe failure). Deterministic.
 */
export function scoreAnswerForIntent(sentence: string, intent: QueryIntent): number {
  const s = sentence.trim();
  switch (intent) {
    case "when": return HAS_DATE.test(s) ? 1 : 0.05;
    case "cost": return HAS_MONEY.test(s) ? 1 : 0.05;
    case "where": return HAS_PLACE.test(s) ? 0.9 : 0.1;
    case "how": return HAS_STEPS.test(s) ? 0.8 : 0.15;
    case "who": return /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(s) ? 0.7 : 0.2;
    case "list": return /,.*,|\b(include|includes|such as|for example)\b/i.test(s) ? 0.7 : 0.2;
    case "compare": return /\b(while|whereas|unlike|differs|both|however)\b/i.test(s) ? 0.7 : 0.2;
    case "what": return DEFINITIONAL_ANS.test(s) ? 1 : 0.3; // definition genuinely answers "what is"
  }
}

export type AnswerCandidate = { sentence: string; documentIndex: number };

// Commerce / CTA / shipping boilerplate is NEVER a real answer — but it often carries a stray year or
// number that fools a regex (a live proof: chaharshanbe's crawl surfaced "Celebrate ... 2025 ... unisex
// Persian shirt" for a "when" query). Reject it so the deterministic layer degrades to an honest GAP
// rather than surfacing merch. (The LLM adjudicator is the real fix; this keeps the $0 path safe.)
const COMMERCE_JUNK = /\b(shirt|t-?shirt|hoodie|sweatshirt|mug|sticker|poster|print|buy|shop|cart|checkout|add to|order (?:now|today)|shipping|delivery|refund|returns?|guarantee|money-?back|discount|% off|sale|unisex|sizes?|fabric|cotton|polyester|comfort and durability|perfect for|in style|showcase your|great way to|designed for|premium quality)\b/i;
/** A sentence is a plausible ANSWER only if it's informational prose about the topic, not merch/CTA/chrome. */
export function isPlausibleAnswerSentence(s: string): boolean {
  const t = s.trim();
  if (t.split(/\s+/).length < 6) return false;
  if (COMMERCE_JUNK.test(t)) return false;
  if (/^[🛡🎉✅🔥→•\-*]/.test(t)) return false; // chrome / bullet / emoji-led
  return true;
}

export type AnswerReasoningBrief = {
  /** the sentence to surface, or null when the page has NO on-page answer for the real demand. */
  chosen: string | null;
  intent: QueryIntent;
  dominantShare: number;
  /** why this intent — the top queries + impressions that decided it. */
  intentEvidence: Array<{ query: string; impressions: number }>;
  /** why THIS sentence beats the alternatives (deterministic, LLM-enrichable). */
  rationale: string;
  /** other viable answers considered, best-first (so the operator/LLM can see the tradeoff). */
  alternatives: Array<{ sentence: string; intentFit: number; reason: string }>;
  confidence: "high" | "medium" | "low";
  /** set when chosen === null: the page is missing the answer people actually want. */
  gap: string | null;
};

const MIN_FIT = 0.5; // a candidate must genuinely answer the dominant intent to be "chosen"

/**
 * Pick the answer that matches what people ACTUALLY search, with a cited brief. If the best-fit
 * candidate clears MIN_FIT → surface it. If nothing on the page answers the dominant intent → return
 * an honest GAP (do NOT fall back to a definition for a date question — that's the old bug).
 */
export function selectIntentAwareAnswer(
  candidates: AnswerCandidate[],
  queries: Array<{ query: string; impressions: number }>,
  entityLabel: string,
): AnswerReasoningBrief | null {
  const cls = classifyQueryIntent(queries);
  if (!cls) return null;
  const { dominant, dominantShare } = cls;

  // Only informational prose is answer-eligible — commerce/CTA/chrome is filtered out so a stray year
  // in a product ad can never be surfaced as the answer (see COMMERCE_JUNK).
  const eligible = candidates.filter((c) => isPlausibleAnswerSentence(c.sentence));
  if (eligible.length === 0) return null;
  const scored = eligible
    .map((c) => ({ ...c, fit: scoreAnswerForIntent(c.sentence, dominant) }))
    .sort((a, b) => b.fit - a.fit || a.documentIndex - b.documentIndex);

  const intentEvidence = cls.signals
    .filter((s) => s.intent === dominant)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 4)
    .map((s) => ({ query: s.query, impressions: s.impressions }));

  const best = scored[0]!;
  const alternatives = scored.slice(1, 4).map((a) => ({
    sentence: a.sentence,
    intentFit: Number(a.fit.toFixed(2)),
    reason: a.fit >= MIN_FIT ? `also answers "${dominant}"` : `does not answer "${dominant}" (fit ${a.fit.toFixed(2)})`,
  }));

  const topQ = intentEvidence[0];
  const intentLabel = INTENT_LABEL[dominant];

  if (best.fit < MIN_FIT) {
    // No on-page sentence answers the real demand. The honest move is NOT to surface a definition.
    return {
      chosen: null, intent: dominant, dominantShare, intentEvidence, alternatives, confidence: "low",
      rationale: `The page's dominant demand is ${intentLabel}${topQ ? ` ("${topQ.query}", ${topQ.impressions} impressions)` : ""}, but no sentence on the page answers it. Surfacing a definition would answer the wrong question.`,
      gap: `Write the answer people actually want here (${intentLabel}) for "${entityLabel}" and surface it — do not move an existing definition.`,
    };
  }

  const confidence: AnswerReasoningBrief["confidence"] =
    best.fit >= 0.9 && dominantShare >= 0.4 ? "high" : best.fit >= 0.7 ? "medium" : "low";

  return {
    chosen: best.sentence, intent: dominant, dominantShare, intentEvidence, alternatives, confidence, gap: null,
    rationale:
      `The page's #1 demand is ${intentLabel}${topQ ? ` — "${topQ.query}" alone is ${topQ.impressions} impressions` : ""} (${Math.round(dominantShare * 100)}% of query volume). ` +
      `This sentence directly answers ${intentLabel} (fit ${best.fit.toFixed(2)}), so leading with it targets what people actually search — not just what "${entityLabel}" is.`,
  };
}

const INTENT_LABEL: Record<QueryIntent, string> = {
  when: "a date / when it happens",
  cost: "price / how much",
  how: "how to do it",
  where: "a location",
  who: "who / which people",
  list: "a list of examples",
  compare: "a comparison",
  what: "a definition (what it is)",
};
