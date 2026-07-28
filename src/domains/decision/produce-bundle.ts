/**
 * decision/produce-bundle (Slice 7). The ONE producer of a deep, copy-ready change, in the only archetype that
 * exists: REPAIR the existing page with the biggest proven click gap. It rides the EvidenceSnapshot, the structured
 * drafter, ONE validator and a persisted ChangeProposal. Order is
 * deliberate: SELECT on a proven gap, BUILD the evidence receipt FIRST for the EXACT candidate search, DIAGNOSE off that
 * receipt, and only then draft the ONE field the diagnosis named. A click gap proves something is wrong and never what to
 * change, so nothing reaches a drafter until decision/diagnose reads the results page and accuses a field, and confidence
 * follows the EVIDENCE HELD (contracts.readyForAction / confidenceFor), never how the draft reads. A description or an
 * opening answer would need the line Google shows under the result or this page's own body words, and neither is on file,
 * so neither is written. No evidence means no change, and every input list is re-sorted before it is read
 * so the same evidence in any order produces a byte-identical result. server-only.
 */

import "server-only";

import type { EvidenceSnapshot, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot"; import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { draftAtomicEditStructured } from "@/domains/decision/llm/structured-drafter"; import { defaultExpectedCtrAt } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ActionDiagnosis, ChangeBundle, BundleComponent, BundleEvidenceItem, ChangeProposal, EvidenceReadiness, RecommendedChange } from "./contracts"; import { confidenceFor, MIN_CTR_DEFICIT, MIN_QUERY_IMPRESSIONS, MIN_RECOVERABLE_CLICKS, readyForAction } from "./contracts";
import { diagnoseCandidate, ownedResultOf, recurringPattern, RECEIPT, type DiagnosisInput } from "./diagnose";
import type { ProposeOptions } from "./propose"; import { validateProposal } from "./validate-proposal";
import { anchoredTopicMatch, canonicalQueryKey, weakAnchorTokens } from "@/domains/evidence/relevance-gate";

export type BundleOutcome = { status: "bundled"; proposal: ChangeProposal } | { status: "none"; reason: string };

type Research = EvidenceSnapshot["research"];
type Observation = Research["aiObservations"][number];
type SerpEvidence = Research["serpEvidence"][number];
type Keyword = Research["retainedKeywords"][number];

const norm = (s: string): string => s.trim().toLowerCase();
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The page's OWN WORDS for the one page under investigation, read by the caller through the targeted Evidence reader.
 *  Absent means absent: drafts are checked against title and headings only and body readiness stays honestly false. */
export type OwnedBody = { openingSample: string | null; fetchedAt: string | null };

/** RECOVERABLE OPPORTUNITY, never gross traffic. Per query clearing MIN_QUERY_IMPRESSIONS, the frozen CTR curve
 *  says what that position normally earns; the shortfall under it, once it clears MIN_CTR_DEFICIT, is the clicks a fix
 *  could win back. A page is not a problem because it is big: ranking by traffic handed the operator a healthy page. */
type Gap = { query: string; impressions: number; clicks: number; position: number; recoverable: number };
const gapsOf = (p: OwnedPageEvidence): Gap[] => (p.search?.topQueries ?? []).flatMap((q) => {
  if (q.impressions < MIN_QUERY_IMPRESSIONS || q.position == null) return [];
  const deficit = defaultExpectedCtrAt(q.position) - q.clicks / q.impressions;
  return deficit < MIN_CTR_DEFICIT ? [] : [{ query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.position, recoverable: deficit * q.impressions }];
}).sort((a, b) => b.recoverable - a.recoverable || byText(a.query, b.query));
const totalRecoverable = (gaps: Gap[]): number => gaps.reduce((a, g) => a + g.recoverable, 0);
/** A page can only be rewritten when we hold its current copy. */
const hasCurrentCopy = (p: OwnedPageEvidence): boolean => !!p.content && !!(p.content.title || p.content.h1 || p.content.outline.length > 0);

function parseUrl(url: string): URL | null { try { return new URL(url.startsWith("http") ? url : `https://${url}`); } catch { return null; } }
const pathOf = (url: string): string => parseUrl(url)?.pathname || (url.startsWith("/") ? url : `/${url}`);

/** WEAK ANCHORS: the words this account puts on nearly everything it owns fit anything, so alone they prove no topical
 *  connection and must never attach evidence to a change. Read fresh each pass from the account's OWN corpus (searches,
 *  prompts, page titles); under MIN_ANCHOR_CORPUS phrases nothing has recurred often enough to earn the label, so the
 *  set is empty and a single-topic account keeps the evidence that genuinely is about its one topic. */
const MIN_ANCHOR_CORPUS = 10;
function weakAnchorsOf(snapshot: EvidenceSnapshot): Set<string> {
  const r = snapshot.research; const phrases = [...new Set([...(r?.retainedKeywords ?? []).map((k) => k.query), ...(r?.aiObservations ?? []).map((o) => o.promptText),
    ...snapshot.ownedPages.map((p) => p.content?.title || p.content?.h1 || pathOf(p.url))].map((s) => (s ?? "").trim()).filter(Boolean))];
  return phrases.length < MIN_ANCHOR_CORPUS ? new Set<string>() : weakAnchorTokens(phrases);
}

/** Same topic = exact equality OR a shared DISTINGUISHING token (never a bare substring, never the everywhere-word alone). */
const topicMatch = (a: string, b: string, weak: ReadonlySet<string>): boolean =>
  norm(a) === norm(b) || anchoredTopicMatch(a, b, weak).relevant;

/** A winner attaches ONLY on EXACT membership: its own appearance under a member query or a member prompt, or its
 *  exact URL cited for one of them. Sharing a DOMAIN proves nothing and used to hang unrelated pages off a change;
 *  resemblance in a title is not membership either. */
const winnerBelongs = (w: Research["winningPages"][number], queries: ReadonlySet<string>, prompts: ReadonlySet<string>, urls: ReadonlySet<string>): boolean =>
  urls.has(canonicalUrlKey(w.url)) || w.appearances.some((a) =>
    (!!a.query && queries.has(canonicalQueryKey(a.query))) || (!!a.promptText && prompts.has(norm(a.promptText))));

const WANTS: Record<string, string> = { informational: "want an explanation", commercial: "are comparing options",
  transactional: "are ready to act", navigational: "are looking for one specific site" };

/** One plain-English fact per research class, so the operator reads the SAME sentence shape wherever it appears. */
const keywordFact = (k: Keyword, w = k.intent ? WANTS[norm(k.intent)] : undefined): string =>
  `"${k.query}" gets about ${k.searchVolume!.toLocaleString()} searches a month${w ? `, and the people searching it ${w}` : ""}.`;
const serpFact = (e: SerpEvidence, led = [...e.organic].sort((a, b) => a.rank - b.rank).slice(0, 3).map((o) => o.domain)): string =>
  `For "${e.query}" the results page is led by ${led.join(", ") || "pages I could not name"}, and the answer box at the top cites ${e.aiOverview.length} ${e.aiOverview.length === 1 ? "source" : "sources"}.`;
/** Mode-aware: a citation-null observation is context, never component support. */
const observationFact = (o: Observation): string => {
  const domains = [...new Set((o.citations ?? []).map((cit) => cit.domain))].sort(byText).slice(0, 3);
  const seen = o.observationMode === "consumer_search" ? `When a customer searches "${o.promptText}" inside an assistant, `
    : `In a plain assistant answer to "${o.promptText}" (background reading, not what a searching customer sees), `;
  const cited = o.citations == null ? "I could not see which pages it leaned on."
    : domains.length === 0 ? "it answers without pointing at anyone." : `it points people at ${domains.join(", ")}.`;
  // Fan-out lineage: the searches the ASSISTANT itself ran, under the exact prompt, date and mode that produced them. A question I track is my own and is never reported here as the provider's.
  const fan = (o.fanOutQueries ?? []).slice(0, 3);
  return `${seen}${cited}${fan.length ? ` To answer it the assistant went and searched ${fan.map((q) => `"${q}"`).join(", ")}.` : ""}`;
};

/** The evidence classes on file, in plain English: six of my own demand rows are still only my own data. */
const CLASS_OF: Record<BundleEvidenceItem["kind"], string> = {
  gsc_demand: "your own search data", page_extract: "what the page says today", keyword: "monthly search counts",
  serp: "a live results check", ai_observation: "an AI answer I watched", winning_page: "a winning page comparison",
  competitor: "the sites AI hands this to instead of you", internal_link: "links from your own pages",
  diagnosis: "what the results page told me about the cause" };
const classSentence = (r: Receipt, c = [...new Set(r.items.map((it) => CLASS_OF[it.kind]))]): string =>
  `I built this from ${c.length > 1 ? `${c.slice(0, -1).join(", ")}, and ${c[c.length - 1]}` : c[0] ?? "nothing I can show you"}, and I can show you every piece.`;

/** The page's own served queries, strongest first, deterministic on ties. */
const queriesOf = (page: OwnedPageEvidence): OwnedQuerySignal[] => [...(page.search?.topQueries ?? [])]
  .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || byText(a.query, b.query)).slice(0, 5);

type Receipt = ChangeBundle["receipt"] & { prompts: string[]; hasResearch: boolean; contextOnlyKeys: string[]; links: { anchor: string; to: string }[]; readiness: EvidenceReadiness; diagnosis: ActionDiagnosis; bodyText?: string | null };

/** A pattern may be claimed only across MULTIPLE pages that actually come up for this exact search, and only as a count
 *  I can show, never as a rule: one page's style is that page's style. */
function winnerPattern(read: Research["winningPages"], c: NonNullable<OwnedPageEvidence["content"]>, primary: string): string | null {
  if (read.length < 2) return null;
  const words = [...read.map((w) => w.extract!.wordCount)].sort((a, b) => a - b); const median = words[Math.floor(words.length / 2)]!;
  const faq = read.filter((w) => w.extract!.faqCount > 0).length; const bits: string[] = [];
  if (faq >= 2) bits.push(`${faq} of them answer it in a question and answer block${c.hasFaq ? " and so does this page" : ", and this page has none"}`);
  if (median >= Math.round(c.wordCount * 1.5)) bits.push(`the middle one runs ${median.toLocaleString()} words against this page's ${c.wordCount.toLocaleString()}`);
  return bits.length === 0 ? null : `Of the ${read.length} pages I read that come up for "${primary}", ${bits.join(", and ")}.`;
}

/** The evidence receipt for ONE candidate search, built BEFORE anything is drafted. Plain English only. */
function buildReceipt(snapshot: EvidenceSnapshot, page: OwnedPageEvidence, queries: OwnedQuerySignal[], primary: string, weak: ReadonlySet<string>, body: OwnedBody | null): Receipt {
  const items: BundleEvidenceItem[] = []; const contextOnly: string[] = []; const missing: string[] = []; const prompts: string[] = [];
  const add = (key: string, kind: BundleEvidenceItem["kind"], fact: string, observedAt: string | null): void => { items.push({ key, kind, fact, observedAt }); };
  const research = snapshot.research;
  // QUERY IDENTITY, never topical similarity: the same words in any order are the same search, and a neighbouring search carrying a different modifier is NEVER a stand-in for this one.
  const isPrimary = (q: string): boolean => norm(q) === norm(primary) || canonicalQueryKey(q) === canonicalQueryKey(primary);
  const s = page.search!; const c = page.content!;
  // Support attaches only when it is about THIS page: an AI answer or a cited page sharing nothing with the page's own words is noise.
  const pageTopic = [...queries.map((q) => q.query), c.title ?? "", c.h1 ?? ""].join(" ");
  const onTopic = (text: string): boolean => topicMatch(text, pageTopic, weak);

  // SCOPE IS PART OF THE NUMBER. A page total says "this page overall"; a query claim carries only that query's own figures. A page total worded as a query total made a 75,285-view page read as one search.
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

  // WHAT THAT RESULTS PAGE ACTUALLY SAYS. Holding it is not reading it: the line Google displays for this page is what
  // a searcher reads, and wording that RECURS across the results beating it is the only pattern I may call a pattern.
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

  // ABOUT THE SEARCH, not merely about the page: a prompt sharing one broad word this account puts on everything diagnoses
  // nothing. An answer attaches only when its own words anchor to THIS search, or a search the assistant really ran IS this
  // search (a fan-out is a search, so it joins on identity, never on resemblance). Merely CITING this page does not attach it:
  // an unrelated question that happens to link here imported its whole evidence set, competitors and all.
  const observations = [...(research?.aiObservations ?? [])].filter((o) => topicMatch(o.promptText, primary, weak)
    || (o.fanOutQueries ?? []).some(isPrimary)).sort(
    (a, b) => byText(a.observationMode, b.observationMode) || byText(a.promptText, b.promptText) || byText(a.engine, b.engine));
  const consumer = observations.filter((o) => o.observationMode === "consumer_search");
  const plain = observations.filter((o) => o.observationMode !== "consumer_search");
  if (observations.length === 0) missing.push(`I have not gathered an AI answer about "${primary}" yet.`);
  else if (consumer.length === 0) missing.push(`I have not yet watched what a customer sees when they ask an assistant about "${primary}".`);
  [...consumer.slice(0, 2), ...plain.slice(0, 1)].forEach((o, i) => {
    add(`ai${i + 1}`, "ai_observation", observationFact(o), o.observedAt);
    if (o.citations == null) contextOnly.push(`ai${i + 1}`); // context, never component support
    prompts.push(o.promptText);
  });

  // A winner belongs to THIS search only: its exact URL came up on that results page, an AI answer about that search pointed at it, or it appeared under that search. Any other route is somebody else's evidence.
  const memberPrompts = new Set(observations.map((o) => norm(o.promptText)));
  const memberQueries = new Set([primary, ...observations.flatMap((o) => o.fanOutQueries ?? [])].map(canonicalQueryKey));
  const memberUrls = new Set([...observations.flatMap((o) => (o.citations ?? []).map((cit) => cit.url)),
    ...serps.flatMap((e) => [...e.organic.map((x) => x.url), ...e.aiOverview.map((cit) => cit.url), ...e.aiMode.map((cit) => cit.url)])].map(canonicalUrlKey));
  const belongs = [...(research?.winningPages ?? [])].filter((w) => winnerBelongs(w, memberQueries, memberPrompts, memberUrls)).sort((a, b) => byText(a.url, b.url));
  const read = belongs.filter((w) => !!w.extract); const winners = belongs.slice(0, 2);
  if (winners.length === 0) missing.push(`I have not read the pages that come up for "${primary}" yet.`);
  // SAY HOW IT GOT HERE: a page that arrived by organic rank was never cited by an assistant, and calling it one invented a fact about a competitor.
  winners.forEach((w, i) => add(`win${i + 1}`, "winning_page",
    `${w.domain} ${w.appearances.some((a) => a.kind !== "serp_organic") ? "is one of the pages AI keeps citing here" : `comes up on the results page for "${primary}"`}${w.extract ? `, and it runs ${w.extract.wordCount.toLocaleString()} words under ${w.extract.headings.length} headings` : ""}.`,
    [...w.appearances].sort((a, b) => byText(b.observedAt, a.observedAt))[0]?.observedAt ?? null));
  const winners2 = winnerPattern(read, c, primary);
  if (winners2) add("winpattern", "winning_page", winners2, null);

  // A link needs TWO proofs: an on-topic destination AND body text proving where it belongs. I hold no body, so none is ever proposed; the destinations are counted so I can say so.
  const links = [...snapshot.internalLinkOpportunities].filter((l) => l.fromUrl === page.url && onTopic(l.anchor))
    .sort((a, b) => byText(a.toUrl, b.toUrl)).slice(0, 3);

  missing.push("I do not hold this page's full body text, so I checked every draft against its title and section headings only.");

  // EVIDENCE READINESS for this exact search: what I hold, counted honestly, never how good the draft reads.
  const readiness: EvidenceReadiness = { gsc: (s.topQueries ?? []).some((q) => isPrimary(q.query)), ownedCopy: !!(c.title || c.metaDescription),
    serp: serps.length > 0, winners: read.length, body: !!bodyText };
  const dates = items.map((it) => it.observedAt).filter((d): d is string => !!d).sort(byText);
  return { items, missing, readiness, diagnosis, bodyText, freshestObservedAt: dates.length ? dates[dates.length - 1]! : null, prompts: [...new Set(prompts)].sort(byText),
    hasResearch: items.some((it) => it.kind === "keyword" || it.kind === "serp" || it.kind === "ai_observation" || it.kind === "winning_page"),
    contextOnlyKeys: contextOnly, links: links.map((l) => ({ anchor: l.anchor, to: pathOf(l.toUrl) })) };
}

/** A throwaway proposal shape so the ONE validator can gate one draft. */
const gateShape = (tenantId: string, query: string, change: RecommendedChange): ChangeProposal => ({
  id: "gate", tenantId, kind: change.kind, pagePath: null, pageUrl: null, pageLabel: "", primaryQuery: query, opportunityType: "", changeFamily: "bundle",
  status: "needs_review", recommendedChange: change, whyItMatters: "", estimatedEffortMinutes: 0, riskLevel: "low", confidence: "medium", limitations: [],
  evidence: { query, hints: [], evidenceRefCount: 0 }, impactScore: null, upsidePerMonth: null, publish: "manual", createdAt: "" });

export type ProduceBundleOptions = ProposeOptions;

/** Produce at most ONE change for the existing page with the biggest PROVEN click gap. `none` with a structured
 *  reason when no page is losing clicks against its own positions, when the results page for that exact search does
 *  not accuse a field, or when the one draft it earned fails a gate. Zero ready is a real answer, not a failure. */
export async function produceBundleForSnapshot(snapshot: EvidenceSnapshot, opts: ProduceBundleOptions & { onlyPageUrl?: string | null; bodyByUrl?: ReadonlyMap<string, OwnedBody> } = {}): Promise<BundleOutcome> {
  const now = opts.now ?? new Date();
  const tenantId = snapshot.scope.tenantId;

  // The diagnosis already chose the page. Drafting anything else spends real money
  // on a change the compiler will discard, so an unproven page never reaches a drafter.
  const only = (opts.onlyPageUrl ?? "").trim().toLowerCase();
  const eligible = only ? snapshot.ownedPages.filter((p) => canonicalUrlKey(p.url) === canonicalUrlKey(only) || pathOf(p.url).toLowerCase() === only) : snapshot.ownedPages;
  const scored = eligible.filter((p) => hasCurrentCopy(p) && queriesOf(p).length > 0)
    .map((p) => { const gaps = gapsOf(p); return { page: p, gaps, gap: totalRecoverable(gaps) }; })
    .filter((r) => r.gap >= MIN_RECOVERABLE_CLICKS).sort((a, b) => b.gap - a.gap || byText(pathOf(a.page.url), pathOf(b.page.url)));
  const pick = scored[0];
  if (!pick) return { status: "none", reason: "No page of yours is losing enough clicks against what its own positions should earn, so I have nothing honest to rewrite yet." };

  const { page, gaps } = pick; const lead = gaps[0]!; const queries = queriesOf(page); const primary = lead.query; const content = page.content!;
  const receipt = buildReceipt(snapshot, page, queries, primary, weakAnchorsOf(snapshot), opts.bodyByUrl?.get(canonicalUrlKey(page.url)) ?? null);
  // NOTHING to show is never a recommendation: an empty receipt refuses here rather than shipping a bare instruction.
  if (receipt.items.length === 0) return { status: "none", reason: "I hold nothing I can show you about this page yet, so I will not tell you to change it." };
  // NO DRAFT SPEND BEFORE A DIAGNOSIS. A click gap proves something is wrong and never
  // what to change, so a page whose own results line does not accuse a specific field
  // is handed back untouched: no completion call, no copy, no row. Zero ready is a real
  // answer, and the reason is the sentence the operator reads.
  const diagnosis = receipt.diagnosis;
  if (!readyForAction(diagnosis) || diagnosis.action !== "title") return { status: "none", reason: diagnosis.explanation };
  const facts = receipt.items.map((it) => it.fact);
  const evidenceText = [...facts, ...content.outline, content.title ?? ""].filter(Boolean).join(" ");
  // The relevance gate asks "does the rewrite still name this page's topic". Ground it in THIS page's own words (query + title + h1), never a vertical vocabulary.
  const contextTokens = [...new Set(`${primary} ${content.title ?? ""} ${content.h1 ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(byText);
  // A component cites the DIAGNOSIS's own keys: the exact search numbers, this page's
  // stored copy, the results page, the line Google displays for it, and the recurring
  // wording it lacks. No receipt item, no claim.
  const alternatives = diagnosis.alternativesRuledOut.map((a) => ({ option: a.alternative, reason: a.reason }));
  const components: BundleComponent[] = []; let heldForReview = false;

  const keep = (kind: BundleComponent["kind"], label: string, before: string | null, after: string, evidenceKeys: string[], change: RecommendedChange): void => {
    const verdict = validateProposal(gateShape(tenantId, primary, change), { pageBodyText: receipt.bodyText ?? null, evidenceText, contextTokens, now });
    // NEVER surface a raw validator reason: it is internal vocabulary.
    if (verdict.status === "rejected") { alternatives.push({ option: label, reason: "The rewrite I drafted failed one of my safety checks, so I left it out rather than risk it." }); return; }
    if (verdict.status === "needs_review") heldForReview = true;
    components.push({ kind, label, before, after, evidenceKeys, risk: verdict.status === "proposed" ? "safe" : "review" });
  };

  // ONE field, the one the diagnosis named. A description or an opening answer would
  // need the line Google shows under the result or this page's own body words to
  // accuse it, and I hold neither, so neither is drafted rather than guessed at.
  const before = content.title;
  const draft = await draftAtomicEditStructured(
    { query: primary, pageLabel: content.h1 ?? content.title ?? page.url, field: "title", currentValue: before, outline: content.outline, evidenceHints: facts, tenantId },
    { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains },
  );
  if (draft.status === "drafted") keep("title", "Page title", before ?? null, draft.value.after, diagnosis.evidenceKeys, { kind: "existing_edit", field: "title", before: before ?? null, after: draft.value.after });
  if (components.length === 0) return { status: "none", reason: "I could not write a title for this page that passes my own checks, so I am handing you nothing rather than filler." };

  if (receipt.links.length > 0) alternatives.push({ option: "Links out to your own pages",
    reason: `I can see ${receipt.links.length} of your own ${receipt.links.length === 1 ? "page" : "pages"} worth linking to from here, but I do not hold this page's body text, so I cannot tell you where the link honestly belongs. Send me the page copy and I will place it.` });

  const runnerUp = scored[1];
  if (runnerUp) alternatives.push({ option: `Start with ${pathOf(runnerUp.page.url)} instead`,
    reason: `Its searches come up about ${Math.round(runnerUp.gap).toLocaleString()} clicks short against this page's ${Math.round(pick.gap).toLocaleString()}, so it is the smaller win today.` });

  const confidence = confidenceFor(receipt.readiness, diagnosis);
  const bundle: ChangeBundle = { // objective: Today renders it verbatim, so it is the MODELED shortfall, never a promise
    objective: `Close the gap on the one search "${primary}", which earns this page about ${Math.round(lead.recoverable).toLocaleString()} fewer clicks than pages at position ${Math.round(lead.position)} usually get.`,
    metric: `Clicks from search for "${primary}" over the next 28 days.`,
    scope: { queries: queries.map((q) => q.query), prompts: receipt.prompts },
    components,
    receipt: { items: receipt.items, missing: receipt.missing, freshestObservedAt: receipt.freshestObservedAt },
    alternatives,
    risks: [
      "Changing a title moves where the page ranks while search engines re-read it, so give this the full 28 days before you judge it.",
      "I do not hold this page's full body text, so read each line once before you paste it.",
    ],
    confidenceReasons: [
      `That one search "${primary}" brings this page ${lead.impressions.toLocaleString()} views over 90 days and turns ${lead.clicks.toLocaleString()} of them into clicks, about ${Math.round(lead.recoverable).toLocaleString()} short of what position ${Math.round(lead.position)} usually earns.`,
      classSentence(receipt),
      receipt.freshestObservedAt
        ? `The newest evidence I used was observed on ${receipt.freshestObservedAt.slice(0, 10)}.`
        : "Every figure here is a 90 day total, so none of it carries a single observation date.",
      diagnosis.explanation,
    ],
    measurementPlan: "Once you make the change, record it on Results with the page address and I will read clicks, views, and average position for these searches at 7, 14, and 28 days, compared against pages you did not change.",
  };

  const primaryComponent = components[0]!;
  return { status: "bundled", proposal: {
      id: `${tenantId}::${pathOf(page.url)}::existing_edit::bundle`,
      tenantId, kind: "existing_edit", changeFamily: "single", publish: "manual",
      pagePath: pathOf(page.url), pageUrl: page.url.startsWith("http") ? page.url : `https://${page.url}`,
      pageLabel: content.h1 ?? content.title ?? page.url, primaryQuery: primary,
      opportunityType: "Rewrite the page that already has the demand",
      status: heldForReview ? "needs_review" : "proposed", // an investigation I cannot close never reaches here at all
      recommendedChange: { kind: "existing_edit", field: "title", before: primaryComponent.before, after: primaryComponent.after },
      whyItMatters: `Searching "${primary}" brings this page ${lead.impressions.toLocaleString()} views and only ${lead.clicks.toLocaleString()} clicks over 90 days, about ${Math.round(lead.recoverable).toLocaleString()} clicks short of what position ${Math.round(lead.position)} usually earns, and that gap is big enough to look into.`,
      estimatedEffortMinutes: 1, riskLevel: "low", confidence, limitations: receipt.missing,
      evidence: { query: primary, hints: facts.slice(0, 5), evidenceRefCount: receipt.items.length },
      impactScore: Math.round(pick.gap), upsidePerMonth: null, bundle, createdAt: now.toISOString(),
  } };
}
