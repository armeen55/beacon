import "server-only";

/**
 * decision/coverage-adjudication: the ONE verdict on whether this account ALREADY has the right page for a
 * topic it researched. The generation before this shipped duplicates of pages the account already owned,
 * because nobody asked the COMPARISON question first. That is the only question this file answers, once per
 * topic; it drafts nothing, proposes nothing and persists nothing, and an EARNED `create_new` here is the only
 * thing decision/new-page builds from.
 *
 * EVERY VERDICT IS DECIDED IN CODE. Nothing here calls a model, so the ladder is free, repeatable and
 * checkable, and `missing` names exactly what is owed:
 *   1 the account's own profile rules the topic out  -> do_nothing (a verdict, not a gap)
 *   2 no exact results page for the topic            -> exact_serp
 *   3 the results page is out of date                -> fresh_serp
 *   4 the results answer two meanings of the phrase  -> intent
 *   5 the winners will not settle on one kind of page-> do_nothing, PARKED (see `park`)
 *   6 what a searcher wants is not established       -> intent
 *   7 under three ranked winners I can address       -> winners
 *   8 a page that could be the answer, unread        -> owned_content
 *   9 the page by page comparison is not in hand     -> page_intersection
 * EVERY REQUIREMENT MUST BE BUYABLE, OR IT IS A DECISION: gate 5 is a terminal park that says what reopens it,
 * and gate 7 counts winners I can ADDRESS because gate 9 compares addresses. GATE 9 IS EVIDENCE, NOT THE DOOR:
 * it exists to stop me duplicating a page of yours, so a subject no page of yours touches earns `create_new`
 * without it once enough winners are READ, and a subject you do have a page for still waits for it.
 */

import { isNoiseDomain } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { publisherHost } from "@/domains/evidence/serp-shape";
import type { TechnicalFinding, TechnicalKind } from "./technical-findings";
import { comparePageCoverage, type PageCoverageReading, type PageIntersectionAsk, type ParsedPageIntersection } from "@/domains/evidence/page-intersection";
import type { TopicInvestigation } from "@/domains/evidence/topic-investigation";
import type { IntersectionUnavailable, OwnedPageReadOutcome } from "@/domains/evidence/funnel/research-evidence";
import type { OwnedCandidate } from "./owned-coverage";
import type { WinningPattern } from "./winning-pattern";

/** THE six honest answers to "does this business already have the right page?". `technical_only` is the answer
 *  when the page that would carry this topic is one search engines cannot serve at all: no wording earns
 *  anything there, so the plumbing is the whole of the work. */
export type CoverageVerdict =
  | "improve_existing" | "create_new" | "consolidate_or_choose" | "do_nothing" | "research_needed" | "technical_only";

/** WHAT is missing, machine-readable, so Runtime can go and buy exactly that. Never a generic error bucket:
 *  "I have no results page" and "the model refused" are different problems with different fixes. */
export type MissingRequirement =
  | "exact_serp" | "fresh_serp" | "winners" | "owned_content" | "intent" | "page_intersection";

/** One verdict for one researched topic. Carries NO page copy, NO proposed URL and no
 *  proposal: deciding whether a page should exist is a separate job from writing it. */
export type CoverageDecision = {
  verdict: CoverageVerdict;
  /** The TopicInvestigation this answers, so nothing can drift topic mid-flight. */
  topicKey: string;
  /** Canonical OWNED urls the verdict names. Always from the supplied allowlist. */
  ownedUrls: string[];
  /** Evidence ids behind it. A claim with no id behind it is never made. */
  evidenceKeys: string[];
  /** THE SAME EVIDENCE, IN WORDS, so the page built on the verdict never re-derives its own receipt. Bounded
   *  and OPTIONAL: an older stored decision carries none rather than failing to read. Ids match `evidenceKeys`. */
  evidence?: Array<{ id: string; fact: string }>;
  missing: MissingRequirement[];
  /** When the requirement is merely WAITING on a retry, the earliest I may try again; null = nothing is
   *  waiting. A queued read is not a publisher refusal, and this is how a surface says WHEN, not why not. */
  hold?: string | null;
  alternativesRuledOut: Array<{ alternative: string; reason: string }>;
  /** One plain first-person sentence the operator reads. No lab words. */
  explanation: string;
  /** THE ONE PURCHASE that would change this answer, carried straight off the investigation so the step
   *  that reads the verdict never has to guess what to buy. Present only while this is still an
   *  investigation and something is genuinely buyable; absent means nothing left to buy would move it. */
  acquisition?: TopicInvestigation["nextAcquisition"];
  /** WHAT THE PAGES THAT WIN HERE HAVE IN COMMON, carried on the verdict that can still become work so
   *  the diagnosis and the page brief read the SAME pattern this receipt was written from. Absent means
   *  I hold no pattern, which changes no verdict: every gate above is decided without it. */
  pattern?: WinningPattern | null;
};

/** A verdict may name a new page only when it is diagnosed, names no owned page as the
 *  answer, and owes nothing. Anything else is an investigation, not a decision. */
export function earnedNewPage(d: CoverageDecision | null | undefined): boolean {
  return !!d && d.verdict === "create_new" && d.missing.length === 0
    && d.ownedUrls.length === 0 && d.evidenceKeys.length > 0 && d.alternativesRuledOut.length > 0;
}

/** Three publishers, wherever agreement is claimed: to buy the comparison I need three I can
 *  ADDRESS, and to write a page decision/new-page needs three I have READ. Two pages are two
 *  opinions, and nothing downstream of this file ever calls that a pattern. */
const MIN_ADJUDICATION_WINNERS = 3;
/** Two READ winning pages is what it takes to say what a page here has to cover. Three is the bar for calling
 *  anything a pattern across publishers; writing a brief only needs two of them agreeing plus the shape the
 *  whole results page already voted for, and holding out for a third left 27,100-search subjects unbuilt. */
const MIN_WRITABLE_WINNERS = 2;

/** The bought comparison itself, or the honest reason it is not in hand (Evidence owns both
 *  that reason and the publisher-counted reading; this file only picks the verdict). */
export type IntersectionEvidence = ParsedPageIntersection | { unavailable: IntersectionUnavailable };

/**
 * THE ONE request worth paying for, or null. It puts the three ranked winners, ONE per publisher, side by side
 * WITH this account's own contenders, so one answer says both what the winners share and how much of it this
 * account already reaches. Holding the account's pages OUT would make "you cover none of this" something I
 * asked for rather than something I measured, and that is the shape of mistake that ships duplicates.
 *
 * THE MONEY GATE, and deliberately not a second copy of the ladder: it is earned exactly when the free verdict
 * says the ONLY thing still owed is this comparison. Null when the verdict belongs to another topic or three
 * publishers cannot be named.
 */
export function intersectionComparison(
  d: CoverageDecision | null | undefined, inv: TopicInvestigation, candidates: readonly OwnedCandidate[],
): PageIntersectionAsk | null {
  if (!d || d.verdict !== "research_needed" || d.missing.length !== 1 || d.missing[0] !== "page_intersection" || d.topicKey !== inv.key) return null;
  const winners = rankedPublishers(inv);
  if (winners.length < MIN_ADJUDICATION_WINNERS) return null;
  return { pages: [...winners.slice(0, MIN_ADJUDICATION_WINNERS), ...candidates.filter(contender).map((c) => absolute(c.url))], intersection_mode: "union" };
}

/** ONE ranked winning page per publisher, by address, and it is the publisher's BEST-RANKED page here: Evidence
 *  hands these over in real organic order, so taking the first is taking rank 1. Rankedness comes from the
 *  winner's own appearances, so a page only ever cited by an engine is never one. */
const rankedPublishers = (inv: TopicInvestigation): string[] => {
  const byPublisher = new Map<string, string>();
  for (const w of inv.winners) {
    if (byPublisher.has(w.domain) || !w.appearances.some((a) => a.kind === "serp_organic" && (a.rank ?? 0) > 0)) continue;
    byPublisher.set(w.domain, absolute(w.url));
  }
  return [...byPublisher.values()];
};

/** Owned pages are stored as a canonical key; the endpoint documents absolute urls. */
const absolute = (u: string): string => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
/** Publishers on the CURRENT results page I could actually learn from, filtered exactly as the read path
 *  filters: top ten, not a social or discussion profile, not a page of this account's own. Under three of
 *  these, no search will ever bank three winners, so asking the same question again just asks forever. */
const eligiblePublishers = (inv: TopicInvestigation, candidates: readonly OwnedCandidate[], site: string | null): number => {
  // COUNT WHAT THE READ PATH CAN ACTUALLY BANK, or the supply is a promise I cannot keep: ONE search, not
  // every look on file, and never this account's own domain.
  const mine = new Set([...candidates.map((c) => publisherHost(absolute(c.url))), ...(site ? [publisherHost(absolute(site))] : [])]);
  return new Set(inv.exactSerps.filter((s) => s.freshness === "current").slice(0, 1).flatMap((s) => s.organicRows)
    .filter((r) => r.rank > 0 && r.rank <= TOP_TEN && !isNoiseDomain(r.url))
    .map((r) => publisherHost(r.url) || r.domain).filter((h) => !!h && !mine.has(h))).size;
};
/** The read path banks organic winners from the first page of results only. */
const TOP_TEN = 10;
/** Under this, the compared pages merely overlap; they do not share a subject. */
const MIN_SHARED_SEARCHES = 3;

/** Why the comparison is not in hand, in the operator's own words. A provider status is never shown. */
const UNAVAILABLE: Record<IntersectionUnavailable, string> = {
  blocked: "the request was turned down",
  capped: "it would have taken your research spending past its ceiling",
  waiting: "it has not come back yet",
  quarantined: "I had already set that request aside so I could not run it twice",
  ambiguous: "I could not confirm whether it actually ran",
  failed: "it did not come back",
};

type AdjudicateCoverageOptions = {
  /** The account's OWN profile topics this collides with. Non-empty means the operator ruled it out. */
  outOfScopeTopics?: readonly string[];
  /** The comparison Evidence bought for THIS topic, or why it is not in hand. Absent = never asked for. */
  intersection?: IntersectionEvidence;
  /** The PERSISTED reason a page of my own is unread (never fetched here): a robots refusal is the site
   *  telling me no, a page that did not answer is a wait. Both carry the day I already promised. */
  ownedRead?: OwnedPageReadOutcome | null;
  /** Injected so a retry hold is judged against the caller's clock, never the wall. */
  now?: Date;
  /** This account's own site, so its own pages never count toward the winner supply. */
  site?: string | null;
  /** WHAT IS WRONG WITH HOW THIS ACCOUNT'S PAGES ARE SERVED. Only the four faults that stop a page being
   *  served at all count, and only against a page that could BE the answer. Absent means nobody looked. */
  technical?: readonly TechnicalFinding[];
  /** What the winners have in common (decision/winning-pattern). EVIDENCE, never a gate: no verdict below
   *  turns on it, and its absence is simply a shorter receipt. */
  pattern?: WinningPattern | null;
};

type Ev = { id: string; fact: string };
/** The receipt lines one verdict may carry: never an unbounded blob riding a decision. */
const MAX_EVIDENCE = 24;
const num = (n: number): string => n.toLocaleString("en-US");
const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "a day I did not record");
/** A DAY I AM PROMISING, in words, never a stamp. A raw 2026-08-11 in front of an operator standing in
 *  2026-08-11 reads as a delay that is already over, so a date that has arrived says so and is due now. */
const when = (iso: string, at: number): string => {
  const days = Math.ceil((Date.parse(iso) - at) / 86_400_000);
  return days <= 0 ? "today" : days <= 1 ? "tomorrow" : days <= 6 ? "later this week" : days <= 13 ? "next week" : "in a couple of weeks";
};
/** How big this subject is, in the one number I actually hold for it. Never a figure I did not observe. */
const sized = (inv: TopicInvestigation): string => inv.demand.monthlySearchVolume != null
  ? `"${inv.label}" gets about ${num(inv.demand.monthlySearchVolume)} searches a month`
  : inv.demand.gscImpressions != null ? `"${inv.label}" showed up in Google ${num(inv.demand.gscImpressions)} times for you over 90 days`
    : `I hold no monthly count for "${inv.label}"`;
/** A page COULD be the answer only on a strong signal; shared wording alone is a hint, not a reason. */
const contender = (c: OwnedCandidate): boolean => c.strongSignals > 0;

/** The faults that stop a page being served AT ALL. A missing heading or a duplicate title is a real change
 *  and never one of these: those pages still rank, so they go through the ordinary ladder. */
const BLOCKING: ReadonlySet<TechnicalKind> = new Set<TechnicalKind>(["non_200", "redirect_chain", "canonical_conflict", "robots_noindex"]);

/** ONE reading of the bought comparison, counted by PUBLISHER inside Evidence. An answer I
 *  cannot read is treated exactly like a call that never came back, and every step that
 *  reasons over the comparison reads it through here so no two of them read it differently. */
export function readComparison(x: IntersectionEvidence | undefined, candidates: readonly OwnedCandidate[]): PageCoverageReading | null {
  if (!x || "unavailable" in x) return null;
  const mine = candidates.filter(contender)[0];
  try { return comparePageCoverage(x, mine ? absolute(mine.url) : null); } catch { return null; }
}

/** What the pages that win here ARE, in words an operator reads. */
const SHAPE: Record<string, string> = { informational_guide: "guides that explain the subject", list: "lists", definition: "short definitions",
  comparison: "comparisons", product: "product pages", category: "category pages", tool: "tools people use", forum: "discussion threads" };

/** The evidence a verdict may cite, each id paired with the plain fact behind it.
 *  Nothing enters this list that was not observed. */
function evidenceOf(inv: TopicInvestigation, candidates: readonly OwnedCandidate[], x?: PageCoverageReading | null, p?: WinningPattern | null): Ev[] {
  const out: Ev[] = [];
  const d = inv.demand;
  const demand = [
    d.monthlySearchVolume != null ? `about ${num(d.monthlySearchVolume)} searches a month` : null,
    d.gscImpressions != null ? `${num(d.gscImpressions)} views in Google over 90 days` : null,
    d.trackedPrompts > 0 ? `${d.trackedPrompts} of your tracked questions ask it` : null,
  ].filter((s): s is string => !!s).join(", ");
  if (demand) out.push({ id: "demand", fact: `People look for "${inv.label}": ${demand}.` });
  if (inv.pageType !== "unknown" && inv.pageType !== "mixed") {
    out.push({ id: "shape", fact: `What wins here is ${SHAPE[inv.pageType] ?? "one settled shape"}, and ${inv.distinctResultDomains} sites come up for it.` });
  }
  inv.exactSerps.forEach((s, i) => out.push({ id: `results${i + 1}`,
    fact: `I looked at Google for "${s.query}" on ${day(s.observedAt)}: ${s.organicResults} results from ${s.distinctDomains} sites.` }));
  inv.winners.filter((w) => w.extractState === "current").forEach((w, i) => out.push({ id: `winner${i + 1}`,
    fact: `${w.domain} wins here, and I read its page on ${day(w.fetchedAt)}${w.wordCount != null ? `, ${num(w.wordCount)} words` : ""}, ${w.headings} sections.` }));
  candidates.forEach((c, i) => out.push({ id: `owned${i + 1}`,
    // ITS OWN WORDS, not just its address: deciding "you already have this page" from a slug
    // and a title is the guess this slice exists to replace, and the body was already bought.
    fact: [`Your page ${c.url}${c.title ? ` ("${c.title}")` : ""}`,
      c.h1 && c.h1 !== c.title ? `Its heading reads "${c.h1}".` : null,
      c.wordCount != null ? `It runs ${num(c.wordCount)} words across ${c.outlineLength} sections.` : null,
      c.openingSample ? `It opens: "${c.openingSample.slice(0, 320)}".` : "I do not hold this page's own words.",
      c.entities.length > 0 ? `It names ${c.entities.slice(0, 8).join(", ")}.` : null,
      c.signals.map((sg) => sg.detail).join(" "),
    ].filter(Boolean).join(" ") }));
  if (x) out.push({ id: "shared", fact: `I put the pages that win here side by side search by search: ${num(x.shared.length)} searches come up on pages from at least two of ${x.winnerPublishers.length} sites${x.uncoveredByOwned.length > 0 ? `, and you come up for none of ${x.uncoveredByOwned.length} of those` : ""}.` });
  // WHAT THOSE PAGES HAVE IN COMMON, in my own words and counted from the pages the reading cited. Not one
  // line here carries a competing page's own wording: the pattern is what several of them agree on, said
  // plainly, which is the only form of it an operator can act on without copying anybody.
  if (p) {
    out.push({ id: "pattern", fact: `I read the ${p.winners} pages that win here side by side, and they settle on ${SHAPE[p.archetype] ?? "one kind of page"}.` });
    if (p.openingPattern) out.push({ id: "opening", fact: `Those pages open the same way: ${p.openingPattern}` });
    p.commonHeadings.slice(0, 4).forEach((h, i) => out.push({ id: `common${i + 1}`, fact: `${h.seenOn.length} of the ${p.winners} cover ${h.heading}.` }));
    p.ownedGaps.slice(0, 4).forEach((g, i) => out.push({ id: `gap${i + 1}`, fact: `Your own page does not do what ${g.seenOn.length} of them do: ${g.gap}` }));
    p.disagreements.slice(0, 2).forEach((d, i) => out.push({ id: `split${i + 1}`, fact: `The winning pages do not agree here, so I am not settling it for them: ${d}` }));
  }
  return out;
}

/**
 * The FINAL, deterministic reading of the page by page comparison. Nothing here
 * asks a model: the provider already reported which pages rank for which searches,
 * and Evidence already counted it by PUBLISHER, so the verdict is arithmetic over
 * facts. This is the only place `create_new` is reachable.
 */
function readIntersection(
  inv: TopicInvestigation, ids: string[], x: IntersectionEvidence, r: PageCoverageReading | null, contenders: readonly OwnedCandidate[], at: number,
): CoverageDecision {
  if (r == null || "unavailable" in x) return refuse(inv, ids, "page_intersection",
    `I have not been able to compare the pages that win for "${inv.label}" against your own yet because ${"unavailable" in x ? UNAVAILABLE[x.unavailable] : "I could not read what came back"}, so I am telling you to build nothing until I have. I will try it again on your next visit.`,
    "A comparison I could not finish is not evidence that a page of yours is missing.");
  const n = r.shared.length;
  if (n < MIN_SHARED_SEARCHES) return decide(inv, "do_nothing", { evidenceKeys: ids,
    explanation: `I compared the pages that win for "${inv.label}" and they only have ${n} searches in common, so there is no settled pattern here worth a page of your own and I would spend the time on a page you already have.`,
    alternativesRuledOut: [{ alternative: "Write a new page for this", reason: "The pages that win here do not agree on a set of searches, so there is nothing settled for a new page of yours to be about." }] });
  if (r.intent === "conflicts") return refuse(inv, ids, "intent",
    `The ${n} searches those winning pages share do not agree on what a searcher is trying to do, so I am not judging your pages against a goal I cannot name yet.`,
    "A page built for searches that want different things answers none of them well.");
  // A PAGE THAT ALREADY CARRIES THE CLUSTER IS THE ANSWER. Putting a second one beside it
  // splits the very searches it already wins, which is the duplicate this file exists to
  // stop. Candidates arrive strongest signal first, so this names the best-evidenced page
  // on that site rather than whichever one sorted first.
  const held = contenders.find((c) => publisherHost(absolute(c.url)) === r.ownedHost) ?? contenders[0];
  if (r.ownedHoldsMaterialShare === true && held) return decide(inv, "improve_existing", { ownedUrls: [held.url], evidenceKeys: ids,
    explanation: `Your page ${held.url} already comes up for ${r.ownedCoveredKeywords} of the ${n} searches the winning pages for "${inv.label}" share, so I would strengthen that page rather than add a second one that competes with it.`,
    alternativesRuledOut: [{ alternative: "Write a new page for this", reason: "You already reach this cluster on a page of your own, and a second page would split it." }] });
  // THE GAP IS PROVED FROM ADDRESSES; THE PAGE IS WRITTEN FROM WORDS. A create_new I cannot write
  // holds the one decided slot and blocks every topic that could be acted on, so the bodies are asked
  // for BEFORE the verdict, and when every winner has refused me there is nothing left to ask and it parks.
  if (inv.currentReadableWinners < MIN_WRITABLE_WINNERS) {
    // A READ DUE TOMORROW IS NOT A REFUSAL. Only the publisher's own robots answer refuses me; a timeout,
    // a provider miss, a spending ceiling and a daily limit are all WAITS, and a hold that has run out is
    // a page I may read right now. Treating any outcome at all as terminal told the operator that sites
    // which had refused nothing would not let me read them, which was simply untrue.
    const unread = inv.winners.filter((w) => w.extractState !== "current" && w.readOutcome?.state !== "robots_blocked");
    const holds = unread.map((w) => w.readOutcome?.retryAfter).filter((t): t is string => !!t && Date.parse(t) > at).sort();
    if (unread.length > holds.length) return refuse(inv, ids, "winners", `I proved you have no page for "${inv.label}", and I have read ${inv.currentReadableWinners} of the ${MIN_WRITABLE_WINNERS} winning pages I need before I write one, so I am reading the rest next.`,
      "A page written without reading what already wins is a guess, however well it is written.");
    return holds.length > 0
      ? refuse(inv, ids, "winners", `I proved you have no page for "${inv.label}", and I have not finished reading the pages that win it, so I am picking those reads back up ${when(holds[0]!, at)} rather than writing you a page I would be guessing at.`,
          "A read that has not happened yet is not a page anybody refused me, and I will not treat it as one.", holds[0]!)
      : decide(inv, "do_nothing", { evidenceKeys: ids,
        explanation: `I proved you have no page for "${inv.label}", but the sites that win it will not let me read their pages, so I cannot show you what a page of yours would have to cover. I am leaving this alone rather than guessing at it.`,
        alternativesRuledOut: [{ alternative: "Write the page anyway", reason: "Writing it blind is a guess, and I will not hand you one. I pick this back up on its own the day a different site I can read comes up for this search." }] });
  }
  return decide(inv, "create_new", { evidenceKeys: ids,
    explanation: r.ownedCoveredKeywords === 0
      ? `The pages that win for "${inv.label}" have ${n} searches in common that no page of yours comes up for at all, so this is a real gap and a page of your own is the right answer.`
      : `Your pages come up for only ${r.ownedCoveredKeywords} of the ${n} searches the winning pages for "${inv.label}" share, which is too little to build on, so a page of your own is the right answer.`,
    alternativesRuledOut: [{ alternative: "Improve a page you already have",
      reason: r.ownedCoveredKeywords === 0
        ? "Not one page of yours comes up for a single search in that cluster, so there is nothing here to strengthen."
        : "The pages of yours that touch this cluster reach too little of it to carry the rest." }] });
}

const decide = (inv: TopicInvestigation, verdict: CoverageDecision["verdict"], parts: Partial<CoverageDecision>): CoverageDecision =>
  ({ verdict, topicKey: inv.key, ownedUrls: [], evidenceKeys: [], missing: [], alternativesRuledOut: [], explanation: "", ...parts });

/** THE ONE PURCHASE, in the operator's own words, so a refusal says what would change it rather than only
 *  what is missing. Three kinds is the whole vocabulary Evidence can offer, so this map is total. */
const ACQUIRE: Record<NonNullable<TopicInvestigation["nextAcquisition"]>["kind"], (subject: string) => string> = {
  read_winner: (s) => `reading ${s}`,
  buy_serp: (s) => `buying the results page for "${s}"`,
  buy_volume: (s) => `pricing how many people search "${s}" in a month`,
};

/** THE ONE REQUIREMENT THAT STOPS PAYING. Research that can never close is a loop, not a plan: nothing any
 *  provider sells tells me what a searcher wants when the priced searches disagree, so once Evidence says
 *  there is nothing left to buy here, this becomes a decision instead of the same question on every visit.
 *  The other five are NOT here on purpose: the exact and fresh looks and the winner reads are queued by the
 *  coverage pass off the topic's own search, a page of my own is read inside that pass, and the comparison
 *  is bought by its own ask, so none is stuck merely because `nextAcquisition` names nothing. A refusal that
 *  is only WAITING on a promised date never falls through here either. */
const STOPS_PAYING: ReadonlySet<MissingRequirement> = new Set<MissingRequirement>(["intent"]);

/** An honest refusal: the topic stays under investigation, nothing is created, `missing` names the ONE
 *  thing that would move it forward, and the purchase that closes it rides along. */
const refuse = (
  inv: TopicInvestigation, ids: string[], missing: MissingRequirement, explanation: string, reason: string, hold: string | null = null,
): CoverageDecision => {
  const buy = inv.nextAcquisition;
  if (!hold && inv.diminishing && STOPS_PAYING.has(missing)) return decide(inv, "do_nothing", { evidenceKeys: ids,
    explanation: `${explanation} Nothing more I can buy moves this today. It moves again when your own numbers move.`,
    alternativesRuledOut: [{ alternative: "Keep researching this", reason: "Nothing more I can buy moves this today. It moves again when your own numbers move." }] });
  const d = decide(inv, "research_needed", { evidenceKeys: ids, missing: [missing],
    explanation: buy ? `${explanation} What changes this: ${ACQUIRE[buy.kind](buy.subject)}.` : explanation,
    alternativesRuledOut: [{ alternative: "Write a new page for this", reason }], ...(buy ? { acquisition: buy } : {}) });
  return hold ? { ...d, hold } : d;
};

/** A TERMINAL PARK: this case is closed on the evidence I hold, it owes nothing, no purchase
 *  can move it, and it names the exact evidence change that would reopen it on its own. It is
 *  a decision, not a queue entry, so the same impossible requirement is never asked for twice. */
const park = (inv: TopicInvestigation, ids: string[], explanation: string, reopens: string): CoverageDecision =>
  decide(inv, "do_nothing", { evidenceKeys: ids, explanation: `${explanation} ${reopens}`,
    alternativesRuledOut: [{ alternative: "Keep researching this", reason: "No search I could run settles this; only Google's own results changing does, and I check those every week anyway." }] });

/** THE one answer wherever the ladder lands on "the comparison is all that is still owed".
 *  It was written out three times, and three copies of one sentence drift apart. */
const owesComparison = (inv: TopicInvestigation, ids: string[]): CoverageDecision => refuse(inv, ids, "page_intersection",
  `I know what wins for "${inv.label}", and I have not yet compared it page by page against what you already own, so I am buying that comparison before I tell you to build anything.`,
  "The last time I skipped this comparison I shipped copies of pages this account already owned, so I am not skipping it again.");

/**
 * ONE evidence-bound verdict for ONE researched topic. Deterministic refusals
 * cost nothing; at most one strict model call is ever made, and its answer is
 * thrown away whole rather than trusted in part.
 */
export async function adjudicateCoverage(
  inv: TopicInvestigation,
  candidates: readonly OwnedCandidate[],
  tenantId: string,
  opts: AdjudicateCoverageOptions = {},
): Promise<CoverageDecision> {
  // ONE reading of the comparison and ONE receipt for the whole verdict, built here rather than inside the
  // ladder so the words leave with the decision instead of dying in the function that wrote them.
  const reading = readComparison(opts.intersection, candidates);
  const raw = evidenceOf(inv, candidates, reading, opts.pattern);
  // THE CAP DROPS THE REPEATED LINES, NEVER THE PATTERN. A plain slice cut from the END, which is
  // exactly where the pattern block sits, so the richest cases lost their owned gaps and conflicts
  // while evidenceKeys still claimed them. Repeated look and winner lines are shed first, the pattern
  // block is kept whole, and the ids are sliced WITH the facts so the two can never disagree.
  const isPattern = (id: string): boolean => /^(pattern|opening|common\d+|gap\d+|split\d+)$/.test(id);
  const ev = raw.length <= MAX_EVIDENCE ? raw : (() => {
    const keep = raw.filter((e) => isPattern(e.id));
    const rest = raw.filter((e) => !isPattern(e.id));
    return [...rest.slice(0, Math.max(0, MAX_EVIDENCE - keep.length)), ...keep].slice(0, MAX_EVIDENCE);
  })();
  const d = { ...(await ladder(inv, candidates, tenantId, opts, ev, reading)), evidence: ev };
  // THE PATTERN RIDES THE VERDICT THAT CAN STILL BECOME WORK, and no other. A refusal or a park is a
  // decision to build nothing, so hanging a page plan off it would hand the next step a plan for a page
  // this ladder just declined. The receipt above already carries the same pattern as plain facts.
  return opts.pattern && (d.verdict === "create_new" || d.verdict === "improve_existing") ? { ...d, pattern: opts.pattern } : d;
}

async function ladder(
  inv: TopicInvestigation,
  candidates: readonly OwnedCandidate[],
  tenantId: string,
  opts: AdjudicateCoverageOptions,
  ev: readonly Ev[],
  reading: PageCoverageReading | null,
): Promise<CoverageDecision> {
  const x = opts.intersection;
  const ids = ev.map((e) => e.id);

  const outOfScope = (opts.outOfScopeTopics ?? [])[0];
  if (outOfScope) return decide(inv, "do_nothing", { evidenceKeys: ids, explanation: `I left "${inv.label}" alone because your business setup lists "${outOfScope}" as something you do not want to cover.`,
    alternativesRuledOut: [{ alternative: "Write a new page for this", reason: "You told me this is not a topic you want, so building for it would be work you never asked for." }] });

  // A PAGE SEARCH ENGINES CANNOT SERVE IS NOT A PAGE TO REWRITE. When the page of this account that could be
  // the answer here answers nothing, hops twice, hands its address to somebody else or carries a robots tag
  // holding it out, no wording earns a click on it: the plumbing IS the whole of the earned work, and saying
  // "improve this page" over the top of that would be a morning spent on words nobody can reach.
  const blocked = (opts.technical ?? []).filter((f) => BLOCKING.has(f.kind));
  const hurt = candidates.filter(contender).find((c) => blocked.some((f) => canonicalUrlKey(f.url) === canonicalUrlKey(c.url)));
  const fault = hurt ? blocked.find((f) => canonicalUrlKey(f.url) === canonicalUrlKey(hurt.url))! : null;
  if (hurt && fault) return decide(inv, "technical_only", { ownedUrls: [hurt.url], evidenceKeys: ids,
    explanation: `${fault.evidence} Until that is fixed nothing I write for "${inv.label}" can earn you anything, so the one thing worth doing here is this: ${fault.exactFix}`,
    alternativesRuledOut: [{ alternative: "Improve the words on that page", reason: "Better words on a page search engines are not serving win nothing, so this comes first." }] });

  if (inv.exactSerps.length === 0 || inv.serpFreshness === "missing") return refuse(inv, ids, "exact_serp", `I have not looked at Google's results for "${inv.label}" yet, so I cannot say whether one of your pages already answers it. That search is first in line on my next research pass.`,
    "I cannot call a page missing before I have seen what already answers the search.");
  if (inv.serpFreshness !== "current") return refuse(inv, ids, "fresh_serp", `${inv.serpFreshness === "undated" ? `I hold Google's results for "${inv.label}" but not when I looked at them` : `My last look at Google's results for "${inv.label}" is out of date`}, so I am checking again before I decide anything about your pages.`,
    "A decision made on an out of date look at Google is a guess, and I will not hand you one.");
  // SHAPE AND INTENT FIRST. Both are already decided by the results page on file, so reading
  // three more pages for a topic I will refuse anyway spends fetches to reach the same no.
  if (inv.serpCoherence !== "coherent") return refuse(inv, ids, "intent", `The results for "${inv.label}" answer more than one meaning of the phrase, so I cannot yet say what a searcher actually wants and I will not judge your pages against it until I can.`,
    "A page built for a phrase that means two things answers neither of them well.");
  // A SHAPE THAT WILL NOT SETTLE IS AN ANSWER, NOT AN ERRAND. This used to be a research
  // requirement nothing could ever buy: no search closes it, so the topic was silently
  // re-refused on every visit forever. The current look already settled it, so it is parked
  // here with the exact evidence change that would reopen it and is never queued again.
  if (inv.pageType === "mixed" || inv.pageType === "unknown") return park(inv, ids,
    inv.pageType === "mixed"
      ? `The pages that win for "${inv.label}" are split across ${inv.pageTypeVotes.length} different kinds of page, so there is no one shape a page of yours could take to compete, and I am leaving this alone rather than guessing.`
      : `Too few of the ${inv.distinctResultDomains} sites that come up for "${inv.label}" land on a kind of page I recognise, so I cannot tell you what a page of yours would have to be.`,
    `I will pick this back up on its own the day one kind of page takes the lead in Google's results for "${inv.label}".`);
  if (inv.demand.intent == null) return refuse(inv, ids, "intent", `I do not yet know what someone searching "${inv.label}" is actually trying to do, so I am not judging your pages against a goal I cannot name.`,
    "A page aimed at a purpose I am guessing at is a page aimed at nothing.");
  // THREE PUBLISHERS I CAN NAME AND ADDRESS. This counted READ pages, and the comparison it
  // gates compares addresses, so a topic whose winners I could not fetch owed a purchase I
  // could always have made. Reading those pages matters when a page gets WRITTEN, not here.
  // A REQUIREMENT THE CURRENT RESULTS PAGE CANNOT SUPPLY IS A DECISION, NOT AN ERRAND. This re-asked the
  // topic's OWN already-current search, so a results page whose sites are all profiles and discussion
  // threads asked the identical question forever. Count what that page can actually give me first.
  const named = rankedPublishers(inv);
  if (named.length < MIN_ADJUDICATION_WINNERS) {
    const supply = eligiblePublishers(inv, candidates, opts.site ?? null);
    return supply >= MIN_ADJUDICATION_WINNERS
      ? refuse(inv, ids, "winners", `I can name ${named.length} of the ${MIN_ADJUDICATION_WINNERS} sites that win for "${inv.label}", and ${supply} of them are on the results I already hold, so I am banking those pages next.`,
        `One or two pages are one or two publishers' opinions, and I need ${MIN_ADJUDICATION_WINNERS} sites agreeing before I call anything a pattern.`)
      : park(inv, ids, `${supply === 0 ? "None" : `Only ${supply}`} of the sites that come up for "${inv.label}" are pages I could learn anything from, and the rest are profiles and discussion threads, so I have nothing to hold your own pages against.`,
        `I will pick this back up on its own the day Google's results for "${inv.label}" bring different sites.`);
  }

  const contenders = candidates.filter(contender);
  const unread = contenders.find((c) => !c.bodyHeld);
  if (unread) {
    const at = (opts.now ?? new Date()).getTime();
    // A PAGE I COULD NOT READ IS NOT A PAGE I HAVE NOT TRIED, and the two reasons are not one reason. BOTH
    // NAME A DAY NOW, and it is the day already stored against that URL, so it is identical on every visit
    // and across every deploy until the retry is genuinely due. It used to promise nothing at all, because
    // the failure lived only inside one render and the same URL was refetched on the very next visit.
    // AN EXPIRED HOLD IS NOT A PROMISE. The winners branch already drops a date that has passed; this
    // one printed a stored July 20 to an operator standing in July 26, which is stable and still false.
    const stored = opts.ownedRead && opts.ownedRead.url === unread.url ? opts.ownedRead : null;
    const failed = stored && Date.parse(stored.retryAfter) > at ? stored : null;
    if (failed?.state === "robots_blocked") return refuse(inv, ids, "owned_content",
      `Your site's robots rules stopped me from reading ${unread.url}, so I cannot check whether it already answers "${inv.label}". I check again ${when(failed.retryAfter, at)}.`,
      "I will not call a page missing while a page of yours that might already answer it is one your own site tells me not to read.", failed.retryAfter);
    if (failed) return refuse(inv, ids, "owned_content",
      `I could not read ${unread.url}, so I cannot yet say whether it already answers "${inv.label}". I try it again ${when(failed.retryAfter, at)}.`,
      "A page that did not answer me today is not a page anybody refused me, and I will not treat it as one.", failed.retryAfter);
    return refuse(inv, ids, "owned_content", `Your page ${unread.url} could already be the answer to "${inv.label}", and I do not hold its own words yet, so I am reading it before I say anything about it.`,
      "I will not call a page missing while one of yours that might already answer it sits unread.");
  }
  // EVERY CHEAPER CHECK IS BEHIND US, so this is the one topic that earned the paid
  // comparison. With it in hand the verdict is final and free; without it the topic
  // stays an investigation, whichever way the rest of the evidence leans.
  if (x) return readIntersection(inv, ids, x, reading, contenders, (opts.now ?? new Date()).getTime());
  // NOTHING OF YOURS IS AT RISK HERE, SO THERE IS NOTHING FOR THE COMPARISON TO PROTECT. That purchase exists
  // to stop me shipping a copy of a page this account already owns, and no page of this account even touches
  // this subject: no contender, no duplicate, no reason to hold real work behind a provider. With the shape
  // settled above and enough winners READ to say what the page has to cover, the verdict is made now and the
  // card owns the guess in its own words. A subject you DO have a page for still waits for the comparison.
  if (contenders.length === 0) return inv.currentReadableWinners < MIN_WRITABLE_WINNERS ? owesComparison(inv, ids)
    : decide(inv, "create_new", { evidenceKeys: ids,
      explanation: `${sized(inv)}, the sites that win it settle on ${SHAPE[inv.pageType] ?? "one kind of page"}, and I have read ${inv.currentReadableWinners} of them, so here is the page I would build. You own no page that comes up for this at all, so there is nothing of yours a search by search comparison could protect.`,
      alternativesRuledOut: [{ alternative: "Improve a page you already have", reason: "No page of yours comes up for this subject, so there is nothing here to strengthen." }] });

  // NO MODEL RUNS HERE, AND NONE IS NEEDED. Every verdict above is arithmetic over facts
  // the provider already reported, so the ladder is free, repeatable and checkable. The
  // judgment-model path this file once carried was never reachable (nothing ever turned it
  // on, and no screen read a model-quality verdict), so it is gone rather than dormant.
  return owesComparison(inv, ids);
}
