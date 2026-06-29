/**
 * keyword-match (2026-06-28) — deterministically map a New-Page / create_page topic
 * (label + AI prompt) to the best cached DataForSEO keyword, so a page move shows REAL
 * search volume instead of a brittle exact-string hit (the prior wiring matched the
 * raw label against the keyword verbatim → almost never hit).
 *
 * Conservative by construction (the operator's hard rules):
 *  - A match needs a shared DISTINGUISHING token (not just "persian"/"iran"/"gift").
 *    Reusing keyword-opportunities `tokens()` (+ STOP/depluralize) so normalization is
 *    identical to the rest of the demand engine.
 *  - EXACT phrase (same token set) wins even when all-generic ("things to do in iran"),
 *    but a generic-ONLY token overlap is rejected ("Things Iran Highlights" → none).
 *  - Prefer the culturally-specific keyword (more shared distinguishing tokens) over a
 *    broad generic one; never let one giant generic keyword dominate a weak match.
 *  - NEVER guesses volume — only returns a cached keyword's real searchVolume.
 * PURE / deterministic / no I/O. Pinned by keyword-match.test.ts.
 */

import { tokens, COMMERCE } from "./keyword-opportunities";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

/** Brand/locale tokens that are NOT distinguishing on their own (every Iranopedia
 *  topic shares them). Tenant-agnostic default; could be config-driven later. */
const GENERIC = new Set(["iran", "iranian", "persian", "farsi", "tehran", "irani", "irania"]);
/** Boilerplate that carries no demand meaning — stripped from BOTH sides. Singularized
 *  to match `tokens()` output (it depluralizes words >4 chars ending in "s"). */
const FILLER = new Set([
  "guide", "complete", "ultimate", "list", "thing", "things", "highlight", "highlights",
  "usa", "best", "top", "overview", "intro", "introduction", "explained", "full", "idea",
  "fact", "info", "information", "detail", "popular", "famou", "famous",
]);

/** Tokens that don't distinguish a topic for demand-matching (generic + filler +
 *  commerce noise like "gift" — so "Gifts" alone never matches "nowruz gifts"). */
function isDistinguishing(t: string): boolean {
  return !GENERIC.has(t) && !FILLER.has(t) && !COMMERCE.has(t);
}

export type KeywordMatchConfidence = "exact" | "strong" | "weak" | "none";

export type KeywordMatch = {
  keyword: string | null;
  searchVolume: number | null;
  confidence: KeywordMatchConfidence;
  reason: string;
};

const NO_MATCH: KeywordMatch = {
  keyword: null,
  searchVolume: null,
  confidence: "none",
  reason: "No DataForSEO keyword matched this topic.",
};

const rank = (c: KeywordMatchConfidence): number => (c === "exact" ? 3 : c === "strong" ? 2 : c === "weak" ? 1 : 0);

/**
 * Best cached keyword for a topic. Combines the page label + (optional) AI prompt as
 * the topic vocabulary. Returns the matched keyword + its real volume + a confidence:
 *  - exact  : identical token set (e.g. "Persian Wedding" ↔ "persian wedding")
 *  - strong : every distinguishing token of the keyword is present in the topic
 *  - weak   : ≥1 shared distinguishing token, partial coverage
 *  - none   : no shared distinguishing token (generic-only overlap → rejected)
 */
export function matchKeywordDemand(
  label: string,
  prompt: string | null,
  keywords: readonly KeywordDemand[],
): KeywordMatch {
  const topicTokens = tokens(`${label} ${prompt ?? ""}`);
  if (topicTokens.length === 0) return NO_MATCH;
  const topicSet = new Set(topicTokens);
  const topicDist = new Set(topicTokens.filter(isDistinguishing));
  const topicNorm = [...topicSet].sort().join(" ");

  let best: { kw: KeywordDemand; conf: KeywordMatchConfidence; shared: number } | null = null;

  for (const kw of keywords) {
    if ((kw.searchVolume ?? 0) <= 0) continue;
    const kwTokens = tokens(kw.keyword);
    if (kwTokens.length === 0) continue;
    const kwSet = new Set(kwTokens);
    // DISTINGUISHING (drops generic/filler/commerce) gates the reject; CONTENT (keeps
    // commerce) gates "strong" — so "nowruz gifts" needs BOTH nowruz AND gift in the
    // topic to be strong (a "nowruz activities" page is only WEAKLY related to it).
    const kwDist = [...new Set(kwTokens.filter(isDistinguishing))];
    const kwContent = [...new Set(kwTokens.filter((t) => !GENERIC.has(t) && !FILLER.has(t)))];
    const sharedDist = kwDist.filter((t) => topicDist.has(t));
    const exact = [...kwSet].sort().join(" ") === topicNorm;

    // Exact phrase wins even if all-generic; otherwise require a distinguishing overlap.
    if (!exact && sharedDist.length === 0) continue;

    let conf: KeywordMatchConfidence;
    if (exact) conf = "exact";
    else if (kwContent.length > 0 && kwContent.every((t) => topicSet.has(t))) conf = "strong"; // every meaningful kw token on-topic
    else conf = "weak";

    const better =
      !best ||
      rank(conf) > rank(best.conf) ||
      (rank(conf) === rank(best.conf) &&
        (sharedDist.length > best.shared ||
          (sharedDist.length === best.shared && (kw.searchVolume ?? 0) > (best.kw.searchVolume ?? 0))));
    if (better) best = { kw, conf, shared: sharedDist.length };
  }

  if (!best) return NO_MATCH;
  return {
    keyword: best.kw.keyword,
    searchVolume: best.kw.searchVolume,
    confidence: best.conf,
    reason: `Matched “${best.kw.keyword}” (${best.conf}) — ${best.kw.searchVolume?.toLocaleString() ?? "?"}/mo.`,
  };
}
