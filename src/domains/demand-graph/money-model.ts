/**
 * money-model (2026-06-24, L8) — the "$Value" half of the Rank-&-Revenue score,
 * made first-class + PURE. Two deterministic signals, NO LLM, NO vertical
 * hardcoding (generic commercial cues + GA4 outcomes):
 *
 *  1. commercialIntent(query) — 0–1 from generic money-intent terms in the query
 *     (buy/price/cost/hire/quote/near me/best/service/calculator/vs/review…). Lets
 *     $Value rank a page UP before any conversion has been measured (decisive for a
 *     new Ritz money page or an Iranopedia affiliate/offer page).
 *  2. computeMoneySignal(GA4) — conversions + conversion-rate + a money-page flag.
 *
 * Fused into dollarPotential (high/medium/low) — a measured conversion always wins;
 * absent that, commercial intent carries the signal. Tenant-agnostic.
 */

/** STRONG cues — one alone signals commercial intent (≥0.6). NOT vertical terms. */
const STRONG_TERMS = new Set([
  "buy", "price", "pricing", "cost", "costs", "quote", "quotes", "estimate", "hire",
  "order", "book", "shop", "calculator", "calc", "deal", "deals", "discount", "sale",
  "rates", "consultation", "pay", "purchase", "subscription",
]);
/** WEAK cues — commercial only in aggregate (density-weighted). */
const WEAK_TERMS = new Set([
  "best", "top", "review", "reviews", "service", "services", "company", "companies",
  "professional", "affordable", "cheap", "near", "vs", "store",
]);
/** Multi-word commercial phrases (count as STRONG). */
const COMMERCIAL_PHRASES = [/\bnear me\b/i, /\bfor sale\b/i, /\bhow much\b/i, /\bbest .* (for|in)\b/i];

const STOP = new Set(["and", "the", "for", "with", "your", "you", "are", "how", "what", "why", "who"]);

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));
}

/** 0–1: commercial intent of a query. One STRONG term (or phrase) → ≥0.6;
 *  WEAK terms add density on top. Clamped to [0,1]. */
export function commercialIntent(query: string): number {
  const t = tokens(query);
  if (!t.length) return 0;
  const strong = t.some((w) => STRONG_TERMS.has(w)) || COMMERCIAL_PHRASES.some((re) => re.test(query));
  const weakHits = t.filter((w) => WEAK_TERMS.has(w)).length;
  const density = Math.min(1, weakHits / Math.min(t.length, 4));
  return Math.min(1, (strong ? 0.6 : 0) + density * 0.4);
}

export type MoneyInput = {
  conversions?: number;
  sessions?: number;
  query?: string;
};

export type MoneySignal = {
  conversions: number;
  sessions: number;
  /** conversions / sessions, or null when sessions are unknown. */
  conversionRate: number | null;
  isMoneyPage: boolean;
  commercialIntent: number;
  dollarPotential: "high" | "medium" | "low";
};

const MONEY_RATE_FLOOR = 0.005; // ≥0.5% conversion rate → a money page

export function computeMoneySignal(input: MoneyInput): MoneySignal {
  const conversions = Math.max(0, Math.round(input.conversions ?? 0));
  const sessions = Math.max(0, Math.round(input.sessions ?? 0));
  const conversionRate = sessions > 0 ? conversions / sessions : null;
  const intent = input.query ? commercialIntent(input.query) : 0;

  const isMoneyPage =
    conversions > 0 || (conversionRate != null && conversionRate >= MONEY_RATE_FLOOR) || intent >= 0.5;

  let dollarPotential: MoneySignal["dollarPotential"] = "low";
  if (conversions >= 5 || (conversionRate != null && conversionRate >= 0.02)) dollarPotential = "high";
  else if (conversions > 0 || intent >= 0.5) dollarPotential = "medium";
  else if (intent >= 0.25) dollarPotential = "medium";

  return { conversions, sessions, conversionRate, isMoneyPage, commercialIntent: intent, dollarPotential };
}
