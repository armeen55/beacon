/**
 * decision/produce-bundle (Slices 7 + 8). The ONE producer of a deep, copy-ready change, in the only two archetypes that
 * exist: REPAIR the existing page with the biggest proven click gap, and BUILD the one new page the demand is asking for. Both
 * ride the same EvidenceSnapshot, structured drafters, ONE validator and persisted ChangeProposal. Order is
 * deliberate: SELECT on a proven gap, BUILD the evidence receipt FIRST for the EXACT candidate search, then draft and
 * keep only what that receipt and the gates justify. A click gap proves something is wrong and never what to change, so
 * confidence and readiness follow the EVIDENCE HELD (contracts.readyForAction / confidenceFor), never how the draft reads.
 * Parts bundle ONLY when they are one repair. No evidence means no change, and every input list is re-sorted before it is read
 * so the same evidence in any order produces a byte-identical result. server-only.
 */

import "server-only";

import type { EvidenceSnapshot, NewPageOpportunity, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot"; import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { draftAtomicEditStructured, draftAnswerBlockStructured, draftCreatePageStructured } from "@/domains/decision/llm/structured-drafter"; import { defaultExpectedCtrAt } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ChangeBundle, BundleComponent, BundleEvidenceItem, ChangeProposal, EvidenceReadiness, RecommendedChange } from "./contracts"; import { confidenceFor, MIN_CTR_DEFICIT, MIN_QUERY_IMPRESSIONS, MIN_RECOVERABLE_CLICKS, readyForAction } from "./contracts";
import type { ProposeOptions } from "./propose"; import { validateProposal } from "./validate-proposal";
import { anchoredTopicMatch, canonicalQueryKey, weakAnchorTokens } from "@/domains/evidence/relevance-gate"; import { looksLikePlaceholder } from "./placeholder-detection"; import { containsUuid } from "./copy-sanitize";

export type BundleOutcome = { status: "bundled"; proposal: ChangeProposal } | { status: "none"; reason: string };

type Research = EvidenceSnapshot["research"];
type Observation = Research["aiObservations"][number];
type SerpEvidence = Research["serpEvidence"][number];
type Keyword = Research["retainedKeywords"][number];

const norm = (s: string): string => s.trim().toLowerCase();
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Nothing on file holds a page's full body text, so drafts are checked against title and headings only and body
 *  readiness is honestly false. One line carries it everywhere the day a body store lands. */
const PAGE_BODY_TEXT: string | null = null;

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
const hostOf = (url: string): string => parseUrl(url)?.hostname ?? url;

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

/** One plain-English fact per research class, shared by both archetypes so the operator reads the SAME sentence shape whichever bundle produced it. */
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
  competitor: "the sites AI hands this to instead of you", internal_link: "links from your own pages" };
const classSentence = (r: Receipt, c = [...new Set(r.items.map((it) => CLASS_OF[it.kind]))]): string =>
  `I built this from ${c.length > 1 ? `${c.slice(0, -1).join(", ")}, and ${c[c.length - 1]}` : c[0] ?? "nothing I can show you"}, and I can show you every piece.`;
/** A brand-new page has no first-party rows and no copy to replace, so the frozen EDIT readiness cannot speak for it. Its
 *  confidence needs the LIVE RESULTS PAGE for the topic (a page reached through an AI citation is not evidence about a results
 *  page, and on its own it used to buy high) AND two pages I actually read: the most speculative thing I can propose must not out-confidence an evidenced edit, so this is the same bar confidenceFor holds an edit to. */
const topicConfidence = (r: Receipt, clean: boolean): ChangeProposal["confidence"] =>
  clean && r.items.some((it) => it.kind === "serp") && r.items.filter((it) => it.kind === "winning_page").length >= 2 ? "high" : r.items.length >= 3 ? "medium" : "low";
const rankOf = (c: ChangeProposal["confidence"]): number => (c === "high" ? 2 : c === "medium" ? 1 : 0);

/** The page's own served queries, strongest first, deterministic on ties. */
const queriesOf = (page: OwnedPageEvidence): OwnedQuerySignal[] => [...(page.search?.topQueries ?? [])]
  .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || byText(a.query, b.query)).slice(0, 5);

type Receipt = ChangeBundle["receipt"] & { prompts: string[]; hasResearch: boolean; contextOnlyKeys: string[]; links: { anchor: string; to: string }[]; readiness: EvidenceReadiness };

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
function buildReceipt(snapshot: EvidenceSnapshot, page: OwnedPageEvidence, queries: OwnedQuerySignal[], primary: string, weak: ReadonlySet<string>): Receipt {
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
  queries.slice(0, 3).forEach((q, i) => add(`demand-q${i + 1}`, "gsc_demand",
    `That one search "${q.query}" brings this page ${q.impressions.toLocaleString()} views and ${q.clicks.toLocaleString()} clicks${q.position == null ? "" : `, at about position ${Math.round(q.position)}`}.`, null));
  add("copy-current", "page_extract", `Today the page ${c.title ? `is titled "${c.title}"` : "has no title set"} and runs ${c.wordCount.toLocaleString()} words across ${c.outline.length} sections.`, c.fetchedAt);

  const keywords = [...(research?.retainedKeywords ?? [])].filter((k) => isPrimary(k.query) && k.searchVolume != null)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || byText(norm(a.query), norm(b.query)));
  if (keywords.length === 0) missing.push(`I do not have a monthly search count for "${primary}" yet.`);
  keywords.slice(0, 3).forEach((k, i) => add(`kw${i + 1}`, "keyword", keywordFact(k), null));

  const serps = [...(research?.serpEvidence ?? [])].filter((e) => isPrimary(e.query)).sort((a, b) => byText(norm(a.query), norm(b.query)));
  if (serps.length === 0) missing.push(`I have not looked at the live results page for "${primary}" yet, so I cannot yet name what is taking the clicks.`);
  serps.slice(0, 2).forEach((e, i) => add(`serp${i + 1}`, "serp", serpFact(e), null));

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
  winners.forEach((w, i) => add(`win${i + 1}`, "winning_page",
    `${w.domain} is one of the pages AI keeps citing here${w.extract ? `, and it runs ${w.extract.wordCount.toLocaleString()} words under ${w.extract.headings.length} headings` : ""}.`,
    [...w.appearances].sort((a, b) => byText(b.observedAt, a.observedAt))[0]?.observedAt ?? null));
  const pattern = winnerPattern(read, c, primary);
  if (pattern) add("winpattern", "winning_page", pattern, null);

  // A link needs TWO proofs: an on-topic destination AND body text proving where it belongs. I hold no body, so none is ever proposed; the destinations are counted so I can say so.
  const links = [...snapshot.internalLinkOpportunities].filter((l) => l.fromUrl === page.url && onTopic(l.anchor))
    .sort((a, b) => byText(a.toUrl, b.toUrl)).slice(0, 3);

  missing.push("I do not hold this page's full body text, so I checked every draft against its title and section headings only.");

  // EVIDENCE READINESS for this exact search: what I hold, counted honestly, never how good the draft reads.
  const readiness: EvidenceReadiness = { gsc: (s.topQueries ?? []).some((q) => isPrimary(q.query)), ownedCopy: !!(c.title || c.metaDescription),
    serp: serps.length > 0, winners: read.length, body: !!PAGE_BODY_TEXT };
  const dates = items.map((it) => it.observedAt).filter((d): d is string => !!d).sort(byText);
  return { items, missing, readiness, freshestObservedAt: dates.length ? dates[dates.length - 1]! : null, prompts: [...new Set(prompts)].sort(byText),
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
 *  reason when no page is losing clicks against its own positions, or when every drafted component fails a gate. */
export async function produceBundleForSnapshot(snapshot: EvidenceSnapshot, opts: ProduceBundleOptions & { onlyPageUrl?: string | null } = {}): Promise<BundleOutcome> {
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
  const receipt = buildReceipt(snapshot, page, queries, primary, weakAnchorsOf(snapshot));
  // NOTHING to show is never a recommendation: an empty receipt refuses here rather than shipping a bare instruction.
  if (receipt.items.length === 0) return { status: "none", reason: "I hold nothing I can show you about this page yet, so I will not tell you to change it." };
  const ready = readyForAction(receipt.readiness); // a rewrite is ready only when the evidence can name the cause
  const facts = receipt.items.map((it) => it.fact);
  const evidenceText = [...facts, ...content.outline, content.title ?? ""].filter(Boolean).join(" ");
  // The relevance gate asks "does the rewrite still name this page's topic". Ground it in THIS page's own words (query + title + h1), never a vertical vocabulary.
  const contextTokens = [...new Set(`${primary} ${content.title ?? ""} ${content.h1 ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(byText);
  const demandKeys = receipt.items.filter((it) => it.kind === "gsc_demand" || it.kind === "page_extract").map((it) => it.key);
  const contextOnly = new Set(receipt.contextOnlyKeys);
  const researchKeys = receipt.items.filter((it) => !contextOnly.has(it.key)).map((it) => it.key);

  const components: BundleComponent[] = []; const alternatives: { option: string; reason: string }[] = []; let heldForReview = false;

  const keep = (kind: BundleComponent["kind"], label: string, before: string | null, after: string, evidenceKeys: string[], change: RecommendedChange): void => {
    const verdict = validateProposal(gateShape(tenantId, primary, change), { pageBodyText: PAGE_BODY_TEXT, evidenceText, contextTokens, now });
    // NEVER surface a raw validator reason: it is internal vocabulary.
    if (verdict.status === "rejected") { alternatives.push({ option: label, reason: "The rewrite I drafted failed one of my safety checks, so I left it out rather than risk it." }); return; }
    if (verdict.status === "needs_review") heldForReview = true;
    components.push({ kind, label, before, after, evidenceKeys, risk: verdict.status === "proposed" ? "safe" : "review" });
  };

  for (const field of ["title", "meta"] as const) {
    const before = field === "title" ? content.title : content.metaDescription;
    const draft = await draftAtomicEditStructured(
      { query: primary, pageLabel: content.h1 ?? content.title ?? page.url, field, currentValue: before, outline: content.outline, evidenceHints: facts, tenantId },
      { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains },
    );
    if (draft.status !== "drafted") { alternatives.push({ option: field === "title" ? "Page title" : "Search description", reason: "I could not produce a draft I trust for this field on this pass." }); continue; }
    keep(field, field === "title" ? "Page title" : "Search description", before ?? null, draft.value.after, demandKeys, { kind: "existing_edit", field, before: before ?? null, after: draft.value.after });
  }

  if (!receipt.hasResearch) {
    alternatives.push({ option: "Opening answer at the top of the page", reason: "I have no outside evidence on these searches yet, so I will not write an answer I cannot back." });
  } else {
    const draft = await draftAnswerBlockStructured(
      { query: primary, pageLabel: content.h1 ?? content.title ?? page.url, brief: content.title, outline: content.outline, faqs: [], evidenceHints: facts, tenantId },
      { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains },
    );
    if (draft.status !== "drafted") alternatives.push({ option: "Opening answer at the top of the page", reason: "I could not produce an opening answer I trust on this pass." });
    else keep("opening_answer", "Opening answer", null, draft.value.answer, researchKeys, { kind: "existing_edit", field: "answer_block", before: null, after: draft.value.answer });
  }

  if (components.length === 0) return { status: "none", reason: "Every draft I wrote for this page failed a safety check, so I am handing you nothing rather than filler." };

  // ATOMIC BY DEFAULT. Parts ship together only when they are ONE repair: a new opening answer changes what this page
  // finally says, so the title and description that promise it move with it. Without it there are only independent edits,
  // and bundling those hides that each is separately acceptable and separately measurable, so the strongest ships alone.
  const cohesive = components.some((c) => c.kind === "opening_answer");
  if (!cohesive && components.length > 1) {
    for (const c of components.slice(1)) alternatives.push({ option: c.label,
      reason: `This stands on its own and I would measure it on its own, so make ${components[0]!.label.toLowerCase()} first and bring this back once you have read the result.` });
    components.length = 1;
  }
  if (receipt.links.length > 0) alternatives.push({ option: "Links out to your own pages",
    reason: `I can see ${receipt.links.length} of your own ${receipt.links.length === 1 ? "page" : "pages"} worth linking to from here, but I do not hold this page's body text, so I cannot tell you where the link honestly belongs. Send me the page copy and I will place it.` });

  const runnerUp = scored[1];
  if (runnerUp) alternatives.push({ option: `Start with ${pathOf(runnerUp.page.url)} instead`,
    reason: `Its searches come up about ${Math.round(runnerUp.gap).toLocaleString()} clicks short against this page's ${Math.round(pick.gap).toLocaleString()}, so it is the smaller win today.` });

  const confidence = confidenceFor(receipt.readiness);
  const bundle: ChangeBundle = { // objective: Today renders it verbatim, so it is the MODELED shortfall, never a promise
    objective: `Close the gap on the one search "${primary}", which earns this page about ${Math.round(lead.recoverable).toLocaleString()} fewer clicks than pages at position ${Math.round(lead.position)} usually get.`,
    metric: `Clicks from search for "${primary}" over the next 28 days.`,
    scope: { queries: queries.map((q) => q.query), prompts: receipt.prompts },
    components,
    receipt: { items: receipt.items, missing: receipt.missing, freshestObservedAt: receipt.freshestObservedAt },
    alternatives,
    risks: [
      ...(cohesive ? ["These parts are one repair and belong together: the opening answer is what this page finally says, and the title and description are the promise that gets it read. Ship the title alone and the page still does not answer the search; ship the answer alone and search still shows the old promise."] : []),
      "Changing a title moves where the page ranks while search engines re-read it, so give this the full 28 days before you judge it.",
      "I do not hold this page's full body text, so read each line once before you paste it.",
    ],
    confidenceReasons: [
      `That one search "${primary}" brings this page ${lead.impressions.toLocaleString()} views over 90 days and turns ${lead.clicks.toLocaleString()} of them into clicks, about ${Math.round(lead.recoverable).toLocaleString()} short of what position ${Math.round(lead.position)} usually earns.`,
      classSentence(receipt),
      receipt.freshestObservedAt
        ? `The newest evidence I used was observed on ${receipt.freshestObservedAt.slice(0, 10)}.`
        : "Every figure here is a 90 day total, so none of it carries a single observation date.",
      ...(ready ? [] : [`I have not seen the live results page for "${primary}" yet, so this is what I am still looking into rather than a finished answer.`]),
    ],
    measurementPlan: "Once you make the change, record it on Results with the page address and I will read clicks, views, and average position for these searches at 7, 14, and 28 days, compared against pages you did not change.",
  };

  const primaryComponent = components[0]!;
  const field: Extract<RecommendedChange, { kind: "existing_edit" }>["field"] = primaryComponent.kind === "title" ? "title" : primaryComponent.kind === "meta" ? "meta" : "answer_block";
  const effort = components.reduce((a, c) => a + (c.kind === "title" || c.kind === "meta" ? 1 : c.kind === "opening_answer" ? 5 : 3), 0);

  return { status: "bundled", proposal: {
      id: `${tenantId}::${pathOf(page.url)}::existing_edit::bundle`,
      tenantId, kind: "existing_edit", changeFamily: cohesive ? "bundle" : "single", publish: "manual",
      pagePath: pathOf(page.url), pageUrl: page.url.startsWith("http") ? page.url : `https://${page.url}`,
      pageLabel: content.h1 ?? content.title ?? page.url, primaryQuery: primary,
      opportunityType: "Rewrite the page that already has the demand",
      status: heldForReview || !ready ? "needs_review" : "proposed", // an investigation I cannot close is never handed over as ready
      recommendedChange: { kind: "existing_edit", field, before: primaryComponent.before, after: primaryComponent.after },
      whyItMatters: `Searching "${primary}" brings this page ${lead.impressions.toLocaleString()} views and only ${lead.clicks.toLocaleString()} clicks over 90 days, about ${Math.round(lead.recoverable).toLocaleString()} clicks short of what position ${Math.round(lead.position)} usually earns, and that gap is big enough to look into.`,
      estimatedEffortMinutes: effort, riskLevel: "low", confidence, limitations: receipt.missing,
      evidence: { query: primary, hints: facts.slice(0, 5), evidenceRefCount: receipt.items.length },
      impactScore: Math.round(pick.gap), upsidePerMonth: null, bundle, createdAt: now.toISOString(),
  } };
}

// ── archetype 2 (Slice 8): the ONE new page the demand is asking for ──────────
type TopicResearch = { keywords: Keyword[]; serps: SerpEvidence[]; observations: Observation[]; winners: Research["winningPages"]; competitors: EvidenceSnapshot["competitors"] };

/** Everything on file about ONE topic, re-sorted before read. */
function researchForTopic(snapshot: EvidenceSnapshot, opp: NewPageOpportunity, weak: ReadonlySet<string>): TopicResearch {
  const r = snapshot.research;
  const topic = opp.topic;
  const observations = [...(r?.aiObservations ?? [])].filter((o) => topicMatch(o.promptText, topic, weak)).sort(
    (a, b) => byText(a.observationMode, b.observationMode) || byText(a.promptText, b.promptText) || byText(a.engine, b.engine));
  const compDomains = new Set(opp.competitorUrls.map(hostOf));
  const onTopic = (t: string): boolean => topicMatch(t, topic, weak);
  const serps = [...(r?.serpEvidence ?? [])].filter((e) => onTopic(e.query)).sort((a, b) => byText(norm(a.query), norm(b.query)));
  // A winner belongs to THIS topic only by exact membership: an appearance under one of the topic's own queries or prompts, or its exact URL cited for one. A shared domain attached whole unrelated pages here.
  const memberPrompts = new Set(observations.map((o) => norm(o.promptText)));
  const memberQueries = new Set([topic, ...opp.fanoutSeeds, ...serps.map((e) => e.query), ...observations.flatMap((o) => o.fanOutQueries ?? [])].map(canonicalQueryKey));
  const memberUrls = new Set([...observations.flatMap((o) => (o.citations ?? []).map((cit) => cit.url)),
    ...serps.flatMap((e) => [...e.organic.map((x) => x.url), ...e.aiOverview.map((cit) => cit.url), ...e.aiMode.map((cit) => cit.url)])].map(canonicalUrlKey));
  return {
    keywords: [...(r?.retainedKeywords ?? [])].filter((k) => onTopic(k.query) && k.searchVolume != null)
      .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || byText(norm(a.query), norm(b.query))),
    serps,
    observations,
    winners: [...(r?.winningPages ?? [])].filter((w) => winnerBelongs(w, memberQueries, memberPrompts, memberUrls))
      .sort((a, b) => byText(a.url, b.url)).slice(0, 2),
    competitors: [...snapshot.competitors].filter((c) => compDomains.has(c.domain))
      .sort((a, b) => b.citationCount - a.citationCount || byText(a.domain, b.domain)).slice(0, 2),
  };
}

/** Support that can JUSTIFY copy. A citation-null observation is context only, so alone it never earns a page brief. */
const hasSupport = (res: TopicResearch): boolean =>
  res.keywords.length > 0 || res.serps.length > 0 || res.observations.some((o) => o.citations != null);

/** The evidence receipt for a brand-new page, built BEFORE anything is drafted. */
function buildTopicReceipt(res: TopicResearch): Receipt {
  const items: BundleEvidenceItem[] = []; const contextOnly: string[] = []; const missing: string[] = []; const prompts: string[] = [];
  const add = (key: string, kind: BundleEvidenceItem["kind"], fact: string, observedAt: string | null): void => { items.push({ key, kind, fact, observedAt }); };
  if (res.keywords.length === 0) missing.push("I do not have a monthly search count for this topic yet.");
  res.keywords.slice(0, 3).forEach((k, i) => add(`kw${i + 1}`, "keyword", keywordFact(k), null));
  if (res.serps.length === 0) missing.push("I have not looked at the live results page for this topic yet.");
  res.serps.slice(0, 2).forEach((e, i) => add(`serp${i + 1}`, "serp", serpFact(e), null));

  const consumer = res.observations.filter((o) => o.observationMode === "consumer_search");
  const plain = res.observations.filter((o) => o.observationMode !== "consumer_search");
  if (res.observations.length === 0) missing.push("No AI answers have been gathered for this topic yet.");
  else if (consumer.length === 0) missing.push("I have not yet watched what a customer sees when they search inside an assistant for this topic.");
  [...consumer.slice(0, 2), ...plain.slice(0, 1)].forEach((o, i) => {
    add(`ai${i + 1}`, "ai_observation", observationFact(o), o.observedAt);
    if (o.citations == null) contextOnly.push(`ai${i + 1}`); // context, never component support
    prompts.push(o.promptText);
  });

  if (res.competitors.length === 0) missing.push("I cannot yet name a site AI hands this topic to instead of you.");
  res.competitors.forEach((c, i) => add(`comp${i + 1}`, "competitor",
    `AI answers cite ${c.domain} for this on ${c.distinctPrompts} different ${c.distinctPrompts === 1 ? "prompt" : "prompts"}.`, null));
  if (res.winners.length === 0) missing.push("I have not read the pages AI keeps citing on this topic yet.");
  res.winners.forEach((w, i) => add(`win${i + 1}`, "winning_page", w.extract
    ? `The page AI cites for this runs ${w.extract.wordCount.toLocaleString()} words with ${w.extract.headings.length} sections, and it lives on ${w.domain}.`
    : `${w.domain} holds a page AI cites for this, and I could not read how it is built.`,
    [...w.appearances].sort((a, b) => byText(b.observedAt, a.observedAt))[0]?.observedAt ?? null));
  missing.push("You have no page on this topic yet, so I have nothing of yours to compare the new one against.");

  const dates = items.map((it) => it.observedAt).filter((d): d is string => !!d).sort(byText);
  return { items, missing, freshestObservedAt: dates.length ? dates[dates.length - 1]! : null,
    prompts: [...new Set(prompts)].sort(byText), hasResearch: true, contextOnlyKeys: contextOnly, links: [],
    readiness: { gsc: false, ownedCopy: false, serp: res.serps.length > 0, winners: res.winners.filter((w) => !!w.extract).length, body: !!PAGE_BODY_TEXT } };
}

/** Produce at most ONE new-page bundle per pass: the strongest demand-ranked topic that ALSO has
 *  research behind it. `none` when no topic clears that bar or the brief fails a gate; shallow briefs continue. */
export async function produceNewPageBundleForSnapshot(snapshot: EvidenceSnapshot, opts: ProduceBundleOptions = {}): Promise<BundleOutcome> {
  const now = opts.now ?? new Date(); const tenantId = snapshot.scope.tenantId;
  const ranked = [...snapshot.newPageOpportunities].filter((o) => !!o.topic.trim())
    .sort((a, b) => b.demandWeight - a.demandWeight || byText(norm(a.topic), norm(b.topic)));
  let pick: NewPageOpportunity | undefined; let res: TopicResearch | undefined;
  const weak = weakAnchorsOf(snapshot);
  for (const opp of ranked) {
    const candidate = researchForTopic(snapshot, opp, weak);
    if (hasSupport(candidate)) { pick = opp; res = candidate; break; }
  }
  if (!pick || !res) return { status: "none", reason: "No topic AI keeps asking about has research behind it yet, so I will not hand you a page I cannot back." };

  const topic = pick.topic;
  const receipt = buildTopicReceipt(res);
  const facts = receipt.items.map((it) => it.fact);
  const competitorPages = [...new Set(pick.competitorUrls)].sort(byText);
  const fanoutQueries = [...new Set(pick.fanoutSeeds)].sort(byText);

  const draft = await draftCreatePageStructured(
    { tenantId, query: topic, pageLabel: topic, competitorPages, fanoutQueries, evidenceHints: facts,
      referenceCandidates: [...new Set([...res.winners.map((w) => w.url), ...competitorPages])].sort(byText) },
    { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains },
  );
  if (draft.status !== "drafted") return { status: "none", reason: `I could not produce a page for "${topic}" that I trust on this pass, so I am handing you nothing rather than filler.` };

  const brief = draft.value;
  const change: RecommendedChange = { kind: "new_page", proposedTitle: brief.proposedTitle, metaDescription: brief.metaDescription,
    openingAnswer: brief.openingAnswer, outline: brief.outline, faqQuestions: brief.faqQuestions ?? [], schemaTypes: brief.schemaTypes ?? [] };
  // Ground the relevance gate in THIS topic's own words, never a vertical vocabulary.
  const contextTokens = [...new Set(`${topic} ${fanoutQueries.join(" ")}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(byText);
  const verdict = validateProposal(gateShape(tenantId, topic, change), { pageBodyText: PAGE_BODY_TEXT, contextTokens, sources: brief.sources,
    evidenceText: [...facts, ...fanoutQueries, ...competitorPages].join(" "), authoritativeSourceDomains: opts.authoritativeSourceDomains, now });
  // NEVER surface a raw validator reason: it is internal vocabulary.
  if (verdict.status === "rejected") return { status: "none", reason: `The page I drafted for "${topic}" failed one of my safety checks, so I am handing you nothing rather than filler.` };

  const risk: BundleComponent["risk"] = verdict.status === "proposed" ? "safe" : "review";
  const contextOnly = new Set(receipt.contextOnlyKeys);
  const researchKeys = receipt.items.filter((it) => !contextOnly.has(it.key)).map((it) => it.key);
  if (researchKeys.length === 0) return { status: "none", reason: `Everything I hold on "${topic}" is background reading I cannot cite, so I will not hand you a page built on it.` }; // components must cite something real
  const kwKeys = receipt.items.filter((it) => it.kind === "keyword").map((it) => it.key);
  const proofKeys = receipt.items.filter((it) => it.kind === "competitor" || it.kind === "winning_page").map((it) => it.key);
  const demandKeys = kwKeys.length ? kwKeys : researchKeys;
  const alternatives: { option: string; reason: string }[] = [];
  const components: BundleComponent[] = [
    { kind: "title", label: "Page title", before: null, after: brief.proposedTitle, evidenceKeys: demandKeys, risk },
    { kind: "meta", label: "Search description", before: null, after: brief.metaDescription, evidenceKeys: demandKeys, risk },
    { kind: "opening_answer", label: "Opening answer", before: null, after: brief.openingAnswer, evidenceKeys: researchKeys, risk },
    { kind: "section", label: "Page plan", before: null, after: [...new Set([...brief.outline, ...(brief.faqQuestions ?? [])])].join("\n"), evidenceKeys: researchKeys, risk },
  ];
  const sources = brief.sources ?? [];
  const sourceCopy = sources.map((s) => `${s.title}, ${s.domain}: ${s.url}`).join("\n");
  if (sources.length > 0 && !looksLikePlaceholder(sourceCopy) && !containsUuid(sourceCopy)) {
    components.push({ kind: "source_pack", label: "Sources to cite", before: null, after: sourceCopy, evidenceKeys: proofKeys.length ? proofKeys : researchKeys, risk });
  } else {
    alternatives.push({ option: "Sources to cite", reason: sources.length > 0
      ? "The sources the draft named did not pass my checks, so I left the list out and you should add your own before you publish."
      : "The draft came back with no sources I can point you at, so I left the source list out and you should add one before you publish." });
  }

  const runnerUp = ranked.find((o) => o.topic !== topic);
  if (runnerUp) alternatives.push({ option: `Build a page for "${runnerUp.topic}" instead`,
    reason: `Its demand ranks at ${runnerUp.demandWeight.toLocaleString()} against this topic's ${pick.demandWeight.toLocaleString()}${runnerUp.demandWeight > pick.demandWeight ? ", but I hold no research on it yet, so I did not draft it" : ", so it ranks below on demand today"}.` });

  const citedPrompts = res.competitors.reduce((a, c) => a + c.distinctPrompts, 0);
  const bundle: ChangeBundle = { // objective: Today renders it verbatim, so it is the MODELED shortfall, never a promise
    objective: `Build one page that answers "${topic}" so the demand lands on you.`,
    metric: `Clicks and views from search for "${topic}" over the next 28 days.`,
    scope: { queries: [...new Set([topic, ...res.keywords.map((k) => k.query)])], prompts: receipt.prompts },
    components,
    receipt: { items: receipt.items, missing: receipt.missing, freshestObservedAt: receipt.freshestObservedAt },
    alternatives,
    risks: [
      "These parts are one page and only work as one: the title and description are the promise, the opening answer is the payoff a searcher and an assistant both read first, the plan is the rest of the page, and the sources are what makes any of it quotable. Publish a title with no answer under it and you have an empty page that ranks for nothing.",
      "A brand new page has to be found before it can earn anything, so give search engines and assistants the full 28 days before you judge it.",
      "This page states facts I drafted from outside reading, so read every line once against what you know before you publish it.",
    ],
    confidenceReasons: [
      pick.basis === "ai_attention"
        ? `AI keeps asking about this topic; my ranking puts it at ${pick.demandWeight.toLocaleString()}, ahead of every other unbuilt topic.`
        : `The demand behind this topic ranks at ${pick.demandWeight.toLocaleString()}, combining real monthly searches with how often AI is asked about it.`,
      citedPrompts > 0
        ? `AI answers already cite the competing sites here across ${citedPrompts} different ${citedPrompts === 1 ? "prompt" : "prompts"} I track, and none of them are you.`
        : "I cannot yet name a site AI hands this topic to, so treat the size of this win as directional.",
      classSentence(receipt),
    ],
    measurementPlan: "Publish the page, then record it on Results with its address and the change type New page, and I will read its clicks and views from search at 7, 14, and 28 days, compared against pages you did not touch.",
  };

  // The evidence classes decide, and the opportunity's own confidence caps them: never louder than its demand.
  const evidenced = topicConfidence(receipt, verdict.status === "proposed");
  return { status: "bundled", proposal: {
      id: `${tenantId}::new::${topic}::new_page::bundle`,
      tenantId, kind: "new_page", changeFamily: "bundle", publish: "manual",
      pagePath: null, pageUrl: null, pageLabel: topic, primaryQuery: topic,
      opportunityType: "Build the page this demand is asking for",
      status: verdict.status,
      recommendedChange: change,
      // Name only the source with receipts: never a combined claim when one is absent.
      whyItMatters: `${pick.basis === "ai_attention" ? `AI keeps getting asked about "${topic}"` : pick.basis === "search_volume" ? `People search for "${topic}"` : `People search for "${topic}" and AI gets asked about it too`} and you have no page that answers it, so building one is how you get into that answer.`,
      estimatedEffortMinutes: 60, riskLevel: "medium", limitations: receipt.missing,
      confidence: rankOf(evidenced) <= rankOf(pick.confidence) ? evidenced : pick.confidence,
      evidence: { query: topic, hints: facts.slice(0, 5), evidenceRefCount: receipt.items.length },
      impactScore: pick.demandWeight, upsidePerMonth: null, bundle, createdAt: now.toISOString(),
  } };
}
