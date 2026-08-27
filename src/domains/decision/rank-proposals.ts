/**
 * decision/rank-proposals: THE ONE ranking, across every kind of change this kernel can propose. ONE inspectable score built from bounded factors, each naming the input it read:
 *
 *   CORRECTNESS IS THE ADMISSION TICKET AND NEVER A SCORE. A 250-wide lifecycle band used to sit on top of
 *   every other factor put together, so being safe to paste outweighed everything riding on the change and a
 *   description on a page shown three times ranked beside a page bleeding 152 clicks. Whether a change may be
 *   shown at all is settled BEFORE this file (completeness's deliverable gaps and the authorization verdict);
 *   what is left here is worth, and worth is what the order is built from.
 *
 *   visibility     the clicks the diagnosis proved are recoverable, or the page's own 90-day views at a THIRD
 *                  of the ceiling when those are bigger, named as an audience and never as a recovery: a
 *                  defect card carries no click figure at all, and without this the order collapsed onto
 *                  effort alone and a page shown twice outranked a rebuild of one shown thirty thousand times.
 *   evidence       how much receipt there is to show.
 *   causeFit       does the lever address the cause the evidence NAMED. A mismatch is discounted the same
 *                  amount a match earns AND forfeits the proven recovery above, because that recovery
 *                  belongs to the cause and not to the page, so a wrong lever can never win on size alone.
 *   strategic      how many of the questions customers actually ask are in scope.
 *   effort         a one minute paste beats an hour of writing when everything else is equal, and only then.
 *   risk           a change that moves or hides a page is discounted, never promoted.
 *   overlap        a page already carrying a change under measurement is discounted hard.
 *   confounding    several changes landing on the same page in one batch discount each other.
 *   history        what this KIND of change has actually done on this site, off finished readings only, shrunk
 *                  hard towards nothing: THE KIND OF CHANGE NEVER DECIDES THE ORDER, the expected traffic does.
 *
 * NO INVENTED NUMBERS: with no proven figure the receipt is marked directional and says the order is a direction, not a size. Every ranked proposal carries `rankingReceipt`, and every one but the last carries
 * `whyRankedAboveNext`. PURE, no I/O, deterministic and stable (equal scores keep input order).
 */

import type { ChangeProposal } from "./contracts";
import { dangerousComponents } from "./contracts";
import { actionFamilyOf } from "@/domains/measurement/proof-gsc/change-family";
import type { CauseFinding } from "./diagnosis";
// THE TRUTH TABLE LIVES WHERE THE BOUNDARY LIVES. This ranking discounts a lever that cannot treat the cause the evidence named; decision/authorization REFUSES one. One table, read twice, never restated.
import { CAUSE_LEVERS, withholdReason } from "./authorization";

/** WHAT ONE KIND OF CHANGE HAS ACTUALLY DONE ON THIS SITE, off the finished readings in its own ledger.
 *  A family only votes once enough of its readings have finished; under that it is noise wearing a number. */
const MIN_FINISHED_READINGS = 3;
type FamilyHistory = ReadonlyMap<string, { readings: number; netLift: number }>;

/** The cause ladder's own vocabulary. Read from there, never re-declared here. */
type Cause = CauseFinding["cause"];

type Receipt = NonNullable<ChangeProposal["rankingReceipt"]>;
type Factor = Receipt["factors"][number];

/**
 * Bounded ceilings, one per factor. A factor may never contribute more than its max.
 *
 * WHAT IS RIDING ON THE CHANGE DECIDES THE ORDER. Visibility used to top out at 40 and effort at 10, which
 * put the whole queue inside a 51 point band and let a one minute errand on a page shown twice cancel the
 * audience of a page shown thirty thousand times. Visibility now reaches 120 and effort 4: how long the
 * work takes is a tiebreak between two changes worth the same, never a reason to do the smaller one first.
 * NOTHING HERE SCORES BEING CORRECT: every factor is a size, a confidence or a cost, so the biggest number
 * on the screen is always the change with the most riding on it.
 */
const MAX = { visibility: 120, evidence: 15, causeFit: 25, strategic: 10, effort: 4, risk: 18, overlap: 30, confounding: 10, history: 12 } as const;
/** How many readings it takes before a family's record pulls its full (small) weight. High on purpose: the account holds twelve settled readings in total, so nothing here may speak with confidence yet. */
const HISTORY_SHRINK = 12;
/** THE CHANCE A CHANGE ACTUALLY COLLECTS THE SHORTFALL IT NAMES. Stated, bounded and the same for every kind of
 *  work: what separates the two is whether the cause is diagnosed and the lever treats it, never what family the
 *  change belongs to. Deliberately conservative, because a measured shortfall is what a page is LOSING and not a
 *  promise of what one edit wins back. */
const COLLECTS = { diagnosed: 0.5, undiagnosed: 0.2 } as const;
/** Expected clicks per point of the visibility band, so it saturates near 480 more clicks over 28 days: about the
 *  largest single opportunity a site of this size can honestly carry, and far above any ordinary card. */
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

const round2 = (n: number): number => Math.round(n * 100) / 100;
const num = (n: number): string => Math.round(n).toLocaleString();

/** HOW MUCH RECEIPT THIS ONE CAN SHOW, clamped to its own floor: a tampered `evidenceRefCount` must never
 *  drag a change down through the lifecycle tiers on nothing but a bad number. */
const shownEvidence = (p: ChangeProposal): number =>
  Math.max(0, p.bundle?.receipt.items.length ?? p.evidence.evidenceRefCount);

/** Every factor for ONE proposal, in reading order. `peers` is how many OTHER proposals
 *  in the same batch land on the same page; `measuring` is true when that page already
 *  has a change under measurement. */
function factorsFor(p: ChangeProposal, peers: number, measuring: boolean, history: FamilyHistory | null): { factors: Factor[]; directional: boolean } {
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
    : owed ? "the exact copy is still owed"
      : blanks ? "the copy carries blanks nobody has filled"
        : "its exact words are written", 0, 0);

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
  // ONE HORIZON, ONE QUESTION: how many more organic clicks over the NEXT 28 DAYS. `impactScore` is the
  // 28-day-equivalent SHORTFALL the evidence measured (normalised once, at `evidence/demand-units`, because
  // `opportunities` used to take Math.max of a 90-day shortfall and a 28-day fall and record no unit at all, so a
  // card's own sentence could name a different span from its own number). What a change is WORTH is that
  // shortfall times the chance THIS change collects it, and that chance is stated rather than assumed: a
  // diagnosed cause with a lever that treats it collects more often than a shortfall nobody has explained.
  // A midpoint `upsidePerMonth` band sat here too and was unreachable: no producer in this kernel has ever set
  // the field, so it ranked nothing and is deleted rather than left to look like a rule.
  // A WRONG LEVER FORFEITS THE RECOVERY ENTIRELY, and always has: where the cause IS treatable and this change
  // does not treat it, the shortfall belongs to the cause and not to the page, so it rides nothing here.
  const sized = clicks != null && clicks > 0 && (addressed || !treatable);
  const expected = !sized ? null : Math.round(clicks! * (addressed ? COLLECTS.diagnosed : COLLECTS.undiagnosed));
  const proven = expected == null ? null : addressed
    ? { input: `about ${num(expected)} more clicks over 28 days, being half of the ${num(clicks!)} this page's own diagnosis names as recoverable`,
      value: Math.min(MAX.visibility, expected / PER_POINT) }
    : { input: `about ${num(expected)} more clicks over 28 days, off ${num(clicks!)} of measured shortfall, cause not yet diagnosed`,
      value: Math.min(MAX.visibility / 2, expected / PER_POINT) };
  // THE AUDIENCE. A card minted off a defect carries no recoverable click figure at all, so the order
  // collapsed onto how long the work takes and a page shown twice outranked a rebuild of a page shown thirty
  // thousand times. Views are not a recovery, so they earn a THIRD of the ceiling, nothing at all under
  // AUDIENCE_FLOOR, and the whole third only at AUDIENCE_FULL, while a proven recovery can reach three
  // times higher. WHICHEVER IS BIGGER IS WHAT IS RIDING ON THE CHANGE, and the receipt names both.
  // A PAGE'S TRAFFIC IS NOT THIS CHANGE'S TRAFFIC. The queue orders on expected Google gain and expected AI
  // gain; a change whose own cause claims neither may stay visible and may not ride the page's impressions
  // to the top (Codex, 2026-08-18: an accuracy correction led on 56,804 impressions it does not address).
  const claimsAudience = (p.causeFinding?.cause ?? p.diagnosisCause) !== "factual_error";
  const audience = claimsAudience && demand != null && demand > AUDIENCE_FLOOR
    ? { input: `shown ${num(demand)} times in 90 days, an audience size rather than a proven recovery`,
      value: (MAX.visibility / 3) * Math.min(1, Math.log10(demand / AUDIENCE_FLOOR) / Math.log10(AUDIENCE_FULL / AUDIENCE_FLOOR)) }
    : null;
  const google = proven && audience && audience.value > proven.value ? { ...audience, input: `${proven.input}, on a page ${audience.input}` } : proven ?? audience;
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
  const rode = ai && (!google || ai.value > google.value) ? ai : google;
  // WHAT IS RIDING ON IT, HELD AT THE CONFIDENCE IT HAS EARNED. Unfinished copy and a low reading each
  // shave the worth by a factor and never by a flat fine, so the order stays "largest credible impact
  // first": a page big enough leads even while its words are owed, and the receipt names the discount.
  const unfinished = research || owed || blanks;
  const held = (unfinished ? 0.7 : 1) * (p.confidence === "high" ? 1 : p.confidence === "medium" ? 0.85 : 0.7);
  const why = [unfinished ? "the copy is still owed" : null, p.confidence !== "high" ? `confidence is ${p.confidence}` : null]
    .filter(Boolean).join(" and ");
  const shown = rode && held < 1
    ? { input: `${rode.input}, counted at ${Math.round(held * 100)} percent because ${why}`, value: rode.value * held }
    : rode;
  add("visibility", shown?.input
    ?? (claimsAudience ? "no proven figure for what this wins back"
      : "an accuracy fix with no traffic or citation gain claimed for it, so it is ordered below work that has one"),
    shown?.value ?? 0, MAX.visibility);

  // EVIDENCE QUANTITY IS CONFIDENCE, NOT IMPACT (Codex, 2026-08-18). A correction bundle carrying forty
  // sourced items outranked a supported traffic recovery on receipt volume alone, which optimises for how
  // much a card can SHOW rather than what it is worth. It is capped hard and reads as confidence, so a
  // thorough card still cannot buy its way past a card with an audience behind it.
  const items = shownEvidence(p);
  add("evidence", `${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence behind it, which is how sure this is rather than how big it is`,
    Math.min(MAX.evidence, Math.log10(1 + items) * 4), MAX.evidence);

  if (!cause) add("causeFit", "no cause named for this change yet", 0, MAX.causeFit);
  else if (!levers || levers.size === 0) add("causeFit", "nothing you can write on the page fixes the cause named here", 0, MAX.causeFit);
  else add("causeFit", addressed ? `this change works on ${LEVER_WORD[cause] ?? "the cause named here"}`
    : `this change does not touch ${LEVER_WORD[cause] ?? "the cause named here"}`, addressed ? MAX.causeFit : -MAX.causeFit, MAX.causeFit);

  // A CARD BORN FROM A TRACKED QUESTION IS IN SCOPE OF THAT QUESTION. The deep bundles carry the joined
  // prompts on their scope; an AI absence card carries the same fact as its stored answers, and reading only
  // the bundle scored the one producer that exists BECAUSE customers ask the question as strategically inert.
  const prompts = p.bundle?.scope.prompts.length ?? (p.aiImpact && p.aiImpact.answers > 0 ? 1 : 0);
  add("strategic", `${num(prompts)} ${prompts === 1 ? "question" : "questions"} your customers actually ask are in scope`, Math.min(MAX.strategic, prompts * 5), MAX.strategic);

  const minutes = Math.max(0, p.estimatedEffortMinutes);
  add("effort", `about ${num(minutes)} ${minutes === 1 ? "minute" : "minutes"} of your time`, Math.max(0, MAX.effort - minutes / 6), MAX.effort);

  const danger = dangerousComponents(p.bundle?.components ?? []);
  const risky = danger.length > 0 || p.riskLevel === "high";
  add("risk", risky ? "this one moves or hides a page, so it is held for your confirmation"
    : research ? "nothing here goes onto the site, so there is nothing to risk yet"
      : p.riskLevel === "medium" ? "this one touches claims worth reading twice" : "this one is safe to paste",
  risky ? -MAX.risk : p.riskLevel === "medium" ? -8 : 0, MAX.risk);

  add("overlap", measuring ? "this page already has a change under measurement" : "nothing is being measured on this page",
    measuring ? -MAX.overlap : 0, MAX.overlap);

  add("confounding", `${num(peers)} other ${peers === 1 ? "change" : "changes"} in this batch land on the same page`,
    -Math.min(MAX.confounding, peers * 5), MAX.confounding);

  // WHAT THIS KIND OF CHANGE HAS ALREADY DONE HERE. Two changes of equal worth are not equal bets when one family is three readings deep and down on every one of them. Only finished readings vote, and never
  // enough of them to cross a lifecycle tier: a family with a bad run is ranked lower, never refused.
  // AND ONLY ON A PAGE THAT COULD SHOW IT. A family 165 clicks up across seven readings says nothing about a
  // page shown 22 times: that page cannot produce those clicks, so the track record was lifting cards with no
  // audience at all over rebuilds of pages shown thirty thousand times. No audience, no vote.
  // THE KIND OF CHANGE NEVER DECIDES, THE EXPECTED TRAFFIC DOES (operator, 2026-08-26). A `treatment` factor
  // sat here paying +45 to "substantive" families and -45 to metadata ones, a NINETY point swing keyed on a
  // regex over `changeFamily`, wider than the whole audience band and worth 2,250 clicks of visibility at
  // `clicks / 25`. It was read off four losses and one win. A 539-click title rewrite ranked BELOW a
  // three-minute answer block on a page shown 300 times, which is category allocation wearing a track record.
  // Deleted outright rather than shrunk: what a family has done belongs in confidence below, never in size.
  const fam = actionFamilyOf(p.changeFamily);
  const seen = rode ? history?.get(fam) : undefined;
  // SHRINK HARD, AND TOWARDS NOTHING. A handful of readings is a hint, not a verdict, so the vote is scaled by
  // `readings / (readings + SHRINK)`: three finished readings move this a quarter of its reach, twenty move it
  // most of the way. The reach itself is small on purpose. This can shade an order; it can never invert one.
  const votes = seen && seen.readings >= MIN_FINISHED_READINGS;
  const pull = votes ? (seen!.readings / (seen!.readings + HISTORY_SHRINK)) * (seen!.netLift > 0 ? 1 : -1) : 0;
  add("history", !rode ? "too little of an audience on this page for what this kind of change has done elsewhere to mean anything here"
    : !votes ? "not enough finished readings of this kind of change here to judge it"
    : `this kind of change is ${num(Math.abs(seen!.netLift))} clicks ${seen!.netLift > 0 ? "up" : "down"} across ${num(seen!.readings)} finished readings here, which is too few to weigh heavily`,
  round2(pull * MAX.history), MAX.history);

  return { factors: f, directional };
}

function receiptFor(p: ChangeProposal, peers: number, measuring: boolean, history: FamilyHistory | null = null): Receipt {
  const { factors, directional } = factorsFor(p, peers, measuring, history);
  const score = round2(factors.reduce((a, x) => a + x.contribution, 0));
  const items = shownEvidence(p);
  const basis = directional
    ? `No click figure backs this one, so this is the order to work in, not a promise about size. Ranked on ${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence and what it takes you to do.`
    : `Ranked on the clicks this could add over the next 28 days, off ${num(Math.max(0, p.impactScore ?? 0))} measured as recoverable, ${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence, and what it takes you to do.`;
  return { score, factors, directional, basis };
}

/** The scalar the order is built from, for ONE proposal read on its own (no batch, so nothing overlaps and nothing confounds). Exposed so a caller can inspect exactly why the order came out as it did. */
export function proposalValueScore(p: ChangeProposal): number { return receiptFor(p, 0, false).score; }

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

/** One plain sentence comparing a proposal to the one directly below it. */
function whyAbove(next: ChangeProposal, a: Receipt, b: Receipt): string {
  const other = `the change for "${next.primaryQuery}"`;
  const sep = separator(a, b);
  if (!sep) return `Ranked level with ${other}, so start with whichever suits your day.`;
  const lead = `Ranked ahead of ${other} because`;
  switch (sep.name) {
    case "readiness":
      return `${lead} its exact words are written and that one's are not.`;
    case "visibility":
      return `${lead} more is riding on it: ${sep.a.input}, against ${sep.b.input}.`;
    case "evidence":
      return `${lead} there is more to show for it: ${sep.a.input} against ${sep.b.input}.`;
    case "causeFit":
      // A CARD WITH NO CAUSE NAMED still separates from one whose lever misses its cause, and reading the winner's own input aloud printed "because no cause named for this change yet, and X does not" on the top card.
      return sep.a.contribution > 0 ? `${lead} ${sep.a.input}, and ${other} does not.`
        : `${lead} ${other} works on something other than the cause its own evidence names.`;
    case "strategic":
      return `${lead} it covers more of what people ask you: ${sep.a.input} against ${sep.b.input}.`;
    case "effort":
      return `${lead} it is quicker for you: ${sep.a.input} against ${sep.b.input}.`;
    case "risk":
      return `${lead} ${sep.a.input}, while ${sep.b.input}.`;
    case "overlap":
      return `${lead} ${next.pagePath ? `${next.pagePath} ` : "that page "}already has a change under measurement, and a second one there would muddy the reading.`;
    case "history":
      return `${lead} ${sep.a.input}, while ${sep.b.input}.`;
    default:
      return `${lead} fewer other changes of yours land on the same page.`;
  }
}

/**
 * Rank proposals, most valuable first, and stamp each one with the receipt that explains where it landed. `measuringPagePaths` are the pages that already carry a change under
 * measurement; a proposal touching one of them is discounted hard. Stable + deterministic.
 */
export function rankProposals(
  proposals: readonly ChangeProposal[],
  ctx: { measuringPagePaths?: readonly (string | null)[];
    /** The finished readings this account already has, by change family. Absent means nothing has finished. */
    familyHistory?: FamilyHistory } = {},
): ChangeProposal[] {
  const measuring = new Set((ctx.measuringPagePaths ?? []).filter((x): x is string => !!x));
  const perPage = new Map<string, number>();
  for (const p of proposals) {
    const key = p.pagePath ?? `new::${p.primaryQuery.trim().toLowerCase()}`;
    perPage.set(key, (perPage.get(key) ?? 0) + 1);
  }
  const scored = proposals.map((p, i) => {
    const key = p.pagePath ?? `new::${p.primaryQuery.trim().toLowerCase()}`;
    return { p, i, receipt: receiptFor(p, Math.max(0, (perPage.get(key) ?? 1) - 1), !!p.pagePath && measuring.has(p.pagePath), ctx.familyHistory ?? null) };
  });
  scored.sort((a, b) => (b.receipt.score - a.receipt.score) || (a.i - b.i));
  return scored.map((row, idx) => {
    const next = scored[idx + 1];
    const ranked: ChangeProposal = { ...row.p, rankingReceipt: row.receipt };
    if (next) ranked.whyRankedAboveNext = whyAbove(next.p, row.receipt, next.receipt);
    else delete ranked.whyRankedAboveNext;
    return ranked;
  });
}
