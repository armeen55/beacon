/** decision/rank-proposals: THE ONE ranking, across every kind of change this kernel can propose. ONE inspectable score built from bounded factors, each naming the input it read: CORRECTNESS IS THE ADMISSION TICKET AND NEVER A SCORE. A 250-wide lifecycle band used to sit on top of every other factor put together, so being safe to paste outweighed everything riding on the change and a description on a page shown three times ranked beside a page bleeding 152 clicks. Whether a change may be shown at all is settled BEFORE this file (completeness's deliverable gaps and the authorization verdict); what is left here is worth, and worth is what the order is built from. visibility     the clicks the diagnosis proved are recoverable, or the page's own 90-day views at a THIRD of the ceiling when those are bigger, named as an audience and never as a recovery: a defect card carries no click figure at all, and without this the order collapsed onto effort alone and a page shown twice outranked a rebuild of one shown thirty thousand times. evidence       how much receipt there is to show. causeFit       does the lever address the cause the evidence NAMED. A mismatch is discounted the same amount a match earns AND forfeits the proven recovery above, because that recovery belongs to the cause and not to the page, so a wrong lever can never win on size alone. strategic      how many of the questions customers actually ask are in scope. effort         a one minute paste beats an hour of writing when everything else is equal, and only then. risk           a change that moves or hides a page is discounted, never promoted. overlap        a page already carrying a change under measurement is discounted hard. confounding    several changes landing on the same page in one batch discount each other. history        what this KIND of change has actually done on this site, off finished readings only, shrunk hard towards nothing: THE KIND OF CHANGE NEVER DECIDES THE ORDER, the expected traffic does. NO INVENTED NUMBERS: with no proven figure the receipt is marked directional and says the order is a direction, not a size. Every ranked proposal carries `rankingReceipt`, and every one but the last carries `whyRankedAboveNext`. PURE, no I/O, deterministic and stable (equal scores keep input order). */

import type { ChangeProposal } from "./contracts";
import { dangerousComponents } from "./contracts";
import { actionFamilyOf } from "@/domains/measurement/proof-gsc/change-family";
import type { CauseFinding } from "./diagnosis";
import { topicTokens } from "@/domains/evidence/relevance-gate";
// THE TRUTH TABLE LIVES WHERE THE BOUNDARY LIVES. This ranking discounts a lever that cannot treat the cause the evidence named; decision/authorization REFUSES one. One table, read twice, never restated.
import { CAUSE_LEVERS, withholdReason } from "./authorization";

/** WHAT ONE KIND OF CHANGE HAS ACTUALLY DONE ON THIS SITE, off the finished readings in its own ledger.
 *  A family only votes once enough of its readings have finished; under that it is noise wearing a number. */
const MIN_FINISHED_READINGS = 3;
type FamilyHistory = ReadonlyMap<string, { readings: number; netLift: number }>;

/** THE ONE SCORING CONTEXT A DRIVE HOLDS, read by every number this file produces: what this account's own closed readings say (`familyHistory`), which pages already carry a change under measurement, and `batch`, every change the decision is being made among, so "how many others land on this page" is one count over one population instead of a number each caller works out for itself. Funding used to pass none of it while the displayed queue passed all of it, so one row answered to two authorities. Every field is optional and absent means what it has always meant: nothing learned, nothing measuring, nothing else on the page. */
type Scoring = { measuringPagePaths?: readonly (string | null)[]; familyHistory?: FamilyHistory; batch?: readonly ChangeProposal[]; /** WHAT THIS ACCOUNT SAID IT IS WORKING TOWARDS, in the operator's own words and only where the operator actually stated them (R2 residual 1, 2026-09-05). It is an INPUT of the ranking, not an attribute of a row, so it rides this context exactly as the learning and the batch do: one string per pass instead of a copy stamped on every row, no store write and no new field on any business record. Absent asks nothing of any card. */ accountGoal?: string };
/** WHAT COUNTS AS ONE PAGE FOR NEIGHBOURS: the address, or the search a page that does not exist yet would answer. Spelled ONCE, so the money and the queue can never key the same page two ways. A change is one of the changes on its own page, so the count of the page always loses one: a job standing in for a page's work is counted the same way as a row on it. */
const pageKeyOf = (p: ChangeProposal): string => p.pagePath ?? `new::${p.primaryQuery.trim().toLowerCase()}`;
const countPeers = (batch: readonly ChangeProposal[]): Map<string, number> => { const m = new Map<string, number>(); for (const p of batch) m.set(pageKeyOf(p), (m.get(pageKeyOf(p)) ?? 0) + 1); return m; };
const measuredIn = (p: ChangeProposal, ctx: Scoring): boolean => !!p.pagePath && (ctx.measuringPagePaths ?? []).includes(p.pagePath);

/** The cause ladder's own vocabulary. Read from there, never re-declared here. */
type Cause = CauseFinding["cause"];

type Receipt = NonNullable<ChangeProposal["rankingReceipt"]>;
type Factor = Receipt["factors"][number];

/** Bounded ceilings, one per factor. A factor may never contribute more than its max. WHAT IS RIDING ON THE CHANGE DECIDES THE ORDER. Visibility used to top out at 40 and effort at 10, which put the whole queue inside a 51 point band and let a one minute errand on a page shown twice cancel the audience of a page shown thirty thousand times. Visibility now reaches 120 and effort 4: how long the work takes is a tiebreak between two changes worth the same, never a reason to do the smaller one first. NOTHING HERE SCORES BEING CORRECT: every factor is a size, a confidence or a cost, so the biggest number on the screen is always the change with the most riding on it. */
const MAX = { visibility: 120 } as const;
/** HOW FAR EACH FACTOR MAY DISCOUNT what is riding on a change, and none of them may ADD to it. These were
 *  additive ceilings, which put 66 points of promotion within reach of a card carrying no traffic at all. */
const FLOOR = { evidence: 0.85, causeFit: 0.6, strategic: 0.9, effort: 0.75, risk: 0.6, overlap: 0.5, confounding: 0.7, history: 0.9 } as const; // `strategic` carries TWO facts since 2026-09-05, the tracked questions in scope and the account's own stated goal, so its ceiling is the two five-percent arms it composes rather than the one it used to hold; a card missing only one of them is discounted exactly as much as it always was.
/** How many readings it takes before a family's record pulls its full (small) weight. High on purpose: the account holds twelve settled readings in total, so nothing here may speak with confidence yet. */
const HISTORY_SHRINK = 12;
/** HOW FAR A MEASURED SHORTFALL IS DISCOUNTED BEFORE IT ORDERS THE QUEUE. THESE ARE POLICY PRIORS AND NOT MEASUREMENTS (operator, 2026-08-27), which is why nothing built from them is ever called expected clicks: a prior multiplied by a real number produces a PRIORITY, not a forecast, and printing it as a forecast makes invented certainty look empirical. What separates the two values is whether the cause is diagnosed and the lever treats it, never what family the change belongs to. They become measurements only when this account's own finished readings can calibrate them at `CALIBRATION_MIN` samples, and until then the receipt says "assumed" out loud and names the sample it does not have. */
const COLLECTS = { diagnosed: 0.5, undiagnosed: 0.2 } as const;
/** Finished readings of one kind of change before this account's own record may set the discount instead of the
 *  prior above. Twelve settled readings exist in total across every family, so today nothing reaches it. */
const CALIBRATION_MIN = 20;
/** How far an UNMEASURED proxy (a page's impressions, or how often assistants answered) may reach. Measured
 *  clicks reach MAX.visibility; a proxy has to stay under what materially sized measured work earns, or the
 *  proxy decides the queue. */
const DIRECTIONAL_MAX = 4;
/** What a change carrying NO figure at all is worth before its own discounts, so effort, evidence and risk can
 *  still order those cards against each other. Under the smallest real opportunity (MIN_RECOVERABLE_CLICKS at
 *  the undiagnosed share over PER_POINT), so no amount of being quick can lift one past measured work. */
const ORDERING_FLOOR = 0.2;
/** Discounted clicks per point of the visibility band, so it saturates near 480 over 28 days: about the largest
 *  single opportunity a site of this size can honestly carry, and far above any ordinary card. */
const PER_POINT = 4;
/** Views under the floor are a rounding error and rank nothing; the full third of the ceiling is reached at
 *  the top. Both are AUDIENCE sizes, and no number of them ever reaches what a proven recovery reaches. */
const AUDIENCE_FLOOR = 100, AUDIENCE_FULL = 100_000;

/** Plain-English names for what each cause is about, for the sentence that explains the order. */
const LEVER_WORD: Partial<Record<Cause, string>> = {
  ranking_loss: "the ground this page has lost on a search people still run",
  cannibalization: "two of your own pages splitting one search",
  ctr_snippet: "the line a searcher reads",
  competitor_content_gap: "a subject the winning pages cover and this page does not",
  incomplete_coverage: "what this page leaves out",
  weak_opening: "what the page answers up front",
  serp_shape_shift: "the shape of answer this search now rewards",
  intent_shift: "what people now mean by this search",
  internal_link_weakness: "how your own pages point at this one",
  ai_citation_gap: "why assistants hand this question to somebody else",
  retrieved_not_cited: "why assistants read this page and quote somebody else",
  technical_indexability: "whether this page can be found at all",
};

/** WHAT THIS CHANGE IS WAITING ON BEFORE ANYBODY CAN DO IT, read off the row's own typed next step and named on the receipt at zero cost, exactly as readiness has always cost zero. An operator looking at a card ranked below a smaller one deserves to see that it is waiting on a reading rather than on them, and a queue that shows worth without showing dependencies reads as an order somebody could just work through. */
const DEPENDS: Readonly<Record<string, string>> = { evidence: "a source reading is owed before these words can be written", review: "the words are written and a reading of them against the sources they name is owed", redraft: "these words were faulted here, so a corrective draft is owed", draft: "the exact copy is still owed", sections: "sections of this page are still unwritten", operator: "this one waits on your confirmation", terminal: "this one is settled rather than retried" };
const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => Math.min(1, Math.max(0.05, n));
/** This account's finished readings for THIS change's family, or undefined. Read once so the discount above and the small history factor below can never disagree about the same ledger. */
const seenFor = (history: FamilyHistory | null, p: ChangeProposal): { readings: number; netLift: number } | undefined =>
  history?.get(actionFamilyOf(p.changeFamily));
const num = (n: number): string => Math.round(n).toLocaleString();

/** HOW MUCH RECEIPT THIS ONE CAN SHOW, clamped to its own floor: a tampered `evidenceRefCount` must never
 *  drag a change down through the lifecycle tiers on nothing but a bad number. */
const shownEvidence = (p: ChangeProposal): number =>
  Math.max(0, p.bundle?.receipt.items.length ?? p.evidence.evidenceRefCount);

/** Every factor for ONE proposal, in reading order. `peers` is how many OTHER proposals
 *  in the same batch land on the same page; `measuring` is true when that page already
 *  has a change under measurement. */
function factorsFor(p: ChangeProposal, peers: number, measuring: boolean, history: FamilyHistory | null, accountGoal: string): { factors: Factor[]; directional: boolean } {
  const f: Factor[] = [];
  const add = (name: string, input: string, contribution: number, max: number): void =>
    void f.push({ name, input, contribution: round2(contribution), max });

  // A CARD THE PASS STILL OWES ITS OWN WORK ON IS NOT A DRAFT WAITING ON ANYBODY. Read off the typed fact, so
  // no wording change moves a card on this scale. It costs nothing here: what it is worth is what is below.
  const research = p.researchOnly === true;

  // READINESS IS A LABEL, NEVER A PENALTY. A flat 45 point fine put every research card, however much was
  // riding on it, behind every finished trifle: a three impression description outranked the 152 click
  // decline this queue exists to surface. What being unfinished honestly costs is CONFIDENCE, so it now
  // discounts the worth MULTIPLICATIVELY inside visibility below: a big opportunity stays big while its
  // copy is owed, a small finished card stays small, and the receipt says so in words. The lane label,
  // not this ranking, is what tells the operator whether there is something to paste today.
  const after = p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.after ?? "" : "";
  const owed = (p.limitations ?? []).some((l) => l.includes("is still owed, and this card is what is owed"));
  const blanks = /\b(NAME|SOUND|NUMBER|YEAR)\b/.test(after);
  add("readiness", research ? "this is research still owed, not an edit waiting on you"
    : DEPENDS[p.obligation?.kind ?? ""] ?? (owed ? "the exact copy is still owed" : blanks ? "the copy carries blanks nobody has filled" : "its exact words are written"), 0, 0);

  // THE RECOVERY BELONGS TO THE CAUSE, NOT TO THE PAGE. Two changes on one page carry the same recoverable
  // click figure, and only the one that works on the cause the evidence NAMED can actually collect it. A
  // lever that touches something else may not ride that number at all: it keeps its audience, which is a
  // size and not a claim. Without this a wrong lever wins the moment the page is big enough, which is the
  // one thing this ranking exists to stop.
  const cause = p.diagnosisCause;
  // A cause I do not recognise (a hand-edited row, or one written under an older ladder) is treated exactly like no cause at all: it matches nothing and it punishes nothing.
  const levers = cause ? CAUSE_LEVERS[cause] : undefined;
  // PROVEN RECOVERY REQUIRES A DIAGNOSED, TREATABLE CAUSE. "The gap is measured and nothing names a cause
  // yet" rode the proven band as "167 clicks proven recoverable" on a card whose own receipt said nothing
  // written on the page fixes it. A recovery belongs to a cause somebody can treat; a gap with no cause, or
  // a cause with no lever, is a MEASURED SHORTFALL and is said as one, at half the proven band's reach.
  const treatable = !!levers && levers.size > 0;
  const addressed = treatable && withholdReason(p, cause) == null;

  const clicks = Number.isFinite(p.impactScore) && p.impactScore != null ? Math.max(0, p.impactScore) : null;
  const demand = Number.isFinite(p.demandImpressions90d) && p.demandImpressions90d != null ? Math.max(0, p.demandImpressions90d) : null;
  const directional = !(addressed && clicks != null && clicks > 0); // a size is not a proven recovery: an undiagnosed shortfall still ranks, and still says the order is a direction
  // ONE HORIZON, ONE QUESTION: how many more organic clicks over the NEXT 28 DAYS. `impactScore` is the 28-day-equivalent SHORTFALL the evidence measured (normalised once, at `evidence/demand-units`, because `opportunities` used to take Math.max of a 90-day shortfall and a 28-day fall and record no unit at all, so a card's own sentence could name a different span from its own number). What a change is WORTH is that shortfall times the chance THIS change collects it, and that chance is stated rather than assumed: a diagnosed cause with a lever that treats it collects more often than a shortfall nobody has explained. A midpoint `upsidePerMonth` band sat here too and was unreachable: no producer in this kernel has ever set the field, so it ranked nothing and is deleted rather than left to look like a rule. A WRONG LEVER FORFEITS THE RECOVERY ENTIRELY, and always has: where the cause IS treatable and this change does not treat it, the shortfall belongs to the cause and not to the page, so it rides nothing here.
  const sized = clicks != null && clicks > 0 && (addressed || !treatable);
  // WHAT IS MEASURED AND WHAT IS ASSUMED, SAID SEPARATELY. The shortfall is measured; the share of it this change
  // collects is a policy prior until this account has finished readings enough to calibrate it, so the sentence
  // reports the measured figure FIRST, then the assumption by name, and calls the product a priority and never a
  // forecast. A family's own record replaces the prior only past CALIBRATION_MIN readings, and says so when it does.
  const record = seenFor(history, p), calibrated = record != null && record.readings >= CALIBRATION_MIN;
  const share = !sized ? 0 : calibrated ? clamp01(record!.netLift / Math.max(1, record!.readings) / 100 + 0.5)
    : addressed ? COLLECTS.diagnosed : COLLECTS.undiagnosed;
  const priority = !sized ? null : Math.round(clicks! * share);
  const basis = calibrated ? `a ${Math.round(share * 100)} percent share measured across ${num(record!.readings)} readings of this kind of change here, each closed at 14 days or later`
    : `an assumed ${Math.round(share * 100)} percent share, which is this product's policy and not a figure measured here`;
  const proven = priority == null ? null : addressed
    ? { input: `${num(clicks!)} clicks over 28 days measured as recoverable and the cause diagnosed, so ${num(priority)} is what it is ranked on: ${basis}`,
      value: Math.min(MAX.visibility, priority / PER_POINT) }
    : { input: `${num(clicks!)} clicks over 28 days of measured shortfall with no cause diagnosed yet, so ${num(priority)} is what it is ranked on: ${basis}`,
      value: Math.min(MAX.visibility / 2, priority / PER_POINT) };
  // THE AUDIENCE. A card minted off a defect carries no recoverable click figure at all, so the order collapsed onto how long the work takes and a page shown twice outranked a rebuild of a page shown thirty thousand times. Views are not a recovery, so they earn a THIRD of the ceiling, nothing at all under AUDIENCE_FLOOR, and the whole third only at AUDIENCE_FULL, while a proven recovery can reach three times higher. WHICHEVER IS BIGGER IS WHAT IS RIDING ON THE CHANGE, and the receipt names both. A PAGE'S TRAFFIC IS NOT THIS CHANGE'S TRAFFIC. The queue orders on expected Google gain and expected AI gain; a change whose own cause claims neither may stay visible and may not ride the page's impressions to the top (Codex, 2026-08-18: an accuracy correction led on 56,804 impressions it does not address).
  const claimsAudience = (p.causeFinding?.cause ?? p.diagnosisCause) !== "factual_error";
  const audience = claimsAudience && demand != null && demand > AUDIENCE_FLOOR
    ? { input: `shown ${num(demand)} times in 90 days, an audience size rather than a proven recovery`,
      value: (MAX.visibility / 3) * Math.min(1, Math.log10(demand / AUDIENCE_FLOOR) / Math.log10(AUDIENCE_FULL / AUDIENCE_FLOOR)) }
    : null;
  // A MEASURED FIGURE IS WHAT THE CHANGE RIDES, AND THE PAGE'S AUDIENCE IS A FALLBACK, NEVER AN UPGRADE. This
  // took whichever number was BIGGER, so a change carrying its own measured recovery was scored on its page's
  // impressions instead: live, a title change with 98 clicks a month of measured shortfall rode 16,493
  // impressions for 29.56 points where its own measured figure was worth 4.9. That is the comment three lines
  // above ("a page's traffic is not this change's traffic") contradicted by the next statement.
  const google = proven ?? audience;
  // THE AI SIDE RANKS IN ITS OWN UNITS, ON RECURRENCE AND STAGE, NEVER ON ROW TOTALS. Answers-times-two let a
  // question asked once across many engines outrank a question asked every day for a week (operator,
  // 2026-08-19). The band fills on distinct days and assistants over the stored window; the stage scales it,
  // because a page already read and passed over is closer to the citation than a page no engine reaches; the
  // reporting answers only break ties inside that. The receipt says the same thing in the same words. It rides
  // only where the Google numbers are not already carrying more, bounded under the audience band, never clicks.
  const ai = p.aiImpact && p.aiImpact.answers > 0
    ? (() => {
      const a = p.aiImpact!;
      const days = Math.max(1, a.days ?? 1), engines = Math.max(1, a.engines ?? 1);
      const spread = Math.min(1, 0.6 * (days / 7) + 0.4 * (engines / 4));
      const closeness = a.stage === "owned_retrieved_not_cited" ? 1 : a.stage === "owned_mentioned_not_cited" ? 0.85 : a.stage === "own_not_in_reported_sources" ? 0.75 : 0.7;
      const standing = a.stage === "owned_retrieved_not_cited" ? "while this page is already read and passed over"
        : a.stage === "owned_mentioned_not_cited" ? "while the brand is named in prose and never credited"
          : a.stage === "own_not_in_reported_sources" ? "while this site is not among the sources they relied on" : "and never this one";
      // A CARD MADE FROM A SEARCH THE ASSISTANTS RAN IS NOT "A QUESTION" ON THIS RECEIPT. It came from the
      // assistants' own follow-up searching behind several tracked questions, and calling that a question
      // read as though somebody had approved watching it, which nobody did.
      const asked = (p.aiScope?.fanoutKey ?? "").length > 0 ? "a search the assistants ran themselves" : "this question";
      return { input: `asked on ${num(days)} ${days === 1 ? "day" : "days"} across ${num(engines)} ${engines === 1 ? "assistant" : "assistants"}, ${num(a.answers)} stored answers hand ${asked} to ${num(a.citedRivals)} rival ${a.citedRivals === 1 ? "site" : "sites"} ${standing}`,
        value: (MAX.visibility / 3) * spread * closeness * Math.min(1, a.answers / 5) };
    })() : null;
  // AI EVIDENCE IS EVIDENCE, NEVER A TRAFFIC FIGURE. Taking whichever band was bigger let recurrence and stage,
  // which are counts of answers, outrank a measured click recovery. It rides only where there is no Google
  // figure at all, and then as a direction rather than a size.
  // A PROXY NEVER BEATS A MEASURED FIGURE, BUT PROXIES MAY COMPETE WITH EACH OTHER. Preferring Google outright
  // meant a page WITH an audience could never count its AI evidence at all, so an AEO card on a page shown
  // 90,000 times ranked level with one on a page shown none.
  const proxy = ai && (!google || ai.value > google.value) ? ai : google;
  const rode = proven ?? proxy;
  // AND AN UNMEASURED PROXY MAY NOT OUTRANK MATERIALLY SIZED MEASURED WORK. Impressions and answer counts are both proxies: at a third of the ceiling each was worth 40 points, which is 160 discounted clicks at PER_POINT, so no measured recovery this account can produce could ever catch one. Capped at DIRECTIONAL_MAX so proxies still order each other and always sit under real measured work. SCALED, NEVER CLAMPED. Clamping flattened every proxy onto the ceiling, so recurrence and stage stopped ordering AEO cards against each other at all (a question asked once ranked level with one asked every day for a week). The band keeps its whole shape and is rescaled into the directional range, so proxies order each other exactly as before and simply cannot reach measured work.
  const ridden = rode && rode !== proven
    ? { ...rode, value: rode.value * (DIRECTIONAL_MAX / (MAX.visibility / 3)) } : rode;
  // WHAT IS RIDING ON IT, HELD AT THE CONFIDENCE IT HAS EARNED. Unfinished copy and a low reading each
  // shave the worth by a factor and never by a flat fine, so the order stays "largest credible impact
  // first": a page big enough leads even while its words are owed, and the receipt names the discount.
  const unfinished = research || owed || blanks;
  const held = (unfinished ? 0.7 : 1) * (p.confidence === "high" ? 1 : p.confidence === "medium" ? 0.85 : 0.7);
  const why = [unfinished ? "the copy is still owed" : null, p.confidence !== "high" ? `confidence is ${p.confidence}` : null]
    .filter(Boolean).join(" and ");
  const shown = ridden && held < 1
    ? { input: `${ridden.input}, counted at ${Math.round(held * 100)} percent because ${why}`, value: ridden.value * held }
    : ridden;
  // A CARD WITH NO FIGURE AT ALL STILL HAS TO BE ORDERED. Multiplying nothing leaves nothing, so eleven of the
  // account's thirty seven live rows scored exactly 0.00 with every factor reporting it had cost 0 of a
  // possible 0, and a one minute paste tied with an hour of new-page work under "start with whichever suits
  // your day". They get a floor to be discounted FROM, small enough that the smallest opportunity this queue
  // will carry (MIN_RECOVERABLE_CLICKS at the undiagnosed share) still outranks every one of them.
  const base = shown?.value ?? ORDERING_FLOOR;
  add("visibility", shown?.input
    ?? (claimsAudience ? "no proven figure for what this wins back, so this sits below anything that has one"
      : "an accuracy fix with no traffic or citation gain claimed for it, so it is ordered below work that has one"),
    base, MAX.visibility);

  // NOTHING BUT TRAFFIC MAY ADD TO WORTH. Every factor below used to be a flat number added to the score, so 66 points were reachable without any traffic at all (evidence 15, causeFit 25, strategic 10, effort 4, history 12) while a measured 98 clicks a month earned 4.9. That is the `treatment` defect in another costume: an attribute of the CHANGE deciding an order that is supposed to be built from expected visitors. This file's own header already said the rule ("shave the worth by a factor and never by a flat fine") and then broke it. Each factor now DISCOUNTS what is riding on the change, and reports the points that discount cost, so the receipt still adds up to the score and every reason stays visible. A discount can never exceed 1.
  let running = base;
  // `max` is THE MOST THIS DISCOUNT COULD HAVE COST on this card, so a factor's contribution still cannot
  // exceed its own ceiling and the receipt can say "of the N points this could have taken, it took M".
  const discount = (name: keyof typeof FLOOR, input: string, factor: number): void => {
    const ceiling = running * (1 - FLOOR[name]);
    const cost = running * (1 - Math.min(1, Math.max(FLOOR[name], factor)));
    running -= cost;
    add(name, input, -cost, round2(ceiling));
  };

  // EVIDENCE QUANTITY IS CONFIDENCE, NOT IMPACT (Codex, 2026-08-18). A correction bundle carrying forty sourced
  // items outranked a supported traffic recovery on receipt volume alone, which optimises for how much a card
  // can SHOW rather than what it is worth. So it buys nothing and its absence costs a little.
  const items = shownEvidence(p);
  discount("evidence", `${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence behind it, which is how sure this is rather than how big it is`,
    0.85 + 0.15 * Math.min(1, Math.log10(1 + items) / Math.log10(11)));

  // A LEVER THAT TREATS THE NAMED CAUSE IS PAID ONCE, INSIDE VISIBILITY, where a diagnosed cause already moves
  // the collection share from a fifth to a half and a wrong lever already forfeits the whole recovery. The flat
  // 25 here was a second payment for the same fact, and it was the single biggest reason a 30 minute hypothesis
  // led a 2 minute measured recovery in the live queue.
  discount("causeFit", !cause ? "no cause named for this change yet"
    : !levers || levers.size === 0 ? "nothing you can write on the page fixes the cause named here"
      : addressed ? `this change works on ${LEVER_WORD[cause] ?? "the cause named here"}`
        : `this change does not touch ${LEVER_WORD[cause] ?? "the cause named here"}`,
  !cause || !levers || levers.size === 0 || addressed ? 1 : 0.6);

  // A CARD BORN FROM A TRACKED QUESTION IS IN SCOPE OF THAT QUESTION. That is demand evidence, and demand
  // already enters through the figure above, so being in scope buys nothing and being out of it costs a little.
  const prompts = p.bundle?.scope.prompts.length ?? (p.aiImpact && p.aiImpact.answers > 0 ? 1 : 0);
  // AND BUSINESS RELEVANCE FROM WHAT THIS ACCOUNT SAID IT IS WORKING TOWARDS (R2 residual 1, 2026-09-05): a tracked question is what a reader asks, and the stated goal is what the business is for, and until now nothing in the order knew the difference between a change on a subject the operator named and one on a page that happens to have traffic. A TOKEN OVERLAP and nothing else: no word list, no language and no page family, so it reads the same on every account, and an account that stated no goal gets a factor of one. It DISCOUNTS and never adds, like every factor beside it.
  const wanted = topicTokens(accountGoal), about = new Set<string>(topicTokens(`${p.pagePath ?? p.pageUrl ?? ""} ${p.primaryQuery ?? ""} ${p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.after ?? "" : ""}`)), serves = wanted.length === 0 ? null : wanted.some((w: string) => about.has(w));
  discount("strategic", `${prompts > 0 ? `${num(prompts)} ${prompts === 1 ? "question" : "questions"} your customers actually ask are in scope` : "none of the questions your customers ask cover this one"}${serves === true ? ", and it works towards what this account said it is for" : serves === false ? ", and nothing in it touches what this account said it is for" : ""}`,
  (prompts > 0 ? 1 : 0.95) * (serves === false ? 0.95 : 1));

  const minutes = Math.max(0, p.estimatedEffortMinutes);
  discount("effort", `about ${num(minutes)} ${minutes === 1 ? "minute" : "minutes"} of your time`,
    1 - Math.min(0.25, minutes / 240));

  const danger = dangerousComponents(p.bundle?.components ?? []);
  const risky = danger.length > 0 || p.riskLevel === "high";
  discount("risk", risky ? "this one moves or hides a page, so it is held for your confirmation"
    : research ? "nothing here goes onto the site, so there is nothing to risk yet"
      : p.riskLevel === "medium" ? "this one touches claims worth reading twice" : "this one is safe to paste",
  risky ? 0.6 : p.riskLevel === "medium" ? 0.85 : 1);

  // RECORDED, NEVER A DISCOUNT (operator ruling, 2026-08-29): unlimited changes may overlap on a page, so
  // measurement is context Results reads for its claims, and a card loses no rank for standing beside one.
  discount("overlap", measuring ? "this page already has a change under measurement, noted for the reading" : "nothing is being measured on this page", 1);

  discount("confounding", peers > 0
    ? `${num(peers)} other ${peers === 1 ? "change" : "changes"} in this batch ${peers === 1 ? "lands" : "land"} on the same page`
    : "nothing else in this batch lands on the same page",
  1 - Math.min(0.3, peers * 0.1));

  // WHAT THIS KIND OF CHANGE HAS ALREADY DONE HERE. Two changes of equal worth are not equal bets when one
  // family is three readings deep and down on every one of them. A READING IS CLOSED AT 14 DAYS AND A WIN IS STILL ONLY CALLED AT 28 (2026-09-03), so this receipt says closed and never finished: Results files the same reading as an early one, and two surfaces calling one number by two names is how a queue starts contradicting itself. Only closed readings vote, and never enough
  // to invert an order: a family with a bad run is ranked lower, never refused, and a good run buys nothing,
  // because THE KIND OF CHANGE NEVER DECIDES, THE EXPECTED TRAFFIC DOES (operator, 2026-08-26). A `treatment`
  // factor sat here paying +45 to "substantive" families and -45 to metadata ones, a ninety point swing keyed
  // on a regex over `changeFamily`, read off four losses and one win. Deleted outright rather than shrunk.
  const fam = actionFamilyOf(p.changeFamily);
  const seen = ridden ? history?.get(fam) : undefined;
  const votes = seen && seen.readings >= MIN_FINISHED_READINGS;
  const pull = votes && seen!.netLift < 0 ? (seen!.readings / (seen!.readings + HISTORY_SHRINK)) : 0;
  discount("history", !ridden ? "too little of an audience on this page for what this kind of change has done elsewhere to mean anything here"
    : !votes ? "too few readings of this kind of change have closed here to judge it"
    : `this kind of change is ${num(Math.abs(seen!.netLift))} clicks ${seen!.netLift > 0 ? "up" : "down"} across ${num(seen!.readings)} readings here, each closed at 14 days or later, which is too few to weigh heavily`,
  1 - pull * 0.1);

  return { factors: f, directional };
}

function receiptFor(p: ChangeProposal, peers: number, measuring: boolean, history: FamilyHistory | null = null, accountGoal = ""): Receipt {
  const { factors, directional } = factorsFor(p, peers, measuring, history, accountGoal);
  const score = round2(factors.reduce((a, x) => a + x.contribution, 0));
  const items = shownEvidence(p);
  // "DIRECTIONAL" COVERS TWO DIFFERENT SITUATIONS AND ONLY ONE OF THEM HAS NO NUMBER. A card carrying a measured
  // shortfall with no cause diagnosed yet is directional, and this told the operator "No click figure backs this
  // one" directly under a factor reading "80 clicks over 28 days of measured shortfall". The card contradicted
  // itself. What is missing there is the CAUSE, not the figure, so it says that instead.
  const measured = Math.max(0, p.impactScore ?? 0);
  const evidenced = `${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence and what it takes you to do`;
  const basis = !directional
    ? `Ranked on a discounted traffic priority, not a forecast: ${num(measured)} clicks over 28 days measured as recoverable, discounted by an assumed share, ${evidenced}.`
    : measured > 0
      ? `${num(measured)} clicks over 28 days are measured as missing here and nothing has named the cause yet, so this is the order to work in, not a promise about size. Ranked on that, ${evidenced}.`
      : `No click figure backs this one, so this is the order to work in, not a promise about size. Ranked on ${evidenced}.`;
  return { score, factors, directional, basis };
}

/** THE SCALAR THE ORDER IS BUILT FROM, and the same one the money is spent on. `ctx` is the drive's ONE scoring context (below), so the buy order, the walk order, the queue order and the sentence under the card are one answer: funding read none of it and disagreed with the displayed order on 29 of 66 live positions, one card worth 2.15 to the funder and 71.26 to the operator. Absent means a proposal read entirely on its own, which is what a caller inspecting one card gets. */
export function proposalValueScore(p: ChangeProposal, ctx: Scoring = {}): number { return receiptFor(p, Math.max(0, (countPeers(ctx.batch ?? []).get(pageKeyOf(p)) ?? 1) - 1), measuredIn(p, ctx), ctx.familyHistory ?? null, ctx.accountGoal ?? "").score; }

/** The factor that actually separated two neighbours: the biggest contribution gap. */
function separator(a: Receipt, b: Receipt): { name: string; a: Factor; b: Factor } | null {
  let best: { name: string; a: Factor; b: Factor; delta: number } | null = null;
  for (const fa of a.factors) {
    const fb = b.factors.find((x) => x.name === fa.name);
    if (!fb) continue;
    const delta = fa.contribution - fb.contribution;
    if (delta > 0.01 && (!best || delta > best.delta)) best = { name: fa.name, a: fa, b: fb, delta };
  }
  return best ? { name: best.name, a: best.a, b: best.b } : null;
}

/** One plain sentence comparing a proposal to the one directly below it. TWO FACTORS CAN NEVER APPEAR HERE and their branches are deleted rather than left to look like rules: `readiness` is a label added at a flat zero, and `overlap` is recorded and never discounted (operator, 2026-08-29), so both contribute exactly the same to every card and `separator` needs a gap above 0.01. */
function whyAbove(next: ChangeProposal, a: Receipt, b: Receipt): string {
  const other = `the change for "${next.primaryQuery}"`;
  const sep = separator(a, b);
  if (!sep) return `Ranked level with ${other}, so start with whichever suits your day.`;
  const lead = `Ranked ahead of ${other} because`;
  switch (sep.name) {
    case "visibility":
      return `${lead} more is riding on it: ${sep.a.input}, against ${sep.b.input}.`;
    case "evidence":
      return `${lead} there is more to show for it: ${sep.a.input} against ${sep.b.input}.`;
    case "causeFit":
      // A CARD WITH NO CAUSE NAMED still separates from one whose lever misses its cause, and reading the winner's own input aloud printed "because no cause named for this change yet, and X does not" on the top card.
      return sep.a.contribution >= 0 ? `${lead} ${sep.a.input}, and ${other} does not.`
        : `${lead} ${other} works on something other than the cause its own evidence names.`;
    case "strategic":
      return `${lead} it covers more of what people ask you: ${sep.a.input} against ${sep.b.input}.`;
    case "effort":
      return `${lead} it is quicker for you: ${sep.a.input} against ${sep.b.input}.`;
    case "risk":
      return `${lead} ${sep.a.input}, while ${sep.b.input}.`;
    case "history":
      return `${lead} ${sep.a.input}, while ${sep.b.input}.`;
    default:
      return `${lead} fewer other changes of yours land on the same page.`;
  }
}

/**
 * Rank proposals, most valuable first, and stamp each one with the receipt that explains where it landed. It reads the SAME scoring context the funding decision reads,
 * so one row can never be worth two different numbers at once. Stable + deterministic.
 */
export function rankProposals(proposals: readonly ChangeProposal[], ctx: Scoring = {}): ChangeProposal[] {
  const perPage = countPeers(ctx.batch ?? proposals); // the caller's own batch when it holds one for the whole drive, otherwise exactly the proposals handed in
  const scored = proposals.map((p, i) => ({ p, i, receipt: receiptFor(p, Math.max(0, (perPage.get(pageKeyOf(p)) ?? 1) - 1), measuredIn(p, ctx), ctx.familyHistory ?? null, ctx.accountGoal ?? "") }));
  scored.sort((a, b) => (b.receipt.score - a.receipt.score) || (a.i - b.i));
  return scored.map((row, idx) => {
    const next = scored[idx + 1];
    const ranked: ChangeProposal = { ...row.p, rankingReceipt: row.receipt };
    if (next) ranked.whyRankedAboveNext = whyAbove(next.p, row.receipt, next.receipt);
    else delete ranked.whyRankedAboveNext;
    return ranked;
  });
}
