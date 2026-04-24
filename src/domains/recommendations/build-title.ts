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
      return truncatedLabel
        ? `Create a ${truncatedLabel} page`
        : "Create a new page";
  }
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
