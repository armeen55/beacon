/** A FAN-OUT IS EVIDENCE, NEVER A PAGE TOPIC. The engine's own follow-up search is a trace of how it went looking, not a subject anybody asked to read about, and turning one straight into a section shipped "Add a section on Encyclopaedia Iranica Persian literature Ferdowsi Hafez Saadi Rumi Nezami": a search trace printed as a heading. Content may be authorized off a fan-out only once it is tied to its parent prompt, intent-clustered, checked against the confirmed business scope, matched to a page whose job actually fits, checked against what that page already answers and compared with the shape that wins it, and none of that is a word-overlap count. Until every one of those exists, a fan-out stays internal evidence and mints nothing. THE PRODUCER IS DELETED, not flagged off, and its family stays in the sweep below so the cards it already wrote withdraw themselves. */
/** decision/producers/extra: THREE MORE WAYS THE QUEUE FILLS ITSELF, all off evidence this account already paid for. Every card is minted from stored rows (the stored AI answers, page snapshots and link graph) and every number on one traces back to a row. The strict path and suggested-edits are untouched; these land beside them at `needs_review`. Every card carries what is riding on it: the audience its page is shown to, and the clicks its page is measurably leaving behind wherever its own search rows can say so. THE ONE THING THIS PASS BUYS is a page reading (producers/page-job.ts): one durable sentence saying what a page is FOR, held per page and re-read only when that page changes. It decides WHERE a card lands, and for a card carrying a subject from elsewhere onto a page it decides WHETHER one exists at all: a page nobody has read holds its card and lands on this pass's receipt instead of taking a guess. WHAT IS NOT HERE: a schema card. The stored results pages carry organic rows, AI Overview references, follow-up questions and related searches and NO rich-result flag, so "the winners show an FAQ result and this page has none" is a claim this evidence cannot support. Skipped rather than guessed. ONE CARD PER PAGE PER CHANGE FAMILY: the store files a change under (page, family) and a save SUPERSEDES whatever held it, so every candidate is checked against the queue on file AND against this pass's own. */
import "server-only";
import { getRepository } from "@/lib/persistence/repositories";
import { log } from "@/lib/logger";
import { canonicalQueryKey, domainOf, templateHeadings, topicTokens } from "@/domains/evidence/relevance-gate";
import { citesOwnSite } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot, type OwnedPageEvidence, type OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { defaultExpectedCtrAt, type TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { actionFamilyOf, loadChangeProposals } from "../proposal-store";
import { linkFit, pageUnderstanding, sectionFit } from "./page-job";
/** What this producer did, whether it FINISHED, and what it refused to guess at. `complete` is true only when the queue on file was read AND every source these producers judge on answered: "none this pass" and "I could not look" are the same length and opposite facts, and the sweep behind this producer withdraws every card in a family it believes was rewritten in full. `families` names the ones that DID finish, so a dead source holds only its own out of that sweep. `held` puts refusals on the receipt. */
type ExtraQueueRun = { cards: ChangeProposal[]; complete: boolean; families: string[]; held: { pageUrl: string; reason: string }[]; needsOwnPage: { query: string; refusedPages?: string[] }[] };

/** `headline` IS the card's action line: it names the page, the thing to do and the number behind it, so the queue reads as work without being opened. Never "update the section to sharpen it", which says nothing. */
type Draft = { page: OwnedPageEvidence; slug: string; field: "meta" | "h1" | "section"; headline: string;
  query: string; before: string | null; after: string; why: string; steps: string[]; hints: string[];
  minutes: number; confidence: ChangeProposal["confidence"]; limitation: string;
  /** HOW MANY STORED ROWS ARE BEHIND THIS CARD, which used to be the hint count: three on every card this file writes, on three stored answers or thirty. `impact` is the clicks this page is measurably leaving behind. */
  refs: number; impact?: number | null;
  /** The question this card came out of. ONE QUESTION, ONE CARD: an answer and the follow-up search an engine ran while writing it are the same question, so the strongest of them is the only one filed. */
  asked?: string;
  /** THIS PRODUCER WROTE A BRIEF, NOT THE COPY. Said by the one that knows, instead of guessed back out of the sentence downstream by a verb list. The editor clears it when it lands real copy. */
  brief?: true };

/** A page worth linking to sits inside striking distance and is genuinely being seen; under THIN_WORDS a page is a stub to a reader and to Google. TOP_PAGES_PER_CLASS pages per defect get a card, one page at a time. */
const MAX_PER_PRODUCER = 5, NEAR_MISS_MIN = 4, NEAR_MISS_MAX = 15, MIN_IMPRESSIONS = 30, THIN_WORDS = 200, TOP_PAGES_PER_CLASS = 3;
/** A page shown HEAVY_IMPRESSIONS often is a page to write, not a stub to fill. MIN_EARNED_OVERLAP is the words of a page's own tie to a search, past the site wide ones, before it may be asked to answer it, and past MAX_HEADING_WORDS a heading is a paragraph wrapped in a heading tag, saying nothing about what it answers. */
const HEAVY_IMPRESSIONS = 5_000, MIN_EARNED_OVERLAP = 2, MAX_HEADING_WORDS = 12;
/** THE PAGES AN ESSAY NEVER GOES ON: the home page, and the shop rails. A storefront answers with products, so "add a section answering this question" there is work nobody would ever publish. */
const STOREFRONT = /(^|[/-])(explore|shop|store|categor(y|ies)|collections?|product|cart|checkout)([/-]|$)/i;
/** A search asking WHICH SITES cover something wants a directory, and no page of this account is the answer to it. A question where somebody DESCRIBES THEMSELVES is their own situation, not a search. */
const META_QUESTION = /\b(web ?sites?|sites?|blogs?)\b/i;
const PERSONAL = /\b(i'm|im|i am|i've|myself|my)\b/i;
const askable = (q: string): boolean => !META_QUESTION.test(q) && !PERSONAL.test(q);
/** Results led by places that sell. A page losing to these loses on having nothing to buy on it. */
const SHOP_DOMAIN = /(^|\.)(amazon|etsy|ebay|aliexpress|walmart|redbubble|teepublic|zazzle|temu|wayfair|shop)\./i;
const STORE_FIRST = /(^|\.)(amazon|etsy)\./i;

/** A LINK IS WRITTEN AS A PATH, NOT AN ADDRESS. "https://" + "/persian-male-names" is "https:///persian-male-names",
 *  which the URL parser reads as the HOST "persian-male-names" and the path "/", so every relative link on a page
 *  collapsed to one entry: a page with seventy-six internal links read as a page linking to exactly one, no
 *  existing link was ever found, and this file told the operator to add links that were already there. */
const pathOf = (url: string): string => {
  if (url.startsWith("/")) return url.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
/** Words carried in from an engine, a publisher or a title, made safe to paste: no dash Beacon never writes,  no bracket that reads as a blank somebody forgot to fill in. */
const plain = (s: string | null | undefined): string => (s ?? "").replace(/[–—]/g, ", ").replace(/[[\]{}]/g, " ").replace(/\s+/g, " ").trim();
const labelOf = (p: OwnedPageEvidence): string => plain(p.content?.h1 ?? p.content?.title ?? pathOf(p.url)) || pathOf(p.url);
const clicksOf = (p: OwnedPageEvidence): number => p.search?.clicks90d ?? 0;
const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The words a page can be judged on without paying for a body read: its title, its heading and its outline. THE ACCOUNT'S OWN UBIQUITOUS VOCABULARY COMES OUT OF BOTH SIDES: a word this site prints on nearly every page is a word every page shares, and left in here it let a question tie to a page on the site's whole subject. */
const pageWords = (p: OwnedPageEvidence, weak: ReadonlySet<string>): Set<string> => new Set(topicTokens([p.content?.title, p.content?.h1, ...(p.content?.outline ?? []), pathOf(p.url).replace(/[-/]/g, " ")].filter(Boolean).join(" ")).filter((t) => !weak.has(t)));
const flat = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
/** THE WORDS A PAGE HAS EARNED THE RIGHT TO BE ASKED ABOUT: its title, heading and section headings. Furniture, paragraphs in a heading tag and its own FAQ questions are none of those: a question a page ASKS is not one it covers. */
const earnedWords = (p: OwnedPageEvidence, furniture: ReadonlySet<string>, weak: ReadonlySet<string>): Set<string> =>
  new Set(topicTokens([p.content?.title, p.content?.h1, ...(p.content?.outline ?? []).filter((h) => !furniture.has(flat(h))
    && !h.trim().endsWith("?") && h.trim().split(/\s+/).length <= MAX_HEADING_WORDS)].filter(Boolean).join(" ")).filter((t) => !weak.has(t)));
/** ONE PAGE, WHATEVER SPELLING ASKED FOR IT: the address the read landed on, else the address the page names as its own, else the address asked for. Three retired slugs forwarding to one product are ONE page. */
const identityOf = (p: OwnedPageEvidence): string =>
  canonicalUrlKey(p.content?.finalUrl || p.content?.canonicalUrl || p.url);

/** The words of a question that carry its subject: a site wide word this account puts on everything proves no  connection at all, so it never makes a page look like the answer to anything. */
const subjectWords = (text: string, weak: ReadonlySet<string>): string[] => [...new Set(topicTokens(text))].filter((t) => t.length > 2 && !weak.has(t));

/** Matching runs on stems and an operator must never be told to write "persepoli", so every stem is handed  back the word it was cut from, spelled as the search spelled it. */
const asWritten = (text: string, stems: readonly string[]): string[] => {
  const words = plain(text).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean);
  return stems.map((s) => words.find((w) => topicTokens(w).includes(s)) ?? s); };

type Match = { page: OwnedPageEvidence; hits: string[]; missing: string[] };
/** WHERE A REAL SEARCH BELONGS. `fits` names the page. `needs_own_page` means pages shared the words and every one is FOR something else, a routing fact only the coverage path acts on. `held` means the best page for it has never been read, so the work is research and not a card. `no_candidate` is silence. */
type Fit = { match: Match | null; verdict: "fits" | "needs_own_page" | "no_candidate" | "held"; reason?: string; refused?: string[] };
/** WHAT A MISSING READING LICENSES: NOTHING. Two shared words are evidence a page exists, not that it owns a subject: no reading, no admission, and the card waits with its reason named. */
type Understanding = Awaited<ReturnType<typeof pageUnderstanding>>;
/** The page of this account's own that best answers a question, or null when nothing comes close. Two subject words is the floor: one shared word is a coincidence, not coverage. THE HOME PAGE AND THE SHOP RAILS ARE NEVER IT, nor is a page tied to the question only by furniture. THE READING DECIDES, best candidate first. */
async function bestPageFor(text: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
  earned: ReadonlyMap<string, Set<string>>, children: ReadonlyMap<string, number>, u: Understanding): Promise<Fit> {
  const words = subjectWords(text, weak);
  if (words.length < 2) return { match: null, verdict: "no_candidate" };
  // THE HUB, NOT THE BUSIEST LEAF: of two pages tied on the same words, the one the rest of the subject hangs under is where a whole-subject answer belongs.
  const rankOf = (p: OwnedPageEvidence): [number, number] => [children.get(pathOf(p.url)) ?? 0, clicksOf(p)];
  const beats = (a: OwnedPageEvidence, b: OwnedPageEvidence): boolean => {
    const [ac, ak] = rankOf(a), [bc, bk] = rankOf(b); return ac !== bc ? ac > bc : ak > bk; };
  const ranked: Match[] = [];
  for (const page of pages) {
    const path = pathOf(page.url), own = earned.get(page.url);
    if (path === "/" || STOREFRONT.test(path) || !own || words.filter((w) => own.has(w)).length < MIN_EARNED_OVERLAP) continue;
    const has = pageWords(page, weak), hits = words.filter((w) => has.has(w));
    if (hits.length >= 2) ranked.push({ page, hits, missing: words.filter((w) => !has.has(w)) });
  }
  ranked.sort((a, b) => b.hits.length - a.hits.length || (beats(a.page, b.page) ? -1 : beats(b.page, a.page) ? 1 : 0));
  const refusedPaths: string[] = [];
  let held: Fit | null = null;
  // THE READING IS BOUGHT AT MINTING TIME for the page a card would actually land on, so "nobody asked" is rare.
  for (const m of ranked) {
    const { job, reason } = await u.of(m.page);
    if (!job) { held ??= { match: m, verdict: "held", reason }; continue; }
    if (sectionFit(job, words, u.corpus, text) === "fits") return { match: m, verdict: "fits" };
    refusedPaths.push(pathOf(m.page.url));
  }
  return held ?? (refusedPaths.length > 0 ? { match: null, verdict: "needs_own_page", refused: refusedPaths } : { match: null, verdict: "no_candidate" });
}

/** A search whose words this account shares but whose subject no page of it is FOR. The coverage path decides whether a page should exist, so this is a line in the log and never a card. */
const noteNeedsOwnPage = (tenantId: string, text: string, bank?: { query: string; refusedPages?: string[] }[], refused?: string[]): void => {
  log.info("[extra] no page of this account is for this search", { tenantId, query: text.slice(0, 120) });
  bank?.push({ query: text, ...(refused?.length ? { refusedPages: refused } : {}) }); };

/** WHAT THIS PAGE IS LEAVING BEHIND at the position it holds: at its biggest search, the clicks pages at that position usually earn against the clicks it earns. The only figure on these cards that is a recovery and not an audience, so it MUST be held to the same bar the strict path uses: on the industry table this account's own position 1 read as 28 percent against the 1.34 it truly earns, sizing one extras card at 6,600 clicks where the opportunity path scored 539 on identical rows. The caller threads the fitted curve; the industry table is only the fallback. NULL, never zero, with no row worth reading or a page already earning its share. */
function recoverableClicks(p: OwnedPageEvidence, expectedCtrAt: (position: number) => number): number | null {
  const q = [...(p.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0];
  if (!q || q.position == null || q.impressions < MIN_IMPRESSIONS) return null;
  const n = Math.round((expectedCtrAt(q.position) - Math.min(1, q.clicks / Math.max(1, q.impressions))) * q.impressions);
  return n > 0 ? n : null;
}

/** ONE card, in the ONE shape the store files and every surface renders. */
function mint(tenantId: string, d: Draft, now: Date): ChangeProposal {
  const path = pathOf(d.page.url);
  return {
    id: `${tenantId}::${path.toLowerCase()}::existing_edit::${d.slug}`, tenantId, kind: "existing_edit",
    pagePath: path, pageUrl: d.page.url, pageLabel: labelOf(d.page), primaryQuery: d.query,
    opportunityType: d.headline, changeFamily: d.field, status: "needs_review",
    recommendedChange: { kind: "existing_edit", field: d.field, before: d.before, after: d.after },
    ...(d.brief ? { researchOnly: true as const } : {}),
    whyItMatters: d.why, operatorSteps: d.steps, estimatedEffortMinutes: d.minutes, riskLevel: "low",
    confidence: d.confidence, limitations: [d.limitation],
    // WHAT IS ON THE CARD, NEVER WHAT WAS CONSULTED TO WRITE IT: the link card counted every page whose stored link graph it read and claimed 224 pieces of evidence behind four sentences.
    evidence: { query: d.query, hints: d.hints, evidenceRefCount: Math.max(1, Math.min(Math.round(d.refs), d.hints.length)) },
    // WHAT IS RIDING ON IT, off this page's own rows: the clicks it is measurably leaving behind, and the audience it is shown to. Either one absent stays null, never a zero the ranking would believe.
    impactScore: d.impact ?? null, upsidePerMonth: null, demandImpressions90d: d.page.search?.impressions90d ?? null,
    publish: "manual", createdAt: now.toISOString(),
  };
}

/** 1. THE ANSWERS THAT CREDIT SOMEBODY ELSE, grouped by the question they answered. Recurrence across answers is the claim, so the question the most answers skipped comes first. */
async function aiAbsenceCards(bank: { query: string; refusedPages?: string[] }[], snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
  earned: ReadonlyMap<string, Set<string>>, children: ReadonlyMap<string, number>, u: Understanding, tenantId: string): Promise<Draft[]> {
  const site = (snapshot.scope.site ?? "").replace(/^www\./, "").toLowerCase();
  if (!site) return [];
  // "NEVER YOU" IS A CLAIM ABOUT EVERY ANSWER, SO IT IS COUNTED OVER EVERY ANSWER. Answers that DID credit this
  // site were dropped on the way in, and the sentence then said "across 47 stored answers and never name this
  // site" using a total built only from the answers that had already failed the test: a card told an operator a
  // page was never cited on a day the same stored rows credited the site in 31 of 47. Every answer that reported
  // its sources is counted here, the ones crediting this site are counted SEPARATELY through the one canonical
  // predicate every reading of this fact now uses, and one of those is enough to retire the whole claim.
  type Group = { prompt: string; answers: number; credited: number; engines: Set<string>; domains: Map<string, { n: number; url: string; title: string; engine: string }> };
  const byPrompt = new Map<string, Group>();
  for (const o of snapshot.research.aiObservations) {
    const cites = o.citations ?? [];
    if (cites.length === 0) continue;
    const key = canonicalQueryKey(o.promptText), g = byPrompt.get(key) ?? { prompt: plain(o.promptText), answers: 0, credited: 0, engines: new Set<string>(), domains: new Map() };
    g.answers += 1; g.engines.add(o.engine);
    byPrompt.set(key, g);
    if (citesOwnSite(cites, site)) { g.credited += 1; continue; }
    for (const c of new Map(cites.map((c) => [c.domain, c])).values()) {
      const d = g.domains.get(c.domain) ?? { n: 0, url: c.url.split("?")[0] ?? c.url, title: plain(c.title) || c.domain, engine: o.engine };
      d.n += 1; g.domains.set(c.domain, d);
    }
  }
  const out: Draft[] = [];
  for (const g of [...byPrompt.values()].sort((a, b) => b.answers - a.answers || b.engines.size - a.engines.size || a.prompt.localeCompare(b.prompt))) {
    if (!askable(g.prompt) || g.credited > 0) continue;
    const fit = await bestPageFor(g.prompt, pages, weak, earned, children, u);
    if (fit.verdict === "needs_own_page") noteNeedsOwnPage(tenantId, g.prompt, bank, fit.refused);
    if (fit.verdict === "held") { u.hold(fit.match!.page.url, `${fit.reason} for "${g.prompt}"`); continue; }
    const match = fit.match;
    const top = [...g.domains.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
    if (!match || !top) continue;
    const [domain, cite] = top;
    const engines = [...g.engines].sort().join(", "), covers = asWritten(g.prompt, match.hits).join(", ");
    out.push({
      page: match.page, slug: "ai_answer_gap", field: "section", query: g.prompt, asked: g.prompt, brief: true,
      headline: `AI answers cite ${domain} for "${g.prompt}" and never you; answer it on ${pathOf(match.page.url)}`, before: null,
      after: `Add a short section that answers "${g.prompt}" outright: the answer in the first two sentences, then the specifics only this page has, under a heading a reader would search for.`,
      why: `AI answers for "${g.prompt}" cite ${domain} on ${count(cite.n, "answer")} and never name this site, across ${count(g.answers, "stored answer")} from ${engines}. The page they cite is ${cite.url}. ${labelOf(match.page)} at ${pathOf(match.page.url)} already covers ${covers}, so a section that answers the question outright is the cheapest way into that answer.`,
      steps: [`Open the site editor on ${pathOf(match.page.url)}`, `Add a section that answers "${g.prompt}"`,
        "Put the answer in the first two sentences, before any background", "Mark it done here and the next answers get checked against it"],
      hints: [`${cite.engine} cited ${cite.url} ("${cite.title}") when answering "${g.prompt}"`,
        `${count(g.answers, "stored answer")} to this question from ${engines} credited other sites and none credited this one`,
        `Cited domains on this question: ${[...g.domains.keys()].slice(0, 5).join(", ")}`],
      // Every stored answer to this question is one row this card stands on, and there are as many as there are.
      minutes: 30, confidence: g.answers >= 3 ? "medium" : "low", refs: g.answers,
      limitation: "This is read off the answers already stored for this question, not off a fresh answer bought today, and no rewrite guarantees a citation.",
    });
    if (out.length >= MAX_PER_PRODUCER) break;
  }
  return out;
}

/** 2. THE LINKS THE STRONGEST PAGES NEVER PASS ON: the three pages that earn the most clicks, and the near miss pages they never link to. Off the stored link graph, so the absence of a link is a fact here. */
async function linkCards(tenantId: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>, u: Understanding): Promise<{ drafts: Draft[]; complete: boolean }> {
  // A READ THAT THREW IS NOT A SITE WITH NO LINKS. Swallowed, it returned the same empty list as a linkless site, this producer still reported FINISHED, and the sweep then withdrew every internal_link card on file for a database blip. The failure is carried out instead of flattened.
  const graphs = await getRepository().forTenant(tenantId).getPageSnapshotLinkGraphs().catch(() => null);
  if (graphs == null) return { drafts: [], complete: false };
  if (graphs.length === 0) return { drafts: [], complete: true };
  const linksByPage = new Map<string, Set<string>>();
  for (const g of graphs) {
    const key = canonicalUrlKey(g.url);
    if (!linksByPage.has(key)) linksByPage.set(key, new Set(g.internal_links.map((l) => pathOf(l.href).toLowerCase())));
  }
  // WHAT EACH PAGE IS HELD UP BY, off the same graph: how many pages point at it today. That is the link's purpose said as a number the operator can check, rather than as link equity.
  const inbound = new Map<string, number>();
  for (const links of linksByPage.values()) for (const to of links) inbound.set(to, (inbound.get(to) ?? 0) + 1);
  const strongest = pages.filter((p) => linksByPage.has(canonicalUrlKey(p.url)) && clicksOf(p) > 0).sort((a, b) => clicksOf(b) - clicksOf(a)).slice(0, 3);
  const nearMiss = pages.flatMap((p) => {
    // THE SEARCH BECOMES THE WORDS ON THE LINK, so a search that is not words never qualifies: an operator like "site:" is never anchor text, and a dictionary ask ("hyena in farsi") earns a line on its own page.
    const q = (p.search?.topQueries ?? []).filter((q) => !/[:/@]|^https?/i.test(q.query)
      && !/\bin (farsi|persian|english)\b/i.test(q.query) && q.position != null && q.position >= NEAR_MISS_MIN
      && q.position <= NEAR_MISS_MAX && q.impressions >= MIN_IMPRESSIONS).sort((a, b) => b.impressions - a.impressions)[0];
    return q ? [{ page: p, query: q }] : [];
  }).sort((a, b) => b.query.impressions - a.query.impressions);
  const out: Draft[] = [];
  for (const from of strongest) {
    const links = linksByPage.get(canonicalUrlKey(from.url))!;
    const words = pageWords(from, weak);
    // DOWNHILL ONLY: the source must out-earn the destination, or the link asks the weaker page to lift the stronger one. THE WORDS ON THE LINK MUST BE WHAT THE DESTINATION IS FOR, and BOTH ENDS MUST BE READ AND SAY FITS: an unread pair, or an unsettled verdict, holds the card with its reason.
    const belongs = async (to: OwnedPageEvidence, anchor: string): Promise<boolean> => {
      const [dest, src] = [await u.of(to), await u.of(from)];
      for (const [page, read] of [[to, dest], [from, src]] as const) {
        if (!read.job) { u.hold(page.url, `${read.reason} for the link "${anchor}"`); return false; } }
      return linkFit(dest.job, src.job, subjectWords(anchor, weak), u.corpus) === "fits"; };
    let target: { page: OwnedPageEvidence; query: OwnedQuerySignal } | undefined;
    for (const t of nearMiss) {
      if (t.page.url === from.url || clicksOf(from) <= clicksOf(t.page)
        || links.has(pathOf(t.page.url).toLowerCase())
        || !subjectWords(t.query.query, weak).some((w) => words.has(w))) continue;
      if (await belongs(t.page, t.query.query)) { target = t; break; }
    }
    if (!target) continue;
    const to = pathOf(target.page.url), position = target.query.position!.toFixed(1);
    const held = inbound.get(to.toLowerCase()) ?? 0, support = held === 0 ? `No page of this site links to ${to} at all today`
      : `Only ${count(held, "page")} of this site ${held === 1 ? "links" : "link"} to ${to} today`;
    out.push({
      page: from, slug: "internal_link", field: "section", query: target.query.query, brief: true,
      headline: `Link ${pathOf(from.url)} to ${to} with the words "${target.query.query}"`, before: null,
      after: `Add one link in the body of ${pathOf(from.url)} pointing to ${to}, with the anchor text "${target.query.query}".`,
      // THE LINK'S PURPOSE, OFF THE STORED GRAPH: what holds the destination up today, what the words on it tell Google that page is for, and why this source page is the one being asked to give it.
      why: `${support}, and it sits at position ${position} for "${target.query.query}" on ${count(target.query.impressions, "impression")} and ${count(target.query.clicks, "click")}. Adding it puts the words of that search on a link pointing at the page that already ranks for it. ${labelOf(from)} at ${pathOf(from.url)} earns ${count(clicksOf(from), "click")} in 90 days against that page's ${count(clicksOf(target.page), "click")} and already links to ${count(links.size, "page")} of this site, not one of them ${to}, so the help runs from the page that can spare it to the page that needs it.`,
      steps: [`Open the site editor on ${pathOf(from.url)}`, `Add a link to ${to} inside the body copy, not the menu`,
        `Use "${target.query.query}" as the anchor text`, "Mark it done here and the position gets read again"],
      hints: [`${pathOf(from.url)} links to ${count(links.size, "page")} of this site and none of them is ${to}`,
        `${support}, counted across every page of this site read so far`,
        `${to} ranks at position ${position} for "${target.query.query}" with ${count(target.query.impressions, "impression")} in Search Console`,
        `${pathOf(from.url)} earns ${count(clicksOf(from), "click")} in the last 90 days`],
      // Every page whose stored link graph was read for the counts above, plus the destination's own search row.
      minutes: 5, confidence: "medium", refs: linksByPage.size + 1,
      limitation: "The link list comes from the last stored read of this page, so a link added since then is not counted here.",
    });
    if (out.length >= MAX_PER_PRODUCER) break;
  }
  return { drafts: out, complete: true };
}

/** 3. THE THREE DEFECTS WORTH A SWEEP, ONE CARD PER PAGE. A card that fixes one page and then says "repeat on nine more" cannot be done in one sitting, marked done, or measured, so each of the busiest TOP_PAGES_PER_CLASS pages per defect gets its own card and figures and the class total rides along as context. */
function technicalCards(all: OwnedPageEvidence[], snapshot: EvidenceSnapshot, expectedCtrAt: (position: number) => number): Draft[] {
  const impressions = (p: OwnedPageEvidence): number => p.search?.impressions90d ?? 0;
  const rank = (list: OwnedPageEvidence[]): OwnedPageEvidence[] => [...list].sort((a, b) => impressions(b) - impressions(a) || pathOf(a.url).localeCompare(pathOf(b.url)));
  // ONE ROW PER PAGE, not per address that reaches it. The address a read landed on decides which is which, so retired slugs never accuse the page they forward to of duplicating itself.
  const byIdentity = new Map<string, OwnedPageEvidence>();
  for (const p of all) { const key = identityOf(p); if (!byIdentity.has(key) || canonicalUrlKey(p.url) === key) byIdentity.set(key, p); }
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
    page: p, slug: "missing_description", field: "meta", query: labelOf(p), brief: true,
    headline: `Write the missing description on ${pathOf(p.url)} (Google is writing its own)`, before: null,
    after: "Write a description of about 150 characters that names this page's subject and the one answer it gives, and ends with a reason to click.",
    // A COUNT IS NOT AN ARGUMENT UNTIL IT IS BIG ENOUGH TO BE ONE. "3 views in 90 days, so that line is read a lot" was printed on a live card: the sentence was welded to the figure and stayed true only while the figure was large. It says what the figure actually shows now, and a small one says it is small.
    why: `${pathOf(p.url)} carries no description, so the line under its title in the results is Google's own writing. It was shown ${count(impressions(p), "time")} and earned ${count(clicksOf(p), "click")} in 90 days, ${impressions(p) >= 1000 ? "so that line is read a lot" : "so it is a small page today and this is a small fix"}.`,
    steps: [`Open the site editor on ${pathOf(p.url)}`, "Paste a description of about 150 characters",
      "Mark it done here and the click rate gets read again"],
    hints: [`${pathOf(p.url)} holds no description of its own`,
      `${pathOf(p.url)} earns ${count(impressions(p), "impression")} and ${count(clicksOf(p), "click")} in 90 days`,
      `${count(noMeta.length, "page")} with content stored carry no description`],
    minutes: 1, confidence: "medium", refs: 2, impact: recoverableClicks(p, expectedCtrAt),
    limitation: "Read off the last stored copy of this page, so a description added since that read is not counted here.",
  });

  // A TEMPLATED DESCRIPTION IS A MISSING ONE WEARING WORDS: strip each page's own name out of its meta and what is left, when five or more pages share it, is one boilerplate line stamped across a template. Busiest first.
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
      page: p, slug: "missing_description", field: "meta", query: labelOf(p), brief: true, minutes: 3, confidence: "low", refs: family, impact: recoverableClicks(p, expectedCtrAt),
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
      minutes: 1, confidence: "medium", refs: sharers + 1, impact: recoverableClicks(p, expectedCtrAt),
      limitation: "Headings are compared exactly as stored, so two headings that differ only by a stray word read as separate here.",
    });
  }

  // A THIN CARD MUST CARRY THE EARNED SHAPE, not a word count. With no stored results page for this page's biggest search there is no outline to hand over, and "add 1,200 words" is a risk dressed as advice.
  const winnersOnFile = (p: OwnedPageEvidence): boolean => {
    const head = [...(p.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0]?.query;
    return head != null && (snapshot.research?.serpEvidence ?? []).some((s) => canonicalQueryKey(s.query) === canonicalQueryKey(head) && (s.organic ?? []).length > 0);
  };
  const thin = rank(pages.filter((p) => (p.content?.wordCount ?? 0) > 0 && (p.content?.wordCount ?? 0) < THIN_WORDS && impressions(p) > 0 && winnersOnFile(p)));
  for (const p of thin.slice(0, TOP_PAGES_PER_CLASS)) {
    // THE TARGET IS THE AUDIENCE. Three hundred words on a page shown thirty thousand times is still a stub; what a page at that size of search has to become is an article.
    const target = impressions(p) > HEAVY_IMPRESSIONS ? "800 to 1,200" : "200 to 300";
    const stores = winnersAreStores(p);
    const shopStep = "Add a product block or shop link above the fold; the pages winning this search are stores.";
    out.push({
      page: p, slug: "thin_page", field: "section", query: labelOf(p), brief: true,
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
      // This page's stored copy, its search row, and the stored results page the shape came from.
      minutes: 30, confidence: "medium", refs: 3, impact: recoverableClicks(p, expectedCtrAt),
      limitation: "Word count is read off the last stored copy of the page, so copy added since that read is not counted here.",
    });
  }
  return out;
}

/** Every extra card this account's stored evidence already supports, at `needs_review`, deduplicated against the queue it holds. Never throws: a source that will not read narrows the answer instead of failing the pass. */
export async function extraQueueCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date;
  /** THE BAR THIS ACCOUNT'S OWN SEARCHES ARE HELD TO, threaded from the pass that fitted it. Absent falls back to the industry table, a far more generous bar, so a caller that can fit one should. */
  curve?: Pick<TenantCtrCurve, "expectedCtrAt"> }): Promise<ExtraQueueRun> {
  const { tenantId, snapshot, now } = input;
  const expectedCtrAt = input.curve?.expectedCtrAt ?? defaultExpectedCtrAt;
  // WHICH SOURCE EACH FAMILY IS JUDGED ON. The two answer producers read stored AI answers and nothing else, so an answer read that failed must not let the sweep retire their cards as ones nobody re-emitted.
  const answersRead = snapshot.sources.some((s) => s.source === "native_ai" && s.status === "fresh");
  const DEFECTS = ["missing_description", "duplicate_heading", "thin_page"];
  const pages = snapshot.ownedPages.filter((p) => !!p.content);
  // NOTHING TO READ IS NOT A FINISHED PASS. These producers rewrite their families in full and the sweep behind them retires only what a FINISHED producer no longer stands behind, so a pass that read nothing says so.
  if (pages.length === 0) return { cards: [], complete: false, families: [], held: [], needsOwnPage: [] };
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  // WHAT THIS SITE PRINTS ON EVERY PAGE, and what is left once it is taken out: the words each page has actually earned the right to be asked about.
  const furniture = templateHeadings(pages.map((p) => p.content?.outline ?? []));
  const earned = new Map(pages.map((p) => [p.url, earnedWords(p, furniture, weak)]));
  // How much of this site hangs UNDER each page: what makes one address a hub and another a leaf.
  const children = new Map(pages.map((p) => [pathOf(p.url), pages.filter((o) => o !== p && pathOf(o.url).startsWith(`${pathOf(p.url)}/`)).length]));
  // WHAT THIS ACCOUNT ALREADY HOLDS, so a card never supersedes a change the strict path drafted for the same page and family, and an unreadable queue emits nothing rather than writing over work it cannot see. A ROW THIS PRODUCER MINTED ITSELF IS NOT SOMEBODY ELSE'S WORK: only a family held under ANOTHER id blocks.
  const store = await loadChangeProposals(tenantId).catch(() => null);
  if (!store) return { cards: [], complete: false, families: [], held: [], needsOwnPage: [] };
  const rows = [...store.values()];
  const taken = new Set(rows.map((p) => `${(p.pagePath ?? "").toLowerCase()}::${actionFamilyOf(p)}`));
  const mine = new Set(rows.map((p) => p.id));
  // WHAT AN ESSAY MAY NEVER LAND ON is this file's rule, so this file decides which pages are worth reading.
  const eligible = pages.filter((p) => { const path = pathOf(p.url); return path !== "/" && !STOREFRONT.test(path); });
  const u = await pageUnderstanding(tenantId, eligible, { now, openPaths: new Set(rows.map((p) => (p.pagePath ?? "").toLowerCase())) });
  const bank: { query: string; refusedPages?: string[] }[] = [];
  const links = await linkCards(tenantId, pages, weak, u);
  const drafts = [...(await aiAbsenceCards(bank, snapshot, pages, weak, earned, children, u, tenantId)),
    ...links.drafts, ...technicalCards(pages, snapshot, expectedCtrAt)];
  const out: ChangeProposal[] = [];
  // ONE QUESTION, ONE CARD: the answer an engine wrote and the follow-up search it ran to write it are one question, so only the strongest reading of it is filed.
  const answered = new Set<string>();
  for (const d of drafts) {
    const asks = d.asked ? [canonicalQueryKey(d.query), canonicalQueryKey(d.asked)].filter(Boolean) : [];
    if (asks.some((k) => answered.has(k))) continue;
    const card = mint(tenantId, d, now), key = `${(card.pagePath ?? "").toLowerCase()}::${actionFamilyOf(card)}`;
    if (taken.has(key) && !mine.has(card.id)) continue;
    taken.add(key);
    for (const k of asks) answered.add(k);
    out.push(card);
  }
  // EACH FAMILY ANSWERS FOR ITS OWN SOURCE. A family whose evidence did not answer is left off this list, so the sweep behind this producer leaves its cards alone instead of retiring work nobody was able to re-read.
  // `engine_followup` stays in the sweep with NO producer behind it on purpose: it is the one family this pass
  // still owns and deliberately never emits, so the sweep withdraws every follow-up-search card already on file.
  const families = [...(answersRead ? ["ai_answer_gap", "engine_followup"] : []), ...(links.complete ? ["internal_link"] : []), ...DEFECTS];
  if (families.length < DEFECTS.length + 3) log.warn("[extra] a source did not answer, so its families are held out of the sweep", { tenantId, families });
  return { cards: out, complete: families.length === DEFECTS.length + 3, families, held: u.held, needsOwnPage: bank };
}
