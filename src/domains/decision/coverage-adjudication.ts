import "server-only";

/**
 * decision/coverage-adjudication (N3b, 2026-07-28): the ONE verdict on whether
 * this account ALREADY has the right page for a topic it researched.
 *
 * Generation 5 deleted the new-page generator because it turned a rival's example
 * prompt into an article and shipped duplicates of pages the account already
 * owned. The missing step was never the writing. It was the COMPARISON: nobody
 * asked whether one of this account's own pages was already the answer. That is
 * the only question this file answers, once per topic. It drafts nothing,
 * proposes nothing and persists nothing.
 *
 * DETERMINISTIC GATE FIRST, MODEL SECOND. Every refusal below is decided in code,
 * makes ZERO model calls, costs nothing, and names in `missing` exactly what
 * Runtime must go and buy:
 *   1 the account's own profile rules the topic out -> do_nothing (a verdict, not a gap)
 *   2 no exact results page for the topic           -> exact_serp
 *   3 the results page is out of date               -> fresh_serp
 *   4 under three current readable winners          -> winners
 *   5 mixed or unknown shape, or intent unresolved  -> intent
 *   6 a page that could be the answer whose words I do not hold -> owned_content
 *   7 complete evidence, nothing owned that could be the answer -> page_intersection
 * Gate 7 is why a final `create_new` is NOT reachable in this slice, and that is
 * correct rather than a shortfall: the comparison that would prove a genuine gap
 * has not been bought yet, and the slice that buys it comes next.
 *
 * THE MODEL MAY compare the supplied owned pages, judge whether one already
 * covers the topic in the same shape, pick ONE verdict, name addresses FROM THE
 * SUPPLIED LIST, cite evidence ids FROM THE SUPPLIED LIST, and say why the
 * alternatives lost. IT MAY NOT invent a page, an address, a number, a phrase, a
 * competitor or a fact, change a threshold, recount anything, overrule the gate,
 * or write one word of page copy: no field in its schema could carry a title, a
 * description, an outline or a proposed address. A refusal, an incomplete answer,
 * a schema failure, an unknown id, an address outside the list, or a verdict
 * contradicting a deterministic fact all become `research_needed`, and nothing is
 * created. $0 REPEATS: the call is built ONLY from the topic's material evidence
 * and the candidate set, so identical input hits the cache and never pays twice.
 */

import { log } from "@/lib/logger";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import type { TopicInvestigation } from "@/domains/evidence/topic-investigation";
import type { OwnedCandidate } from "./owned-coverage";
import type { CacheImpl } from "./llm/call-cache";
import { callStructuredLLM, type CompleteFn } from "./llm/structured-drafter";

// ── Coverage adjudication (N3b, 2026-07-28) ──────────────────────────────────

/** THE five honest answers to "does this business already have the right page?".
 *  `create_new` here means the evidence otherwise supports a new page; a mandatory
 *  comparison that has not landed yet keeps it at `research_needed`. */
export type CoverageVerdict =
  | "improve_existing" | "create_new" | "consolidate_or_choose" | "do_nothing" | "research_needed";

/** WHAT is missing, machine-readable, so Runtime can go and buy exactly that. Never a
 *  generic error bucket: "I have no results page" and "the model refused" are different
 *  problems with different fixes, and the operator is owed the difference. */
export type MissingRequirement =
  | "exact_serp" | "fresh_serp" | "winners" | "owned_content" | "intent"
  | "keyword_data" | "page_intersection" | "model_refusal" | "conflicting_evidence"
  /** The winners do not agree on ONE kind of page yet. Different from `intent`: the phrase is
   *  clear, the shape a competing page would need is not. */
  | "shape";

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
  missing: MissingRequirement[];
  alternativesRuledOut: Array<{ alternative: string; reason: string }>;
  /** One plain first-person sentence the operator reads. No lab words. */
  explanation: string;
};

/** A verdict may name a new page only when it is diagnosed, names no owned page as the
 *  answer, and owes nothing. Anything else is an investigation, not a decision. */
export function earnedNewPage(d: CoverageDecision | null | undefined): boolean {
  return !!d && d.verdict === "create_new" && d.missing.length === 0
    && d.ownedUrls.length === 0 && d.evidenceKeys.length > 0 && d.alternativesRuledOut.length > 0;
}


/** A comparison rests on three publishers agreeing, each read recently enough to
 *  trust. Two pages are two opinions, and this file never calls that a pattern. */
export const MIN_ADJUDICATION_WINNERS = 3;

export type AdjudicateCoverageOptions = {
  /** "off" keeps the free deterministic verdict and never pays for the judgment call. */
  model?: "off";
  /** The account's OWN profile topics this investigation collides with
   *  (topicOutOfScope). Non-empty means the operator already ruled it out. */
  outOfScopeTopics?: readonly string[];
  /** Injected for tests; defaults to the real transport inside the drafter. */
  complete?: CompleteFn;
  now?: Date;
  bypassCache?: boolean;
  cacheImpl?: CacheImpl;
};

type Ev = { id: string; fact: string };
const num = (n: number): string => n.toLocaleString("en-US");
const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "a day I did not record");
/** A page COULD be the answer only on a strong signal. Shared wording is a hint,
 *  and a hint has never been a reason to leave a page out of the comparison. */
const contender = (c: OwnedCandidate): boolean => c.strongSignals > 0;

/** What the pages that win here ARE, in words an operator reads. */
const SHAPE: Record<string, string> = { informational_guide: "guides that explain the subject", list: "lists", definition: "short definitions",
  comparison: "comparisons", product: "product pages", category: "category pages", tool: "tools people use", forum: "discussion threads" };

const SYSTEM = [
  "You answer ONE question: does this business already have the right page for a topic it researched? You never write a page, a title, a description, an outline or an address, and you never propose one.",
  "Pick exactly one verdict.",
  "improve_existing: exactly ONE supplied page already answers this topic in the same shape. Name that one address, say what it already covers, what it does not, and why a second page would compete with it.",
  "consolidate_or_choose: two or more supplied pages answer the same thing and compete with each other. Name every one of them.",
  "do_nothing: the coverage is good enough, the opportunity is too small to be worth a person's time, or the results do not support a separate page.",
  "create_new: none of the supplied pages could be the answer.", "research_needed: you cannot decide from what you were given.", "Rules you may not break.",
  "1. Use ONLY the facts below. Never add a page, an address, a number, a search phrase, a competitor or a claim that is not written there.",
  "2. Every address in ownedUrls must be copied exactly from OWNED PAGES. Every id in evidenceKeys must be copied exactly from EVIDENCE.",
  "3. Never restate a count differently from how it is written, and never change a rule you were given.",
  "4. improve_existing names exactly one address. consolidate_or_choose names two or more.",
  "5. Write the explanation in the first person, one plain sentence a business owner reads. No em dash and no en dash. Never use the words experiment, control, baseline, treatment or SERP.",
  "6. Rule out at least one alternative and say in one sentence why it lost.",
].join("\n");

/** The evidence a verdict may cite, each id paired with the plain fact behind it.
 *  Nothing enters this list that was not observed. */
function evidenceOf(inv: TopicInvestigation, candidates: readonly OwnedCandidate[]): Ev[] {
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
    // ITS OWN WORDS, not just its address. Deciding "you already have this page" from a slug
    // and a title is the guess this whole slice exists to replace, and the body was already
    // bought: withholding it from the one step that needs it was the deepest defect here.
    fact: [`Your page ${c.url}${c.title ? ` ("${c.title}")` : ""}`,
      c.h1 && c.h1 !== c.title ? `Its heading reads "${c.h1}".` : null,
      c.wordCount != null ? `It runs ${num(c.wordCount)} words across ${c.outlineLength} sections.` : null,
      c.openingSample ? `It opens: "${c.openingSample.slice(0, 320)}".` : "I do not hold this page's own words.",
      c.entities.length > 0 ? `It names ${c.entities.slice(0, 8).join(", ")}.` : null,
      c.signals.map((sg) => sg.detail).join(" "),
    ].filter(Boolean).join(" ") }));
  return out;
}

function buildUser(inv: TopicInvestigation, candidates: readonly OwnedCandidate[], ev: readonly Ev[]): string {
  return [
    `TOPIC: ${inv.label} (id ${inv.key})`,
    `WHAT PEOPLE SEARCH: ${inv.queries.slice(0, 8).map((q) => `"${q}"`).join(", ")}`,
    `WHAT A SEARCHER WANTS: ${inv.demand.intent ?? "not established"}`,
    `WHAT WINS HERE: ${SHAPE[inv.pageType] ?? inv.pageType}`,
    "EVIDENCE (cite these ids and no others)",
    ...ev.map((e) => `  ${e.id}: ${e.fact}`),
    "OWNED PAGES (the only addresses you may name)",
    ...candidates.map((c) => `  ${c.url}`),
    "Decide whether one of these owned pages is already the answer for this topic.",
  ].join("\n");
}

const decide = (inv: TopicInvestigation, verdict: CoverageDecision["verdict"], parts: Partial<CoverageDecision>): CoverageDecision =>
  ({ verdict, topicKey: inv.key, ownedUrls: [], evidenceKeys: [], missing: [], alternativesRuledOut: [], explanation: "", ...parts });

/** An honest refusal: the topic stays under investigation, nothing is created,
 *  and `missing` names the ONE thing that would move it forward. */
const refuse = (
  inv: TopicInvestigation, ids: string[], missing: MissingRequirement, explanation: string, reason: string,
): CoverageDecision => decide(inv, "research_needed", { evidenceKeys: ids, missing: [missing], explanation,
  alternativesRuledOut: [{ alternative: "Write a new page for this", reason }] });

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
  const ev = evidenceOf(inv, candidates);
  const ids = ev.map((e) => e.id);

  const outOfScope = (opts.outOfScopeTopics ?? [])[0];
  if (outOfScope) return decide(inv, "do_nothing", { evidenceKeys: ids, explanation: `I left "${inv.label}" alone because your business setup lists "${outOfScope}" as something you do not want to cover.`,
    alternativesRuledOut: [{ alternative: "Write a new page for this", reason: "You told me this is not a topic you want, so building for it would be work you never asked for." }] });

  if (inv.exactSerps.length === 0 || inv.serpFreshness === "missing") return refuse(inv, ids, "exact_serp", `I have not looked at Google's results for "${inv.label}" yet, so I cannot say whether one of your pages already answers it. That search is first in line on my next research pass.`,
    "I cannot call a page missing before I have seen what already answers the search.");
  if (inv.serpFreshness !== "current") return refuse(inv, ids, "fresh_serp", `${inv.serpFreshness === "undated" ? `I hold Google's results for "${inv.label}" but not when I looked at them` : `My last look at Google's results for "${inv.label}" is out of date`}, so I am checking again before I decide anything about your pages.`,
    "A decision made on an out of date look at Google is a guess, and I will not hand you one.");
  // SHAPE AND INTENT FIRST. Both are already decided by the results page on file, so asking
  // Runtime to go and read three more pages for a topic I will refuse anyway spends real
  // fetches to arrive at the same no. 26 of 53 live topics were queued that way.
  if (inv.serpCoherence !== "coherent") return refuse(inv, ids, "intent", `The results for "${inv.label}" answer more than one meaning of the phrase, so I cannot yet say what a searcher actually wants and I will not judge your pages against it until I can.`,
    "A page built for a phrase that means two things answers neither of them well.");
  // A DIFFERENT PROBLEM, SAID DIFFERENTLY. "The winners do not agree on one shape" is not
  // "this phrase means two things", and telling a coherent topic the second is simply false.
  if (inv.pageType === "mixed" || inv.pageType === "unknown") return refuse(inv, ids, "shape", `The pages that win for "${inv.label}" do not settle into one kind of page yet, so I cannot say what shape a page of yours would have to be to compete.`,
    "Building the wrong shape of page for a search is work that cannot win, however well it is written.");
  if (inv.demand.intent == null) return refuse(inv, ids, "intent", `I do not yet know what someone searching "${inv.label}" is actually trying to do, so I am not judging your pages against a goal I cannot name.`,
    "A page aimed at a purpose I am guessing at is a page aimed at nothing.");
  if (inv.currentReadableWinners < MIN_ADJUDICATION_WINNERS) return refuse(inv, ids, "winners", `I have read ${inv.currentReadableWinners} of the ${MIN_ADJUDICATION_WINNERS} winning pages I need before I can compare "${inv.label}" against your own, so I am reading the rest next.`,
    `One or two pages are one or two publishers' opinions, and I need ${MIN_ADJUDICATION_WINNERS} sites agreeing before I call anything a pattern.`);

  const contenders = candidates.filter(contender);
  const unread = contenders.find((c) => !c.bodyHeld);
  if (unread) return refuse(inv, ids, "owned_content", `Your page ${unread.url} could already be the answer to "${inv.label}", and I do not hold its own words yet, so I am reading it before I say anything about it.`,
    "I will not call a page missing while one of yours that might already answer it sits unread.");
  if (contenders.length === 0) return refuse(inv, ids, "page_intersection", `I know what wins for "${inv.label}", and I have not yet compared it page by page against what you already own, so I am buying that comparison before I tell you to build anything.`,
    "The last time I skipped this comparison I shipped copies of pages this account already owned, so I am not skipping it again.");

  // NOTHING READS A MODEL-QUALITY VERDICT YET, so nothing pays for one. The deterministic
  // half above is free and always runs; the judgment call stays off until the slice that
  // renders it turns it on. Running a reasoning model inside an operator's page load for an
  // answer no screen shows is a cost with no reader.
  if (opts.model === "off") return refuse(inv, ids, "page_intersection", `I know what wins for "${inv.label}", and I have not yet compared it page by page against what you already own, so I am buying that comparison before I tell you to build anything.`,
    "The last time I skipped this comparison I shipped copies of pages this account already owned, so I am not skipping it again.");
  const call = await callStructuredLLM({
    kind: "coverage_adjudication", tenantId, system: SYSTEM, user: buildUser(inv, candidates, ev),
    grounded: ev.map((e) => e.fact).join(" "), projectedCostUsd: 0.01, maxTokens: 1600,
    complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache, cacheImpl: opts.cacheImpl,
  });
  if (call.status !== "drafted") {
    log.warn("[coverage-adjudication] no usable verdict", { tenantId, topicKey: inv.key, status: call.status });
    return refuse(inv, ids, "model_refusal", `I could not get a straight answer on whether one of your pages already covers "${inv.label}", so I am holding off rather than guessing.`,
      "I do not recommend building a page on the back of an answer I could not check.");
  }
  const v = call.value;
  const known = new Set(ids);
  const byKey = new Map(candidates.map((c) => [canonicalUrlKey(c.url), c]));
  const named = v.ownedUrls.map((u) => byKey.get(canonicalUrlKey(u)));
  // TWO SPELLINGS OF ONE PAGE ARE ONE PAGE: without this, "these two pages of yours compete"
  // was shown to an operator with the same page listed twice.
  const distinct = new Set(named.filter(Boolean).map((c) => canonicalUrlKey(c!.url))).size;
  const conflict =
    named.some((c) => !c) ? "named a page I never gave it"
      : v.evidenceKeys.some((k) => !known.has(k)) ? "leaned on something I never gave it"
        // A HINT IS NOT COVERAGE, AND AN UNREAD PAGE IS NOT AN ANSWER. Shared wording put a
        // merchandise page on the shortlist for an informational topic; without this it could
        // be returned as the page that already covers it, unread.
        : named.some((c) => c!.strongSignals === 0) ? "answered with a page nothing but shared wording connects to this"
          : named.some((c) => c!.bodyHeld === false) ? "answered with a page whose own words I have never read"
            : v.verdict === "create_new" ? "create_new"
              : v.verdict === "improve_existing" && distinct !== 1 ? "did not name the one page it says already covers this"
                : v.verdict === "consolidate_or_choose" && distinct < 2 ? "said your pages compete without naming both"
                  : null;
  // F6: the model finding a genuine gap is NOT a contradiction. It is the same answer gate 7
  // gives, and it deserves the same honest reason rather than being thrown in with hallucinations.
  if (conflict === "create_new") return refuse(inv, ids, "page_intersection", `I know what wins for "${inv.label}", and I have not yet compared it page by page against what you already own, so I am buying that comparison before I tell you to build anything.`,
    "The last time I skipped this comparison I shipped copies of pages this account already owned, so I am not skipping it again.");
  if (conflict) {
    log.warn("[coverage-adjudication] verdict disagrees with the evidence", { tenantId, topicKey: inv.key, conflict });
    return refuse(inv, ids, "conflicting_evidence", `My check on whether one of your pages already covers "${inv.label}" ${conflict}, so I threw it away and will look again.`,
      "An answer I cannot trace back to the pages and the evidence I hold is not a reason to build anything.");
  }
  // ONE SENTENCE, NEVER A PAGE. A 400-character prose field accepted a title, an opening, a
  // section list and a meta description, all of which are the NEXT slice's job and none of
  // which this verdict is allowed to hand anybody.
  const looksDrafted = (t: string): boolean => /\n/.test(t) || (t.match(/[.!?](\s|$)/g)?.length ?? 0) > 2 || /:\s*\d\s/.test(t);
  if (looksDrafted(v.explanation) || v.alternativesRuledOut.some((a) => looksDrafted(a.reason) || looksDrafted(a.alternative))) {
    log.warn("[coverage-adjudication] verdict came back carrying page copy", { tenantId, topicKey: inv.key });
    return refuse(inv, ids, "conflicting_evidence", `My check on whether one of your pages already covers "${inv.label}" came back writing the page instead of answering the question, so I threw it away.`,
      "A decision about whether a page should exist is not the page, and I will not let one arrive dressed as the other.");
  }
  if (v.verdict === "research_needed") return refuse(inv, ids, "model_refusal", `I could not decide whether one of your pages already covers "${inv.label}" from what I hold today, so I am gathering more before I say.`,
    "I will not recommend a new page off a comparison that came back undecided.");
  return decide(inv, v.verdict, { ownedUrls: [...new Set(named.map((c) => c!.url))], evidenceKeys: v.evidenceKeys, explanation: v.explanation,
    alternativesRuledOut: v.alternativesRuledOut.map((a) => ({ alternative: a.alternative, reason: a.reason })) });
}
