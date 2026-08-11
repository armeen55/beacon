/**
 * decision/producers/extra: FOUR MORE WAYS THE QUEUE FILLS ITSELF, all $0, all off evidence this account
 * already paid for. Nothing here calls a model or a provider: it reads the stored AI answers, the stored page
 * snapshots and the stored link graph, and mints cards whose every number traces back to a row. The strict
 * path and suggested-edits are untouched; these land beside them at `needs_review`.
 *
 * WHAT IS NOT HERE: a schema card. The stored results pages carry organic rows, AI Overview references,
 * follow-up questions and related searches, and NO rich-result flag of any kind, so "the winners show an FAQ
 * result and this page has none" is a claim this evidence cannot support. Skipped rather than guessed.
 *
 * ONE CARD PER PAGE PER CHANGE FAMILY: the store files a change under (page, family) and a save SUPERSEDES
 * whatever held it, so every candidate is checked against the queue on file AND against this pass's own.
 */
import "server-only";

import { getRepository } from "@/lib/persistence/repositories";
import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { actionFamilyOf, loadChangeProposals } from "../proposal-store";

type Draft = { page: OwnedPageEvidence; slug: string; field: "meta" | "h1" | "section"; type: string;
  query: string; before: string | null; after: string; why: string; steps: string[]; hints: string[];
  minutes: number; confidence: ChangeProposal["confidence"]; limitation: string };

/** A page worth linking to sits inside striking distance and is genuinely being seen; under THIN_WORDS a page
 *  is a stub to a reader and to Google. */
const MAX_PER_PRODUCER = 5, NEAR_MISS_MIN = 4, NEAR_MISS_MAX = 15, MIN_IMPRESSIONS = 30, THIN_WORDS = 200;

const pathOf = (url: string): string => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; }
};
/** Words carried in from an engine, a publisher or a title, made safe to paste: no dash Beacon never writes,
 *  no bracket that reads as a blank somebody forgot to fill in. */
const plain = (s: string | null | undefined): string =>
  (s ?? "").replace(/[–—]/g, ", ").replace(/[[\]{}]/g, " ").replace(/\s+/g, " ").trim();
const labelOf = (p: OwnedPageEvidence): string => plain(p.content?.h1 ?? p.content?.title ?? pathOf(p.url)) || pathOf(p.url);
const clicksOf = (p: OwnedPageEvidence): number => p.search?.clicks90d ?? 0;
const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The words a page can be judged on without paying for a body read: its title, its heading and its outline. */
const pageWords = (p: OwnedPageEvidence): Set<string> =>
  new Set(topicTokens([p.content?.title, p.content?.h1, ...(p.content?.outline ?? []), pathOf(p.url).replace(/[-/]/g, " ")].filter(Boolean).join(" ")));

/** The words of a question that carry its subject: a site wide word this account puts on everything proves no
 *  connection at all, so it never makes a page look like the answer to anything. */
const subjectWords = (text: string, weak: ReadonlySet<string>): string[] =>
  [...new Set(topicTokens(text))].filter((t) => t.length > 2 && !weak.has(t));

/** Matching runs on stems and an operator must never be told to write "persepoli", so every stem is handed
 *  back the word it was cut from, spelled as the search spelled it. */
const asWritten = (text: string, stems: readonly string[]): string[] => {
  const words = plain(text).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean);
  return stems.map((s) => words.find((w) => topicTokens(w).includes(s)) ?? s);
};

type Match = { page: OwnedPageEvidence; hits: string[]; missing: string[] };
/** The page of this account's own that best answers a question, or null when nothing of its own comes close.
 *  Two subject words is the floor: one shared word is a coincidence, not coverage. */
function bestPageFor(text: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>): Match | null {
  const words = subjectWords(text, weak);
  if (words.length < 2) return null;
  let best: Match | null = null;
  for (const page of pages) {
    const has = pageWords(page), hits = words.filter((w) => has.has(w));
    if (hits.length < 2 || (best && (hits.length < best.hits.length
      || (hits.length === best.hits.length && clicksOf(page) <= clicksOf(best.page))))) continue;
    best = { page, hits, missing: words.filter((w) => !has.has(w)) };
  }
  return best;
}

/** ONE card, in the ONE shape the store files and every surface renders. */
function mint(tenantId: string, d: Draft, now: Date): ChangeProposal {
  const path = pathOf(d.page.url);
  return {
    id: `${tenantId}::${path.toLowerCase()}::existing_edit::${d.slug}`, tenantId, kind: "existing_edit",
    pagePath: path, pageUrl: d.page.url, pageLabel: labelOf(d.page), primaryQuery: d.query,
    opportunityType: d.type, changeFamily: d.field, status: "needs_review",
    recommendedChange: { kind: "existing_edit", field: d.field, before: d.before, after: d.after },
    whyItMatters: d.why, operatorSteps: d.steps, estimatedEffortMinutes: d.minutes, riskLevel: "low",
    confidence: d.confidence, limitations: [d.limitation],
    evidence: { query: d.query, hints: d.hints, evidenceRefCount: d.hints.length },
    impactScore: null, upsidePerMonth: null, publish: "manual", createdAt: now.toISOString(),
  };
}

/** 1. THE ANSWERS THAT CREDIT SOMEBODY ELSE. Every stored answer that credited a page and never credited this account, grouped by the question it
 *  answered. Recurrence across answers is the claim, so the question the most answers skipped comes first. */
function aiAbsenceCards(snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], weak: ReadonlySet<string>): Draft[] {
  const site = (snapshot.scope.site ?? "").replace(/^www\./, "").toLowerCase();
  if (!site) return [];
  type Group = { prompt: string; answers: number; engines: Set<string>; domains: Map<string, { n: number; url: string; title: string; engine: string }> };
  const byPrompt = new Map<string, Group>();
  for (const o of snapshot.research.aiObservations) {
    const cites = o.citations ?? [];
    if (cites.length === 0 || cites.some((c) => c.domain.replace(/^www\./, "").toLowerCase().endsWith(site))) continue;
    const key = canonicalQueryKey(o.promptText);
    const g = byPrompt.get(key) ?? { prompt: plain(o.promptText), answers: 0, engines: new Set<string>(), domains: new Map() };
    g.answers += 1; g.engines.add(o.engine);
    for (const c of new Map(cites.map((c) => [c.domain, c])).values()) {
      const d = g.domains.get(c.domain) ?? { n: 0, url: c.url.split("?")[0] ?? c.url, title: plain(c.title) || c.domain, engine: o.engine };
      d.n += 1; g.domains.set(c.domain, d);
    }
    byPrompt.set(key, g);
  }
  const out: Draft[] = [];
  for (const g of [...byPrompt.values()].sort((a, b) => b.answers - a.answers || b.engines.size - a.engines.size || a.prompt.localeCompare(b.prompt))) {
    const match = bestPageFor(g.prompt, pages, weak);
    const top = [...g.domains.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
    if (!match || !top) continue;
    const [domain, cite] = top;
    const engines = [...g.engines].sort().join(", "), covers = asWritten(g.prompt, match.hits).join(", ");
    out.push({
      page: match.page, slug: "ai_answer_gap", field: "section", query: g.prompt,
      type: "Answer the question AI hands to somebody else", before: null,
      after: `Add a short section that answers "${g.prompt}" outright: the answer in the first two sentences, then the specifics only this page has, under a heading a reader would search for.`,
      why: `AI answers for "${g.prompt}" cite ${domain} on ${count(cite.n, "answer")} and never name this site, across ${count(g.answers, "stored answer")} from ${engines}. The page they cite is ${cite.url}. ${labelOf(match.page)} at ${pathOf(match.page.url)} already covers ${covers}, so a section that answers the question outright is the cheapest way into that answer.`,
      steps: [`Open the site editor on ${pathOf(match.page.url)}`, `Add a section that answers "${g.prompt}"`,
        "Put the answer in the first two sentences, before any background", "Mark it done here and the next answers get checked against it"],
      hints: [`${cite.engine} cited ${cite.url} ("${cite.title}") when answering "${g.prompt}"`,
        `${count(g.answers, "stored answer")} to this question from ${engines} credited other sites and none credited this one`,
        `Cited domains on this question: ${[...g.domains.keys()].slice(0, 5).join(", ")}`],
      minutes: 30, confidence: g.answers >= 3 ? "medium" : "low",
      limitation: "This is read off the answers already stored for this question, not off a fresh answer bought today, and no rewrite guarantees a citation.",
    });
    if (out.length >= MAX_PER_PRODUCER) break;
  }
  return out;
}

/** 2. THE FOLLOW-UP SEARCHES ENGINES RUN FOR THEMSELVES. The searches an engine fired while answering a tracked question. A page that covers most of one and misses
 *  the rest is a section away from being the thing the engine reads next time. */
function fanoutCards(snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], weak: ReadonlySet<string>): Draft[] {
  const byFanout = new Map<string, { text: string; n: number; prompt: string; engines: Set<string> }>();
  for (const o of snapshot.research.aiObservations) for (const f of o.fanOutQueries ?? []) {
    const key = canonicalQueryKey(f);
    if (!key) continue;
    const e = byFanout.get(key) ?? { text: plain(f), n: 0, prompt: plain(o.promptText), engines: new Set<string>() };
    e.n += 1; e.engines.add(o.engine); byFanout.set(key, e);
  }
  const out: Draft[] = [];
  for (const f of [...byFanout.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text))) {
    const match = bestPageFor(f.text, pages, weak);
    if (!match || match.missing.length === 0 || match.hits.length < 3) continue;
    const total = match.hits.length + match.missing.length;
    const gap = asWritten(f.text, match.missing).slice(0, 4).join(", "), covers = asWritten(f.text, match.hits).join(", ");
    out.push({
      page: match.page, slug: "engine_followup", field: "section", query: f.text,
      type: "Cover the follow-up search engines run themselves", before: null,
      after: `Add a section that answers the search "${f.text}", naming ${gap} in its first paragraph and in its heading.`,
      why: `While answering "${f.prompt}", engines ran their own follow-up search for "${f.text}". ${labelOf(match.page)} at ${pathOf(match.page.url)} covers ${match.hits.length} of the ${total} subjects in that search and its title and headings never mention ${gap}. Add one section that says those words plainly.`,
      steps: [`Open the site editor on ${pathOf(match.page.url)}`, `Add a section that answers "${f.text}"`,
        `Name ${gap} in the first paragraph`, "Mark it done here and the next answers get checked against it"],
      hints: [`${[...f.engines].sort().join(", ")} ran the follow-up search "${f.text}" on ${count(f.n, "stored answer")}`,
        `The question being answered was "${f.prompt}"`,
        `${pathOf(match.page.url)} already covers ${covers} and is missing ${asWritten(f.text, match.missing).join(", ")}`],
      minutes: 30, confidence: "low",
      limitation: "The check is against this page's title and headings, which is all that is stored for it, so a paragraph deep in the body may already mention some of these words.",
    });
    if (out.length >= MAX_PER_PRODUCER) break;
  }
  return out;
}

/** 3. THE LINKS THE STRONGEST PAGES NEVER PASS ON: the three pages that earn the most clicks, and the near miss pages they never link to. Reads the stored
 *  link graph, which the lean page projection leaves out on purpose, so absence of a link is a fact here. */
async function linkCards(tenantId: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>): Promise<Draft[]> {
  const graphs = await getRepository().forTenant(tenantId).getPageSnapshotLinkGraphs().catch(() => []);
  if (graphs.length === 0) return [];
  const linksByPage = new Map<string, Set<string>>();
  for (const g of graphs) {
    const key = canonicalUrlKey(g.url);
    if (linksByPage.has(key)) continue;
    linksByPage.set(key, new Set(g.internal_links.map((l) => pathOf(l.href).toLowerCase())));
  }
  const strongest = pages.filter((p) => linksByPage.has(canonicalUrlKey(p.url)) && clicksOf(p) > 0)
    .sort((a, b) => clicksOf(b) - clicksOf(a)).slice(0, 3);
  const nearMiss = pages.flatMap((p) => {
    const q = (p.search?.topQueries ?? []).filter((q) => q.position != null && q.position >= NEAR_MISS_MIN
      && q.position <= NEAR_MISS_MAX && q.impressions >= MIN_IMPRESSIONS).sort((a, b) => b.impressions - a.impressions)[0];
    return q ? [{ page: p, query: q }] : [];
  }).sort((a, b) => b.query.impressions - a.query.impressions);
  const out: Draft[] = [];
  for (const from of strongest) {
    const links = linksByPage.get(canonicalUrlKey(from.url))!;
    const words = pageWords(from);
    const target = nearMiss.find((t) => t.page.url !== from.url && !links.has(pathOf(t.page.url).toLowerCase())
      && subjectWords(t.query.query, weak).some((w) => words.has(w)));
    if (!target) continue;
    const to = pathOf(target.page.url), position = target.query.position!.toFixed(1);
    out.push({
      page: from, slug: "internal_link", field: "section", query: target.query.query,
      type: "Pass strength to a page that is nearly there", before: null,
      after: `Add one link in the body of ${pathOf(from.url)} pointing to ${to}, with the anchor text "${target.query.query}".`,
      why: `${labelOf(from)} at ${pathOf(from.url)} earns ${count(clicksOf(from), "click")} in 90 days and carries ${count(links.size, "internal link")}, not one of them to ${to}. That page sits at position ${position} for "${target.query.query}" on ${count(target.query.impressions, "impression")} and ${count(target.query.clicks, "click")}. One link with that anchor is the cheapest push it can get.`,
      steps: [`Open the site editor on ${pathOf(from.url)}`, `Add a link to ${to} inside the body copy, not the menu`,
        `Use "${target.query.query}" as the anchor text`, "Mark it done here and the position gets read again"],
      hints: [`${pathOf(from.url)} links to ${count(links.size, "page")} of this site and none of them is ${to}`,
        `${to} ranks at position ${position} for "${target.query.query}" with ${count(target.query.impressions, "impression")} in Search Console`,
        `${pathOf(from.url)} earns ${count(clicksOf(from), "click")} in the last 90 days`],
      minutes: 5, confidence: "medium",
      limitation: "The link list comes from the last stored read of this page, so a link added since then is not counted here.",
    });
    if (out.length >= MAX_PER_PRODUCER) break;
  }
  return out;
}

/** 4. THE THREE DEFECTS WORTH A SWEEP: one card per class, anchored on the page with the most to gain and naming the rest. */
function technicalCards(pages: OwnedPageEvidence[]): Draft[] {
  const impressions = (p: OwnedPageEvidence): number => p.search?.impressions90d ?? 0;
  const rank = (list: OwnedPageEvidence[]): OwnedPageEvidence[] => [...list].sort((a, b) => impressions(b) - impressions(a));
  const others = (list: OwnedPageEvidence[]): string => list.slice(1, 9).map((p) => pathOf(p.url)).join(", ");
  const out: Draft[] = [];
  const noMeta = rank(pages.filter((p) => !p.content?.metaDescription?.trim()));
  if (noMeta[0]) out.push({
    page: noMeta[0], slug: "missing_description", field: "meta", query: labelOf(noMeta[0]),
    type: "Write the description Google is writing for you", before: null,
    after: "Write a description of about 150 characters that names this page's subject and the one answer it gives, and ends with a reason to click.",
    why: `${count(noMeta.length, "page")} on this site have no description, so Google writes the line under the title itself. ${pathOf(noMeta[0].url)} is the busiest of them at ${count(impressions(noMeta[0]), "impression")} in 90 days. Write one description per page, starting here.`,
    steps: [`Open the site editor on ${pathOf(noMeta[0].url)}`, "Paste a description of about 150 characters",
      ...(noMeta.length > 1 ? [`Repeat on ${others(noMeta)}`] : []), "Mark it done here and the click rate gets read again"],
    hints: [`${count(noMeta.length, "page")} with content stored carry no description`,
      `Pages missing one: ${rank(noMeta).slice(0, 8).map((p) => pathOf(p.url)).join(", ")}`,
      `${pathOf(noMeta[0].url)} earns ${count(impressions(noMeta[0]), "impression")} and ${count(clicksOf(noMeta[0]), "click")} in 90 days`],
    minutes: 1, confidence: "medium",
    limitation: "Read off the last stored copy of each page, so a description added since that read is not counted here.",
  });

  const byH1 = new Map<string, OwnedPageEvidence[]>();
  for (const p of pages) { const h = (p.content?.h1 ?? "").trim().toLowerCase(); if (h) byH1.set(h, [...(byH1.get(h) ?? []), p]); }
  const dupes = [...byH1.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
  const worst = dupes[0] ? rank(dupes[0]) : [];
  if (worst[0]) out.push({
    page: worst[0], slug: "duplicate_heading", field: "h1", query: labelOf(worst[0]),
    type: "Give each page its own heading", before: plain(worst[0].content?.h1), after: "Rewrite this heading so it names what only this page covers, then do the same on the other pages listed below.",
    why: `${count(worst.length, "page")} share the heading "${plain(worst[0].content?.h1)}", and ${count(dupes.length, "heading")} on this site are duplicated in total. Two pages with the same heading ask Google to pick between them. ${pathOf(worst[0].url)} is the busiest of the set at ${count(impressions(worst[0]), "impression")} in 90 days.`,
    steps: [`Open the site editor on ${pathOf(worst[0].url)}`, "Rewrite the heading so it names what only this page covers",
      ...(worst.length > 1 ? [`Do the same on ${others(worst)}`] : []), "Mark it done here and the positions get read again"],
    hints: [`Pages sharing the heading "${plain(worst[0].content?.h1)}": ${worst.slice(0, 8).map((p) => pathOf(p.url)).join(", ")}`,
      `${count(dupes.length, "heading")} are duplicated across this site`,
      `${pathOf(worst[0].url)} earns ${count(impressions(worst[0]), "impression")} in 90 days`],
    minutes: 1, confidence: "medium",
    limitation: "Headings are compared exactly as stored, so two headings that differ only by a stray word read as separate here.",
  });

  const thin = rank(pages.filter((p) => (p.content?.wordCount ?? 0) > 0 && (p.content?.wordCount ?? 0) < THIN_WORDS && impressions(p) > 0));
  if (thin[0]) out.push({
    page: thin[0], slug: "thin_page", field: "section", query: labelOf(thin[0]),
    type: "Give a stub page enough to answer with", before: null,
    after: `Add 200 to 300 words to ${pathOf(thin[0].url)} that answer its main question, in short sections with their own headings.`,
    why: `${pathOf(thin[0].url)} holds ${count(thin[0].content?.wordCount ?? 0, "word")} and still earns ${count(impressions(thin[0]), "impression")} in 90 days, so people are being shown a page with almost nothing on it. ${count(thin.length, "page")} that Google is already showing are under ${THIN_WORDS} words. Start with this one.`,
    steps: [`Open the site editor on ${pathOf(thin[0].url)}`, "Add 200 to 300 words that answer the question the page title asks",
      "Break them into short sections with their own headings", "Mark it done here and the impressions get read again"],
    hints: [`${pathOf(thin[0].url)} holds ${count(thin[0].content?.wordCount ?? 0, "word")} of copy`,
      `${count(thin.length, "page")} of the ${pages.length} stored pages are under ${THIN_WORDS} words and are being shown in search`,
      `Other stub pages worth the same treatment: ${others(thin)}`],
    minutes: 30, confidence: "medium",
    limitation: "Word count is read off the last stored copy of the page, so copy added since that read is not counted here.",
  });
  return out;
}

/**
 * Every extra card this account's stored evidence already supports, at `needs_review`, deduplicated against
 * the queue it already holds. Never throws: a source that will not read narrows the answer instead of failing
 * the pass. $0 by construction, and every card is a proposal, never a live edit.
 */
export async function extraQueueCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date }): Promise<ChangeProposal[]> {
  const { tenantId, snapshot, now } = input;
  const pages = snapshot.ownedPages.filter((p) => !!p.content);
  if (pages.length === 0) return [];
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  // WHAT THIS ACCOUNT ALREADY HOLDS, so a card never supersedes a change the strict path drafted for the same
  // page and the same family. An unreadable queue emits nothing rather than writing over work it cannot see.
  const held = await loadChangeProposals(tenantId).then(
    (map) => new Set([...map.values()].map((p) => `${(p.pagePath ?? "").toLowerCase()}::${actionFamilyOf(p)}`)),
  ).catch(() => null);
  if (!held) return [];
  const drafts = [...aiAbsenceCards(snapshot, pages, weak), ...fanoutCards(snapshot, pages, weak),
    ...(await linkCards(tenantId, pages, weak)), ...technicalCards(pages)];
  const out: ChangeProposal[] = [];
  for (const d of drafts) {
    const card = mint(tenantId, d, now);
    const key = `${(card.pagePath ?? "").toLowerCase()}::${actionFamilyOf(card)}`;
    if (held.has(key)) continue;
    held.add(key);
    out.push(card);
  }
  return out;
}
