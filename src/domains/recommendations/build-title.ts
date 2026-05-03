/**
 * Shared resolved-recommendation-title builder — Phase 1 (2026-04-24).
 *
 * Every operator-facing surface that shows a recommendation title MUST
 * go through this function. Raw generator titles (`rec.title` like
 * "Create a Los Altos page") are NEVER safe to display directly — when
 * the resolver flips action to Strengthen / Expand / Merge, the raw
 * title contradicts the badge and leaks internal cluster labels.
 *
 * Consumers:
 *   - /recommendations row titles
 *   - Today Top Pick card
 *   - Accept → changelog asset_name + hypothesis
 *   - any future teaser, email, or export surface
 *
 * Rules enforced here:
 *   1. If the LLM adjudicator produced an operatorTitle, use it verbatim.
 *   2. Otherwise build a title that matches the resolved action:
 *      Strengthen / Expand / Add section / Merge / Review / Watch / Create.
 *   3. Cluster labels and prompt text are run through sanitizeOperatorCopy
 *      so Shield: / Internal: / any future internal prefix is stripped.
 *   4. Never fall back to the raw generator title.
 */

import { sanitizeOperatorCopy } from "./copy-sanitize";
import {
  NEEDS_NEW_PAGE,
  type PageIntentResolution,
  type RecommendationAction,
} from "./resolved-types";

/** Minimum candidate shape this builder needs. Both RecommendationCandidate
 *  and ResolvedRecommendationCandidate (and anything carrying the same
 *  fields) satisfy it. */
export type BuildTitleInput = {
  clusterLabel: string | null;
  /** Prompt text or candidate description; used as a fallback label when
   *  no clusterLabel is available (single-prompt candidates). */
  promptTextFallback?: string | null;
  resolution?: PageIntentResolution;
};

export function buildResolvedRecommendationTitle(rec: BuildTitleInput): string {
  const resolution = rec.resolution;

  // 1. Adjudicator-provided title wins, after sanitization (defensive — the
  //    adjudicator system prompt forbids internal prefixes, but we strip
  //    them anyway in case the model ever slips).
  if (resolution?.operatorTitle && resolution.operatorTitle.trim().length > 0) {
    return sanitizeOperatorCopy(resolution.operatorTitle);
  }

  const action: RecommendationAction =
    resolution?.action ?? "create_new_page";
  const resolvedUrl =
    resolution?.targetUrl && resolution.targetUrl !== NEEDS_NEW_PAGE
      ? resolution.targetUrl
      : null;

  const cleanLabel =
    sanitizeOperatorCopy(rec.clusterLabel ?? "") ||
    stripActionVerbPrefix(
      sanitizeOperatorCopy(rec.promptTextFallback ?? ""),
    ) ||
    null;
  const truncatedLabel =
    cleanLabel && cleanLabel.length > 70
      ? `${cleanLabel.slice(0, 67).trimEnd()}…`
      : cleanLabel;

  switch (action) {
    case "strengthen_existing_page":
      return resolvedUrl
        ? `Strengthen ${shortUrlPath(resolvedUrl)}${
            truncatedLabel ? ` for ${truncatedLabel} prompts` : ""
          }`
        : truncatedLabel
          ? `Strengthen ${truncatedLabel} target page`
          : "Strengthen existing page";

    case "expand_existing_page":
      return resolvedUrl
        ? `Expand ${shortUrlPath(resolvedUrl)}${
            truncatedLabel ? ` to cover ${truncatedLabel}` : ""
          }`
        : truncatedLabel
          ? `Expand ${truncatedLabel} target page`
          : "Expand existing page";

    case "add_section_or_faq":
      return resolvedUrl
        ? `Add section to ${shortUrlPath(resolvedUrl)}`
        : truncatedLabel
          ? `Add section for ${truncatedLabel}`
          : "Add section or FAQ";

    case "merge_or_dedupe":
      return resolvedUrl
        ? `Merge owned pages into ${shortUrlPath(resolvedUrl)}`
        : "Merge or dedupe overlapping pages";

    case "split_or_separate_page":
      return resolvedUrl
        ? `Consider splitting ${shortUrlPath(resolvedUrl)}${truncatedLabel ? ` into a dedicated ${truncatedLabel} page` : ""}`
        : truncatedLabel
          ? `Consider splitting into a dedicated ${truncatedLabel} page`
          : "Consider splitting a bundled page";

    case "needs_review":
      return truncatedLabel
        ? `Review ${truncatedLabel} recommendation`
        : "Review recommendation";

    case "watch":
      return truncatedLabel
        ? `Watch ${truncatedLabel}`
        : "Watch winning cluster";

    case "create_new_page":
    default:
      if (!truncatedLabel) return "Create a new page";
      // W3 Step 3.5b.F (2026-05-02) — prompt-shaped labels produce
      // ungrammatical titles when inlined.
      // W3 Step 3.5c (2026-05-02, operator browser audit re-failed)
      // — even the wrapped form `Create a page for "<label>"`
      // exposes raw prompt copy in the title. Operator scope locked
      // a deterministic-cleanup-first / scenario-fallback contract:
      //   1. Try to extract a clean noun phrase
      //      (deterministic stripping of prompt-starter prefixes).
      //   2. If that produces a usable phrase, render
      //      `Create a page for {phrase}`.
      //   3. Otherwise fall back to a scenario-class heading
      //      (`Create a page for this {kind} scenario`) — never
      //      raw prompt quotes in titles.
      if (looksLikePromptText(truncatedLabel)) {
        const scenarioLabel = describeScenario(truncatedLabel);
        return `Create a page for ${scenarioLabel}`;
      }
      return `Create a ${truncatedLabel} page`;
  }
}

/**
 * W3 Step 3.5c (2026-05-02) — derive a clean operator-readable
 * scenario phrase from a prompt-shaped cluster label. Returns:
 *   - "this buying scenario" when label hints at purchase intent
 *   - "this remodeling scenario" when label hints at remodel intent
 *   - "this rebuild scenario" when label hints at teardown / build
 *   - "this comparison scenario" when label compares options
 *   - "this cost question" when label asks about price / budget
 *   - "this decision scenario" as the operator-scope-locked
 *     general fallback.
 *
 * Pure / deterministic. Case-insensitive matching. Operator scope:
 * "If impossible, fall back to 'Create a page for this buying
 * scenario,' not raw prompt quotes."
 */
export function describeScenario(label: string): string {
  const lower = label.toLowerCase();

  // Cost / pricing intent
  if (
    /\b(cost|price|pricing|budget|how much|expensive|afford)/.test(lower)
  ) {
    return "this cost question";
  }
  // Comparison intent
  if (
    /\bvs\b|\bversus\b|\bbetter (?:to|than)\b|\bor (?:should|do|is)\b|\bcompare\b|\bvs\.\s/.test(
      lower,
    )
  ) {
    return "this comparison scenario";
  }
  // Rebuild / teardown / build intent
  if (
    /\b(rebuild|tear ?down|teardown|build (?:a|new)|new construction|ground ?up)/.test(
      lower,
    )
  ) {
    return "this rebuild scenario";
  }
  // Remodel / renovate intent
  if (/\b(remodel|renovate|renovation|remodeling)/.test(lower)) {
    return "this remodeling scenario";
  }
  // Purchase intent
  if (
    /\b(buy|buying|bought|purchase|purchasing|acquire|acquired|acquiring)\b/.test(
      lower,
    )
  ) {
    return "this buying scenario";
  }
  // Generic fallback per operator scope.
  return "this decision scenario";
}

/**
 * W3 Step 3.5b.F — heuristic that flags labels which read like a
 * customer-asked sentence (e.g., "If I buy a property…") rather than
 * a category noun phrase (e.g., "Atherton kitchen remodel"). Inlining
 * a sentence into "Create a {label} page" produces broken grammar;
 * the title builder uses a wrapped form when this returns true.
 *
 * Triggers (any one fires):
 *   - starts with a prompt-starter word (If / When / How / Who / What
 *     / Why / Which / Should / Can / Do / Does / Are / Is / Will /
 *     Would / Could)
 *   - contains a first-person / second-person pronoun as a separate
 *     word (I / me / my / you / your)
 *   - contains a "?"
 *   - is longer than 50 characters (heuristic for "this is a
 *     sentence, not a phrase")
 *
 * Pure. Case-insensitive. Exported for tests; used only by this
 * module.
 */
export function looksLikePromptText(label: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 50) return true;
  if (trimmed.includes("?")) return true;
  // First-person / second-person pronoun as a standalone word.
  if (/\b(?:i|me|my|you|your)\b/i.test(trimmed)) return true;
  // Prompt-starter words (case-insensitive, must be the first
  // alphabetic token).
  const firstWord = trimmed
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!firstWord) return false;
  const STARTERS = new Set([
    "if",
    "when",
    "where",
    "how",
    "why",
    "who",
    "what",
    "which",
    "should",
    "can",
    "do",
    "does",
    "are",
    "is",
    "will",
    "would",
    "could",
  ]);
  return STARTERS.has(firstWord);
}

function shortUrlPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/";
  } catch {
    return url;
  }
}

/**
 * Generator titles for single-prompt recs follow templates like:
 *   `Strengthen "<prompt text>"`
 *   `Target "<prompt text>"`
 *   `Build for "<prompt text>"`
 *   `Create a <label> page`
 * When we fall back to one of these as a label, the leading action verb
 * produces doubled-verb titles like "Expand / to cover Strengthen ...".
 * Extract just the inner prompt text.
 */
function stripActionVerbPrefix(raw: string): string {
  if (!raw) return raw;
  // `Strengthen "..."` / `Target "..."` / `Build for "..."` / `Watch "..."`
  const quoted = raw.match(/^(?:Strengthen|Target|Build for|Watch|Review)\s+"(.+?)"\s*$/);
  if (quoted) return quoted[1];
  // `Create a <label> page` — strip the generator wrapper to surface the label.
  const createWrap = raw.match(/^Create a (.+?) page\s*$/);
  if (createWrap) return createWrap[1];
  return raw;
}
