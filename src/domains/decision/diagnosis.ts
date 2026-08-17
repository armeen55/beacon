/** decision/diagnosis: THE CAUSE LADDER. One page loses clicks for exactly one reason that can be named. Every cause is asked in one fixed order and answers for itself: (1) does it HOLD what the cause is decided from? No, and it is NOT CONSIDERED, by name, with the exact thing missing. (2) does the evidence FIRE it? Yes, and it carries the receipt ids it was read off; no, and the deterministic reason it lost rides on the winner as a competing explanation. Order is evidence
 *  strength: two of your own pages on one search beats a page that fell beats a wording read beats a shared subject beats a shape beats an engine that never cites you beats how the page is served. EVERY DIAGNOSIS NAMES WHAT WOULD KILL IT (`falsifier`). NOTHING DRAFTS WITHOUT A NAMED CAUSE, and `action` stays null for every cause whose fix is not an edit this kernel can write. PURE + deterministic. */

import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { classifyResult } from "@/domains/evidence/serp-shape";
import { citesOwnSite, retrievedNotCitedLinks } from "@/domains/evidence/ai-visibility/canonicalize-citation-url"; import { pageContains, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import type { ActionDiagnosis, DiagnosedAction } from "./contracts";
import type { DecidedTopic } from "./coverage-pass";
import { technicalKey, type TechnicalFinding } from "./technical-findings";
import { RECEIPT } from "./diagnose";
import { observationJoinsCase } from "./membership"; import { provenSurvivor, splitComparison, type SplitRow } from "./split";

/** WHY one page loses the click, as ONE closed vocabulary, every member decided from evidence this account holds. No member means "some other reason": a cause that cannot be named is `no_problem` plus a missing input. */
type CandidateCause =
  | "cannibalization"
  | "ctr_snippet" | "competitor_content_gap" | "incomplete_coverage" | "weak_opening"
  | "serp_shape_shift" | "intent_shift" | "internal_link_weakness" | "ai_citation_gap"
  | "demand_decline" | "ranking_loss" | "retrieved_not_cited" | "technical_indexability"
  | "measuring_change" | "no_problem";

/** WHAT THE CAUSE WAS READ OFF, KEPT: the SAME values the explanation is written from, so a cause that can explain a loss can also produce work. Absent = no structure worth keeping, never "the reading failed". */
export type CausePayload =
  | { cause: "weak_opening"; want: string[] }
  | { cause: "incomplete_coverage"; absentHeadings: string[]; absentEntities: string[] }
  | { cause: "competitor_content_gap"; gaps: Array<{ gap: string; seenOn: number[]; publishers: string[] }> }
  | { cause: "internal_link_weakness"; medianWinnerLinks: number; ownedLinks: number }
  | { cause: "serp_shape_shift"; ownShape: string; settledShape: string }
  | { cause: "intent_shift"; intent: string; ownShape: string }
  | { cause: "retrieved_not_cited"; engine: string; promptText: string }
  | { cause: "ai_citation_gap"; engine: string; promptText: string }
  | { cause: "cannibalization"; competingPaths: string[]; comparison: SplitRow[]; survivor: string | null }
  | { cause: "technical_indexability"; findings: TechnicalFinding[] };

/** ONE cause, everything it was read off, and everything it beat. Carried INSIDE the candidate, so a receipt
 *  renders the whole reasoning step or none of it. */
export type CauseFinding = {
  cause: CandidateCause;
  /** The reading itself, in the shape the rule computed it. See CausePayload. */
  payload?: CausePayload;
  /** The edit this cause supports, in the EXISTING action vocabulary. null = no copy edit follows from it,
   *  which is a real answer and the reason a named cause still never manufactures a draft. */
  action: DiagnosedAction | null;
  /** Receipt item ids behind the cause. Empty = nothing may be claimed from it. */
  evidenceKeys: string[];
  /** Other causes considered and why each lost, strongest first, bounded to three. `fired` marks the ones whose
   *  OWN evidence fired and lost only to a stronger explanation; everything else was weighed and did NOT fire. */
  competingExplanations: Array<{ cause: CandidateCause; reason: string; fired?: boolean }>;
  /** The one observation that would prove this diagnosis wrong. */
  falsifier: string;
  /** One plain first-person sentence the operator reads. No lab words. */
  explanation: string;
  /** Causes whose evidence inputs are NOT on file, with the exact thing missing. The absence is the finding. */
  notConsidered: Array<{ cause: CandidateCause; missing: string }>;
};

/** The pattern reading, taken from the verdict that carries it, so this file imports no model call. */
type Pattern = NonNullable<DecidedTopic["decision"]["pattern"]>;

/** Everything one page's diagnosis is decided from, all of it already bought by this pass. */
type LadderInput = {
  snapshot: EvidenceSnapshot;
  page: OwnedPageEvidence;
  /** The EXACT search the click gap was measured on. Never a page total, never a neighbour. */
  query: string;
  /** What reading the results page for THAT exact search concluded (decision/diagnose). Its own honest
   *  "not looked yet" is a reading too, so this is never null and the wording cause is always asked. */
  serpRead: ActionDiagnosis;
  /** The ONE topic this pass decided, when it decided one. Only the page that verdict NAMES may be judged
   *  by it: a pattern read against somebody else's page proves nothing about this one. */
  coverage: DecidedTopic | null;
  /** The pages that already carry a change the operator applied and I am still reading. ABSENT means I was
   *  not told, so `measuring_change` is not considered: silence about a fact is never proof of its opposite. */
  measuringPagePaths?: readonly (string | null)[];
  /** THE HELD PAGE ITSELF, when the caller holds one: a subject the page carries in passage nine is present,
   *  and an absence claim written off a title and an outline reads it as missing. */
  body?: OwnedPageBody | null;
  /** WHAT IS WRONG WITH HOW THESE PAGES ARE SERVED (decision/technical-findings). ABSENT means I never
   *  looked, so the cause is not considered; EMPTY means I looked and found nothing, which is ruled out. */
  technical?: readonly TechnicalFinding[];
  /** THIS PAGE'S TWO CONSECUTIVE 28 DAY WINDOWS. ABSENT means they were never read, and the two causes decided from them stay unconsidered BY NAME. Present, and
   *  they answer for themselves: whether the searching stopped or the page slipped is exactly the difference between these numbers. */
  decline?: { clicksNow: number; clicksPrior: number; positionNow: number; positionPrior: number; impressionsNow: number; impressionsPrior: number } | undefined;
};

/** Derived once per page so no rule below re-derives it and no two rules can disagree. */
type Ctx = LadderInput & {
  queryKey: string;
  urlKey: string;
  /** The winners' pattern, ONLY when the verdict that carries it names THIS page. */
  pattern: Pattern | null;
  /** The decided topic, ONLY when it names THIS page. */
  mine: DecidedTopic | null;
};

type Verdict =
  /** `cause` overrides the rule's own when ONE reading can reach more than one honest conclusion (the two windows: a page that slipped, or demand that dried up). */
  | { fired: true; action: DiagnosedAction | null; evidenceKeys: string[]; explanation: string; payload?: CausePayload; cause?: CandidateCause }
  | { fired: false; reason: string };

type Rule = {
  cause: CandidateCause;
  /** The exact thing missing, or null when every input this cause needs is on file. */
  held: (c: Ctx) => string | null;
  read: (c: Ctx) => Verdict;
  falsifier: (c: Ctx) => string;
  /** The alternative this cause structurally rules out, so a finding always ships with one. */
  rulesOut: { cause: CandidateCause; reason: string };
  /** Other causes this ONE rule decides, named too when it is not held: one reading can settle more than one cause, and every cause off the file is named or none is. */
  alsoUnheld?: ReadonlyArray<{ cause: CandidateCause; missing: string }>;
};

/** WHEN A FALL IS A FALL, in ONE place: the ladder and the candidate carrying that fall onto the queue must agree, or a page is diagnosed as declining and ranked as if it were not.
 *  `minPriorClicks` is what the page had to be earning first (one that went 6 clicks to 1 must never outrank one that went 400 to 200); `share` is how much of it is gone (a quarter is
 *  past any ordinary wobble) OR `minLostClicks` is how many are gone outright, because a big page that shed 191 clicks on a 20 percent dip is the most valuable thing on the site and a
 *  share floor alone never sees it; `positionSlip` is how far down counts as slipping (under a full position it is the same rank over a different mix of searches). */
export const DECLINE_FLOORS = { minPriorClicks: 50, share: 0.75, minLostClicks: 100, positionSlip: 1 } as const;
const { minPriorClicks: MIN_PRIOR_CLICKS, share: DECLINE_SHARE, minLostClicks: MIN_LOST, positionSlip: MIN_POSITION_SLIP } = DECLINE_FLOORS;
/** The cause a fired rule actually concluded: its own, unless the reading named a different one. */
const wonCause = (won: { rule: Rule; verdict: Extract<Verdict, { fired: true }> }): CandidateCause => won.verdict.cause ?? won.rule.cause;
const NOT_DOWN = "this page is not down enough over its last two four week windows for a fall to explain anything";

const quote = (s: string): string => `"${s}"`;
const list = (t: readonly string[]): string => t.slice(0, 3).map(quote).join(", ");
const num = (n: number): string => Math.round(n).toLocaleString("en-US");

/** WHETHER AN ANSWER CREDITED THIS ACCOUNT is not a question this file gets to answer its own way. It rolled
 *  the account's own pages up to registrable domains and compared those; Visibility compared the host against
 *  the account's root and its subdomains; a producer compared with a bare `endsWith` on one field. Three
 *  readings of one fact is how a card came to say a page was never cited on a day the same rows said it was
 *  cited 31 times out of 47. The ONE predicate lives with the citations (evidence/ai-visibility) and every
 *  reading of "did they credit us" in this kernel is this call. */
const creditsMe = (o: { citations?: readonly { domain: string; url: string }[] | null }, snapshot: EvidenceSnapshot): boolean =>
  citesOwnSite(o.citations, snapshot.scope.site);

/** Why the wording read did not name the title, in the operator's words. One sentence per conclusion that
 *  reading can reach, so "the results page did not accuse the wording" is never a shrug. */
function serpLoss(d: ActionDiagnosis): string {
  if (d.cause === "google_rewrite_already_matches") return "Google already shows this page with the words people are searching for, so its stored wording is not what loses the click";
  if (d.cause === "wrong_page_ranking") return "this page does not come up for that search at all, so its wording is not what loses the click";
  if (d.cause === "serp_market_mismatch") return "the one check that ran did not show this page, so the line a searcher sees is not readable";
  if (d.cause === "ambiguous_search_intent") return "the pages that beat this one share no wording it is missing";
  return "the results page for that search has not been read yet, so the wording accuses nothing";
}

/** THE TWO CAUSES DECIDED FROM THE TWO WINDOWS, for a finding built WITHOUT running the ladder. They are a RULE now (see RULES below); this is only what a
 *  caller that was told nothing says. */
const NOT_TOLD_DECLINE: Array<{ cause: CandidateCause; missing: string }> = [
  { cause: "demand_decline", missing: "This page's two four week windows were not read here, so whether the searching itself fell off is not visible." },
  { cause: "ranking_loss", missing: "This page's two four week windows were not read here, so whether it slipped down the results is not visible." },
];

// ── the ladder, strongest evidence first ─────────────────────────────────────

const RULES: Rule[] = [
  { // A CHANGE ALREADY UNDER MEASUREMENT outranks every other reading: a second edit makes the first unreadable.
    cause: "measuring_change",
    held: (c) => (c.measuringPagePaths ? null : NOT_TOLD_MEASURING.missing),
    read: (c) => ((c.measuringPagePaths ?? []).some((p) => namesPage(p, c.urlKey))
      ? { fired: true, action: null, evidenceKeys: [RECEIPT.gsc],
        explanation: "The change you applied here is still being measured, so nothing is stacked on top of it." }
      : { fired: false, reason: "nothing you applied to this page is still being measured, so nothing here is waiting on a reading" }),
    falsifier: () => "If the change recorded on this page was never actually applied, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "a second edit here would make the first one unreadable, whatever its wording does" },
  },
  { // TWO OF YOUR OWN PAGES ON ONE SEARCH is the one cause no wording change can touch, so it is asked before every wording question and SCOPED TO THIS SEARCH.
    cause: "cannibalization",
    held: (c) => (c.snapshot.cannibalization.some((g) => canonicalQueryKey(g.query) === c.queryKey)
      || c.snapshot.research.retainedKeywords.some((k) => canonicalQueryKey(k.query) === c.queryKey && k.supports != null)
      ? null
      : "Which of your own pages Google serves for that exact search has not been checked."),
    read: (c) => {
      const group = c.snapshot.cannibalization.find((g) => canonicalQueryKey(g.query) === c.queryKey
        && g.competingUrls.some((u) => canonicalUrlKey(u) === c.urlKey));
      const kw = c.snapshot.research.retainedKeywords.find((k) => canonicalQueryKey(k.query) === c.queryKey && k.supports === "consolidation");
      if (!group && !kw) return { fired: false, reason: "only one page of yours comes up for that search, so nothing of yours is taking the click from it" };
      // WHAT THIS PROVES IS THAT BOTH PAGES COME UP, never that the clicks are being divided: the comparison decides the survivor or nobody does.
      const comparison = splitComparison(c.snapshot, c.query);
      // A COMPETITOR MUST MATERIALLY APPEAR: a page with a KNOWN negligible share is not dividing anything, and a share unknown (null) is kept, because absence of a number rules nothing out. AND A BOUGHT KEYWORD'S OLD CONSOLIDATION FLAG NEVER FIRES THIS ALONE (operator, 2026-08-17): with no current group there are no two pages to compare, so today's own rows overrule yesterday's judgment.
      if (comparison.length < 2) return { fired: false, reason: `no two pages of yours materially appear for ${quote(c.query)} in your own current rows, so nothing is dividing the clicks now` };
      const knownTotal = comparison.reduce((a, r) => a + (r.impressions ?? 0), 0);
      const floor = Math.max(30, Math.round(knownTotal * 0.1));
      const material = comparison.filter((r) => r.impressions == null || r.impressions >= floor);
      if (comparison.length >= 2 && material.length < 2)
        return { fired: false, reason: `only one of your pages materially appears for ${quote(c.query)}; the rest barely surface, so nothing is dividing the clicks` };
      const materialUrls = new Set(material.map((r) => canonicalUrlKey(r.url)));
      const competing = (group?.competingUrls ?? []).filter((u) => comparison.length === 0 || materialUrls.has(canonicalUrlKey(u)));
      const pages = (competing.length || group?.competingUrls.length) ?? 2;
      return { fired: true, action: "consolidate", evidenceKeys: comparison.length > 0 ? [RECEIPT.gsc, RECEIPT.competing] : [RECEIPT.gsc],
        payload: { cause: "cannibalization", competingPaths: competing.length >= 2 ? competing : [...(group?.competingUrls ?? [])], comparison: material, survivor: provenSurvivor(material) },
        // "either of them" is a claim about there being TWO, and this rule fires on three and on four.
        explanation: `${num(pages)} of your own pages come up for ${quote(c.query)}, so Google is choosing between them every time somebody searches it. Settle which one owns that search before changing a word on ${pages === 2 ? "either" : "any"} of them.` };
    },
    falsifier: (c) => `If the next look shows only one page of yours coming up for ${quote(c.query)}, this is not the explanation.`,
    rulesOut: { cause: "ctr_snippet", reason: "a sharper line cannot fix two of your own pages competing for the same search" },
  },
  { // A PAGE THAT WAS EARNING AND STOPPED, off its own two four week windows. Asked before every wording question: no line a searcher reads wins back a click from
    // a position the page no longer holds, and none wins one from somebody who never searched. WHICH OF THE TWO IT IS, THE WINDOWS DECIDE. Both causes were filed
    // for a generation as untestable over one 90 day average, while 17 months of daily page totals sat in the store and the decay reader computed both windows.
    cause: "ranking_loss",
    held: (c) => (c.decline ? null : NOT_TOLD_DECLINE[1]!.missing),
    alsoUnheld: [NOT_TOLD_DECLINE[0]!],
    read: (c) => {
      const d = c.decline!, at = `${d.positionPrior.toFixed(1)} to ${d.positionNow.toFixed(1)}`;
      if (d.clicksPrior < MIN_PRIOR_CLICKS || (d.clicksNow > DECLINE_SHARE * d.clicksPrior && d.clicksPrior - d.clicksNow < MIN_LOST)) return { fired: false, reason: NOT_DOWN };
      if (d.positionNow - d.positionPrior >= MIN_POSITION_SLIP) return { fired: true, action: null, evidenceKeys: [RECEIPT.gsc],
        explanation: `This page fell from position ${at} between the last four weeks and the four before, and lost ${num(d.clicksPrior - d.clicksNow)} clicks with it. Something moved ahead of it, so those clicks come back by making the page worth that place again, not by rewriting the line under its name.` };
      if (d.impressionsPrior > 0 && d.impressionsNow <= DECLINE_SHARE * d.impressionsPrior) return { fired: true, cause: "demand_decline", action: null, evidenceKeys: [RECEIPT.gsc],
        explanation: `${num(d.impressionsPrior - d.impressionsNow)} fewer people saw this page in search over the last four weeks than the four before, while it held its position. Fewer people are searching for this, so the page lost nothing: it is being asked for less.` };
      return { fired: false, reason: `this page held its position (${at}) and was seen by as many people, so neither a slip nor quieter demand is what cost the clicks` };
    },
    falsifier: () => "If this page is back where it was on both counts and the clicks have not followed, the fall is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "no wording wins back a click from a position the page no longer holds, or from somebody who never searched" },
  },
  { // THE LINE A SEARCHER ACTUALLY READS: decision/diagnose owns that read; here it is one rung like any other.
    cause: "ctr_snippet",
    held: () => null,
    read: (c) => (c.serpRead.status === "diagnosed" && c.serpRead.action === "title"
      ? { fired: true, action: "title", evidenceKeys: c.serpRead.evidenceKeys, explanation: c.serpRead.explanation }
      : { fired: false, reason: serpLoss(c.serpRead) }),
    falsifier: () => "If Google starts displaying this page with the wording the pages beating it share, and the click rate does not move, the wording was not the cause.",
    rulesOut: { cause: "competitor_content_gap", reason: "the line a searcher reads is what loses the click here, and that is wording rather than a subject the page never covers" },
  },
  { // WHAT MY PAGE DOES NOT DO, and only about the page the verdict put in front of the reading. A gap written about a page nobody supplied is an invention, so it is gated here too.
    cause: "competitor_content_gap",
    held: (c) => (c.pattern ? null : "No reading of what the pages winning this subject have in common, taken against this page, is on file."),
    read: (c) => {
      const gaps = c.pattern!.ownedGaps;
      if (gaps.length === 0) return { fired: false, reason: "the pages that win this subject do nothing this page does not already do" };
      const first = gaps[0]!;
      const publishers = c.pattern!.publishers;
      return { fired: true, action: null, evidenceKeys: [RECEIPT.winners, RECEIPT.winnersGap],
        payload: { cause: "competitor_content_gap", gaps: gaps.map((g) => ({ gap: g.gap, seenOn: [...g.seenOn],
          publishers: g.seenOn.map((i) => publishers[i]).filter((p): p is string => !!p) })) },
        explanation: `The ${c.pattern!.winners} pages that win this subject were read side by side, and ${first.seenOn.length} of them do something this page does not: ${first.gap}` };
    },
    falsifier: () => "If a page of yours already does that and it was simply not read, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "the pages beating this one carry something it does not, so a sharper line would send people to a page that still does not answer them" },
  },
  {
    cause: "incomplete_coverage",
    held: (c) => (!c.pattern ? "No reading of what the pages winning this subject have in common, taken against this page, is on file."
      : !c.page.content ? "This page's own sections are not on file, so what it leaves out cannot be named." : null),
    read: (c) => {
      const content = c.page.content!;
      const mineTokens = new Set(topicTokens([content.title, content.h1, ...content.outline].filter(Boolean).join(" ")));
      const headings = c.pattern!.commonHeadings.map((h) => h.heading);
      const entities = c.pattern!.commonEntities.map((e) => e.entity);
      const shared = [...headings, ...entities];
      // The SAME filter, kept apart: a missing section is one to write, a missing named thing is one to name. AND THE HELD PAGE HAS THE LAST WORD on any absence claimed here.
      const missing = (xs: string[]): string[] => xs.filter((s) => { const t = topicTokens(s); return t.length > 0 && !t.some((x) => mineTokens.has(x)) && pageContains(c.body, s) !== "yes"; });
      const absentHeadings = missing(headings); const absentEntities = missing(entities);
      const absent = [...absentHeadings, ...absentEntities];
      return absent.length === 0
        ? { fired: false, reason: "this page already covers everything the winning pages agree on" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.winners, RECEIPT.winnersHeading, RECEIPT.copy],
          payload: { cause: "incomplete_coverage", absentHeadings, absentEntities },
          explanation: `The pages that win this subject agree on ${num(shared.length)} things to cover and this page carries none of ${num(absent.length)} of them: ${list(absent)}.` };
    },
    falsifier: () => "If this page covers those under wording that did not match, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "a line that promises what the page does not deliver wins the click and loses the reader" },
  },
  { // HOW THE PAGE OPENS, against how every winner opens. Not taste: they all answer the search in their first words, and this page's first words never say what it is about.
    cause: "weak_opening",
    held: (c) => (!c.pattern || !c.pattern.openingPattern ? "No reading of how the pages winning this subject open is on file."
      : !openingOf(c) ? "This page's own opening words are not on file." : null),
    read: (c) => {
      const weak = weakAnchorsOf(c.snapshot.ownedPages, c.snapshot.research);
      const want = topicTokens(c.query).filter((t) => !weak.has(t));
      const opens = new Set(topicTokens(openingOf(c)!));
      const missing = want.filter((t) => !opens.has(t));
      return want.length === 0 || missing.length < want.length
        ? { fired: false, reason: "this page opens by naming what the search is about, so its opening is not what loses the reader" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.winners, RECEIPT.winnersOpening, RECEIPT.body],
          payload: { cause: "weak_opening", want },
          explanation: `The pages that win this subject all open by answering it, and this page's own opening never says ${list(want)}.` };
    },
    falsifier: () => "If the page answers the search in its first lines under wording that did not match, this is not the explanation.",
    rulesOut: { cause: "incomplete_coverage", reason: "the page carries the subject; it is the first thing a reader sees that never says so" },
  },
  { // THE KIND OF PAGE THAT WINS, settled one gate earlier by counting publishers. A page of a different kind is not losing on wording, and no rewrite turns one kind into another.
    cause: "serp_shape_shift",
    held: (c) => (!c.mine ? "What kind of page wins this subject is not settled."
      : c.mine.investigation.pageType === "mixed" || c.mine.investigation.pageType === "unknown"
        ? "The pages that win this subject do not settle on one kind, so there is no shape to hold this page against."
        : !ownShape(c) ? "Too little of this page is on file to say what kind of page it is." : null),
    read: (c) => (ownShape(c) === c.mine!.investigation.pageType
      ? { fired: false, reason: "this page is already the same kind of page as the ones winning that search" }
      : { fired: true, action: null, evidenceKeys: [RECEIPT.shape, RECEIPT.copy],
        payload: { cause: "serp_shape_shift", ownShape: ownShape(c)!, settledShape: c.mine!.investigation.pageType },
        explanation: `The sites winning ${quote(c.query)} have settled on one kind of page and this page is a different kind, so the distance between them is not something a sharper line closes.` }),
    falsifier: () => "If the results for that search stop agreeing on one kind of page, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "the results have settled on a kind of page this one is not, and wording does not change what a page is" },
  },
  { // WHAT THE SEARCHER IS THERE TO DO, off the intent every priced search agrees on, against what this page is built to do. Only a real disagreement fires; a silence never does.
    cause: "intent_shift",
    held: (c) => (!c.mine || !c.mine.investigation.demand.intent ? "What someone searching this is actually trying to do is not on file."
      : !ownShape(c) ? "Too little of this page is on file to say what it is built to do." : null),
    read: (c) => {
      const buying = /^(commercial|transactional)$/i.test(c.mine!.investigation.demand.intent ?? "");
      const sells = SELLING.has(ownShape(c)!);
      return buying === sells
        ? { fired: false, reason: "this page is built for what people searching it are actually trying to do" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.intent, RECEIPT.copy],
          payload: { cause: "intent_shift", intent: c.mine!.investigation.demand.intent ?? "", ownShape: ownShape(c)! },
          explanation: `People searching ${quote(c.query)} are ${buying ? "ready to choose something" : "trying to understand the subject"}, and this page is written for the other one, so a sharper line would not close that distance.` };
    },
    falsifier: () => "If what people want from that search is not what the keyword research recorded, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "the page answers a different question from the one being asked, and wording cannot answer a question the page does not cover" },
  },
  { // WHERE A READER CAN GO NEXT, counted off my own page against the winners. Both sides are real counts from reads already paid for, and a thinly linked subject accuses nobody.
    cause: "internal_link_weakness",
    held: (c) => (!c.mine ? "This page has not been compared against the pages that win its subject."
      : !c.page.content ? "This page's own links are not on file." : winnerLinks(c).length < 2
        ? "Too few reads of the winning pages are on file to say what they link to." : null),
    read: (c) => {
      const counts = winnerLinks(c);
      const middle = counts[Math.floor(counts.length / 2)]!;
      const mine = c.page.content!.internalLinks.length;
      return middle < MIN_LINK_FLOOR || mine * 2 >= middle
        ? { fired: false, reason: "this page points readers on to as much of your site as the winning pages do of theirs" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.winners, RECEIPT.links],
          payload: { cause: "internal_link_weakness", medianWinnerLinks: middle, ownedLinks: mine },
          // THE DIFFERENCE, never the winners' own total said as if it were the gap: "about 12 more" off a median of 12 overstates it every time.
          explanation: `The pages that win this subject point readers on to about ${num(middle - mine)} more of their own pages than this one does, ${num(middle)} against ${num(mine)}, so people who land here have nowhere to go next.` };
    },
    falsifier: () => "If this page's links are on file and too few were read, this is not the explanation.",
    rulesOut: { cause: "incomplete_coverage", reason: "the page covers the subject and then strands the reader on it" },
  },
  { // READ AND PASSED OVER: the retrieval list held this page and the answer cited somebody else, which is a content verdict rather than a wording one.
    cause: "retrieved_not_cited",
    held: (c) => (aiAnswers(c).some((o) => (o.retrievedResults ?? null) != null)
      ? null : "What the engines cited is on file, and none of these observations recorded what was read before answering."),
    read: (c) => {
      // THIS PAGE, not this domain, and the citations are subtracted from the retrieval list first, by canonical url, or a page that WAS cited reads as read and passed over.
      const seen = aiAnswers(c).find((o) => retrievedNotCitedLinks(o.retrievedResults, o.citations).some((r) => canonicalUrlKey(r.url) === c.urlKey)
        && (o.citations ?? []).length > 0 && !creditsMe(o, c.snapshot));
      if (!seen) return { fired: false, reason: "no engine read this page and then cited only other sites" };
      const cited = (seen.citations ?? []).length;
      return { fired: true, action: null, evidenceKeys: [RECEIPT.ai],
        payload: { cause: "retrieved_not_cited", engine: seen.engine, promptText: seen.promptText },
        explanation: `${seen.engine} read this page while answering ${quote(seen.promptText)} and cited ${num(cited)} other ${cited === 1 ? "site" : "sites"} instead, so the page was seen and passed over, not missed.` };
    },
    falsifier: () => "If an engine that reads this page starts citing it, this is not the explanation.",
    rulesOut: { cause: "ai_citation_gap", reason: "a page the engine read and declined is a harder problem than one it never found" },
  },
  { // AN ENGINE THAT CITES EVERYBODY ELSE, off answers already observed about THIS page's search: cited sites that are not mine, and this page never once among them.
    cause: "ai_citation_gap",
    held: (c) => (aiAnswers(c).length > 0 ? null : "No AI answer about that search carries its sources on file."),
    read: (c) => {
      // AND THE SUPPRESSOR READS THE SAME ROWS THE ACCUSATION READS. It asked a per-PAGE count computed
      // somewhere else, over a different slice, so answers crediting this account on a different page, on a
      // subdomain, or outside that slice all left the count at zero and the accusation stood.
      const answers = aiAnswers(c), credited = answers.filter((o) => creditsMe(o, c.snapshot)).length;
      const rival = answers.find((o) => (o.citations ?? []).length > 0 && !creditsMe(o, c.snapshot));
      if (!rival || credited > 0 || c.page.aiCitations.count > 0) return { fired: false, reason: credited > 0 ? `AI answers about that search credit this site on ${num(credited)} of the ${num(answers.length)} on file` : "AI answers about that search already cite this page" };
      const named = (rival.citations ?? []).length;
      return { fired: true, action: null, evidenceKeys: [RECEIPT.ai],
        payload: { cause: "ai_citation_gap", engine: rival.engine, promptText: rival.promptText },
        explanation: `The AI answers about that search were read: ${rival.engine} answered ${quote(rival.promptText)} and named ${num(named)} other ${named === 1 ? "site" : "sites"} without ever citing this page.` };
    },
    falsifier: () => "If an engine cites this page for that subject on the next look, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "an engine that never names this page is not choosing against its wording" },
  },
  { // HOW THIS PAGE IS SERVED, off the inventory and the capture already held: an address that answers nothing, a hop through a hop, a canonical naming somebody else, a robots tag holding it out.
    // ASKED LAST ON PURPOSE: a page losing on its words is not fixed by its plumbing, so this wins only when nothing above fired, and that page's ONLY earned work is technical.
    cause: "technical_indexability",
    held: (c) => (c.technical ? null : NOT_READ_TECHNICAL.missing),
    read: (c) => {
      const mine = c.technical!.filter((f) => canonicalUrlKey(f.url) === c.urlKey);
      const first = mine[0];
      return !first
        ? { fired: false, reason: "nothing about how this page is served is keeping it out of search" }
        : { fired: true, action: null, evidenceKeys: mine.map((_, i) => technicalKey(i)),
          payload: { cause: "technical_indexability", findings: mine },
          explanation: `${first.evidence}${mine.length > 1 ? ` ${num(mine.length)} things like that are on this page.` : ""}` };
    },
    falsifier: () => "If that address answers and the page is being indexed on the next read, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "no wording wins a click for a page search engines are being told to leave out" },
  },
];

/** A page built to help somebody choose or buy. Everything else reads as a page built to explain. */
const SELLING = new Set(["product", "category", "comparison", "tool"]);
/** Under this many links, nobody on that results page is pointing readers anywhere, so nobody is accused. */
const MIN_LINK_FLOOR = 5;

/** Does one stored page address NAME this page? A bare path is matched as the tail of this page's own
 *  key, so "/guide" and "https://site.example/guide" both name it and "/other-guide" never does. */
const namesPage = (path: string | null, urlKey: string): boolean => {
  const p = (path ?? "").trim().toLowerCase();
  if (!p) return false;
  if (!p.startsWith("/")) return canonicalUrlKey(p) === urlKey;
  const tail = p.replace(/\/+$/, "") || "/";
  return urlKey === tail || urlKey.endsWith(tail);
};

/** This page's own opening words, from the ONE place the pass already read them. */
const openingOf = (c: Ctx): string | null =>
  (c.body?.openingSample ?? null) || (c.mine?.candidates.find((x) => canonicalUrlKey(x.url) === c.urlKey)?.openingSample ?? null);

/** What kind of page this one IS, by the same classifier that typed the results it is measured against. */
const ownShape = (c: Ctx): string | null => classifyResult(c.page.content?.title ?? null, c.page.url);

/** How many of their own pages the winners READ point on to, sorted, so the middle one is the middle. */
const winnerLinks = (c: Ctx): number[] => {
  const urls = new Set((c.mine?.investigation.winners ?? []).filter((w) => w.extractState === "current").map((w) => canonicalUrlKey(w.url)));
  return c.snapshot.research.winningPages
    .filter((w) => urls.has(canonicalUrlKey(w.url)) && typeof w.extract?.internalLinkCount === "number")
    .map((w) => w.extract!.internalLinkCount!)
    .sort((a, b) => a - b);
};

/** The observed AI answers actually ABOUT this page's search, decided by the ONE membership predicate: a shared word this account puts on everything can never pull an unrelated answer in. */
const aiAnswers = (c: Ctx): EvidenceSnapshot["research"]["aiObservations"] => {
  const provenance = c.snapshot.research.retainedKeywords.filter((k) => canonicalQueryKey(k.query) === c.queryKey)
    .flatMap((k) => k.origins ?? []);
  return c.snapshot.research.aiObservations.filter((o) => o.citationsObserved && o.citations != null
    && observationJoinsCase(o, { queries: [c.query], provenance }));
};

/** The technical cause is a RULE now, so it is unheld only for a caller that never read the inventory. */
const NOT_READ_TECHNICAL = { cause: "technical_indexability" as const,
  missing: "How this page is served has not been read, so whether anything stops it being found is unknown." };
/** A RULE rather than a permanent silence: a full run of the ladder answers it from what it was told. A finding built without running the ladder was told nothing. */
const NOT_TOLD_MEASURING = { cause: "measuring_change" as const,
  missing: "Which of your pages already carry a change under measurement is not on file, so whether this one does is unknown." };

const MAX_COMPETING = 3;

/** THE cause ladder: the one reasoning step between "this page loses clicks" and "here is why". Returns exactly one cause, everything it was read off, what it beat, what would disprove
 *  it, and every cause that was never considered because its evidence is not on file. `no_problem` is a real and common answer. */
export function diagnoseCauses(input: LadderInput): CauseFinding {
  const named = input.coverage && input.coverage.decision.ownedUrls
    .some((u) => canonicalUrlKey(u) === canonicalUrlKey(input.page.url)) ? input.coverage : null;
  const c: Ctx = {
    ...input,
    queryKey: canonicalQueryKey(input.query),
    urlKey: canonicalUrlKey(input.page.url),
    mine: named,
    // THE PATTERN IS ABOUT ONE PAGE: wearing another case's pattern is how a gap gets written about a page nobody read.
    pattern: named?.decision.pattern ?? null,
  };

  const notConsidered: CauseFinding["notConsidered"] = [];
  const lost: CauseFinding["competingExplanations"] = [];
  let won: { rule: Rule; verdict: Extract<Verdict, { fired: true }> } | null = null;

  for (const rule of RULES) {
    const missing = rule.held(c);
    if (missing) { notConsidered.push({ cause: rule.cause, missing }, ...(rule.alsoUnheld ?? [])); continue; }
    const verdict = rule.read(c);
    if (!verdict.fired) { lost.push({ cause: rule.cause, reason: verdict.reason }); continue; }
    // IT FIRED and lost only on strength: a second real accusation, which the flag alone tells apart from a cause checked and ruled out.
    if (won) lost.push({ cause: rule.cause, reason: `the evidence for ${LABEL[wonCause(won)]} is the stronger explanation`, fired: true });
    else won = { rule, verdict };
  }
  if (!won) {
    return { cause: "no_problem", action: null, evidenceKeys: [RECEIPT.gsc], notConsidered,
      competingExplanations: lost.slice(0, MAX_COMPETING),
      falsifier: "If one of the causes that could not be weighed here turns out to hold, this is not the answer.",
      explanation: "The gap is measured and nothing on file names a cause for it yet." };
  }
  // A FINDING ALWAYS SHIPS WITH AN ALTERNATIVE: the winner's own structural rival first, then what was really weighed and lost, deduped, with the causes that FIRED leading the rest.
  const competing: CauseFinding["competingExplanations"] = [];
  for (const x of [won.rule.rulesOut, ...[...lost].sort((a, b) => Number(b.fired ?? false) - Number(a.fired ?? false))] as CauseFinding["competingExplanations"]) {
    const at = competing.findIndex((y) => y.cause === x.cause);
    if (at < 0) competing.push(x); else if (x.fired && !competing[at]!.fired) competing[at] = { ...competing[at]!, fired: true };
  }
  return { cause: wonCause(won), action: won.verdict.action, evidenceKeys: won.verdict.evidenceKeys,
    ...(won.verdict.payload ? { payload: won.verdict.payload } : {}),
    competingExplanations: competing.slice(0, MAX_COMPETING), falsifier: won.rule.falsifier(c),
    explanation: won.verdict.explanation, notConsidered };
}

/** THE one operator-facing phrase for a cause. Every surface goes through this, so a raw slug can never reach a screen; an unrecognised value on a hand-edited row reads as the honest "something not named yet" rather than printing itself. */
export function causeLabel(cause: string): string {
  return LABEL[cause as CandidateCause] ?? "something still unnamed";
}

/** Every cause in one operator-facing phrase, so a competing explanation never prints a raw slug. */
const LABEL: Record<CandidateCause, string> = {
  cannibalization: "two of your own pages competing for one search",
  ctr_snippet: "the line Google displays for this page",
  competitor_content_gap: "what the winning pages do that this one does not",
  incomplete_coverage: "the subjects the winning pages all cover",
  weak_opening: "how this page opens",
  serp_shape_shift: "the kind of page that wins this search",
  intent_shift: "what people searching this actually want",
  internal_link_weakness: "where this page sends a reader next",
  ai_citation_gap: "AI answers citing everybody but this page",
  demand_decline: "demand for this search falling",
  ranking_loss: "this page slipping down the results",
  retrieved_not_cited: "an engine reading this page and citing somebody else",
  technical_indexability: "something stopping this page being indexed",
  measuring_change: "a change here still being measured",
  no_problem: "nothing being wrong with this page",
};

/** The finding for a page nothing accuses: a real answer carrying the same four things as every other one,
 *  because "leave it alone" deserves a reason and an alternative exactly as much as "change this" does. */
export function noProblemFinding(explanation: string, ruledOut: string): CauseFinding {
  return { cause: "no_problem", action: null, evidenceKeys: [RECEIPT.gsc], explanation, notConsidered: [...NOT_TOLD_DECLINE, NOT_READ_TECHNICAL, NOT_TOLD_MEASURING],
    competingExplanations: [{ cause: "ctr_snippet", reason: ruledOut }],
    falsifier: "If this page's click rate falls below what pages at its position usually earn, this stops being the answer." };
}
