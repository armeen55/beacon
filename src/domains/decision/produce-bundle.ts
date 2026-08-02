/**
 * decision/produce-bundle. The ONE producer of a deep, copy-ready change for a page a door selected. Order is
 * deliberate: SELECT, BUILD the evidence receipt FIRST for the EXACT candidate search, DIAGNOSE off that receipt,
 * and only then draft the ONE field the diagnosis named. Confidence follows the EVIDENCE HELD, never how it reads.
 *
 * EVERY DOOR IS SERVED ON ITS OWN TERMS. The click door keeps its exact selection: the biggest proven shortfall
 * against a page's own positions. Every other door selects the page IT named, with no clicks filter, and answers
 * for ITS OWN evidence: a door whose case is not on file returns none in that door's words rather than borrowing
 * the click sentence, and the primary search is the door's own, never a gap query that does not exist.
 *
 * No evidence means no change, and every input list is re-sorted before it is read, so the same evidence in any
 * order produces a byte-identical result. server-only.
 */

import "server-only";

import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot"; import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { draftAtomicEditStructured, draftInternalLinkStructured, draftSectionStructured } from "@/domains/decision/llm/structured-drafter"; import { defaultExpectedCtrAt } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ActionDiagnosis, ChangeBundle, BundleComponent, BundleEvidenceItem, ChangeProposal, EvidenceReadiness, RecommendedChange } from "./contracts"; import { confidenceFor, MIN_CTR_DEFICIT, MIN_QUERY_IMPRESSIONS, MIN_RECOVERABLE_CLICKS, readyForAction } from "./contracts";
import { diagnoseCandidate, ownedResultOf, recurringPattern, RECEIPT, type DiagnosisInput } from "./diagnose";
import { causeLabel, diagnoseCauses, type CauseFinding } from "./diagnosis";
import type { DecidedTopic } from "./coverage-pass";
import type { WinningPattern } from "./winning-pattern";
import { CORE_PRODUCERS } from "./producers/core"; import { produceFullRewriteRecommendation } from "./producers/extended"; import { effortMinutesFor, fieldForComponent, type ProducerCtx, type ProducerDraft } from "./producers/contract";
import type { ProposeOptions } from "./propose"; import { validateProposal } from "./validate-proposal";
import { anchoredTopicMatch, canonicalQueryKey, weakAnchorTokens } from "@/domains/evidence/relevance-gate";

export type BundleOutcome = { status: "bundled"; proposal: ChangeProposal } | { status: "none"; reason: string };

type Research = EvidenceSnapshot["research"];
type Observation = Research["aiObservations"][number];
type SerpEvidence = Research["serpEvidence"][number];
type Keyword = Research["retainedKeywords"][number];

const norm = (s: string): string => s.trim().toLowerCase();
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The page's OWN WORDS, whole, read by the caller through the targeted Evidence reader. Absent means absent:
 *  drafts are checked against title and headings only and body readiness stays honestly false. */
export type OwnedBody = { openingSample: string | null; fetchedAt: string | null;
  cardTexts?: string[]; entityNames?: string[]; internalLinks?: { href: string; anchorText: string }[]; metaDescription?: string | null;
  headings?: string[]; passages?: string[]; faqs?: { question: string; answer: string }[];
  completeness?: "complete" | "partial" | "sample_only"; heldNote?: string };

/** RECOVERABLE OPPORTUNITY, never gross traffic. Per query clearing MIN_QUERY_IMPRESSIONS the frozen CTR curve says
 *  what that position earns; the shortfall under it, once past MIN_CTR_DEFICIT, is what a fix could win back. */
type Gap = { query: string; impressions: number; clicks: number; position: number; recoverable: number };
const gapsOf = (p: OwnedPageEvidence): Gap[] => (p.search?.topQueries ?? []).flatMap((q) => {
  if (q.impressions < MIN_QUERY_IMPRESSIONS || q.position == null) return [];
  const deficit = defaultExpectedCtrAt(q.position) - q.clicks / q.impressions;
  return deficit < MIN_CTR_DEFICIT ? [] : [{ query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.position, recoverable: deficit * q.impressions }];
}).sort((a, b) => b.recoverable - a.recoverable || byText(a.query, b.query));
const totalRecoverable = (gaps: Gap[]): number => gaps.reduce((a, g) => a + g.recoverable, 0);
const hasCurrentCopy = (p: OwnedPageEvidence): boolean => !!p.content && !!(p.content.title || p.content.h1 || p.content.outline.length > 0);

function parseUrl(url: string): URL | null { try { return new URL(url.startsWith("http") ? url : `https://${url}`); } catch { return null; } }
const pathOf = (url: string): string => parseUrl(url)?.pathname || (url.startsWith("/") ? url : `/${url}`);

/** WEAK ANCHORS: the words this account puts on nearly everything fit anything, so alone they attach no evidence
 *  to a change. Read fresh from the account's own corpus; under MIN_ANCHOR_CORPUS phrases the set is empty, so a
 *  single-topic account keeps the evidence that genuinely is about its one topic. */
const MIN_ANCHOR_CORPUS = 10;
const MAX_INVENTORY = 200;
function weakAnchorsOf(snapshot: EvidenceSnapshot): Set<string> {
  const r = snapshot.research; const phrases = [...new Set([...(r?.retainedKeywords ?? []).map((k) => k.query), ...(r?.aiObservations ?? []).map((o) => o.promptText),
    ...snapshot.ownedPages.map((p) => p.content?.title || p.content?.h1 || pathOf(p.url))].map((s) => (s ?? "").trim()).filter(Boolean))];
  return phrases.length < MIN_ANCHOR_CORPUS ? new Set<string>() : weakAnchorTokens(phrases);
}

const topicMatch = (a: string, b: string, weak: ReadonlySet<string>): boolean =>
  norm(a) === norm(b) || anchoredTopicMatch(a, b, weak).relevant;

/** A winner attaches ONLY on EXACT membership: its appearance under a member query or prompt, or its exact URL
 *  cited for one. A shared DOMAIN proves nothing, and resemblance in a title is not membership either. */
const winnerBelongs = (w: Research["winningPages"][number], queries: ReadonlySet<string>, prompts: ReadonlySet<string>, urls: ReadonlySet<string>): boolean =>
  urls.has(canonicalUrlKey(w.url)) || w.appearances.some((a) =>
    (!!a.query && queries.has(canonicalQueryKey(a.query))) || (!!a.promptText && prompts.has(norm(a.promptText))));

const WANTS: Record<string, string> = { informational: "want an explanation", commercial: "are comparing options",
  transactional: "are ready to act", navigational: "are looking for one specific site" };

const keywordFact = (k: Keyword, w = k.intent ? WANTS[norm(k.intent)] : undefined): string =>
  `"${k.query}" gets about ${k.searchVolume!.toLocaleString()} searches a month${w ? `, and the people searching it ${w}` : ""}.`;
const serpFact = (e: SerpEvidence, led = [...e.organic].sort((a, b) => a.rank - b.rank).slice(0, 3).map((o) => o.domain)): string =>
  `For "${e.query}" the results page is led by ${led.join(", ") || "pages I could not name"}, and the answer box at the top cites ${e.aiOverview.length} ${e.aiOverview.length === 1 ? "source" : "sources"}.`;
const observationFact = (o: Observation): string => {
  const domains = [...new Set((o.citations ?? []).map((cit) => cit.domain))].sort(byText).slice(0, 3);
  const seen = o.observationMode === "consumer_search" ? `When a customer searches "${o.promptText}" inside an assistant, `
    : `In a plain assistant answer to "${o.promptText}" (background reading, not what a searching customer sees), `;
  const cited = o.citations == null ? "I could not see which pages it leaned on."
    : domains.length === 0 ? "it answers without pointing at anyone." : `it points people at ${domains.join(", ")}.`;
  // Fan-out lineage: the searches the ASSISTANT itself ran. A question I track is mine and is never reported as the provider's.
  const fan = (o.fanOutQueries ?? []).slice(0, 3);
  return `${seen}${cited}${fan.length ? ` To answer it the assistant went and searched ${fan.map((q) => `"${q}"`).join(", ")}.` : ""}`;
};

const CLASS_OF: Record<BundleEvidenceItem["kind"], string> = {
  gsc_demand: "your own search data", page_extract: "what the page says today", keyword: "monthly search counts",
  serp: "a live results check", ai_observation: "an AI answer I watched", winning_page: "a winning page comparison",
  competitor: "the sites AI hands this to instead of you", internal_link: "links from your own pages",
  diagnosis: "what the results page told me about the cause" };
const classSentence = (r: Receipt, c = [...new Set(r.items.map((it) => CLASS_OF[it.kind]))]): string =>
  `I built this from ${c.length > 1 ? `${c.slice(0, -1).join(", ")}, and ${c[c.length - 1]}` : c[0] ?? "nothing I can show you"}, and I can show you every piece.`;

const queriesOf = (page: OwnedPageEvidence): OwnedQuerySignal[] => [...(page.search?.topQueries ?? [])]
  .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || byText(a.query, b.query)).slice(0, 5);

type Receipt = ChangeBundle["receipt"] & { prompts: string[]; hasResearch: boolean; contextOnlyKeys: string[]; links: { anchor: string; to: string }[]; readiness: EvidenceReadiness; diagnosis: ActionDiagnosis; bodyText?: string | null };

/** A pattern is claimable only across MULTIPLE pages that come up for this exact search, and only as a count
 *  I can show: one page's style is that page's style. */
function winnerPattern(read: Research["winningPages"], c: NonNullable<OwnedPageEvidence["content"]>, primary: string): string | null {
  if (read.length < 2) return null;
  const words = [...read.map((w) => w.extract!.wordCount)].sort((a, b) => a - b); const median = words[Math.floor(words.length / 2)]!;
  const faq = read.filter((w) => w.extract!.faqCount > 0).length; const bits: string[] = [];
  if (faq >= 2) bits.push(`${faq} of them answer it in a question and answer block${c.hasFaq ? " and so does this page" : ", and this page has none"}`);
  if (median >= Math.round(c.wordCount * 1.5)) bits.push(`the middle one runs ${median.toLocaleString()} words against this page's ${c.wordCount.toLocaleString()}`);
  return bits.length === 0 ? null : `Of the ${read.length} pages I read that come up for "${primary}", ${bits.join(", and ")}.`;
}

function buildReceipt(snapshot: EvidenceSnapshot, page: OwnedPageEvidence, queries: OwnedQuerySignal[], primary: string, weak: ReadonlySet<string>, body: OwnedBody | null, mine: DecidedTopic | null): Receipt {
  const items: BundleEvidenceItem[] = []; const contextOnly: string[] = []; const missing: string[] = []; const prompts: string[] = [];
  const add = (key: string, kind: BundleEvidenceItem["kind"], fact: string, observedAt: string | null): void => { items.push({ key, kind, fact, observedAt }); };
  const research = snapshot.research;
  // QUERY IDENTITY, never similarity: a neighbouring search with a different modifier stands in for nothing.
  const isPrimary = (q: string): boolean => norm(q) === norm(primary) || canonicalQueryKey(q) === canonicalQueryKey(primary);
  const s = page.search!; const c = page.content!;
  // Support attaches only when it is about THIS page: anything sharing nothing with its own words is noise.
  const pageTopic = [...queries.map((q) => q.query), c.title ?? "", c.h1 ?? ""].join(" ");
  const onTopic = (text: string): boolean => topicMatch(text, pageTopic, weak);

  // SCOPE IS PART OF THE NUMBER: a page total says "this page overall", a query claim carries only that query's figures.
  add("demand-page", "gsc_demand", `Over the last 90 days this page overall earned ${s.clicks90d.toLocaleString()} clicks from ${s.impressions90d.toLocaleString()} views in search, across every search that reaches it, at about position ${Math.round(s.position90d)}.`, null);
  const queryFact = (q: OwnedQuerySignal): string => `That one search "${q.query}" brings this page ${q.impressions.toLocaleString()} views and ${q.clicks.toLocaleString()} clicks${q.position == null ? "" : `, at about position ${Math.round(q.position)}`}.`;
  const exact = (s.topQueries ?? []).find((q) => isPrimary(q.query));
  if (exact) add(RECEIPT.gsc, "gsc_demand", queryFact(exact), null); // the EXACT search the gap was measured on, never a neighbour
  queries.slice(0, 3).filter((q) => !isPrimary(q.query)).forEach((q, i) => add(`demand-q${i + 1}`, "gsc_demand", queryFact(q), null));
  add(RECEIPT.copy, "page_extract", `Today the page ${c.title ? `is titled "${c.title}"` : "has no title set"} and runs ${c.wordCount.toLocaleString()} words across ${c.outline.length} sections.`, c.fetchedAt);
  const keywords = [...(research?.retainedKeywords ?? [])].filter((k) => isPrimary(k.query) && k.searchVolume != null)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || byText(norm(a.query), norm(b.query)));
  if (keywords.length === 0) missing.push(`I do not have a monthly search count for "${primary}" yet.`);
  keywords.slice(0, 3).forEach((k, i) => add(`kw${i + 1}`, "keyword", keywordFact(k), null));
  const serps = [...(research?.serpEvidence ?? [])].filter((e) => isPrimary(e.query)).sort((a, b) => byText(norm(a.query), norm(b.query)));
  if (serps.length === 0) missing.push(`I have not looked at the live results page for "${primary}" yet, so I cannot yet name what is taking the clicks.`);
  serps.slice(0, 2).forEach((e, i) => add(`serp${i + 1}`, "serp", serpFact(e), null));

  // WHAT THAT RESULTS PAGE ACTUALLY SAYS. Holding it is not reading it, and wording that RECURS across the
  // results beating this page is the only pattern I may call a pattern.
  const bodyText = (body?.openingSample ?? "").trim() || null; const dx: DiagnosisInput = { query: primary, ownedUrl: page.url, organic: serps[0]?.organic ?? null, body: !!bodyText, gscPosition: exact?.position ?? null };
  if (bodyText) add(RECEIPT.body, "page_extract", `In its own words the page opens: "${bodyText.slice(0, 240)}".`, body?.fetchedAt ?? null);
  const owned = ownedResultOf(dx); const pattern = recurringPattern(dx, owned); const diagnosis = diagnoseCandidate(dx);
  if (diagnosis.status === "diagnosed") { // the conclusion is inspectable evidence too, beside the observations it cites
    add("diagnosis", "diagnosis", diagnosis.explanation, null);
    diagnosis.alternativesRuledOut.forEach((a, i) => add(`ruledout${i + 1}`, "diagnosis", `${a.alternative}: ${a.reason}`, null)); }
  if (owned) add(RECEIPT.ownedResult, "serp", `On that results page Google shows this page worded "${(owned.title ?? "").trim()}".`, null);
  else if (serps.length > 0) missing.push(`I could not find this page on the results page for "${primary}", so I cannot see what a searcher reads for it.`);
  if (pattern.length > 0) add(RECEIPT.pattern, "serp", `Across the other pages that come up for "${primary}", ${pattern.slice(0, 4).map((t) => `"${t}"`).join(", ")} recur in the wording Google shows.`, null);
  else if (serps.length > 0) missing.push(`The pages that come up for "${primary}" share no recurring wording I can point at.`);

  // ABOUT THE SEARCH, not merely about the page: an answer attaches only when its own words anchor to THIS
  // search, or a search the assistant really ran IS it. Citing this page is not attachment.
  const observations = [...(research?.aiObservations ?? [])].filter((o) => topicMatch(o.promptText, primary, weak)
    || (o.fanOutQueries ?? []).some(isPrimary)).sort(
    (a, b) => byText(a.observationMode, b.observationMode) || byText(a.promptText, b.promptText) || byText(a.engine, b.engine));
  const consumer = observations.filter((o) => o.observationMode === "consumer_search");
  const plain = observations.filter((o) => o.observationMode !== "consumer_search");
  if (observations.length === 0) missing.push(`I have not gathered an AI answer about "${primary}" yet.`);
  else if (consumer.length === 0) missing.push(`I have not yet watched what a customer sees when they ask an assistant about "${primary}".`);
  // THE FIRST ANSWER CARRIES THE ID THE CAUSE LADDER CITES (RECEIPT.ai), or a change made because an engine
  // skipped this page cannot show the answer behind it and is dropped whole for citing nothing.
  [...consumer.slice(0, 2), ...plain.slice(0, 1)].forEach((o, i) => {
    const key = i === 0 ? RECEIPT.ai : `ai${i + 1}`;
    add(key, "ai_observation", observationFact(o), o.observedAt);
    if (o.citations == null) contextOnly.push(key); // context, never component support
    prompts.push(o.promptText);
  });

  // A winner belongs to THIS search only: on that results page, in an AI answer about it, or under it. Any other route is somebody else's evidence.
  const memberPrompts = new Set(observations.map((o) => norm(o.promptText)));
  const memberQueries = new Set([primary, ...observations.flatMap((o) => o.fanOutQueries ?? [])].map(canonicalQueryKey));
  const memberUrls = new Set([...observations.flatMap((o) => (o.citations ?? []).map((cit) => cit.url)),
    ...serps.flatMap((e) => [...e.organic.map((x) => x.url), ...e.aiOverview.map((cit) => cit.url), ...e.aiMode.map((cit) => cit.url)])].map(canonicalUrlKey));
  const belongs = [...(research?.winningPages ?? [])].filter((w) => winnerBelongs(w, memberQueries, memberPrompts, memberUrls)).sort((a, b) => byText(a.url, b.url));
  const read = belongs.filter((w) => !!w.extract); const winners = belongs.slice(0, 2);
  if (winners.length === 0) missing.push(`I have not read the pages that come up for "${primary}" yet.`);
  // SAY HOW IT GOT HERE: a page that arrived by organic rank was never cited by an assistant.
  winners.forEach((w, i) => add(`win${i + 1}`, "winning_page",
    `${w.domain} ${w.appearances.some((a) => a.kind !== "serp_organic") ? "is one of the pages AI keeps citing here" : `comes up on the results page for "${primary}"`}${w.extract ? `, and it runs ${w.extract.wordCount.toLocaleString()} words under ${w.extract.headings.length} headings` : ""}.`,
    [...w.appearances].sort((a, b) => byText(b.observedAt, a.observedAt))[0]?.observedAt ?? null));
  const winners2 = winnerPattern(read, c, primary);
  if (winners2) add("winpattern", "winning_page", winners2, null);

  // A link needs TWO proofs: an on-topic destination AND body text proving where it belongs.
  const links = [...snapshot.internalLinkOpportunities].filter((l) => l.fromUrl === page.url && onTopic(l.anchor))
    .sort((a, b) => byText(a.toUrl, b.toUrl)).slice(0, 3);

  // THE CAUSE LADDER'S OWN RECEIPT LINES, under the exact ids it cites. No verdict for this page, no lines.
  if (mine) {
    const inv = mine.investigation; const p = mine.decision.pattern ?? null;
    if (p) {
      add(RECEIPT.winners, "winning_page", `I read the ${p.winners} pages that win "${primary}" side by side, and they agree on ${p.commonHeadings.length} ${p.commonHeadings.length === 1 ? "section" : "sections"} to cover and ${p.commonEntities.length} ${p.commonEntities.length === 1 ? "thing" : "things"} to name.`, null);
      const head = p.commonHeadings[0]; if (head) add(RECEIPT.winnersHeading, "winning_page", `Every one of those pages covers ${head.heading}.`, null);
      const gap = p.ownedGaps[0]; if (gap) add(RECEIPT.winnersGap, "winning_page", `${gap.seenOn.length} of them do something this page does not: ${gap.gap}`, null);
      const opening = (p.openingPattern ?? "").trim(); if (opening) add(RECEIPT.winnersOpening, "winning_page", `They all open the same way: ${opening}`, null);
    }
    if (inv.pageType !== "mixed" && inv.pageType !== "unknown") add(RECEIPT.shape, "serp", `The pages that come up for "${primary}" have settled on one kind of page, and I counted it off ${inv.distinctResultDomains} different sites.`, null);
    const want = inv.demand.intent ? WANTS[norm(inv.demand.intent)] : undefined;
    if (want) add(RECEIPT.intent, "keyword", `The people searching "${primary}" ${want}.`, null);
  }
  if (c.internalLinks.length > 0) add(RECEIPT.links, "internal_link", `From here this page points readers on to ${c.internalLinks.length} other ${c.internalLinks.length === 1 ? "page" : "pages"} of your own.`, c.fetchedAt);

  if (!bodyText) missing.push("I do not hold this page's full body text, so I checked every draft against its title and section headings only.");

  const readiness: EvidenceReadiness = { gsc: (s.topQueries ?? []).some((q) => isPrimary(q.query)), ownedCopy: !!(c.title || c.metaDescription),
    serp: serps.length > 0, winners: read.length, body: !!bodyText };
  const dates = items.map((it) => it.observedAt).filter((d): d is string => !!d).sort(byText);
  return { items, missing, readiness, diagnosis, bodyText, freshestObservedAt: dates.length ? dates[dates.length - 1]! : null, prompts: [...new Set(prompts)].sort(byText),
    hasResearch: items.some((it) => it.kind === "keyword" || it.kind === "serp" || it.kind === "ai_observation" || it.kind === "winning_page"),
    contextOnlyKeys: contextOnly, links: links.map((l) => ({ anchor: l.anchor, to: pathOf(l.toUrl) })) };
}

const gateShape = (tenantId: string, query: string, change: RecommendedChange): ChangeProposal => ({
  id: "gate", tenantId, kind: change.kind, pagePath: null, pageUrl: null, pageLabel: "", primaryQuery: query, opportunityType: "", changeFamily: "bundle",
  status: "needs_review", recommendedChange: change, whyItMatters: "", estimatedEffortMinutes: 0, riskLevel: "low", confidence: "medium", limitations: [],
  evidence: { query, hints: [], evidenceRefCount: 0 }, impactScore: null, upsidePerMonth: null, publish: "manual", createdAt: "" });

export type ProduceBundleOptions = ProposeOptions & {
  /** The ONE topic the coverage pass decided, when it decided one: the settled kind of page, what searchers
   *  want, and what the winning pages share. Absent, those causes are honestly not considered. */
  coverage?: DecidedTopic | null;
  /** The pages already carrying a change under measurement, so a page whose last edit is still being read
   *  is left alone rather than handed a second change to stack on it. */
  measuringPagePaths?: readonly (string | null)[];
  /** WHICH DOOR SELECTED THIS PAGE, straight off deep-candidates. Absent = the click door, so an unaware
   *  caller behaves byte for byte as the single-door pass did. */
  door?: DoorContext | null;
};

/** The door contract, structurally satisfied by a DeepCandidate. Only what this file has to check. */
type DoorContext = { door: "ctr_gap" | "ai_absence" | "coverage_verdict" | "cannibalization" | "recent_decline";
  entry: string; evidence: { query: string | null; engine: string | null; promptText: string | null; competingUrls: readonly string[]; window: string | null } };

/** THE GOAL when the door is not a click gap: a shortfall I cannot show is not an objective I may write. */
const doorGoal = (d: DoorContext["door"], q: string): string =>
  d === "ai_absence" ? `Give the assistants answering "${q}" a reason to name this page instead of somebody else.`
    : d === "coverage_verdict" ? `Make this the page of yours that answers "${q}", off the pages winning it that I read side by side.`
      : d === "cannibalization" ? `Put one page of yours in front of "${q}" instead of several, so the clicks stop splitting.`
        : `Win back what this page has lost on "${q}".`;

/** THIS DOOR'S OWN CASE, checked before a word is written against the page it named. Null = on file. */
function doorEvidenceMissing(d: DoorContext, snapshot: EvidenceSnapshot): string | null {
  const e = d.evidence;
  if (!(e.query ?? "").trim()) return "I picked this page off evidence that no longer names the search it was about, so I am not writing a change for it. Let me research this page again and I will come back with what I found.";
  if (d.door === "ai_absence") return !!e.engine && !!e.promptText && snapshot.research.aiObservations.some((o) =>
    norm(o.promptText) === norm(e.promptText!) && norm(o.engine) === norm(e.engine!)) ? null
    : `I picked this page because an assistant answered a question I watch without naming it, and I no longer hold that answer, so I will not write a change off it. Let me watch "${e.query}" again and I will come back with what the assistant said.`;
  // The verdict that named this page rides in on `coverage` and is checked against this exact page below.
  if (d.door === "coverage_verdict") return null;
  if (d.door === "cannibalization") return e.competingUrls.length >= 2 ? null
    : `I picked this page because two of your own pages come up for "${e.query}", and I have not settled which pages those are, so I am not telling you to combine anything. Let me check which of your pages Google serves for that search and I will come back.`;
  return e.window ? null
    : `I picked this page because its searches have fallen, and I hold one 90 day total for "${e.query}" and nothing earlier, so I cannot show you the fall. I will be able to read it the day I hold a second window of your own search data.`;
}

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
  internal_link_weakness: "Give the reader somewhere to go next" };

/** The smallest bundle carrying ONE component, so the component gate can answer for it. Never persisted. */
const oneComponent = (c: BundleComponent): ChangeBundle => ({
  objective: "gate", metric: "gate", scope: { queries: [], prompts: [] }, components: [c],
  receipt: { items: [], missing: [], freshestObservedAt: null }, alternatives: [], risks: [], confidenceReasons: [], measurementPlan: "gate" });

/** THE DRAFTERS a producer may buy, wired once so every one gets the same firewall, budget, cache and
 *  fail-closed posture. A drafter that does not land is null: the producer refuses on it. */
function producerDrafts(tenantId: string, opts: ProduceBundleOptions, now: Date): ProducerDraft {
  const wire = { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains };
  return {
    section: async (i) => {
      const r = await draftSectionStructured({ ...i, tenantId }, wire);
      return r.status === "drafted" ? { heading: r.value.heading, body: r.value.body, sources: r.value.sources.map((s) => ({ kind: s.kind, detail: s.detail })), containsNumber: r.value.containsNumber } : null;
    },
    internalLink: async (i) => {
      const r = await draftInternalLinkStructured({ ...i, tenantId }, wire);
      return r.status === "drafted" ? { anchorText: r.value.anchorText, linkSentence: r.value.linkSentence, reason: r.value.reason } : null;
    },
    openingAnswer: async (i) => {
      const r = await draftAtomicEditStructured({ query: i.query, pageLabel: i.pageLabel, field: "answer_block",
        currentValue: i.currentValue, outline: i.outline, evidenceHints: i.evidenceHints, tenantId }, wire);
      return r.status === "drafted" ? r.value.after : null;
    },
  };
}

/** Produce at most ONE change for the existing page with the biggest PROVEN click gap. `none` with a structured
 *  reason when no page is losing clicks against its own positions, when the results page for that exact search does
 *  not accuse a field, or when the one draft it earned fails a gate. Zero ready is a real answer, not a failure. */
export async function produceBundleForSnapshot(snapshot: EvidenceSnapshot, opts: ProduceBundleOptions & { onlyPageUrl?: string | null; bodyByUrl?: ReadonlyMap<string, OwnedBody> } = {}): Promise<BundleOutcome> {
  const now = opts.now ?? new Date();
  const tenantId = snapshot.scope.tenantId;

  // The diagnosis already chose the page: an unproven page never reaches a drafter.
  const only = (opts.onlyPageUrl ?? "").trim().toLowerCase();
  const eligible = only ? snapshot.ownedPages.filter((p) => canonicalUrlKey(p.url) === canonicalUrlKey(only) || pathOf(p.url).toLowerCase() === only) : snapshot.ownedPages;
  const graded = eligible.filter((p) => hasCurrentCopy(p) && queriesOf(p).length > 0)
    .map((p) => { const gaps = gapsOf(p); return { page: p, gaps, gap: totalRecoverable(gaps) }; })
    .sort((a, b) => b.gap - a.gap || byText(pathOf(a.page.url), pathOf(b.page.url)));
  // THE CLICK DOOR, unchanged: only a page whose own positions prove recoverable clicks.
  const scored = graded.filter((r) => r.gap >= MIN_RECOVERABLE_CLICKS);
  const door = opts.door && opts.door.door !== "ctr_gap" ? opts.door : null;
  // EVERY OTHER DOOR TAKES THE PAGE IT NAMED: a question an engine answered around this page, a comparison
  // that named it, a split. Each is proof in its own right and waits on no Google number.
  const pick = door ? graded[0] : scored[0];
  if (!pick) return { status: "none", reason: door
    ? "I could not read the page I picked closely enough to write against it, so I am handing you nothing. Let me read that page again and I will come back with the change."
    : "No page of yours is losing enough clicks against what its own positions should earn, so I have nothing honest to rewrite yet." };
  // THE DOOR ANSWERS FOR ITS OWN EVIDENCE: the wrong reason is worse than no reason.
  const shortOf = door ? doorEvidenceMissing(door, snapshot) : null;
  if (shortOf) return { status: "none", reason: shortOf };

  const { page, gaps } = pick; const lead = door ? null : gaps[0]!; const queries = queriesOf(page); const content = page.content!;
  const primary = door ? door.evidence.query!.trim() : lead!.query;
  const body = opts.bodyByUrl?.get(canonicalUrlKey(page.url)) ?? null;
  // THE COVERAGE VERDICT IS ABOUT ONE PAGE: only the verdict that NAMES this page is read against it.
  const coverage = opts.coverage ?? null;
  const mine = coverage && coverage.decision.ownedUrls.some((u) => canonicalUrlKey(u) === canonicalUrlKey(page.url)) ? coverage : null;
  if (door?.door === "coverage_verdict" && !mine) return { status: "none", reason: `I picked this page because my comparison of "${primary}" named it as the page of yours to improve, and I do not hold that comparison against this page any more, so I am not writing a change off it. Let me read the pages that win it side by side again and I will come back with the change.` };
  const pattern: WinningPattern | null = mine?.decision.pattern ?? null;
  const receipt = buildReceipt(snapshot, page, queries, primary, weakAnchorsOf(snapshot), body, mine);
  // NOTHING to show is never a recommendation: an empty receipt refuses rather than ship a bare instruction.
  if (receipt.items.length === 0) return { status: "none", reason: "I hold nothing I can show you about this page yet, so I will not tell you to change it." };
  // NO DRAFT SPEND BEFORE A NAMED CAUSE. THE CAUSE LADDER is asked with exactly the inputs opportunities.ts
  // asks it with. There is ONE ladder and it is `diagnoseCauses`; nothing here re-derives a cause, so a page
  // the customer surface says is losing on X can never be handed a change made for Y.
  const diagnosis = receipt.diagnosis;
  const finding = diagnoseCauses({ snapshot, page, query: primary, serpRead: diagnosis, coverage: mine,
    ...(opts.measuringPagePaths ? { measuringPagePaths: opts.measuringPagePaths } : {}) });
  // A SPLIT IS SETTLED OR IT IS NOT TOUCHED: rewording one of two competing pages leaves them competing.
  if (door?.door === "cannibalization" && finding.cause !== "cannibalization")
    return { status: "none", reason: `Two of your own pages come up for "${primary}" and I cannot yet see which of them should own it, so I am not rewording either one while they are still competing. Let me check which of your pages Google serves for that search and I will come back with which to keep.` };
  const facts = receipt.items.map((it) => it.fact);
  const evidenceText = [...facts, ...content.outline, content.title ?? ""].filter(Boolean).join(" ");
  // The relevance gate asks "does the rewrite still name this page's topic". Ground it in THIS page's own words (query + title + h1), never a vertical vocabulary.
  const contextTokens = [...new Set(`${primary} ${content.title ?? ""} ${content.h1 ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(byText);
  const wording = finding.cause === "ctr_snippet";
  // WHAT A PRODUCER MAY NAME IS WHAT I ACTUALLY READ: the winners' whole reading and the page's own subjects
  // and link words, none of which reaches the receipt as a fact, so grounding the gate in receipt lines alone
  // refused true copy. The wording path keeps its text byte for byte. THE ACCOUNT'S OWN PAGE INVENTORY rides
  // along, minus this page, so a producer owing the reader somewhere to GO NEXT names a page it really has.
  const inventory = snapshot.ownedPages.filter((p) => canonicalUrlKey(p.url) !== canonicalUrlKey(page.url))
    .map((p) => ({ url: p.url, title: p.content?.title ?? null, h1: p.content?.h1 ?? null }))
    .sort((a, b) => byText(pathOf(a.url), pathOf(b.url))).slice(0, MAX_INVENTORY);
  const producerEvidenceText = wording ? evidenceText : [evidenceText, ...(pattern?.commonHeadings ?? []).map((h) => h.heading),
    ...(pattern?.commonEntities ?? []).map((e) => e.entity), ...(pattern?.questionsAnswered ?? []), ...(body?.entityNames ?? []),
    ...(body?.cardTexts ?? []), ...(body?.internalLinks ?? []).map((l) => `${l.anchorText} ${l.href}`),
    // A page of this account, named by its own address and its own title, is a thing I read and never one I invented.
    ...inventory.flatMap((p) => [pathOf(p.url), p.title ?? "", p.h1 ?? ""])].filter(Boolean).join(" ");
  // A component cites the reading's OWN keys. For the wording cause that is the diagnosis; for every other
  // cause it is the ladder's, and either way a key with no receipt item behind it is never claimed.
  const alternatives = wording
    ? diagnosis.alternativesRuledOut.map((a) => ({ option: a.alternative, reason: a.reason }))
    : finding.competingExplanations.map((a) => ({ option: causeLabel(a.cause), reason: a.reason }));
  const components: BundleComponent[] = []; let heldForReview = false;
  const receiptKeys = new Set(receipt.items.map((i) => i.key));

  const keep = (c: BundleComponent, change: RecommendedChange): void => {
    // EVERY CLAIM TRACES TO SOMETHING ON SCREEN: a component citing nothing is dropped whole.
    const evidenceKeys = c.evidenceKeys.filter((k) => receiptKeys.has(k));
    const drop = (reason: string): void => { alternatives.push({ option: c.label, reason }); };
    if (evidenceKeys.length === 0) return drop("I could not show you the evidence behind that one, so I left it out rather than ask you to take my word for it.");
    // A PRODUCER COMPONENT ANSWERS THE COMPONENT GATE HERE: every kind outside the grandfathered seven owes
    // where, what, why and what I will measure, and a lever that moves the page must be marked as one.
    const shaped = gateShape(tenantId, primary, change);
    const verdict = validateProposal(wording ? shaped : { ...shaped, bundle: oneComponent({ ...c, evidenceKeys }) },
      { pageBodyText: receipt.bodyText ?? null, evidenceText: producerEvidenceText, contextTokens, now });
    // NEVER surface a raw validator reason: it is internal vocabulary.
    if (verdict.status === "rejected") return drop("The rewrite I drafted failed one of my safety checks, so I left it out rather than risk it.");
    // DANGEROUS SURVIVES THE GATE: downgrading it to "review" took the two-step hold off the one change
    // that needs it and made the stored proposal fail its own re-validation as mislabelled.
    const risk = c.risk === "dangerous" ? "dangerous"
      : verdict.status === "proposed" && c.risk !== "review" ? "safe" : "review";
    if (risk !== "safe") heldForReview = true;
    components.push({ ...c, evidenceKeys, risk });
  };

  if (wording) {
    // ONE field, the one the results page accused. Unchanged: this is the path that has always worked.
    if (!readyForAction(diagnosis) || diagnosis.action !== "title") return { status: "none", reason: diagnosis.explanation };
    const before = content.title;
    const draft = await draftAtomicEditStructured(
      { query: primary, pageLabel: content.h1 ?? content.title ?? page.url, field: "title", currentValue: before, outline: content.outline, evidenceHints: facts, tenantId },
      { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains },
    );
    if (draft.status === "drafted") keep({ kind: "title", label: "Page title", before: before ?? null, after: draft.value.after, evidenceKeys: diagnosis.evidenceKeys, risk: "safe" },
      { kind: "existing_edit", field: "title", before: before ?? null, after: draft.value.after });
    if (components.length === 0) return { status: "none", reason: "I could not write a title for this page that passes my own checks, so I am handing you nothing rather than filler." };
  } else {
    // EVERY OTHER NAMED CAUSE. A producer, or the honest reason there is nothing to write for it. The ladder's
    // own "I named nothing" answer keeps the results reading's sentence, which is the one that says what is missing.
    const slot = CORE_PRODUCERS[finding.cause];
    if (typeof slot !== "function") return { status: "none", reason: finding.cause === "no_problem" ? diagnosis.explanation : finding.explanation };
    const drafters = producerDrafts(tenantId, opts, now);
    const ctx: ProducerCtx = { finding, primary, tenantId,
      page: { url: page.url, title: content.title, h1: content.h1, outline: content.outline, internalLinkCount: content.internalLinks.length },
      // THE WHOLE HELD PAGE rides into the producer. Absent fields (an older caller's narrow shape)
      // default to the honest floor: no passages and sample_only, so pageContains answers unknown.
      body: body ? { url: page.url, title: content.title, h1: content.h1,
        metaDescription: body.metaDescription ?? content.metaDescription,
        headings: body.headings ?? content.outline, passages: body.passages ?? [],
        openingSample: body.openingSample, cardTexts: body.cardTexts ?? [], faqs: body.faqs ?? [],
        entityNames: body.entityNames ?? [], internalLinks: body.internalLinks ?? [],
        fetchedAt: body.fetchedAt, completeness: body.completeness ?? "sample_only",
        heldNote: body.heldNote ?? "I hold a sample of this page, not the whole page." } : null,
      ownedPages: inventory, pattern, receiptFacts: facts, readiness: receipt.readiness, draft: drafters };
    const produced = await slot(ctx);
    for (const c of produced.components) {
      const field = fieldForComponent(c.kind);
      keep(c, { kind: "existing_edit", field, before: c.before, after: c.after });
    }
    // SMALLER COMPONENTS FIRST, A REBUILD LAST, and NEVER on a split: rebuilding one of two competing pages
    // leaves them competing. A rebuild earns its place only on a SECOND structural accusation that actually
    // FIRED, never on one the ladder checked and ruled out, and even then it arrives as a question.
    if (components.length === 0 && finding.cause !== "cannibalization") {
      const rebuild = await produceFullRewriteRecommendation(ctx,
        [finding.cause, ...finding.competingExplanations.filter((c) => c.fired === true).map((c) => c.cause)]);
      for (const c of rebuild.components) keep(c, { kind: "existing_edit", field: fieldForComponent(c.kind), before: c.before, after: c.after });
    }
    if (components.length === 0) return { status: "none", reason: produced.refusal ?? finding.explanation };
  }

  if (receipt.links.length > 0) alternatives.push({ option: "Links out to your own pages",
    reason: `I can see ${receipt.links.length} of your own ${receipt.links.length === 1 ? "page" : "pages"} worth linking to from here, but I do not hold this page's body text, so I cannot tell you where the link honestly belongs. Send me the page copy and I will place it.` });

  const runnerUp = scored[1];
  if (runnerUp) alternatives.push({ option: `Start with ${pathOf(runnerUp.page.url)} instead`,
    reason: `Its searches come up about ${Math.round(runnerUp.gap).toLocaleString()} clicks short against this page's ${Math.round(pick.gap).toLocaleString()}, so it is the smaller win today.` });

  const confidence = confidenceFor(receipt.readiness, diagnosis);
  const bundle: ChangeBundle = { // objective: Today renders it verbatim, so it is the MODELED shortfall, never a promise
    objective: lead
      ? `Close the gap on the one search "${primary}", which earns this page about ${Math.round(lead.recoverable).toLocaleString()} fewer clicks than pages at position ${Math.round(lead.position)} usually get.`
      : doorGoal(door!.door, primary),
    metric: `Clicks from search for "${primary}" over the next 28 days.`,
    scope: { queries: queries.map((q) => q.query), prompts: receipt.prompts },
    components,
    receipt: { items: receipt.items, missing: receipt.missing, freshestObservedAt: receipt.freshestObservedAt },
    alternatives,
    risks: [
      wording
        ? "Changing a title moves where the page ranks while search engines re-read it, so give this the full 28 days before you judge it."
        : "Changing what a page says moves where it ranks while search engines re-read it, so give this the full 28 days before you judge it.",
      receipt.bodyText
        ? "I read this page's stored words, not today's live page, so read each line once against the page before you paste it."
        : "I do not hold this page's full body text, so read each line once before you paste it.",
    ],
    confidenceReasons: [
      // WHY THIS PAGE, in the words of the door it came through, never a shortfall nobody measured.
      lead
        ? `That one search "${primary}" brings this page ${lead.impressions.toLocaleString()} views over 90 days and turns ${lead.clicks.toLocaleString()} of them into clicks, about ${Math.round(lead.recoverable).toLocaleString()} short of what position ${Math.round(lead.position)} usually earns.`
        : door!.entry,
      classSentence(receipt),
      receipt.freshestObservedAt
        ? `The newest evidence I used was observed on ${receipt.freshestObservedAt.slice(0, 10)}.`
        : "Every figure here is a 90 day total, so none of it carries a single observation date.",
      wording ? diagnosis.explanation : finding.explanation,
    ],
    measurementPlan: "Once you make the change, record it on Results with the page address and I will read clicks, views, and average position for these searches at 7, 14, and 28 days, compared against pages you did not change.",
  };

  const primaryComponent = components[0]!;
  return { status: "bundled", proposal: {
      id: `${tenantId}::${pathOf(page.url)}::existing_edit::bundle`,
      tenantId, kind: "existing_edit", changeFamily: "single", publish: "manual",
      pagePath: pathOf(page.url), pageUrl: page.url.startsWith("http") ? page.url : `https://${page.url}`,
      pageLabel: content.h1 ?? content.title ?? page.url, primaryQuery: primary,
      opportunityType: OPPORTUNITY_OF[finding.cause] ?? "Rewrite the page that already has the demand",
      status: heldForReview ? "needs_review" : "proposed", // an investigation I cannot close never reaches here at all
      recommendedChange: { kind: "existing_edit", field: fieldForComponent(primaryComponent.kind), before: primaryComponent.before, after: primaryComponent.after },
      whyItMatters: lead
        ? `Searching "${primary}" brings this page ${lead.impressions.toLocaleString()} views and only ${lead.clicks.toLocaleString()} clicks over 90 days, about ${Math.round(lead.recoverable).toLocaleString()} clicks short of what position ${Math.round(lead.position)} usually earns, and that gap is big enough to look into.`
        : door!.entry,
      // WHAT THIS COSTS THE OPERATOR, by the kind of change it actually is. Everything that was not a
      // reworded line used to be priced at fifteen minutes, so a merge and a whole rebuild read the same.
      estimatedEffortMinutes: effortMinutesFor(primaryComponent.kind), riskLevel: !wording && heldForReview ? "medium" : "low", confidence, limitations: receipt.missing,
      // THE CAUSE THAT PRODUCED THESE COMPONENTS, and the whole reading behind it, so the ranker can ask
      // whether this change's lever addresses the reason the page is losing, and /changes names it truly.
      diagnosisCause: finding.cause, causeFinding: finding,
      evidence: { query: primary, hints: facts.slice(0, 5), evidenceRefCount: receipt.items.length },
      // A SIZE ONLY WHERE ONE IS PROVEN: an unproven door ranks as a direction, never as zero clicks.
      impactScore: pick.gap >= MIN_RECOVERABLE_CLICKS ? Math.round(pick.gap) : null, upsidePerMonth: null, bundle, createdAt: now.toISOString(),
  } };
}
