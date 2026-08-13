/**
 * decision/authorization: THE ONE PLACE THAT ASKS WHETHER A CHANGE IS ALLOWED TO BE OFFERED AT ALL.
 *
 * A producer mints on its own evidence and the ranking picks the biggest number, so a page whose own evidence
 * says two of your pages are splitting one search could still lead the queue with "add more copy to one of
 * them", which is the one thing that makes the split worse. THE LEVER MUST TREAT THE WINNING DIAGNOSIS FOR THE
 * PAGE. Where it cannot, the card is withheld with its reason on the run receipt, and the work the diagnosis
 * DID prescribe is minted instead.
 *
 * `CAUSE_LEVERS` is the truth table, and it lives here rather than inside the ranking because two places now
 * read it: the ranking discounts a mismatch, and this boundary refuses one. PURE, no I/O, no clock beyond the
 * one a caller hands in.
 */

import type { BundleComponentKind, ChangeProposal } from "./contracts";
import { causeLabel, type CauseFinding } from "./diagnosis";

/** The cause ladder's own vocabulary. Read from there, never re-declared here. */
type Cause = CauseFinding["cause"];

/**
 * WHICH LEVERS ADDRESS WHICH CAUSE. Keyed on the cause ladder's OWN union and deliberately TOTAL: adding a cause over there breaks the build here until somebody says what fixes it,
 * which is the only way this table can never quietly fall behind the diagnosis.
 *
 * An EMPTY set is a real answer, not an omission: nothing you can write on the page fixes a search fewer people run, or a change that is already being measured. A cause with no lever
 * matches nothing, discounts nothing and refuses nothing, so those proposals rank on their other factors.
 *
 * THE OLDER SEVEN KINDS BELONG IN THESE SETS TOO. `section`, `internal_links` and `source_pack` are the undifferentiated components persisted rows still carry, and leaving them out of every set meant a stored
 * change was discounted the full 25 for the age of its vocabulary rather than for what it does.
 */
export const CAUSE_LEVERS: Record<Cause, ReadonlySet<BundleComponentKind>> = {
  cannibalization: new Set(["consolidation", "canonical", "redirect", "noindex", "internal_link_remove", "internal_links"]),
  ctr_snippet: new Set(["title", "meta", "h1", "anchor_text"]),
  competitor_content_gap: new Set(["section_add", "entity_expansion", "full_rewrite", "table_or_list_add", "new_page", "section"]),
  incomplete_coverage: new Set(["section_add", "entity_expansion", "table_or_list_add", "full_rewrite", "new_page", "section"]),
  weak_opening: new Set(["opening_answer", "h1", "paragraph_correction", "restructure"]),
  serp_shape_shift: new Set(["restructure", "table_or_list_add", "schema", "section_rewrite", "opening_answer", "section"]),
  intent_shift: new Set(["full_rewrite", "restructure", "section_rewrite", "title", "new_page", "section"]),
  // `section` belongs in these three for the same reason the older seven kinds do: a section is what a producer
  // here actually mints, and leaving it out refused the very cards that answer an engine citing everybody else.
  internal_link_weakness: new Set(["internal_link_add", "anchor_text", "navigation", "internal_link_remove", "internal_links", "section"]),
  ai_citation_gap: new Set(["source_update", "factual_correction", "entity_expansion", "schema", "opening_answer", "source_pack", "section"]),
  retrieved_not_cited: new Set(["opening_answer", "table_or_list_add", "schema", "source_update", "entity_expansion", "source_pack", "section"]),
  technical_indexability: new Set(["noindex", "canonical", "redirect", "navigation"]),
  // FEWER PEOPLE RUNNING THE SEARCH IS NOT A PAGE DEFECT. Nothing you can write on the page brings the searches
  // back, so this one stays deliberately empty: it matches nothing, discounts nothing, and those cards rank on
  // their other factors. Filling it in to make decline cards score would be scoring them for a fix that is not one.
  demand_decline: new Set([]),
  // LOSING GROUND ON A SEARCH PEOPLE STILL RUN IS A CONTENT PROBLEM, and it was the last empty set that made a
  // real decline card score zero for cause fit while a description errand scored its full 25. These are the
  // levers that move a page back up a search it is still shown for.
  // No title here on purpose: a sharper line does not win back a position something better took.
  ranking_loss: new Set(["section_add", "full_rewrite", "opening_answer", "internal_links", "section", "restructure"]),
  measuring_change: new Set([]),
  no_problem: new Set([]),
};

/** THE FAMILY CARD'S OWN FAMILY. A split is settled by telling the competing pages apart, which is a wording
 *  change, and wording is exactly what a split does NOT authorize on one page on its own. The difference is
 *  scope: this card names every competing page and carries the assignment for each, so it is the diagnosis's
 *  own prescription rather than a sharper line on one of two pages still fighting. */
const OWNERSHIP_FAMILY = "ownership";
/** The family a diagnosed problem with no drafting evidence yet lands under. */
const RESEARCHING_FAMILY = "researching";
/**
 * THE MARKER THAT SAYS THIS CARD IS NOT AN EDIT. It rides on `limitations`, where the operator reads it as the
 * plain truth about the card, and every surface that would otherwise offer a Copy button matches its stable
 * phrase: the ranking, Today's one big move, and the queue card. A researching row rendered as "Change the
 * section" over a paste box, under a receipt calling it safe to paste and waiting on review, which is three
 * claims about work nobody has written. Matched on the phrase rather than exported, exactly as the drafted-copy
 * marker above it is, because the readers sit on the other side of the kernel facade.
 */
const RESEARCH_MARKER = "Nothing here is ready to paste: this card is research, not an edit.";

/** The component kinds this proposal actually touches. A bundled change says so
 *  directly; a pre-bundle row is read off its one exact edit. */
function leversOf(p: ChangeProposal): BundleComponentKind[] {
  const bundled = p.bundle?.components.map((c) => c.kind) ?? [];
  if (bundled.length > 0) return bundled;
  const c = p.recommendedChange;
  if (c.kind === "new_page") return ["new_page"];
  return [c.field === "answer_block" ? "opening_answer" : c.field];
}

/** Does this change work on the cause the evidence NAMED? A cause with no lever at all is treated as no cause: it matches nothing and it punishes nothing. */
function treatsCause(p: ChangeProposal, cause: Cause | null | undefined): boolean {
  const levers = cause ? CAUSE_LEVERS[cause] : undefined;
  if (!levers || levers.size === 0) return true;
  if (cause === "cannibalization" && p.changeFamily === OWNERSHIP_FAMILY) return true;
  return leversOf(p).some((k) => levers.has(k));
}

/** THE SIX FIELDS A CARD IN THIS PRODUCT CAN ACTUALLY CARRY. Everything else in the lever vocabulary is a
 *  component a bundle may hold, and a page that never got one cannot be refused for not having one. */
const MINTABLE: ReadonlySet<BundleComponentKind> = new Set<BundleComponentKind>(["title", "meta", "h1", "opening_answer", "section", "new_page"]);
/** A CAUSE NO PRODUCER HERE CAN TREAT MAY NOT EMPTY THE QUEUE. Refusing every card on such a page leaves the
 *  operator holding a diagnosis and nothing to do about it, which is worse than an imperfect card: how a page
 *  is SERVED is the live example, and its fix is plumbing no card in this product writes. THE SPLIT IS THE
 *  EXCEPTION, and the exception is a card: the ownership family below is exactly what treats it. */
const treatable = (cause: Cause): boolean => cause === "cannibalization" || [...CAUSE_LEVERS[cause]].some((k) => MINTABLE.has(k));

/** What this card actually does, in the operator's words, for the sentence that says why it was held. */
const LEVER_WORDS: Record<string, string> = { title: "a new title", meta: "a new description", h1: "a new heading",
  answer_block: "a new opening", section: "more copy on this page", new_page: "a new page" };

/**
 * WHY THIS CARD MAY NOT BE OFFERED, or null when it may. `cause` is the winning diagnosis for the card's own
 * page, read off the pass that judged it. A page with no material diagnosis authorizes everything, exactly as
 * before: this refuses only where the evidence NAMED something the card cannot touch.
 */
export function withholdReason(p: ChangeProposal, cause: Cause | null | undefined): string | null {
  if (!cause || !treatable(cause) || treatsCause(p, cause)) return null;
  const lever = p.recommendedChange.kind === "new_page" ? "new_page" : p.recommendedChange.field;
  return `held: this page's own evidence names ${causeLabel(cause)}, and ${LEVER_WORDS[lever] ?? "this change"} does not treat it. Settle that first and this card comes back.`;
}

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
/** A PATH IS ALREADY A PATH. Prefixing a scheme onto "/iran-flags/qajar-empire-flags" makes the first segment
 *  the HOST, so the ladder's own competingPaths came back as "/" and "/qajar-empire-flags": a card naming pages
 *  its evidence never named. Anything starting with a slash is returned as it was given. */
const pathOf = (url: string): string => {
  const u = url.trim();
  if (u.startsWith("/")) return u.replace(/\/+$/, "") || "/";
  try { return new URL(u.startsWith("http") ? u : `https://${u}`).pathname.replace(/\/+$/, "") || "/"; } catch { return u; } };

type CardBase = { tenantId: string; now: Date; basis: string | null; pageUrl: string; pageLabel: string;
  query: string; finding: CauseFinding; demandImpressions90d: number | null };

const shell = (b: CardBase, family: string, impactScore: number | null): Omit<ChangeProposal, "opportunityType" | "recommendedChange" | "whyItMatters" | "operatorSteps" | "estimatedEffortMinutes" | "confidence" | "limitations" | "evidence"> => ({
  id: `${b.tenantId}::${pathOf(b.pageUrl).toLowerCase()}::existing_edit::${family}`, tenantId: b.tenantId,
  kind: "existing_edit", pagePath: pathOf(b.pageUrl), pageUrl: b.pageUrl.startsWith("http") ? b.pageUrl : `https://${b.pageUrl}`,
  pageLabel: b.pageLabel, primaryQuery: b.query, changeFamily: family, status: "needs_review", riskLevel: "low",
  impactScore, upsidePerMonth: null, demandImpressions90d: b.demandImpressions90d, publish: "manual",
  createdAt: b.now.toISOString(), ...(b.basis ? { basis: b.basis } : {}),
  diagnosisCause: b.finding.cause, causeFinding: b.finding,
});

/** What one page of this account looks like from here: enough to label a card and size it, nothing more. */
type Judged = { cause: CauseFinding; recoverableClicks: number; pageUrl?: string | null; query?: string | null; gap?: string };
type Page = { url: string; content?: { title?: string | null; h1?: string | null } | null; search?: { impressions90d: number } | null };
const keysOf = (url: string | null | undefined): string[] => {
  const u = (url ?? "").trim().toLowerCase();
  if (!u) return [];
  return [...new Set([u, pathOf(u)])]; };
const labelOf = (p: Page | undefined, fallback: string): string => p?.content?.h1 ?? p?.content?.title ?? fallback;
type Wiring = { tenantId: string; now: Date; basis: string | null; pages: readonly Page[] };
/** ONE PAGE, WHATEVER SPELLING ASKED FOR IT: a door carries the absolute address and the stored row often
 *  carries a bare one, so the two are matched on every key either of them can wear, never on the raw string. */
const pageFor = (w: Wiring, url: string): Page | undefined => {
  const want = new Set(keysOf(url));
  return w.pages.find((o) => keysOf(o.url).some((k) => want.has(k)));
};

/** How many splits one pass may hand over at once. A queue of merges is nobody's morning. */
const MAX_OWNERSHIP = 3;

/**
 * ONE CARD PER SPLIT, MINTED OFF THE DIAGNOSED SPLITS THEMSELVES rather than off whichever page a deep read
 * happened to refuse. The boundary refuses every content card on every page a split names, so if the card that
 * settles the split only existed for the one page a door reached, four other pages were told to settle
 * something nothing here settles. `covered` is every page key a minted card speaks for, and it is EXACTLY the
 * set the caller may refuse cards on: no card, no refusal.
 *
 * Strongest split first, bounded, deterministic. No address moves, so the risk is low and the whole change is
 * wording that says which search each page answers.
 */
export function ownershipCards(w: Wiring & { judged: readonly Judged[]; queryKeyOf: (q: string) => string }): { cards: ChangeProposal[]; covered: Set<string> } {
  const groups = new Map<string, { c: Judged; paths: readonly string[]; survivor: string | null; unproven: string[] }>();
  for (const c of w.judged) {
    const p = c.cause.payload;
    if (c.cause.cause !== "cannibalization" || p?.cause !== "cannibalization" || !c.query || !c.pageUrl) continue;
    // WHAT IS COUNTED IS WHAT IS NAMED: the ladder's own group, whole, so the sentence it wrote and the list
    // this card prints are the same pages. Nothing is sliced off here.
    const paths = [...new Set([c.pageUrl, ...p.competingPaths].map((u) => pathOf(u)))];
    if (paths.length < 2) continue;
    const key = w.queryKeyOf(c.query), held = groups.get(key);
    if (!held || c.recoverableClicks > held.c.recoverableClicks) groups.set(key, { c, paths, survivor: p.survivor ? pathOf(p.survivor) : null, unproven: p.comparison.filter((r) => r.clicks == null).map((r) => pathOf(r.url)) });
  }
  const cards: ChangeProposal[] = [], covered = new Set<string>();
  for (const g of [...groups.values()].sort((a, b) => b.c.recoverableClicks - a.c.recoverableClicks
    || (a.c.pageUrl ?? "").localeCompare(b.c.pageUrl ?? "")).slice(0, MAX_OWNERSHIP)) {
    const url = g.c.pageUrl!, own = pageFor(w, url);
    if (!own) continue;
    cards.push(ownershipCard({ tenantId: w.tenantId, now: w.now, basis: w.basis, pageUrl: url, pageLabel: labelOf(own, url),
      query: g.c.query!, finding: g.c.cause, demandImpressions90d: own.search?.impressions90d ?? null,
      competingPaths: g.paths, survivor: g.survivor, unproven: g.unproven,
      impactScore: g.c.recoverableClicks > 0 ? g.c.recoverableClicks : null }));
    for (const u of g.paths) for (const k of keysOf(u)) covered.add(k);
  }
  return { cards, covered };
}

/**
 * ONE DECISION, ONE PRESCRIPTION, ZERO CONTRADICTIONS. This card used to assign the search to the page it was
 * filed under while the finding's own payload named a different survivor, and to promise "nothing here moves an
 * address" while the finding's action was `consolidate`. It reads the finding now and never argues with it.
 *
 * AND IT NEVER HANDS THE STRATEGY BACK. Telling an operator to "give the other pages wording that names what
 * each answers" is the whole job, restated as homework. Settling a split takes the owner of the head search,
 * the distinct search every other page is for, and the exact title and opening line for each, and none of that
 * is drafted here yet. So this card asks for nothing: it states what the evidence settled, names what is still
 * owed, and carries the loss it is ranked on. It is RESEARCH until every one of those exists.
 */
function ownershipCard(b: CardBase & { competingPaths: readonly string[]; survivor: string | null; unproven: readonly string[]; impactScore: number | null }): ChangeProposal {
  const mine = pathOf(b.pageUrl);
  // THIS PAGE FIRST, then the rest in a fixed order, and ALL of them: the ladder's count and this list are one
  // number, so the same split always produces the same sentence and nothing on file moves on a settled pass.
  const named = [mine, ...[...new Set(b.competingPaths.map((u) => pathOf(u)))].filter((p) => p !== mine).sort()];
  const list = named.join(", ");
  // WHAT THE FINDING ITSELF CONCLUDED. `consolidate` is a merge, and a merge moves an address; saying otherwise
  // over the top of it is the contradiction this card exists to stop.
  const merges = b.finding.action === "consolidate";
  const settled = b.survivor && named.includes(b.survivor) ? b.survivor : null;
  const plan = settled
    ? `Your own figures name ${settled} as the page to keep, and settling it is ${merges ? "a merge, which moves an address" : "wording that tells these pages apart"}.`
    : `Which of them should own it is not settled: ${b.unproven.length > 0
      ? `${b.unproven.join(" and ")} ${b.unproven.length === 1 ? "carries" : "carry"} no clicks of ${b.unproven.length === 1 ? "its" : "their"} own for that search on file, so no page here is proven to be the one to keep`
      : "no page here is far enough ahead on both clicks and position for the figures to pick one"}.`;
  const owed = `The exact ${merges && settled ? "addresses to forward and the wording that survives" : "titles and opening lines that would tell these pages apart"} have not been drafted, so nothing here is an instruction yet.`;
  return {
    ...shell(b, OWNERSHIP_FAMILY, b.impactScore),
    opportunityType: settled ? `Settle "${b.query}": the figures name ${settled} as the page to keep`
      : `Find out which of your pages should own "${b.query}"`,
    recommendedChange: { kind: "existing_edit", field: "section", before: null,
      after: `${num(named.length)} of your own pages come up for "${b.query}": ${list}. ${plan} ${owed}` },
    whyItMatters: `${b.finding.explanation} Adding copy to one of them on its own leaves them competing, so ownership is settled first and every other change on these pages waits behind it. ${plan}`,
    estimatedEffortMinutes: 0, confidence: "low",
    limitations: [RESEARCH_MARKER,
      "Which pages come up for that search is read off the last stored search data, so a page that stopped coming up since then is still counted here."],
    evidence: { query: b.query, hints: [b.finding.explanation, `Competing pages on file: ${list}`, plan, owed], evidenceRefCount: 4 },
  };
}

/** A fall worth naming as work before its results page is read, and how many of them one pass may name. */
const MIN_RESEARCHING_CLICKS = 50, MAX_RESEARCHING = 3;

/**
 * EVERY PROVEN FALL THIS PASS COULD NOT DRAFT FOR. A page that lost real clicks on a search whose results page
 * has never been read reaches no door and no producer, so the loss is invisible: not a quiet day, an unseen
 * one. `skip` is the pages this pass already put a card on. Strongest fall first, bounded, deterministic.
 */
export function researchingCards(w: Wiring & { judged: readonly Judged[]; serpQueryKeys: ReadonlySet<string>;
  queryKeyOf: (q: string) => string; skip: ReadonlySet<string> }): ChangeProposal[] {
  return w.judged
    .filter((c) => !!c.pageUrl && !!c.query && c.gap === "recent_decline" && c.cause.cause !== "no_problem"
      && c.cause.cause !== "measuring_change" && c.recoverableClicks >= MIN_RESEARCHING_CLICKS
      && !w.serpQueryKeys.has(w.queryKeyOf(c.query!)) && !keysOf(c.pageUrl).some((k) => w.skip.has(k)))
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))
    .slice(0, MAX_RESEARCHING)
    .map((c) => researchingCard({ tenantId: w.tenantId, now: w.now, basis: w.basis, pageUrl: c.pageUrl!,
      pageLabel: labelOf(pageFor(w, c.pageUrl!), c.pageUrl!), query: c.query!, finding: c.cause,
      recoverable: c.recoverableClicks, demandImpressions90d: pageFor(w, c.pageUrl!)?.search?.impressions90d ?? null }));
}

/**
 * A PROVEN PROBLEM WITH NO DRAFTING EVIDENCE BEHIND IT YET. A page that lost real clicks is the most valuable
 * thing on a site, and until the results page for its search is read there is nothing exact to hand over. It
 * ranks on what is recoverable, and it names the one read that turns it into exact work.
 *
 * THE FALL IS THE LADDER'S SENTENCE TO WRITE, NEVER THIS ONE'S. `recoverable` is the LARGER of the curve gap
 * and the window over window fall, so a card that said "earned N fewer clicks than the four weeks before" was
 * asserting a fall of a size nobody measured whenever the curve gap was the bigger of the two. The finding
 * already states the true fall in its own words, so this says the number is what is recoverable and no more.
 */
function researchingCard(b: CardBase & { recoverable: number }): ChangeProposal {
  const path = pathOf(b.pageUrl);
  const missing = `The results page for "${b.query}" has not been read, and that read is what turns this into exact work: it names what moved ahead of ${path}.`;
  return {
    ...shell(b, RESEARCHING_FAMILY, b.recoverable),
    opportunityType: `Find out what took the clicks from ${path}`,
    recommendedChange: { kind: "existing_edit", field: "section", before: null, after: missing },
    whyItMatters: `${b.finding.explanation} ${missing}`,
    operatorSteps: [`Run research on "${b.query}" so the results page for it gets read`,
      `The pages holding those positions get read against ${path}`,
      "The exact change lands on this card once that read is on file"],
    estimatedEffortMinutes: 15, confidence: "low",
    limitations: [RESEARCH_MARKER,
      "This is what the gap is worth, not a promise of what comes back: what to change is not known until the results page for that search is read."],
    evidence: { query: b.query, hints: [`${num(b.recoverable)} clicks are recoverable here`, b.finding.explanation, missing], evidenceRefCount: 3 },
  };
}
