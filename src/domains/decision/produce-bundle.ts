/**
 * decision/produce-bundle (Slices 7 + 8). The ONE producer of a deep, copy-ready
 * ChangeBundle, in the only two archetypes that exist: REWRITE the strongest
 * existing page, and BUILD the one new page the demand is asking for. Not a second
 * pipeline: both reuse the same EvidenceSnapshot, the same structured drafters, the
 * same ONE validator, and ride on the same persisted ChangeProposal.
 *
 * Order of work is deliberate: SELECT, BUILD the evidence receipt FIRST, then draft
 * and keep only what the receipt and the gates justify. Three grounded components
 * beat eight padded ones, and no evidence means no bundle (an honest refusal, never
 * filler). Deterministic: every input list is re-sorted before it is read, so the
 * same evidence in any order produces a byte-identical bundle. server-only; cold
 * under an injected `complete`.
 */

import "server-only";

import type { EvidenceSnapshot, NewPageOpportunity, OwnedPageEvidence, OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { draftAtomicEditStructured, draftAnswerBlockStructured, draftCreatePageStructured } from "@/domains/decision/llm/structured-drafter";
import type { ChangeBundle, BundleComponent, BundleEvidenceItem, ChangeProposal, RecommendedChange } from "./contracts";
import type { ProposeOptions } from "./propose"; import { validateProposal } from "./validate-proposal";
import { scoreTopicMatch } from "@/domains/evidence/relevance-gate"; import { looksLikePlaceholder } from "./placeholder-detection"; import { containsUuid } from "./copy-sanitize";

export type BundleOutcome =
  | { status: "bundled"; proposal: ChangeProposal }
  | { status: "none"; reason: string };

type Research = EvidenceSnapshot["research"];
type Observation = Research["aiObservations"][number];
type SerpEvidence = Research["serpEvidence"][number];
type Keyword = Research["retainedKeywords"][number];

const norm = (s: string): string => s.trim().toLowerCase();
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Real demand: proven clicks weigh ten times the reach that produced them. */
const demandOf = (p: OwnedPageEvidence): number =>
  p.search ? p.search.clicks90d * 10 + p.search.impressions90d : 0;

/** A page can only be rewritten when we hold its current copy. */
const hasCurrentCopy = (p: OwnedPageEvidence): boolean =>
  !!p.content && !!(p.content.title || p.content.h1 || p.content.outline.length > 0);

function parseUrl(url: string): URL | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
}
const pathOf = (url: string): string => parseUrl(url)?.pathname || (url.startsWith("/") ? url : `/${url}`);
const hostOf = (url: string): string => parseUrl(url)?.hostname ?? url;

const WANTS: Record<string, string> = {
  informational: "want an explanation", commercial: "are comparing options",
  transactional: "are ready to act", navigational: "are looking for one specific site",
};

/** One plain-English fact per research class, shared by both archetypes so the
 *  operator reads the SAME sentence shape whichever bundle produced it. */
const keywordFact = (k: Keyword): string => {
  const wants = k.intent ? WANTS[norm(k.intent)] : undefined;
  return `"${k.query}" gets about ${k.searchVolume!.toLocaleString()} searches a month${wants ? `, and the people searching it ${wants}` : ""}.`;
};
const serpFact = (e: SerpEvidence): string => {
  const leaders = [...e.organic].sort((a, b) => a.rank - b.rank).slice(0, 3).map((o) => o.domain);
  return `For "${e.query}" the results page is led by ${leaders.join(", ") || "pages I could not name"}, and the answer box at the top cites ${e.aiOverview.length} ${e.aiOverview.length === 1 ? "source" : "sources"}.`;
};
/** Mode-aware: a citation-null observation is context, never component support. */
const observationFact = (o: Observation): string => {
  const domains = [...new Set((o.citations ?? []).map((cit) => cit.domain))].sort(byText).slice(0, 3);
  const seen = o.observationMode === "consumer_search"
    ? `When a customer searches "${o.promptText}" inside an assistant, `
    : `In a plain assistant answer to "${o.promptText}" (background reading, not what a searching customer sees), `;
  const cited = o.citations == null
    ? "I could not see which pages it leaned on."
    : domains.length === 0
      ? "it answers without pointing at anyone."
      : `it points people at ${domains.join(", ")}.`;
  return `${seen}${cited}`;
};

/** The page's own served queries, strongest first, deterministic on ties. */
function queriesOf(page: OwnedPageEvidence): OwnedQuerySignal[] {
  return [...(page.search?.topQueries ?? [])]
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || byText(a.query, b.query))
    .slice(0, 5);
}

type Receipt = ChangeBundle["receipt"] & { prompts: string[]; hasResearch: boolean; contextOnlyKeys: string[] };

/** The evidence receipt, built BEFORE anything is drafted. Plain English only. */
function buildReceipt(snapshot: EvidenceSnapshot, page: OwnedPageEvidence, queries: OwnedQuerySignal[]): Receipt {
  const items: BundleEvidenceItem[] = [];
  const contextOnly: string[] = [];
  const missing: string[] = [];
  const prompts: string[] = [];
  const add = (key: string, kind: BundleEvidenceItem["kind"], fact: string, observedAt: string | null): void => {
    items.push({ key, kind, fact, observedAt });
  };
  const research = snapshot.research;
  const qset = new Set(queries.map((q) => norm(q.query)));
  const s = page.search!;
  const c = page.content!;

  add("demand-page", "gsc_demand", `Over the last 90 days this page earned ${s.clicks90d.toLocaleString()} clicks from ${s.impressions90d.toLocaleString()} views in search, at about position ${Math.round(s.position90d)}.`, null);
  queries.slice(0, 3).forEach((q, i) => add(`demand-q${i + 1}`, "gsc_demand",
    `People reach this page by searching "${q.query}": ${q.impressions.toLocaleString()} views and ${q.clicks.toLocaleString()} clicks.`, null));
  add("copy-current", "page_extract", c.title
    ? `Today the page is titled "${c.title}" and runs ${c.wordCount.toLocaleString()} words across ${c.outline.length} sections.`
    : `Today the page has no title set and runs ${c.wordCount.toLocaleString()} words across ${c.outline.length} sections.`, c.fetchedAt);

  const keywords = [...(research?.retainedKeywords ?? [])].filter((k) => qset.has(norm(k.query)) && k.searchVolume != null)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || byText(norm(a.query), norm(b.query)));
  if (keywords.length === 0) missing.push("I do not have a monthly search count for these searches yet.");
  keywords.slice(0, 3).forEach((k, i) => add(`kw${i + 1}`, "keyword", keywordFact(k), null));

  const serps = [...(research?.serpEvidence ?? [])].filter((e) => qset.has(norm(e.query))).sort((a, b) => byText(norm(a.query), norm(b.query)));
  if (serps.length === 0) missing.push("I have not looked at the live results page for these searches yet.");
  serps.slice(0, 2).forEach((e, i) => add(`serp${i + 1}`, "serp", serpFact(e), null));

  const observations = [...(research?.aiObservations ?? [])].sort(
    (a, b) => byText(a.observationMode, b.observationMode) || byText(a.promptText, b.promptText) || byText(a.engine, b.engine));
  const consumer = observations.filter((o) => o.observationMode === "consumer_search");
  const plain = observations.filter((o) => o.observationMode !== "consumer_search");
  if (observations.length === 0) missing.push("No AI answers have been gathered for these prompts yet.");
  else if (consumer.length === 0) missing.push("I have not yet watched what a customer sees when they search inside an assistant for these prompts.");
  [...consumer.slice(0, 2), ...plain.slice(0, 1)].forEach((o, i) => {
    add(`ai${i + 1}`, "ai_observation", observationFact(o), o.observedAt);
    if (o.citations == null) contextOnly.push(`ai${i + 1}`); // context, never component support
    prompts.push(o.promptText);
  });

  const winners = [...(research?.winningPages ?? [])].sort((a, b) => byText(a.url, b.url)).slice(0, 2);
  if (winners.length === 0) missing.push("I have not read the pages AI keeps citing on this topic yet.");
  winners.forEach((w, i) => {
    const newest = [...w.appearances].sort((a, b) => byText(b.observedAt, a.observedAt))[0] ?? null;
    add(`win${i + 1}`, "winning_page", w.extract
      ? `${w.domain} is one of the pages AI keeps citing here, and it runs ${w.extract.wordCount.toLocaleString()} words under ${w.extract.headings.length} headings.`
      : `${w.domain} is one of the pages AI keeps citing here.`, newest?.observedAt ?? null);
  });

  const links = [...snapshot.internalLinkOpportunities].filter((l) => l.fromUrl === page.url).sort((a, b) => byText(a.toUrl, b.toUrl)).slice(0, 3);
  links.forEach((l, i) => add(`link${i + 1}`, "internal_link", `This page is on topic for "${l.anchor}" but does not link to it yet.`, null));

  missing.push("I do not hold this page's full body text, so I checked every draft against its title and section headings only.");

  const dates = items.map((it) => it.observedAt).filter((d): d is string => !!d).sort(byText);
  return {
    items, missing, freshestObservedAt: dates.length ? dates[dates.length - 1]! : null, prompts: [...new Set(prompts)].sort(byText),
    hasResearch: items.some((it) => it.kind === "keyword" || it.kind === "serp" || it.kind === "ai_observation" || it.kind === "winning_page"),
    contextOnlyKeys: contextOnly,
  };
}

/** A throwaway proposal shape so the ONE validator can gate one draft. */
function gateShape(tenantId: string, query: string, change: RecommendedChange): ChangeProposal {
  return {
    id: "gate", tenantId, kind: change.kind, pagePath: null, pageUrl: null, pageLabel: "",
    primaryQuery: query, opportunityType: "", changeFamily: "bundle", status: "needs_review",
    recommendedChange: change, whyItMatters: "", estimatedEffortMinutes: 0, riskLevel: "low",
    confidence: "medium", limitations: [], evidence: { query, hints: [], evidenceRefCount: 0 },
    impactScore: null, upsidePerMonth: null, publish: "manual", createdAt: "",
  };
}

export type ProduceBundleOptions = ProposeOptions;

/** Produce at most ONE bundle for a tenant's strongest existing page. `none`
 *  with a structured reason when no page clears demand + current copy, or when
 *  every drafted component fails a gate. */
export async function produceBundleForSnapshot(
  snapshot: EvidenceSnapshot,
  opts: ProduceBundleOptions = {},
): Promise<BundleOutcome> {
  const now = opts.now ?? new Date();
  const tenantId = snapshot.scope.tenantId;

  const ranked = [...snapshot.ownedPages].filter((p) => demandOf(p) > 0 && hasCurrentCopy(p) && queriesOf(p).length > 0)
    .sort((a, b) => demandOf(b) - demandOf(a) || byText(pathOf(a.url), pathOf(b.url)));
  const page = ranked[0];
  if (!page) return { status: "none", reason: "No page has both real search demand and current copy on file, so I have nothing honest to rewrite yet." };

  const queries = queriesOf(page);
  const primary = queries[0]!.query;
  const content = page.content!;
  const search = page.search!;
  const receipt = buildReceipt(snapshot, page, queries);
  const facts = receipt.items.map((it) => it.fact);
  const evidenceText = [...facts, ...content.outline, content.title ?? ""].filter(Boolean).join(" ");
  // The relevance gate asks "does the rewrite still name this page's topic". Ground it in
  // THIS page's own words (query + title + h1), never a vertical vocabulary.
  const contextTokens = [...new Set(`${primary} ${content.title ?? ""} ${content.h1 ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(byText);
  const demandKeys = receipt.items.filter((it) => it.kind === "gsc_demand" || it.kind === "page_extract").map((it) => it.key);
  const contextOnly = new Set(receipt.contextOnlyKeys);
  const researchKeys = receipt.items.filter((it) => it.kind !== "internal_link" && !contextOnly.has(it.key)).map((it) => it.key);

  const components: BundleComponent[] = [];
  const alternatives: { option: string; reason: string }[] = [];
  let heldForReview = false;

  const keep = (kind: BundleComponent["kind"], label: string, before: string | null, after: string, evidenceKeys: string[], change: RecommendedChange): void => {
    const verdict = validateProposal(gateShape(tenantId, primary, change), { pageBodyText: null, evidenceText, contextTokens, now });
    if (verdict.status === "rejected") {
      // NEVER surface a raw validator reason: it is internal vocabulary.
      alternatives.push({ option: label, reason: "The rewrite I drafted failed one of my safety checks, so I left it out rather than risk it." });
      return;
    }
    if (verdict.status === "needs_review") heldForReview = true;
    components.push({ kind, label, before, after, evidenceKeys, risk: verdict.status === "proposed" ? "safe" : "review" });
  };

  for (const field of ["title", "meta"] as const) {
    const before = field === "title" ? content.title : content.metaDescription;
    const draft = await draftAtomicEditStructured(
      { query: primary, pageLabel: content.h1 ?? content.title ?? page.url, field, currentValue: before, outline: content.outline, evidenceHints: facts, tenantId },
      { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains },
    );
    if (draft.status !== "drafted") {
      alternatives.push({ option: field === "title" ? "Page title" : "Search description", reason: "I could not produce a draft I trust for this field on this pass." });
      continue;
    }
    keep(field, field === "title" ? "Page title" : "Search description", before ?? null, draft.value.after, demandKeys, { kind: "existing_edit", field, before: before ?? null, after: draft.value.after });
  }

  if (!receipt.hasResearch) {
    alternatives.push({ option: "Opening answer at the top of the page", reason: "I have no outside evidence on these searches yet, so I will not write an answer I cannot back." });
  } else {
    const draft = await draftAnswerBlockStructured(
      { query: primary, pageLabel: content.h1 ?? content.title ?? page.url, brief: content.title, outline: content.outline, faqs: [], evidenceHints: facts, tenantId },
      { complete: opts.complete, now, bypassCache: opts.bypassCache, authoritativeSourceDomains: opts.authoritativeSourceDomains },
    );
    if (draft.status !== "drafted") {
      alternatives.push({ option: "Opening answer at the top of the page", reason: "I could not produce an opening answer I trust on this pass." });
    } else {
      keep("opening_answer", "Opening answer", null, draft.value.answer, researchKeys, { kind: "existing_edit", field: "answer_block", before: null, after: draft.value.answer });
    }
  }

  const linkItems = receipt.items.filter((it) => it.kind === "internal_link");
  if (linkItems.length > 0) {
    const copy = [...snapshot.internalLinkOpportunities].filter((l) => l.fromUrl === page.url).sort((a, b) => byText(a.toUrl, b.toUrl)).slice(0, 3)
      .map((l) => `Link the words "${l.anchor}" to ${pathOf(l.toUrl)}`).join("\n");
    keep("internal_links", "Links out to your own pages", null, copy, linkItems.map((it) => it.key), { kind: "existing_edit", field: "section", before: null, after: copy });
  }

  if (components.length === 0) return { status: "none", reason: "Every draft I wrote for this page failed a safety check, so I am handing you nothing rather than filler." };

  const runnerUp = ranked[1];
  if (runnerUp) alternatives.push({
    option: `Start with ${pathOf(runnerUp.url)} instead`,
    reason: `It gets ${(runnerUp.search?.impressions90d ?? 0).toLocaleString()} views in search against this page's ${search.impressions90d.toLocaleString()}, so it is the smaller win today.`,
  });

  const confidence: ChangeProposal["confidence"] =
    receipt.items.length >= 6 && receipt.hasResearch ? "high" : receipt.items.length >= 3 ? "medium" : "low";
  const bundle: ChangeBundle = {
    objective: `Make this page the clearest answer for "${primary}" so it turns more of its ${search.impressions90d.toLocaleString()} views into clicks.`,
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
      `This page has real demand: ${search.impressions90d.toLocaleString()} views in search over 90 days.`,
      `I put ${receipt.items.length} pieces of evidence behind it and I can show you every one.`,
      receipt.freshestObservedAt
        ? `The newest evidence I used was observed on ${receipt.freshestObservedAt.slice(0, 10)}.`
        : "Every figure here is a 90 day total, so none of it carries a single observation date.",
    ],
    measurementPlan: "Once you make the change, record it on Results with the page address and I will read clicks, views, and average position for these searches at 7, 14, and 28 days, compared against pages you did not change.",
  };

  const primaryComponent = components[0]!;
  const field: Extract<RecommendedChange, { kind: "existing_edit" }>["field"] =
    primaryComponent.kind === "title" ? "title" : primaryComponent.kind === "meta" ? "meta" : "answer_block";
  const effort = components.reduce((a, c) => a + (c.kind === "title" || c.kind === "meta" ? 1 : c.kind === "opening_answer" ? 5 : 3), 0);

  return {
    status: "bundled",
    proposal: {
      id: `${tenantId}::${pathOf(page.url)}::existing_edit::bundle`,
      tenantId, kind: "existing_edit", changeFamily: "bundle", publish: "manual",
      pagePath: pathOf(page.url), pageUrl: page.url.startsWith("http") ? page.url : `https://${page.url}`,
      pageLabel: content.h1 ?? content.title ?? page.url, primaryQuery: primary,
      opportunityType: "Rewrite the page that already has the demand",
      status: heldForReview ? "needs_review" : "proposed",
      recommendedChange: { kind: "existing_edit", field, before: primaryComponent.before, after: primaryComponent.after },
      whyItMatters: `This page already gets ${search.impressions90d.toLocaleString()} views in search for "${primary}" and only ${search.clicks90d.toLocaleString()} clicks, so sharpening what it says is the fastest win I can hand you.`,
      estimatedEffortMinutes: effort, riskLevel: "low", confidence, limitations: receipt.missing,
      evidence: { query: primary, hints: facts.slice(0, 5), evidenceRefCount: receipt.items.length },
      impactScore: search.impressions90d + (search.position90d > 0 ? Math.max(0, 100 - search.position90d) * 10 : 0),
      upsidePerMonth: null, bundle, createdAt: now.toISOString(),
    },
  };
}

// ── archetype 2 (Slice 8): the ONE new page the demand is asking for ──────────
/** Same topic = exact normalized equality OR the shared token scorer (a bare substring like
 *  "per" inside a long topic must never inherit its demand). */
const topicMatch = (a: string, b: string): boolean => norm(a) === norm(b) || scoreTopicMatch(a, b).relevant;

type TopicResearch = { keywords: Keyword[]; serps: SerpEvidence[]; observations: Observation[]; winners: Research["winningPages"]; competitors: EvidenceSnapshot["competitors"] };

/** Everything on file about ONE topic, re-sorted before read. */
function researchForTopic(snapshot: EvidenceSnapshot, opp: NewPageOpportunity): TopicResearch {
  const r = snapshot.research;
  const topic = opp.topic;
  const observations = [...(r?.aiObservations ?? [])].filter((o) => topicMatch(o.promptText, topic)).sort(
    (a, b) => byText(a.observationMode, b.observationMode) || byText(a.promptText, b.promptText) || byText(a.engine, b.engine));
  const compDomains = new Set(opp.competitorUrls.map(hostOf));
  const citedDomains = new Set(observations.flatMap((o) => (o.citations ?? []).map((c) => c.domain)));
  return {
    keywords: [...(r?.retainedKeywords ?? [])].filter((k) => topicMatch(k.query, topic) && k.searchVolume != null)
      .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || byText(norm(a.query), norm(b.query))),
    serps: [...(r?.serpEvidence ?? [])].filter((e) => topicMatch(e.query, topic)).sort((a, b) => byText(norm(a.query), norm(b.query))),
    observations,
    winners: [...(r?.winningPages ?? [])]
      .filter((w) => w.examplePrompts.some((p) => topicMatch(p, topic)) || compDomains.has(w.domain) || citedDomains.has(w.domain))
      .sort((a, b) => byText(a.url, b.url)).slice(0, 2),
    competitors: [...snapshot.competitors].filter((c) => compDomains.has(c.domain))
      .sort((a, b) => b.citationCount - a.citationCount || byText(a.domain, b.domain)).slice(0, 2),
  };
}

/** Support that can JUSTIFY copy. A citation-null observation is context only,
 *  so on its own it never earns a page brief. */
const hasSupport = (res: TopicResearch): boolean =>
  res.keywords.length > 0 || res.serps.length > 0 || res.observations.some((o) => o.citations != null);

/** The evidence receipt for a brand-new page, built BEFORE anything is drafted. */
function buildTopicReceipt(res: TopicResearch): Receipt {
  const items: BundleEvidenceItem[] = [];
  const contextOnly: string[] = [];
  const missing: string[] = [];
  const prompts: string[] = [];
  const add = (key: string, kind: BundleEvidenceItem["kind"], fact: string, observedAt: string | null): void => {
    items.push({ key, kind, fact, observedAt });
  };
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
  res.winners.forEach((w, i) => {
    const newest = [...w.appearances].sort((a, b) => byText(b.observedAt, a.observedAt))[0] ?? null;
    add(`win${i + 1}`, "winning_page", w.extract
      ? `The page AI cites for this runs ${w.extract.wordCount.toLocaleString()} words with ${w.extract.headings.length} sections, and it lives on ${w.domain}.`
      : `${w.domain} holds a page AI cites for this, and I could not read how it is built.`, newest?.observedAt ?? null);
  });
  missing.push("You have no page on this topic yet, so I have nothing of yours to compare the new one against.");

  const dates = items.map((it) => it.observedAt).filter((d): d is string => !!d).sort(byText);
  return {
    items, missing, freshestObservedAt: dates.length ? dates[dates.length - 1]! : null,
    prompts: [...new Set(prompts)].sort(byText), hasResearch: true, contextOnlyKeys: contextOnly,
  };
}

/** Produce at most ONE new-page bundle per pass: the strongest demand-ranked topic
 *  that ALSO has research behind it. `none` with a structured reason when no topic
 *  clears that bar or the brief fails a gate; the shallow briefs continue either way. */
export async function produceNewPageBundleForSnapshot(
  snapshot: EvidenceSnapshot,
  opts: ProduceBundleOptions = {},
): Promise<BundleOutcome> {
  const now = opts.now ?? new Date();
  const tenantId = snapshot.scope.tenantId;

  const ranked = [...snapshot.newPageOpportunities].filter((o) => !!o.topic.trim())
    .sort((a, b) => b.demandWeight - a.demandWeight || byText(norm(a.topic), norm(b.topic)));
  let pick: NewPageOpportunity | undefined;
  let res: TopicResearch | undefined;
  for (const opp of ranked) {
    const candidate = researchForTopic(snapshot, opp);
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
  const change: RecommendedChange = {
    kind: "new_page", proposedTitle: brief.proposedTitle, metaDescription: brief.metaDescription, openingAnswer: brief.openingAnswer,
    outline: brief.outline, faqQuestions: brief.faqQuestions ?? [], schemaTypes: brief.schemaTypes ?? [],
  };
  // Ground the relevance gate in THIS topic's own words, never a vertical vocabulary.
  const contextTokens = [...new Set(`${topic} ${fanoutQueries.join(" ")}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2))].sort(byText);
  const verdict = validateProposal(gateShape(tenantId, topic, change), {
    pageBodyText: null, evidenceText: [...facts, ...fanoutQueries, ...competitorPages].join(" "),
    contextTokens, sources: brief.sources, authoritativeSourceDomains: opts.authoritativeSourceDomains, now,
  });
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
    components.push({ kind: "source_pack", label: "Sources to cite", before: null,
      after: sourceCopy, evidenceKeys: proofKeys.length ? proofKeys : researchKeys, risk });
  } else {
    alternatives.push({ option: "Sources to cite", reason: sources.length > 0
      ? "The sources the draft named did not pass my checks, so I left the list out and you should add your own before you publish."
      : "The draft came back with no sources I can point you at, so I left the source list out and you should add one before you publish." });
  }

  const runnerUp = ranked.find((o) => o.topic !== topic);
  if (runnerUp) alternatives.push({
    option: `Build a page for "${runnerUp.topic}" instead`,
    reason: `Its demand ranks at ${runnerUp.demandWeight.toLocaleString()} against this topic's ${pick.demandWeight.toLocaleString()}${runnerUp.demandWeight > pick.demandWeight ? ", but I hold no research on it yet, so I did not draft it" : ", so it ranks below on demand today"}.`,
  });

  const citedPrompts = res.competitors.reduce((a, c) => a + c.distinctPrompts, 0);
  const bundle: ChangeBundle = {
    objective: `Build one page that answers "${topic}" so the demand lands on you.`,
    metric: `Clicks and views from search for "${topic}" over the next 28 days.`,
    scope: { queries: [...new Set([topic, ...res.keywords.map((k) => k.query)])], prompts: receipt.prompts },
    components,
    receipt: { items: receipt.items, missing: receipt.missing, freshestObservedAt: receipt.freshestObservedAt },
    alternatives,
    risks: [
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
      `I put ${receipt.items.length} pieces of evidence behind it and I can show you every one.`,
    ],
    measurementPlan: "Publish the page, then record it on Results with its address and the change type New page, and I will read its clicks and views from search at 7, 14, and 28 days, compared against pages you did not touch.",
  };

  return {
    status: "bundled",
    proposal: {
      id: `${tenantId}::new::${topic}::new_page::bundle`,
      tenantId, kind: "new_page", changeFamily: "bundle", publish: "manual",
      pagePath: null, pageUrl: null, pageLabel: topic, primaryQuery: topic,
      opportunityType: "Build the page this demand is asking for",
      status: verdict.status,
      recommendedChange: change,
      // Name only the source with receipts: never a combined claim when one is absent.
      whyItMatters: `${pick.basis === "ai_attention" ? `AI keeps getting asked about "${topic}"` : pick.basis === "search_volume" ? `People search for "${topic}"` : `People search for "${topic}" and AI gets asked about it too`} and you have no page that answers it, so building one is how you get into that answer.`,
      estimatedEffortMinutes: 60, riskLevel: "medium",
      confidence: receipt.items.length >= 6 ? pick.confidence : "low", limitations: receipt.missing,
      evidence: { query: topic, hints: facts.slice(0, 5), evidenceRefCount: receipt.items.length },
      impactScore: pick.demandWeight, upsidePerMonth: null, bundle, createdAt: now.toISOString(),
    },
  };
}
