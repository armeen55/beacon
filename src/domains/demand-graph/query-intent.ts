/**
 * query-intent (2026-06-24) — PURE deterministic search-intent classifier. SEO
 * fundamental: the right MOVE depends on what the searcher wants. A commercial
 * query ("best X", "X cost") is won with a comparison/buying guide; an
 * informational one ("what is X") with a concise answer + depth; a navigational
 * one ("X login/hours") needs the brand's own page. Reuses the L8 commercial-
 * intent signal for the money axis. No LLM, no vertical hardcoding (generic cues).
 *
 * This is a HINT surfaced on the Move card — it does NOT change the score or gap
 * classification (those stay structure-driven). It just helps the operator pick
 * the right shape of asset.
 */

import { commercialIntent } from "./money-model";

export type QueryIntent = "informational" | "commercial" | "transactional" | "navigational";

export type QueryIntentResult = {
  intent: QueryIntent;
  /** 0–1 commercial-intent score (from the money model). */
  commercial: number;
  signals: string[];
  /** Plain-language hint on the asset shape that wins this intent. */
  hint: string;
};

const TRANSACTIONAL = /\b(buy|order|checkout|for sale|price|prices|pricing|quote|book now|subscribe|purchase|coupon|discount code)\b/i;
const COMMERCIAL_INVESTIGATION = /\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|cheapest|which)\b/i;
const NAVIGATIONAL = /\b(login|log in|sign in|contact|hours|near me|location|address|phone|app|download|account|customer service)\b/i;
const INFORMATIONAL = /\b(what|how|why|when|who|where|guide|meaning|definition|examples?|history|ideas|list|tutorial|explained|tips)\b/i;

const HINT: Record<QueryIntent, string> = {
  transactional: "Buyer ready to act — lead with a clear offer/CTA + price/quote path, not just prose.",
  commercial: "Comparison shopper — a comparison/buying guide (options, pros/cons, a pick) wins over a plain answer.",
  navigational: "People want a specific place/action — make sure the page nails the brand/contact/action they expect.",
  informational: "Learning intent — lead with a concise answer, then depth; FAQ + schema help AI quote you.",
};

export function classifyQueryIntent(query: string): QueryIntentResult {
  const commercial = commercialIntent(query);
  const signals: string[] = [];
  let intent: QueryIntent;

  if (TRANSACTIONAL.test(query) || commercial >= 0.85) {
    intent = "transactional";
    signals.push("transactional cue");
  } else if (COMMERCIAL_INVESTIGATION.test(query) || commercial >= 0.5) {
    intent = "commercial";
    signals.push("commercial cue");
  } else if (NAVIGATIONAL.test(query)) {
    intent = "navigational";
    signals.push("navigational cue");
  } else {
    intent = "informational";
    if (INFORMATIONAL.test(query)) signals.push("informational cue");
    else signals.push("default informational");
  }

  return { intent, commercial, signals, hint: HINT[intent] };
}
