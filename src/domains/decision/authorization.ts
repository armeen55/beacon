/** decision/authorization: THE ONE PLACE THAT ASKS WHETHER A CHANGE IS ALLOWED TO BE OFFERED AT ALL. A producer mints on its own evidence and the ranking picks the biggest number, so a page whose own evidence says two of your pages are splitting one search could still lead the queue with "add more copy to one of them", which is the one thing that makes the split worse. THE LEVER MUST TREAT THE WINNING DIAGNOSIS FOR THE PAGE. Where it cannot, the card is withheld with its reason on the run receipt, and the work the diagnosis DID prescribe is minted instead. `CAUSE_LEVERS` is the truth table, and it lives here rather than inside the ranking because two places now read it: the ranking discounts a mismatch, and this boundary refuses one. PURE, no I/O, no clock beyond the one a caller hands in. */

import type { BundleComponentKind, ChangeProposal } from "./contracts";
import { causeLabel, substantiveGapOf, type CauseFinding } from "./diagnosis";
import { CAUSE_LEVERS, treatable } from "./proof";

/** The cause ladder's own vocabulary. Read from there, never re-declared here. */
type Cause = CauseFinding["cause"];

/** WHICH LEVERS ADDRESS WHICH CAUSE. Keyed on the cause ladder's OWN union and deliberately TOTAL: adding a cause over there breaks the build here until somebody says what fixes it, which is the only way this table can never quietly fall behind the diagnosis. An EMPTY set is a real answer, not an omission: nothing you can write on the page fixes a search fewer people run, or a change that is already being measured. A cause with no lever matches nothing, discounts nothing and refuses nothing, so those proposals rank on their other factors. THE OLDER SEVEN KINDS BELONG IN THESE SETS TOO. `section`, `internal_links` and `source_pack` are the undifferentiated components persisted rows still carry, and leaving them out of every set meant a stored change was discounted the full 25 for the age of its vocabulary rather than for what it does. */
export { CAUSE_LEVERS } from "./proof";

/** THE FAMILY CARD'S OWN FAMILY. A split is settled by telling the competing pages apart, which is a wording
 *  change, and wording is exactly what a split does NOT authorize on one page on its own. The difference is
 *  scope: this card names every competing page and carries the assignment for each, so it is the diagnosis's
 *  own prescription rather than a sharper line on one of two pages still fighting. */
const OWNERSHIP_FAMILY = "ownership";
/** The family a diagnosed problem with no drafting evidence yet lands under. */
const RESEARCHING_FAMILY = "researching";
/**
 * WHAT THE OPERATOR READS on a card nothing is written for. COPY ONLY: every surface decides off the typed
 * `researchOnly` below, so rewording this sentence changes what is printed and nothing else. It was the fact
 * itself until 2026-08-14, matched by substring on six surfaces, which made a voice edit to customer-facing
 * prose enough to hand a research card a Copy button, a Mark done and a full ranking tier.
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
  if (cause === "cannibalization" && (p.changeFamily === OWNERSHIP_FAMILY || new Set((p.bundle?.components ?? []).map((c) => c.page).filter(Boolean)).size > 1)) return true; // A BUNDLE WHOSE PIECES LAND ON MORE THAN ONE PAGE IS SETTLING THE SPLIT, whatever field each piece uses. A differentiation is filed by its FIRST component's field, so the two-page flag bundle arrived as `title-family`, missed the ownership exception, and a finished ready row was served from the research lane where nobody can act on it.
  const answers = substantiveGapOf(p)?.kind ?? "missing_answer", opensAnAnswer = p.bundle == null && (answers === "missing_answer" || answers === "incomplete_answer"); // AND AN INCOMPLETE ANSWER IS ONE (reviewer, 2026-09-03): the gap reader types incomplete coverage as `incomplete_answer`, so once a headless body answer is filed under its real field this guard refused the very row the lever was opened for, and `nextObligation` settled it terminal. The identical finished words are authorized under either field name now, and the treatment conjunct went with it: demand recovery and suggested edits mint body rows carrying no treatment at all, and the gap kind already says what this row opens. // AN OPENING TREATS INCOMPLETE COVERAGE ONLY WHERE A MISSING ANSWER IS WHAT IT ADDS (reviewer, 2026-09-02): `opening_answer` joined that cause's levers for the card a page's own unanswered demand mints, and `leversOf` maps EVERY answer_block row to that lever, so a pronunciation line and any bundle carrying an opening passed on every incomplete-coverage page. The card's own payload decides: a row asking for the section that answers a search this page earns is the one the lever was opened for, and a row whose payload types absent headings is not.
  return leversOf(p).some((k) => levers.has(k) && !(k === "opening_answer" && cause === "incomplete_coverage" && !opensAnAnswer));
}

/** THE SIX FIELDS A CARD IN THIS PRODUCT CAN ACTUALLY CARRY. Everything else in the lever vocabulary is a
 *  component a bundle may hold, and a page that never got one cannot be refused for not having one. */


/** What this card actually does, in the operator's words, for the sentence that says why it was held. */
const LEVER_WORDS: Record<string, string> = { title: "a new title", meta: "a new description", h1: "a new heading",
  answer_block: "a new opening", section: "more copy on this page", new_page: "a new page" };

/**
 * WHY THIS CARD MAY NOT BE OFFERED, or null when it may. `cause` is the winning diagnosis for the card's own
 * page, read off the pass that judged it. A page with no material diagnosis authorizes everything, exactly as
 * before: this refuses only where the evidence NAMED something the card cannot touch.
 */
export function withholdReason(p: ChangeProposal, cause: Cause | null | undefined): string | null {
  // A CARD THAT NAMES ITS OWN CAUSE IS JUDGED ON THAT ONE. One page can be true in two ways at once: a page
  // can be losing ground on a search AND be stating things its own sources contradict, and those are separate
  // findings with separate evidence and separate work (operator, 2026-08-17). Judging every card against the
  // page's single strongest ladder cause refused an accuracy correction for not treating a ranking loss,
  // which is exactly the merge the operator forbade. The card's own diagnosis wins where it carries one AND
  // its lever treats it; the page-level cause still governs every card that names nothing.
  // ...EXCEPT WHERE THE CARD'S OWN LEVER IS THE ONE THING A SPLIT ALREADY OWNS (operator, 2026-09-04). Telling competing pages apart is a WORDING change and a split authorizes it on ALL of them, which is the rule stated below and, until the sweep producers stamped their findings, one no wording card could reach: a description card carried no cause at all, so the page's verdict governed it. A sharper line on one of two pages fighting over a search, with the other left as it was, makes the fight worse whatever else is true about that line, so the split outranks it here. Every other finding still stands on its own: a page can be losing a search AND stating something untrue, and body work, an answer block and a correction are none of them the split's own lever.
  const own = p.causeFinding?.cause ?? p.diagnosisCause, wordingLever = p.recommendedChange.kind === "existing_edit" && ["title", "meta", "h1"].includes(p.recommendedChange.field);
  if (own && own !== cause && treatsCause(p, own) && !(cause === "cannibalization" && wordingLever)) return null;
  if (!cause || !treatable(cause) || treatsCause(p, cause)) return null;
  const lever = p.recommendedChange.kind === "new_page" ? "new_page" : p.recommendedChange.field;
  return `held: this page's own evidence names ${causeLabel(cause)}, and ${LEVER_WORDS[lever] ?? "this change"} does not treat it. Once that is dealt with, this card comes back.`;
}


/** WHY THIS CHANGE MAY NOT BE CALLED READY, or null when it may. The table above DISCOUNTS a mismatched lever in the ranking and REFUSES an unauthorized card at the boundary, and between the two sat the case that shipped: a card whose own ranking receipt reads "this change does not touch two of your own pages splitting one search", ranked down 25 points for it, stamped `ready`, and handed over with a Copy button. A RANKING PENALTY IS AN ORDER, NEVER A PERMISSION. This is the permission, and it is asked wherever `ready` is minted or served. A SPLIT IS SETTLED ON EVERY PAGE IT NAMES OR IT IS NOT SETTLED. Telling competing pages apart is the one wording change a split authorizes, and it authorizes it on ALL of them: a sharper title on one of two pages fighting over a search, with the other left exactly as it was, makes the fight worse. So a split is judged on COVERAGE of the addresses its own finding named, and a `keep_as_is` verdict is an address that got no words, whatever reason was recorded beside it. Everything else is judged on the lever table. PURE. */
export function unsettledCause(p: ChangeProposal): string | null {
  const cause = p.causeFinding?.cause ?? p.diagnosisCause;
  if (!cause) return null;
  const payload = p.causeFinding?.payload;
  const split = payload?.cause === "cannibalization" ? payload : null;
  const named = split ? [...new Set([pathOf(p.pagePath ?? p.pageUrl ?? ""), ...split.competingPaths.map(pathOf)])].filter(Boolean) : [];
  // ONLY A CHANGE THAT CLAIMS TO SETTLE THE SPLIT IS HELD TO SETTLING IT WHOLE. A single-page card (an atomic title or description) writes one page BY CONSTRUCTION, so demanding it put words on every competing page held it forever regardless of evidence: the live /persian-female-first-names title sat unreleasable against a two-page split no title can settle. A bundle is the shape that writes on several pages, so the completeness demand binds bundles; an atomic card on a split page falls through to the lever-fits-cause question below, whose hold lifts the day the ownership work settles the split.
  if (cause === "cannibalization" && named.length > 1 && p.bundle) {
    const written = new Set((p.bundle.components ?? []).filter((c) => (c.after ?? "").trim().length > 0)
      .map((c) => pathOf(c.page ?? p.pagePath ?? "")));
    const owed = named.filter((n) => !written.has(n));
    if (owed.length === 0) return null;
    return `${num(owed.length)} of the ${num(named.length)} pages coming up for "${p.primaryQuery}" get no words from this change (${owed.join(", ")}), so the split it names is not fully answered and this is held for review rather than handed over as ready to paste.`;
  }
  return withholdReason(p, cause) == null ? null
    : `This change works on something other than ${causeLabel(cause)}, which is what this page's own evidence names, so it is held for review rather than handed over as ready to paste.`;
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
  // BOTH CARDS THIS SHELL MINTS ARE READS. Ownership and researching are the only callers, and neither carries copy.
  researchOnly: true,
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
const MAX_OWNERSHIP = Number.MAX_SAFE_INTEGER; // the count meter is DELETED (operator, 2026-08-30): every diagnosed split gets its card this pass

/** ONE CARD PER SPLIT, MINTED OFF THE DIAGNOSED SPLITS THEMSELVES rather than off whichever page a deep read happened to refuse. The boundary refuses every content card on every page a split names, so if the card that settles the split only existed for the one page a door reached, four other pages were told to settle something nothing here settles. `covered` is every page key a minted card speaks for, and it is EXACTLY the set the caller may refuse cards on: no card, no refusal. Strongest split first, bounded, deterministic. No address moves, so the risk is low and the whole change is wording that says which search each page answers. */
export function ownershipCards(w: Wiring & { judged: readonly Judged[]; queryKeyOf: (q: string) => string }): { cards: ChangeProposal[]; covered: Set<string>; assignable: Set<string> } {
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
  const cards: ChangeProposal[] = [], covered = new Set<string>(), assignable = new Set<string>();
  for (const g of [...groups.values()].sort((a, b) => b.c.recoverableClicks - a.c.recoverableClicks
    || (a.c.pageUrl ?? "").localeCompare(b.c.pageUrl ?? "")).slice(0, MAX_OWNERSHIP)) {
    const url = g.c.pageUrl!, own = pageFor(w, url);
    if (!own) continue;
    cards.push(ownershipCard({ tenantId: w.tenantId, now: w.now, basis: w.basis, pageUrl: url, pageLabel: labelOf(own, url),
      query: g.c.query!, finding: g.c.cause, demandImpressions90d: own.search?.impressions90d ?? null,
      competingPaths: g.paths, survivor: g.survivor, unproven: g.unproven,
      impactScore: g.c.recoverableClicks > 0 ? g.c.recoverableClicks : null }));
    for (const u of g.paths) for (const k of keysOf(u)) covered.add(k);
    if (g.survivor && g.paths.includes(g.survivor) && pathOf(url) !== g.survivor) assignable.add(cards.at(-1)!.id);
  }
  return { cards, covered, assignable };
}

/** ONE DECISION, ONE PRESCRIPTION, ZERO CONTRADICTIONS. This card used to assign the search to the page it was filed under while the finding's own payload named a different survivor, and to promise "nothing here moves an address" while the finding's action was `consolidate`. It reads the finding now and never argues with it. AND IT NEVER HANDS THE STRATEGY BACK. Telling an operator to "give the other pages wording that names what each answers" is the whole job, restated as homework. Settling a split takes the owner of the head search, the distinct search every other page is for, and the exact title and opening line for each, and none of that is drafted here yet. So this card asks for nothing: it states what the evidence settled, names what is still owed, and carries the loss it is ranked on. It is RESEARCH until every one of those exists. */
function ownershipCard(b: CardBase & { competingPaths: readonly string[]; survivor: string | null; unproven: readonly string[]; impactScore: number | null }): ChangeProposal {
  const mine = pathOf(b.pageUrl);
  // THIS PAGE FIRST, then the rest in a fixed order, and ALL of them: the ladder's count and this list are one
  // number, so the same split always produces the same sentence and nothing on file moves on a settled pass.
  const named = [mine, ...[...new Set(b.competingPaths.map((u) => pathOf(u)))].filter((p) => p !== mine).sort()];
  const list = named.join(", ");
  // THE FIGURES SETTLE WHICH PAGE TO KEEP, NEVER WHAT SETTLING IT TAKES. Winning ONE search does not make a page the
  // home for a whole other page, so this card named a merge as the answer while the producer had structurally ruled
  // one out (2026-08-14). Which mechanism it is comes off what each page carries, and that read is not on this card.
  const settled = b.survivor && named.includes(b.survivor) ? b.survivor : null;
  const plan = settled
    ? `Your own figures show ${settled} as the page to keep. Whether the others forward to it or get wording that tells them apart depends on what each page carries, and that read is not on this card.`
    : `Which of them should own it is not decided yet: ${b.unproven.length > 0
      ? `${b.unproven.join(" and ")} ${b.unproven.length === 1 ? "carries" : "carry"} no clicks of ${b.unproven.length === 1 ? "its" : "their"} own for that search on file, so no page here is proven to be the one to keep`
      : "no page here is far enough ahead on both clicks and position for the figures to pick one"}.`;
  const owed = "Beacon is reading the competing pages before writing the distinct titles and opening lines, so nothing here is an instruction yet.";

  return {
    ...shell(b, OWNERSHIP_FAMILY, b.impactScore),
    opportunityType: settled ? `Decide "${b.query}": your own figures show ${settled} as the page to keep`
      : `Decide which of your pages should own "${b.query}"`,
    recommendedChange: { kind: "existing_edit", field: "section", before: null,
      after: "The exact wording has not been written yet." }, /* THE ASSIGNMENT IS NOT THE COPY (2026-09-04): the pages, the plan and what is owed live in research.missing below, where the writer reads them; the copy field says only that its words are not written */
    whyItMatters: `${b.finding.explanation} Adding copy to one of them on its own leaves them competing, so which page owns which search is decided first and every other change on these pages waits behind it. ${plan}`,
    estimatedEffortMinutes: 0, confidence: "low",
    research: { missing: `${num(named.length)} of your own pages come up for "${b.query}": ${list}. ${plan} ${owed}`, next: "Beacon reads every named page whole, then writes the exact title and opening for each or records why it stays as it is. The finished set lands here as one change." },
    limitations: [RESEARCH_MARKER,
      "Which pages come up for that search is read off the last stored search data, so a page that stopped coming up since then is still counted here."],
    evidence: { query: b.query, hints: [b.finding.explanation, `Competing pages on file: ${list}`, plan, owed], evidenceRefCount: 4 },
  };
}

/** A fall worth naming as work before its results page is read, and how many of them one pass may name. */
const MIN_RESEARCHING_CLICKS = 16, MAX_RESEARCHING = Number.MAX_SAFE_INTEGER; // the count meter is DELETED (operator, 2026-08-30): the clicks floor is the only gate

/** WHAT A PRODUCER THAT REACHED THIS PAGE AND WROTE NOTHING SAID: the one read still missing, and the levers it
 *  weighed on the way there. A blocked page has been reasoned about, so its card says so instead of guessing. */
type ResearchBlocker = { reason: string; considered?: readonly { option: string; reason: string }[] };

/** EVERY PROVEN FALL THIS PASS COULD NOT DRAFT FOR, whatever stopped it. A page that lost real clicks and got no card reaches the operator as an unseen day rather than a quiet one, so the gate is EXACTLY that: no card, and no re-emission means it is minted again. It was once gated on "no results page for that search is on file", which meant the card VANISHED the moment the results page landed and the producer still had nothing to hand over, taking the biggest loss on the site off the queue for arriving evidence. `blocked` carries the producer's own words for the page it refused. Strongest fall first, bounded, deterministic. */
export function researchingCards(w: Wiring & { judged: readonly Judged[]; serpQueryKeys: ReadonlySet<string>;
  queryKeyOf: (q: string) => string; skip: ReadonlySet<string>; blocked?: ReadonlyMap<string, ResearchBlocker> }): ChangeProposal[] {
  const blockerFor = (url: string): ResearchBlocker | undefined => keysOf(url).map((k) => w.blocked?.get(k)).find(Boolean);
  return w.judged
    .filter((c) => !!c.pageUrl && !!c.query && c.gap === "recent_decline" && c.cause.cause !== "no_problem"
      && c.cause.cause !== "measuring_change" && c.recoverableClicks >= MIN_RESEARCHING_CLICKS
      && !keysOf(c.pageUrl).some((k) => w.skip.has(k)))
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.pageUrl ?? "").localeCompare(b.pageUrl ?? ""))
    .slice(0, MAX_RESEARCHING)
    .map((c) => researchingCard({ tenantId: w.tenantId, now: w.now, basis: w.basis, pageUrl: c.pageUrl!,
      pageLabel: labelOf(pageFor(w, c.pageUrl!), c.pageUrl!), query: c.query!, finding: c.cause,
      recoverable: c.recoverableClicks, demandImpressions90d: pageFor(w, c.pageUrl!)?.search?.impressions90d ?? null,
      blocker: blockerFor(c.pageUrl!) ?? null, serpRead: w.serpQueryKeys.has(w.queryKeyOf(c.query!)) }));
}

/** A PROVEN PROBLEM WITH NO DRAFTING EVIDENCE BEHIND IT YET. A page that lost real clicks is the most valuable thing on a site, and until the results page for its search is read there is nothing exact to hand over. It ranks on what is recoverable, and it names the one read that turns it into exact work. THE FALL IS THE LADDER'S SENTENCE TO WRITE, NEVER THIS ONE'S. `recoverable` is the LARGER of the curve gap and the window over window fall, so a card that said "earned N fewer clicks than the four weeks before" was asserting a fall of a size nobody measured whenever the curve gap was the bigger of the two. The finding already states the true fall in its own words, so this says the number is what is recoverable and no more. */
function researchingCard(b: CardBase & { recoverable: number; blocker: ResearchBlocker | null; serpRead: boolean }): ChangeProposal {
  const path = pathOf(b.pageUrl);
  // THE ONE THING STILL MISSING, IN THE WORDS OF WHOEVER LOOKED. A producer that read this case and refused says
  // exactly what it needs; only a page nothing reached falls back to the read that has provably not happened.
  const missing = b.blocker?.reason
    ?? (b.serpRead
      ? `The pages that come up above ${path} for "${b.query}" have not been read against it, and that read is what turns this into exact work.`
      : `The results page for "${b.query}" has not been read, and that read is what turns this into exact work: it names what moved ahead of ${path}.`);
  // WHAT WAS RULED OUT ON THE WAY HERE, so a research card argues rather than shrugs. Bounded to three. A
  // REJECTED LEVER IS NOT A STEP: numbered under "Read this twice, then:" it read as an instruction to go and
  // do the very thing the producer refused, so it stands beside the card as what was already ruled out.
  const ruled = (b.blocker?.considered ?? []).slice(0, 3).map((c) => `Already ruled out, ${c.option.toLowerCase()}: ${c.reason}`), next = "The exact change lands on this card once that read is on file";
  return {
    ...shell(b, RESEARCHING_FAMILY, b.recoverable),
    opportunityType: `Find out what took the clicks from ${path}`,
    recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." }, /* the assignment stays in research.missing beside it */
    whyItMatters: `${b.finding.explanation} ${missing}`, operatorSteps: [missing, next], research: { missing, next },
    estimatedEffortMinutes: 15, confidence: "low",
    limitations: [RESEARCH_MARKER, ...ruled,
      "This is what the gap is worth, not a promise of what comes back: what to change is not known until the read named above is on file."],
    evidence: { query: b.query, hints: [`${num(b.recoverable)} clicks are recoverable here`, b.finding.explanation, missing, ...ruled], evidenceRefCount: 3 + ruled.length },
  };
}
