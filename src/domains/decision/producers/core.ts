/**
 * decision/producers/core (V1 Closure, launch blocker 9): WHAT TO ACTUALLY DO ABOUT THE CAUSE.
 *
 * The cause ladder has been able to name fifteen reasons a page loses a click since Phase 4, and this product could write copy for exactly one of them. Every other page came back with a true sentence and
 * nothing to paste, which is the difference between a diagnosis and a doctor. This file closes that gap for
 * the causes whose fix IS copy: a missing opening, subjects the winners all cover, a thing the winners do that this page does not, and a page built in the wrong shape for what people are asking.
 *
 * THE REGISTRY IS TOTAL, and that is the point. Every cause the ladder can name has an entry: a producer, or
 * a plain sentence saying why nothing is produced for it. A cause cannot be added to the ladder without somebody deciding here what it hands the operator, so "we forgot" is not a state this file can be in.
 *
 * NOTHING IS INVENTED HERE. Every producer works from the structure the ladder ALREADY read (CausePayload),
 * cites the receipt keys the ladder cited, and buys its copy through the caller's drafter, which carries the
 * injection firewall, the budget, the cache and the numeric net. A drafter that refuses is a refusal, never an empty component: a component with nothing in it is worse than no component at all.
 */

import type { BundleComponent } from "../contracts";
import { technicalComponents } from "../technical-findings";
import { pageContains } from "@/domains/evidence/pages/owned-context";
import type { CauseKey, Produced, Producer, ProducerCtx } from "./contract";
import { produceConsolidation, produceInternalLinks, produceSourceExpansion } from "./extended";

/** At most two sections in one change. An operator's morning is the budget, and a page handed five new
 *  sections at once is a rewrite nobody applies rather than a change somebody makes. */
const MAX_SECTIONS = 2;

const refuse = (reason: string): Produced => ({ components: [], refusal: reason });

/** WHERE a new section goes, said as a place on the page rather than a field in an editor. */
const afterLast = (outline: readonly string[]): string => {
  const last = [...outline].reverse().find((h) => h.trim().length > 0);
  return last ? `after the section "${last.trim()}"` : "at the end of the page, after the last section it already has";
};

/** The four things every non-legacy component owes the operator before the validator will show it. */
const owed = (query: string, objective: string, mechanism: string, where: string): Pick<BundleComponent, "where" | "objective" | "mechanism" | "measurementPlan"> => ({
  where, objective, mechanism,
  measurementPlan: `Clicks and views from search for "${query}" over the next 28 days, against the pages you did not change.`,
});

/** The page's own words, as grounding for a drafter. Bounded, and empty when I hold none. */
const hintsOf = (ctx: ProducerCtx): string[] => [
  ...ctx.receiptFacts,
  ...(ctx.body?.openingSample ? [`The page opens: ${ctx.body.openingSample}`] : []),
  ...(ctx.body?.cardTexts ?? []).slice(0, 4),
];

// ── weak_opening: the first thing a reader sees never says what the search is about ──

const weakOpening: Producer = async (ctx) => {
  const payload = ctx.finding.payload;
  const want = payload?.cause === "weak_opening" ? payload.want : [];
  if (want.length === 0) return refuse("This page's opening never answers the search, and which words it is missing could not be read, so no opening is written.");
  if (!ctx.draft.openingAnswer) return refuse("This page's opening never answers the search, and no replacement can be written in this pass.");
  const after = await ctx.draft.openingAnswer({
    query: ctx.primary,
    pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url,
    currentValue: ctx.body?.openingSample ?? null,
    outline: ctx.page.outline,
    evidenceHints: hintsOf(ctx),
  });
  if (!after) return refuse("No opening for this page passed its own checks, so nothing is handed over rather than filler.");
  return {
    components: [{
      kind: "opening_answer", label: "Opening answer", before: ctx.body?.openingSample ?? null, after,
      evidenceKeys: ctx.finding.evidenceKeys, risk: "safe",
      ...owed(ctx.primary, `Answer "${ctx.primary}" in the first lines of the page, the way every page beating it does.`,
        "A reader who does not see the subject answered in the first lines leaves, and the click is spent either way.",
        "the very top of the page, replacing its current first paragraph"),
    }],
    refusal: null,
  };
};

// ── incomplete_coverage: the subjects the winners agree on and this page carries none of ──

const incompleteCoverage: Producer = async (ctx) => {
  const payload = ctx.finding.payload;
  // A missing HEADING and a missing ENTITY are both subjects the winners agree on: either one names a section worth writing, and the finding fires on both, so the producer must serve both or it refuses
  // on its own evidence. A subject the held page PROVABLY already carries is dropped before drafting.
  const named = payload?.cause === "incomplete_coverage" ? [...payload.absentHeadings, ...payload.absentEntities] : [];
  const absent = named.filter((s) => pageContains(ctx.body, s) !== "yes");
  // A REFUSAL SAYS WHICH TRUTH IT IS. When the held page turned out to carry every named subject, the honest answer is presence, not a restated absence the page itself just disproved.
  if (absent.length === 0) return refuse(named.length > 0
    ? "The page itself already carries what the winning pages cover, so there is nothing to add here."
    : "The pages that win this search agree on subjects this one leaves out, and none of them is a section that can be written yet.");
  const components: BundleComponent[] = [];
  for (const heading of absent.slice(0, MAX_SECTIONS)) {
    const drafted = await ctx.draft.section({
      query: ctx.primary,
      pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url,
      heading,
      brief: `Every page that wins "${ctx.primary}" covers ${heading} and this page does not. Cover it in one short section, in this page's own terms.`,
      outline: ctx.page.outline,
      evidenceHints: hintsOf(ctx),
    });
    if (!drafted) continue;
    components.push({
      kind: "section_add", label: `Add a section: ${drafted.heading}`, before: null,
      after: `${drafted.heading}\n\n${drafted.body}`,
      evidenceKeys: ctx.finding.evidenceKeys, risk: "safe",
      ...owed(ctx.primary, `Cover ${heading}, which every page beating this one covers and this one leaves out.`,
        "A reader who has to leave for the part this page skips does not come back to it, and the pages that carry it keep the click.",
        afterLast(ctx.page.outline)),
    });
  }
  return components.length === 0
    ? refuse("No section for what this page is missing passed its own checks, so nothing is handed over rather than filler.")
    : { components, refusal: null };
};

// ── competitor_content_gap: what the winning pages DO that this one does not ──

const competitorContentGap: Producer = async (ctx) => {
  const payload = ctx.finding.payload;
  const gaps = payload?.cause === "competitor_content_gap" ? payload.gaps : [];
  if (gaps.length === 0) return refuse("The pages that win this search do something this one does not, and it could not be read closely enough to write.");
  // STRONGEST FIRST, and the same order every time: the gap the most winners share, then the plain text, so the same reading always produces the same two sections. A gap the held page PROVABLY already
  // carries is dropped before drafting: the accusation was written against a sample.
  const ranked = [...gaps].filter((g) => pageContains(ctx.body, g.gap) !== "yes")
    .sort((a, b) => b.seenOn.length - a.seenOn.length || (a.gap < b.gap ? -1 : a.gap > b.gap ? 1 : 0));
  const components: BundleComponent[] = [];
  for (const gap of ranked.slice(0, MAX_SECTIONS)) {
    const seen = gap.seenOn.length;
    const drafted = await ctx.draft.section({
      query: ctx.primary,
      pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url,
      heading: null,
      brief: `${seen} of the pages that win "${ctx.primary}" do this and this page does not: ${gap.gap}. Write one short section that does it, in this page's own terms.`,
      outline: ctx.page.outline,
      evidenceHints: hintsOf(ctx),
    });
    if (!drafted) continue;
    components.push({
      kind: "section_add", label: `Add a section: ${drafted.heading}`, before: null,
      after: `${drafted.heading}\n\n${drafted.body}`,
      evidenceKeys: ctx.finding.evidenceKeys, risk: "safe",
      ...owed(ctx.primary, `Do the one thing ${seen} of the pages beating this one do and it does not.`,
        "The pages winning this search all give the reader this, so a reader who lands here still has a reason to go back and pick one of them.",
        afterLast(ctx.page.outline)),
    });
  }
  return components.length === 0
    ? refuse("No section that would close the gap on the winning pages passed its own checks, so nothing is handed over rather than filler.")
    : { components, refusal: null };
};

// ── serp_shape_shift and intent_shift: the page is built for a different job ── Neither is a paste. A page of the wrong KIND is not fixed by one section, so what ships is a REWRITE of
// the section that carries the mismatch, marked for the operator to read before they act on it.

function shapeMismatch(objective: string, mechanism: string): Producer {
  return async (ctx) => {
    const heading = ctx.page.outline.find((h) => h.trim().length > 0) ?? null;
    const drafted = await ctx.draft.section({
      query: ctx.primary,
      pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url,
      heading,
      brief: `${ctx.finding.explanation} Rewrite this page's leading section so it does the job people searching "${ctx.primary}" actually came for.`,
      outline: ctx.page.outline,
      evidenceHints: hintsOf(ctx),
    });
    if (!drafted) return refuse("No replacement for this page's leading section passed its own checks, so nothing is handed over rather than filler.");
    return {
      components: [{
        kind: "section_rewrite", label: `Rewrite the leading section: ${drafted.heading}`,
        before: null, after: `${drafted.heading}\n\n${drafted.body}`,
        evidenceKeys: ctx.finding.evidenceKeys, risk: "review",
        ...owed(ctx.primary, objective, mechanism,
          heading ? `the section "${heading.trim()}", the first one on the page` : "the first section on the page"),
      }],
      refusal: null,
    };
  };
}

// ── technical_indexability: what is wrong with how the page is SERVED ── NOT COPY, AND NOT A GUESS. Every component here is one fault on one address with the exact fix, read off
// the inventory and the capture by decision/technical-findings and carried on the finding itself, so this
// producer invents nothing: it hands over what the reading already proved, in the same component vocabulary.

const technical: Producer = async (ctx) => {
  const payload = ctx.finding.payload;
  const findings = payload?.cause === "technical_indexability" ? payload.findings : [];
  if (findings.length === 0) return refuse("How this page is served has not been read, so what is stopping it being found is unknown.");
  // A CHANGE TO THE WORDS ON A PAGE IS THE WORDS. Where the fault is in the copy itself (two pages wearing one title, a page with no heading), the fix is only a change once I can hand over the exact wording; a
  // finding without it is a description of a problem, and a description has no business in Ready. Those findings are dropped here and the page goes back to research, said plainly.
  const keep = findings.filter((f) => !HELD_UNTIL_EXACT.has(f.kind) || !!f.exact || !!f.redirectTo);
  const held = findings.length - keep.length;
  if (keep.length === 0) {
    // A DEAD ADDRESS WITH NOWHERE TO GO IS A QUESTION, NOT A CHANGE, and it is asked as one: what I read, and the one thing I need from the operator before this can ever be work.
    const address = findings.find((f) => f.kind === "non_200");
    if (address) return refuse(`${address.evidence} Name the address that replaced it and the forward gets written. Until then it stays out of the queue.`);
    return refuse(`The problem on this page is named and the replacement wording is not written yet, so an instruction is not handed over dressed as a change. The exact ${held === 1 ? "line" : "lines"} lands here the moment it passes its own checks.`);
  }
  return { components: technicalComponents(keep, ctx.primary), refusal: null };
};

/** The faults with nothing exact behind them yet: a copy fault with no replacement wording, a dead address
 *  with no replacement page. Without one of those there is no change to make, only an instruction. */
const HELD_UNTIL_EXACT: ReadonlySet<string> = new Set(["duplicate_title", "duplicate_h1", "missing_h1", "orphaned_page", "non_200", "broken_internal_link"]);

/**
 * THE REGISTRY. Total over every cause the ladder can name: a producer, or the honest reason there is nothing to produce. A reason here is not an apology, it is the fact that this cause's fix is not copy.
 */
export const CORE_PRODUCERS: Record<CauseKey, Producer | { reason: string }> = {
  weak_opening: weakOpening,
  incomplete_coverage: incompleteCoverage,
  competitor_content_gap: competitorContentGap,
  serp_shape_shift: shapeMismatch(
    "Make this page's leading section do the job the pages winning this search all do.",
    "The results have settled on one kind of page and this one is a different kind, so the leading section is where that distance is closed or not at all."),
  intent_shift: shapeMismatch(
    "Lead with what people searching this are actually trying to do.",
    "The page answers a different question from the one being asked, and the leading section is the only place a reader finds that out in time."),
  // The wording of the line Google displays is the ONE cause this kernel has always been able to write, and
  // it keeps its own path in produce-bundle unchanged: routing it through here would be a second title path.
  ctr_snippet: { reason: "The title path owns this cause and writes it directly." },
  // Settling which of two pages owns a search is a merge, a redirect and a de-index, not a paste. It is built beside this file rather than inside it, and wired in at integration.
  cannibalization: produceConsolidation,
  // WHERE A READER GOES NEXT is a real change and a real drafter (internal_link) is now wired for it, but a
  // link needs a DESTINATION this page should honestly point at, and picking that page is its own reading.
  internal_link_weakness: produceInternalLinks,
  // Both AI causes are about what an engine did with a page it already read. Nothing on the page is proven wrong by either, so a rewrite here would be a guess dressed as a fix.
  retrieved_not_cited: produceSourceExpansion,
  ai_citation_gap: produceSourceExpansion,
  // A change of yours is still being measured: the whole point is to add nothing on top of it.
  measuring_change: { reason: "A change here is still being measured, and stacking another one on top would make the first unreadable." },
  // The two the ladder itself says it cannot test yet. Their evidence does not exist in this product, so there is nothing to produce from and saying so is the honest answer.
  demand_decline: { reason: "One 90 day total for that search is on file and nothing earlier, so there is nothing here to act on." },
  ranking_loss: { reason: "One average position for that search is on file and nothing earlier, so there is nothing here to act on." },
  // The inventory and the capture answer this one now: one fault, one address, one exact fix.
  technical_indexability: technical,
  no_problem: { reason: "Nothing accuses this page, so there is nothing to change on it." },
};
