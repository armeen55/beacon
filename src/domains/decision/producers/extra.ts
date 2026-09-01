/** A FAN-OUT IS EVIDENCE, NEVER A PAGE TOPIC: turning one into a section shipped a search trace as a heading. Content off a fan-out is authorized only via parent prompt, intent cluster, business scope, and a page whose job fits; until then it mints nothing. The old producer is DELETED and its family stays in the sweep so its cards withdraw themselves. */
import "server-only";
import { getRepository } from "@/lib/persistence/repositories";
import { log } from "@/lib/logger";
import { canonicalQueryKey, domainOf, topicTokens } from "@/domains/evidence/relevance-gate";
import { citesOwnSite } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { buildFanoutEvidence } from "@/domains/evidence/ai-visibility/fanout-evidence";
import { canonicalPairOf, readAiObservations } from "@/domains/evidence/ai-visibility/ai-observations";
import { readFactChecks } from "@/domains/evidence/pages/fact-checks";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot, type OwnedPageEvidence, type OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { defaultExpectedCtrAt, type TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { CauseFinding } from "@/domains/decision/diagnosis";
import type { CanonicalDemandUnit } from "@/domains/evidence/demand-units";
import { actionFamilyOf, loadChangeProposals } from "../proposal-store";
import { mutationFootprint } from "../mutation-footprint";
import { winnersCover } from "../drafted-copy";
// THE SHARED PRIMITIVES live in page-fit now: two producers answer "which page of this account is this search
// FOR" and one copy of that answer is the whole point of the split.
import { count, labelOf, MAX_PER_PRODUCER, mint, pageWords, pathOf, plain,
  STOREFRONT, subjectWords, type Draft, type Understanding } from "./page-fit";

// WHAT ONLY THIS FILE USES STAYS IN THIS FILE. The split exists so two producers share ONE answer to "which
// page is this search for"; everything else moving with it would have made page-fit a drawer and widened the
// public surface for nothing.
/** A page shown HEAVY_IMPRESSIONS often is a page to write, not a stub to fill. MIN_EARNED_OVERLAP is the words of a page's own tie to a search, past the site wide ones, before it may be asked to answer it, and past MAX_HEADING_WORDS a heading is a paragraph wrapped in a heading tag, saying nothing about what it answers. */
const HEAVY_IMPRESSIONS = 5_000, MIN_EARNED_OVERLAP = 2, MAX_HEADING_WORDS = 12;
/** A page worth linking to sits inside striking distance and is genuinely being seen. TOP_PAGES_PER_CLASS pages per defect get a card, one page at a time; no word-count line exists any more, because a content gap is diagnosed, never counted. */
const NEAR_MISS_MIN = 4, NEAR_MISS_MAX = 15, MIN_IMPRESSIONS = 30, TOP_PAGES_PER_CLASS = Number.MAX_SAFE_INTEGER; // the count meter is DELETED (operator, 2026-08-30, "i dont want any limits"): every page with the defect gets its card; the evidence floors stay the only quality gates
/** Results led by places that sell. A page losing to these loses on having nothing to buy on it. */
const SHOP_DOMAIN = /(^|\.)(amazon|etsy|ebay|aliexpress|walmart|redbubble|teepublic|zazzle|temu|wayfair|shop)\./i;
const STORE_FIRST = /(^|\.)(amazon|etsy)\./i;
/** THE CARD'S QUERY IS A SEARCH SOMEBODY RAN, never the page's own name read back. A defect card whose query
 *  is the page's H1 hands the drafter the site's own vocabulary and it optimises for what the page already
 *  says; the page's biggest real search is on file and is the audience the fix is for. */
const topQueryOf = (p: OwnedPageEvidence): string => {
  const q = [...(p.search?.topQueries ?? [])].filter((q) => q.impressions >= MIN_IMPRESSIONS).sort((a, b) => b.impressions - a.impressions)[0];
  return q ? q.query : labelOf(p); };
const clicksOf = (p: OwnedPageEvidence): number => p.search?.clicks90d ?? 0;
const flat = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
/** THE WORDS A PAGE HAS EARNED THE RIGHT TO BE ASKED ABOUT: its title, heading and section headings. The
 *  canonical outline arrives with site furniture already stripped at the snapshot assembler; what stays out
 *  here is this file's own rules: paragraphs in a heading tag and the page's own FAQ questions, because a
 *  question a page ASKS is not one it covers. */
const earnedWords = (p: OwnedPageEvidence, weak: ReadonlySet<string>): Set<string> =>
  new Set(topicTokens([p.content?.title, p.content?.h1, ...(p.content?.outline ?? []).filter((h) =>
    !h.trim().endsWith("?") && h.trim().split(/\s+/).length <= MAX_HEADING_WORDS)].filter(Boolean).join(" ")).filter((t) => !weak.has(t)));
/** ONE PAGE, WHATEVER SPELLING ASKED FOR IT: the address the read landed on, else the address the page names as its own, else the address asked for. Three retired slugs forwarding to one product are ONE page. */
const identityOf = (p: OwnedPageEvidence): string =>
  canonicalUrlKey(p.content?.finalUrl || p.content?.canonicalUrl || p.url);
import { aeoMeter, aiCaseCards, type AeoMeter } from "./ai-cases";

/** What this producer did, whether it FINISHED, and what it refused to guess at: completeness is stated per family, so a dead source holds only its own out of the sweep, and `held` puts refusals on the receipt. */
type ExtraQueueRun = { cards: ChangeProposal[]; complete: boolean; families: string[]; held: { pageUrl: string; reason: string }[]; aeoHold?: ReadonlySet<string>; aeoSpend?: { funded: number; attempted: number; cached: number; left: number }; needsOwnPage: { query: string; refusedPages?: string[] }[] };
import { linkFit, pageUnderstanding } from "./page-job";
import { journeyLabel } from "@/domains/evidence/ai-visibility/answer-journeys";
/** What this producer did, whether it FINISHED, and what it refused to guess at. `complete` is true only when the queue on file was read AND every source these producers judge on answered: "none this pass" and "I could not look" are the same length and opposite facts, and the sweep behind this producer withdraws every card in a family it believes was rewritten in full. `families` names the ones that DID finish, so a dead source holds only its own out of that sweep. `held` puts refusals on the receipt. */
function recoverableClicks(p: OwnedPageEvidence, expectedCtrAt: (position: number) => number): number | null {
  const q = [...(p.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0];
  if (!q || q.position == null || q.impressions < MIN_IMPRESSIONS) return null;
  const n = Math.round((expectedCtrAt(q.position) - Math.min(1, q.clicks / Math.max(1, q.impressions))) * q.impressions);
  return n > 0 ? n : null;
}
/** ONE card, in the ONE shape the store files and every surface renders. */
/** 2. THE LINKS THE STRONGEST PAGES NEVER PASS ON: the three pages that earn the most clicks, and the near miss pages they never link to. Off the stored link graph, so the absence of a link is a fact here. */
/** How many links one source page may donate in one pass: distinct destinations, each its own card and footprint. */
const LINKS_PER_SOURCE = 3;
async function linkCards(tenantId: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>, u: Understanding, expectedCtrAt: (position: number) => number): Promise<{ drafts: Draft[]; complete: boolean }> {
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
  const strongest = pages.filter((p) => linksByPage.has(canonicalUrlKey(p.url)) && clicksOf(p) > 0).sort((a, b) => clicksOf(b) - clicksOf(a)); // the source-page meter is DELETED (operator, 2026-08-30): every read page with clicks may donate a link, same anchor and fit gates
  const nearMiss = pages.flatMap((p) => {
    // THE SEARCH BECOMES THE WORDS ON THE LINK, so a search that is not words never qualifies: an operator like "site:" is never anchor text, a dictionary ask ("hyena in farsi") earns a line on its own page, and a question is a sentence nobody links with; anchors are the noun phrase the destination is FOR.
    const q = (p.search?.topQueries ?? []).filter((q) => !/[:/@]|^https?/i.test(q.query)
      && !/^(what|how|why|when|where|who|which|is|are|can|do|does)\b/i.test(q.query)
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
    // TWO WORDS OF THE DESTINATION'S SUBJECT ON THE SOURCE PAGE, NEVER ONE (operator, 2026-09-01): one shared word is a coincidence, and "caspian" on a names page sent a link to a horse breed. SEVERAL LINKS PER SOURCE: every destination that fits is its own card, its own footprint and its own worth.
    const targets: { page: OwnedPageEvidence; query: OwnedQuerySignal }[] = [];
    for (const t of nearMiss) {
      if (targets.length >= LINKS_PER_SOURCE) break;
      const subject = subjectWords(t.query.query, weak);
      if (t.page.url === from.url || clicksOf(from) <= clicksOf(t.page) || links.has(pathOf(t.page.url).toLowerCase()) || targets.some((x) => x.page.url === t.page.url)
        || subject.filter((w) => words.has(w)).length < Math.min(2, subject.length)) continue;
      if (await belongs(t.page, t.query.query)) targets.push(t);
    }
    for (const target of targets) {
    const to = pathOf(target.page.url), position = target.query.position!.toFixed(1);
    // THE LINK'S OWN WORTH: the clicks the destination is leaving behind at the position it holds for this search, and that search's audience. Never the source page's whole audience.
    const gain = Math.round((expectedCtrAt(target.query.position!) - Math.min(1, target.query.clicks / Math.max(1, target.query.impressions))) * target.query.impressions);
    const held = inbound.get(to.toLowerCase()) ?? 0, support = held === 0 ? `No page of this site links to ${to} at all today`
      : `Only ${count(held, "page")} of this site ${held === 1 ? "links" : "link"} to ${to} today`;
    out.push({
      page: from, slug: `internal_link@${to}`, field: "section", query: target.query.query, linkTo: to, demand: target.query.impressions, impact: gain > 0 ? gain : null,
      headline: `Link ${pathOf(from.url)} to ${to} with the words "${target.query.query}"`, before: null,
      after: `Add one link in the body of ${pathOf(from.url)} pointing to ${to}, with the anchor text "${target.query.query}".`,
      // THE LINK'S PURPOSE, OFF THE STORED GRAPH: what holds the destination up today, what the words on it tell Google that page is for, and why this source page is the one being asked to give it.
      why: `${support}, and it sits at position ${position} for "${target.query.query}" on ${count(target.query.impressions, "impression")} and ${count(target.query.clicks, "click")}. Adding it puts the words of that search on a link pointing at the page that already ranks for it. ${labelOf(from)} at ${pathOf(from.url)} earns ${count(clicksOf(from), "click")} in 90 days against that page's ${count(clicksOf(target.page), "click")} and already links to ${count(links.size, "page")} of this site, not one of them ${to}, so the help runs from the page that can spare it to the page that needs it.`,
      steps: [`Open the site editor on ${pathOf(from.url)}`, `Add a link to ${to} inside the body copy, not the menu`, `Use "${target.query.query}" as the anchor text`, "Mark it done here and the position gets read again"],
      hints: [`${pathOf(from.url)} links to ${count(links.size, "page")} of this site and none of them is ${to}`, `${support}, counted across every page of this site read so far`, `${to} ranks at position ${position} for "${target.query.query}" with ${count(target.query.impressions, "impression")} in Search Console`, `${pathOf(from.url)} earns ${count(clicksOf(from), "click")} in the last 90 days`],
      // Every page whose stored link graph was read for the counts above, plus the destination's own search row.
      minutes: 5, confidence: "medium", refs: linksByPage.size + 1,
      limitation: "The link list comes from the last stored read of this page, so a link added since then is not counted here.",
    }); }
    if (out.length >= MAX_PER_PRODUCER) break; // unreachable: the meter is deleted and stays only as a runaway guard
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
    page: p, slug: "missing_description", field: "meta", query: topQueryOf(p),
    headline: `Write the missing description on ${pathOf(p.url)} (Google is writing its own)`, before: null,
    after: "Write a description of about 150 characters that names this page's subject and the one answer it gives, and ends on a fact about the page rather than an instruction to read it.",
    // A COUNT IS NOT AN ARGUMENT UNTIL IT IS BIG ENOUGH TO BE ONE. "3 views in 90 days, so that line is read a lot" was printed on a live card: the sentence was welded to the figure and stayed true only while the figure was large. It says what the figure actually shows now, and a small one says it is small.
    why: `${pathOf(p.url)} carries no description, so the line under its title in the results is Google's own writing. It was shown ${count(impressions(p), "time")} and earned ${count(clicksOf(p), "click")} in 90 days, ${impressions(p) >= 1000 ? "so that line is read a lot" : "so it is a small page today and this is a small fix"}.`,
    steps: [`Open the site editor on ${pathOf(p.url)}`, "Paste a description of about 150 characters", "Mark it done here and the click rate gets read again"],
    hints: [`${pathOf(p.url)} holds no description of its own`, `${pathOf(p.url)} earns ${count(impressions(p), "impression")} and ${count(clicksOf(p), "click")} in 90 days`, `${count(noMeta.length, "page")} with content stored carry no description`],
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
  for (const p of rank(templated.flat())) { // the meter is DELETED (operator, 2026-08-30): every page sharing the template gets its card
    const family = templated.find((g) => g.includes(p))!.length;
    out.push({
      page: p, slug: "missing_description", field: "meta", query: topQueryOf(p), minutes: 3, confidence: "low", refs: family, impact: recoverableClicks(p, expectedCtrAt),
      headline: `Write a real description on ${pathOf(p.url)}: ${family} pages share one templated line`, before: (p.content?.metaDescription ?? "").trim() || null,
      after: "Write a description of about 150 characters that says what only this page answers, and ends on a fact about the page rather than an instruction to read it.",
      why: `${count(family, "page")} carry the same templated description with only the name swapped, and ${pathOf(p.url)} is the busiest of them at ${count(impressions(p), "impression")} in 90 days. A line every sibling repeats gives nobody a reason to click this one.`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, "Replace the templated description with one written for this page", "Mark it done here and the click rate gets read again"],
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
      page: p, slug: "duplicate_heading", field: "h1", query: topQueryOf(p),
      headline: `Give ${pathOf(p.url)} its own heading: ${sharers} other ${sharers === 1 ? "page shares" : "pages share"} it`,
      before: heading, after: "Rewrite this heading so it names what only this page covers.",
      why: `"${heading}" is the heading on ${count(sharers + 1, "page")} of this site, which asks Google to pick between them. ${pathOf(p.url)} earns ${count(impressions(p), "impression")} in 90 days, so it is the one to name first.`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, "Rewrite the heading so it names what only this page covers", "Mark it done here and the positions get read again"],
      hints: [`${pathOf(p.url)} and ${count(sharers, "other page")} carry the heading "${heading}"`, `${pathOf(p.url)} earns ${count(impressions(p), "impression")} in 90 days`, `${count(dupes.length, "heading")} are duplicated across this site`],
      minutes: 1, confidence: "medium", refs: sharers + 1, impact: recoverableClicks(p, expectedCtrAt),
      limitation: "Headings are compared exactly as stored, so two headings that differ only by a stray word read as separate here.",
    });
  }

  // A THIN CARD MUST CARRY THE EARNED SHAPE, not a word count. With no stored results page for this page's biggest search there is no outline to hand over, and "add 1,200 words" is a risk dressed as advice.
  const winnersOnFile = (p: OwnedPageEvidence): boolean => {
    const head = [...(p.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0]?.query;
    const s = head != null ? (snapshot.research?.serpEvidence ?? []).find((e) => canonicalQueryKey(e.query) === canonicalQueryKey(head) && (e.organic ?? []).length > 0) : null;
    if (!s) return false; // A RESULTS PAGE SHAPES THIS PAGE ONLY WHEN IT IS ABOUT THIS PAGE'S SUBJECT (operator audit, 2026-09-01): rows merely existing proved the query was bought, not that the winners share the entity, so a person-profile page of results could shape an animal page. At least two winners must name a subject word this page names itself by.
    const subject = new Set(topicTokens(`${p.content?.title ?? ""} ${p.content?.h1 ?? ""}`));
    return subject.size > 0 && (s.organic ?? []).filter((o) => topicTokens(o.title ?? "").some((t) => subject.has(t))).length >= 2;
  };
  // A CONTENT GAP IS DIAGNOSED, NEVER COUNTED (operator, 2026-09-01). Word count authorized this card twice
  // over: first a flat 200, then a demand-scaled floor, and both were the same mistake wearing different
  // arithmetic, because a 150-word page can be complete and a 1,500-word page can miss the one question that
  // matters. What authorizes an expansion now is a NAMED missing subject: a heading the pages winning this
  // page's own head search agree on carrying, that this page's stored outline does not, with the demand and
  // the stored results page as the evidence. The card names the exact subjects; "add N words" is gone.
  const carries = (p: OwnedPageEvidence, label: string): boolean => {
    const bag = (t: string) => new Set(t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
    const want = bag(label); if (want.size === 0) return true;
    const own = bag([p.content?.title ?? "", p.content?.h1 ?? "", ...(p.content?.outline ?? []), ...(p.content?.h2 ?? [])].join(" "));
    return [...want].filter((w) => own.has(w)).length >= Math.max(1, Math.ceil(want.size / 2)); };
  const gapsOf = (p: OwnedPageEvidence): string[] => winnersCover(snapshot, p).filter((label) => !carries(p, label));
  const expandable = rank(pages.filter((p) => (p.content?.wordCount ?? 0) > 0 && impressions(p) > 0 && winnersOnFile(p)))
    .map((p) => ({ p, gaps: gapsOf(p) })).filter((x) => x.gaps.length > 0);
  for (const { p, gaps } of expandable.slice(0, TOP_PAGES_PER_CLASS)) {
    const stores = winnersAreStores(p);
    const shopStep = "Add a product block or shop link above the fold; the pages winning this search are stores.";
    const named = gaps.slice(0, 4);
    out.push({
      page: p, slug: "thin_page", field: "section", query: topQueryOf(p),
      headline: `Cover what this search's winners all carry on ${pathOf(p.url)}: ${named[0]}`,
      before: null,
      after: `Add a section to ${pathOf(p.url)} covering ${named.map((g) => `"${g}"`).join(", ")}: the pages winning "${topQueryOf(p)}" each carry ${named.length === 1 ? "this subject" : "these subjects"} and this page does not.`,
      why: `${pathOf(p.url)} is shown ${count(impressions(p), "time")} in 90 days for "${topQueryOf(p)}", and every page winning that search covers ${named.map((g) => `"${g}"`).join(", ")} while this page's own headings do not.`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, `Add a section covering ${named[0]}`, ...(named.length > 1 ? [`Cover the other named ${named.length === 2 ? "subject" : "subjects"} too: ${named.slice(1).join(", ")}`] : []), ...(stores ? [shopStep] : []), "Mark it done here and the impressions get read again"],
      hints: [`The winners of "${topQueryOf(p)}" agree on: ${named.join(", ")}`, `${pathOf(p.url)} is shown ${count(impressions(p), "time")} and earns ${count(clicksOf(p), "click")} in 90 days`, `${count(expandable.length, "page")} of the ${pages.length} stored pages are missing a subject their search's winners agree on`],
      // This page's stored copy, its search row, and the stored results page the missing subjects came from.
      minutes: 30, confidence: "medium", refs: 3, impact: recoverableClicks(p, expectedCtrAt),
      limitation: "The missing subjects are read off the stored results page and the winners' own headings as last read; a subject added to the page since that read is not counted here.",
    });
  }
  // A ZERO-WORD 200 IS AN UNREAD PAGE, NEVER A THIN ONE. A page built with javascript answers a raw fetch
  // with a normal response and no readable words, so what it carries is UNKNOWN: judging it thin would be
  // judging blindness, and skipping it silently hid the site's biggest pages. It gets a research card that
  // names the rendered read as the next step, and no body-dependent change can stand on it until that lands.
  const unread = rank(pages.filter((p) => (p.content?.wordCount ?? 0) === 0 && impressions(p) > 0));
  for (const p of unread.slice(0, TOP_PAGES_PER_CLASS)) {
    out.push({
      page: p, slug: "thin_page", field: "section", query: topQueryOf(p),
      headline: `Read ${pathOf(p.url)}: a page shown ${count(impressions(p), "time")} whose words a raw fetch cannot see`,
      before: null,
      after: `Capture the real words on ${pathOf(p.url)} with a rendered read; no judgment about its content stands until that read lands.`,
      why: `${pathOf(p.url)} answers with a normal page and zero readable words, so it is built with javascript a raw read cannot run. What it carries is unknown rather than thin, and it is still shown ${count(impressions(p), "time")} in 90 days.`,
      steps: [],
      hints: [`${pathOf(p.url)} returns a normal response and zero readable words to a raw fetch`, `${pathOf(p.url)} is shown ${count(impressions(p), "time")} and earns ${count(clicksOf(p), "click")} in 90 days`],
      minutes: 0, confidence: "low", refs: 2, impact: null,
      limitation: "Nothing here is yours to do: the rendered read runs on the next research pass and this card updates itself.",
      next: "A rendered read captures the page's real words on the next research pass, without touching the page.",
    });
  }
  return out;
}
/** Every extra card this account's stored evidence already supports, at `needs_review`, deduplicated against the queue it holds. Never throws: a source that will not read narrows the answer instead of failing the pass. */
export async function extraQueueCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date;
  /** THE PASS'S AEO DIAGNOSIS PURSE. Absent means an UNFUNDED caller, so nothing is bought and every case stays owed. */
  aeoDiagnoses?: number;
  /** THE BAR THIS ACCOUNT'S OWN SEARCHES ARE HELD TO, threaded from the pass that fitted it. Absent falls back to the industry table, a far more generous bar, so a caller that can fit one should. */
  curve?: Pick<TenantCtrCurve, "expectedCtrAt">;
  /** THE PASS'S PAGE-READING BUDGET, the second of the two named budgets a production pass owns. Handed in so the one paid read this file makes is counted where every other paid call is counted. */
  reads?: { left: number };
  /** THE CANONICAL DEMAND UNITS, loaded once by the pass and handed to every producer that joins audiences. */
  units?: readonly CanonicalDemandUnit[];
  /** Default true. False on a dry run, and then nothing this producer concludes is written down either. */
  persist?: boolean }): Promise<ExtraQueueRun> {
  const { tenantId, snapshot, now } = input;
  const expectedCtrAt = input.curve?.expectedCtrAt ?? defaultExpectedCtrAt;
  // WHICH SOURCE EACH FAMILY IS JUDGED ON. The two answer producers read stored AI answers and nothing else, so an answer read that failed must not let the sweep retire their cards as ones nobody re-emitted.
  const answersRead = snapshot.sources.some((s) => s.source === "native_ai" && s.status === "fresh");
  const DEFECTS = ["missing_description", "duplicate_heading", "thin_page"];
  const pages = snapshot.ownedPages.filter((p) => !!p.content);
  // NOTHING TO READ IS NOT A FINISHED PASS. These producers rewrite their families in full and the sweep behind them retires only what a FINISHED producer no longer stands behind, so a pass that read nothing says so.
  if (pages.length === 0) return { cards: [], complete: false, families: [], held: [], needsOwnPage: [] };
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  const meter: AeoMeter = aeoMeter(input.aeoDiagnoses ?? 0);
  // The words each page has actually earned the right to be asked about, off the already-clean outline.
  const earned = new Map(pages.map((p) => [p.url, earnedWords(p, weak)]));
  // How much of this site hangs UNDER each page: what makes one address a hub and another a leaf.
  const children = new Map(pages.map((p) => [pathOf(p.url), pages.filter((o) => o !== p && pathOf(o.url).startsWith(`${pathOf(p.url)}/`)).length]));
  // WHAT THIS ACCOUNT ALREADY HOLDS, so a card never supersedes a change the strict path drafted for the same page and family, and an unreadable queue emits nothing rather than writing over work it cannot see. A ROW THIS PRODUCER MINTED ITSELF IS NOT SOMEBODY ELSE'S WORK: only a family held under ANOTHER id blocks.
  const store = await loadChangeProposals(tenantId).catch(() => null);
  if (!store) return { cards: [], complete: false, families: [], held: [], needsOwnPage: [] };
  const rows = [...store.values()];
  // SUPPRESSION IS BY THE MUTATION A ROW WRITES, NEVER BY PAGE PLUS FAMILY (operator, 2026-08-31). The old key
  // let one measuring section on /cities block EVERY new section that page could earn, whatever its topic: the two
  // largest expansion opportunities on the site were invisible behind rows about different subjects. The footprint
  // is THE definition of what a change writes; two rows collide when their footprints do, and only then.
  const taken = new Set(rows.flatMap((p) => [...mutationFootprint(p)]));
  const mine = new Set(rows.map((p) => p.id));
  // WHAT AN ESSAY MAY NEVER LAND ON is this file's rule, so this file decides which pages are worth reading.
  const eligible = pages.filter((p) => { const path = pathOf(p.url); return path !== "/" && !STOREFRONT.test(path); });
  const u = await pageUnderstanding(tenantId, eligible, { now, openPaths: new Set(rows.map((p) => (p.pagePath ?? "").toLowerCase())), ...(input.reads ? { reads: input.reads } : {}) });
  const bank: { query: string; refusedPages?: string[] }[] = [];
  const links = await linkCards(tenantId, pages, weak, u, expectedCtrAt);
  // THE STORED AI WINDOW, one lean read through the same projection Visibility renders; a failed read hands
  // null through, and the staged producer then claims no recurrence it cannot show.
  const day = (d: Date): string => d.toISOString().slice(0, 10);
  const windowRows = await readAiObservations(tenantId, { fromDay: day(new Date(now.getTime() - 27 * 86_400_000)), toDay: day(now), slot: 0, projection: "fanout" }).catch(() => null);
  const windowObs = windowRows?.map((r) => canonicalPairOf(r)) ?? null;
  // THE COMPLETE GOOGLE UNIVERSE, not the top-40 grain. Null = unknown, never no.
  const universe = await import("@/domains/evidence/readers/gsc-query-universe")
    .then((m) => m.loadGscQueryUniverse(tenantId, now)).catch(() => null);
  const cases = await aiCaseCards(bank, snapshot, pages, weak, earned, children, u, tenantId, input.units ?? [], windowObs, now, input.persist !== false, meter, universe?.keys ?? null);
  const drafts = [...cases.drafts,
    ...links.drafts, ...technicalCards(pages, snapshot, expectedCtrAt)];
  const out: ChangeProposal[] = [];
  // ONE QUESTION, ONE CARD: the answer an engine wrote and the follow-up search it ran to write it are one question, so only the strongest reading of it is filed.
  const answered = new Set<string>();
  for (const d of drafts) {
    const asks = d.asked ? [canonicalQueryKey(d.query), canonicalQueryKey(d.asked)].filter(Boolean) : [];
    if (asks.some((k) => answered.has(k))) continue;
    const card = mint(tenantId, d, now), prints = [...mutationFootprint(card)];
    if (prints.some((k) => taken.has(k)) && !mine.has(card.id)) continue;
    for (const k of prints) taken.add(k);
    for (const k of asks) answered.add(k);
    out.push(card);
  }
  // EACH FAMILY ANSWERS FOR ITS OWN SOURCE. A family whose evidence did not answer is left off this list, so the sweep behind this producer leaves its cards alone instead of retiring work nobody was able to re-read.
  // `engine_followup` stays in the sweep with NO producer behind it on purpose: it is the one family this pass
  // still owns and deliberately never emits, so the sweep withdraws every follow-up-search card already on file.
  // AND THE AI FAMILY ANSWERS FOR ITS OWN RECORD TOO: a pass whose conclusions could not be filed has not
  // rewritten this family in full, whatever it minted, so the sweep leaves the cards on file exactly alone.
  const families = [...(answersRead && cases.filed ? ["ai_answer_gap", "engine_followup"] : []), ...(links.complete ? ["internal_link"] : []), ...DEFECTS];
  if (families.length < DEFECTS.length + 3) log.warn("[extra] a source did not answer, so its families are held out of the sweep", { tenantId, families });
  log.info("[extra] the pass's AEO diagnosis purse", { tenantId, ...meter.spent(), refused: cases.hold.size });
  return { cards: out, complete: families.length === DEFECTS.length + 3, families, held: u.held, needsOwnPage: bank, aeoHold: cases.hold, aeoSpend: meter.spent() };
}

/** THE ONE ENTRANCE FOR A PASS: loads the demand units once (both producers join the SAME audiences) and
 *  runs the $0 queue. The paid funnel's early return used to skip this producer entirely, so a paused quiet
 *  account never judged a single AI case (first canonical $0 acceptance run, 2026-08-21). */
export async function extraQueuePass(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date;
  curve?: Parameters<typeof extraQueueCards>[0]["curve"]; reads?: { left: number }; persist?: boolean; aeoDiagnoses?: number }): Promise<{
  run: ExtraQueueRun; unitLoad: Awaited<ReturnType<typeof import("@/domains/evidence/demand-unit-loader")["loadCanonicalDemandUnits"]>> | null }> {
  const unitLoad = await import("@/domains/evidence/demand-unit-loader")
    .then((m) => m.loadCanonicalDemandUnits(input.tenantId, input.snapshot, input.curve, input.now)).catch(() => null);
  const run = await extraQueueCards({ ...input, ...(unitLoad ? { units: unitLoad.units } : {}) })
    .catch(() => ({ cards: [], complete: false, held: [], needsOwnPage: [], families: [] as string[] }));
  return { run, unitLoad };
}
