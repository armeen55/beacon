/**
 * zero-click-trap (2026-07-10 hygiene batch, G2) - a page can rank well and pull real
 * impressions and still be structurally unable to earn clicks. Found live on the pilot
 * tenant: /iran-flags ranked #2 in Beacon's own ranked list as a "Capture clicks" edit,
 * but its top query ("iran flag", 5,567 impressions/90d, 0 clicks at position 2.8) is
 * IMAGE-INTENT - Google shows the flag right there in results, so nobody needs to click
 * through. /iran-animals/asiatic-cheetah is the same trap on a single-fact query
 * ("national animal of iran", position 4.1, 0 clicks): the answer box already answers it.
 *
 * A "Capture clicks" edit (tighten the title/meta) is a bet that a sharper snippet wins
 * more clicks at the SAME position. That bet only pays off when the query is actually
 * click-shaped. Strong position (top 5) + material impressions (>=500) + near-zero CTR
 * (<0.2%) on the page's own top query is the trap signature: the searcher's need is
 * already satisfied on the results page, so no title change can win clicks there.
 *
 * PURE, deterministic, no LLM. build-canonical-changes.ts calls this only for "clicks"
 * -tone moves (the ones actually pitched as click-capture edits) and, on a match, holds
 * the qualityDecision to "flagged" - the SAME machinery an off-topic rec already uses -
 * so decide-action.ts's existing flagged -> watch rule demotes it off the actionable
 * queue with an honest reason, never deleted, never sold as a confident click-capture
 * pick. Pinned by build-canonical-changes.test.ts.
 */

export const ZERO_CLICK_TRAP_MAX_POSITION = 5;
export const ZERO_CLICK_TRAP_MIN_IMPRESSIONS = 500;
export const ZERO_CLICK_TRAP_MAX_CTR = 0.002; // 0.2%

export type ZeroClickTrapSignal = {
  topQueryPosition?: number | null;
  topQueryImpressions90d?: number | null;
  topQueryClicks90d?: number | null;
};

/**
 * True when the page's top query ranks well, pulls real impressions, and still earns
 * almost no clicks - the signature of an image-intent or true zero-click search, not a
 * fixable title/meta problem. Missing position/impressions (nothing measured yet) never
 * trips it - silence, not a false trap call.
 */
export function isZeroClickTrap(s: ZeroClickTrapSignal): boolean {
  const pos = s.topQueryPosition;
  const impr = s.topQueryImpressions90d;
  if (pos == null || impr == null) return false;
  if (pos > ZERO_CLICK_TRAP_MAX_POSITION) return false;
  if (impr < ZERO_CLICK_TRAP_MIN_IMPRESSIONS) return false;
  const clicks = s.topQueryClicks90d ?? 0;
  const ctr = impr > 0 ? clicks / impr : 0;
  return ctr < ZERO_CLICK_TRAP_MAX_CTR;
}

/** The honest, plain-language reason Beacon gives when it holds a "Capture clicks" edit
 *  back for this reason. Beacon voice: first person, no jargon, no dash. */
export const ZERO_CLICK_TRAP_REASON =
  "People see this in results but almost nobody clicks that kind of search. A title change probably cannot win clicks here.";
