/** decision/produce-bundle. The ONE producer of a deep, copy-ready change for a page a door selected. Order is deliberate: SELECT, BUILD the receipt FIRST for the EXACT candidate search, DIAGNOSE off that receipt, and only then draft the ONE field the diagnosis named. Confidence follows the EVIDENCE HELD, never how it reads.
 *  EVERY DOOR IS SERVED ON ITS OWN TERMS. The click door keeps its exact selection: the biggest proven shortfall against a page's own positions. Every other door selects the page IT named, answers for ITS OWN evidence, and concludes only what it measured: a door that never read the line a searcher reads never concludes its wording.
 *  No evidence means no change, and every input list is re-sorted before it is read, so the same evidence in any order produces a byte-identical result. server-only. */

import "server-only";

import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot"; import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { draftAtomicEditStructured, draftInternalLinkStructured, draftSectionStructured } from "@/domains/decision/llm/structured-drafter"; import { defaultExpectedCtrAt } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ActionDiagnosis, ChangeBundle, BundleComponent, BundleEvidenceItem, ChangeProposal, ComponentPlan, EvidenceReadiness, RecommendedChange } from "./contracts"; import { confidenceFor, CTR_DEFICIT_SHARE, MIN_QUERY_IMPRESSIONS, MIN_RECOVERABLE_CLICKS, readyForAction, receiptComposition } from "./contracts";
import { technicalKey, type TechnicalFinding } from "./technical-findings";
import { diagnoseCandidate, ownedResultOf, recurringPattern, RECEIPT, type DiagnosisInput } from "./diagnose";
import { causeLabel, diagnoseCauses, type CauseFinding } from "./diagnosis";
import type { DecidedTopic } from "./coverage-pass";
import type { WinningPattern } from "./winning-pattern";
import { CORE_PRODUCERS } from "./producers/core"; import { produceFullRewriteRecommendation } from "./producers/extended"; import { effortMinutesFor, fieldForComponent, type EvidenceRequirement, type ProducerCtx, type ProducerDraft } from "./producers/contract";
import type { ProposeOptions } from "./propose"; import { receiptIntegrityFailures, validateProposal } from "./validate-proposal";
import { anchoredTopicMatch, canonicalQueryKey, templateHeadings, weakAnchorTokens } from "@/domains/evidence/relevance-gate"; import { demandUnitsOf } from "@/domains/evidence/demand-units"; import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { answerIntelFacts, answerIntelOf } from "@/domains/evidence/answer-intel";
import { biggerSearchesLine } from "./suggested-edits"; import { observationJoinsCase } from "./membership"; import { splitComparison } from "./split"; import { actionFamilyOf } from "./proposal-store"; import { draftFieldForPage } from "./drafted-copy";

/** `considered` rides a REFUSAL so the levers a producer weighed reach the research card that replaces it: a card saying only what is missing reads as a shrug beside one that also says what was ruled out. */
type BundleOutcome = { status: "bundled"; proposal: ChangeProposal } | { status: "none"; reason: string; considered?: { option: string; reason: string }[];
  /** The exact reading this cause cannot be treated without, typed by the producer that discovered it. */
  requirement?: EvidenceRequirement };

type Research = EvidenceSnapshot["research"];
type Observation = Research["aiObservations"][number];
type SerpEvidence = Research["serpEvidence"][number];
type Keyword = Research["retainedKeywords"][number];

const norm = (s: string): string => s.trim().toLowerCase(); const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export type OwnedBody = { openingSample: string | null; fetchedAt: string | null; contentHash?: string | null; // the page's OWN WORDS, whole, read by the caller through the targeted Evidence reader; absent means absent
  cardTexts?: string[]; entityNames?: string[]; internalLinks?: { href: string; anchorText: string }[]; metaDescription?: string | null;
  headings?: string[]; passages?: string[]; faqs?: { question: string; answer: string }[]; vocabulary?: string;
  completeness?: "complete" | "partial" | "sample_only"; heldNote?: string };

/** RECOVERABLE OPPORTUNITY, never gross traffic: per DEMAND UNIT clearing MIN_QUERY_IMPRESSIONS on the unit's combined impressions, the shortfall under what its members' positions earn on THE SAME curve the diagnosis used, past CTR_DEFICIT_SHARE of it. Units, not single rows: an intent spread across many phrasings is ONE audience, and reading it a row at a time hid most of the site's demand from the only path that can act. `at` defaults to the industry table only outside a pass, which holds no fitted curve. */
type Gap = { query: string; impressions: number; clicks: number; position: number; recoverable: number; vocabulary?: string[] };
const gapsOf = (p: OwnedPageEvidence, at: (position: number) => number = defaultExpectedCtrAt): Gap[] => demandUnitsOf(p.search?.topQueries ?? [], at).flatMap((u) => {
  if (u.impressions < MIN_QUERY_IMPRESSIONS || u.position == null) return [];
  const expected = u.expectedClicks / u.impressions, deficit = expected - u.clicks / u.impressions, recoverable = u.expectedClicks - u.clicks;
  // BOTH BARS, because this figure is SUMMED onto a page: a share floor alone let a tail search missing 44 percent of a 1.8 percent position add 16 clicks to a page
  // total, and the card then carried a number its own sentence (written from the one real gap) did not say. A unit joins a page's worth only if it is worth something.
  return deficit < CTR_DEFICIT_SHARE * expected || recoverable < MIN_RECOVERABLE_CLICKS ? [] : [{ query: u.label, impressions: u.impressions, clicks: u.clicks, position: u.position, recoverable, vocabulary: u.vocabulary }];
}).sort((a, b) => b.recoverable - a.recoverable || byText(a.query, b.query));
const totalRecoverable = (gaps: Gap[]): number => gaps.reduce((a, g) => a + g.recoverable, 0); const hasCurrentCopy = (p: OwnedPageEvidence): boolean => !!p.content && !!(p.content.title || p.content.h1 || p.content.outline.length > 0);

function parseUrl(url: string): URL | null { try { return new URL(url.startsWith("http") ? url : `https://${url}`); } catch { return null; } }
const pathOf = (url: string): string => parseUrl(url)?.pathname || (url.startsWith("/") ? url : `/${url}`); const MIN_ANCHOR_CORPUS = 10, MAX_INVENTORY = 200, MAX_AHEAD = 6;

/** WEAK ANCHORS: the words this account puts on everything fit anything, so alone they attach no evidence. Under MIN_ANCHOR_CORPUS phrases the set is empty. */
function weakAnchorsOf(snapshot: EvidenceSnapshot): Set<string> {
  const r = snapshot.research; const phrases = [...new Set([...(r?.retainedKeywords ?? []).map((k) => k.query), ...(r?.aiObservations ?? []).map((o) => o.promptText),
    ...snapshot.ownedPages.map((p) => p.content?.title || p.content?.h1 || pathOf(p.url))].map((s) => (s ?? "").trim()).filter(Boolean))];
  return phrases.length < MIN_ANCHOR_CORPUS ? new Set<string>() : weakAnchorTokens(phrases);
}

const topicMatch = (a: string, b: string, weak: ReadonlySet<string>): boolean =>
  norm(a) === norm(b) || anchoredTopicMatch(a, b, weak).relevant;

/** A winner attaches ONLY on EXACT membership: an appearance under a member query or prompt, or its exact URL cited for one. A shared DOMAIN proves nothing. */
const winnerBelongs = (w: Research["winningPages"][number], queries: ReadonlySet<string>, prompts: ReadonlySet<string>, urls: ReadonlySet<string>): boolean =>
  urls.has(canonicalUrlKey(w.url)) || w.appearances.some((a) =>
    (!!a.query && queries.has(canonicalQueryKey(a.query))) || (!!a.promptText && prompts.has(norm(a.promptText))));

const WANTS: Record<string, string> = { informational: "want an explanation", commercial: "are comparing options", transactional: "are ready to act", navigational: "are looking for one specific site" };

const keywordFact = (k: Keyword, w = k.intent ? WANTS[norm(k.intent)] : undefined): string => `"${k.query}" gets about ${k.searchVolume!.toLocaleString()} searches a month${w ? `, and the people searching it ${w}` : ""}.`;
const serpFact = (e: SerpEvidence, led = [...e.organic].sort((a, b) => a.rank - b.rank).slice(0, 3).map((o) => o.domain)): string => `For "${e.query}" the results page is led by ${led.join(", ") || "pages that could not be named"}, and the answer box at the top cites ${e.aiOverview.length} ${e.aiOverview.length === 1 ? "source" : "sources"}.`;
const observationFact = (o: Observation): string => {
  const domains = [...new Set((o.citations ?? []).map((cit) => cit.domain))].sort(byText).slice(0, 3);
  const seen = o.observationMode === "consumer_search" ? `When a customer searches "${o.promptText}" inside an assistant, `
    : `In a plain assistant answer to "${o.promptText}" (background reading, not what a searching customer sees), `;
  const cited = o.citations == null ? "Which pages it leaned on is not readable."
    : domains.length === 0 ? "it answers without pointing at anyone." : `it points people at ${domains.join(", ")}.`;
  // Fan-out lineage: the searches the ASSISTANT itself ran, never the question I track, which is mine.
  const mine = canonicalQueryKey(o.promptText), fan = (o.fanOutQueries ?? []).filter((q) => canonicalQueryKey(q) !== mine).slice(0, 3);
  return `${seen}${cited}${fan.length ? ` To answer it the assistant went and searched ${fan.map((q) => `"${q}"`).join(", ")}.` : ""}`;
};

const classSentence = (r: Receipt): string => `Built from ${receiptComposition(r.items)}, and every piece is on the receipt.`;

const queriesOf = (page: OwnedPageEvidence): OwnedQuerySignal[] => [...(page.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || byText(a.query, b.query)).slice(0, 5);

/** `ahead` is WHO IS ABOVE THIS PAGE for its own search, each carrying its words WHEN they are on file: a fall is explained by what moved past it, so an unread page there is a named hole rather than a shrug. */
type Receipt = ChangeBundle["receipt"] & { prompts: string[]; hasResearch: boolean; contextOnlyKeys: string[]; supportKeys: string[]; links: { anchor: string; to: string }[]; readiness: EvidenceReadiness; diagnosis: ActionDiagnosis; bodyText?: string | null; ahead: NonNullable<ProducerCtx["ahead"]> };

/** A pattern is claimable only across MULTIPLE pages that come up for this exact search, as a count I can show. */
function winnerPattern(read: Research["winningPages"], c: NonNullable<OwnedPageEvidence["content"]>, primary: string): string | null {
  if (read.length < 2) return null;
  const words = [...read.map((w) => w.extract!.wordCount)].sort((a, b) => a - b); const median = words[Math.floor(words.length / 2)]!;
  const faq = read.filter((w) => w.extract!.faqCount > 0).length; const bits: string[] = [];
  if (faq >= 2) bits.push(`${faq} of them answer it in a question and answer block${c.hasFaq ? " and so does this page" : ", and this page has none"}`);
  if (median >= Math.round(c.wordCount * 1.5)) bits.push(`the middle one runs ${median.toLocaleString()} words against this page's ${c.wordCount.toLocaleString()}`);
  return bits.length === 0 ? null : `Of the ${read.length} pages read that come up for "${primary}", ${bits.join(", and ")}.`;
}

function buildReceipt(snapshot: EvidenceSnapshot, page: OwnedPageEvidence, queries: OwnedQuerySignal[], primary: string, weak: ReadonlySet<string>, body: OwnedBody | null, mine: DecidedTopic | null, technical: readonly TechnicalFinding[], bodies: ReadonlyMap<string, OwnedPageBody>): Receipt {
  const items: BundleEvidenceItem[] = []; const contextOnly: string[] = []; const missing: string[] = []; const prompts: string[] = [];
  // WHICH STORED ANSWERS: a line off ONE answer keeps the singular id it always wore; a line SEVERAL answers stand behind carries all of theirs, and neither is ever flattened into the other.
  const add = (key: string, kind: BundleEvidenceItem["kind"], fact: string, observedAt: string | null, from?: Pick<BundleEvidenceItem, "observationId" | "observationIds">): void => { items.push({ key, kind, fact, observedAt, ...(from?.observationId ? { observationId: from.observationId } : {}), ...(from?.observationIds?.length ? { observationIds: from.observationIds } : {}) }); };
  const research = snapshot.research;
  const isPrimary = (q: string): boolean => norm(q) === norm(primary) || canonicalQueryKey(q) === canonicalQueryKey(primary);
  const s = page.search!; const c = page.content!;
  const pageTopic = [...queries.map((q) => q.query), c.title ?? "", c.h1 ?? ""].join(" ");
  const onTopic = (text: string): boolean => topicMatch(text, pageTopic, weak);

  add("demand-page", "gsc_demand", `This page overall: ${s.clicks90d.toLocaleString()} clicks from ${s.impressions90d.toLocaleString()} views, position ${Math.round(s.position90d)} (90 days).`, null);
  // A NUMBER IS A STATEMENT, NOT A SENTENCE SPOKEN AT SOMEBODY: raw figures are labelled and listed, and the prose is saved for the lines that argue.
  const queryFact = (q: OwnedQuerySignal): string => `"${q.query}": ${q.impressions.toLocaleString()} views, ${q.clicks.toLocaleString()} clicks${q.position == null ? "" : `, position ${Math.round(q.position)}`} (90 days).`;
  const exact = (s.topQueries ?? []).find((q) => isPrimary(q.query));
  if (exact) add(RECEIPT.gsc, "gsc_demand", queryFact(exact), null); // the EXACT search the gap was measured on, never a neighbour
  queries.slice(0, 3).filter((q) => !isPrimary(q.query)).forEach((q, i) => add(`demand-q${i + 1}`, "gsc_demand", queryFact(q), null));
  add(RECEIPT.copy, "page_extract", `${c.fetchedAt ? `Read on ${c.fetchedAt.slice(0, 10)}, this page` : "The stored copy of this page"} ${c.title ? `was titled "${c.title}"` : "had no title set"} and ran ${c.wordCount.toLocaleString()} words across ${c.outline.length} sections.`, c.fetchedAt);
  const split = splitComparison(snapshot, primary);
  const sectionsOf = (url: string): string[] => (bodies.get(canonicalUrlKey(url))?.headings
    ?? snapshot.ownedPages.find((p) => canonicalUrlKey(p.url) === canonicalUrlKey(url))?.content?.outline ?? []).slice(0, 6);
  if (split.length > 0) add(RECEIPT.competing, "gsc_demand", `Over the last 90 days ${split.length} of your own pages came up for "${primary}": ${split.map((r) => `${r.clicks == null
    ? `${pathOf(r.url)} comes up for it and carries no figures of its own`
    : `${pathOf(r.url)} takes ${r.clicks.toLocaleString()} clicks from ${(r.impressions ?? 0).toLocaleString()} views${r.position == null ? "" : ` at about position ${Math.round(r.position)}`}`}${sectionsOf(r.url).length > 0 ? ` and covers ${sectionsOf(r.url).map((h) => `"${h}"`).join(", ")}` : ""}`).join("; ")}.`, snapshot.scope.builtAt);
  const keywords = [...(research?.retainedKeywords ?? [])].filter((k) => isPrimary(k.query) && k.searchVolume != null)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || byText(norm(a.query), norm(b.query)));
  if (keywords.length === 0) missing.push(`No monthly search count for "${primary}" is on file yet.`);
  keywords.slice(0, 3).forEach((k, i) => add(`kw${i + 1}`, "keyword", keywordFact(k), null));
  const serps = [...(research?.serpEvidence ?? [])].filter((e) => isPrimary(e.query)).sort((a, b) => byText(norm(a.query), norm(b.query)));
  if (serps.length === 0) missing.push(`The live results page for "${primary}" has not been read yet, so what is taking the clicks cannot be named.`);
  serps.slice(0, 2).forEach((e, i) => add(`serp${i + 1}`, "serp", serpFact(e), null));

  const bodyText = (body?.openingSample ?? "").trim() || null; const dx: DiagnosisInput = { query: primary, ownedUrl: page.url, organic: serps[0]?.organic ?? null, body: !!bodyText, gscPosition: exact?.position ?? null };
  if (bodyText) add(RECEIPT.body, "page_extract", `In its own words the page opens: "${bodyText.slice(0, 240)}".`, body?.fetchedAt ?? null);
  const owned = ownedResultOf(dx); const pattern = recurringPattern(dx, owned); const diagnosis = diagnoseCandidate(dx);
  if (diagnosis.status === "diagnosed") { // the conclusion is inspectable evidence too, beside the observations it cites
    add("diagnosis", "diagnosis", diagnosis.explanation, null); diagnosis.alternativesRuledOut.forEach((a, i) => add(`ruledout${i + 1}`, "diagnosis", `${a.alternative}: ${a.reason}`, null)); }
  if (owned) add(RECEIPT.ownedResult, "serp", `On that results page Google shows this page worded "${(owned.title ?? "").trim()}".`, null);
  else if (serps.length > 0) missing.push(`This page is not on the results page for "${primary}", so what a searcher reads for it is not visible.`);
  if (pattern.length > 0) add(RECEIPT.pattern, "serp", `Across the other pages that come up for "${primary}", ${pattern.slice(0, 4).map((t) => `"${t}"`).join(", ")} recur in the wording Google shows.`, null);
  else if (serps.length > 0) missing.push(`The pages that come up for "${primary}" share no recurring wording worth pointing at.`);

  // ABOUT THIS SEARCH OR IT IS SOMEBODY ELSE'S EVIDENCE: ONE membership predicate decides every join below.
  const ofCase = { queries: [primary], provenance: (research?.retainedKeywords ?? []).filter((k) => isPrimary(k.query)).flatMap((k) => k.origins ?? []) };
  const observations = [...(research?.aiObservations ?? [])].filter((o) => observationJoinsCase(o, ofCase)).sort(
    (a, b) => byText(a.observationMode, b.observationMode) || byText(a.promptText, b.promptText) || byText(a.engine, b.engine));
  const consumer = observations.filter((o) => o.observationMode === "consumer_search"); const plain = observations.filter((o) => o.observationMode !== "consumer_search");
  if (observations.length === 0) missing.push(`No AI answer about "${primary}" has been gathered yet.`);
  else if (consumer.length === 0) missing.push(`What a customer sees when they ask an assistant about "${primary}" has not been watched yet.`);
  // THE FIRST ANSWER CARRIES THE ID THE CAUSE LADDER CITES (RECEIPT.ai), or a change made off it cites nothing.
  [...consumer.slice(0, 2), ...plain.slice(0, 1)].forEach((o, i) => {
    const key = i === 0 ? RECEIPT.ai : `ai${i + 1}`; add(key, "ai_observation", observationFact(o), o.observedAt, { observationId: o.observationId });
    if (o.citations == null) contextOnly.push(key); // context, never component support
    prompts.push(o.promptText); });
  // WHAT THOSE ANSWERS ACTUALLY SAID, not merely that they were given: who they name, what shape they ask for, what they leave unanswered and whether they name this account at all, each line carrying EVERY stored
  // answer it stands on. The engines' own CLAIMS never come through here: every fact below is handed to the drafters as grounding, and somebody else's assertion is not a source of mine. A GAP THE ANSWERS KEEP LEAVING
  // is then an argument for covering it, so the RECURRING ones (never one answer's) stand behind whichever coverage component the ladder produces.
  const intel = answerIntelOf(observations); const said = answerIntelFacts(intel); for (const f of said.facts) add(f.key, "ai_observation", f.fact, f.observedAt, f);
  if (said.withheld) missing.push(said.withheld); // a dropped signal is still evidence I had, and withholding it in silence reads exactly like never having gathered it
  const supportKeys = intel.omissions.slice(0, 2).flatMap((s, i) => (s.prompts > 1 ? [`missing${i + 1}`] : []));

  // A winner belongs to THIS search only: on that results page, or in an answer that joined this case above. A fan-out that never carried this search carries no winner either.
  const memberPrompts = new Set(observations.map((o) => norm(o.promptText))), memberQueries = new Set(ofCase.queries.map(canonicalQueryKey));
  const memberUrls = new Set([...observations.flatMap((o) => (o.citations ?? []).map((cit) => cit.url)),
    ...serps.flatMap((e) => [...e.organic.map((x) => x.url), ...e.aiOverview.map((cit) => cit.url), ...e.aiMode.map((cit) => cit.url)])].map(canonicalUrlKey));
  const belongs = [...(research?.winningPages ?? [])].filter((w) => winnerBelongs(w, memberQueries, memberPrompts, memberUrls)).sort((a, b) => byText(a.url, b.url));
  const read = belongs.filter((w) => !!w.extract), winners = belongs.slice(0, 2);
  if (winners.length === 0) missing.push(`The pages that come up for "${primary}" have not been read yet.`);
  winners.forEach((w, i) => add(`win${i + 1}`, "winning_page",
    `${w.domain} ${w.appearances.some((a) => a.kind !== "serp_organic") ? "is one of the pages AI keeps citing here" : `comes up on the results page for "${primary}"`}${w.extract ? `, and it runs ${w.extract.wordCount.toLocaleString()} words under ${w.extract.headings.length} headings` : ""}.`,
    [...w.appearances].sort((a, b) => byText(b.observedAt, a.observedAt))[0]?.observedAt ?? null));
  const winners2 = winnerPattern(read, c, primary); if (winners2) add("winpattern", "winning_page", winners2, null);
  // WHO IS ABOVE THIS PAGE ON THAT RESULTS PAGE, in rank order, each joined to its own read where one exists. A
  // page with no read carries nulls rather than being dropped, because the hole IS the finding a fall needs.
  const extracts = new Map(read.map((w) => [canonicalUrlKey(w.url), w.extract!] as const));
  // A PUBLISHER'S FINAL NO IS A FACT ABOUT THE HOLE, carried so no producer requires a reading that can never be made: reddit at position 2 is robots-blocked, and without this flag the requirement mint named it on every pass forever.
  const finalNo = new Set((research?.winningPages ?? []).filter((w) => !w.extract && w.readOutcome?.state === "robots_blocked").map((w) => canonicalUrlKey(w.url)));
  const ahead: Receipt["ahead"] = [...(serps[0]?.organic ?? [])].sort((a, b) => a.rank - b.rank).filter((o) => owned == null || o.rank < owned.rank).slice(0, MAX_AHEAD)
    .map((o) => { const x = extracts.get(canonicalUrlKey(o.url)); return { url: o.url, domain: o.domain, rank: o.rank, wordCount: x?.wordCount ?? null, headings: [...(x?.headings ?? [])], openingSample: x?.openingSample ?? null, ...(finalNo.has(canonicalUrlKey(o.url)) ? { unreadable: true } : {}) }; });

  const links = [...snapshot.internalLinkOpportunities].filter((l) => l.fromUrl === page.url && onTopic(l.anchor)).sort((a, b) => byText(a.toUrl, b.toUrl)).slice(0, 3);

  if (mine) {
    const inv = mine.investigation; const p = mine.decision.pattern ?? null;
    if (p) {
      add(RECEIPT.winners, "winning_page", `The ${p.winners} pages that win "${primary}" side by side, and they agree on ${p.commonHeadings.length} ${p.commonHeadings.length === 1 ? "section" : "sections"} to cover and ${p.commonEntities.length} ${p.commonEntities.length === 1 ? "thing" : "things"} to name.`, null);
      for (const t of [...p.commonHeadings.map((x) => x.heading), ...p.questionsAnswered].map((s) => s.trim()).filter(Boolean)) add(RECEIPT.cover(t), "winning_page", `Every one of the pages that win "${primary}" covers ${t}.`, null);
      const gap = p.ownedGaps[0]; if (gap) add(RECEIPT.winnersGap, "winning_page", `${gap.seenOn.length} of them do something this page does not: ${gap.gap}`, null);
      const opening = (p.openingPattern ?? "").trim(); if (opening) add(RECEIPT.winnersOpening, "winning_page", `They all open the same way: ${opening}`, null);
    }
    if (inv.pageType !== "mixed" && inv.pageType !== "unknown") add(RECEIPT.shape, "serp", `The pages that come up for "${primary}" have settled on one kind of page, counted off ${inv.distinctResultDomains} different sites.`, null);
    const want = inv.demand.intent ? WANTS[norm(inv.demand.intent)] : undefined; if (want) add(RECEIPT.intent, "keyword", `The people searching "${primary}" ${want}.`, null);
  }
  if (c.internalLinks.length > 0) add(RECEIPT.links, "internal_link", `From here this page points readers on to ${c.internalLinks.length} other ${c.internalLinks.length === 1 ? "page" : "pages"} of your own.`, c.fetchedAt);
  // HOW THIS PAGE IS SERVED, under the ids the technical cause cites, so a plumbing change is read off a line the operator can see. Nothing is added when nothing was found.
  technical.forEach((f, i) => add(technicalKey(i), "page_extract", f.evidence, null));

  if (!bodyText) missing.push("This page's full body text is not on file, so every draft was checked against its title and section headings only.");

  const readiness: EvidenceReadiness = { gsc: (s.topQueries ?? []).some((q) => isPrimary(q.query)), ownedCopy: !!(c.title || c.metaDescription),
    serp: serps.length > 0, winners: read.length, body: !!bodyText };
  const dates = items.map((it) => it.observedAt).filter((d): d is string => !!d).sort(byText);
  return { items, missing, readiness, diagnosis, bodyText, ahead, freshestObservedAt: dates.length ? dates[dates.length - 1]! : null, prompts: [...new Set(prompts)].sort(byText),
    hasResearch: items.some((it) => it.kind === "keyword" || it.kind === "serp" || it.kind === "ai_observation" || it.kind === "winning_page"),
    contextOnlyKeys: contextOnly, supportKeys, links: links.map((l) => ({ anchor: l.anchor, to: pathOf(l.toUrl) })) };
}

const gateShape = (tenantId: string, query: string, change: RecommendedChange): ChangeProposal => ({
  id: "gate", tenantId, kind: change.kind, pagePath: null, pageUrl: null, pageLabel: "", primaryQuery: query, opportunityType: "", changeFamily: "bundle",
  status: "needs_review", recommendedChange: change, whyItMatters: "", estimatedEffortMinutes: 0, riskLevel: "low", confidence: "medium", limitations: [],
  evidence: { query, hints: [], evidenceRefCount: 0 }, impactScore: null, upsidePerMonth: null, publish: "manual", createdAt: "" });

type ProduceBundleOptions = ProposeOptions & {
  /** THE ACCOUNT'S OWN CLICK CURVE, the same one the diagnosis measured with. Absent = the industry table, which is right only for a caller running outside a pass. */ curve?: { expectedCtrAt: (position: number) => number };
  /** The ONE topic the coverage pass decided: the settled kind of page, what searchers want, and what the winners share. Absent, those causes are not considered. */ coverage?: DecidedTopic | null;
  /** The pages already carrying a change under measurement, so a page still being read is left alone. */ measuringPagePaths?: readonly (string | null)[];
  /** THIS PAGE'S OWN TWO 28 DAY WINDOWS. Without them the ladder cannot ask whether the page slipped or the searching stopped, so the deep read re-diagnosed every fallen page as if its fall had never been measured and the door opened on a fall produced nothing. */ decline?: { clicksNow: number; clicksPrior: number; positionNow: number; positionPrior: number; impressionsNow: number; impressionsPrior: number };
  /** WHICH DOOR SELECTED THIS PAGE, off deep-candidates. Absent = the click door, byte for byte as before. */
  door?: DoorContext | null;
  /** WHAT IS WRONG WITH HOW THIS ACCOUNT'S PAGES ARE SERVED (decision/technical-findings). ABSENT means nobody
   *  looked, so the cause says so rather than clearing the page. Filtered here to the page under work. */
  technical?: readonly TechnicalFinding[];
  /** The account's own banned vocabulary, read once by the caller: no editor here writes a word this account does not publish. */ bannedTerms?: readonly string[];
  /** THE PASS'S SHARED ATTEMPT BUDGET (decision/drafted-copy). Every charged call any editor here makes comes off it, failures included. Absent = a bundle produced outside a pass, which spends against the money caps alone. */ attempts?: { left: number };
};

/** The door contract, structurally satisfied by a DeepCandidate. Only what this file has to check. */
type DoorContext = { door: "ctr_gap" | "coverage_verdict" | "cannibalization" | "recent_decline";
  entry: string; evidence: { query: string | null; engine: string | null; promptText: string | null; competingUrls: readonly string[]; window: string | null } };

/** THE GOAL when the door is not a click gap: a shortfall I cannot show is no objective. */
const doorGoal = (d: DoorContext["door"], q: string): string =>
  d === "coverage_verdict" ? `Make this the page of yours that answers "${q}", off the pages winning it, read side by side.`
      : d === "cannibalization" ? `Put one page of yours in front of "${q}" instead of several, so the clicks stop splitting.`
        : `Win back what this page has lost on "${q}".`;

/** THIS DOOR'S OWN CASE, checked before a word is written. Null = on file. */
function doorEvidenceMissing(d: DoorContext): string | null {
  const e = d.evidence;
  if (!(e.query ?? "").trim()) return "This page was picked off evidence that no longer names the search it was about, so no change is written for it. Research this page again and the finding comes back here.";
  // The verdict that named this page rides in on `coverage` and is checked against this exact page below.
  if (d.door === "coverage_verdict") return null;
  if (d.door === "cannibalization") return e.competingUrls.length >= 2 ? null
    : `This page was picked because two of your own pages come up for "${e.query}", and which pages those are is not settled, so nothing here says combine anything. Which pages Google serves for that search gets checked first.`;
  return e.window ? null
    : `This page was picked because its searches have fallen, and one 90 day total for "${e.query}" is on file with nothing earlier, so the fall cannot be shown. It becomes readable the day a second window of your own search data lands.`;
}

/** WHAT EACH DOOR ACTUALLY MEASURED, in the operator's words, so the wording branch refuses in its own terms. */
const DOOR_MEASURED: Record<DoorContext["door"], string> = { ctr_gap: "it is losing clicks against its own positions",
  coverage_verdict: "the comparison of the pages winning that search names this page",
  cannibalization: "two of your own pages come up for that search", recent_decline: "this page's searches have fallen" };

const OPPORTUNITY_OF: Partial<Record<CauseFinding["cause"], string>> = {
  ctr_snippet: "Rewrite the page that already has the demand",
  weak_opening: "Answer the search in the page's first lines",
  incomplete_coverage: "Cover what the winning pages all cover",
  competitor_content_gap: "Do the one thing the winning pages do",
  serp_shape_shift: "Rebuild this page as the kind that wins",
  intent_shift: "Answer what people are actually asking",
  ai_citation_gap: "Give the assistants a reason to name this page",
  retrieved_not_cited: "Show where this page's claims come from",
  cannibalization: "Settle which page owns this search",
  technical_indexability: "Fix what is stopping this page being found",
  internal_link_weakness: "Give the reader somewhere to go next" };

/** The component kinds that put MORE on the page: an omission the answers keep leaving is evidence for exactly these and for nothing else. */ const COVERS_A_GAP = new Set<BundleComponent["kind"]>(["section", "section_add", "section_rewrite", "restructure", "full_rewrite", "opening_answer", "table_or_list_add", "entity_expansion"]);
/** The smallest bundle carrying ONE component AND the receipt lines it cites: the gate refuses a claim that resolves to nothing, so it is handed the same lines the operator would read. Never persisted. */
const oneComponent = (c: BundleComponent, items: readonly BundleEvidenceItem[]): ChangeBundle => ({
  objective: "gate", metric: "gate", scope: { queries: [], prompts: [] }, components: [c],
  receipt: { items: items.filter((i) => c.evidenceKeys.includes(i.key)), missing: [], freshestObservedAt: null },
  alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "gate" });

/** THE DRAFTERS a producer may buy, wired once for the same firewall, budget, cache and fail-closed posture. */
function producerDrafts(tenantId: string, opts: ProduceBundleOptions, now: Date, ownedPaths: readonly string[]): ProducerDraft {
  const wire = { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains };
  // EVERY CHARGED CALL COMES OFF THE PASS'S POOL, not only the ones an editor makes. The section, link and opening drafters below bought calls the budget never saw, so the pass's own count of what it spent was short by every piece a bundle wrote. Spent BEFORE the call, so a refusal costs what it cost.
  const spent = (): boolean => !!opts.attempts && (opts.attempts.left -= 1) < 0;
  return {
    // THE EDITOR ITSELF, for a page this card does not sit on: same deterministic checks, same judge, that page's own words.
    pageField: (i) => draftFieldForPage({ ...i, ownedPaths }, { tenantId, now, complete: opts.complete, bypassCache: opts.bypassCache, ...(opts.attempts ? { attempts: opts.attempts } : {}), ...(opts.bannedTerms ? { bannedTerms: opts.bannedTerms } : {}) }),
    section: async (i) => {
      if (spent()) return null;
      const r = await draftSectionStructured({ ...i, tenantId }, wire); opts.attempts?.record?.(r);
      return r.status === "drafted" ? { heading: r.value.heading, body: r.value.body, sources: r.value.sources.map((s) => ({ kind: s.kind, detail: s.detail })), containsNumber: r.value.containsNumber } : null;
    },
    internalLink: async (i) => {
      if (spent()) return null;
      const r = await draftInternalLinkStructured({ ...i, tenantId }, wire); opts.attempts?.record?.(r);
      return r.status === "drafted" ? { anchorText: r.value.anchorText, linkSentence: r.value.linkSentence, reason: r.value.reason } : null;
    },
    openingAnswer: async (i) => {
      if (spent()) return null;
      const r = await draftAtomicEditStructured({ query: i.query, pageLabel: i.pageLabel, field: "answer_block",
        currentValue: i.currentValue, outline: i.outline, evidenceHints: i.evidenceHints, tenantId }, wire); opts.attempts?.record?.(r);
      return r.status === "drafted" ? r.value.after : null;
    },
  };
}

/** Produce at most ONE change for the existing page with the biggest PROVEN click gap. `none` with a structured
 *  reason when nothing is losing clicks, when the results page accuses no field, or when the draft fails a
 *  gate. Zero ready is a real answer, not a failure. */
export async function produceBundleForSnapshot(snapshot: EvidenceSnapshot, opts: ProduceBundleOptions & { onlyPageUrl?: string | null; bodyByUrl?: ReadonlyMap<string, OwnedBody> } = {}): Promise<BundleOutcome> {
  const now = opts.now ?? new Date();
  const tenantId = snapshot.scope.tenantId;

  // The diagnosis chose the page: an unproven page never reaches a drafter.
  const only = (opts.onlyPageUrl ?? "").trim().toLowerCase();
  const eligible = only ? snapshot.ownedPages.filter((p) => canonicalUrlKey(p.url) === canonicalUrlKey(only) || pathOf(p.url).toLowerCase() === only) : snapshot.ownedPages;
  const graded = eligible.filter((p) => hasCurrentCopy(p) && queriesOf(p).length > 0)
    .map((p) => { const gaps = gapsOf(p, opts.curve?.expectedCtrAt); return { page: p, gaps, gap: totalRecoverable(gaps) }; }).sort((a, b) => b.gap - a.gap || byText(pathOf(a.page.url), pathOf(b.page.url)));
  // THE CLICK DOOR: only a page whose own positions prove recoverable clicks.
  const scored = graded.filter((r) => r.gap >= MIN_RECOVERABLE_CLICKS);
  const door = opts.door && opts.door.door !== "ctr_gap" ? opts.door : null;
  // EVERY OTHER DOOR TAKES THE PAGE IT NAMED: an engine that answered around it, a comparison, a split. Each is proof in its own right and waits on no Google number.
  const pick = door ? graded[0] : scored[0];
  if (!pick) return { status: "none", reason: door
    ? "The picked page could not be read closely enough to write against, so nothing is handed over. The page is read again on the next pass, and the change follows."
    : "No page of yours is losing enough clicks against what its own positions should earn, so there is nothing honest to rewrite yet." };
  // THE DOOR ANSWERS FOR ITS OWN EVIDENCE: a wrong reason beats no reason nowhere.
  const shortOf = door ? doorEvidenceMissing(door) : null;
  if (shortOf) return { status: "none", reason: shortOf };

  const { page, gaps } = pick; const lead = door ? null : gaps[0]!; const queries = queriesOf(page); const content = page.content!;
  const primary = door ? door.evidence.query!.trim() : lead!.query;
  const body = opts.bodyByUrl?.get(canonicalUrlKey(page.url)) ?? null;
  // THE WHOLE HELD PAGE, built ONCE per page whose words the caller loaded: the ladder judges every absence
  // against this page's, and a change that moves a section off ANOTHER page of yours reads it here or refuses.
  const heldOf = (url: string, c: OwnedPageEvidence["content"], b?: OwnedBody): OwnedPageBody | null => !b ? null
    : { url, title: c?.title ?? null, h1: c?.h1 ?? null, metaDescription: b.metaDescription ?? c?.metaDescription ?? null,
      headings: b.headings ?? c?.outline ?? [], passages: b.passages ?? [], openingSample: b.openingSample, vocabulary: b.vocabulary ?? "", cardTexts: b.cardTexts ?? [],
      faqs: b.faqs ?? [], entityNames: b.entityNames ?? [], internalLinks: b.internalLinks ?? [], fetchedAt: b.fetchedAt,
      completeness: b.completeness ?? "sample_only", contentHash: b.contentHash ?? null, heldNote: b.heldNote ?? "A sample of this page is on file, not the whole page." };
  const held = heldOf(page.url, content, body ?? undefined);
  const heldBodies = new Map(snapshot.ownedPages.flatMap((p) => {
    const one = heldOf(p.url, p.content, opts.bodyByUrl?.get(canonicalUrlKey(p.url)));
    return one ? [[canonicalUrlKey(p.url), one] as const] : []; }));
  const coverage = opts.coverage ?? null;
  const mine = coverage && coverage.decision.ownedUrls.some((u) => canonicalUrlKey(u) === canonicalUrlKey(page.url)) ? coverage : null;
  if (door?.door === "coverage_verdict" && !mine) return { status: "none", reason: `This page was picked because the comparison of "${primary}" named it as the page of yours to improve, and that comparison is no longer on file for it, so no change is written off it. The winning pages are read side by side again on the next pass, and the change follows.` };
  const pattern: WinningPattern | null = mine?.decision.pattern ?? null;
  const technical = opts.technical?.filter((f) => canonicalUrlKey(f.url) === canonicalUrlKey(page.url));
  const receipt = buildReceipt(snapshot, page, queries, primary, weakAnchorsOf(snapshot), body, mine, technical ?? [], heldBodies);
  if (receipt.items.length === 0) return { status: "none", reason: "Nothing about this page is on file to show yet, so no change is asked of it." };
  // NO DRAFT SPEND BEFORE A NAMED CAUSE. ONE ladder, `diagnoseCauses`; nothing here re-derives a cause, so a page said to be losing on X is never handed a change made for Y.
  const diagnosis = receipt.diagnosis;
  const finding = diagnoseCauses({ snapshot, page, query: primary, serpRead: diagnosis, coverage: mine, body: held, decline: opts.decline,
    ...(technical ? { technical } : {}), ...(opts.measuringPagePaths ? { measuringPagePaths: opts.measuringPagePaths } : {}) });
  // A SPLIT IS SETTLED OR IT IS NOT TOUCHED: rewording one of two competing pages leaves them competing.
  if (door?.door === "cannibalization" && finding.cause !== "cannibalization")
    return { status: "none", reason: `Two of your own pages come up for "${primary}" and which of them should own it is not readable yet, so neither is reworded while they are still competing. Which pages Google serves for that search gets checked first.` };
  const facts = receipt.items.map((it) => it.fact);
  const evidenceText = [...facts, ...content.outline, content.title ?? ""].filter(Boolean).join(" ");
  // The relevance gate asks "does the rewrite still name this page's topic". Ground it in THIS page's own words (query + title + h1), never a vertical vocabulary.
  const contextTokens = [...new Set(`${primary} ${content.title ?? ""} ${content.h1 ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(byText);
  const wording = finding.cause === "ctr_snippet";
  // WHAT A PRODUCER MAY NAME IS WHAT I ACTUALLY READ. The wording path keeps its text byte for byte.
  const inventory = snapshot.ownedPages.filter((p) => canonicalUrlKey(p.url) !== canonicalUrlKey(page.url))
    .map((p) => ({ url: p.url, title: p.content?.title ?? null, h1: p.content?.h1 ?? null }))
    .sort((a, b) => byText(pathOf(a.url), pathOf(b.url))).slice(0, MAX_INVENTORY);
  const producerEvidenceText = wording ? evidenceText : [evidenceText, ...(pattern?.commonHeadings ?? []).map((h) => h.heading),
    ...(pattern?.commonEntities ?? []).map((e) => e.entity), ...(pattern?.questionsAnswered ?? []), ...(body?.entityNames ?? []),
    ...(body?.cardTexts ?? []), ...(body?.internalLinks ?? []).map((l) => `${l.anchorText} ${l.href}`),
    ...[...heldBodies.values()].flatMap((b) => [...b.headings, ...b.entityNames]), // every page of yours I actually hold, in its own words: a section moved off one of them is named, never invented
    // A page of this account, by its own address and title, is read and never invented.
    ...inventory.flatMap((p) => [pathOf(p.url), p.title ?? "", p.h1 ?? ""])].filter(Boolean).join(" ");
  const alternatives = wording
    ? diagnosis.alternativesRuledOut.map((a) => ({ option: a.alternative, reason: a.reason }))
    : finding.competingExplanations.map((a) => ({ option: causeLabel(a.cause), reason: a.reason }));
  const components: BundleComponent[] = []; let heldForReview = false;
  /** WHAT TO DO WHEN THE CHANGE IS A JOB: a producer whose work cannot be pasted hands its instructions over
   *  here instead of writing them into the copy an operator clicks Copy on. Null means the copy IS the work. */
  let steps: string[] | null = null; let dispositions: ChangeBundle["dispositions"] | null = null;
  const receiptKeys = new Set(receipt.items.map((i) => i.key));
  // THE SECTIONS THIS PAGE CARRIES, held once: the plan keeps them and the validator holds a rebuild to them.
  const heldHeadings = (held?.headings ?? content.outline).map((h) => h.trim()).filter((h) => h.length > 0);

  const keep = (c: BundleComponent, change: RecommendedChange): void => {
    // EVERY CLAIM TRACES TO SOMETHING ON SCREEN: a component citing nothing is dropped whole, and an answer whose sources I could not see is CONTEXT, never support.
    const own = c.evidenceKeys.filter((k) => receiptKeys.has(k) && !receipt.contextOnlyKeys.includes(k)); const drop = (reason: string): void => { alternatives.push({ option: c.label, reason }); };
    if (own.length === 0) return drop("There was nothing to show behind that one, so it was left out rather than asked to be taken on trust.");
    // A component that ADDS COVERAGE also stands on what the answers keep leaving unanswered, said in the engines' own terms. It ADDS to a piece that already stands on its own evidence and NEVER rescues one standing on none: a rebuild justified solely by an omission somewhere in the case is not a proven change.
    const evidenceKeys = [...new Set([...own, ...(COVERS_A_GAP.has(c.kind) ? receipt.supportKeys.filter((k) => receiptKeys.has(k)) : [])])];
    // THE COMPONENT GATE: every kind outside the grandfathered seven owes where, what, why and what I measure.
    const shaped = { ...gateShape(tenantId, primary, change), ...(c.risk === "dangerous" ? { riskLevel: "high" as const } : {}) };
    const verdict = validateProposal(wording ? shaped : { ...shaped, bundle: oneComponent({ ...c, evidenceKeys }, receipt.items) },
      { pageBodyText: receipt.bodyText ?? null, evidenceText: producerEvidenceText, contextTokens, now, heldHeadings });
    if (verdict.verdict === "rejected") return drop("The drafted rewrite failed one of the safety checks, so it was left out rather than risked.");
    // DANGEROUS SURVIVES THE GATE: downgrading it to "review" took the two-step hold off the one change that needs it, and the stored row then failed its own re-validation as mislabelled.
    const risk = c.risk === "dangerous" ? "dangerous"
      : verdict.verdict === "ready" && c.risk !== "review" ? "safe" : "review";
    if (risk !== "safe") heldForReview = true;
    components.push({ ...c, evidenceKeys, risk });
  };

  if (wording) {
    // A DOOR THAT NEVER MEASURED A CLICK MAY NOT CONCLUDE WORDING: re-running the results reading on a door's own label accuses a title on a page nobody proved is losing clicks.
    if (door) return { status: "none", reason: `This page was picked because ${DOOR_MEASURED[door.door]}, and what its line in the results earns was never measured, so what it gets here is coverage of what it is missing, not a new headline. It is read against the pages winning that search on the next pass, and the addition follows.` };
    if (!readyForAction(diagnosis) || diagnosis.action !== "title") return { status: "none", reason: diagnosis.explanation };
    const before = content.title;
    // THE TITLE DRAFT IS A CHARGED CALL TOO, and it is the only one this file makes outside `producerDrafts`.
    if (opts.attempts && (opts.attempts.left -= 1) < 0) return { status: "none", reason: "This pass has spent its whole attempt budget, so no new headline was bought for this page." };
    const draft = await draftAtomicEditStructured(
      { query: primary, pageLabel: content.h1 ?? content.title ?? page.url, field: "title", currentValue: before, outline: content.outline, evidenceHints: facts, tenantId },
      { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains },
    );
    opts.attempts?.record?.(draft); // real requests and real dollars, onto this page's own allowance
    if (draft.status === "drafted") keep({ kind: "title", label: "Page title", before: before ?? null, after: draft.value.after, evidenceKeys: diagnosis.evidenceKeys, risk: "safe" },
      { kind: "existing_edit", field: "title", before: before ?? null, after: draft.value.after });
    if (components.length === 0) return { status: "none", reason: "No title for this page passed its own checks, so nothing is handed over rather than filler." };
  } else {
      const slot = CORE_PRODUCERS[finding.cause];
    if (typeof slot !== "function") return { status: "none", reason: finding.cause === "no_problem" ? diagnosis.explanation : finding.explanation };
    const drafters = producerDrafts(tenantId, opts, now, snapshot.ownedPages.map((p) => pathOf(p.url)));
    const ctx: ProducerCtx = { finding, primary, tenantId,
      page: { url: page.url, title: content.title, h1: content.h1, outline: content.outline, internalLinkCount: content.internalLinks.length },
      body: held, ownedPages: inventory, pattern, ahead: receipt.ahead, receiptFacts: facts, readiness: receipt.readiness, draft: drafters, heldBodies, templateHeadings: templateHeadings([...heldBodies.values()].map((b) => b.headings ?? [])) }; // furniture is not content to move, and the set is computed from the SAME body headings the merge check reads: the canonical outline is stripped at the assembler now, so a set built from it would be empty and the defense would die silently
    const produced = await slot(ctx);
    steps = produced.operatorSteps ?? null; alternatives.push(...(produced.considered ?? [])); dispositions = produced.dispositions ?? null;
    for (const c of produced.components) {
      const field = fieldForComponent(c.kind);
      keep(c, { kind: "existing_edit", field, before: c.before, after: c.after });
    }
    // SMALLER COMPONENTS FIRST, A REBUILD LAST, and NEVER on a split: it is earned by a SECOND cause that FIRED.
    if (components.length === 0 && finding.cause !== "cannibalization") {
      const rebuild = await produceFullRewriteRecommendation(ctx,
        [finding.cause, ...finding.competingExplanations.filter((c) => c.fired === true).map((c) => c.cause)]);
      for (const c of rebuild.components) keep(c, { kind: "existing_edit", field: fieldForComponent(c.kind), before: c.before, after: c.after });
    }
    if (components.length === 0) return { status: "none", reason: produced.refusal ?? finding.explanation, ...(produced.requirement ? { requirement: produced.requirement } : {}), ...(produced.considered?.length ? { considered: produced.considered } : {}) };
  }

  // A REASON MUST BE TRUE OF THE CARD IT SITS ON: this said the body text was not on file on a card quoting six headings off that very body, so the smaller lever read as a missing read.
  if (receipt.links.length > 0 && finding.cause !== "internal_link_weakness") alternatives.push({ option: "Links out to your own pages", reason: `${receipt.links.length} of your own ${receipt.links.length === 1 ? "page" : "pages"} ${receipt.links.length === 1 ? "is" : "are"} worth linking to from here, and ${receipt.bodyText ? `the cause named on this page is ${causeLabel(finding.cause)}, which a link from here does not treat` : "this page's body text is not on file, so where the link honestly belongs cannot be named. Supply the page copy and it gets placed"}.` });
  const runnerUp = scored[1]; if (runnerUp) alternatives.push({ option: `Start with ${pathOf(runnerUp.page.url)} instead`, reason: `Its searches come up about ${Math.round(runnerUp.gap).toLocaleString()} clicks short against this page's ${Math.round(pick.gap).toLocaleString()}, so it is the smaller win today.` });

  // KEEP / CHANGE / ADD / REMOVE, said out loud: a `before` REPLACES and every other component ADDS, and the sections no component names are what this change leaves alone, so the operator sees most of their page is untouched. A rebuild keeps nothing here; its preservation map answers.
  const touched = (h: string): boolean => components.some((c) => c.kind === "full_rewrite" || c.kind === "restructure"
    || `${c.where ?? ""} ${c.before ?? ""} ${c.label}`.toLowerCase().includes(h.toLowerCase()));
  const plan: ComponentPlan = { keeps: heldHeadings.filter((h) => !touched(h)),
    entries: components.map((c) => ({ kind: c.kind, label: c.label, disposition: c.before == null ? "add" : "change" })),
    removes: components.filter((c) => (c.before ?? "").trim().length > 0)
      .map((c) => ({ what: (c.before ?? "").trim(), why: c.objective ?? `${c.label} takes its place.` })) };
  const confidence = confidenceFor(receipt.readiness, diagnosis);
  // THE ONE-PURCHASE SENTENCE, BROKEN IN TWO: what happened, then what it costs. One idea per clause, both off the same row, and the position's usual take is stated rather than left as arithmetic to do.
  const leadStatement = lead ? `${lead.impressions.toLocaleString()} people saw this page for "${primary}" in 90 days and ${lead.clicks.toLocaleString()} clicked. A page at position ${Math.round(lead.position)} usually earns about ${Math.round(lead.clicks + lead.recoverable).toLocaleString()}, so about ${Math.round(lead.recoverable).toLocaleString()} clicks are being left.`
    : door!.entry;
  // ONE SECTION, ONE SENTENCE: the same fact printed as the reason, the receipt line AND the paragraph is one fact three times, so anything already said elsewhere is dropped rather than repeated back.
  const alreadySaid = new Set([leadStatement.trim(), ...receipt.items.map((it) => it.fact.trim())]);
  const confidenceReasons = [biggerSearchesLine(page, primary, wording), classSentence(receipt),
    receipt.freshestObservedAt ? `The newest evidence behind this was observed on ${receipt.freshestObservedAt.slice(0, 10)}.`
      : "Every figure here is a 90 day total, so none of it carries a single observation date.",
    wording ? diagnosis.explanation : finding.explanation].filter((r): r is string => !!r && !alreadySaid.has(r.trim()));
  const bundle: ChangeBundle = { // objective: Today renders it verbatim, so it is the MODELED shortfall, never a promise
    objective: lead
      ? `Close the gap on the one search "${primary}", which earns this page about ${Math.round(lead.recoverable).toLocaleString()} fewer clicks than pages at position ${Math.round(lead.position)} usually get.`
      // THE GOAL FOLLOWS THE CAUSE THAT WAS SERVED, NOT THE DOOR THAT KNOCKED: a page can enter on a fall and be diagnosed with a split, and the objective then promised to win back lost clicks over components that settle which page owns the search, so one card argued two different changes.
      : doorGoal(finding.cause === "cannibalization" ? "cannibalization" : door!.door, primary),
    metric: `Clicks from search for "${primary}" over the next 28 days.`,
    scope: { queries: queries.map((q) => q.query), prompts: receipt.prompts },
    components, plan, ...(dispositions ? { dispositions } : {}),
    receipt: { items: receipt.items, missing: receipt.missing, freshestObservedAt: receipt.freshestObservedAt },
    alternatives,
    risks: [
      `Changing ${wording ? "a title moves where the page ranks" : "what a page says moves where it ranks"} while search engines re-read it, so give this the full 28 days before you judge it.`,
      receipt.bodyText ? "These are this page's stored words, not today's live page, so read each line once against the page before you paste it."
        : "This page's full body text is not on file, so read each line once before you paste it.",
    ],
    confidenceReasons,
    measurementPlan: "Once you make the change, record it on Results with the page address, and clicks, views and average position for these searches get read at 7, 14 and 28 days, compared against pages you did not change.",
  };

  const primaryComponent = components[0]!;
  // THE FAMILY THIS CHANGE BELONGS TO, worn by the id AND the stamp. The id ended in the literal word "bundle" and the family
  // read "single", so a snippet rewrite and a body rebuild on one page fought over one id and every shipped bundle reached the proof ledger unclassifiable. Both read the store's own derivation now.
  const recommendedChange: RecommendedChange = { kind: "existing_edit", field: fieldForComponent(primaryComponent.kind), before: primaryComponent.before, after: primaryComponent.after };
  const family = actionFamilyOf({ kind: "existing_edit", bundle, recommendedChange });
  const proposal: ChangeProposal = {
      id: `${tenantId}::${pathOf(page.url)}::existing_edit::${family}`,
      tenantId, kind: "existing_edit", changeFamily: family, publish: "manual",
      pagePath: pathOf(page.url), pageUrl: page.url.startsWith("http") ? page.url : `https://${page.url}`,
      pageLabel: content.h1 ?? content.title ?? page.url, primaryQuery: primary,
      opportunityType: OPPORTUNITY_OF[finding.cause] ?? "Rewrite the page that already has the demand",
      status: heldForReview ? "needs_review" : "ready", // an investigation I cannot close never reaches here at all
      recommendedChange,
      whyItMatters: leadStatement,
      // WHAT THIS COSTS AND WHAT IT RISKS, by the kind of change it is: a merge and a rebuild are not one price, and a lever that moves or hides a page carries the highest risk on the row.
      ...(steps ? { operatorSteps: steps } : {}),
      estimatedEffortMinutes: effortMinutesFor(primaryComponent.kind), confidence, limitations: receipt.missing,
      riskLevel: components.some((c) => c.risk === "dangerous") ? "high" : !wording && heldForReview ? "medium" : "low",
      // THE CAUSE THAT PRODUCED THESE COMPONENTS, and the whole reading behind it, so the ranker can ask whether this lever addresses the loss.
      diagnosisCause: finding.cause, causeFinding: finding,
      evidence: { query: primary, hints: facts.slice(0, 5), evidenceRefCount: receipt.items.length },
      // A SIZE ONLY WHERE ONE IS PROVEN: an unproven door ranks as a direction, never as zero clicks.
      impactScore: pick.gap >= MIN_RECOVERABLE_CLICKS ? Math.round(pick.gap) : null, upsidePerMonth: null, bundle, createdAt: now.toISOString(),
  };
  // THE WHOLE ROW, GATED: the per-component gate reads a synthetic proposal carrying no cause and no notes, so
  // a claim that resolves to nothing reached the operator through the gap between a piece and the whole change.
  const failed = receiptIntegrityFailures(proposal, now);
  if (failed.length > 0) return { status: "none", reason: `Not everything this change claims can be shown, so it is held back. Research this page again and the finding comes back here.` };
  return { status: "bundled", proposal };
}
