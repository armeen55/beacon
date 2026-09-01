import "server-only";

/** decision/draft-budget - THE ONE PAID DRAFTING BUDGET, and there is no second one. Every family that spends model money on a deliverable (the winning-pattern reading, the new page, the correction review, the shallow field drafts, the deep bundles and the editor) is DECLARED here before the pass spends anything, ranked here once, and funded here once. It lives beside the drafting rather than inside it because the money is the one thing every family shares (operator, 2026-08-22, after 239 charged calls bought nothing). WHY A MANIFEST AND NOT A CLAIM COUNTER (Codex, 2026-08-22). The first repair gave every family one shared pool and a ranked window, which stopped the private pools but left the order to whoever asked first: a family with no entry in the ranking claimed the moment it was reached, so an unranked new page or a correction review still took the pass's first slot ahead of the strongest completable change. Asking-order is not a ranking. So nothing claims any more. The pass compiles EVERY paid job it could run into one zero-cost manifest, `plan` ranks the whole manifest once and decides the funded set once, and each family then collects an allowance already decided for it. A key that is not on the funded list gets nothing, whenever it asks and whatever family it belongs to. */

/** EVERY CHARGED CALL ONE PASS MAY MAKE, drafts and judgings together, failures counted the same as successes. It is a RUNAWAY STOP, not a spending policy: what the money buys is decided by the ranked manifest below, and this only says how far one pass may go before it stops and lets the next one continue. Raised from thirty to sixty (operator, 2026-08-22, "no guardrails, unlimited money") so a drive that may now finish five candidates can actually afford five, bundles included, instead of running out at two of them. The 2026-08-21 raise to ninety is NOT what this is: back then nothing capped a single candidate, so the extra ceiling bought 239 retries on the same few pages and nothing finished. Every candidate is priced and bounded now, so the ceiling buys candidates. */
const MAX_PAID_CALLS = 60;

/** THE KEY ONE PAID JOB IS FUNDED UNDER: THE MUTATION, when the object in hand says which one, and the page when
 *  it does not. ONE PAGE IS NOT ONE OPPORTUNITY (Product Truth; operator, 2026-08-31): keying the money by page
 *  meant two rows on one address spent one allowance, and whichever was reached first took it, which is how
 *  /famous-iranian-comedians at 324 words under 22,509 impressions bought a link out to another page instead of
 *  its own copy. The suffix mirrors mutation-footprint's slots, so what funds separately is exactly what can land
 *  together: a title, a description, a heading, each distinct body topic, each link destination. The OLD failures
 *  stay fixed: two spellings of one page still collapse (path normalization), and two families wanting the SAME
 *  mutation still collapse to one job in `plan` exactly as two families wanting one page used to. A bare
 *  `{pagePath}` with no change on it still keys the page alone, and `take` below lets a mutation-keyed draw fall
 *  back to a page-keyed allowance so a job declared before its card exists is still reachable. */
const pageOf = (p: { pagePath?: string | null; pageUrl?: string | null }): string => {
  const raw = (p.pagePath ?? p.pageUrl ?? "").trim().toLowerCase();
  if (!raw) return "unknown-page";
  if (raw.startsWith("/")) return raw.replace(/\/+$/, "") || "/";
  try { return new URL(raw.startsWith("http") ? raw : `https://${raw}`).pathname.replace(/\/+$/, "") || "/"; } catch { return raw; }
};
type Keyable = { pagePath?: string | null; pageUrl?: string | null; changeFamily?: string; primaryQuery?: string | null; id?: string;
  recommendedChange?: { kind: string; field?: string; linkTo?: string | null } };
const bareQuery = (q: string | null | undefined): string => (q ?? "").trim().toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60);
const keyOf = (p: Keyable): string => {
  const page = pageOf(p), c = p.recommendedChange;
  if (!c) return page;
  if (p.changeFamily === "factual_correction") return `${page}::corrections`; // the whole batch rides one job, exactly as it grouped by page before
  if (c.kind === "new_page") return `${page}::new_page::${bareQuery(p.primaryQuery) || (p.id ?? "").split("::").at(-1) || "topic"}`;
  const f = c.field ?? "";
  if (f === "title" || f === "meta" || f === "h1") return `${page}::${f}`;
  if (c.linkTo || (p.id ?? "").endsWith("::internal_link")) return `${page}::link::${(c.linkTo ?? "").trim().toLowerCase() || bareQuery(p.primaryQuery)}`;
  if (f === "section" || f === "answer_block") return `${page}::body::${bareQuery(p.primaryQuery)}`;
  return page;
};
/** Whether a focus entry names this job: exactly, or as the page every mutation on it extends. */
const focusHits = (focus: ReadonlySet<string>, key: string): boolean => {
  if (focus.has(key)) return true;
  for (const f of focus) if (key.startsWith(`${f}::`)) return true;
  return false;
};

/** THE DRAFTING POLICY, AS ONE CONTRACT THE LOOP AND THE PRICE BOTH READ. They diverged twice, and each time the allowance ran out mid-deliverable and the card was refused with "this pass has spent its whole attempt budget" (live receipts, 2026-08-22 22:30Z and 2026-08-23 00:32Z). So the retry count is stated ONCE and the price is DERIVED from it rather than written down separately: one writing round is a draft and its judge, the editor may make the first attempt plus EDITOR_RETRIES more, and one mandatory adversarial review reads the survivor before it may wear Ready. Change the retry count and the price follows; they cannot drift apart again. */
const EDITOR_RETRIES = 2, CALLS_PER_ROUND = 2;
/** LOGICAL OPERATIONS, NEVER PROVIDER CALLS (Codex, 2026-08-23: a seven-unit price met a sixteen-call dispatch, because one structured operation retries internally and can be two real calls). One round is a draft and its ONE evaluation; the last evaluation IS the promotion decision, so no final-review unit exists any more. Real calls and real dollars are metered off the gateway's own receipts, per page, and reported as themselves. */
const PER_DELIVERABLE_CALLS = (1 + EDITOR_RETRIES) * CALLS_PER_ROUND;
const WRITER = 8; // w8 (2026-08-26): a NEW section must name its heading, said where the writer can act on it. The homework note allows `naturalHeading: null` "when the edit replaces an existing field", and an add_answer_section draft read that as permission: /cities was written, judged and refused as "it lands somewhere new and names no heading" on the first funded substantive pass this account ever ran. (w7, 2026-08-26): the information-gain DEADLOCK is gone. The card brief, the last drafting hint and the answer-block system clause each ordered the writer to use only the page's own material, while the gain gate refused copy that used only the page's own material, so no body section could ever land: every settlement made under w6 was made under a contract no copy could satisfy, and they all reopen. The gate now arms only where a citable `fact-` or `owned-page` id is actually in hand, `owned-page` ids are echo-able, the packet holds the page ONCE, and a page whose gain is FORM reaches the synthesis route. (w6, 2026-08-25): the writer is handed the pages that already win this search as `rival-*` briefing, so it can be told what is MISSING instead of only what the page already says. Every candidate written off under w5 was written off without that evidence, which is exactly the refusal the briefing exists to answer, so those settlements say nothing about this policy and reopen. (w5, 2026-08-24: a rewrite target became the SECTION under its heading rather than a crawler chunk that matched nothing.)
const POLICY = `w${WRITER}r${EDITOR_RETRIES}c${PER_DELIVERABLE_CALLS}`;
/** WHAT A WHOLE PAGE OR A DEEP BUNDLE OWES: a brief plus its sections, four deliverables, so TWELVE charged calls. Said out loud rather than hidden inside a multiplier, because it is the most expensive thing a pass can buy and the ranking has to see the price before it funds it (Codex, 2026-08-22: "it must be named, ranked and tested as a 12-call proposal, not reported as a three-call candidate"). */
/** A WHOLE PAGE IS STILL TWELVE, unchanged and deliberately not raised with the number above: no receipt has named a bundle running out, so nothing here moves on a guess. When one does, it will say so and this follows the evidence. */
const BUNDLE_CALLS_TOTAL = 12;

/** ONE PAID JOB, PRICED BEFORE IT RUNS. `impact` is in ONE unit across every family: the clicks this account could plausibly win back, so a bundle, a new page and a description are comparable at all. `calls` is the whole allowance, already multiplied out. */
type PaidJob = { key: string; family: string; impact: number; calls: number; treatment?: string;
  /** THE IDENTITY OF THIS WORK, declared here with the job and read by everything downstream, so nothing recomputes a second one that cannot match the first (Codex, 2026-08-23). */ workKey?: string;
  /** WHY THIS JOB CANNOT BE DONE THIS PASS, in the caller's own words, decided from what was already on file
   *  BEFORE any funding (Codex, 2026-08-23). A page already under measurement, work the operator took back, a
   *  stored row that still stands and a card the authorization boundary will refuse are all knowable here, and
   *  funding them anyway is how three of five slots came back `not_reached` while cheaper completable work went
   *  unfunded. A blocked job stays DECLARED, so the manifest still names it, and is never funded. */ blocked?: string;
  /** The cheaper families that also want work on this page. They run only if the funded one does not produce, and they draw on ITS allowance, never a second. */ fallbacks?: readonly string[] };
/** A job the pass declared and the plan refused, with the reason in the operator's words. Refusal is on the receipt. */
type DeclinedJob = { key: string; family: string; calls: number; reason: string };

/** THE ONE RANKING, AND THE ONE SELECTION. Ranked by what each job is worth PER CHARGED CALL, not by worth alone: ranking on impact by itself let one twelve-call bundle swallow a pass that could have finished four changes worth more together, which is the starvation the operator saw as "239 calls, nothing ready". Impact breaks ties so two jobs at the same price still order by value, and the key breaks the last tie so the same manifest always plans the same way. Then a single walk: take a job when a candidate slot and its full price are both left, otherwise record why and keep walking, so a cheap strong job behind an unaffordable bundle is still funded. */
/** THERE IS NO INVENTORY TARGET IN THIS PLAN (operator, 2026-08-30). A `readyTarget` used to close every family's `take()` the moment that many Ready rows landed, which made a full-enough queue a reason to stop buying work the evidence had already earned. Deleted whole: what bounds a pass is the money above, the caller's time box, and each candidate's own typed settlement. Nothing here may ever read how much finished work already exists. */
function plan(input: { jobs: readonly PaidJob[]; candidates: number; calls?: number; breakerOpen?: boolean; quiet?: boolean;
  /** Pages a previous pass TODAY already spent real calls on and got nothing from. They stay DECLARED, so the caller can still tell a manifest that is finished from one that is not, and they are not funded again: the money moves down the ranking instead of buying the same refusal twice. */ skip?: readonly string[];
  /** Pages this day ALREADY SPENT REAL CALLS ON that came back transiently blocked. They are still owed and still
   *  fundable, but they rank behind work nobody has tried, because a candidate that fails the same way every time
   *  must never re-consume a whole drive ahead of untried candidates (Codex, 2026-08-23). THIS IS NOT THE DEFERRAL
   *  THAT WAS DELETED: that one demoted work never STARTED, which sent the account's strongest page to the back
   *  behind pages worth a hundredth of it. This demotes only work that was started and spent. */ retry?: readonly string[];
  /** Pages the CALLER NAMES to finish first. Live (2026-08-30): a standing card one review from Ready could not
   *  be funded by any means, because fresh page candidates outrank it and skip only declines. A focused key funds
   *  ahead of the impact order and is exempt from skip; everything else about the walk is unchanged, so this aims
   *  the same money, never more of it. */ focus?: readonly string[] }) {
  const ceiling = Math.max(0, input.calls ?? MAX_PAID_CALLS);
  // ONE ENTRY PER PAGE, AND THE PAGE GETS THE TREATMENT WITH THE HIGHEST EXPECTED SITE IMPACT (Codex, 2026-08-23).
  // Two corrections carved into this line. Dearest-wins buried strong cheap work behind bundles; value-per-call then
  // optimised the API bill instead of the site. And BOTH versions handed the winner the loser's impact score, so a
  // cheap edit inherited the expected value of the rewrite it does not perform. The winner keeps ITS OWN impact and
  // ITS OWN price; the losers stay recorded as fallbacks, never as extra funded work and never as donors.
  const finishes = (j: PaidJob): number => (j.family === "correction_review" ? 1 : 0);
  const byKey = new Map<string, PaidJob>();
  for (const j of input.jobs) { const at = byKey.get(j.key);
    if (!at) byKey.set(j.key, { ...j });
    else { // A LIVE JOB ALWAYS BEATS A BLOCKED ONE on the same page, whatever the scores say: a page is only blocked
      // when EVERY family that wants it is blocked, or a stale field draft would silence a live editor card.
      // AND VALUE WINS THE PAGE'S ONE SLOT, with a finish breaking only a tie (operator, 2026-08-30): the
      // same order at both doors, or the collapse hands the slot to work the ranking would never have chosen.
      const cmp = at.blocked && !j.blocked ? j : j.blocked && !at.blocked ? at
        : j.impact !== at.impact ? (j.impact > at.impact ? j : at)
        : finishes(j) !== finishes(at) ? (finishes(j) ? j : at)
        : j.calls < at.calls ? j : at;
      const win = cmp, lose = win === j ? at : j;
      byKey.set(j.key, { ...win, fallbacks: [...new Set([...(win.fallbacks ?? []), ...(lose.fallbacks ?? []), lose.family])].filter((f) => f !== win.family) }); } }
  // ONE ORDER, AND IT IS EXPECTED SITE IMPACT (Codex, 2026-08-23). Sorting pages that were funded and never
  // started to the BACK put /persian-female-first-names, worth 560 recoverable clicks, behind a product page
  // worth 0.22 and a category page worth 0.13, and it stayed unattempted for a third dispatch running. A
  // candidate that was selected and not reached is not owed less; it is owed FIRST, which this ordering gives
  // it for free because settled keys are the only ones the caller skips.
  // A PAGE-GENERIC JOB IS NOT A SECOND JOB BESIDE A MUTATION ON THAT PAGE. The legacy field families declare
  // "some best change on this page" before any card exists, and the editor declares the exact mutation. Left
  // separate they both fund and the generic one buys a duplicate the gates then refuse (proved by replay: the
  // editor's meta produced and the page job bought a safety-gate refusal beside it). The generic job collapses
  // into the page's STRONGEST mutation job exactly as two families on one page always collapsed, the alias lets
  // its family draw from the surviving allowance, and every OTHER mutation on the page stays its own funded job.
  const alias = new Map<string, string>();
  {
    const perPage = new Map<string, PaidJob[]>();
    for (const j of byKey.values()) if (j.key.includes("::")) { const pg = j.key.slice(0, j.key.indexOf("::")); const at = perPage.get(pg); if (at) at.push(j); else perPage.set(pg, [j]); }
    for (const j of [...byKey.values()]) {
      if (j.key.includes("::")) continue;
      const sibs = perPage.get(j.key); if (!sibs || sibs.length === 0) continue;
      const strongest = sibs.reduce((a, b) => (b.blocked && !a.blocked ? a : a.blocked && !b.blocked ? b : b.impact > a.impact ? b : a));
      // THE PRECISE KEY ALWAYS SURVIVES: the slot wears the mutation's name whichever side scored higher, so a
      // receipt names real work and a retry key from one pass still matches the next. The page job's strength and
      // liveness still count: its impact lifts the slot, and a live page job unblocks a slot only a blocked
      // mutation held.
      const live = !j.blocked && !!strongest.blocked;
      byKey.delete(j.key); alias.set(j.key, strongest.key);
      byKey.set(strongest.key, { ...strongest, impact: Math.max(strongest.impact, j.impact), ...(live ? { blocked: undefined, family: j.family, calls: j.calls } : {}),
        fallbacks: [...new Set([...(strongest.fallbacks ?? []), ...(j.fallbacks ?? []), live ? strongest.family : j.family])].filter((f) => f !== (live ? j.family : strongest.family)) });
    }
  }
  const tried = new Set(input.retry ?? []);
  // FINISHING IS A TIE-BREAK, NEVER A BAND (operator, 2026-08-30): the absolute correction-first order put
  // every one-cent finish above every new section, answer, link, and page whatever their traffic was worth,
  // which is the names-only queue. Expected value orders everything; a cheap finish wins only when values tie.
  const focus = new Set(input.focus ?? []); // a focus entry may name a page, and then it names every mutation on it
  const ranked = [...byKey.values()].sort((a, b) =>
    Number(focusHits(focus, b.key)) - Number(focusHits(focus, a.key)) || Number(tried.has(a.key)) - Number(tried.has(b.key)) || b.impact - a.impact || finishes(b) - finishes(a) || a.calls - b.calls || a.key.localeCompare(b.key));
  const funded = new Map<string, number>(), declined: DeclinedJob[] = [], skip = new Set(input.skip ?? []);
  let slots = Math.max(0, input.candidates), callsLeft = ceiling;
  for (const j of ranked) {
    const price = Math.max(1, Math.round(j.calls));
    if (j.blocked) declined.push({ key: j.key, family: j.family, calls: price, reason: j.blocked });
    else if (skip.has(j.key) && !focusHits(focus, j.key)) declined.push({ key: j.key, family: j.family, calls: price, reason: "a pass today already spent on this page and it finished nothing, so the money moves to the next ranked one" });
    // TWO DIFFERENT THINGS, TWO DIFFERENT SENTENCES. A pass Beacon was ASKED not to spend on used to report the
    // provider's credit as exhausted, which is a cause the receipt invented: nothing had run out, and an
    // operator reading it would go looking at a billing page for a decision Beacon had made itself.
    else if (input.quiet === true) declined.push({ key: j.key, family: j.family, calls: price, reason: "this pass was asked to spend nothing, so the work is still owed and nothing was bought for it" });
    else if (input.breakerOpen === true) declined.push({ key: j.key, family: j.family, calls: price, reason: "the provider's own credit is spent, so this pass funded nothing" });
    else if (slots <= 0) declined.push({ key: j.key, family: j.family, calls: price, reason: `the pass funds ${Math.max(0, input.candidates)} candidates and stronger work filled them` });
    else if (price > callsLeft) declined.push({ key: j.key, family: j.family, calls: price, reason: `this needs ${price} charged calls and ${callsLeft} were left` });
    else { funded.set(j.key, price); slots -= 1; callsLeft -= price; }
  }
  const held = new Map<string, { left: number }>();
  const resolveKey = (key: string): string => {
    if (funded.has(key)) return key;
    if (alias.has(key) && funded.has(alias.get(key)!)) return alias.get(key)!;
    if (key.includes("::")) { const page = key.slice(0, key.indexOf("::")); if (funded.has(page)) return page; }
    return key;
  };
  /** WHAT EACH PAGE ACTUALLY CONSUMED, kept BY THE MONEY SURFACE ITSELF (Codex, 2026-08-23). It used to be a
   *  separate map the caller handed to one family, so five of the six families spent real dollars that no
   *  receipt could name. Every family already draws its allowance here, so this is the one place that sees
   *  them all: `ops` counts logical operations, `providerCalls` counts requests the gateway says actually left
   *  the process, and `costUsd` is the provider's own receipt. None of it is ever inferred. */
  const spend = new Map<string, { ops: number; providerCalls: number; costUsd: number }>();
  const recordOn = (key: string, r: unknown): void => {
    if (!r) return;
    const rec = spend.get(key) ?? { ops: 0, providerCalls: 0, costUsd: 0 };
    const x = r as { status?: string; cached?: boolean; costUsd?: number; attempts?: number };
    rec.ops += 1;
    if (!(x.status === "off" || x.status === "blocked_budget" || x.cached === true)) {
      rec.providerCalls += Math.max(0, Math.round(x.attempts ?? 0)); rec.costUsd += x.costUsd ?? 0;
    }
    spend.set(key, rec);
  };
  return {
    /** The charged calls the plan left unfunded: money this pass decided not to commit, not money it has yet to spend. */
    calls: { left: callsLeft },
    /** EVERY candidate this pass COULD WORK ON, funded or not, best first. It is what says whether a manifest is FINISHED: a pass that funded two of nine has seven candidates left, and calling that exhausted is how a day closed on two failures (Codex, 2026-08-22). A BLOCKED job is not on it (Codex, 2026-08-23): it can never be funded, so it can never settle, and leaving it here made "every declared candidate is settled" unreachable for any account with one page under measurement, which held the day open and re-drove it on every visit. Blocked work is named in `declined`, with its reason. */
    declared: ranked.filter((j) => !j.blocked).map((j) => j.key),
    /** The funded set, best first, as the pass's own receipt of what it decided to buy before it bought anything. */
    funded: ranked.filter((j) => funded.has(j.key)).map((j) => ({ key: j.key, family: j.family, calls: funded.get(j.key)!, impact: j.impact, fallbacks: j.fallbacks ?? [], ...(j.treatment ? { treatment: j.treatment } : {}), ...(j.workKey ? { workKey: j.workKey } : {}) })),
    declined: declined as readonly DeclinedJob[],
    /** COLLECT THE PAGE'S ALLOWANCE. An unfunded key gets null, and so does an UNKNOWN one: a family that never declared its job on the manifest cannot spend, whenever it asks. One allowance per page, handed out once. NO COUNT OF LANDED WORK EVER CLOSES THIS DOOR: the walk runs the whole funded manifest however many rows have already landed (operator, 2026-08-30). */
    take(key: string) {
      // Every shape of the same work resolves to its one funded name first: the alias for a collapsed page job, the
      // page for a job declared before its card existed, so declaration shape can never strand funded money.
      const at = resolveKey(key);
      const open = held.get(at);
      if (open) return open.left > 0 ? open : null;
      const price = funded.get(at);
      if (price == null) return null;
      const slice = { left: price, record: (r: unknown) => recordOn(at, r) };
      held.set(at, slice);
      return slice;
    },
    /** WHAT ONE PAGE SPENT, off the records above: real operations, real requests, real dollars, or null when
     *  nothing was ever drawn for it. Arithmetic the caller can print on a receipt, never a claim. */
    meterOf(key: string) { const m = spend.get(key); return m ? { ops: m.ops, providerCalls: m.providerCalls, costUsd: Number(m.costUsd.toFixed(6)) } : null; },
    /** WHAT ONE FAMILY MAY DRAW FROM THAT PAGE'S ALLOWANCE: a bounded VIEW of it, never a second purse. `price` is what this family's own deliverable costs, so a three-call editor beside a twelve-call rewrite can spend three and only three, and everything it spends comes off the page's one allowance as it spends it. Null when the page was not funded or has nothing left, which is a refusal, not an error. */
    draw(key: string, price: number) {
      const open = this.take(key);
      if (!open || open.left <= 0) return null;
      let cap = Math.max(0, Math.min(Math.round(price), open.left));
      if (cap <= 0) return null;
      const at = resolveKey(key);
      return {
        get left() { return Math.min(cap, open.left); },
        set left(v: number) { const now = Math.min(cap, open.left), spent = now - v; // NEGATIVE IS A REFUND, and it must actually land: a cache hit reached no provider, and clamping the give-back at zero let twelve cached refusals eat a pass (Codex, 2026-08-23, proved by execution)
          if (spent >= 0) { open.left -= spent; cap = Math.max(0, cap - spent); } else { const back = Math.min(-spent, price - cap); open.left += back; cap += back; } },
        /** ONE completed provider result, onto this page's own record. Every family calls it where its result
         *  comes back, so the receipt reports what the pass really did rather than what it was allowed to do. */
        record: (r: unknown) => recordOn(at, r),
      };
    },
    /** The one funded name this key answers to: itself, its alias target, or its page's funded entry. Receipts and filings resolve through this so a branch that knows the work by another shape still lands its record on the funded row. */
    resolve: resolveKey,
    /** WHAT WAS ACTUALLY SPENT, off the allowances themselves: arithmetic, never a claim. */
    spent() {
      let used = 0; for (const [k, slice] of held) used += (funded.get(k) ?? 0) - Math.max(0, slice.left);
      return { calls: used, candidates: held.size, funded: funded.size, declined: declined.length };
    },
  };
}

/** THE MONEY SURFACE, as one export: the ceilings, the prices, the plan and the key every family agrees on. */
/** THE FOUR REASONS THAT MAY KILL FINISHED WORK (Codex, 2026-08-23): an unsupported fact or figure, the wrong page, a placeholder, and a placement that does not exist. Everything else is a note on a REVIEW draft: a soft rule that discards a complete answer turns one imperfect word into zero output, which is how the live /funny-farsi-phrases answer was destroyed back to its own brief over the single word "Farsi". */
const HARD_REFUSAL = /not on the stored page|is not the one this page carries|page this evidence is not about|blank or still carries a placeholder|not attached to it|no such thing|mentions them|names evidence that is not on file|no claim anybody could check|names no evidence at all|cannot be identified/;
export const DRAFT_BUDGET = { MAX_PAID_CALLS, DELIVERABLE_CALLS: PER_DELIVERABLE_CALLS, RETRIES: EDITOR_RETRIES, POLICY, HARD_REFUSAL,
  BUNDLE_CALLS: BUNDLE_CALLS_TOTAL, plan, keyOf } as const;
