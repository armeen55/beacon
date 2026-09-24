/** A FAN-OUT IS EVIDENCE, NEVER A PAGE TOPIC: turning one into a section shipped a search trace as a heading. Content off a fan-out is authorized only via parent prompt, intent cluster, business scope, and a page whose job fits; until then it mints nothing. The old producer is DELETED and its family stays in the sweep so its cards withdraw themselves. */
import "server-only";
import { getRepository } from "@/lib/persistence/repositories";
import { log } from "@/lib/logger";
import { canonicalQueryKey, domainOf, FURNITURE_LABEL, topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalPairOf, readAiObservations } from "@/domains/evidence/ai-visibility/ai-observations";
import { pageHashOf } from "@/domains/evidence/pages/fact-check-run"; import { authorizedCorrections, readFactChecks, type FactCheck } from "@/domains/evidence/pages/fact-checks";
import { canonicalUrlKey, weakAnchorsOf, type EvidenceSnapshot, type OwnedPageEvidence, type OwnedQuerySignal } from "@/domains/evidence/snapshot";
import { isCurrent } from "@/domains/evidence/freshness";
import { defaultExpectedCtrAt, type TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ChangeProposal } from "@/domains/decision/contracts";
import { substantiveGapOf, type CauseFinding } from "@/domains/decision/diagnosis";
import type { CanonicalDemandUnit } from "@/domains/evidence/demand-units";
import { loadChangeProposals } from "../proposal-store";
import { footprintKey, mutationFootprint } from "../mutation-footprint";
import proposalSeats from "../proposal-seats";
import { RECEIPT } from "../diagnose";
import { demandOf, winnersAgreeOn } from "../drafted-copy";
import { articlePassages } from "../in-place-link";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { GAIN } from "../draft-resolution";
import { selectPageVersion } from "@/domains/evidence/pages/page-version";
import { count, labelOf, mint, pathOf, plain,
  STOREFRONT, subjectWords, type Draft, type Understanding } from "./page-fit";

/** Past MAX_HEADING_WORDS a heading is a paragraph wrapped in a heading tag, saying nothing about what it answers. */
const MAX_HEADING_WORDS = 12;
/** A page worth linking to sits inside striking distance and is genuinely being seen. No count meter (operator, 2026-08-30, "i dont want any limits"): every page with the defect gets its card; the evidence floors stay the only quality gates. */
const NEAR_MISS_MIN = 4, NEAR_MISS_MAX = 15, MIN_IMPRESSIONS = 30, TO_28_DAYS = 28 / 90; // ONE IMPACT UNIT (audit, 2026-09-14): the ranker prints impactScore as clicks over 28 days, and these cards carried the 90-day figure, so a meta card outranked a section by construction
/** Every verdict of the gap reader that is WORK on this page: an absence, an answer in pieces, a capture to read, and the observation kinds (what a winner carries that this page does not, in the shape it carries it). */
const MINTED_KINDS = new Set(["missing_answer", "scattered_answer", "unknown_capture", "incomplete_answer", "missing_comparison", "missing_procedure", "missing_evidence", "false_page_promise"]);
/** Results led by places that sell. A page losing to these loses on having nothing to buy on it. */
const SHOP_DOMAIN = /(^|\.)(amazon|etsy|ebay|aliexpress|walmart|redbubble|teepublic|zazzle|temu|wayfair|shop)\./i;
const STORE_FIRST = /(^|\.)(amazon|etsy)\./i;
/** THE CARD'S QUERY IS A SEARCH SOMEBODY RAN, never the page's own name read back. A defect card whose query is the page's H1 hands the drafter the site's own vocabulary and it optimises for what the page already says; the page's biggest real search is on file and is the audience the fix is for. */
const topQueryOf = (p: OwnedPageEvidence): string => {
  const q = [...(p.search?.topQueries ?? [])].filter((q) => q.impressions >= MIN_IMPRESSIONS).sort((a, b) => b.impressions - a.impressions)[0];
  return q ? q.query : labelOf(p); };
const clicksOf = (p: OwnedPageEvidence): number => p.search?.clicks90d ?? 0;
/** THE WORDS A PAGE HAS EARNED THE RIGHT TO BE ASKED ABOUT: its title, heading and section headings. The canonical outline arrives with site furniture already stripped at the snapshot assembler; what stays out here is this file's own rules: paragraphs in a heading tag and the page's own FAQ questions, because a question a page ASKS is not one it covers. */
const earnedWords = (p: OwnedPageEvidence, weak: ReadonlySet<string>): Set<string> =>
  new Set(topicTokens([p.content?.title, p.content?.h1, ...(p.content?.outline ?? []).filter((h) =>
    !h.trim().endsWith("?") && h.trim().split(/\s+/).length <= MAX_HEADING_WORDS)].filter(Boolean).join(" ")).filter((t) => !weak.has(t)));
/** ONE PAGE, WHATEVER SPELLING ASKED FOR IT: the address the read landed on, else the address the page names as its own, else the address asked for. Three retired slugs forwarding to one product are ONE page. */
const identityOf = (p: OwnedPageEvidence): string =>
  canonicalUrlKey(p.content?.finalUrl || p.content?.canonicalUrl || p.url);
import { aeoMeter, aiCaseCards, type AeoMeter } from "./ai-cases";

/** What this producer did, whether it FINISHED, and what it refused to guess at: completeness is stated per family, so a dead source holds only its own out of the sweep, and `held` puts refusals on the receipt. */
type ExtraQueueRun = { cards: ChangeProposal[]; complete: boolean; families: string[]; held: { pageUrl: string; reason: string }[]; answerCaptures?: ReadonlyMap<string, Record<string, unknown>>; aeoHold?: ReadonlySet<string>; aeoSpend?: { funded: number; attempted: number; givenBack: number; left: number }; needsOwnPage: { query: string; refusedPages?: string[] }[] };
import { linkFit, pageUnderstanding } from "./page-job";
/** What this producer did, whether it FINISHED, and what it refused to guess at. `complete` is true only when the queue on file was read AND every source these producers judge on answered: "none this pass" and "I could not look" are the same length and opposite facts, and the sweep behind this producer withdraws every card in a family it believes was rewritten in full. `families` names the ones that DID finish, so a dead source holds only its own out of that sweep. `held` puts refusals on the receipt. */
function recoverableClicks(p: OwnedPageEvidence, expectedCtrAt: (position: number) => number): number | null {
  const q = [...(p.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0];
  if (!q || q.position == null || q.impressions < MIN_IMPRESSIONS) return null;
  const n = Math.round((expectedCtrAt(q.position) - Math.min(1, q.clicks / Math.max(1, q.impressions))) * q.impressions * TO_28_DAYS);
  return n > 0 ? n : null;
}
/** ONE card, in the ONE shape the store files and every surface renders. */
/** 2. THE LINKS THE STRONGEST PAGES NEVER PASS ON: the three pages that earn the most clicks, and the near miss pages they never link to. Off the stored link graph, so the absence of a link is a fact here. */
/** How many links one source page may donate in one pass: distinct destinations, each its own card and footprint. */
const LINKS_PER_SOURCE = 3;
async function linkCards(tenantId: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>, u: Understanding, expectedCtrAt: (position: number) => number, bodies: ReadonlyMap<string, OwnedPageBody>): Promise<{ drafts: Draft[]; complete: boolean }> {
  const graphs = await getRepository().forTenant(tenantId).getPageSnapshotLinkGraphs().catch(() => null);
  if (graphs == null) return { drafts: [], complete: false };
  if (graphs.length === 0) return { drafts: [], complete: true };
  const graphsByKey = new Map<string, typeof graphs>();
  for (const g of graphs) { const key = canonicalUrlKey(g.url); graphsByKey.set(key, [...(graphsByKey.get(key) ?? []), g]); }
  const linksByPage = new Map<string, Set<string>>();
  for (const [key, group] of graphsByKey) { const v = selectPageVersion(group, (g) => ({ fetchedAt: g.fetched_at ?? null, words: g.word_count ?? g.internal_links.length, bodyHeld: Array.isArray(g.internal_links), certainty: g.extraction_certainty ?? null })); if (v.content) linksByPage.set(key, new Set(v.content.internal_links.map((l) => pathOf(l.href).toLowerCase()))); }
  const inbound = new Map<string, number>();
  for (const links of linksByPage.values()) for (const to of links) inbound.set(to, (inbound.get(to) ?? 0) + 1);
  const strongest = pages.filter((p) => linksByPage.has(canonicalUrlKey(p.url)) && clicksOf(p) > 0 && !STOREFRONT.test(pathOf(p.url))).sort((a, b) => clicksOf(b) - clicksOf(a)); // the source-page meter is DELETED (operator, 2026-08-30): every read page with clicks may donate a link, same anchor and fit gates; a shop page donates none, its rails are not prose
  const nearMiss = pages.flatMap((p) => {
    const q = (p.search?.topQueries ?? []).filter((q) => !/[:/@]|^https?/i.test(q.query)
      && !/^(what|how|why|when|where|who|which|is|are|can|do|does)\b/i.test(q.query)
      && !/\bin (farsi|persian|english)\b/i.test(q.query) && q.position != null && q.position >= NEAR_MISS_MIN
      && q.position <= NEAR_MISS_MAX && q.impressions >= MIN_IMPRESSIONS).sort((a, b) => b.impressions - a.impressions)[0];
    return q ? [{ page: p, query: q }] : [];
  }).sort((a, b) => b.query.impressions - a.query.impressions);
  const out: Draft[] = [];
  for (const from of strongest) {
    const links = linksByPage.get(canonicalUrlKey(from.url))!;
    const sentences = articlePassages(bodies.get(canonicalUrlKey(from.url))).flatMap((p) => p.split(/(?<=[.!?])\s+/)).map(s => s.trim()).filter(s => s.length >= 12 && s.length <= 220 && !FURNITURE_LABEL.test(s));
    const spots = sentences.filter(s => sentences.filter(other => other.toLowerCase() === s.toLowerCase()).length === 1).map(s => new Set(subjectWords(s, weak)));
    const own = new Set(subjectWords(`${from.content?.title ?? ""} ${from.content?.h1 ?? ""}`, weak)); // the source's own subject: a word both pages are about ("flag", "empire") places nothing
    const belongs = async (to: OwnedPageEvidence, anchor: string): Promise<boolean> => {
      const [dest, src] = [await u.of(to), await u.of(from)];
      for (const [page, read] of [[to, dest], [from, src]] as const) {
        if (!read.job) { u.hold(page.url, `${read.reason} for the link "${anchor}"`); return false; } }
      return linkFit(dest.job, src.job, subjectWords(anchor, weak), u.corpus) === "fits"; };
    const targets: { page: OwnedPageEvidence; query: OwnedQuerySignal }[] = [];
    for (const t of nearMiss) {
      if (targets.length >= LINKS_PER_SOURCE) break;
      const subject = subjectWords(t.query.query, weak), distinct = subject.filter((w) => !own.has(w)); // what the destination is about that this page is not: "parthian" on the Achaemenid page, never "flag"
      if (t.page.url === from.url || clicksOf(from) <= clicksOf(t.page) || links.has(pathOf(t.page.url).toLowerCase()) || targets.some((x) => x.page.url === t.page.url) || STOREFRONT.test(pathOf(t.page.url))
        || distinct.length === 0 || !spots.some((spot) => distinct.filter((w) => spot.has(w)).length >= Math.min(2, distinct.length))) continue; // an exact editable sentence on the source already speaks of the destination's own subject, or there is nowhere honest to put the link
      if (await belongs(t.page, t.query.query)) targets.push(t);
    }
    for (const target of targets) {
    const to = pathOf(target.page.url), position = target.query.position!.toFixed(1);
    const gain = Math.round((expectedCtrAt(target.query.position!) - Math.min(1, target.query.clicks / Math.max(1, target.query.impressions))) * target.query.impressions * TO_28_DAYS);
    const held = inbound.get(to.toLowerCase()) ?? 0, dest = labelOf(target.page), support = held === 0 ? `No page of this site links to ${dest} at all today`
      : `Only ${count(held, "page")} of this site ${held === 1 ? "links" : "link"} to ${dest} today`; /* the page by its name, never its address (operator walk, 2026-09-16) */
    out.push({
      page: from, slug: `internal_link@${to}`, field: "section", query: target.query.query, linkTo: to, demand: target.query.impressions, impact: gain > 0 ? gain : null,
      headline: `A route to ${labelOf(target.page)} for readers searching "${target.query.query}"`, before: null,
      after: `Add one link in the body of ${pathOf(from.url)} pointing to ${to}, with the anchor text "${target.query.query}".`,
      why: `${support}, and that page sits at position ${position} on Google for "${target.query.query}", shown ${count(target.query.impressions, "time")} for ${count(target.query.clicks, "click")}. A link carrying the words of that search points Google at the page that already ranks for it. ${labelOf(from)} earns ${count(clicksOf(from), "click")} in 90 days against that page's ${count(clicksOf(target.page), "click")} and ${links.size === 0 ? "links to no other page of this site yet" : `already links to ${count(links.size, "page")} of this site, none of them ${dest}`}, so the help runs from the page that can spare it to the page that needs it.`,
      steps: [`Open the site editor on ${pathOf(from.url)}`, `Add a link to ${to} inside the body copy, not the menu`, `Use "${target.query.query}" as the anchor text`, "Mark it done here and the position gets read again"],
      hints: [links.size === 0 ? `${labelOf(from)} links to no other page of this site yet` : `${labelOf(from)} links to ${count(links.size, "page")} of this site and none of them is ${dest}`, `${support}, counted across every page of this site read so far`, `${dest} ranks at position ${position} on Google for "${target.query.query}", shown ${count(target.query.impressions, "time")} in Search Console`, `${labelOf(from)} earns ${count(clicksOf(from), "click")} in the last 90 days`],
      minutes: 5, confidence: "medium", refs: linksByPage.size + 1,
      limitation: "The link list comes from the last stored read of this page, so a link added since then is not counted here.", cause: structural("internal_link_weakness", "section", [RECEIPT.copy, RECEIPT.gsc], `${support}, and it sits at position ${position} for "${target.query.query}", so nothing on this site sends a reader from ${labelOf(from)} to the page already ranking for that search.`, `If a link from ${pathOf(from.url)} to ${to} is found the next time this page's links are read, nothing is missing here.`),
    }); }
  }
  return { drafts: out, complete: true };
}
/** THE FINDING A SWEEP CARD ALREADY MADE, SAID IN THE LADDER'S OWN WORDS (operator, 2026-09-04). Thirty-two live descriptions were minted off a named defect in the page's own line and carried no cause at all: the detail page printed "No cause is named for it yet" over a finding the card's own headline states, and the wording gate went on holding every replacement "until a diagnosis names what is wrong with the current description" while that diagnosis sat unsaid in the same object. NO NEW VOCABULARY, because none is needed: a description missing or repeated across siblings IS the line Google displays for the page, a page missing what every winner covers IS incomplete coverage, and a page nothing links to IS where a reader gets sent next. `evidenceKeys` name the readings the card was actually made from. */
const structural = (cause: CauseFinding["cause"], action: CauseFinding["action"], evidenceKeys: string[], explanation: string, falsifier: string): CauseFinding => ({ cause, action, evidenceKeys, competingExplanations: [], notConsidered: [], explanation, falsifier });
/** 3. THE THREE DEFECTS WORTH A SWEEP, ONE CARD PER PAGE. A card that fixes one page and then says "repeat on nine more" cannot be done in one sitting, marked done, or measured, so each page with the defect gets its own card and figures and the class total rides along as context. */
function technicalCards(all: OwnedPageEvidence[], snapshot: EvidenceSnapshot, expectedCtrAt: (position: number) => number, bodies: ReadonlyMap<string, OwnedPageBody>, now: Date): Draft[] {
  const impressions = (p: OwnedPageEvidence): number => p.search?.impressions90d ?? 0; /** A ZERO SUPPRESSES THE CLAUSE THAT RANKS IT (rendered app, 2026-09-05). A live description read "20 pages carry the same templated description ... and /california-persian-cities/berkeley is the busiest of them at 0 impressions in 90 days", which calls a page the busiest and then prints the figure that says it is not. A superlative is a claim about a figure, so where the figure is zero the claim is dropped and the sentence that survives is the one the evidence carries. */ const ranked = (p: OwnedPageEvidence): string => impressions(p) > 0 ? `, and ${pathOf(p.url)} is the busiest of them at ${count(impressions(p), "impression")} in 90 days` : "";
  const rank = (list: OwnedPageEvidence[]): OwnedPageEvidence[] => [...list].sort((a, b) => impressions(b) - impressions(a) || pathOf(a.url).localeCompare(pathOf(b.url)));
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
  const wrong = new Map(rank(pages).flatMap((p) => { const proof = GAIN.wrongSubject(p, bodies.get(canonicalUrlKey(p.url)), now); return proof ? [[canonicalUrlKey(p.url), proof] as const] : []; }));
  for (const p of rank(pages.filter((p) => wrong.has(canonicalUrlKey(p.url))))) { const proof = wrong.get(canonicalUrlKey(p.url))!;
    out.push({ page: p, slug: "missing_description", field: "meta", query: topQueryOf(p), before: proof.before,
      headline: `Correct the search description that names ${proof.named} instead of ${proof.actual}`,
      after: `Replace the exact current description with one standalone sentence about ${proof.actual}, using only facts on this complete page.`,
      why: `The current description names ${proof.named}, but this page's title, heading and copy name ${proof.actual}. ${impressions(p) > 0 ? `The page had ${count(impressions(p), "search impression")} in 90 days, so readers may see the mismatch.` : ""}`.trim(),
      steps: [], hints: [proof.before, `Current page heading: ${proof.actual}`], minutes: 2, confidence: "high", refs: 2, impact: null,
      limitation: "The replacement may describe only the current page; the wrong subject's claims and any old proposed copy are not evidence.",
      cause: structural("ctr_snippet", "meta", [RECEIPT.copy], `The description names ${proof.named} while the current page is about ${proof.actual}.`, `A current complete page that actually covers ${proof.named} would not justify this correction.`) }); }
  const noMeta = rank(pages.filter((p) => !wrong.has(canonicalUrlKey(p.url)) && !p.content?.metaDescription?.trim() && (p.content?.wordCount ?? 0) >= READABLE_WORDS)); /* A PAGE WITH NO READABLE WORDS CANNOT BE DESCRIBED (2026-09-17): /persian-kabobs/joojeh-kabob holds seven words of chrome ("top of page < Back Joojeh Kabob Previous Next"), and the writer was paid twice to describe it, producing "the page names Joojeh Kabob, with no added description"; it joins the unread pages below until a rendered read lands */
  for (const p of noMeta) out.push({
    page: p, slug: "missing_description", field: "meta", query: topQueryOf(p),
    headline: "A search description of this page's own, where Google is writing one for it today", before: null,
    after: "Write a description of about 150 characters that names this page's subject and the one answer it gives, and ends on a fact about the page rather than an instruction to read it.",
    why: `${pathOf(p.url)} carries no description, so the line under its title in the results is Google's own writing. It was shown ${count(impressions(p), "time")} and earned ${count(clicksOf(p), "click")} in 90 days, ${impressions(p) >= 1000 ? "so that line is read a lot" : "so it is a small page today and this is a small fix"}.`,
    steps: [`Open the site editor on ${pathOf(p.url)}`, "Paste a description of about 150 characters", "Mark it done here and the click rate gets read again"],
    hints: [`${pathOf(p.url)} holds no description of its own`, `${pathOf(p.url)} earns ${count(impressions(p), "impression")} and ${count(clicksOf(p), "click")} in 90 days`, `${count(noMeta.length, "page")} with content stored carry no description`],
    minutes: 1, confidence: "medium", refs: 2, impact: recoverableClicks(p, expectedCtrAt),
    limitation: "Read off the last stored copy of this page, so a description added since that read is not counted here.", cause: structural("ctr_snippet", "meta", [RECEIPT.copy, RECEIPT.gsc], `${pathOf(p.url)} carries no description of its own, so the line under its title in the results is Google's writing rather than this page's.`, `If a description of its own is found on ${pathOf(p.url)} the next time its copy is read, nothing is missing here.`),
  });

  const boilerplate = new Map<string, OwnedPageEvidence[]>();
  for (const p of pages) {
    const meta = (p.content?.metaDescription ?? "").trim().toLowerCase();
    if (!meta) continue;
    const own = new Set([...labelOf(p).toLowerCase().split(/[^a-z0-9]+/), ...pathOf(p.url).toLowerCase().split(/[^a-z0-9]+/)].filter((t) => t.length > 2));
    const skeleton = meta.split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !own.has(t)).join(" ");
    if (skeleton.length > 40) boilerplate.set(skeleton, [...(boilerplate.get(skeleton) ?? []), p]);
  }
  const templated = [...boilerplate.values()].filter((g) => g.length >= 5);
  for (const p of rank(templated.flat()).filter((p) => !wrong.has(canonicalUrlKey(p.url)))) { // the meter is DELETED (operator, 2026-08-30): every page sharing the template gets its card
    const family = templated.find((g) => g.includes(p))!.length;
    out.push({
      page: p, slug: "missing_description", field: "meta", query: topQueryOf(p), minutes: 3, confidence: "low", refs: family, impact: recoverableClicks(p, expectedCtrAt),
      headline: `A search description of this page's own, where ${family} pages share one line`, before: (p.content?.metaDescription ?? "").trim() || null,
      after: "Write a description of about 150 characters that says what only this page answers, and ends on a fact about the page rather than an instruction to read it.",
      why: `${count(family, "page")} carry the same templated description with only the name swapped${ranked(p)}. A line every sibling repeats gives nobody a reason to click this one.`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, "Replace the templated description with one written for this page", "Mark it done here and the click rate gets read again"],
      hints: [`${count(family, "page")} share one templated description`],
      limitation: "Read off the last stored copy of each page, so a description rewritten since that read is not counted here.", cause: structural("ctr_snippet", "meta", [RECEIPT.copy, RECEIPT.gsc], `${count(family, "page")} of this site carry the same templated description with only the name swapped, so the line under ${pathOf(p.url)} in the results gives nobody a reason to click this one rather than a sibling.`, `If ${pathOf(p.url)} is found carrying a description no sibling repeats, there is nothing wrong with the line it has.`),
    });
  }

  const byH1 = new Map<string, OwnedPageEvidence[]>();
  for (const p of pages) { const h = (p.content?.h1 ?? "").trim().toLowerCase(); if (h) byH1.set(h, [...(byH1.get(h) ?? []), p]); }
  const dupes = [...byH1.values()].filter((g) => g.length > 1);
  for (const p of rank(dupes.flat())) {
    const heading = plain(p.content?.h1), sharers = (byH1.get((p.content?.h1 ?? "").trim().toLowerCase())?.length ?? 1) - 1;
    out.push({
      page: p, slug: "duplicate_heading", field: "h1", query: topQueryOf(p),
      headline: `A heading of this page's own, where ${count(sharers + 1, "page")} carry the same one`,
      before: heading, after: "Rewrite this heading so it names what only this page covers.",
      why: `"${heading}" is the heading on ${count(sharers + 1, "page")} of this site, which asks Google to pick between them.${impressions(p) > 0 ? ` ${pathOf(p.url)} earns ${count(impressions(p), "impression")} in 90 days, so it is the one to name first.` : ""}`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, "Rewrite the heading so it names what only this page covers", "Mark it done here and the positions get read again"],
      hints: [`${pathOf(p.url)} and ${count(sharers, "other page")} carry the heading "${heading}"`, `${pathOf(p.url)} earns ${count(impressions(p), "impression")} in 90 days`, `${count(dupes.length, "heading")} are duplicated across this site`],
      minutes: 1, confidence: "medium", refs: sharers + 1, impact: recoverableClicks(p, expectedCtrAt),
      limitation: "Headings are compared exactly as stored, so two headings that differ only by a stray word read as separate here.", cause: structural("ctr_snippet", null, [RECEIPT.copy, RECEIPT.gsc], `"${heading}" is the heading on ${count(sharers + 1, "page")} of this site, so nothing on ${pathOf(p.url)} tells a reader or Google which of them this search is for.`, `If ${pathOf(p.url)} is found carrying a heading no other page of this site repeats, there is nothing duplicated here.`),
    });
  }

  const winnersOnFile = (p: OwnedPageEvidence): boolean => {
    const head = [...(p.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0]?.query;
    const s = head != null ? (snapshot.research?.serpEvidence ?? []).find((e) => canonicalQueryKey(e.query) === canonicalQueryKey(head) && (e.organic ?? []).length > 0) : null;
    if (!s) return false; // A RESULTS PAGE SHAPES THIS PAGE ONLY WHEN IT IS ABOUT THIS PAGE'S SUBJECT (operator audit, 2026-09-01): rows merely existing proved the query was bought, not that the winners share the entity, so a person-profile page of results could shape an animal page. At least two winners must name a subject word this page names itself by.
    const subject = new Set(topicTokens(`${p.content?.title ?? ""} ${p.content?.h1 ?? ""}`));
    return subject.size > 0 && (s.organic ?? []).filter((o) => topicTokens(o.title ?? "").some((t) => subject.has(t))).length >= 2;
  };
  const gapsOf = (p: OwnedPageEvidence): string[] => winnersAgreeOn(snapshot, p);
  const currentWhole = (p: OwnedPageEvidence): boolean => { const body = bodies.get(canonicalUrlKey(p.url)); return body?.completeness === "complete" && body.version === "current"; };
  const expandable = rank(pages.filter((p) => (p.content?.wordCount ?? 0) > 0 && impressions(p) > 0 && winnersOnFile(p)))
    .map((p) => ({ p, gaps: gapsOf(p) })).filter((x) => x.gaps.length > 0);
  for (const { p, gaps } of expandable) {
    const stores = winnersAreStores(p);
    const shopStep = "Add a product block or shop link above the fold; the pages winning this search are stores.";
    const named = gaps.slice(0, 4);
    out.push({
      page: p, slug: "thin_page", field: "section", query: topQueryOf(p),
      headline: `The subject every page winning "${topQueryOf(p)}" covers and this one does not: ${named[0]}`,
      before: null,
      after: `Add a section to ${pathOf(p.url)} covering ${named.map((g) => `"${g}"`).join(", ")}: the pages winning "${topQueryOf(p)}" each carry ${named.length === 1 ? "this subject" : "these subjects"} and this page does not.`,
      why: `${pathOf(p.url)} is shown ${count(impressions(p), "time")} in 90 days for "${topQueryOf(p)}", and every page winning that search covers ${named.map((g) => `"${g}"`).join(", ")} while this page's own headings do not.`,
      steps: [`Open the site editor on ${pathOf(p.url)}`, `Add a section covering ${named[0]}`, ...(named.length > 1 ? [`Cover the other named ${named.length === 2 ? "subject" : "subjects"} too: ${named.slice(1).join(", ")}`] : []), ...(stores ? [shopStep] : []), "Mark it done here and the impressions get read again"],
      hints: [`The winners of "${topQueryOf(p)}" agree on: ${named.join(", ")}`, `${pathOf(p.url)} is shown ${count(impressions(p), "time")} and earns ${count(clicksOf(p), "click")} in 90 days`, `${count(expandable.length, "page")} of the ${pages.length} stored pages are missing a subject their search's winners agree on`],
      minutes: 30, confidence: "medium", refs: 3, impact: recoverableClicks(p, expectedCtrAt),
      limitation: "The missing subjects are read off the stored results page and the winners' own headings as last read; a subject added to the page since that read is not counted here.", cause: structural("incomplete_coverage", "section", [RECEIPT.copy, RECEIPT.pattern], `Every page winning "${topQueryOf(p)}" covers ${named.map((g) => `"${g}"`).join(", ")} and ${pathOf(p.url)} does not, on ${count(impressions(p), "impression")} in 90 days.`, `If ${pathOf(p.url)} is found covering ${named.map((g) => `"${g}"`).join(", ")} the next time its headings are read, nothing is missing here.`),
    });
  }
  const unread = rank(pages.filter((p) => (p.content?.wordCount ?? 0) < READABLE_WORDS && impressions(p) > 0 && !currentWhole(p)));
  for (const p of unread) {
    out.push({
      page: p, slug: "thin_page", field: "section", query: topQueryOf(p),
      headline: `A rendered read of a page shown ${count(impressions(p), "time")} whose words a raw fetch cannot see`,
      before: null,
      after: `Capture the real words on ${pathOf(p.url)} with a rendered read; no judgment about its content stands until that read lands.`,
      why: `${pathOf(p.url)} answers with a normal page and zero readable words, so it is built with javascript a raw read cannot run. What it carries is unknown rather than thin, and it is still shown ${count(impressions(p), "time")} in 90 days.`,
      steps: [],
      hints: [`${pathOf(p.url)} returns a normal response and zero readable words to a raw fetch`, `${pathOf(p.url)} is shown ${count(impressions(p), "time")} and earns ${count(clicksOf(p), "click")} in 90 days`],
      minutes: 0, confidence: "low", refs: 2, impact: null,
      limitation: "Nothing here is yours to do: the rendered read runs on the next research pass and this card updates itself.",
      next: "A rendered read captures the page's real words on the next research pass, without touching the page.",
      obligation: { kind: "evidence", need: { kind: "page_source", query: topQueryOf(p), url: p.url, reasonCode: "acquire_page_source" } },
    });
  }
  return out;
}
/** 4. THE SEARCH THIS PAGE ALREADY EARNS AND NEVER ANSWERS (operator, 2026-09-02). The largest opportunities on a live account are questions Google already sends a page and the page does not answer: 29,965 impressions on a flag page that never says "before", 3,502 asking which animal is Iran's national one. No cause payload names one, so no producer minted a body card for them and they never entered the paid plan at all. THE GAP READER DECIDES, NOT THIS FILE: the page's own demand is built by the one shared reading and typed by `substantiveGapOf`, so the search this card is minted on is the same search the writer is later refused or hired for, and the shape gate, the absent-word gate, the vocabulary refusal and the ownership ruling are asked once, in one place. NOTHING IS BOUGHT HERE: the card lands as research carrying the step that reading typed, which is the page's own capture while its words are not all on file, a source while nothing checked answers the search, and a draft once one does. */
/** Fewer readable words than this is page chrome, not a page: a raw fetch of a script-built page returns its furniture and nothing else. */ const READABLE_WORDS = 40;
function unansweredCards(snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], expectedCtrAt: (position: number) => number, read: { bodies: ReadonlyMap<string, OwnedPageBody>; misses: ReadonlyMap<string, "no_capture" | "read_failed">; facts: ReadonlyMap<string, FactCheck[]>; /** THE COPY THE CHANGES ALREADY ON FILE FOR EACH PAGE WOULD PUBLISH, keyed by the page's own path in lower case, so a question one of them already answers is not offered again. */ written: ReadonlyMap<string, { query: string; copy: string }[]>; basis: string | null; tenantId: string; now: Date }): Draft[] {
  const out: Draft[] = []; for (const p of pages) { const path = pathOf(p.url); if (path === "/" || STOREFRONT.test(path)) continue; // an essay never goes on the home page or a shop rail, the same rule every other body card here obeys
    const rows = p.search?.topQueries ?? []; if (read.misses.get(canonicalUrlKey(p.url)) === "read_failed") continue; // I COULD NOT LOOK IS NOT THIS PAGE DOES NOT ANSWER (reviewer, 2026-09-02): a chunk of the body read that refused typed its pages `read_failed`, the producer asked for no reasons at all, and a page with words on file read as bodyless, which mints the very card this reading exists to refuse. Nothing on file (`no_capture`) still mints, carrying the page's own capture as the step it owes. The impressions floor moved to the gap reader, where it is asked of the SEARCH rather than of the page
    const demand = demandOf(p, read.bodies.get(canonicalUrlKey(p.url)) ?? null, read.facts.get(path) ?? [], read.basis, read.tenantId, snapshot, null, read.written.get(path.toLowerCase()) ?? [], read.now), ordinary = substantiveGapOf({}, demand), body = read.bodies.get(canonicalUrlKey(p.url));
    const first = ordinary; /* THE WALK'S OWN READING, NOT A THINNER ONE (reviewer, 2026-09-02): built with no body and no checked fact, this mint claimed an absence off a title and three headings and the walk settled the same card terminal seconds later, because the stored body answered it. Same page, same words, same facts, same split ruling, so a card is minted on the reading it is later judged by. AND ONE PAGE IS A CONTAINER OF ATOMIC OPPORTUNITIES (Product Truth, one page is never one opportunity; campaign, 2026-09-05): this producer took the largest unanswered search and stopped there, so while that one change stood unimplemented every smaller unanswered search on the same page was invisible. Up to FOUR a pass; their durable seats are chosen after minting from every historical binding, never from today's ordinal. */ for (const gap of ((): (typeof first | null)[] => { const chain: (typeof first | null)[] = [first]; const keys: string[] = first?.query ? [canonicalQueryKey(first.query)] : []; for (let i = 0; i < 3 && keys.length === i + 1; i += 1) { const g = substantiveGapOf({}, demand, keys.join(",")); chain.push(g); if (g?.query) keys.push(canonicalQueryKey(g.query)); } return chain; })()) {
    /* THREE OF THE FIVE VERDICTS ARE WORK, AND THEY ARE NOT THE SAME WORK (operator, 2026-09-05). The gap reader classifies the page's own demand against its complete passages, and this producer used to mint only on `missing_answer`, so a search the page answers IN PIECES was invisible and a page whose words are not all on file was minted as an absence. A scattered answer is brought together and never added to; an incomplete capture is read before anything is claimed about it. A page that answers in one passage still mints nothing. */ if (!gap?.query || gap.impressions == null || !(MINTED_KINDS.has(gap.kind) || (gap.kind === "no_substantive_gap" && gap.owed?.kind === "evidence"))) continue; // a split this page does not own, a page whose own passage already answers this, and a search that names nothing all land here as nothing. THE OBSERVATION KINDS ARE MINTED AND AN OWED READING IS BOUGHT (audit, 2026-09-14): incomplete_answer and the typed shapes were dropped here, so the "see what wins and write a better version" door existed in the diagnosis and reached no row; a search whose winners nobody has read now rides its evidence obligation instead of being discarded
    const spread = gap.kind === "scattered_answer", unknown = gap.kind === "unknown_capture", owes = gap.kind === "no_substantive_gap", observed = gap.kind === "incomplete_answer" || gap.kind === "false_page_promise", q = gap.query, seen = count(gap.impressions, "search", "searches"), row = rows.find((r) => canonicalQueryKey(r.query) === canonicalQueryKey(q));
    const held = rows.map((r) => r.position).filter((n): n is number => n != null), at = row?.position ?? (held.length > 0 ? Math.min(...held) : 10); // A ROW WITH NO POSITION IS NOT A CARD WORTH NOTHING (reviewer, 2026-09-02): a null impact ranked Tehran's 8,531-impression question last and the plan funded it at zero, so the best receipt position this page holds stands in, and position 10 where it holds none
    const impact = Math.max(0, Math.round((expectedCtrAt(at) - Math.min(1, (row?.clicks ?? 0) / Math.max(1, row?.impressions ?? 1))) * gap.impressions * TO_28_DAYS)); // the same curve, the same arithmetic and the same unit as every other card here, run on the whole demand behind the missing answer rather than on one of the ways it is asked
    const joined = body ? [body.title, body.h1, ...body.headings, ...body.passages].filter(Boolean).join("\n") : "", checked = authorizedCorrections(read.facts.get(path) ?? [], { pageContentHash: body ? pageHashOf(joined) : null, evidenceBasis: read.basis, ...(body ? { body: joined } : {}) }, read.tenantId);
    out.push({ page: p, factIdentity: JSON.stringify(checked.map((f) => [f.statementKey, f.sourceReadAt ?? f.checkedAt]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))), slug: "missing_answer", field: spread ? "section" : "answer_block", query: q, asked: q, treatment: spread ? "rewrite_existing_section" : "add_answer_section", obligation: gap.owed ?? { kind: "draft" },
      headline: spread ? `One place a reader can lift this page's answer to "${q}", worth ${seen} in 90 days` : unknown ? `A full read of this page before "${q}" is called unanswered, worth ${seen} in 90 days` : owes ? `A read of what wins "${q}" before this page writes for the ${seen} in 90 days behind it` : observed ? `A better version of what wins "${q}" for the ${seen} in 90 days this page does not carry` : `An answer to "${q}" for the ${seen} in 90 days this page does not answer`,
      before: null, after: owes ? `Read the pages winning "${q}" before deciding whether ${path} needs any change.` : spread ? `One passage on ${path} that states this page's own answer to "${q}" outright, in one place a reader can lift.` : observed && gap.propositions[0] ? `One section on ${path} about ${gap.propositions[0]}, which a page winning "${q}" carries and this page does not, written better than the winner carries it.` : `One section on ${path} that answers "${q}" for a reader who asked exactly that, in this page's own voice.`, why: gap.why ?? `${seen} in 90 days put ${path} in front of people asking "${q}", and nothing in this page's own words answers it.`,
      steps: owes ? [] : [`Open your site editor on ${path}`, spread ? "Put the passage above where a reader asking this would look first" : "Add the section above where a reader asking this would look for it", "Come back here and mark it done, and measurement starts"],
      hints: [`"${q}" is worth ${seen} in 90 days on ${path}`, spread ? `This page's own words answer "${q}" across several places and in none of them outright` : unknown ? `Not all of this page's own words are on file, so nothing here claims "${q}" is absent` : observed || owes ? gap.why ?? `A page winning "${q}" carries what this one does not: ${gap.propositions[0] ?? q}` : `Nothing in this page's stored title, headings or copy answers "${q}"`], // the winner's own observation, quoted, is the evidence hint for an observation kind
      minutes: owes ? 0 : 30, confidence: owes ? "low" : "medium", refs: 2, impact, demand: gap.impressions, limitation: owes ? "No content gap is diagnosed yet: this page already answers the search, and the pages winning it have not been read for a distinct improvement." : "The absence is read off this page's own stored words as last captured, so a passage added since then is not counted.", /* a caveat, never the reason again: the reason already prints under "Why this ranks here" and printed a second time under "Keep in mind" (operator walk, 2026-09-16) */ // THE AUDIENCE IS THE SEARCH'S OWN, never the page's whole 90 days: a question worth 310 searches on a page shown 68,000 times inherited all 68,000 and outranked work that could really win them
      next: owes ? `Read the exact results page and winning pages for "${q}"; only a distinct, evidenced improvement may become an edit.` : "The page's own words are read first, then a source for the answer, and the exact copy lands here once one is on file.",
      ...(owes ? {} : { cause: { cause: "incomplete_coverage" as const, action: "opening_answer" as const, evidenceKeys: [RECEIPT.gsc], competingExplanations: [], notConsidered: [], explanation: spread ? `Google shows ${path} to ${seen} in 90 days for "${q}" and this page's own words answer it in pieces rather than in one place.` : unknown ? `Google shows ${path} to ${seen} in 90 days for "${q}" and this page's own words are not all on file yet.` : `Google shows ${path} to ${seen} in 90 days for "${q}" and the page's own stored words never answer it.`,
        falsifier: spread ? `If one passage of this page turns out to answer "${q}" on its own, there is nothing to bring together here.` : `If this page's stored copy turns out to answer "${q}" once the whole page is read, there is no missing answer here.` } }) }); } }
  return out.sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0) || a.page.url.localeCompare(b.page.url)); } // ONE SEARCH BELONGS TO THE PAGE THAT EARNS IT (reviewer, 2026-09-02): where the ladder names no survivor, the dedupe behind this producer kept whichever page the snapshot listed first, so row order decided which of two pages answered a shared search; the strongest demand for it goes first and takes the card
/** Every extra card this account's stored evidence already supports, at `needs_review`, deduplicated against the queue it holds. Never throws: a source that will not read narrows the answer instead of failing the pass. */
export async function extraQueueCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date;
  /** THE PASS'S AEO DIAGNOSIS PURSE. Absent means an UNFUNDED caller, so nothing is bought and every case stays owed. */
  aeoDiagnoses?: number; focusPage?: string;
  /** THE BAR THIS ACCOUNT'S OWN SEARCHES ARE HELD TO, threaded from the pass that fitted it. Absent falls back to the industry table, a far more generous bar, so a caller that can fit one should. */
  curve?: Pick<TenantCtrCurve, "expectedCtrAt">;
  /** THE PASS'S PAGE-READING BUDGET, the second of the two named budgets a production pass owns. Handed in so the one paid read this file makes is counted where every other paid call is counted. */
  reads?: { left: number };
  /** THE CANONICAL DEMAND UNITS, loaded once by the pass and handed to every producer that joins audiences. */
  units?: readonly CanonicalDemandUnit[];
  /** THE EVIDENCE GENERATION THIS PASS WORKS UNDER, the one the walk authorizes checked statements against. */ basis?: string | null; checked?: readonly FactCheck[] | null;
  /** Default true. False on a dry run, and then nothing this producer concludes is written down either. */
  persist?: boolean }): Promise<ExtraQueueRun> {
  const { tenantId, snapshot, now } = input;
  const expectedCtrAt = input.curve?.expectedCtrAt ?? defaultExpectedCtrAt;
  const answersRead = snapshot.sources.some((s) => s.source === "native_ai" && s.status === "fresh");
  const DEFECTS = ["missing_description", "duplicate_heading", "thin_page", "missing_answer"];
  const pages = snapshot.ownedPages.filter((p) => !!p.content);
  if (pages.length === 0) return { cards: [], complete: false, families: [], held: [], needsOwnPage: [] };
  const weak = weakAnchorsOf(snapshot.ownedPages, snapshot.research);
  const meter: AeoMeter = aeoMeter(input.aeoDiagnoses ?? 0);
  const earned = new Map(pages.map((p) => [p.url, earnedWords(p, weak)]));
  const children = new Map(pages.map((p) => [pathOf(p.url), pages.filter((o) => o !== p && pathOf(o.url).startsWith(`${pathOf(p.url)}/`)).length]));
  const [store, durableSeats] = await Promise.all([loadChangeProposals(tenantId), proposalSeats.loadProposalSeats(tenantId, pages.map((page) => pathOf(page.url)))]).catch(() => [null, null] as const);
  if (!store || !durableSeats) return { cards: [], complete: false, families: [], held: [], needsOwnPage: [] };
  const rows = [...store.values()];
  const seats = [...durableSeats, ...rows.map((row) => ({ id: row.id, mutationKey: footprintKey(row) }))];
  const taken = new Set(rows.flatMap((p) => [...mutationFootprint(p)]));
  const mine = new Set(rows.map((p) => p.id)); /* AND WHAT THOSE ROWS ALREADY WRITE, IN WORDS (production 02:30Z, 2026-09-06). The footprint above refuses a second card writing the same MUTATION, and two sections answering two phrasings of one question are two mutations, so a page holding a Ready sentence for "X before 1979" was given a second Ready change for "X before revolution" carrying that identical sentence. The words a live change would publish go to the gap reader, which asks whether they answer the next question behind the biggest one by the same rule it reads the page's own passages by. Body words only, decided by the footprint that is already the definition of what a change writes, and never a brief: a row whose copy field says its words are not written yet answers nothing. */ const written = new Map<string, { query: string; copy: string }[]>(); for (const r of rows) { const copy = r.researchOnly === true || ![...mutationFootprint(r)].some((k) => k.includes("::body::")) ? "" : [r.recommendedChange.kind === "existing_edit" ? r.recommendedChange.after : "", ...(r.bundle?.components ?? []).map((c) => c.after ?? "")].join(" ").trim(); if (!copy) continue; const at = (r.pagePath ?? "").trim().toLowerCase(); written.set(at, [...(written.get(at) ?? []), { query: r.primaryQuery ?? "", copy }]); }
  const eligible = pages.filter((p) => { const path = pathOf(p.url); return path !== "/" && !STOREFRONT.test(path); });
  const u = await pageUnderstanding(tenantId, eligible, { now, openPaths: new Set(rows.map((p) => (p.pagePath ?? "").toLowerCase())), ...(input.reads ? { reads: input.reads } : {}) });
  const bank: { query: string; refusedPages?: string[] }[] = [];
  const misses = new Map<string, "no_capture" | "read_failed">(), bodies = await loadOwnedPageBodies(tenantId, pages.map((p) => p.url), misses).catch(() => { for (const p of pages) misses.set(canonicalUrlKey(p.url), "read_failed"); return new Map<string, OwnedPageBody>(); }); // WHY A PAGE HAS NO WORDS HERE, typed by the reader itself: a read that threw makes every page UNKNOWN rather than wordless, and an unknown page mints nothing at all
  const currentBodies = new Map([...bodies].filter(([, body]) => isCurrent("owned_page", body.fetchedAt, now.getTime())));
  const facts = new Map<string, FactCheck[]>(); for (const f of input.checked === null ? [] : input.checked ?? await readFactChecks(tenantId).catch(() => [])) facts.set(f.page, [...(facts.get(f.page) ?? []), f]);
  const answerCaptures = new Map<string, Record<string, unknown>>(); for (const row of rows.filter((r) => r.researchOnly === true && /::existing_edit::missing_answer(?:@[^:]*)?$/.test(r.id))) { const p = pages.find((page) => canonicalUrlKey(page.url) === canonicalUrlKey(row.pageUrl ?? "")), key = canonicalUrlKey(p?.url ?? ""), body = currentBodies.get(key), capture = body?.captureStates?.find((s) => s.id === body.captureId), query = p?.search?.topQueries.find((q) => canonicalQueryKey(q.query) === canonicalQueryKey(row.primaryQuery ?? "") && Math.max(q.impressions, row.demandImpressions90d ?? 0) >= 30); if (!p || !query || topicTokens.semanticAtoms(query.query).length < 2 || /[^\x00-\x7f]|(?:^|\s)(?:site|inurl|intitle|filetype):/i.test(query.query) || misses.get(key) === "read_failed" || body?.version !== "current" || body.completeness !== "complete" || body.sourceCapture?.complete !== true || !body.pageId || body.captureId !== body.latestCaptureId || !body.contentHash || capture?.page_id !== body.pageId || capture?.content_hash !== body.contentHash || capture?.url !== body.url || (capture?.final_url ?? null) !== (body.finalUrl ?? null) || capture?.fetched_at !== body.fetchedAt || capture?.extraction_certainty !== "confirmed" || typeof capture?.body_text !== "string" || JSON.stringify(capture?.content_capture) !== JSON.stringify(body.sourceCapture) || canonicalUrlKey(body.url) !== key || !!body.finalUrl && canonicalUrlKey(body.finalUrl) !== key || !!p.content?.revision?.content_hash && p.content.revision.content_hash !== body.contentHash) continue; const demand = demandOf(p, body, facts.get(pathOf(p.url)) ?? [], input.basis ?? null, tenantId, snapshot, null, written.get(pathOf(p.url).toLowerCase()) ?? [], now); if (substantiveGapOf(row, { ...demand, rows: [{ query: query.query, impressions: Math.max(query.impressions, row.demandImpressions90d ?? 0) }] }) === null) answerCaptures.set(row.id, capture); }
  const links = await linkCards(tenantId, pages, weak, u, expectedCtrAt, bodies);
  const day = (d: Date): string => d.toISOString().slice(0, 10);
  const windowRows = await readAiObservations(tenantId, { fromDay: day(new Date(now.getTime() - 27 * 86_400_000)), toDay: day(now), slot: 0, projection: "fanout" }).catch(() => null);
  const windowObs = windowRows?.map((r) => canonicalPairOf(r)) ?? null;
  const universe = await import("@/domains/evidence/readers/gsc-query-universe")
    .then((m) => m.loadGscQueryUniverse(tenantId, now)).catch(() => null);
  const cases = await aiCaseCards(bank, snapshot, pages, weak, earned, children, u, tenantId, input.units ?? [], windowObs, now, input.persist !== false, meter, universe?.keys ?? null, written, input.focusPage);
  const drafts = [...cases.drafts,
    ...links.drafts, ...technicalCards(pages, snapshot, expectedCtrAt, currentBodies, now), ...unansweredCards(snapshot, pages, expectedCtrAt, { bodies: currentBodies, misses, facts, written, basis: input.basis ?? null, tenantId, now })]; // LAST, so an AI case about the same question keeps it: one question is one card
  const out: ChangeProposal[] = [];
  const answered = new Set<string>();
  for (const d of drafts) {
    const asks = "asked" in d && d.asked ? [canonicalQueryKey(d.query), canonicalQueryKey(d.asked)].filter(Boolean) : [];
    if (asks.some((k) => answered.has(k))) continue;
    let card = "page" in d ? mint(tenantId, d, now) : d;
    const mutationKey = footprintKey(card), id = proposalSeats.seatFor(card.id, mutationKey, seats);
    if (id !== card.id) card = { ...card, id };
    const prints = [...mutationFootprint(card)];
    if (prints.some((k) => taken.has(k)) && !mine.has(card.id)) continue;
    for (const k of prints) taken.add(k);
    for (const k of asks) answered.add(k);
    seats.push({ id: card.id, mutationKey });
    out.push(card);
  }
  const families = [...(answersRead && cases.filed ? ["ai_answer_gap", "engine_followup"] : []), ...(links.complete ? ["internal_link"] : []), ...DEFECTS];
  if (families.length < DEFECTS.length + 3) log.warn("[extra] a source did not answer, so its families are held out of the sweep", { tenantId, families });
  log.info("[extra] the pass's AEO diagnosis purse", { tenantId, ...meter.spent(), refused: cases.hold.size });
  return { cards: out, complete: families.length === DEFECTS.length + 3, families, answerCaptures, held: u.held, needsOwnPage: bank, aeoHold: cases.hold, aeoSpend: meter.spent() };
}

/** THE ONE ENTRANCE FOR A PASS: loads the demand units once (both producers join the SAME audiences) and runs the $0 queue. The paid funnel's early return used to skip this producer entirely, so a paused quiet account never judged a single AI case (first canonical $0 acceptance run, 2026-08-21). */
export async function extraQueuePass(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date;
  curve?: Parameters<typeof extraQueueCards>[0]["curve"]; reads?: { left: number }; persist?: boolean; aeoDiagnoses?: number; focusPage?: string; basis?: string | null; checked?: readonly FactCheck[] | null }): Promise<{
  run: ExtraQueueRun; unitLoad: Awaited<ReturnType<typeof import("@/domains/evidence/demand-unit-loader")["loadCanonicalDemandUnits"]>> | null }> {
  const unitLoad = await import("@/domains/evidence/demand-unit-loader")
    .then((m) => m.loadCanonicalDemandUnits(input.tenantId, input.snapshot, input.curve, input.now)).catch(() => null);
  const run = await extraQueueCards({ ...input, ...(unitLoad ? { units: unitLoad.units } : {}) })
    .catch(() => ({ cards: [], complete: false, held: [], needsOwnPage: [], families: [] as string[] }));
  return { run, unitLoad };
}
