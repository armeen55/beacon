/**
 * decision/rank-proposals: THE ONE ranking, across every kind of change this kernel can propose. ONE inspectable score built from bounded factors, each naming the input it read:
 *
 *   actionability  the proposal lifecycle. The band is wider than every other factor put together, so no
 *                  amount of size can lift a refused draft over a safe one.
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
 *   history        what this KIND of change has actually done on this site, off finished readings only.
 *
 * NO INVENTED NUMBERS: with no proven figure the receipt is marked directional and says the order is a direction, not a size. Every ranked proposal carries `rankingReceipt`, and every one but the last carries
 * `whyRankedAboveNext`. PURE, no I/O, deterministic and stable (equal scores keep input order).
 */

import type { ChangeProposal, ProposalStatus } from "./contracts";
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

/** The lifecycle band, 250 wide. Content swings +186 at most and -140 at worst, a 326 spread, so the honest
 *  guarantee is NOT that the tiers can never cross: it is that no single factor and no ordinary card can cross
 *  them. Crossing takes a card at both extremes at once, a needs_review row scoring its full +186 against a
 *  ready row taking every discount there is, and that pair is one this ranking is content to order on worth. */
const TIER: Record<ProposalStatus, number> = { ready: 500, implemented_pending_verification: 500, needs_review: 250 };

/**
 * Bounded ceilings, one per factor. A factor may never contribute more than its max.
 *
 * WHAT IS RIDING ON THE CHANGE DECIDES THE ORDER. Visibility used to top out at 40 and effort at 10, which
 * put the whole queue inside a 51 point band and let a one minute errand on a page shown twice cancel the
 * audience of a page shown thirty thousand times. Visibility now reaches 120 and effort 4: how long the
 * work takes is a tiebreak between two changes worth the same, never a reason to do the smaller one first.
 */
const MAX = { actionability: 500, visibility: 120, evidence: 15, causeFit: 25, strategic: 10, effort: 4, risk: 18, overlap: 30, confounding: 10, history: 12 } as const;
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

  const tier = TIER[p.status] ?? 0;
  // A CARD THE PASS STILL OWES ITS OWN WORK ON IS NOT A DRAFT WAITING ON ANYBODY. It keeps its tier, because
  // what is riding on it is real, but the receipt may not call it reviewable or safe to paste: there is nothing
  // to review and nothing to paste. Read off the typed fact, so no wording change moves a card up this scale.
  const research = p.researchOnly === true;
  add("actionability", research ? "this is research still owed, not an edit waiting on you"
    : p.status === "needs_review" ? "this draft is waiting on your review"
      : "this draft passed every safety check", tier, MAX.actionability);

  // A CARD STILL OWED ITS EXACT COPY CANNOT LEAD. "Write a description" is an errand, not an edit: while
  // the drafted words are owed (the marker drafted-copy leaves on the card), the card waits behind every
  // card that carries finished work. The penalty is a flat 45 and the visibility below is capped at the
  // audience band while it applies, so 45 always beats the most an owed card can earn and no amount of
  // page size ever promotes work nobody has finished. Matched on the marker's stable phrase, export budget.
  // READY MEANS ZERO BLANKS AND ZERO OPERATOR RESEARCH. A card whose copy is still owed, or whose copy
  // carries a fill-in placeholder (NAME, SOUND, NUMBER, YEAR), is asking the operator to finish the work:
  // it stays visible but waits behind every card carrying finished work, named on its receipt.
  const after = p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.after ?? "" : "";
  const owed = (p.limitations ?? []).some((l) => l.includes("is still owed, and this card is what is owed"));
  const blanks = /\b(NAME|SOUND|NUMBER|YEAR)\b/.test(after);
  if (owed || blanks) {
    add("readiness", owed ? "the exact copy is still owed, so finished work goes first"
      : "the copy carries blanks nobody has filled, so finished work goes first", -45, 45);
  }

  // THE RECOVERY BELONGS TO THE CAUSE, NOT TO THE PAGE. Two changes on one page carry the same recoverable
  // click figure, and only the one that works on the cause the evidence NAMED can actually collect it. A
  // lever that touches something else may not ride that number at all: it keeps its audience, which is a
  // size and not a claim. Without this a wrong lever wins the moment the page is big enough, which is the
  // one thing this ranking exists to stop.
  const cause = p.diagnosisCause;
  // A cause I do not recognise (a hand-edited row, or one written under an older ladder) is treated exactly like no cause at all: it matches nothing and it punishes nothing.
  const levers = cause ? CAUSE_LEVERS[cause] : undefined;
  const addressed = withholdReason(p, cause) == null;

  const clicks = Number.isFinite(p.impactScore) && p.impactScore != null ? Math.max(0, p.impactScore) : null;
  const upside = Number.isFinite(p.upsidePerMonth) && p.upsidePerMonth != null ? Math.max(0, p.upsidePerMonth) : null;
  const demand = Number.isFinite(p.demandImpressions90d) && p.demandImpressions90d != null ? Math.max(0, p.demandImpressions90d) : null;
  const directional = !(addressed && clicks != null && clicks > 0);
  const proven = !addressed ? null
    : clicks != null && clicks > 0
      ? { input: `about ${num(clicks)} clicks proven recoverable`, value: Math.min(MAX.visibility, clicks / 25) }
      : upside != null && upside > 0
        ? { input: `about ${num(upside)} clicks a month of opportunity, which is a midpoint and not a measured figure`, value: Math.min(MAX.visibility / 2, upside / 25) }
        : null;
  // THE AUDIENCE. A card minted off a defect carries no recoverable click figure at all, so the order
  // collapsed onto how long the work takes and a page shown twice outranked a rebuild of a page shown thirty
  // thousand times. Views are not a recovery, so they earn a THIRD of the ceiling, nothing at all under
  // AUDIENCE_FLOOR, and the whole third only at AUDIENCE_FULL, while a proven recovery can reach three
  // times higher. WHICHEVER IS BIGGER IS WHAT IS RIDING ON THE CHANGE, and the receipt names both.
  const audience = demand != null && demand > AUDIENCE_FLOOR
    ? { input: `shown ${num(demand)} times in 90 days, an audience size rather than a proven recovery`,
      value: (MAX.visibility / 3) * Math.min(1, Math.log10(demand / AUDIENCE_FLOOR) / Math.log10(AUDIENCE_FULL / AUDIENCE_FLOOR)) }
    : null;
  const rode = proven && audience && audience.value > proven.value ? { ...audience, input: `${proven.input}, on a page ${audience.input}` } : proven ?? audience;
  // AND A CARD NOBODY HAS FINISHED MAY NOT RIDE THE PROVEN BAND. The flat 45 above held homework behind
  // finished work while visibility topped out at 40; at 120 a page big enough simply bought its way past a
  // card that is actually written. Until the copy exists, what is riding on it counts only as far as an
  // AUDIENCE does, so 45 always outweighs it and no page is ever big enough to promote unfinished work.
  const owedCap = owed || blanks;
  const shown = owedCap && rode && rode.value > MAX.visibility / 3
    ? { input: `${rode.input}, counted only as far as an audience while the copy is owed`, value: MAX.visibility / 3 }
    : rode;
  add("visibility", shown?.input ?? "no proven figure for what this wins back", shown?.value ?? 0, MAX.visibility);

  const items = shownEvidence(p);
  add("evidence", `${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence on the receipt`, Math.min(MAX.evidence, items * 1.5), MAX.evidence);

  if (!cause) add("causeFit", "no cause named for this change yet", 0, MAX.causeFit);
  else if (!levers || levers.size === 0) add("causeFit", "nothing you can write on the page fixes the cause named here", 0, MAX.causeFit);
  else add("causeFit", addressed ? `this change works on ${LEVER_WORD[cause] ?? "the cause named here"}`
    : `this change does not touch ${LEVER_WORD[cause] ?? "the cause named here"}`, addressed ? MAX.causeFit : -MAX.causeFit, MAX.causeFit);

  const prompts = p.bundle?.scope.prompts.length ?? 0;
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
  const seen = rode ? history?.get(actionFamilyOf(p.changeFamily)) : undefined;
  const votes = seen && seen.readings >= MIN_FINISHED_READINGS;
  add("history", !rode ? "too little of an audience on this page for what this kind of change has done elsewhere to mean anything here"
    : !votes ? "not enough finished readings of this kind of change here to judge it"
    : seen!.netLift > 0 ? `this kind of change is ${num(seen!.netLift)} clicks up across ${num(seen!.readings)} finished readings here`
      : `this kind of change is ${num(Math.abs(seen!.netLift))} clicks down across ${num(seen!.readings)} finished readings here`,
  !votes ? 0 : seen!.netLift > 0 ? MAX.history : -MAX.history, MAX.history);

  return { factors: f, directional };
}

function receiptFor(p: ChangeProposal, peers: number, measuring: boolean, history: FamilyHistory | null = null): Receipt {
  const { factors, directional } = factorsFor(p, peers, measuring, history);
  const score = round2(factors.reduce((a, x) => a + x.contribution, 0));
  const items = shownEvidence(p);
  const basis = directional
    ? `No proven click figure backs this one, so this is the order to work in, not a promise about size. Ranked on ${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence and what it takes you to do.`
    : `Ranked on about ${num(Math.max(0, p.impactScore ?? 0))} clicks proven recoverable, ${num(items)} ${items === 1 ? "piece" : "pieces"} of evidence, and what it takes you to do.`;
  return { score, factors, directional, basis };
}

/** The scalar the order is built from, for ONE proposal read on its own (no batch, so
 *  nothing overlaps and nothing confounds). Exposed so a caller can inspect exactly why
 *  the order came out as it did. */
export function proposalValueScore(p: ChangeProposal): number {
  return receiptFor(p, 0, false).score;
}

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
    case "actionability":
      return `${lead} it passed every safety check and that one still needs your eyes first.`;
    case "visibility":
      return `${lead} more is riding on it: ${sep.a.input}, against ${sep.b.input}.`;
    case "evidence":
      return `${lead} there is more to show for it: ${sep.a.input} against ${sep.b.input}.`;
    case "causeFit":
      return `${lead} ${sep.a.input}, and ${other} does not.`;
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
