import "server-only";
/** decision/producers/page-fit - WHERE A CARD LANDS, AND WHAT A CARD IS. Split out of producers/extra when the
 *  fan-out cases arrived: the file that owned these primitives was one line under its ceiling, and two
 *  producers need the same answer to "which page of this account is this search FOR" or they will grow two
 *  answers. Nothing here is new behaviour; every rule below is the one that was already being applied, moved
 *  whole so a second copy can never appear beside it. */
import { log } from "@/lib/logger";
import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { CauseFinding } from "@/domains/decision/diagnosis";
import { actionFamilyOf } from "../proposal-store";
import { pageUnderstanding, sectionFit } from "./page-job";
type ExtraQueueRun = { cards: ChangeProposal[]; complete: boolean; families: string[]; held: { pageUrl: string; reason: string }[]; needsOwnPage: { query: string; refusedPages?: string[] }[] };
/** `headline` IS the card's action line: it names the page, the thing to do and the number behind it, so the queue reads as work without being opened. Never "update the section to sharpen it", which says nothing. */
export type Draft = { page: OwnedPageEvidence; slug: string; field: "meta" | "h1" | "section"; headline: string;
  query: string; before: string | null; after: string; why: string; steps: string[]; hints: string[];
  minutes: number; confidence: ChangeProposal["confidence"]; limitation: string;
  /** HOW MANY STORED ROWS ARE BEHIND THIS CARD, which used to be the hint count: three on every card this file writes, on three stored answers or thirty. `impact` is the clicks this page is measurably leaving behind. */
  refs: number; impact?: number | null;
  /** THE AI SIDE IN ITS OWN UNITS, only on a card stored answers stand behind. Never converted into clicks. */
  aiImpact?: ChangeProposal["aiImpact"];
  /** THE EXACT AI SCOPE this card targets: prompt ids, assistants and the follow-up-search cluster, preserved through shipment so Results remeasures the same thing, never ten flattened strings. */
  aiScope?: ChangeProposal["aiScope"];
  /** THE ONE CHOSEN TREATMENT, decided by the planner between diagnosis and drafting. */ treatment?: ChangeProposal["treatment"];
  /** The question this card came out of. ONE QUESTION, ONE CARD: an answer and the follow-up search an engine ran while writing it are the same question, so the strongest of them is the only one filed. */
  asked?: string;
  /** What happens next for this brief, when the default "the wording lands next pass" is not the truth. */
  next?: string;
  /** THE DIAGNOSED CAUSE, on the cards whose evidence names one. An AI absence card exists because a tracked
   *  question's stored answers credit rivals and never this site: that is a citation gap by name, and the card
   *  says so in the same currency the boundary and the ranking read everywhere else. */
  cause?: CauseFinding };
/** A page worth linking to sits inside striking distance and is genuinely being seen; under THIN_WORDS a page is a stub to a reader and to Google. TOP_PAGES_PER_CLASS pages per defect get a card, one page at a time. */
export const MAX_PER_PRODUCER = 5;
const THIN_WORDS = 200, TOP_PAGES_PER_CLASS = 3; // NEAR_MISS_MIN, NEAR_MISS_MAX and MIN_IMPRESSIONS lived here too, exported and imported by nothing: `producers/extra` declares its own. Deleted rather than left to read as a shared bound.
/** THE PAGES AN ESSAY NEVER GOES ON: the home page, and the shop rails. A storefront answers with products, so "add a section answering this question" there is work nobody would ever publish. */
export const STOREFRONT = /(^|[/-])(explore|shop|store|categor(y|ies)|collections?|product|cart|checkout)([/-]|$)/i;
/** A search asking WHICH SITES cover something wants a directory, and no page of this account is the answer to it. A question where somebody DESCRIBES THEMSELVES is their own situation, not a search. */
const META_QUESTION = /\b(web ?sites?|sites?|blogs?)\b/i;
const PERSONAL = /\b(i'm|im|i am|i've|myself|my)\b/i;
export const askable = (q: string): boolean => !META_QUESTION.test(q) && !PERSONAL.test(q);
/** A LINK IS WRITTEN AS A PATH, NOT AN ADDRESS. "https://" + "/persian-male-names" is "https:///persian-male-names",
 *  which the URL parser reads as the HOST "persian-male-names" and the path "/", so every relative link on a page
 *  collapsed to one entry: a page with seventy-six internal links read as a page linking to exactly one, no
 *  existing link was ever found, and this file told the operator to add links that were already there. */
export const pathOf = (url: string): string => {
  if (url.startsWith("/")) return url.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
/** Words carried in from an engine, a publisher or a title, made safe to paste: no dash Beacon never writes,  no bracket that reads as a blank somebody forgot to fill in. */
export const plain = (s: string | null | undefined): string => (s ?? "").replace(/[–—]/g, ", ").replace(/[[\]{}]/g, " ").replace(/\s+/g, " ").trim();
export const labelOf = (p: OwnedPageEvidence): string => plain(p.content?.h1 ?? p.content?.title ?? pathOf(p.url)) || pathOf(p.url);
const clicksOf = (p: OwnedPageEvidence): number => p.search?.clicks90d ?? 0;
/** MIN_EARNED_OVERLAP is the words of a page's own tie to a search, past the site wide ones, before it may be asked to answer it. */
const MIN_EARNED_OVERLAP = 2;
export const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** The words a page can be judged on without paying for a body read: its title, its heading and its outline. THE ACCOUNT'S OWN UBIQUITOUS VOCABULARY COMES OUT OF BOTH SIDES: a word this site prints on nearly every page is a word every page shares, and left in here it let a question tie to a page on the site's whole subject. */
export const pageWords = (p: OwnedPageEvidence, weak: ReadonlySet<string>): Set<string> => new Set(topicTokens([p.content?.title, p.content?.h1, ...(p.content?.outline ?? []), pathOf(p.url).replace(/[-/]/g, " ")].filter(Boolean).join(" ")).filter((t) => !weak.has(t)));
/** The words of a question that carry its subject: a site wide word this account puts on everything proves no  connection at all, so it never makes a page look like the answer to anything. */
export const subjectWords = (text: string, weak: ReadonlySet<string>): string[] => [...new Set(topicTokens(text))].filter((t) => t.length > 2 && !weak.has(t));
/** Matching runs on stems and an operator must never be told to write "persepoli", so every stem is handed  back the word it was cut from, spelled as the search spelled it. */
export const asWritten = (text: string, stems: readonly string[]): string[] => {
  const words = plain(text).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, "")).filter(Boolean);
  return stems.map((s) => words.find((w) => topicTokens(w).includes(s)) ?? s); };

export type Match = { page: OwnedPageEvidence; hits: string[]; missing: string[] };
/** WHERE A REAL SEARCH BELONGS. `fits` names the page. `needs_own_page` means pages shared the words and every one is FOR something else, a routing fact only the coverage path acts on. `held` means the best page for it has never been read, so the work is research and not a card. `no_candidate` is silence. */
export type Fit = { match: Match | null; verdict: "fits" | "needs_own_page" | "no_candidate" | "held"; reason?: string; refused?: string[] };
/** WHAT A MISSING READING LICENSES: NOTHING. Two shared words are evidence a page exists, not that it owns a subject: no reading, no admission, and the card waits with its reason named. */
export type Understanding = Awaited<ReturnType<typeof pageUnderstanding>>;
/** The page of this account's own that best answers a question, or null when nothing comes close. Two subject words is the floor: one shared word is a coincidence, not coverage. THE HOME PAGE AND THE SHOP RAILS ARE NEVER IT, nor is a page tied to the question only by furniture. THE READING DECIDES, best candidate first. */
export async function bestPageFor(text: string, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
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
export const noteNeedsOwnPage = (tenantId: string, text: string, bank?: { query: string; refusedPages?: string[] }[], refused?: string[]): void => {
  log.info("[extra] no page of this account is for this search", { tenantId, query: text.slice(0, 120) });
  bank?.push({ query: text, ...(refused?.length ? { refusedPages: refused } : {}) }); };
/** WHAT THIS PAGE IS LEAVING BEHIND at the position it holds: at its biggest search, the clicks pages at that position usually earn against the clicks it earns. The only figure on these cards that is a recovery and not an audience, so it MUST be held to the same bar the strict path uses: on the industry table this account's own position 1 read as 28 percent against the 1.34 it truly earns, sizing one extras card at 6,600 clicks where the opportunity path scored 539 on identical rows. The caller threads the fitted curve; the industry table is only the fallback. NULL, never zero, with no row worth reading or a page already earning its share. */
/** ONE card, in the ONE shape the store files and every surface renders. */
export function mint(tenantId: string, d: Draft, now: Date): ChangeProposal {
  const path = pathOf(d.page.url);
  return {
    id: `${tenantId}::${path.toLowerCase()}::existing_edit::${d.slug}`, tenantId, kind: "existing_edit",
    pagePath: path, pageUrl: d.page.url, pageLabel: labelOf(d.page), primaryQuery: d.query,
    opportunityType: d.headline, changeFamily: d.field, status: "needs_review",
    recommendedChange: { kind: "existing_edit", field: d.field, before: d.before, after: d.after },
    // EVERY CARD THIS FILE WRITES IS A BRIEF, so researchOnly is DERIVED from who minted it, never declared
    // per card: this producer names the work and the number behind it and writes no finished copy, and one
    // forgotten flag (the duplicate-heading card shipped "rewrite this heading" as if it were paste-ready)
    // must never put an instruction in front of a customer as a deliverable. The editor clears it with real words.
    researchOnly: true as const, research: { missing: d.after, next: d.next ?? "The exact wording lands on this card once the next funded pass writes it." },
    whyItMatters: d.why, operatorSteps: d.steps, estimatedEffortMinutes: d.minutes, riskLevel: "low",
    confidence: d.confidence, limitations: [d.limitation],
    // WHAT IS ON THE CARD, NEVER WHAT WAS CONSULTED TO WRITE IT: the link card counted every page whose stored link graph it read and claimed 224 pieces of evidence behind four sentences.
    evidence: { query: d.query, hints: d.hints, evidenceRefCount: Math.max(1, Math.min(Math.round(d.refs), d.hints.length)) },
    // WHAT IS RIDING ON IT, off this page's own rows: the clicks it is measurably leaving behind, and the audience it is shown to. Either one absent stays null, never a zero the ranking would believe.
    impactScore: d.impact ?? null, upsidePerMonth: null, demandImpressions90d: d.page.search?.impressions90d ?? null,
    ...(d.aiImpact ? { aiImpact: d.aiImpact } : {}),
    ...(d.treatment ? { treatment: d.treatment } : {}),
    ...(d.aiScope ? { aiScope: d.aiScope } : {}),
    ...(d.cause ? { causeFinding: d.cause, diagnosisCause: d.cause.cause } : {}),
    publish: "manual", createdAt: now.toISOString(),
  };
}
