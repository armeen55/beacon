/**
 * ask/planner (W9 slice 2, 2026-07-10) - the multi-provider selection layer for /ask.
 *
 * Slice 1 routed ONE class per question and gathered ONE provider, so a question with more
 * than one datapoint ("which page makes the most money AND is it in tonight's plan") only
 * ever heard from a single specialist. The planner fixes that WITHOUT any model call: it is
 * PURE keyword selection, zero I/O, zero LLM. It keeps the router's primary class (always
 * selected) and adds a small SUBSET (up to 3 total) of other providers whose broad cue words
 * appear in the raw question. The single model call in the whole /ask path stays exactly
 * where it was - the one budget-gated callStructuredLLM inside composeAskAnswer.
 *
 * Why looser cues than the router: the router is a strict single-winner classifier (one class
 * wins). Secondary selection wants RECALL over precision - a spurious secondary just adds a
 * few capped, fail-soft facts and its own honest "nothing there" line, never a wrong answer.
 * So SECONDARY_CUES below are deliberately broader than router.ts's patterns.
 *
 * Determinism verdict: a whole plan is deterministic (bypasses the LLM) when the question is
 * a plain count/list, OR when every selected class answers with a rank/total already phrased
 * in plain English (page_ranking, site_trend). Any other multi-class plan (a real synthesis
 * like "most money AND in the plan") is non-deterministic and reaches the single LLM compose.
 *
 * Provenance stays DERIVED, never model-generated: the planner only records which providers
 * were selected; the composer credits them from teammateOf labels off the real facts.
 */

import { ALL_PROVIDERS } from "./providers/registry";
import { routeQuestion, SITE_TREND_PATTERNS, type AskQuestionClass, type RoutedQuestion } from "./router";
import type { AskFactProvider } from "./providers/provider-types";

/** One provider the planner chose, with WHY it was chosen (for tests + telemetry). */
export type ProviderSelection = {
  provider: AskFactProvider;
  matchedClass: AskQuestionClass;
  reason: "primary" | "secondary_cue";
};

export type AskPlan = {
  /** The router's verdict, reused verbatim (primary class + pagePath + rankingMetric + speaker). */
  routed: RoutedQuestion;
  /** Selected providers, primary first, capped at MAX_SELECTED_PROVIDERS. */
  selections: ProviderSelection[];
  /** Distinct classes across selections, primary first. Length > 1 = multi-specialist answer. */
  selectedClasses: AskQuestionClass[];
  /** True when the answer needs ZERO LLM (see isDeterministicPlan). */
  deterministic: boolean;
  /** True when the only thing to go on was the universal traffic provider from the router's
   *  catch-all default (no explicit site-trend cue, no secondary fired). The answer can then
   *  say plainly it only had overall traffic to look at. */
  bestEffortOnly: boolean;
};

const MAX_SELECTED_PROVIDERS = 3;

/**
 * Broad, planner-owned cue lexicon per class (looser than router.ts's strict single-winner
 * patterns). Tested against the raw question for EVERY class OTHER than the routed primary;
 * a match adds that class's provider(s) as a secondary. Intentionally omits site_trend
 * (it is the universal catch-all primary, never a helpful secondary) and page_specific
 * (it needs a named page path, which only the router extracts). No em/en dashes.
 */
export const SECONDARY_CUES: Partial<Record<AskQuestionClass, RegExp>> = {
  page_ranking:
    /\b(most money|makes? (me |us )?(the )?most|top pages?|best pages?|worst pages?|biggest pages?|which pages?|what pages?|revenue|highest.?value|biggest opportunit\w*|recoverable)\b/i,
  measurement: /\b(ship(ped)?|shipping|worked|didn'?t work|results?|measur\w*|proof|verdict|impact|last (batch|change))\b/i,
  plan: /\b(plans?|planned|planning|tonight|scheduled|queue\w*|next up|to-?do|do next|what should we do|what to do)\b/i,
  keyword_next: /\bkeyword\w*\b/i,
  ai_visibility: /\b(chatgpt|perplexity|gemini|copilot|ai (answer|citation|mention|overview)|cited|citation)\b/i,
  competitor: /\b(competitors?|rivals?|outrank\w*|instead of (me|us))\b/i,
  system_health: /\b(broken|stale|missing|not (syncing|updating|running)|out of date|health check)\b/i,
};

/**
 * Whole-plan deterministic verdict. A plain "how many"/"list" question always is (the facts
 * already carry the number/enumeration). Otherwise deterministic only when EVERY selected
 * class answers with a rank or total already phrased in plain English (page_ranking or
 * site_trend). Anything else (measurement, plan, ai_visibility, ...) or a mix that includes
 * one of them needs the LLM to synthesize, so it is non-deterministic. Pure.
 */
export function isDeterministicPlan(question: string, selectedClasses: AskQuestionClass[]): boolean {
  if (/\bhow many\b|\blist\b/i.test(question ?? "")) return true;
  return selectedClasses.every((c) => c === "page_ranking" || c === "site_trend");
}

function uniquePreserveOrder<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Plan the providers for one raw question. PURE: route and providers are injectable so tests
 * need no mocks. Algorithm: the routed class's provider(s) are always selected (primary);
 * then for every OTHER class whose broad cue fires on the raw text, its provider(s) join as
 * secondaries; dedupe by provider id; truncate to maxProviders keeping primaries (they are
 * first). The router always returns a class (site_trend is the catch-all), so at least one
 * provider is ALWAYS selected and the planner never fans out to all nine.
 */
export function planAsk(
  question: string,
  opts: { providers?: AskFactProvider[]; route?: (q: string) => RoutedQuestion; maxProviders?: number } = {},
): AskPlan {
  const providers = opts.providers ?? ALL_PROVIDERS;
  const route = opts.route ?? routeQuestion;
  const maxProviders = Math.max(1, opts.maxProviders ?? MAX_SELECTED_PROVIDERS);
  const raw = (question ?? "").trim();
  const routed = route(raw);

  const selections: ProviderSelection[] = [];
  const seenIds = new Set<string>();

  // PRIMARY: every provider registered for the routed class (one, today), always kept.
  for (const p of providers) {
    if (p.classes.includes(routed.questionClass) && !seenIds.has(p.id)) {
      selections.push({ provider: p, matchedClass: routed.questionClass, reason: "primary" });
      seenIds.add(p.id);
    }
  }

  // SECONDARY: broad cue per OTHER class; a match adds that class's provider(s).
  for (const cls of Object.keys(SECONDARY_CUES) as AskQuestionClass[]) {
    if (cls === routed.questionClass) continue;
    const cue = SECONDARY_CUES[cls];
    if (!cue || !cue.test(raw)) continue;
    for (const p of providers) {
      if (p.classes.includes(cls) && !seenIds.has(p.id)) {
        selections.push({ provider: p, matchedClass: cls, reason: "secondary_cue" });
        seenIds.add(p.id);
      }
    }
  }

  const capped = selections.slice(0, maxProviders);
  const selectedClasses = uniquePreserveOrder(capped.map((s) => s.matchedClass));
  const deterministic = isDeterministicPlan(raw, selectedClasses);
  const secondaryFired = capped.some((s) => s.reason === "secondary_cue");
  const bestEffortOnly =
    routed.questionClass === "site_trend" &&
    capped.length === 1 &&
    !secondaryFired &&
    !SITE_TREND_PATTERNS.test(raw);

  return { routed, selections: capped, selectedClasses, deterministic, bestEffortOnly };
}
