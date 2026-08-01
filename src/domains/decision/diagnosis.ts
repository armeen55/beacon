/**
 * decision/diagnosis (V1 Truth Convergence Phase 4, 2026-07-31): THE CAUSE LADDER. One page loses clicks
 * for exactly one reason I can name, and until this file existed there was only ever one reason on offer:
 * the wording of the line Google displays. Every other page in the account came back "I can see the gap and
 * I cannot tell you what to change", which is honest and useless, because the account's real losses are two
 * of its own pages splitting one search, a subject its page never covers, an opening that answers nothing,
 * and engines citing everybody else.
 *
 * SO EVERY CAUSE IS ASKED, IN ONE FIXED ORDER, AND EACH ONE ANSWERS FOR ITSELF:
 *   1 does it HOLD what this cause is decided from? No, and the cause is NOT CONSIDERED, by name, with the
 *     exact thing missing. It is never guessed at, never softened into a maybe, and never counted as ruled out.
 *   2 does the evidence FIRE the cause? Yes, and it carries the receipt ids it was read off. No, and the
 *     deterministic reason it lost rides on the winner as a competing explanation.
 * The first cause that fires wins, and the order is evidence strength: two of your own pages on one search
 * beats a wording read, a wording read beats a subject the winners share, a subject beats a shape, and an
 * engine that never cites you is the weakest of the lot. Nothing below the winner is discarded: up to three
 * of them ship WITH it, so the operator can see what else was on the table.
 *
 * EVERY DIAGNOSIS NAMES WHAT WOULD KILL IT. `falsifier` is one plain sentence stating the observation that
 * would prove this cause wrong, so a diagnosis is a claim that can lose rather than a label that sticks.
 *
 * NOTHING DRAFTS WITHOUT A NAMED CAUSE, and a named cause is not a licence to draft: `action` is the
 * EXISTING action vocabulary and it is null for every cause whose fix is not a copy edit this kernel can
 * write. A page whose cause names no edit is watched, with the cause said out loud, which is the whole
 * difference between "I am looking into it" and "here is what is wrong".
 *
 * PURE + deterministic. No I/O, no LLM, no clock. The same evidence in any order produces a byte-identical
 * finding, and no cause in here reads anything the pass did not already pay for.
 */

import { anchoredTopicMatch, canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { classifyResult, publisherHost } from "@/domains/evidence/serp-shape";
import type { ActionDiagnosis, DiagnosedAction } from "./contracts";
import type { DecidedTopic } from "./coverage-pass";
import { RECEIPT } from "./diagnose";

/** WHY one page loses the click, as ONE closed vocabulary. Every member below is decided from evidence
 *  this account already holds, or it is not considered at all; there is no member here that means "some
 *  other reason", because a cause I cannot name is exactly the answer `no_problem` plus a missing input. */
type CandidateCause =
  | "cannibalization"
  | "ctr_snippet"
  | "competitor_content_gap"
  | "incomplete_coverage"
  | "weak_opening"
  | "serp_shape_shift"
  | "intent_shift"
  | "internal_link_weakness"
  | "ai_citation_gap"
  | "demand_decline"
  | "ranking_loss"
  | "retrieved_not_cited"
  | "technical_indexability"
  | "measuring_change"
  | "no_problem";

/** ONE cause, everything it was read off, and everything it beat. Carried INSIDE the candidate (no new
 *  record, no new table, no new route), so a receipt renders the whole reasoning step or none of it. */
export type CauseFinding = {
  cause: CandidateCause;
  /** The edit this cause supports, in the EXISTING action vocabulary. null = no copy edit follows from it,
   *  which is a real answer and the reason a named cause still never manufactures a draft. */
  action: DiagnosedAction | null;
  /** Receipt item ids behind the cause. Empty = nothing may be claimed from it. */
  evidenceKeys: string[];
  /** Other causes considered and why each lost, strongest first. Bounded to three. */
  competingExplanations: Array<{ cause: CandidateCause; reason: string }>;
  /** The one observation that would prove this diagnosis wrong. */
  falsifier: string;
  /** One plain first-person sentence the operator reads. No lab words. */
  explanation: string;
  /** Causes whose evidence inputs are NOT on file, each with the exact thing missing. Never inferred,
   *  never counted as ruled out: the absence is the finding. */
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
   *  "I have not looked yet" is a reading too, so this is never null and the wording cause is always asked. */
  serpRead: ActionDiagnosis;
  /** The ONE topic this pass decided, when it decided one. Only the page that verdict NAMES may be judged
   *  by it: a pattern read against somebody else's page proves nothing about this one. */
  coverage: DecidedTopic | null;
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
  | { fired: true; action: DiagnosedAction | null; evidenceKeys: string[]; explanation: string }
  | { fired: false; reason: string };

type Rule = {
  cause: CandidateCause;
  /** The exact thing missing, or null when every input this cause needs is on file. */
  held: (c: Ctx) => string | null;
  read: (c: Ctx) => Verdict;
  falsifier: (c: Ctx) => string;
  /** The alternative this cause structurally rules out, so a finding always ships with one. */
  rulesOut: { cause: CandidateCause; reason: string };
};

const quote = (s: string): string => `"${s}"`;
const list = (t: readonly string[]): string => t.slice(0, 3).map(quote).join(", ");
const num = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Sites that ARE this account, rolled up one way: a page on my own subdomain is still mine. */
function ownHosts(snapshot: EvidenceSnapshot): Set<string> {
  const hosts = snapshot.ownedPages.map((p) => publisherHost(p.url)).filter((h) => h.includes("."));
  const site = publisherHost(snapshot.scope.site ?? "");
  return new Set([...hosts, ...(site ? [site] : [])]);
}

/** Why the wording read did not name the title, in the operator's words. One sentence per conclusion that
 *  reading can reach, so "the results page did not accuse the wording" is never a shrug. */
function serpLoss(d: ActionDiagnosis): string {
  if (d.cause === "google_rewrite_already_matches") return "Google already shows this page with the words people are searching for, so its stored wording is not what loses the click";
  if (d.cause === "wrong_page_ranking") return "this page does not come up for that search at all, so its wording is not what loses the click";
  if (d.cause === "serp_market_mismatch") return "the one check I ran did not show this page, so I cannot read the line a searcher actually sees";
  if (d.cause === "ambiguous_search_intent") return "the pages that beat this one share no wording it is missing";
  return "I have not looked at the results page for that search yet, so the wording accuses nothing";
}

// ── the ladder, strongest evidence first ─────────────────────────────────────

const RULES: Rule[] = [
  {
    // TWO OF YOUR OWN PAGES ON ONE SEARCH is the one cause no wording change can touch, so it is asked
    // before every wording question. Read off the account's own rankings, never off a family of URLs.
    cause: "cannibalization",
    held: (c) => (c.snapshot.cannibalization.length > 0
      || c.snapshot.research.retainedKeywords.some((k) => canonicalQueryKey(k.query) === c.queryKey && k.supports != null)
      ? null
      : "I have not checked which of your own pages Google serves for that exact search."),
    read: (c) => {
      const group = c.snapshot.cannibalization.find((g) => canonicalQueryKey(g.query) === c.queryKey
        && g.competingUrls.some((u) => canonicalUrlKey(u) === c.urlKey));
      const kw = c.snapshot.research.retainedKeywords.find((k) => canonicalQueryKey(k.query) === c.queryKey && k.supports === "consolidation");
      if (!group && !kw) return { fired: false, reason: "only one page of yours comes up for that search, so nothing of yours is taking the click from it" };
      const pages = group?.competingUrls.length ?? 2;
      return { fired: true, action: "consolidate", evidenceKeys: [RECEIPT.gsc, RECEIPT.competing],
        explanation: `${num(pages)} of your own pages come up for ${quote(c.query)}, so Google is picking between them and the clicks split. I would settle which page owns that search before changing a word on either of them.` };
    },
    falsifier: (c) => `If my next look shows only one page of yours coming up for ${quote(c.query)}, this is not the explanation.`,
    rulesOut: { cause: "ctr_snippet", reason: "a sharper line cannot fix two of your own pages competing for the same search" },
  },
  {
    // THE LINE A SEARCHER ACTUALLY READS, off the exact results page. decision/diagnose owns this read and
    // is the only place allowed to conclude it; here it is one rung of the ladder like every other cause.
    cause: "ctr_snippet",
    held: () => null,
    read: (c) => (c.serpRead.status === "diagnosed" && c.serpRead.action === "title"
      ? { fired: true, action: "title", evidenceKeys: c.serpRead.evidenceKeys, explanation: c.serpRead.explanation }
      : { fired: false, reason: serpLoss(c.serpRead) }),
    falsifier: () => "If Google starts displaying this page with the wording the pages beating it share, and the click rate does not move, the wording was not the cause.",
    rulesOut: { cause: "competitor_content_gap", reason: "the line a searcher reads is what loses the click here, and that is wording rather than a subject the page never covers" },
  },
  {
    // WHAT MY PAGE DOES NOT DO, and only ever about the page the verdict actually put in front of the
    // reading. A gap written about a page nobody supplied is an invention, which is why it is gated here too.
    cause: "competitor_content_gap",
    held: (c) => (c.pattern ? null : "I hold no reading of what the pages winning this subject have in common, taken against this page."),
    read: (c) => {
      const gaps = c.pattern!.ownedGaps;
      if (gaps.length === 0) return { fired: false, reason: "the pages that win this subject do nothing this page does not already do" };
      const first = gaps[0]!;
      return { fired: true, action: null, evidenceKeys: [RECEIPT.winners, RECEIPT.winnersGap],
        explanation: `I read the ${c.pattern!.winners} pages that win this subject side by side, and ${first.seenOn.length} of them do something this page does not: ${first.gap}` };
    },
    falsifier: () => "If a page of yours already does that and I simply had not read it, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "the pages beating this one carry something it does not, so a sharper line would send people to a page that still does not answer them" },
  },
  {
    // THE SECTIONS THEY ALL COVER AND THIS PAGE HAS NONE OF. Counted against the page's own outline, so a
    // page that covers a subject under different words is never accused of missing it.
    cause: "incomplete_coverage",
    held: (c) => (!c.pattern ? "I hold no reading of what the pages winning this subject have in common, taken against this page."
      : !c.page.content ? "I do not hold this page's own sections, so I cannot say what it leaves out." : null),
    read: (c) => {
      const content = c.page.content!;
      const mineTokens = new Set(topicTokens([content.title, content.h1, ...content.outline].filter(Boolean).join(" ")));
      const shared = [...c.pattern!.commonHeadings.map((h) => h.heading), ...c.pattern!.commonEntities.map((e) => e.entity)];
      const absent = shared.filter((s) => { const t = topicTokens(s); return t.length > 0 && !t.some((x) => mineTokens.has(x)); });
      return absent.length === 0
        ? { fired: false, reason: "this page already covers everything the winning pages agree on" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.winners, RECEIPT.winnersHeading, RECEIPT.copy],
          explanation: `The pages that win this subject agree on ${num(shared.length)} things to cover and this page carries none of ${num(absent.length)} of them: ${list(absent)}.` };
    },
    falsifier: () => "If this page covers those under wording I did not match, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "a line that promises what the page does not deliver wins the click and loses the reader" },
  },
  {
    // HOW THE PAGE OPENS, against how every winner opens. The test is not taste: the winners all answer the
    // search in their first words, and this page's first words never say what the search is about.
    cause: "weak_opening",
    held: (c) => (!c.pattern || !c.pattern.openingPattern ? "I hold no reading of how the pages winning this subject open."
      : !openingOf(c) ? "I do not hold this page's own opening words." : null),
    read: (c) => {
      const weak = weakAnchorsOf(c.snapshot.ownedPages, c.snapshot.research);
      const want = topicTokens(c.query).filter((t) => !weak.has(t));
      const opens = new Set(topicTokens(openingOf(c)!));
      const missing = want.filter((t) => !opens.has(t));
      return want.length === 0 || missing.length < want.length
        ? { fired: false, reason: "this page opens by naming what the search is about, so its opening is not what loses the reader" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.winners, RECEIPT.winnersOpening, RECEIPT.body],
          explanation: `The pages that win this subject all open by answering it, and this page's own opening never says ${list(want)}.` };
    },
    falsifier: () => "If the page answers the search in its first lines under wording I did not match, this is not the explanation.",
    rulesOut: { cause: "incomplete_coverage", reason: "the page carries the subject; it is the first thing a reader sees that never says so" },
  },
  {
    // THE KIND OF PAGE THAT WINS, settled in code one gate earlier by counting distinct publishers. A page
    // of a different kind is not losing on wording, and no rewrite turns one kind of page into another.
    cause: "serp_shape_shift",
    held: (c) => (!c.mine ? "I have not settled what kind of page wins this subject."
      : c.mine.investigation.pageType === "mixed" || c.mine.investigation.pageType === "unknown"
        ? "The pages that win this subject do not settle on one kind, so there is no shape to hold this page against."
        : !ownShape(c) ? "I do not hold enough of this page to say what kind of page it is." : null),
    read: (c) => (ownShape(c) === c.mine!.investigation.pageType
      ? { fired: false, reason: "this page is already the same kind of page as the ones winning that search" }
      : { fired: true, action: null, evidenceKeys: [RECEIPT.shape, RECEIPT.copy],
        explanation: `The sites winning ${quote(c.query)} have settled on one kind of page and this page is a different kind, so the distance between them is not something a sharper line closes.` }),
    falsifier: () => "If the results for that search stop agreeing on one kind of page, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "the results have settled on a kind of page this one is not, and wording does not change what a page is" },
  },
  {
    // WHAT THE SEARCHER IS ACTUALLY THERE TO DO, off the intent every priced search in the case agrees on,
    // against what this page is built to do. Only a real disagreement fires; a match or a silence never does.
    cause: "intent_shift",
    held: (c) => (!c.mine || !c.mine.investigation.demand.intent ? "I do not hold what someone searching this is actually trying to do."
      : !ownShape(c) ? "I do not hold enough of this page to say what it is built to do." : null),
    read: (c) => {
      const buying = /^(commercial|transactional)$/i.test(c.mine!.investigation.demand.intent ?? "");
      const sells = SELLING.has(ownShape(c)!);
      return buying === sells
        ? { fired: false, reason: "this page is built for what people searching it are actually trying to do" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.intent, RECEIPT.copy],
          explanation: `People searching ${quote(c.query)} are ${buying ? "ready to choose something" : "trying to understand the subject"}, and this page is written for the other one, so a sharper line would not close that distance.` };
    },
    falsifier: () => "If what people want from that search is not what my keyword research recorded, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "the page answers a different question from the one being asked, and wording cannot answer a question the page does not cover" },
  },
  {
    // WHERE A READER CAN GO NEXT, counted off my own page against the pages that win. Both sides are real
    // counts from reads already paid for, and a subject where nobody links much never accuses anybody.
    cause: "internal_link_weakness",
    held: (c) => (!c.mine ? "I have not compared this page against the pages that win its subject."
      : !c.page.content ? "I do not hold this page's own links." : winnerLinks(c).length < 2
        ? "I hold too few reads of the winning pages to say what they link to." : null),
    read: (c) => {
      const counts = winnerLinks(c);
      const middle = counts[Math.floor(counts.length / 2)]!;
      const mine = c.page.content!.internalLinks.length;
      return middle < MIN_LINK_FLOOR || mine * 2 >= middle
        ? { fired: false, reason: "this page points readers on to as much of your site as the winning pages do of theirs" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.winners, RECEIPT.links],
          explanation: `The pages that win this subject point readers on to about ${num(middle)} more of their own pages and this one points to ${num(mine)}, so people who land here have nowhere to go next.` };
    },
    falsifier: () => "If this page's links are on file and I simply read too few of them, this is not the explanation.",
    rulesOut: { cause: "incomplete_coverage", reason: "the page covers the subject and then strands the reader on it" },
  },
  {
    // READ AND PASSED OVER. The engine's retrieval list held this page and its answer cited somebody
    // else: the page was seen and judged not worth naming, which is a content verdict, not a wording one.
    cause: "retrieved_not_cited",
    held: (c) => (aiAnswers(c).some((o) => (o.retrievedResults ?? null) != null)
      ? null : "I hold what the engines cited, and none of these observations recorded what was read before answering."),
    read: (c) => {
      const hosts = ownHosts(c.snapshot);
      const seen = aiAnswers(c).find((o) => (o.retrievedResults ?? []).some((r) => hosts.has(publisherHost(r.url)))
        && (o.citations ?? []).length > 0 && (o.citations ?? []).every((x) => !hosts.has(publisherHost(x.url))));
      return !seen
        ? { fired: false, reason: "no engine read this page and then cited only other sites" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.ai],
          explanation: `${seen.engine} read this page while answering ${quote(seen.promptText)} and cited ${num((seen.citations ?? []).length)} other sites instead, so the page was seen and passed over, not missed.` };
    },
    falsifier: () => "If an engine that reads this page starts citing it, this is not the explanation.",
    rulesOut: { cause: "ai_citation_gap", reason: "a page the engine read and declined is a harder problem than one it never found" },
  },
  {
    // AN ENGINE THAT CITES EVERYBODY ELSE. Read off the answers already observed for questions about THIS
    // page's search: cited sites that are not mine, and this page never once among them.
    cause: "ai_citation_gap",
    held: (c) => (aiAnswers(c).length > 0 ? null : "I hold no AI answer about that search with its sources on file."),
    read: (c) => {
      const hosts = ownHosts(c.snapshot);
      const rival = aiAnswers(c).find((o) => (o.citations ?? []).length > 0
        && (o.citations ?? []).every((x) => !hosts.has(publisherHost(x.url))));
      return !rival || c.page.aiCitations.count > 0
        ? { fired: false, reason: "AI answers about that search already cite this page" }
        : { fired: true, action: null, evidenceKeys: [RECEIPT.ai],
          explanation: `I read the AI answers about that search: ${rival.engine} answered ${quote(rival.promptText)} and named ${num((rival.citations ?? []).length)} other sites without ever citing this page.` };
    },
    falsifier: () => "If an engine cites this page for that subject on my next look, this is not the explanation.",
    rulesOut: { cause: "ctr_snippet", reason: "an engine that never names this page is not choosing against its wording" },
  },
];

/** A page built to help somebody choose or buy. Everything else reads as a page built to explain. */
const SELLING = new Set(["product", "category", "comparison", "tool"]);
/** Under this many links, nobody on that results page is pointing readers anywhere, so nobody is accused. */
const MIN_LINK_FLOOR = 5;

/** This page's own opening words, from the ONE place the pass already read them. */
const openingOf = (c: Ctx): string | null =>
  c.mine?.candidates.find((x) => canonicalUrlKey(x.url) === c.urlKey)?.openingSample ?? null;

/** What kind of page this one IS, by the same classifier that typed the results it is measured against. */
const ownShape = (c: Ctx): string | null => classifyResult(c.page.content?.title ?? null, c.page.url);

/** How many of their own pages the winners I have READ point on to, sorted, so the middle one is the middle. */
const winnerLinks = (c: Ctx): number[] => {
  const urls = new Set((c.mine?.investigation.winners ?? []).filter((w) => w.extractState === "current").map((w) => canonicalUrlKey(w.url)));
  return c.snapshot.research.winningPages
    .filter((w) => urls.has(canonicalUrlKey(w.url)) && typeof w.extract?.internalLinkCount === "number")
    .map((w) => w.extract!.internalLinkCount!)
    .sort((a, b) => a - b);
};

/** The observed AI answers that are actually ABOUT this page's search, anchored on the account's own
 *  corpus so one word it puts on everything can never pull an unrelated answer in. */
const aiAnswers = (c: Ctx): EvidenceSnapshot["research"]["aiObservations"] => {
  const weak = weakAnchorsOf(c.snapshot.ownedPages, c.snapshot.research);
  return c.snapshot.research.aiObservations.filter((o) => o.citationsObserved && o.citations != null
    && anchoredTopicMatch(c.query, o.promptText, weak).relevant);
};

/** CAUSES THIS GENERATION CANNOT TEST AT ALL, said out loud rather than left as a silence. Each one names
 *  the exact evidence that does not exist yet, so nobody has to wonder whether it was weighed and lost. */
const UNHELD: Array<{ cause: CandidateCause; missing: string }> = [
  { cause: "demand_decline", missing: "I hold one 90 day total for that search and nothing earlier, so I cannot tell a quiet season from a real fall in demand." },
  { cause: "ranking_loss", missing: "I hold one average position for that search and nothing earlier, so I cannot see whether this page moved." },
  { cause: "technical_indexability", missing: "I do not hold this page's indexing or canonical state." },
  { cause: "measuring_change", missing: "I hold no change on this page that is still being measured." },
];

const MAX_COMPETING = 3;

/**
 * THE cause ladder: the one reasoning step between "this page loses clicks" and "here is why". Returns
 * exactly one cause, everything it was read off, what it beat, what would disprove it, and every cause that
 * was never considered because its evidence is not on file. `no_problem` is a real and common answer.
 */
export function diagnoseCauses(input: LadderInput): CauseFinding {
  const named = input.coverage && input.coverage.decision.ownedUrls
    .some((u) => canonicalUrlKey(u) === canonicalUrlKey(input.page.url)) ? input.coverage : null;
  const c: Ctx = {
    ...input,
    queryKey: canonicalQueryKey(input.query),
    urlKey: canonicalUrlKey(input.page.url),
    mine: named,
    // THE PATTERN IS ABOUT ONE PAGE, and only the verdict that names a page of mine ever put one in front
    // of the reading. Wearing another case's pattern is how a gap gets written about a page nobody read.
    pattern: named?.decision.pattern ?? null,
  };

  const notConsidered: CauseFinding["notConsidered"] = [];
  const lost: CauseFinding["competingExplanations"] = [];
  let won: { rule: Rule; verdict: Extract<Verdict, { fired: true }> } | null = null;

  for (const rule of RULES) {
    const missing = rule.held(c);
    if (missing) { notConsidered.push({ cause: rule.cause, missing }); continue; }
    const verdict = rule.read(c);
    if (!verdict.fired) { lost.push({ cause: rule.cause, reason: verdict.reason }); continue; }
    if (won) lost.push({ cause: rule.cause, reason: `the evidence for ${LABEL[won.rule.cause]} is the stronger explanation` });
    else won = { rule, verdict };
  }
  notConsidered.push(...UNHELD);

  if (!won) {
    return { cause: "no_problem", action: null, evidenceKeys: [RECEIPT.gsc], notConsidered,
      competingExplanations: lost.slice(0, MAX_COMPETING),
      falsifier: "If one of the causes I could not weigh here turns out to hold, this is not the answer.",
      explanation: "I can see the gap and nothing I hold names a cause for it yet." };
  }
  // A FINDING ALWAYS SHIPS WITH AN ALTERNATIVE. The winner's own structural rival goes first, then whatever
  // was really weighed and lost, deduped, so a diagnosis is never a label with nothing beside it.
  const competing = [won.rule.rulesOut, ...lost].filter((x, i, all) => all.findIndex((y) => y.cause === x.cause) === i);
  return { cause: won.rule.cause, action: won.verdict.action, evidenceKeys: won.verdict.evidenceKeys,
    competingExplanations: competing.slice(0, MAX_COMPETING), falsifier: won.rule.falsifier(c),
    explanation: won.verdict.explanation, notConsidered };
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

/** The finding for a page nothing accuses: a real answer, carrying the same four things as every other one,
 *  because "leave it alone" deserves a reason and an alternative exactly as much as "change this" does. */
export function noProblemFinding(explanation: string, ruledOut: string): CauseFinding {
  return { cause: "no_problem", action: null, evidenceKeys: [RECEIPT.gsc], explanation, notConsidered: [...UNHELD],
    competingExplanations: [{ cause: "ctr_snippet", reason: ruledOut }],
    falsifier: "If this page's click rate falls below what pages at its position usually earn, this stops being the answer." };
}
