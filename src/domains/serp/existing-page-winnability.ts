/**
 * existing-page-winnability (RANK-3, 2026-07-06) - the LIVE Google-results
 * winnability read for EXISTING-PAGE moves on the "Prepare my top 10" path.
 *
 * Background: prepare-create-page-verdicts.ts already runs a live SERP verdict
 * for NEW-PAGE candidates (BUILD/WAIT/SKIP) so the New Pages board arrives
 * "Google checked". Existing-page moves (answer blocks, title/meta edits,
 * experience fixes) never got the same live check - a move could reach
 * "ready_to_review" purely because a draft existed, even when the top Google
 * results are marketplaces or directories a content edit cannot outrank. This
 * module is the PURE decision + copy layer that turns one already-fetched SERP
 * verdict into: (a) an honest "hold this, it is structurally unwinnable" flag
 * that caps readiness, and (b) the single first-person line the card shows for
 * both the winnable and the held case.
 *
 * PURE / deterministic / no I/O. The SERP fetch + money gauntlet live in
 * dataforseo-serp.ts (runSerpQuery) and the verdict shaping reuses
 * serp-validation.ts (validateCreatePage). This module only judges the parsed
 * verdict + writes the plain-English sentence. Pinned by
 * existing-page-winnability.test.ts.
 */

import type { PreparedSerpVerdict } from "./prepare-create-page-verdicts";

/** The move types this live check applies to on the existing-page prepare path. */
export type ExistingMoveType = "answer_block" | "edit_page" | "fix_experience";

export type WinnabilityHoldDecision = {
  /** True = cap readiness at serp_checked: the top Google results are a
   *  structural wall a content change cannot beat, so we do NOT present a
   *  confident "ready" draft. */
  hold: boolean;
  /** One first-person line for the card. Present whenever a real verdict exists
   *  (both the winnable "worth doing" line and the held "I am holding this" line);
   *  null when there is no verdict to talk about (no live check ran). */
  line: string | null;
};

/**
 * Decide whether an existing-page move should be held (readiness capped) from
 * its live Google-results verdict, and produce the honest one-line copy.
 *
 * Rules (conservative on purpose):
 *  - No verdict (live check did not run / dry-run / cache-empty / unconfigured)
 *    -> never hold, no line. Existing behavior is untouched.
 *  - Marketplace / directory / structural top results ("reject" verdict driven
 *    by SERP SHAPE) -> HOLD. A content edit cannot outrank Amazon/Etsy/Reddit.
 *  - Winnability arithmetic band "reject" (difficulty/domain-strength/backlink
 *    numbers say it is not winnable) -> HOLD, with the concrete numbers.
 *  - "you already rank" is EXPECTED for an edit_page/fix_experience move (the
 *    page that ranks IS the page we are improving) - it is NEVER a hold for
 *    those. It is only a low-value signal for an answer_block move (adding an
 *    answer block to a page you already rank #1-3 for is low upside), and even
 *    then we surface it as a note, not a hard hold, so we never suppress a real
 *    improvement.
 *  - Everything else (content SERP you can beat) -> not held, "worth doing" line.
 */
export function decideExistingPageHold(args: {
  verdict: PreparedSerpVerdict | null;
  moveType: ExistingMoveType;
}): WinnabilityHoldDecision {
  const { verdict, moveType } = args;
  if (!verdict) return { hold: false, line: null };

  const marketplaceWall = verdict.marketplaceUgcCount >= 6 || verdict.intent === "marketplace_ugc";
  const arithmeticReject = verdict.winnability?.band === "reject";

  // Marketplace/directory wall: a content edit cannot outrank it. HOLD.
  if (marketplaceWall) {
    return {
      hold: true,
      line: `The top Google results here are marketplaces and directories I cannot outrank with a content change, so I am holding this until there is a better angle.`,
    };
  }

  // The winnability numbers themselves say it is not winnable. HOLD, with the
  // concrete sentence (already first-person + numbered from winnability.ts).
  if (arithmeticReject) {
    const detail = verdict.winnability?.sentence?.trim();
    return {
      hold: true,
      line: detail
        ? `I am holding this one. ${detail}`
        : `The Google results here are held by sites too strong to beat with a content change right now, so I am holding this until there is a better angle.`,
    };
  }

  // answer_block + already ranking: low upside, surfaced honestly but NOT held
  // (a real content improvement is never suppressed just because the page ranks).
  if (moveType === "answer_block" && verdict.ownAlreadyRanks) {
    return {
      hold: false,
      line: `You already rank on Google for this, so an answer block is a smaller win than a page you do not yet own, but it can still earn the AI citation.`,
    };
  }

  // Winnable content SERP: the honest "worth doing" line, with the beatable
  // content count when we have it.
  const beatable = verdict.contentDomainCount;
  const line =
    beatable > 0
      ? `The top Google results here are ${beatable} of 10 real content pages you can beat, so this is worth doing.`
      : `The top Google results here are real content you can beat, so this is worth doing.`;
  return { hold: false, line };
}
