import "server-only";

/** decision/draft-budget - THE ONE PAID DRAFTING BUDGET, and there is no second one. Every family that spends model
 *  money on a deliverable (the winning-pattern reading, the new page, the correction review, the shallow field
 *  drafts, the deep bundles and the editor) is DECLARED here before the pass spends anything, ranked here once, and
 *  funded here once. It lives beside the drafting rather than inside it because the money is the one thing every
 *  family shares (operator, 2026-08-22, after 239 charged calls bought nothing).
 *
 *  WHY A MANIFEST AND NOT A CLAIM COUNTER (Codex, 2026-08-22). The first repair gave every family one shared pool
 *  and a ranked window, which stopped the private pools but left the order to whoever asked first: a family with no
 *  entry in the ranking claimed the moment it was reached, so an unranked new page or a correction review still took
 *  the pass's first slot ahead of the strongest completable change. Asking-order is not a ranking. So nothing claims
 *  any more. The pass compiles EVERY paid job it could run into one zero-cost manifest, `plan` ranks the whole
 *  manifest once and decides the funded set once, and each family then collects an allowance already decided for it.
 *  A key that is not on the funded list gets nothing, whenever it asks and whatever family it belongs to. */

/** EVERY CHARGED CALL ONE PASS MAY MAKE, drafts and judgings together, failures counted the same as successes. The
 *  old cap counted only the drafts that WORKED, so a pass whose every draft was refused simply bought another one,
 *  for ever: 364 charged calls produced seven visible changes, about fifty two calls each. */
const MAX_PAID_CALLS = 30;

/** THE KEY ONE PAID JOB IS FUNDED UNDER: its family and the page it is for, with the page reduced to its path. TWO
 *  RULES IN ONE STRING. The path reduction is the point of the second half: the deep door knows a page by its full
 *  address and every other family knows it by its path, so keying on whichever string was to hand funded ONE page
 *  twice, at three calls and then at twelve, which is "no hidden second capacity" broken by a spelling. And the
 *  family is the point of the first half: a twelve-call bundle and a three-call description are different work with
 *  different prices, so they are different candidates, each ranked and funded on its own terms rather than one
 *  quietly spending the other's allowance. One account is one site here, so a path identifies a page. */
const keyOf = (family: string, p: { pagePath?: string | null; pageUrl?: string | null }): string => {
  const raw = (p.pagePath ?? p.pageUrl ?? "").trim().toLowerCase();
  const path = !raw ? "unknown-page" : raw.startsWith("/") ? raw.replace(/\/+$/, "") || "/"
    : (() => { try { return new URL(raw.startsWith("http") ? raw : `https://${raw}`).pathname.replace(/\/+$/, "") || "/"; } catch { return raw; } })();
  return `${family}:${path}`;
};

/** WHAT ONE DELIVERABLE COSTS: a draft, its judge and the final reviewer. A single-field change owes exactly one
 *  deliverable and therefore exactly three charged calls, with no retry budget behind it. */
const PER_DELIVERABLE_CALLS = 3;
/** WHAT A WHOLE PAGE OR A DEEP BUNDLE OWES: a brief plus its sections, four deliverables, so TWELVE charged calls.
 *  Said out loud rather than hidden inside a multiplier, because it is the most expensive thing a pass can buy and
 *  the ranking has to see the price before it funds it (Codex, 2026-08-22: "it must be named, ranked and tested as a
 *  12-call proposal, not reported as a three-call candidate"). */
const BUNDLE_DELIVERABLES = 4;

/** ONE PAID JOB, PRICED BEFORE IT RUNS. `impact` is in ONE unit across every family: the clicks this account could
 *  plausibly win back, so a bundle, a new page and a description are comparable at all. `calls` is the whole
 *  allowance, already multiplied out. */
type PaidJob = { key: string; family: string; impact: number; calls: number };
/** A job the pass declared and the plan refused, with the reason in the operator's words. Refusal is on the receipt. */
type DeclinedJob = { key: string; family: string; calls: number; reason: string };

/** THE ONE RANKING, AND THE ONE SELECTION. Ranked by what each job is worth PER CHARGED CALL, not by worth alone:
 *  ranking on impact by itself let one twelve-call bundle swallow a pass that could have finished four changes worth
 *  more together, which is the starvation the operator saw as "239 calls, nothing ready". Impact breaks ties so two
 *  jobs at the same price still order by value, and the key breaks the last tie so the same manifest always plans
 *  the same way. Then a single walk: take a job when a candidate slot and its full price are both left, otherwise
 *  record why and keep walking, so a cheap strong job behind an unaffordable bundle is still funded. */
function plan(input: { jobs: readonly PaidJob[]; candidates: number; calls?: number; breakerOpen?: boolean }) {
  const ceiling = Math.max(0, input.calls ?? MAX_PAID_CALLS);
  // ONE ENTRY PER KEY. A family that declares the same job twice declares it once: the stronger claim on it wins, and
  // no job is ever funded, or priced, twice over.
  const byKey = new Map<string, PaidJob>();
  for (const j of input.jobs) { const at = byKey.get(j.key); if (!at || j.impact > at.impact) byKey.set(j.key, { ...j }); }
  const ranked = [...byKey.values()].sort((a, b) =>
    (b.impact / Math.max(1, b.calls)) - (a.impact / Math.max(1, a.calls)) || b.impact - a.impact || a.key.localeCompare(b.key));
  const funded = new Map<string, number>(), declined: DeclinedJob[] = [];
  let slots = Math.max(0, input.candidates), callsLeft = ceiling;
  for (const j of ranked) {
    const price = Math.max(1, Math.round(j.calls));
    if (input.breakerOpen === true) declined.push({ key: j.key, family: j.family, calls: price, reason: "the provider's own credit is spent, so this pass funded nothing" });
    else if (slots <= 0) declined.push({ key: j.key, family: j.family, calls: price, reason: `the pass funds ${Math.max(0, input.candidates)} candidates and stronger work filled them` });
    else if (price > callsLeft) declined.push({ key: j.key, family: j.family, calls: price, reason: `this needs ${price} charged calls and ${callsLeft} were left` });
    else { funded.set(j.key, price); slots -= 1; callsLeft -= price; }
  }
  const held = new Map<string, { left: number }>();
  return {
    /** The charged calls the plan left unfunded: money this pass decided not to commit, not money it has yet to spend. */
    calls: { left: callsLeft },
    /** The funded set, best first, as the pass's own receipt of what it decided to buy before it bought anything. */
    funded: ranked.filter((j) => funded.has(j.key)).map((j) => ({ key: j.key, family: j.family, calls: funded.get(j.key)!, impact: j.impact })),
    declined: declined as readonly DeclinedJob[],
    /** COLLECT AN ALLOWANCE ALREADY DECIDED. An unfunded key gets null, and so does an UNKNOWN one: a family that
     *  never declared its job on the manifest cannot spend, whenever it asks. One allowance per key, handed out once. */
    take(key: string) {
      const open = held.get(key);
      if (open) return open.left > 0 ? open : null;
      const price = funded.get(key);
      if (price == null) return null;
      const slice = { left: price };
      held.set(key, slice);
      return slice;
    },
    /** WHAT WAS ACTUALLY SPENT, off the allowances themselves: arithmetic, never a claim. */
    spent() {
      let used = 0; for (const [k, slice] of held) used += (funded.get(k) ?? 0) - Math.max(0, slice.left);
      return { calls: used, candidates: held.size, funded: funded.size, declined: declined.length };
    },
  };
}

/** THE MONEY SURFACE, as one export: the ceilings, the prices, the plan and the key every family agrees on. */
export const DRAFT_BUDGET = { MAX_PAID_CALLS, DELIVERABLE_CALLS: PER_DELIVERABLE_CALLS,
  BUNDLE_CALLS: PER_DELIVERABLE_CALLS * BUNDLE_DELIVERABLES, plan, keyOf } as const;
