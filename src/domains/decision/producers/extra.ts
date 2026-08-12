/** decision/producers/extra: FOUR MORE WAYS THE QUEUE FILLS ITSELF, all off evidence this account already paid
 * for. Every card is minted from stored rows: the stored AI answers, the stored page snapshots and the stored
 * link graph, and every number on one traces back to a row. The strict path and suggested-edits are untouched;
 * these land beside them at `needs_review`.
 *
 * THE ONE THING THIS PASS BUYS is a page job (producers/page-job.ts): one sentence saying what each of the busiest
 * pages is FOR, keyed by that page's own extract through the existing call cache, so an unchanged page costs nothing
 * after the first reading. It decides WHERE a card lands, never WHETHER one exists: a page with no job on file is
 * treated exactly as it was before jobs existed.
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
import { log } from "@/lib/logger";
import { canonicalQueryKey, domainOf, templateHeadings, topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { actionFamilyOf, loadChangeProposals } from "../proposal-store";
import { linkFit, loadPageJobs, sectionFit, type OwnedPageJob } from "./page-job";

/** What this producer did, and whether it FINISHED. `complete` is the whole basis the sweep behind it acts
 *  on: it is true only when the queue on file was actually read and every card below was minted against it.
 *  Never inferred from how many cards came back, because "none this pass" and "I could not look" are the
 *  same length and opposite facts. */
export type ExtraQueueRun = { cards: ChangeProposal[]; complete: boolean };

/** `headline` IS the card's action line: it names the page, the thing to do and the number behind it, so the
 *  queue reads as work without being opened. Never "update the section to sharpen it", which says nothing. */
type Draft = { page: OwnedPageEvidence; slug: string; field: "meta" | "h1" | "section"; headline: string;
  query: string; before: string | null; after: string; why: string; steps: string[]; hints: string[];
  minutes: number; confidence: ChangeProposal["confidence"]; limitation: string;
  /** The question this card came out of. ONE QUESTION, ONE CARD: an answer and the follow-up search an
   *  engine ran while writing it are the same question, so the strongest of them is the only one filed. */
  asked?: string };

/** A page worth linking to sits inside striking distance and is genuinely being seen; under THIN_WORDS a page
 *  is a stub to a reader and to Google. TOP_PAGES_PER_CLASS is how many pages one defect mints cards for in one
 *  pass: a sweep is still done one page at a time, so it is filed one page at a time. */
const MAX_PER_PRODUCER = 5, NEAR_MISS_MIN = 4, NEAR_MISS_MAX = 15, MIN_IMPRESSIONS = 30, THIN_WORDS = 200, TOP_PAGES_PER_CLASS = 3;
/** A thin page shown this often is not a stub to fill, it is a page to write. */
const HEAVY_IMPRESSIONS = 5_000;
/** Words of the page's own tie to a search, past the site wide ones, before it may be asked to answer it. */
const MIN_EARNED_OVERLAP = 2;
/** Past this a heading is a paragraph a page builder wrapped in a heading tag, and it says nothing about  what the page is built to answer. */
const MAX_HEADING_WORDS = 12;
/** THE PAGES AN ESSAY NEVER GOES ON: the home page, and the shop rails. A storefront answers with products,
 *  so "add a section answering this question" there is work nobody would ever publish. */
const STOREFRONT = /(^|[/-])(explore|shop|store|categor(y|ies)|collections?|product|cart|checkout)([/-]|$)/i;
/** A search asking WHICH SITES cover something wants a directory. No page of this account is the answer to
 *  it, and writing one reads as an advert for itself. A question where somebody DESCRIBES THEMSELVES is
 *  their own situation, not a search: whatever page it lands on, it landed there by accident. */
const META_QUESTION = /\b(web ?sites?|sites?|blogs?)\b/i;
const PERSONAL = /\b(i'm|im|i am|i've|myself|my)\b/i;
const askable = (q: string): boolean => !META_QUESTION.test(q) && !PERSONAL.test(q);
/** Results led by places that sell. A page losing to these loses on having nothing to buy on it. */
const SHOP_DOMAIN = /(^|\.)(amazon|etsy|ebay|aliexpress|walmart|redbubble|teepublic|zazzle|temu|wayfair|shop)\./i;
const STORE_FIRST = /(^|\.)(amazon|etsy)\./i;

const pathOf = (url: string): string => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; }
};
/** Words carried in from an engine, a publisher or a title, made safe to paste: no dash Beacon never writes,  no bracket that reads as a blank somebody forgot to fill in. */
const plain = (s: string | null | undefined): string =>
  (s ?? "").replace(/[–—]/g, ", ").replace(/[[\]{}]/g, " ").replace(/\s+/g, " ").trim();
const labelOf = (p: OwnedPageEvidence): string => plain(p.content?.h1 ?? p.content?.title ?? pathOf(p.url)) || pathOf(p.url);
const clicksOf = (p: OwnedPageEvidence): number => p.search?.clicks90d ?? 0;
const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The words a page can be judged on without paying for a body read: its title, its heading and its outline. */
const pageWords = (p: OwnedPageEvidence): Set<string> =>
  new Set(topicTokens([p.content?.title, p.content?.h1, ...(p.content?.outline ?? []), pathOf(p.url).replace(/[-/]/g, " ")].filter(Boolean).join(" ")));
const flat = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
/** THE WORDS A PAGE HAS EARNED THE RIGHT TO BE ASKED ABOUT: its title, its heading, and the headings of its
 *  own sections. Site wide furniture, paragraphs wrapped in a heading tag, and the page's own FAQ questions
 *  are none of those: a question a page ASKS is not a subject it covers, and a tie made of any of them is no
 *  tie at all. That is how a page about film directors was asked to write about books. */
const earnedWords = (p: OwnedPageEvidence, furniture: ReadonlySet<string>): Set<string> =>
  new Set(topicTokens([p.content?.title, p.content?.h1,
    ...(p.content?.outline ?? []).filter((h) => !furniture.has(flat(h)) && !h.trim().endsWith("?")
      && h.trim().split(/\s+/).length <= MAX_HEADING_WORDS)].filter(Boolean).join(" ")));
/** ONE PAGE, WHATEVER SPELLING ASKED FOR IT: the address the read landed on, else the address the page names
 *  as its own, else the address asked for. Three retired slugs forwarding to one product are ONE page, and
 *  counting them as three invented duplicate headings and missing descriptions out of nothing. */
const identityOf = (p: OwnedPageEvidence): string =>
  canonicalUrlKey(p.content?.finalUrl || p.content?.canonicalUrl || p.url);

/** The words of a question that carry its subject: a site wide word this account puts on everything proves no
 *  connection at all, so it never makes a page look like the answer to anything. */
const subjectWords = (text: string, weak: ReadonlySet<string>): string[] =>
  [...new Set(topicTokens(text))].filter((t) => t.length > 2 && !weak.has(t));

/** Matching runs on stems and an operator must never be told to write "persepoli", so every stem is handed  back the word it was cut from, spelled as the search spelled it. */
const asWritten = (text: string, stems: readonly string[]): string[] => {
  const words = plain(text).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean);
  return stems.map((s) => words.find((w) => topicTokens(w).includes(s)) ?? s);
};

type Match = { page: OwnedPageEvidence; hits: string[]; missing: string[] };
/** WHERE A REAL SEARCH BELONGS. `fits` names the page. `needs_own_page` means pages did share the words and every
 *  one of them is FOR something else: a routing fact the coverage path acts on, never this file, because new page
 *  identity is not this producer's to mint. `no_candidate` is the old silence, unchanged. */
type Jobs = ReadonlyMap<string, OwnedPageJob>;
type Fit = { match: Match | null; verdict: "fits" | "needs_own_page" | "no_candidate" };
const jobOf = (jobs: Jobs, page: OwnedPageEvidence): OwnedPageJob | undefined => jobs.get(canonicalUrlKey(page.url));
/** The page of this account's own that best answers a question, or null when nothing of its own comes close.
 *  Two subject words is the floor: one shared word is a coincidence, not coverage. THE HOME PAGE AND THE
 *  SHOP RAILS ARE NEVER IT, and neither is a page whose only tie to the question is site wide furniture.
 *  WHERE A PAGE CARRIES A JOB, the job decides too: a page whose subjects do not include this search, or whose shape
 *  is a rail an essay never goes on, is not the answer however many words it shares. No job, and the words decide. */
function bestPageFor(text: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
  earned: ReadonlyMap<string, Set<string>>, children: ReadonlyMap<string, number>, jobs: Jobs): Fit {
  const words = subjectWords(text, weak);
  if (words.length < 2) return { match: null, verdict: "no_candidate" };
  // THE HUB, NOT THE BUSIEST LEAF. Two pages tied on the same words are not equal: the one the rest of the
  // subject hangs under is where a whole-subject answer belongs, and a single animal's page is not it.
  const rankOf = (p: OwnedPageEvidence): [number, number] => [children.get(pathOf(p.url)) ?? 0, clicksOf(p)];
  const beats = (a: OwnedPageEvidence, b: OwnedPageEvidence): boolean => {
    const [ac, ak] = rankOf(a), [bc, bk] = rankOf(b);
    return ac !== bc ? ac > bc : ak > bk;
  };
  let best: Match | null = null, refused = 0;
  for (const page of pages) {
    const path = pathOf(page.url);
    if (path === "/" || STOREFRONT.test(path)) continue;
    const own = earned.get(page.url);
    if (!own || words.filter((w) => own.has(w)).length < MIN_EARNED_OVERLAP) continue;
    const has = pageWords(page), hits = words.filter((w) => has.has(w));
    if (hits.length < 2) continue;
    // A JOB IS READ ONLY WHERE ONE EXISTS: "unknown" is the answer for every page that has none, and it passes.
    const job = jobOf(jobs, page);
    if (job && sectionFit(job, words) !== "fits") { refused += 1; continue; }
    if (best && (hits.length < best.hits.length
      || (hits.length === best.hits.length && !beats(page, best.page)))) continue;
    best = { page, hits, missing: words.filter((w) => !has.has(w)) };
  }
  return { match: best, verdict: best ? "fits" : refused > 0 ? "needs_own_page" : "no_candidate" };
}

/** A search whose words this account shares but whose subject no page of it is FOR. Acted on nowhere here: the
 *  coverage path decides whether a page should exist, so this is a line in the log and never a card. */
const noteNeedsOwnPage = (tenantId: string, text: string): void =>
  log.info("[extra] no page of this account is for this search", { tenantId, query: text.slice(0, 120) });

/** ONE card, in the ONE shape the store files and every surface renders. */
function mint(tenantId: string, d: Draft, now: Date): ChangeProposal {
  const path = pathOf(d.page.url);
  return {
    id: `${tenantId}::${path.toLowerCase()}::existing_edit::${d.slug}`, tenantId, kind: "existing_edit",
    pagePath: path, pageUrl: d.page.url, pageLabel: labelOf(d.page), primaryQuery: d.query,
    opportunityType: d.headline, changeFamily: d.field, status: "needs_review",
    recommendedChange: { kind: "existing_edit", field: d.field, before: d.before, after: d.after },
    whyItMatters: d.why, operatorSteps: d.steps, estimatedEffortMinutes: d.minutes, riskLevel: "low",
    confidence: d.confidence, limitations: [d.limitation],
    evidence: { query: d.query, hints: d.hints, evidenceRefCount: d.hints.length },
    impactScore: null, upsidePerMonth: null, publish: "manual", createdAt: now.toISOString(),
  };
}

/** 1. THE ANSWERS THAT CREDIT SOMEBODY ELSE. Every stored answer that credited a page and never credited this account, grouped by the question it
 *  answered. Recurrence across answers is the claim, so the question the most answers skipped comes first. */
function aiAbsenceCards(snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
  earned: ReadonlyMap<string, Set<string>>, children: ReadonlyMap<string, number>, jobs: Jobs, tenantId: string): Draft[] {
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
    if (!askable(g.prompt)) continue;
    const fit = bestPageFor(g.prompt, pages, weak, earned, children, jobs);
    if (fit.verdict === "needs_own_page") noteNeedsOwnPage(tenantId, g.prompt);
    const match = fit.match;
    const top = [...g.domains.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
    if (!match || !top) continue;
    const [domain, cite] = top;
    const engines = [...g.engines].sort().join(", "), covers = asWritten(g.prompt, match.hits).join(", ");
    out.push({
      page: match.page, slug: "ai_answer_gap", field: "section", query: g.prompt, asked: g.prompt,
      headline: `AI answers cite ${domain} for "${g.prompt}" and never you; answer it on ${pathOf(match.page.url)}`, before: null,
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
function fanoutCards(snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
  earned: ReadonlyMap<string, Set<string>>, children: ReadonlyMap<string, number>, jobs: Jobs, tenantId: string): Draft[] {
  const byFanout = new Map<string, { text: string; n: number; prompt: string; engines: Set<string> }>();
  for (const o of snapshot.research.aiObservations) for (const f of o.fanOutQueries ?? []) {
    const key = canonicalQueryKey(f);
    if (!key) continue;
    const e = byFanout.get(key) ?? { text: plain(f), n: 0, prompt: plain(o.promptText), engines: new Set<string>() };
    e.n += 1; e.engines.add(o.engine); byFanout.set(key, e);
  }
  const out: Draft[] = [];
  for (const f of [...byFanout.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text))) {
    if (!askable(f.text) || !askable(f.prompt)) continue;
    const fit = bestPageFor(f.text, pages, weak, earned, children, jobs);
    if (fit.verdict === "needs_own_page") noteNeedsOwnPage(tenantId, f.text);
    const match = fit.match;
    if (!match || match.missing.length === 0 || match.hits.length < 3) continue;
    const total = match.hits.length + match.missing.length;
    const gap = asWritten(f.text, match.missing).slice(0, 4).join(", "), covers = asWritten(f.text, match.hits).join(", ");
    out.push({
      page: match.page, slug: "engine_followup", field: "section", query: f.text, asked: f.prompt,
      headline: `Add a section on "${f.text}" to ${pathOf(match.page.url)} (engines search it while answering about you)`, before: null,
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
async function linkCards(tenantId: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>, jobs: Jobs): Promise<Draft[]> {
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
    // THE SEARCH BECOMES THE WORDS ON THE LINK, so a search that is not words never qualifies: an operator
    // like "site:" or a pasted address is something a person typed at Google, never anchor text.
    // A dictionary ask ("hyena in farsi") earns a translation line on its own page, never a body link:
    // routing a reader from one page to another to learn one word helps nobody and reads as spam.
    const q = (p.search?.topQueries ?? []).filter((q) => !/[:/@]|^https?/i.test(q.query)
      && !/\bin (farsi|persian|english)\b/i.test(q.query)
      && q.position != null && q.position >= NEAR_MISS_MIN
      && q.position <= NEAR_MISS_MAX && q.impressions >= MIN_IMPRESSIONS).sort((a, b) => b.impressions - a.impressions)[0];
    return q ? [{ page: p, query: q }] : [];
  }).sort((a, b) => b.query.impressions - a.query.impressions);
  const out: Draft[] = [];
  for (const from of strongest) {
    const links = linksByPage.get(canonicalUrlKey(from.url))!;
    const words = pageWords(from);
    // DOWNHILL ONLY. A link passes standing from the page that has it to the page that needs it, so the
    // source must out-earn the destination. Pointed the other way it asks the weaker page to lift the stronger one, which is the opposite of the change.
    // WHERE BOTH PAGES CARRY A JOB, the words on the link must be what the destination is FOR, and the two pages
    // must have something to do with each other. The regex above still throws out anything that is not anchor
    // text at all; the job check throws out a real search pointed at a page it does not belong on. A page with no
    // job answers "unknown", which passes, so nothing here narrows what this producer did before jobs existed.
    const belongs = (to: OwnedPageEvidence, anchor: string): boolean => {
      const verdict = linkFit(jobOf(jobs, to), jobOf(jobs, from), subjectWords(anchor, weak));
      return verdict === "fits" || verdict === "unknown";
    };
    const target = nearMiss.find((t) => t.page.url !== from.url && clicksOf(from) > clicksOf(t.page)
      && !links.has(pathOf(t.page.url).toLowerCase())
      && subjectWords(t.query.query, weak).some((w) => words.has(w))
      && belongs(t.page, t.query.query));
    if (!target) continue;
    const to = pathOf(target.page.url), position = target.query.position!.toFixed(1);
    out.push({
      page: from, slug: "internal_link", field: "section", query: target.query.query,
      headline: `Link ${pathOf(from.url)} to ${to} with the words "${target.query.query}"`, before: null,
      after: `Add one link in the body of ${pathOf(from.url)} pointing to ${to}, with the anchor text "${target.query.query}".`,
      why: `${labelOf(from)} at ${pathOf(from.url)} earns ${count(clicksOf(from), "click")} in 90 days and carries ${count(links.size, "internal link")}, not one of them to ${to}. That page earns ${count(clicksOf(target.page), "click")} and sits at position ${position} for "${target.query.query}" on ${count(target.query.impressions, "impression")} and ${count(target.query.clicks, "click")}. The link runs from the stronger page to the weaker one, which is the only direction that helps.`,
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

/** 4. THE THREE DEFECTS WORTH A SWEEP, ONE CARD PER PAGE. A card that fixes one page and then says "repeat on
 *  nine more" is not a change: it cannot be done in one sitting, marked done, or measured, and the nine never
 *  get their own numbers. Each of the busiest TOP_PAGES_PER_CLASS pages per defect gets its own card, its own
 *  figures and its own headline, and the class total rides along as context instead of as an instruction. */
function technicalCards(all: OwnedPageEvidence[], snapshot: EvidenceSnapshot): Draft[] {
  const impressions = (p: OwnedPageEvidence): number => p.search?.impressions90d ?? 0;
  const rank = (list: OwnedPageEvidence[]): OwnedPageEvidence[] =>
    [...list].sort((a, b) => impressions(b) - impressions(a) || pathOf(a.url).localeCompare(pathOf(b.url)));
  // ONE ROW PER PAGE, not per address that reaches it. The address a read landed on decides which is which, so retired slugs never accuse the page they forward to of duplicating itself.
  const byIdentity = new Map<string, OwnedPageEvidence>();
  for (const p of all) {
    const key = identityOf(p);
    if (!byIdentity.has(key) || canonicalUrlKey(p.url) === key) byIdentity.set(key, p);
  }
  const pages = [...byIdentity.values()];
  /** THE PAGES GOOGLE PUTS IN FRONT OF THIS PAGE'S BIGGEST SEARCH, when that search has been read. */
  const winnersAreStores = (p: OwnedPageEvidence): boolean => {
    const head = [...(p.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0]?.query;
    const row = head ? (snapshot.research?.serpEvidence ?? []).find((s) => canonicalQueryKey(s.query) === canonicalQueryKey(head)) : null;
    const shops = [...new Set((row?.organic ?? []).map((o) => domainOf(o.url)))].filter((d) => SHOP_DOMAIN.test(d));
    return shops.some((d) => STORE_FIRST.test(d)) || shops.length >= 2;
  };
  const out: Draft[] = [];
  const noMeta = rank(pages.filter((p) => !p.content?.metaDescription?.trim()));
  for (const p of noMeta.slice(0, TOP_PAGES_PER_CLASS)) out.push({
    page: p, slug: "missing_description", field: "meta", query: labelOf(p),
    headline: `Write the missing description on ${pathOf(p.url)} (Google is writing its own)`, before: null,
    after: "Write a description of about 150 characters that names this page's subject and the one answer it gives, and ends with a reason to click.",
    why: `${pathOf(p.url)} carries no description, so the line under its title in the results is Google's own writing. It earns ${count(impressions(p), "impression")} and ${count(clicksOf(p), "click")} in 90 days, so that line is read a lot.`,
    steps: [`Open the site editor on ${pathOf(p.url)}`, "Paste a description of about 150 characters",
      "Mark it done here and the click rate gets read again"],
    hints: [`${pathOf(p.url)} holds no description of its own`,
      `${pathOf(p.url)} earns ${count(impressions(p), "impression")} and ${count(clicksOf(p), "click")} in 90 days`,
      `${count(noMeta.length, "page")} with content stored carry no description`],
    minutes: 1, confidence: "medium",
    limitation: "Read off the last stored copy of this page, so a description added since that read is not counted here.",
  });

  // A TEMPLATED DESCRIPTION IS A MISSING ONE WEARING WORDS: strip each page's own name out of its meta and
  // what is left, when five or more pages share it, is one boilerplate line stamped across a template. One
  // card per top page by impressions, because the busiest page loses the most to a line that says nothing.
  const boilerplate = new Map<string, OwnedPageEvidence[]>();
  for (const p of pages) {
    const meta = (p.content?.metaDescription ?? "").trim().toLowerCase();
    if (!meta) continue;
    const own = new Set([...labelOf(p).toLowerCase().split(/[^a-z0-9]+/), ...pathOf(p.url).toLowerCase().split(/[^a-z0-9]+/)].filter((t) => t.length > 2));
    const skeleton = meta.split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !own.has(t)).join(" ");
    if (skeleton.length > 40) boilerplate.set(skeleton, [...(boilerplate.get(skeleton) ?? []), p]);
  }
  const templated = [...boilerplate.values()].filter((g) => g.length >= 5);
  for (const p of rank(templated.flat()).slice(0, 2)) {
    const family = templated.find((g) => g.includes(p))!.length;
    out.push({
      page: p, slug: "missing_description", field: "meta", query: labelOf(p), minutes: 3, confidence: "low",
      headline: `Write a real description on ${pathOf(p.url)}: ${family} pages share one templated line`, before: (p.content?.metaDescription ?? "").trim() || null,
      after: "Write a description of about 150 characters that says what only this page answers, and ends with a reason to click.",
      why: `${count(family, "page")} carry the same templated description with only the name swapped, and ${pathOf(p.url)} is the busiest of them at ${count(impressions(p), "impression")} in 90 days. A line every sibling repeats gives nobody a reason to click this one.`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, "Replace the templated description with one written for this page",
        "Mark it done here and the click rate gets read again"],
      hints: [`${count(family, "page")} share one templated description`],
      limitation: "Read off the last stored copy of each page, so a description rewritten since that read is not counted here.",
    });
  }

  const byH1 = new Map<string, OwnedPageEvidence[]>();
  for (const p of pages) { const h = (p.content?.h1 ?? "").trim().toLowerCase(); if (h) byH1.set(h, [...(byH1.get(h) ?? []), p]); }
  const dupes = [...byH1.values()].filter((g) => g.length > 1);
  for (const p of rank(dupes.flat()).slice(0, TOP_PAGES_PER_CLASS)) {
    const heading = plain(p.content?.h1), sharers = (byH1.get((p.content?.h1 ?? "").trim().toLowerCase())?.length ?? 1) - 1;
    out.push({
      page: p, slug: "duplicate_heading", field: "h1", query: labelOf(p),
      headline: `Give ${pathOf(p.url)} its own heading: ${sharers} other ${sharers === 1 ? "page shares" : "pages share"} it`,
      before: heading, after: "Rewrite this heading so it names what only this page covers.",
      why: `"${heading}" is the heading on ${count(sharers + 1, "page")} of this site, which asks Google to pick between them. ${pathOf(p.url)} earns ${count(impressions(p), "impression")} in 90 days, so it is the one to name first.`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, "Rewrite the heading so it names what only this page covers",
        "Mark it done here and the positions get read again"],
      hints: [`${pathOf(p.url)} and ${count(sharers, "other page")} carry the heading "${heading}"`,
        `${pathOf(p.url)} earns ${count(impressions(p), "impression")} in 90 days`,
        `${count(dupes.length, "heading")} are duplicated across this site`],
      minutes: 1, confidence: "medium",
      limitation: "Headings are compared exactly as stored, so two headings that differ only by a stray word read as separate here.",
    });
  }

  const thin = rank(pages.filter((p) => (p.content?.wordCount ?? 0) > 0 && (p.content?.wordCount ?? 0) < THIN_WORDS && impressions(p) > 0));
  for (const p of thin.slice(0, TOP_PAGES_PER_CLASS)) {
    // THE TARGET IS THE AUDIENCE. Three hundred words on a page shown thirty thousand times is still a stub; what a page at that size of search has to become is an article.
    const target = impressions(p) > HEAVY_IMPRESSIONS ? "800 to 1,200" : "200 to 300";
    const stores = winnersAreStores(p);
    const shopStep = "Add a product block or shop link above the fold; the pages winning this search are stores.";
    out.push({
      page: p, slug: "thin_page", field: "section", query: labelOf(p),
      headline: `Fill out ${pathOf(p.url)}: ${count(p.content?.wordCount ?? 0, "word")} on a page shown ${count(impressions(p), "time")}`,
      before: null,
      after: `Add ${target} words to ${pathOf(p.url)} that answer its main question, in short sections with their own headings.`,
      why: `${pathOf(p.url)} holds ${count(p.content?.wordCount ?? 0, "word")} and is still shown ${count(impressions(p), "time")} in 90 days, so people are being handed a page with almost nothing on it.`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, `Add ${target} words that answer the question the page title asks`,
        "Break them into short sections with their own headings", ...(stores ? [shopStep] : []),
        "Mark it done here and the impressions get read again"],
      hints: [`${pathOf(p.url)} holds ${count(p.content?.wordCount ?? 0, "word")} of copy`,
        `${pathOf(p.url)} is shown ${count(impressions(p), "time")} and earns ${count(clicksOf(p), "click")} in 90 days`,
        `${count(thin.length, "page")} of the ${pages.length} stored pages are under ${THIN_WORDS} words and are being shown in search`],
      minutes: 30, confidence: "medium",
      limitation: "Word count is read off the last stored copy of the page, so copy added since that read is not counted here.",
    });
  }
  return out;
}

/** How many pages one pass asks about. The call cache holds a few hundred rows for a whole account, so asking for
 *  a thousand would push every other cached reading out of it and pay for them all again. The busiest pages are the
 *  ones cards get minted for; every page past this bound keeps the word overlap it always had. */
const PAGE_JOBS_PER_PASS = 60;

/** What each page is FOR, busiest first, through the call cache: an unchanged page costs nothing and a re-crawled
 *  one is re-read on its own. A failure returns no jobs, which is what every producer below already handles. */
async function pageJobs(tenantId: string, pages: OwnedPageEvidence[]): Promise<Jobs> {
  const ranked = pages
    .filter((p) => { const path = pathOf(p.url); return path !== "/" && !STOREFRONT.test(path); })
    .sort((a, b) => (b.search?.impressions90d ?? 0) - (a.search?.impressions90d ?? 0) || clicksOf(b) - clicksOf(a))
    .slice(0, PAGE_JOBS_PER_PASS);
  return loadPageJobs(tenantId, ranked.map((p) => ({
    url: p.url, title: p.content?.title, h1: p.content?.h1,
    headings: p.content?.outline ?? [], wordCount: p.content?.wordCount ?? null,
  }))).catch(() => new Map<string, OwnedPageJob>());
}

/** Every extra card this account's stored evidence already supports, at `needs_review`, deduplicated against
 * the queue it already holds. Never throws: a source that will not read narrows the answer instead of failing
 * the pass. Every card is a proposal, never a live edit.
 */
export async function extraQueueCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date }): Promise<ExtraQueueRun> {
  const { tenantId, snapshot, now } = input;
  const pages = snapshot.ownedPages.filter((p) => !!p.content);
  // NOTHING TO READ IS NOT A FINISHED PASS. These producers rewrite their families in full, and the sweep
  // behind them only retires what a producer that FINISHED no longer stands behind, so a pass that never
  // looked at a single page says so instead of being read as "these families are empty now".
  if (pages.length === 0) return { cards: [], complete: false };
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  // WHAT THIS SITE PRINTS ON EVERY PAGE, and what is left once it is taken out: the words each page has actually earned the right to be asked about.
  const furniture = templateHeadings(pages.map((p) => p.content?.outline ?? []));
  const earned = new Map(pages.map((p) => [p.url, earnedWords(p, furniture)]));
  // How much of this site hangs UNDER each page: what makes one address a hub and another a leaf.
  const children = new Map(pages.map((p) => [pathOf(p.url),
    pages.filter((o) => o !== p && pathOf(o.url).startsWith(`${pathOf(p.url)}/`)).length]));
  // WHAT THIS ACCOUNT ALREADY HOLDS, so a card never supersedes a change the strict path drafted for the same
  // page and the same family. An unreadable queue emits nothing rather than writing over work it cannot see.
  // A ROW THIS PRODUCER MINTED ITSELF IS NOT SOMEBODY ELSE'S WORK: blocking on the family alone froze every card
  // it had ever written, so a sharper headline for the same page and the same defect never reached the store.
  // The ids it already owns are kept beside the families, and only a family held under ANOTHER id blocks.
  const store = await loadChangeProposals(tenantId).catch(() => null);
  if (!store) return { cards: [], complete: false };
  const rows = [...store.values()];
  const held = new Set(rows.map((p) => `${(p.pagePath ?? "").toLowerCase()}::${actionFamilyOf(p)}`));
  const mine = new Set(rows.map((p) => p.id));
  const jobs = await pageJobs(tenantId, pages);
  const drafts = [...aiAbsenceCards(snapshot, pages, weak, earned, children, jobs, tenantId),
    ...fanoutCards(snapshot, pages, weak, earned, children, jobs, tenantId),
    ...(await linkCards(tenantId, pages, weak, jobs)), ...technicalCards(pages, snapshot)];
  const out: ChangeProposal[] = [];
  // ONE QUESTION, ONE CARD. The answer an engine wrote and the follow-up search it ran to write it are the
  // same question, so two pages were being sent to answer it. The strongest reading is filed and the rest go.
  const answered = new Set<string>();
  for (const d of drafts) {
    const asks = d.asked ? [canonicalQueryKey(d.query), canonicalQueryKey(d.asked)].filter(Boolean) : [];
    if (asks.some((k) => answered.has(k))) continue;
    const card = mint(tenantId, d, now);
    const key = `${(card.pagePath ?? "").toLowerCase()}::${actionFamilyOf(card)}`;
    if (held.has(key) && !mine.has(card.id)) continue;
    held.add(key);
    for (const k of asks) answered.add(k);
    out.push(card);
  }
  return { cards: out, complete: true };
}
