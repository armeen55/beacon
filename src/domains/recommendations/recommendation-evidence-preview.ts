/**
 * W3 Step 3.5d (2026-05-02) — recommendation evidence preview.
 *
 * Operator scope (browser audit, 2026-05-02 third pass): "Use one
 * clean sentence" for evidence preview on the default card. No
 * "site inventory shows…", no "cluster label strongly", no
 * "partially matches", no raw score detail.
 *
 *   "Ritz cited 6%; top competitor Greenberg winning."
 *   "Homepage cited 20%; target page exists but is not winning."
 *   "No owned page cited across 60 observations."
 *   "Ritz is close: owned page cited 39%, needs more topical coverage."
 *
 * Pure / deterministic. Filters generic/directory entities through
 * `entity-pollution-filter` so "General Contractors winning" never
 * surfaces.
 */

import type {
  PageIntentResolution,
  RecommendationAction,
} from "./resolved-types";
import { shouldExcludeFromCompetitorRanking } from "./entity-pollution-filter";

/** Minimal evidence shape consumed by the preview. Mirrors the
 *  fields the rec card already has access to via `rec.evidence`. */
export type EvidencePreviewInput = {
  readonly affectedPromptCount: number;
  readonly observationCount: number;
  /** 0..1 — Ritz primary share across observations (when known). */
  readonly brandPrimaryShare?: number | null;
  readonly primaryCompetitors: ReadonlyArray<{
    readonly name: string;
    readonly promptsWherePrimary: number;
    readonly totalAffectedPrompts: number;
  }>;
  /** Resolved action (drives "page exists" wording). Optional. */
  readonly resolvedAction?: RecommendationAction | null;
  /** Resolved target URL (drives "homepage cited" copy when relevant). */
  readonly resolvedTargetUrl?: string | null;
  /** Whether the rec resolved to an existing owned page (vs needs_new_page). */
  readonly hasResolvedTarget?: boolean;
};

/**
 * Build a single-sentence evidence preview from the rec's evidence
 * + resolution. Always returns a non-empty string.
 *
 * Sentence shapes:
 *   - "Ritz is close: owned page cited {N}%, needs more topical coverage."
 *     (when brandPrimaryShare ≥ 0.3 AND has resolved target)
 *   - "Homepage cited {N}%; target page exists but is not winning."
 *     (when brandPrimaryShare 0.05–0.3 AND has resolved target)
 *   - "No owned page cited across {N} observations." (when share = 0)
 *   - "Ritz cited {N}%; {Competitor} winning." (when a real competitor
 *     dominates ≥ 50%)
 *   - Fallback: "{N} prompts · {N} observations" (counts only)
 */
export function composeEvidencePreview(
  input: EvidencePreviewInput,
): string {
  const promptCount = input.affectedPromptCount;
  const obsCount = input.observationCount;
  const sharePct =
    typeof input.brandPrimaryShare === "number"
      ? Math.round(input.brandPrimaryShare * 100)
      : null;

  // Find the FIRST real competitor that dominates (filter generic
  // / directory names).
  const winningCompetitor = input.primaryCompetitors
    .filter((c) => !shouldExcludeFromCompetitorRanking(c.name))
    .find((c) => {
      if (!c.totalAffectedPrompts) return false;
      const ratio = c.promptsWherePrimary / c.totalAffectedPrompts;
      return ratio >= 0.5;
    });

  // Ritz is close — owned page exists, share ≥ 30%.
  if (
    sharePct != null &&
    sharePct >= 30 &&
    input.hasResolvedTarget === true
  ) {
    return `Ritz is close: owned page cited ${sharePct}%, needs more topical coverage.`;
  }
  // Owned page exists but losing — share 5–29%.
  if (
    sharePct != null &&
    sharePct >= 5 &&
    sharePct < 30 &&
    input.hasResolvedTarget === true
  ) {
    if (winningCompetitor) {
      return `Owned page cited ${sharePct}%; ${winningCompetitor.name} winning across ${promptCount} ${plural(promptCount, "prompt", "prompts")}.`;
    }
    return `Owned page cited ${sharePct}% — exists but is not winning.`;
  }
  // No owned page cited.
  if ((sharePct ?? 0) === 0) {
    if (winningCompetitor) {
      return `No owned page cited across ${obsCount} ${plural(obsCount, "observation", "observations")}; ${winningCompetitor.name} winning.`;
    }
    return `No owned page cited across ${obsCount} ${plural(obsCount, "observation", "observations")}.`;
  }
  // Generic competitor-dominant case.
  if (winningCompetitor) {
    const sharePart =
      sharePct != null ? `Ritz cited ${sharePct}%; ` : "";
    return `${sharePart}${winningCompetitor.name} winning across ${promptCount} ${plural(promptCount, "prompt", "prompts")}.`;
  }
  // Fallback — just counts.
  return `${promptCount} ${plural(promptCount, "prompt", "prompts")} · ${obsCount} ${plural(obsCount, "observation", "observations")}.`;
}

function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

// ── Recommended-move copy ─────────────────────────────────────────────────

/**
 * Build the "Recommended move" sentence for the default card.
 * Operator scope: one sentence describing what Beacon wants the
 * operator to do, written for a non-technical reader.
 *
 * Pure. Falls back to action-only copy when no topic / target are
 * available.
 */
export function composeRecommendedMove(args: {
  readonly action: RecommendationAction;
  /** Topic phrase derived from `extractTopicTag`. Null when none. */
  readonly topic?: string | null;
  /** Operator-facing page name (from `pageNameFromUrl`). */
  readonly pageName?: string | null;
  /** Resolution, if needed for fallback copy. */
  readonly resolution?: PageIntentResolution | null;
}): string {
  const topic = args.topic ?? null;
  const page = args.pageName ?? null;

  switch (args.action) {
    case "create_new_page":
      if (topic) {
        return `Spin up a dedicated ${topic} page so AI has a clear place to cite.`;
      }
      return "Spin up a dedicated page so AI has a clear place to cite.";
    case "expand_existing_page":
    case "add_section_or_faq":
      if (topic && page) {
        return `Add a ${topic} section to the ${page} page so AI can cite it directly.`;
      }
      if (topic) {
        return `Add a ${topic} section so AI can cite it directly.`;
      }
      return "Add a new section to the existing page so AI can cite it directly.";
    case "strengthen_existing_page":
      if (topic && page) {
        return `Tighten the ${page} copy + descriptors around ${topic} so AI ranks Ritz first.`;
      }
      if (page) {
        return `Tighten the ${page} copy + descriptors so AI ranks Ritz first.`;
      }
      return "Tighten the existing page so AI ranks Ritz first.";
    case "merge_or_dedupe":
      if (page) {
        return `Merge overlapping owned pages into the ${page} so AI doesn't split citations.`;
      }
      return "Merge overlapping owned pages so AI doesn't split citations.";
    case "split_or_separate_page":
      if (topic && page) {
        return `Pull ${topic} content out of the ${page} into its own page so AI can cite the right one.`;
      }
      return "Split the bundled page so AI can cite the right one.";
    case "watch":
      return "Keep an eye on this cluster — Ritz is currently winning.";
    case "needs_review":
      return "Pick a direction before Beacon proposes specific edits.";
    default:
      return "Open the rec to see Beacon's proposed move.";
  }
}
