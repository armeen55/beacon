import "server-only";

/** decision/draft-budget - THE ONE PAID DRAFTING BUDGET, and there is no second one. Every family that spends
 *  model money on a deliverable (the shallow field drafts, the deep bundles, the new page, the correction
 *  review and the editor) claims through this, so the caller's `maxDrafts` finally bounds all of them
 *  together instead of each keeping a private pool: a pass asking for two candidates gets two, whichever
 *  families they land in. It lives beside the drafting rather than inside it because the money is the one
 *  thing every family shares (operator, 2026-08-22, after 239 charged calls bought nothing). */

/** EVERY CHARGED CALL ONE PASS MAY MAKE, drafts and judgings together, failures counted the same as successes.  The old cap counted only the drafts that WORKED, so a pass whose every draft was refused simply bought another one, for ever: 364 charged calls produced seven visible changes, about fifty two calls each. */
const MAX_PAID_CALLS = 30;

/** THE CANDIDATE A CARD BELONGS TO: the page. Every family keys the same way, so a title, a description and a correction on one page share one slot and one allowance rather than each buying their own. */
const keyOf = (p: { pagePath?: string | null; pageUrl?: string | null }): string =>
  (p.pagePath ?? p.pageUrl ?? "").trim().toLowerCase() || "unknown-page";

/** WHAT ONE CANDIDATE MAY EVER SPEND: a draft, its judge and the final reviewer, which is exactly one clean single-field deliverable. Past it the failure is banked and the walk moves to the next ranked candidate, so no stubborn page
 *  can eat a pass again (operator, 2026-08-22). */
const PER_CANDIDATE_CALLS = 3;

/** ONE PAID DRAFTING BUDGET FOR THE WHOLE PASS, and there is no second one. Every family (the shallow field drafts, the deep bundles, the new page, the correction review and the editor below) claims through THIS, so `maxDrafts`
 *  finally bounds all of them together instead of each keeping a private pool: a caller asking for two candidates gets two, whichever families they land in. TWO RULES BEYOND THE ARITHMETIC. The line is walked in the RANKING'S OWN
 *  ORDER: `order` is the globally ranked candidate list built before a cent is spent, and a candidate may only take a slot once every better-ranked one has been offered, which is what stops stale or hard work spending in front of
 *  completable work. And a tripped provider breaker claims NOTHING: no call is made and no pass may report itself funded. */
/** WHAT ONE CANDIDATE MAY EVER SPEND: three charged calls PER PIECE it owes, declared rather than taken
 *  quietly. One piece is one draft, its judge and the final reviewer, so a repeatedly refused card can never
 *  take a fourth call; a whole page or a bundle owes several pieces and says so at the claim. */
function make(input: { candidates: number; calls?: number; perCandidate?: number;
  /** The globally ranked candidate keys, best first. Empty = rank imposes no order (tests, single-family callers). */
  order?: readonly string[]; /** TRUE when the provider's own credit is spent: nothing is claimable. */ breakerOpen?: boolean }) {
  const calls = { left: Math.max(0, input.calls ?? MAX_PAID_CALLS) };
  const per = Math.max(1, input.perCandidate ?? PER_CANDIDATE_CALLS);
  let rank = new Map((input.order ?? []).map((k, i) => [k, i]));
  const held = new Map<string, { left: number }>(), accounted = new Map<string, number>();
  let slots = Math.max(0, input.candidates), offered = 0, reads = 0;
  // WHAT THE OPEN SLICES HAVE SPENT SINCE ANYONE LAST LOOKED. Reconciling on every claim (and on every read) means no family has to remember to hand its slice back for the pool to stay true.
  const settle = (): void => {
    for (const [k, slice] of held) {
      const was = accounted.get(k) ?? 0, now = Math.max(0, slice.left);
      if (was > now) { calls.left -= was - now; accounted.set(k, now); }
    }
  };
  return {
    calls,
    rank(order: readonly string[]) { rank = new Map(order.map((k, i) => [k, i] as const)); },
    reserve() {
      settle();
      if (input.breakerOpen === true || calls.left <= 0) return null;
      const key = `read:${reads += 1}`, slice = { left: Math.min(per, calls.left) };
      held.set(key, slice); accounted.set(key, slice.left);
      return slice;
    },
    claim(key: string, pieces = 1) {
      settle();
      const open = held.get(key);
      if (open) return open.left > 0 ? open : null; // one allowance per candidate, spent once
      if (input.breakerOpen === true || slots <= 0 || calls.left <= 0) return null;
      // THE RANKED WALK: a candidate below the reachable window waits for the better-ranked ones to be offered.
      const at = rank.get(key);
      if (at != null && at >= offered + slots) return null;
      slots -= 1; offered += 1;
      const slice = { left: Math.min(per * Math.max(1, Math.round(pieces)), calls.left) };
      held.set(key, slice); accounted.set(key, slice.left);
      return slice;
    },
    spent() { settle(); return { calls: Math.max(0, (input.calls ?? MAX_PAID_CALLS) - calls.left), candidates: offered }; },
  };
} 

/** THE MONEY SURFACE, as one export: the ceiling, the budget itself and the key every family agrees on. */
export const DRAFT_BUDGET = { MAX_PAID_CALLS, make, keyOf } as const;
