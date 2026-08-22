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

/** THE KEY ONE PAID JOB IS FUNDED UNDER: THE PAGE, reduced to its path, and never the family working on it. Both
 *  halves were learned the hard way. Keying on whichever string was to hand (the deep door knows a page by its full
 *  address, every other family by its path) funded ONE page twice, at three calls and then at twelve. Keying by
 *  family did the same thing in daylight: a page with a rewrite AND an editor card took two candidate slots and two
 *  allowances, so a successful rewrite left the editor's slot funded and unused, and a failed one let the same page
 *  spend twelve calls and then three more. One page is ONE candidate, with ONE allowance, and the families working
 *  on it draw from that one allowance in turn. One account is one site here, so a path identifies a page. */
const keyOf = (p: { pagePath?: string | null; pageUrl?: string | null }): string => {
  const raw = (p.pagePath ?? p.pageUrl ?? "").trim().toLowerCase();
  if (!raw) return "unknown-page";
  if (raw.startsWith("/")) return raw.replace(/\/+$/, "") || "/";
  try { return new URL(raw.startsWith("http") ? raw : `https://${raw}`).pathname.replace(/\/+$/, "") || "/"; } catch { return raw; }
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
type PaidJob = { key: string; family: string; impact: number; calls: number;
  /** The cheaper families that also want work on this page. They run only if the funded one does not produce, and they draw on ITS allowance, never a second. */ fallbacks?: readonly string[] };
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
  // ONE ENTRY PER PAGE, DECIDED BEFORE ANYTHING IS RANKED. Several families can want work on one page; the most
  // expensive of them is the one that page is funded for, and the cheaper ones are its FALLBACKS, drawing on that
  // same allowance rather than each buying their own. The page is worth the most any of them thinks it is worth.
  const byKey = new Map<string, PaidJob>();
  for (const j of input.jobs) { const at = byKey.get(j.key);
    if (!at) byKey.set(j.key, { ...j });
    else byKey.set(j.key, { key: j.key, impact: Math.max(at.impact, j.impact),
      family: j.calls > at.calls ? j.family : at.family, calls: Math.max(at.calls, j.calls),
      fallbacks: [...new Set([...(at.fallbacks ?? []), ...(j.fallbacks ?? []), j.calls > at.calls ? at.family : j.family])].filter((f) => f !== (j.calls > at.calls ? j.family : at.family)) }); }
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
    funded: ranked.filter((j) => funded.has(j.key)).map((j) => ({ key: j.key, family: j.family, calls: funded.get(j.key)!, impact: j.impact, fallbacks: j.fallbacks ?? [] })),
    declined: declined as readonly DeclinedJob[],
    /** COLLECT THE PAGE'S ALLOWANCE. An unfunded key gets null, and so does an UNKNOWN one: a family that never
     *  declared its job on the manifest cannot spend, whenever it asks. One allowance per page, handed out once. */
    take(key: string) {
      const open = held.get(key);
      if (open) return open.left > 0 ? open : null;
      const price = funded.get(key);
      if (price == null) return null;
      const slice = { left: price };
      held.set(key, slice);
      return slice;
    },
    /** WHAT ONE FAMILY MAY DRAW FROM THAT PAGE'S ALLOWANCE: a bounded VIEW of it, never a second purse. `price` is
     *  what this family's own deliverable costs, so a three-call editor beside a twelve-call rewrite can spend three
     *  and only three, and everything it spends comes off the page's one allowance as it spends it. Null when the
     *  page was not funded or has nothing left, which is a refusal, not an error. */
    draw(key: string, price: number) {
      const open = this.take(key);
      if (!open || open.left <= 0) return null;
      let cap = Math.max(0, Math.min(Math.round(price), open.left));
      if (cap <= 0) return null;
      return {
        get left() { return Math.min(cap, open.left); },
        set left(v: number) { const spent = Math.max(0, Math.min(cap, open.left) - v); open.left -= spent; cap = Math.max(0, cap - spent); },
      };
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
