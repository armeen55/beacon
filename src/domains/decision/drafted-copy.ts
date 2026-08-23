import "server-only";

/** decision/drafted-copy: THE WORDS, ON THE CARD. The $0 producers prove a page has no description and prove a page is a stub, and both hand the operator an instruction instead of work: "write a description of about 150 characters". That is the job, restated. This runs AFTER them and never inside one, so a budget block, a refusal or a cold cache changes nothing about which cards exist or which families were swept. Two halves:   1. A MISSING OR TEMPLATED DESCRIPTION gets a paste-ready line and a page AI answers never credit gets a      paste-ready ANSWER, both through the EXISTING structured drafter, grounded on that page's OWN STORED BODY under named ids (one bounded read for the pass), budgeted and cached by the one gateway, and read      back by the editor contract below, at most MAX_DRAFTS a pass. Anything short leaves the producer's card.   2. A THIN PAGE gets an OUTLINE, deterministically, out of headings at least two read winners share, named as theirs. No model, no invention; no winners on file leaves the card as the producer wrote it. */

import { log } from "@/lib/logger"; import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate"; import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { demandUnitsOf } from "@/domains/evidence/demand-units"; import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot"; import { callStructuredLLM, draftAtomicEditStructured, type CompleteFn } from "./llm/structured-drafter";
import type { AtomicEditDraft } from "./llm/schemas"; import { validateProposal } from "./validate-proposal"; import type { ChangeProposal } from "./contracts";
import { DRAFT_BUDGET } from "./draft-budget"; import { AI_CASE_COPY } from "./producers/ai-cases";
type DraftBudget = ReturnType<typeof DRAFT_BUDGET.plan>;

/** How many drafted blocks one pass buys, descriptions and answers together; past it, the honest note. Raised 5 to 8 with the pool below (operator, 2026-08-22, "unleash the guardrails"): five slots were fully occupied by the hardest cards every pass, so the completable descriptions behind them never got a body. */
const MAX_DRAFTS = 5; const META_MIN = 110, META_MAX = 165; // what Google shows of a description before it cuts, and the floor under a line worth pasting
const ANSWER_MIN = 30, ANSWER_MAX = 180; // A SANITY BOUND, NEVER A TARGET (Codex, 2026-08-23): the universal 80-word floor refused a 72-word rewrite, a 69-word flag answer, a 68-word wolf answer and a 44-word phrase answer across four live dispatches and told the writer to pad rather than answer, when a strong 35 to 70 word answer beats an artificial 80-word one. The floor catches only copy too thin to stand alone; completeness is judged by the reader that follows
/** A HINT THAT DESCRIBES THE PAGE IS NOT MATERIAL FOR WRITING ABOUT ITS SUBJECT: "holds 196 words of copy", "is shown 8,898 times in 90 days", "returns a normal response and zero readable words". They are the diagnosis that raised the card, and a writer cannot build a sentence about Persian wolves out of them. */
/** The evidenceRefs vocabulary, which is NOT the grounding-id vocabulary: a claim that cites one of these has mixed up the two, and the refusal says so in those words rather than reporting a missing fact. */
const SOURCE_KIND = new Set(["gsc", "ga4", "clarity", "dataforseo", "competitor_teardown", "owned_snapshot", "fanout"]);
/** Headings this many read winners share before they are worth naming, and how many are named. */ const AGREEING_WINNERS = 2, MAX_HEADINGS = 5; const MAX_HEADING_WORDS = 8; // a heading past this is a wrapped paragraph, and site furniture is not a subject
const FURNITURE = /^(home|menu|search|contact|about|share|follow|newsletter|comments?|related|categories|tags|advertisement|subscribe|navigation|footer|privacy|terms)\b/i;
const UNSAFE = /[–—]|\[|\]|\{|\}/; // nothing an operator can paste: a dash Beacon never writes, a bracket somebody forgot to fill in
/** The marker the ranking reads to hold a card behind finished work; "is still owed, and this card is what is owed" is the stable phrase and may not change wording (rank-proposals.ts greps it). */
const owedNote = (what: string): string => `The exact ${what} lands on the next pass; it is still owed, and this card is what is owed. No action needed from you until it does.`;
const pathOf = (url: string): string => { try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** `judge` is the semantic reader of a finished edit. ABSENT MEANS NOTHING IS ACCEPTED, so a pass with no judge wired writes no copy and buys nothing, and wiring one is a deliberate act rather than a default. */
type DraftedCopyOptions = { tenantId: string; snapshot: EvidenceSnapshot; now: Date; complete?: CompleteFn; bypassCache?: boolean; judge?: JudgeFn;
  /** The account's banned vocabulary, read once per pass by the caller so this file does no I/O of its own. */
  bannedTerms?: readonly string[];
  /** The pass's ONE shared budget. Absent = this file owns one of its own for this run. */
  budget?: DraftBudget;
  /** One candidate's already-claimed allowance, when a caller drafts a single deliverable itself. */ attempts?: Allowance; /** Wall-clock moment this editor must stop STARTING cards (epoch ms). A card already being written finishes. */ stopBy?: number; /** PAGES NOBODY SETTLED: the provider could not answer, or the pass ran out of its own allowance mid-deliverable. Recorded as it happens, so a card that comes back unfinished is told apart from one Beacon's OWN gates read and rejected. Only the second settles anything. */ unsettled?: Set<string>; /** Reports one card's settled outcome to the caller's receipt, with the words of the refusal that settled it. */ note?: (key: string, outcome: "deterministic_refusal" | "retryable_blocked" | "review_saved", why?: string) => void; /** THE LAST REFUSAL PER PAGE, in the gate's own words. Kept because "blocked" alone cannot be acted on: a receipt that cannot say WHICH rule refused the copy sends the next pass to buy the identical refusal. */ refusals?: Map<string, string> }; const softOnly = (reasons: readonly string[]): boolean => reasons.length > 0 && reasons.every((r) => !DRAFT_BUDGET.HARD_REFUSAL.test(r));
const slugOf = (p: ChangeProposal): string => p.id.split("::").at(-1) ?? ""; // the producer's own slug, off the id it minted /** The page this card lands on, by either key. */
function pageFor(snapshot: EvidenceSnapshot, card: ChangeProposal): OwnedPageEvidence | null {
  const url = (card.pageUrl ?? "").trim(), path = (card.pagePath ?? "").trim().toLowerCase();
  return snapshot.ownedPages.find((p) => (url && canonicalUrlKey(p.url) === canonicalUrlKey(url)) || pathOf(p.url).toLowerCase() === path) ?? null;
}

// ── THE EDITOR CONTRACT ───────────────────────────────────────────────────────
/** WHETHER COPY IS FINISHED IS NOT A QUESTION ABOUT ITS SPELLING. Two word lists used to answer it: a verb list  called a sentence an instruction, and a vocabulary list called a word invented because the page had not  already printed it. The second refused the one thing an editor is for, a faithful paraphrase. So the editor hands back its HOMEWORK and two gates read it. The deterministic half checks only what code can know: fields  present, no placeholder, every id resolves, the text it replaces and the place it lands are really on the  stored page, the heading is not the tracked question said back, the copy is the length its field takes. Sense is the JUDGE's, and NO JUDGE MEANS NO DELIVERABLE. Dashes, ungrounded figures and destructive replacements stay where they live (validate-proposal, llm/numeric-fidelity): house rules for any copy. */
type EditorDeliverable = {
  /** Notes from a final round that failed only SOFT rules: the draft is complete and worth a human read, and these ride its limitations. */ softFailures?: readonly string[];
  actionType: "title" | "h1" | "meta" | "answer_block" | "section" | "internal_link"; targetUrl: string; placementAnchor: string; beforeText: string | null;
  finalCopy: string; naturalHeading: string | null; claims: readonly { text: string; supportedBy: readonly string[] }[];
  /** THE EXACT WORDS BEHIND EACH ID THE CLAIMS NAME, resolved off this packet's own evidence map and carried with the copy so provenance survives the pass that wrote it. */
  supportFacts: readonly { id: string; fact: string }[];
  evidenceIdsUsed: readonly string[]; uncertaintyOrOmitted: readonly string[]; implementationMinutes: number; measurementTarget: string;
  /** A LINK IS A SENTENCE, NEVER AN ERRAND. `finalCopy` is the whole sentence carrying it, `linkTo` the owned page it lands on and `anchorText` the words on it, all three so the live check reads the link rather than a paraphrase of the instruction. */
  linkTo?: string | null; anchorText?: string | null };
/** The stored facts the deliverable is checked against; `evidence` maps an id to the exact words behind it, so "the evidence supports this" is a lookup. */
type SourcePacket = { targetUrl: string; title: string | null; h1: string | null; metaDescription: string | null; bodyText: string;
  headings: readonly string[]; evidence: Readonly<Record<string, string>>; trackedQuestion: string | null;
  /** Every path this account owns, so a link's destination is checked against the real site instead of being believed. */
  ownedPaths: readonly string[];
  /** The account's own banned vocabulary (BusinessProfile constraints), never a hardcoded list. */
  bannedTerms: readonly string[];
  /** THE SEARCHERS' OWN WORDS FOR THIS PAGE. `preserve`: queries the page EARNS clicks on today, whose concepts no rewrite may drop without a stated reason. `vocabulary`: every member phrasing of the page's demand units, which the drafter may lead with (each also rides the evidence map as a demand-N id, so a claim can cite it and the grounding gate resolves searched words the page's own copy never printed). This is the input that was missing when a shoes page was described by its SKU names instead of what people search. */
  demand: { preserve: readonly string[]; vocabulary: readonly string[] } };
/** Every ruling the judge owes on a finished edit. All seven must hold; `notes` is for the log line and nothing else. */
type JudgeVerdict = { pageFit: boolean; claimsEntailed: boolean; usefulAndNatural: boolean; placementCorrect: boolean;
  implementableNow: boolean; improvesPage: boolean; wouldHandToCustomer: boolean; notes: string };
/** The semantic reader: a model in production, a fixture in a proving pass. Null is a refusal, never an approval. */
type JudgeFn = (d: EditorDeliverable, p: SourcePacket) => Promise<JudgeVerdict | null>;

/** WHAT ONE ACTION TYPE MAY WEIGH: characters for a line that replaces a field, words for a block of copy. */
const BAND: Record<EditorDeliverable["actionType"], [number, number, "c" | "w"]> = { title: [20, 70, "c"], h1: [10, 90, "c"],
  meta: [META_MIN, META_MAX, "c"], answer_block: [ANSWER_MIN, ANSWER_MAX, "w"], section: [40, 400, "w"], internal_link: [8, 90, "w"] };
/** COPY THAT POINTS AT THE PAGE INSTEAD OF ANSWERING. Deleted in the editor pass on the theory a judge would  read for this; the judge then passed "This page lists hello, goodbye, thank you" for a page listing no such  phrase, and "See the headings below for each example" as an answer. It is cheap, it is exact, and it is back. An ANSWER is the words a reader needs, never a description of where those words live. */
const SELF_POINTER = /\b(?:covered|described|explained|shown|listed)\s+(?:in|on|here)\b|\bthis (?:guide|page|article)\b|\bsee the\b|\bsections?\s+(?:below|above)\b|\bheadings?\s+below\b/i;
/** WHAT THE COPY ASSERTS, READ OFF THE COPY. The gate used to check only the claims the WRITER chose to declare,  so an assertion nobody declared was never checked at all: a description promised visitors could "filter by  type, color, or region" on a page whose stored words carry no such control, declared none of it, and shipped. Replaces a phrase list ("this page lists|contains|shows...") that could only ever catch the sentences somebody  had thought of. TWO STRUCTURES, both about MEMBERSHIP and neither about any particular wording: a coordinated list says its members exist, and the object of an enumerating preposition says the page offers that thing. */
const ENUMERATED = /\b([a-z][a-z' -]{2,40}(?:,\s*[a-z][a-z' -]{2,40}){1,5},?\s+(?:and|or)\s+[a-z][a-z' -]{2,40})\b/gi; const OFFERED = /\b(?:by|such as|including)\s+([a-z][a-z' -]{2,40})/gi;
const MEMBER_WORDS = 4; // past this a comma joins clauses rather than listing members
const SERP_FEATURE = /\b(?:people also (?:search|ask)|related searches|searches related to|autocomplete suggestions?)\b/i;
const PROSE = /^(?:with|under|from|for|in|on|at|by|to|about|through|during|after|before|between|across|into|over|within|among|via|than|like|as)\b/i, PARTICIPLE = /\b[a-z]{3,}(?:ed|ing)\b/i;
/** CRAWLER MARKERS ARE NOT PAGE COPY. The capture brackets every body with these, and an anchor cut from them ("top of pagePopular Persian...") names a string no operator can find on the rendered page. */
const CHROME = /\b(?:top|bottom) of page/gi;
/** The same marker, NON-global: a /g regex carries `lastIndex` between calls, so testing with the one used for replacing alternates true and false. */ const CHROME_AT = /\b(?:top|bottom) of page/i;
const ANCHOR_MAX = 160; // a place on the page, not a paragraph: a 300 character blob is not an anchor
const BODY_TO_JUDGE = 24_000; // how much of a stored page fits in one judging call beside the rest of the prompt
const PLACEHOLDER = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b/; // raised from 30 with the operator's 2026-08-22 spend waiver: the per-card slice keeps any one candidate bounded, the daily dollar cap still rules real money, and the pool now reaches every draftable card in one pass instead of starving the completable tail
/** MARKUP IS NOT WORDS. A drafted title read "Colors &amp; History": pasted, a reader sees the entity, not the ampersand. */ const ENTITY = /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/;
/** THE WORDS THAT MAKE A FIGURE MEAN SOMETHING NARROWER THAN THE BARE NUMBER. A description shipped "ships in 7-21  business days" off a sentence that said INTERNATIONAL delivery takes 7-21 days while the same page promises 2-6 days inside the country: every digit was lifted from the page and the sentence was still false. */
const QUALIFIER = /\b(international(?:ly)?|excluding|from|up to|per|depending)\b/i;
/** A SITE NAMED IN THIS CARD'S EVIDENCE. A rival the answers cite is WHY the card exists and is never copy for the operator's page. */
const HOSTISH = /\b([a-z][a-z0-9-]{3,})\.(?:com|org|net|io|co|edu|info)\b/gi;
/** WHAT ONE PAGE ACTUALLY COST, off the gateway's own receipts: real provider calls (a structured call retries once internally, so one logical operation can be two calls) and real dollars. Logical attempt units are budget bookkeeping and are never reported as either (Codex, 2026-08-23: the seven-unit price met a sixteen-call dispatch). */
/** ONE completed provider result, reported to the page's own allowance, which is the ONE thing every paid family already holds (Codex, 2026-08-23). The editor used to keep a private meter the caller passed in, so the other five families spent real money that no receipt could name; the money surface counts for all of them now. */
type Allowance = { left: number; record?: (r: unknown) => void };
const spendOf = (a: Allowance | undefined, r: unknown): void => { a?.record?.(r); }; const flat = (s: string): string => s.toLowerCase().replace(/[\s\u00a0]+/g, " ").replace(/[\u201c\u201d]/g, '"').replace(/[\u2019]/g, "'").trim();
/** THE STORED PAGE AS THE GATE READS IT: crawler markers out, then flattened. The gate matches against a body that had CHROME replaced while the passages handed to the writer never did, so a passage carrying "top of page" (which /funny-farsi-phrases does) could NEVER be found in it: production refused that rewrite with "the words it says it replaces are not on the stored page" over copy taken from the page itself (Codex, 2026-08-23). One normalizer now answers for both sides, so a passage chosen to be replaced passes the exists-on-page check by construction. */
const storedFlat = (s: string): string => flat(s.replace(CHROME, " "));
/** THE WHOLE STORED PAGE AS ONE STRING, built in ONE place: the failure this repair exists for was two sides of one comparison disagreeing, and two hand-built haystacks would only wait to disagree again. */
const storedPage = (p: SourcePacket): string => storedFlat([p.bodyText, p.headings.join(" "), p.title ?? "", p.h1 ?? ""].join(" "));
/** IS THIS TEXT ACTUALLY ON THE PAGE. Markers are ignored on BOTH sides, and text that is NOTHING BUT a marker is NOT on the page: `includes("")` is true for every string, so a needle that normalizes away used to pass the one gate written to catch it (Codex, 2026-08-23). */
const onPage = (stored: string, needle: string): boolean => { const n = storedFlat(needle); return n.length > 0 && stored.includes(n); }; const blankish = (s: string | null | undefined): boolean => !s || s.trim().length === 0 || PLACEHOLDER.test(s);
const urlKey = (u: string): string => flat(u).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");

/** THE LIVE JUDGE, through the ONE gateway: registered prompt, content-hash cache ($0 on a repeat), fail-closed  budget, strict schema, single retry, then refusal. gpt-5-mini spends reasoning tokens before it answers, so  the timeout is the memory's floor and not the drafter's default. Any transport or schema failure is null, which is a refusal: nothing about a judge that could not read the copy says the copy is good. */
/** THE ONE SEMANTIC EVALUATION, replacing a friendly judge and a surprise final adversary (Codex, 2026-08-23). Two sequential reviewers solved different assignments: the judge passed copy the adversary then refused AFTER every drafting retry was spent, so the writer never heard the requirement that kept refusing it. One reading now covers factual support, query satisfaction, information gain, naturalness and implementability, its exact objections are fed back into the next round, and the LAST evaluation IS the promotion decision. Through the ONE gateway: registered prompt, cache, fail-closed budget, strict schema. Any transport or schema failure is null, which is a refusal: nothing about an evaluator that could not read the copy says the copy is good. */
const EVALUATOR_SYSTEM = 'You are the FINAL EDITOR of one finished website edit, the last reading before a paying customer sees a Ready badge: a senior SEO and AEO editor who REFUSES anything a serious human editor would not ship. When in doubt on any field, answer false. Return ONLY a JSON object with seven booleans and "notes" (one sentence naming the single worst defect, or what earned the pass): '
  + '"pageFit" (does this belong on THIS page), '
  + '"claimsEntailed" (check EVERY material claim against the quoted evidence one at a time: the evidence must carry it, with no fact added the evidence does not show; any claim about what the page itself contains or lists must be verifiable in the stored page words below, and a page that merely mentions a subject does not list it. Also answer false when any stated fact is one you independently doubt is TRUE in the world, even if the page says it: a page can be wrong, and repeating its error is a defect), '
  + '"usefulAndNatural" (does it read as a person wrote it and tell a reader something: answer false for any verbless list of phrases, any non-English expression not paired with its English meaning, and any sentence a reader who asked the tracked question could not ACT on), '
  + '"placementCorrect" (does it belong exactly where it says it lands: answer false when the new heading pointlessly duplicates the page\'s existing title or H1), '
  + '"implementableNow" (could an operator paste this today with no further decisions), '
  + '"improvesPage" (answer false when the copy merely restates what the stored page already says without adding mapping, structure, definitions or facts the page lacks, and false when an answer points at its own page instead of answering), '
  + '"wouldHandToCustomer" (would you personally hand this to a customer).';
const evaluator = (tenantId: string, now: Date, meter?: Allowance): JudgeFn => async (d, p) => {
  const user = [`Page: ${p.targetUrl}`, `Its title: ${p.title ?? "(none)"}`, `Its heading: ${p.h1 ?? "(none)"}`, `The search or question behind this: ${p.trackedQuestion ?? "(none)"}`,
    `Edit type: ${d.actionType}`, `It lands at: ${d.placementAnchor}`, d.naturalHeading ? `Under the heading: ${d.naturalHeading}` : "", d.beforeText ? `It replaces: ${d.beforeText}` : "It replaces nothing.",
    `THE COPY: ${d.finalCopy}`, "Its claims and the evidence each one names:", ...d.claims.map((c) => `- "${c.text}" <- ${c.supportedBy.join(", ")}`),
    "The stored evidence, by id:", ...Object.entries(p.evidence).map(([id, t]) => `${id}: ${t.slice(0, 4000)}`),
    p.bodyText.length > BODY_TO_JUDGE ? `The page's own words (first ${BODY_TO_JUDGE} characters of ${p.bodyText.length}; anything past this you have NOT seen, so do not conclude the page lacks something on this alone): ${p.bodyText.slice(0, BODY_TO_JUDGE)}`
      : `The page's own words, whole: ${p.bodyText}`, "", "Return the JSON now."].filter(Boolean).join("\n");
  const r = await callStructuredLLM({ kind: "editor_judgement", tenantId, system: EVALUATOR_SYSTEM, user, grounded: user, projectedCostUsd: 0.01, maxTokens: 2000, timeoutMs: 95_000, now }).catch(() => null);
  spendOf(meter, r);
  return r?.status === "drafted" ? (r.value as JudgeVerdict) : null;
};

/** THE GATES THAT NEED NO MODEL AND NO FRESH EVIDENCE, so they can be re-read against a STORED piece as well as  a fresh one: markup where a word belongs, a figure that dropped the qualifier its own sentence carried, a  range that is really two neighbours, a rival's name this page never mentions, and the account's own banned words. Split out because a bundle is SERVED FROM REUSE without redrafting, so a piece written before a gate existed outlived the gate that would have refused it. PURE. */
function rereadableRefusals(copy: string, p: SourcePacket, heading: string | null = null): string[] {
  const out: string[] = []; if (ENTITY.test(copy) || ENTITY.test(heading ?? "")) out.push("it carries a raw HTML entity, so what gets pasted is not what a reader sees");
  // A FIGURE CARRIES ITS SUBJECT OR IT IS A DIFFERENT FACT: every digit run is traced back to the stored sentence it came out of, and a qualifier that sentence carries and the copy drops changes what the number is ABOUT. DASHES ARE NOT IDENTITY. The house rule rewrites an en dash, so copy saying "7-21" never matched a body saying "7\u201321" and the whole check silently skipped the one sentence that would have refused it: the shipping line went out claiming 7-21 days off a sentence reading "International ... depending on location".
  const figure = (t: string): string => t.replace(/[\u2013\u2014]/g, "-").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
  // A RANGE SPELLED OUT IS THE SAME FACT AS A RANGE WITH A DASH IN IT: "from 550 to 330 BCE" narrows nothing, and reading its "from" as a qualifier refused every line naming the years its own page is about. Normalized to the form the copy would write, BEFORE the sentence is asked what it qualifies. ONE RANGE, HOWEVER IT IS SPELLED, AND UNITS COUNT (Codex, 2026-08-23): "from 550 BCE to 330 BCE" and "550-330 BCE" are the same fact, and reading the "from" as a dropped qualifier cost /iran-flags/achaemenid-empire-flag five calls and $0.026846 for a line naming the years its own page is about. Endpoints carrying the SAME unit fold together; genuinely different units (5 km to 3 miles) stay two facts, and every other qualifier is still enforced below.
  const ranges = (t: string): string => t.replace(/(?:\bfrom\s+)?(\d[\d,.]*)\s*([A-Za-z]{1,4})?\s+to\s+(\d[\d,.]*)\s*([A-Za-z]{1,4})?/gi,
    (m, a: string, ua: string | undefined, b: string, ub: string | undefined) => (!ua || !ub || ua.toLowerCase() === ub.toLowerCase()) ? `${a}-${b}${ub ? ` ${ub}` : ua ? ` ${ua}` : ""}` : m);
  const said = ranges(p.bodyText).split(/(?<=[.!?])\s+|\n+/).map((t) => figure(t).trim()).filter(Boolean);
  for (const n of new Set(figure(ranges(copy)).match(/\d[\d,.-]*\d|\d+/g) ?? [])) {
    const q = QUALIFIER.exec(said.find((s) => s.includes(n)) ?? "");
    if (q && !new RegExp(`\\b${q[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(copy)) {
      out.push(`the figure's own sentence says ${q[1]!.toLowerCase()}, and the copy drops it`); break; } }
  // A PAGE'S OWN WORDS ARE NOT A LIST OF THE SEARCHES THAT REACH IT. Live and Ready on the account: "Persian girl names here match persian girl names, persian names for girls, persian names girl, persian girls names, persian girl name, and unique persian girl names. People also search persian female names and female persian names." Six of those are ONE phrase reordered, and the line after it prints the name of a results-page feature. Nobody writes that, no reader gains a word from it, and it is the exact shape a search engine penalises: pasting it onto a live page costs the operator the ranking the card was bought to win. THE TEST IS PERMUTATION, not similarity: three members that reduce to the same set of content words are the same search said three ways, and a real list never does that.
  const sets = new Map<string, number>();
  for (const m of [...copy.matchAll(ENUMERATED)].flatMap((x) => x[1]!.split(/,|\band\b|\bor\b/))) { const k = [...new Set(topicTokens(m).filter((w) => !CARRIER.has(w)))].sort().join(" ");
    if (k.split(" ").length > 1) sets.set(k, (sets.get(k) ?? 0) + 1); }
  if ([...sets.values()].some((n) => n >= 3)) out.push("it lists the same search written several ways over, which reads as keyword stuffing rather than an answer");
  if (SERP_FEATURE.test(copy)) out.push("it prints the name of a results-page feature, which belongs to the research and never to the page");
  const span = /\b([A-Z][a-z]+)\s+to\s+([A-Z][a-z]+)\b/.exec(copy); // A RANGE IS A SPAN, NOT TWO NEIGHBOURS: "Afsaneh to Anoushka" sold a list of 194 names as a range whose two ends sit beside each other in the page's own list.
  if (span) { const list = p.headings.map((h) => flat(h)), a = list.indexOf(flat(span[1]!)), b = list.indexOf(flat(span[2]!));
    if (a >= 0 && b >= 0 && Math.abs(b - a) < Math.max(2, Math.floor(list.length / 2)))
      out.push(`it sells "${span[1]} to ${span[2]}" as a range, and this page's own list puts them ${Math.abs(b - a)} apart`); }
  const bare = (t: string): string => flat(t).replace(/[^a-z0-9]/g, ""); // A RIVAL'S NAME IS NOT COPY FOR THIS PAGE: naming the site the answers already cite hands that engine one more mention, on the operator's own page, in the operator's own words.
  const mine = bare(`${p.bodyText} ${p.title ?? ""} ${p.h1 ?? ""} ${p.headings.join(" ")}`), flatCopy = bare(copy);
  const rival = [...new Set(Object.values(p.evidence).flatMap((t) => [...t.matchAll(HOSTISH)].map((m) => m[1]!.toLowerCase().replace(/-/g, ""))))]
    .find((r) => flatCopy.includes(r) && !mine.includes(r));
  if (rival) out.push(`it names ${rival}, which this page's own words never mention, so the copy points a reader at somebody else's site`);
  // A BANNED WORD THE SEARCHERS THEMSELVES USE IS DIFFERENT SPEECH (operator ruling, 2026-08-16): "Persian, never Farsi" holds for Beacon's own voice, but when a real search for this page carries the word, using it beside the preferred term is meeting the searcher, not breaking the rule. The exception is demand-gated and generic: a term clears only when a stored search phrase for THIS page contains it.
  // BEACON'S OWN WORKFLOW WORDS ARE NOT CUSTOMER COPY (Codex, 2026-08-23): the drafted answer opened "Funny Persian phrases in the evidence include", leaking the brief's vocabulary onto the page. SOFT, so the otherwise-good answer lands in Review with this note rather than being destroyed.
  const leaked = ["evidence", "grounding", "supportedBy", "claim ids"].find((w) => new RegExp(`\\b${w}\\b`, "i").test(copy)); if (leaked) out.push(`it says "${leaked}", which is Beacon's own workflow word rather than the page's`);
  const banned = p.bannedTerms.filter((t) => t.trim() && new RegExp(`\\b${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${copy} ${heading ?? ""}`)
    && !p.demand.vocabulary.some((v) => new RegExp(`\\b${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(v)));
  if (banned.length > 0) out.push(`it uses words this account does not publish: ${banned.slice(0, 3).join(", ")}`);
  return out;
}

/** THE CANONICAL PAGE EVIDENCE AS ONE BAG OF WORDS: everything stored about this page plus every evidence line this card names. "The evidence carries this" is a lookup against exactly this and nothing wider. */
const corpusOf = (p: SourcePacket): string =>
  flat([p.bodyText, p.headings.join(" "), p.title ?? "", p.h1 ?? "", p.metaDescription ?? "", Object.values(p.evidence).join(" ")].join(" ")).replace(/[^a-z0-9]+/g, " ");
/** THE GRAMMAR OF STATING A LIST IS NOT A FACT ABOUT THE PAGE. This gate is deliberately not a vocabulary test, yet finished sections were refused for the words "include", "means" and "also": carrier verbs and scaffolding that any faithful paraphrase of a list must use and no page's stored copy reliably prints. This closed set names exactly that grammar and nothing else; every noun, adjective and meaning the copy states still has to be carried by a declared claim and the passage it cites (operator, 2026-08-17). */
const CARRIER = new Set(["include", "includes", "including", "cover", "covers", "carry", "carries", "list", "lists",
  "mean", "means", "meaning", "also", "such", "offer", "offers", "use", "uses", "used", "refer", "refers", "state", "states",
  // THE REST OF THE CLOSED GRAMMAR (2026-08-22): pronouns, light verbs and quantifiers that any faithful paraphrase must use and no page's stored copy reliably prints. Live passes refused finished copy over "they", "has", "like" and "people", which is the vocabulary test this gate's own charter forbids. Every content noun, name and meaning still has to be carried by a claim and the passage it cites.
  "they", "them", "these", "those", "that", "this", "people", "person", "has", "have", "had",
  "can", "could", "will", "would", "often", "among", "same", "like", "both", "each", "every", "other", "more", "most"]);
/** Every content word of a phrase that the canonical page evidence does not carry. Singularized and stripped of  universal words by the ONE tokenizer this codebase already uses, so a faithful paraphrase passes and an invented member does not. Substring containment on purpose: it errs toward letting real copy through. */
/** THE NAMES A PIECE OF COPY ASSERTS that nothing on file has ever mentioned. A fabricated fact wears a capital letter (Cyrus the Great, Ferdowsi, Topoli) and a word carrying none is prose rather than a claim about the world, so this leaves it alone. A word opening a sentence is capitalised by grammar and never counted, and neither is one the corpus already carries. */
const unheldNames = (corpus: string, copy: string): string[] => {
  const held = flat(corpus.replace(/([a-z])([A-Z])/g, "$1 $2")), seen = new Set<string>(), out: string[] = [];
  // A CLAUSE, NOT A SENTENCE (Codex, 2026-08-23): a capital letter after a bullet, a dash or a comma is grammar, not a name, and production blocked /iran-animals/persian-wolf over the ordinary word "Look" opening a list item. The first word of any clause is skipped, and leading bullets and dashes are stripped before that word is found.
  for (const clause of copy.replace(/([a-z])([A-Z])/g, "$1 $2").split(/(?<=[.!?:;,])\s+|\n+|\s+[-\u2013\u2014\u2022]\s+/)) {
    const w = clause.trim().replace(/^[^A-Za-z]+/, "").split(/\s+/).filter(Boolean);
    for (let i = 1; i < w.length; i += 1) { const raw = w[i]!.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ""), key = raw.toLowerCase();
      if (/^[A-Z][a-z]{2,}$/.test(raw) && !CARRIER.has(key) && !seen.has(key) && !held.includes(key)) { seen.add(key); out.push(raw); } } }
  return out;
};
const unheld = (corpus: string, phrase: string): string[] => topicTokens(phrase).filter((w) => !CARRIER.has(w) && !corpus.includes(w));
/** SUPPORT ENTAILMENT, and it used to be nobody's question: does each claim stand on the evidence IT names. The coverage corpus above carries the claim text, so a sentence and the claim declaring it are one string and a hallucination authenticated itself ("These shoes are waterproof", declared word for word against a page title silent about waterproofing). A CLAIM IS NEVER PART OF ITS OWN SUPPORT: each is read against the quoted facts its own supportedBy names and nothing else, on the words the COPY actually leans on, because a claim word the copy never prints cannot make the copy false and an editor's bookkeeping ("the page subject is") is not a page claim. EXACT NORMALIZED TOKEN MEMBERSHIP, never substring: `held.includes(w)` let a claim word ride inside a longer evidence word, so a page whose evidence said "credit" was held to support copy saying "red". A WHOLE WORD, matched whole, after both sides go through the ONE tokenizer. THIS IS SPELLING AND NOTHING MORE: meaning stays the judge's. PURE, so a stored row is re-read exactly as a fresh draft is checked. */
/** THE TOKENIZER'S ONE OVER-TRIM, UNDONE, AND NOTHING ELSE. Its plural rule takes two letters off a word ending in "ses", so "showcases" comes back as "showcas" beside the singular "showcase" and one word failed to match itself; only that exact spelling is repaired here. NO SILENT E IS DROPPED and NO TRAILING PLURAL IS STRIPPED: dropping a final e made "rate" and "rat" the same token, so a page whose evidence said "rat" was read as carrying copy that says "rate" (and the reverse), and a bare trailing-s strip aliases unrelated words the same way ("does" and "doe", "news" and "new"). The plural is already handled where it belongs, by the ONE tokenizer, on both sides. */
const fold = (w: string): string => w.replace(/se$/, "s");
/** A CAPITAL LETTER RUNNING OUT OF A LOWERCASE ONE IS TWO WORDS. The capture glues a heading to the sentence under it ("Persian AccessoriesShowcase your heritage"), and matching whole words against that string calls the page's own word missing. Both sides are split the same way, so this can only ever restore a boundary a crawl removed. */
const words2 = (t: string): string[] => topicTokens(t.replace(/([a-z])([A-Z])/g, "$1 $2"));


/** WHY THIS DELIVERABLE IS NOT FINISHED, or empty. PURE, and no line here is an opinion about whether the copy is any good. */
export function deliverableFailures(d: EditorDeliverable, p: SourcePacket): string[] {
  const out: string[] = [], stored = storedPage(p), corpus = corpusOf(p);
  for (const [what, text] of [["copy", d.finalCopy], ["placement", d.placementAnchor], ["measurement target", d.measurementTarget]] as const) {
    if (blankish(text)) out.push(`its ${what} is blank or still carries a placeholder`); }
  if (blankish(d.targetUrl) || urlKey(d.targetUrl) !== urlKey(p.targetUrl)) out.push("it names a page this evidence is not about");
  const known = new Set(Object.keys(p.evidence)), unknown = [...new Set([...d.evidenceIdsUsed, ...d.claims.flatMap((c) => [...c.supportedBy])])].filter((id) => !known.has(id));
  // NAMING THE CONFUSION, NOT JUST THE SYMPTOM (Codex, 2026-08-23): live, a claim cited "owned_snapshot", a SOURCE KIND from the evidenceRefs vocabulary and never a grounding id, and "not on file" sent the retry hunting a missing fact instead of correcting a mix-up it could fix for free.
  if (unknown.length > 0) out.push(unknown.some((id) => SOURCE_KIND.has(id))
    ? `it cites ${unknown.filter((id) => SOURCE_KIND.has(id)).slice(0, 3).map((id) => `"${id}"`).join(", ")} as evidence, which is a kind of source and not one of the stored ids handed to it: a claim may only name ids like ${Object.keys(p.evidence).slice(0, 3).join(", ")}`
    : `it names evidence that is not on file: ${unknown.slice(0, 3).join(", ")}`);
  if (d.claims.length === 0) out.push("it makes no claim anybody could check"); if (d.claims.some((c) => c.supportedBy.length === 0 || blankish(c.text))) out.push("one of its claims names no evidence at all");
  // THE COPY IS READ INDEPENDENTLY OF WHAT WAS DECLARED, so an assertion the writer simply did not mention is held to the same evidence as one it did. NOT A VOCABULARY TEST: asking whether every word of a sentence is printed on the page refuses the one thing an editor is for, a faithful paraphrase, and this codebase has already thrown that mechanism out once. This asks a STRUCTURAL question instead. Enumerating is naming MEMBERS, and a member either exists or it does not. The HEAD of a list is skipped on purpose: a pattern reading backwards from the first comma swallows the verb in front of it ("browse and filter Persian accessories by type"), and judging that phrase judges the sentence rather than the member. AND A LIST OF LONG MEMBERS IS NOT A LIST: "Ferdowsi, who founded an empire and wrote the epic that carried the Persian language" is a chain of clauses wearing commas, so a match with any member past MEMBER_WORDS is discarded whole rather than read as a claim about what the page holds.
  // A MEMBER IS A THING, NOT A FRAGMENT OF THE SENTENCE AROUND IT. Splitting on commas hands back whatever sits between them, so three finished answers were refused live over "with mammals of Iran", "under Shah Abbas I" and "symbolizing royal authority": a prepositional phrase modifies the head, a participle is half a verb, and neither is something the copy says this page holds. A preposition governs everything it introduces, so its whole segment goes, which is the only way "Shah Sultan Husayn" is read as part of "under Shah Abbas I and Shah Sultan Husayn" rather than as a member in its own right. MARKED, NEVER DROPPED: the list-level word count decides which lists are clause-chains, and removing members before it would let a list it discards today squeeze under the count and be judged for the first time.
  const members = (t: string): { t: string; prose: boolean }[] => t.split(",").slice(1).flatMap((seg) => { const p0 = PROSE.test(seg.trim());
    return seg.split(/\band\b|\bor\b/).map((x) => x.trim()).filter((x) => x.length > 2).map((x) => ({ t: x, prose: p0 || PROSE.test(x) || PARTICIPLE.test(x) })); });
  const asserted = [...new Set([...[...d.finalCopy.matchAll(ENUMERATED)].map((m) => members(m[1]!)),
    ...[...d.finalCopy.matchAll(OFFERED)].map((m) => [{ t: m[1]!.trim(), prose: false }])]
    .filter((list) => list.length > 0 && list.every((x) => words(x.t) <= MEMBER_WORDS)).flat().filter((x) => !x.prose).map((x) => x.t))];
  const invented = asserted.filter((t) => topicTokens(t).length > 0 && unheld(corpus, t).length > 0); if (invented.length > 0) out.push(`it tells a reader this page offers ${invented.slice(0, 3).map((t) => `"${t}"`).join(", ")}, and this page's own evidence shows no such thing`);
  // WHAT IS BEING REPLACED HAS TO EXIST, or the operator is told to swap words the page does not have, and the swap deletes whatever is truly there. A FIELD IS ITS OWN PLACE. A title, a heading and a description are lines the page already HAS, so what they replace is the stored FIELD and where they land IS that field, never a string inside the body copy. Checked against the body they were refused every single time: a description is not printed in a page's own words, so no real description edit could ever finish. Copy that lands in the body still owes a real anchor in it.
  const FIELD: Partial<Record<EditorDeliverable["actionType"], string | null>> = { title: p.title, h1: p.h1, meta: p.metaDescription };
  if (d.actionType in FIELD) {
    if (d.beforeText != null && flat(d.beforeText) !== flat(FIELD[d.actionType] ?? "\u0000")) out.push("the line it says it replaces is not the one this page carries");
    // NO TITLE OR HEADING DROPS A WORD THE PAGE EARNS CLICKS ON. A rewrite proposed "Shiraz Population" for a city page and stripped "Persian", "Boy" and "List" from a title earning 43 clicks: a word that appears both in the current line and in a search the page is PAID for is load-bearing, and only an explicit, evidenced reason may remove it. "List" is not filler when readers search for lists.
    if (d.actionType === "title" || d.actionType === "h1") {
      // PLAIN WORDS, NEVER TOPIC TOKENS. The destruction class lives exactly in the words a relevance tokenizer calls generic: "list" is noise to a topic gate and load-bearing on a page whose paid searches read "persian boy names list". A preserved search is compared as the searcher spelled it.
      const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3); const earning = new Set(p.demand.preserve.flatMap(wordsOf)); const after = new Set(wordsOf(d.finalCopy));
      const dropped = [...new Set(wordsOf(FIELD[d.actionType] ?? ""))].filter((t) => earning.has(t) && !after.has(t)); if (dropped.length > 0) out.push(`it drops ${dropped.slice(0, 3).map((t) => `"${t}"`).join(", ")}, which this page earns clicks on, and names no supported reason to`);
      const toks = topicTokens(d.finalCopy), reps = [...new Set(toks.filter((t, i) => toks.indexOf(t) !== i))]; // A LINE THAT SAYS A WORD TWICE IS A KEYWORD LIST WEARING A TITLE (operator, 2026-08-17, rejecting "Persian Swear Words, Persian Insults, Farsi Insults, Slang"): demand may add a phrase, never repeat one.
      if (reps.length > 0) out.push(`it says ${reps.slice(0, 3).map((t) => `"${t}"`).join(", ")} more than once, which is a keyword list rather than a line a person would write`);
    }
  } else {
    if (d.beforeText != null && !onPage(stored, d.beforeText)) out.push("the words it says it replaces are not on the stored page");
    if (!blankish(d.placementAnchor) && !onPage(stored, d.placementAnchor)) out.push("the place it says it lands is not on the stored page"); }
  if (d.actionType === "answer_block") {
    if (blankish(d.naturalHeading)) out.push("it lands somewhere new and names no heading");
    // A TRACKED PROMPT PASTED ABOVE A BLOCK IS A SEARCH STRING ON A CUSTOMER'S PAGE, the one thing a reader can see was written by a machine.
    else if (flat(d.naturalHeading!) === flat(p.trackedQuestion ?? "\u0000")) out.push("its heading is the tracked question said back word for word"); }
  // A REWRITE THAT COMES BACK AS THE LINE ALREADY THERE IS NOT A CHANGE. Case, spacing, dashes and end punctuation are not work: a card asking an operator to replace "(1979-Current) (2 Variations)" with "(1979 - present): 2 variations" is a chore dressed as an edit, and it passed both the deterministic half (the strings differ) and the judge (the copy is fine, and it was never asked whether anything moved).
  const same = (a: string, b: string): boolean => flat(a).replace(/[–—-]/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
    === flat(b).replace(/[–—-]/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (d.beforeText != null && same(d.finalCopy, d.beforeText)) out.push("it hands back the line the page already carries, re-punctuated, so nothing about the page would change");
  const [lo, hi, unit] = BAND[d.actionType], n = unit === "c" ? d.finalCopy.trim().length : words(d.finalCopy);
  if (n < lo || n > hi || UNSAFE.test(d.finalCopy)) out.push(`its copy is ${n} long, outside the ${lo} to ${hi} this field takes, or carries something nobody can paste`);
  if ((d.actionType === "answer_block" || d.actionType === "section") && SELF_POINTER.test(d.finalCopy)) { // A LINK IS CHECKED AS A LINK: the destination has to be a page this account actually owns, and the words on it have to be in the sentence being pasted. AN ANSWER MAY NOT BE ABOUT THE PAGE. Only for copy that lands in the body; a description IS about the page.
    out.push("it points at the page instead of answering"); }
  out.push(...rereadableRefusals(d.finalCopy, p, d.naturalHeading));
  if (!(d.actionType in FIELD)) { // A FIELD EDIT HAS NO ANCHOR TO JUDGE (2026-08-22): a title, heading or description replaces its own field, so whatever the model wrote in the anchor slot is bookkeeping, and refusing a finished description over the SHAPE of an anchor nobody will use blocked every description on the account.
    if (d.placementAnchor.trim().length > ANCHOR_MAX) out.push("where it goes is a paragraph rather than a place on the page");
    if (/[a-z][A-Z]/.test(d.placementAnchor) || /[!?.][A-Z]/.test(d.placementAnchor.slice(1, -1)))
      out.push("where it goes is two page elements glued together, which nobody can find on the rendered page");
    if (CHROME_AT.test(d.placementAnchor)) out.push("where it goes is taken from the crawl's own markers, not from the page");
  }
  if (d.actionType === "internal_link") {
    if (!d.linkTo || !p.ownedPaths.some((x) => x.toLowerCase() === d.linkTo!.toLowerCase())) out.push("the page it links to is not one this account owns");
    if (blankish(d.anchorText) || !flat(d.finalCopy).includes(flat(d.anchorText!))) out.push("the words it puts on the link are not in the sentence it hands over"); }
  if (!(d.implementationMinutes > 0)) out.push("it does not say how long it takes");
  // RECOMBINATION, WHICH IS THE ONE THING THE CORPUS ABOVE CANNOT SEE. "modern designs" reached a paying customer because the page carries "timeless designs" in one sentence and "modern fashion" in another, and a bag of words holds every part of a phrase the page never actually says. THE PAGE'S OWN ORDER ANSWERS IT: a member naming something this page holds is printed on the page, in those words, next to each other. Checked against the page and the evidence, NEVER against the claims the writer declared: that corpus is the writer's own bookkeeping, and holding a member to it refused finished answers over an inflection ("symbolizing" against a claim reading "symbolizes") and over ordinary prose no claim would ever restate. One word is nobody's recombination, so the check starts at two.
  // WORD CONTAINMENT IS NOT GROUNDING, AND IT REFUSED EVERY DRAFT BEACON EVER WROTE (Codex, 2026-08-23). The two gates that stood here demanded every content word of the copy appear LITERALLY in the cited evidence, so finished work was refused over "reader", "start", "here", "say", "reason", "looking", "group" and "accessory": no sentence a person would write can pass one, and none did across four live dispatches. WHAT THEY PROTECTED IS KEPT, aimed at what actually harms a reader: a page that never mentions Cyrus the Great or Ferdowsi got copy asserting both, and that card reached a paying customer. A fabricated fact wears a NAME. ON FILE MEANS ON FILE, never the claims the writer declared: a corpus carrying the writer's own sentences lets a fabrication ground itself by being asserted twice, which is how the claim graph passed "Cyrus the Great". Meaning is judged by the evaluator that reads every claim against the evidence it names.
  const onFile = `${corpus} ${stored} ${Object.values(p.evidence).join(" ")} ${p.trackedQuestion ?? ""}`, seq = words2(onFile).filter((w) => !CARRIER.has(w));
  const recombined = asserted.filter((t) => { const need = topicTokens(t).filter((w) => !CARRIER.has(w));
    return need.length > 1 && !seq.some((_, i) => need.every((w, j) => seq[i + j] === w)); });
  if (recombined.length > 0) out.push(`it tells a reader this page offers ${recombined.slice(0, 3).map((t) => `"${t}"`).join(", ")}, and this page never puts those words together`);
  const invented_names = unheldNames(onFile, d.finalCopy);
  if (invented_names.length > 0) out.push(`its copy names ${invented_names.slice(0, 3).map((t) => `"${t}"`).join(", ")}, and nothing on file about this page mentions them`);
  return [...new Set(out)];
}

/** A CLOSING SENTENCE THAT ASKS THE READER TO READ THE PAGE IS FILLER WHERE A FACT BELONGS: the description  equivalent of "click here". DETERMINISTIC and about the SHAPE of an imperative, never a vocabulary: the final  sentence, opening on an instruction to read, view, browse, visit or shop. Trimmed where what is left still fills  the field, and otherwise sent back for ONE redraft that is told not to write one. PURE. */
const CTA_TAIL = /^(?:read|click|see|view|browse|visit|explore|discover|shop|learn|find|check)\b/i; const NO_CTA = "Write no closing call to action. Never end with an instruction to read, view, browse, visit or shop this page: the last sentence has to carry a fact about the page.";
export function withoutCta(copy: string, type: EditorDeliverable["actionType"]): string | null {
  // LIST-SHAPED COPY IS READ BY ITS LINES (review, 2026-08-22): with line breaks preserved, the closing CTA is a whole last LINE and the space-suffixed boundaries below never see it, while the " - " boundary would amputate the meaning off an honest "phrase - meaning" list item. Multi-line copy therefore drops a CTA last line whole and keeps every list separator; the single-line path is byte for byte what it was.
  if (copy.includes("\n")) {
    const lines = copy.trim().split("\n");
    if (!CTA_TAIL.test(lines[lines.length - 1]!.trim().replace(/^[.;!?\s-]+/, ""))) return copy;
    const kept = lines.slice(0, -1).join("\n").trim(), [lo0, , unit0] = BAND[type];
    return kept && (unit0 === "c" ? kept.length : words(kept)) >= lo0 ? kept : null;
  }
  // A CLAUSE IS A CLOSING LINE TOO. Cut only on a full stop and the same instruction came back joined on with a dash or a semicolon ("- click to read the focused account"), which is the identical filler wearing different punctuation. THE CUT LEAVES A SENTENCE, NEVER A STUB: whatever the join was, what is left ends its own line.
  const t = copy.trim(), cut = Math.max(t.lastIndexOf(". "), t.lastIndexOf("; "), t.lastIndexOf("! "), t.lastIndexOf("? "), t.lastIndexOf(" - "));
  if (cut < 0 || !CTA_TAIL.test(t.slice(cut).replace(/^[.;!?\s-]+/, ""))) return copy;
  const kept = t.slice(0, cut + 1).trim().replace(/[;,-]+$/, "").trim(), [lo, , unit] = BAND[type], done = /[.!?]$/.test(kept) ? kept : `${kept}.`;
  return (unit === "c" ? done.length : words(done)) >= lo ? done : null; }
/** THE ONE ANSWER: a finished deliverable, or every reason it is not one. Deterministic first, so a judge is never paid to read copy the packet already refutes. */
export async function acceptDeliverable(d: EditorDeliverable, p: SourcePacket, judge: JudgeFn | undefined): Promise<string[]> {
  const hard = deliverableFailures(d, p);
  if (hard.length > 0) return hard;
  if (!judge) return ["nothing read it for sense, so it is not finished"];
  const v = await judge(d, p).catch(() => null); if (!v) return ["no reading of it came back, so nothing is accepted"];
  const failed = ([["pageFit", "it does not belong on this page"], ["claimsEntailed", "the evidence it names does not carry every claim it makes"],
    ["usefulAndNatural", "it is not useful or does not read naturally"], ["placementCorrect", "it lands in the wrong place"],
    ["implementableNow", "an operator could not act on it as written"], ["improvesPage", "it repeats the search instead of improving the page"],
    ["wouldHandToCustomer", "no serious editor would hand this to a customer"]] as const).filter(([k]) => v[k] !== true).map(([, why]) => why);
  // THE EVALUATOR'S OWN SENTENCE IS THE FEEDBACK, not the checkbox labels (Codex, 2026-08-23): the notes name the single worst defect and were being thrown away, so the retry heard "not useful" and never WHY. The note rides first, so the corrective loop repeats the evaluator's exact objection to the writer.
  return failed.length > 0 && typeof v.notes === "string" && v.notes.trim() ? [`the evaluator's exact objection: ${v.notes.trim()}`, ...failed] : failed;
}

/** THE STORED FACTS THIS PAGE'S EDIT IS CHECKED AGAINST, each under an id the drafter is handed and the  deliverable must name back. Nothing here is fetched: it is the snapshot's own capture and this card's own evidence, so "the evidence supports this" is a lookup rather than a belief. */
function packetFor(card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null, owned: readonly OwnedPageEvidence[], bannedTerms: readonly string[]): SourcePacket {
  const evidence: Record<string, string> = {};
  card.evidence.hints.forEach((h, i) => { evidence[`card-${i + 1}`] = h; });
  if (page.content?.title) evidence["page-title"] = page.content.title; if (page.content?.h1) evidence["page-h1"] = page.content.h1;
  (page.content?.outline ?? []).slice(0, 8).forEach((h, i) => { evidence[`page-heading-${i + 1}`] = h; });
  // THE SIX PASSAGES MOST ABOUT THIS CARD'S QUESTION, in page order, never simply the first six the crawler stored: a claim can only cite words the packet carries, and the words that ground an answer about "persian rugs known for" live wherever the page talks about it, not necessarily in its opening.
  const qTokens = new Set(topicTokens(`${card.primaryQuery} ${card.evidence.query ?? ""}`));
  const scored = (body?.passages ?? []).map((t, i) => ({ t, i,
    score: topicTokens(t).filter((w) => qTokens.has(w)).length }));
  const picked = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 6)
    .sort((a, b) => a.i - b.i);
  (picked.length > 0 ? picked : scored.slice(0, 6)).forEach((x, i) => { evidence[`page-copy-${i + 1}`] = x.t; });
  const rows = page.search?.topQueries ?? []; // THE PAGE'S OWN DEMAND, off its stored search rows: what it earns (never to be dropped) and how searchers actually phrase it (legal vocabulary, each entry a citable demand-N fact carrying its own numbers).
  const preserve = [...rows].filter((q) => q.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 10).map((q) => q.query);
  const units = demandUnitsOf(rows, () => 0);
  const vocabulary: string[] = [...new Set(units.flatMap((u) => u.vocabulary))].slice(0, 15);
  rows.slice(0, 10).forEach((q, i) => {
    evidence[`demand-${i + 1}`] = `people search "${q.query}" ${q.impressions} times in 90 days${q.position != null ? ` and this page sits at position ${q.position.toFixed(1)} for it` : ""}`;
  });
  return { targetUrl: page.url, title: page.content?.title ?? null, h1: page.content?.h1 ?? null, metaDescription: body?.metaDescription ?? page.content?.metaDescription ?? null,
    bodyText: [...(body?.passages ?? []), body?.vocabulary ?? ""].join(" ").replace(CHROME, " "),
    headings: [...(page.content?.outline ?? []), ...(body?.headings ?? [])], evidence, trackedQuestion: card.primaryQuery,
    ownedPaths: owned.map((o) => pathOf(o.url)), bannedTerms, demand: { preserve, vocabulary } };
}

/** The wiring one editor run needs, and nothing about which card asked for it, so a card's own edit and a sibling page's edit are ONE editor rather than two that drift. */
type EditorWiring = { tenantId: string; now: Date; complete?: CompleteFn; bypassCache?: boolean; judge?: JudgeFn; refusals?: Map<string, string>;
  /** THE PASS'S OWN HARD ATTEMPT BUDGET, shared by every editor run in it and decremented BEFORE each charged call, so a refusal costs exactly what it cost. It is also where this page's REAL spend is recorded. Absent means one editor run standing on its own. */
  attempts?: Allowance;
  /** Pages nobody settled: the provider could not answer, or this pass ran out of its own allowance part-way through the deliverable. Neither is a verdict on the copy. */ unsettled?: Set<string> };
/** The fields this editor writes: a line the page already has, or the copy an opening owes. */
type EditorField = "title" | "h1" | "meta" | "answer_block" | "internal_link";

/** THE EDITOR OVER ONE PACKET: the drafter writes the field against that page's own stored words, the deterministic half of the contract reads its homework against the same packet, and the judge reads it for sense. Null is a refusal, never a draft, and every refusal names itself through `refuse`. */
async function runEditor(packet: SourcePacket, field: EditorField, pageLabel: string, hints: string[],
  minutes: number, opts: EditorWiring, refuse: (why: string, extra?: Record<string, unknown>) => null,
  /** A LINK RUN CARRIES ITS OWN TWO FACTS: the owned page the sentence lands a link on, and the words that become the link. Both are the caller's, read off the card, never the model's. */
  link: { to: string; anchor: string } | null = null,
  /** REWRITE TARGET (Codex, 2026-08-23): the stored passage this copy REPLACES and the stored heading it sits under. Present means rewrite_existing_section: the deliverable's `before` IS that passage and the card says Replace, never "a new section". */
  rewrite: { heading: string | null; replaces: string } | null = null,
  lastRound = false): Promise<EditorDeliverable | null> {
  // THE LINE THE MODEL IS SHOWN IS THE LINE THE GATE CHECKS. The drafter used to be handed the CARD's stored `before` while the gate compared against the freshly loaded page, so any crawl newer than the card (a re-punctuated dash was enough) made the model echo one string and the gate demand another, and every field edit was refused for disagreeing with itself.
  const held = field === "meta" ? packet.metaDescription : field === "title" ? packet.title : field === "h1" ? packet.h1 : null;
  // THE MONEY IS SPENT HERE, SO THE BUDGET IS READ HERE. Counted down before the call and never after it, so a call that fails, refuses or throws has still been paid for and still counts against what this pass may spend.
  if (opts.attempts && (opts.attempts.left -= 1) < 0) { opts.unsettled?.add(DRAFT_BUDGET.keyOf({ pageUrl: packet.targetUrl })); return refuse("this pass has spent its whole attempt budget"); }
  const drafted = await draftAtomicEditStructured({
    query: packet.trackedQuestion ?? "", pageLabel, field: field === "internal_link" ? "answer_block" : field, currentValue: held,
    ...(field === "answer_block" ? { intent: AI_CASE_COPY.intentOf(packet.trackedQuestion ?? "") } : {}), // THE REQUIRED ANSWER SHAPE, TYPED (Codex, 2026-08-23): the AEO producer's own classifier reads the tracked question and the drafter receives the shape as a directive, not prose buried in a brief; deterministic on the question, so draft and card always agree
    // THE SEARCHERS' WORDS RIDE THE BRIEF. The drafter used to receive one query string and the page's own outline, so it optimised for what the page already says (a shoes page described by its SKU names) and never for what people search. Demand is handed over explicitly, and the earning words are marked as load-bearing, so the model leads with the phrasing that has an audience and drops nothing that pays.
    outline: [...packet.headings].slice(0, 8), evidenceHints: [...hints,
      ...(packet.demand.vocabulary.length > 0 ? [`People actually search this as: ${packet.demand.vocabulary.slice(0, 8).map((v) => `"${v}"`).join(", ")}. Lead with the highest-demand phrasing the evidence supports.`] : []),
      ...(packet.demand.preserve.length > 0 ? [`This page already earns clicks on: ${packet.demand.preserve.slice(0, 6).map((v) => `"${v}"`).join(", ")}. Never drop those words from a line that carries them today.`] : [])], tenantId: opts.tenantId,
  }, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache }).catch(() => null);
  spendOf(opts.attempts, drafted);
  // A CACHED ANSWER COST NOTHING, SO IT COUNTS AS NOTHING: the budget line above pays before asking because a charged call that fails was still bought, but a cache hit never reached the provider, and letting it spend an attempt let twelve long-refused cached drafts starve the cards this pass actually exists for.
  if (opts.attempts && drafted && (drafted as { cached?: true }).cached) opts.attempts.left += 1;
  // WHY THE DRAFTER SAID NO, NOT JUST THAT IT DID. The status alone ("validation_failed") named nothing that could be acted on, so diagnosing one refusal meant buying another call to see what the last one objected to. WHAT CAME BACK INSTEAD, ON THE RECEIPT (Codex, 2026-08-23): "no draft came back" cost /persian-female-first-names six provider calls and $0.049 and told nobody anything, because the status and the drafter's own errors were logged and then dropped. The reason is the receipt's job.
  if (!drafted || drafted.status !== "drafted") { opts.unsettled?.add(DRAFT_BUDGET.keyOf({ pageUrl: packet.targetUrl }));
    const st = drafted?.status ?? "threw", errs = (drafted as { errors?: string[] } | null)?.errors?.slice(0, 3) ?? [], fail = (drafted as { failure?: string } | null)?.failure ?? null; return refuse(`no draft came back (${st}${fail ? `, ${fail}` : ""})${errs.length > 0 ? `: ${errs.join("; ")}` : ""}`, { status: st, errors: errs, failure: fail }); }
  const v = drafted.value as AtomicEditDraft, claims = v.claims.map((c) => ({ text: c.text, supportedBy: c.supportedBy }));
  const deliverable: { -readonly [K in keyof EditorDeliverable]: EditorDeliverable[K] } = {
    actionType: field, targetUrl: packet.targetUrl,
    // LINE STRUCTURE IS PART OF THE DELIVERABLE (operator, 2026-08-22): flattening every newline turned a phrase list into one run-on paragraph. Spaces collapse WITHIN a line; a list-shaped answer's line breaks survive into copy, store and paste.
    placementAnchor: v.placementAnchor, beforeText: v.before,
    finalCopy: v.after.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n"),
    naturalHeading: v.naturalHeading, claims, evidenceIdsUsed: [...new Set(claims.flatMap((c) => [...c.supportedBy]))],
    // THE ID IS RESOLVED WHERE THE EVIDENCE IS IN HAND. Afterwards nobody can: the packet is built from a snapshot and a body read that this pass holds and the next one rebuilds, so "(from page-copy-1)" on a stored row named a fact that no longer existed anywhere. BANKED WHOLE ENOUGH TO RE-READ (2026-08-22): truncating a fact at 400 characters made the banked-copy re-read refuse words the acceptance corpus genuinely carried, un-drafting finished work on later passes.
    supportFacts: [...new Set(claims.flatMap((c) => [...c.supportedBy]))].filter((id) => !!packet.evidence[id]).map((id) => ({ id, fact: packet.evidence[id]!.slice(0, 1400) })),
    uncertaintyOrOmitted: v.risks, implementationMinutes: v.implementationMinutes || minutes,
    measurementTarget: v.proofPlan.metrics[0] ?? "",
    ...(field === "internal_link" && link ? { linkTo: link.to, anchorText: link.anchor } : {}),
  };
  // THE MODEL PROPOSES, CODE VERIFIES. A field edit replaces the page's OWN stored line, and a model that paraphrases or re-spaces it by a character was refused outright. A near miss is RESOLVED to the exact stored form here, so what persists is still character-exact to the page; only a `before` naming something else fails. A NEAR MISS IS PUNCTUATION, NOT DISAGREEMENT. The house rule forbids en dashes, so a model asked to echo a stored line containing one rewrites it ("550-330" for "550\u2013330") and the two strings stop matching. They are compared with dashes and their spacing normalized, and the STORED form is what gets written back.
  const norm = (t: string): string => flat(t).replace(/[\u2013\u2014]/g, "-").replace(/\s*-\s*/g, "-");
  const near = (a: string, b: string): boolean => norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
  // AN ANCHOR IS A SENTENCE A HUMAN CAN FIND. The model may hand back a whole paragraph or a run that starts in the crawl's own markers; the SHORTEST stored sentence carrying it is what an operator can actually look for, so the anchor is resolved to that and only an anchor nothing on the page carries is refused below. THE CLOSING CALL TO ACTION, BEFORE ANY GATE READS THE COPY: trimmed where the field still fills without it, and otherwise ONE redraft that is TOLD not to write one. Recursion, not a loop, so the retry pays the same attempt budget through the same door and a second failure refuses instead of buying a third. THE CTA REPAIR IS DETERMINISTIC AND FREE (Codex, 2026-08-23): the closing line is trimmed when the field still fills, and when too little is left the refusal goes to the PRICED corrective loop like every other lesson, instead of recursively buying a draft the six-unit price never counted.
  const trimmed = withoutCta(deliverable.finalCopy, field);
  if (trimmed == null) return refuse("its closing line asks the reader to read the page and too little is left without it", { reasons: [NO_CTA] });
  deliverable.finalCopy = trimmed;
  // PLACEMENT IS MECHANICAL, NOT GENERATIVE (Codex, 2026-08-23). The model invented anchors and the live gate refused them ("the place it says it lands is not on the stored page", /iran-flags/achaemenid-empire-flag, 01:30Z). For an answer block CODE chooses the place: the page's own stored H1, else its title, else its first clean stored heading, which is exactly where a summary answer belongs. Whatever the model wrote in the anchor slot is bookkeeping. No trustworthy stored anchor means the candidate stays OWED with that exact reason, never an invented place.
  if (field === "answer_block" && rewrite) {
    // A REWRITE REPLACES; IT NEVER APPENDS. The anchor is the section's own stored heading (else the page top), and `before` IS the stored passage being replaced, so the gate that demands `before` exist on the page holds this to a real section.
    deliverable.placementAnchor = (rewrite.heading ?? packet.h1 ?? packet.title ?? "").trim() || deliverable.placementAnchor;
    deliverable.beforeText = rewrite.replaces;
  } else if (field === "answer_block") {
    const spot = [packet.h1, packet.title, ...packet.headings].find((x): x is string => !!x && !blankish(x) && x.trim().length <= ANCHOR_MAX && !CHROME_AT.test(x) && !/[a-z][A-Z]/.test(x));
    if (!spot) { opts.unsettled?.add(DRAFT_BUDGET.keyOf({ pageUrl: packet.targetUrl })); return refuse("the page's stored copy carries no clean heading to place this answer under"); }
    deliverable.placementAnchor = spot.trim(); }
  const anchor = deliverable.placementAnchor.trim();
  // THE MAIN HEADING IS ALWAYS A FINDABLE PLACE: an anchor that IS the page's clean stored H1 (or title) stands as given, and the glued-sentence remap below never runs on it.
  const cleanTop = [packet.h1, packet.title].find((x) => x && flat(x) === flat(anchor));
  if (cleanTop) deliverable.placementAnchor = cleanTop;
  else if (anchor && field !== "answer_block") {
    // AMBIGUITY IS A REFUSAL, NEVER A GUESS: two distinct stored sentences sharing the matched prefix means the operator could land the copy in the wrong place, so nothing is rewritten and the card keeps its owed note.
    const cands = [...new Set(packet.bodyText.replace(CHROME, " ").split(/(?<=[.!?])\s+|\n+/).map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= ANCHOR_MAX && flat(t).includes(flat(anchor.slice(0, 60)))))];
    if (cands.length > 1) return refuse("where it goes matches more than one place on the page", { reasons: ["where it goes matches more than one place on the page"] });
    if (cands[0]) deliverable.placementAnchor = cands[0];
  }
  if (held && deliverable.beforeText != null && near(held, deliverable.beforeText)) deliverable.beforeText = held;
  // A JUDGING IS A CHARGED CALL LIKE ANY OTHER. It went uncounted entirely, which is how a five-draft cap turned into hundreds of calls; the deterministic half runs first inside `acceptDeliverable`, so an exhausted budget only ever costs the copy a reading it could not pay for, never a refusal the packet could have made for free.
  if (opts.attempts && !opts.judge && (opts.attempts.left -= 1) < 0) { opts.unsettled?.add(DRAFT_BUDGET.keyOf({ pageUrl: packet.targetUrl })); return refuse("this pass has spent its whole attempt budget"); }
  const refused = await acceptDeliverable(deliverable, packet, opts.judge ?? evaluator(opts.tenantId, opts.now, opts.attempts));
  if (refused.length > 0 && lastRound && softOnly(refused)) return { ...deliverable, softFailures: refused.slice(0, 4) }; // a LAST round failing only SOFT rules hands the complete draft back as REVIEW work with its notes, rather than discarding a paid answer over style (Codex, 2026-08-23)
  if (refused.length > 0) return refuse(refused[0]!, { reasons: refused.slice(0, 3), held: (held ?? "").slice(0, 120), proposed: (deliverable.beforeText ?? "").slice(0, 120), copy: deliverable.finalCopy.slice(0, 200), claims: deliverable.claims.map((c) => `${c.text} <- ${c.supportedBy.join(",")}`).slice(0, 4) });
  return deliverable;
}

/** THE STORED WORDS OF ONE PAGE, AS A PACKET. Built off the held body alone, so any page of the account whose copy is on file can be edited on its own evidence rather than only the page a card happens to sit on. */
function packetForBody(body: OwnedPageBody, query: string, hints: readonly string[], ownedPaths: readonly string[], bannedTerms: readonly string[], demand: SourcePacket["demand"] = { preserve: [], vocabulary: [] }): SourcePacket {
  const evidence: Record<string, string> = {};
  if (body.title) evidence["page-title"] = body.title; if (body.h1) evidence["page-h1"] = body.h1;
  body.headings.slice(0, 8).forEach((h, i) => { evidence[`page-heading-${i + 1}`] = h; });
  body.passages.slice(0, 6).forEach((t, i) => { evidence[`page-copy-${i + 1}`] = t; });
  hints.slice(0, 5).forEach((h, i) => { evidence[`case-${i + 1}`] = h; });
  return { targetUrl: body.url, title: body.title, h1: body.h1, metaDescription: body.metaDescription,
    bodyText: [...body.passages, body.vocabulary].join(" ").replace(CHROME, " "),
    headings: body.headings, evidence, trackedQuestion: query, ownedPaths, bannedTerms, demand };
}

/** ONE FINISHED FIELD ON ONE PAGE OF THIS ACCOUNT, or nothing. Telling sibling pages apart is ONE decision on several addresses, so every address is written through the SAME editor against ITS OWN stored body: same drafter, same deterministic checks, same judge. A refusal anywhere leaves the bundle unfinished, which is what completeness already demands of a change that names more than one page. */
export async function draftFieldForPage(input: { field: EditorField; body: OwnedPageBody; query: string;
  brief: string; evidenceHints: readonly string[]; ownedPaths: readonly string[]; minutes: number },
opts: EditorWiring & { bannedTerms?: readonly string[] }): Promise<{ before: string | null; after: string; anchor: string; heading: string | null; minutes: number } | null> {
  const packet = packetForBody(input.body, input.query, input.evidenceHints, input.ownedPaths, opts.bannedTerms ?? []);
  const refuse = (why: string, extra: Record<string, unknown> = {}): null => {
    log.info("[drafted-copy] a page in this change is not finished", { tenantId: opts.tenantId, page: input.body.url, field: input.field, why, ...extra });
    return null; };
  const done = await runEditor(packet, input.field, input.body.h1 ?? input.body.title ?? input.body.url,
    [...Object.entries(packet.evidence).map(([id, text]) => `${id}: ${text.slice(0, 400)}`), input.brief,
      "Every claim you make must name the ids above that carry it. Write only what those words already show about this page. DECLARE A CLAIM FOR EVERY ASSERTION YOUR COPY MAKES: anything the copy says that no claim of yours covers is refused."],
    input.minutes, opts, refuse);
  return done && { before: done.beforeText, after: done.finalCopy, anchor: done.placementAnchor,
    heading: done.naturalHeading, minutes: done.implementationMinutes };
}

/** THE FINISHED BLOCK EACH FAMILY OWES, so a producer's brief and the editor that completes it agree by construction: a missing description gets its line, an answer gap and a thin page get their section, a duplicated heading gets its own H1, and a link brief gets the one sentence that carries the link. A family off this map is a family the editor does not finish. */
type DraftKind = "description" | "answer" | "h1" | "link" | "title";
const KIND_OF_SLUG: Partial<Record<string, DraftKind>> = { missing_description: "description", ai_answer_gap: "answer",
  thin_page: "answer", duplicate_heading: "h1", internal_link: "link", demand_recovery: "answer" };
/** The destination an internal link card names, read off the card's own instruction line and nowhere else. */
const linkDestOf = (c: ChangeProposal): string | null =>
  c.recommendedChange.kind === "existing_edit" ? (/pointing to (\S+?),/.exec(c.recommendedChange.after)?.[1] ?? null) : null;
/** The block a card owes, its family's entry, EXCEPT that a recovery card owes whatever its own DIAGNOSIS named: a slipped ranking owes content, a collapsed click rate owes the title the searcher reads, and an undiagnosed decline owes nothing here, because drafting for an unnamed cause is the guess the causal boundary exists to refuse. */
const kindFor = (c: ChangeProposal): DraftKind | null => {
  const slug = slugOf(c);
  // THE TREATMENT DECIDES WHETHER THIS IS WRITING WORK AT ALL (Codex, 2026-08-23): reachability and differentiation cards need decisions and acquisition, and paying a writer for them buys copy that cannot be selected. A card minted before treatments existed keeps its old path.
  if (c.treatment === "technical_reachability" || c.treatment === "consolidate_or_differentiate" || c.treatment === "new_page") return null;
  if (slug === "demand_recovery") return c.diagnosisCause == null ? null
    : c.recommendedChange.kind === "existing_edit" && c.recommendedChange.field === "title" ? "title" : "answer";
  return KIND_OF_SLUG[slug] ?? null; };

/** ONE FINISHED EDIT for one page, or nothing: the description under its title, or the answer a page owes. The drafter is handed the page's own stored words under named ids and must hand back the whole homework; the deterministic half of the editor contract reads it against the packet, the judge reads it for sense, and the one canon validator reads the copy last. Anything short of all three leaves the producer's card. */
async function draftBlock(card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null, opts: DraftedCopyOptions, kind: DraftKind): Promise<{ d: EditorDeliverable; ready: boolean } | null> {
  const packet = packetFor(card, page, body, opts.snapshot.ownedPages, opts.bannedTerms ?? []), outline = (page.content?.outline ?? []).slice(0, 8);
  // THE REFUSAL IS FEEDBACK, NOT ONLY A LOG LINE. The deterministic contract's reasons are exact and repeatable, and a pass that never repeats them to the writer buys the same refusal every time; the last refusal's reasons are kept so ONE bounded second attempt can be told precisely what to fix.
  const lessons: string[] = [];
  const refuse = (why: string, extra: Record<string, unknown> = {}): null => {
    lessons.push([why, ...((extra.reasons as string[] | undefined) ?? [])].filter(Boolean).join("; ").slice(0, 400));
    opts.refusals?.set(DRAFT_BUDGET.keyOf(card), lessons.at(-1) ?? why); // the LAST word on this page, kept where the receipt can read it
    log.info(`[drafted-copy] the ${kind} is not finished`, { tenantId: opts.tenantId, path: card.pagePath, why, ...extra });
    return null; };
  // A LINK DELIVERABLE IS ONE SENTENCE, and both its facts are the card's own: the destination off its instruction line, the anchor off the search it names. Either unreadable is a refusal, never a guess.
  const dest = kind === "link" ? linkDestOf(card) : null; if (kind === "link" && !dest) return refuse("the destination this link names cannot be read off the card");
  // A THIN PAGE IS A REASON TO GO AND GET FACTS, NEVER A REASON TO ABANDON THE CHANGE (Codex, 2026-08-23): the material floor that stood here refused /funny-farsi-phrases at $0 over "44 words of material" on a page of 1,222 words with real assistant evidence behind it. What a candidate short of facts needs is the reading that supplies them, and the pass buys page readings for exactly that. Nothing is refused here for being poor, only for being wrong. THE REWRITE TREATMENT IDENTIFIES ITS SECTION OR REFUSES (Codex, 2026-08-23): live, a rewrite_existing_section card still said "A new section ... placed after the H1", because the vocabulary changed and the delivery did not. The stored passage sharing the most topic words with the tracked question IS the section being replaced; a page where none overlaps has no identifiable section, and that is a refusal, never an append.
  let rewrite: { heading: string | null; replaces: string } | null = null;
  // A PAGE THAT ALREADY ANSWERS THE QUESTION IS NOT GIVEN A SECOND ANSWER (Codex, 2026-08-23): /cities was funded add_answer_section and spent six calls and $0.039348 writing a block the evaluator refused because the page's own FAQ already said it. Another answer cannot fix a page that is not being RETRIEVED, and the duplicate is knowable before a cent moves.
  if (kind === "answer" && card.treatment === "add_answer_section" && Object.entries(packet.evidence).filter(([id]) => id.startsWith("page-copy-")).some(([, t]) => topicTokens(t).filter((w) => new Set(topicTokens(card.primaryQuery)).has(w)).length >= 3))
    return refuse("this page already answers this question in its own copy, so another section would duplicate it: the work is making the answer reachable and liftable, not writing it again");
  if (kind === "answer" && card.treatment === "rewrite_existing_section") {
    const q = new Set(topicTokens(card.primaryQuery));
    // THE TARGET IS THE PAGE'S OWN WORDS, VERBATIM (Codex, 2026-08-23). Stripping markers out of the target made the operator instruction unfindable ("bottom of page 12" is ordinary English, and taking it out leaves words no Ctrl-F will match), so the marker is ignored by the COMPARISON instead, on both sides. And the strongest candidate is chosen FIRST and then proved present: filtering before ranking silently retargeted the rewrite at a weaker passage with nothing said.
    const stored = storedPage(packet);
    // A TARGET IS A PASSAGE A PERSON CAN FIND AND WOULD AGREE TO LOSE (Codex, 2026-08-23, from the first live Ready change). The strongest overlap was a thousand-character crawler blob opening "top of pagePopular Persian(Farsi) Insults..." running from the page intro through a "Shop Now" block into two separate entries, and the operator was told to paste five lines over all of it: nobody can Ctrl-F that string, and following it would delete real content including commerce. Markers or glued-together page furniture mean it is not a section, and among the passages that ARE sections the shortest sufficient one wins, because a rewrite replaces the thing it improves and nothing else.
    const best = Object.entries(packet.evidence).filter(([id]) => id.startsWith("page-copy-"))
      .map(([, t]) => ({ t, n: topicTokens(t).filter((w) => q.has(w)).length }))
      .filter((x) => !CHROME_AT.test(x.t) && !/[a-z][A-Z]/.test(x.t) && x.t.trim().length <= 600)
      .sort((a, b) => b.n - a.n || a.t.length - b.t.length)[0];
    // A PLANNER THAT CHOSE IMPOSSIBLE WORK REPLANS; IT DOES NOT WRITE THE PAGE OFF (Codex, 2026-08-23): /funny-farsi-phrases, worth 555 recoverable clicks, was settled as a deterministic refusal because the planner asked to rewrite a page whose stored copy is one glued block. No section to replace is a fact about the TREATMENT, not the page, so the run continues as the section the page does not have.
    if (!best || best.n < 2) rewrite = null;
    else {
    if (!onPage(stored, best.t)) { rewrite = null; } // it is not a target if the page does not carry it, and that is the treatment's problem, not the page's
    else rewrite = { heading: packet.headings.find((h) => topicTokens(h).some((w) => q.has(w))) ?? null, replaces: best.t }; }
  }
  // THE BRIEF'S OWN TARGET COPY IS THE STARTING POINT, NOT A PROMPT TO OUTDO. A producer that already carries an agreed spec (the exact title or opening the evidence lane settled) hands it over to be VERIFIED against the stored page and refined to fit, so the model checks work rather than replacing it with an idea of its own. A RESEARCH BRIEF IS NOT A SPEC: its `after` is an instruction about the work, and telling the model to refine an instruction ships the instruction as copy, so a brief is framed as the job and never as the words.
  const spec = card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.after.trim() : "";
  const hints = [...Object.entries(packet.evidence).map(([id, text]) => `${id}: ${text.slice(0, id.startsWith("page-copy") ? 700 : 400)}`),
    ...(spec ? [card.researchOnly === true
      ? `The brief for this edit: "${spec.slice(0, 600)}". It describes the ASSIGNMENT: it is never the copy and never source material, no word of it may be cited as evidence, and its direction words (place, answer, add, write, section, block, directly, liftable) are workflow language that must not appear in the finished copy.`
      : `The target the team already agreed for this edit: "${spec.slice(0, 600)}". Verify it against the stored copy above and refine it to fit that copy exactly; do not replace it with a different idea.`] : []),
    ...(kind === "link" ? [`Write ONE sentence that reads naturally in this page's body and contains the exact phrase "${card.primaryQuery}". Those words become a link to ${dest}. Say only what the evidence ids above carry.`] : []),
    ...(kind === "answer" ? ["Write the answer as facts about the subject itself, in the searcher's own words. NEVER write \"this page\", \"this article\", \"here\", \"listed\", \"shown\" or any sentence describing the page; the first sentence answers the question outright.",
      // THE ANCHOR IS THE PAGE'S OWN MAIN HEADING (2026-08-22): stored body text is often crawler-glued, so an anchor lifted from it fails the findability gate on every retry; the H1 is stored clean and is exactly where a summary answer goes.
      "The PLACEMENT is chosen by the system (the page's own main heading), never by you: whatever you put in the anchor slot is discarded, so spend nothing on it and write only the copy, its claims and their evidence.",
      "Evidence FIRST, sentence second: pick the stored passage that proves the point, write the sentence FROM it, and cite that passage on the claim. A category word is a claim too: use the exact category word a cited passage establishes, or omit the category.",
      "BEFORE RETURNING, delete from your copy every adjective, register word or characterisation (informal, common, beloved, popular, playful and the like) that does not appear VERBATIM in the evidence above. If deleting them leaves your answer under the word floor, add more FACTS from other evidence ids, never adjectives: length comes from evidence, not decoration.",
      `The section heading must NOT repeat "${card.primaryQuery}" or the page's own H1 back word for word; name what the section delivers in different words.`,
      "Build every sentence from words the evidence ids above already contain. Do not add adjectives or descriptive words of your own (simple, popular, beautiful, everyday and the like): if the evidence does not carry a word, the copy may not either.",
      "The finished answer is 80 to 150 words. Count them before you return it; 79 is refused.",
      // STRUCTURE COMES FROM THE CARD'S OWN BRIEF, NEVER A STRATEGY THIS FILE CARRIES: a phrase-page recipe hardcoded here shipped on wildlife and rug cards (Codex, 2026-08-21).
      "Write complete sentences a reader can act on. Any expression in another language must be paired with its English meaning in the same sentence. A bare list with no facts attached is refused; so is a section that restates what the page already says: every sentence must state something the page keeps apart or leaves implicit, in the shape this card's own brief asks for.",
      "Every descriptive word your copy uses must ALSO appear in the text of one of your claims, and that claim must cite the passage carrying those same words: a meaning your copy states but no claim spells out is refused.",
      "When this card's brief asks for items each on its own line, return REAL line breaks between them, one item per line after the one-sentence answer; never one run-on paragraph.",
      "On a list-shaped answer, declare ONE claim PER LINE and word each claim with the SAME words that line uses, citing the passage that carries them: a line whose words appear in no claim is refused word by word.",
      "Return naturalHeading: a short heading for the NEW section, in words the evidence carries, never blank and never the tracked search said back."] : []),
    ...(kind === "title" || kind === "h1" ? (() => {
      // THE GATE'S OWN ARITHMETIC, SAID TO THE WRITER BEFORE IT WRITES: the exact words of the current line that earning searches carry (each must survive the rewrite), and the exact words the account bans.
      const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const earning = new Set(packet.demand.preserve.flatMap(wordsOf)); const held = kind === "title" ? packet.title : packet.h1;
      const keep = [...new Set(wordsOf(held ?? ""))].filter((w) => earning.has(w));
      return [`Rewrite the line, but every one of these words must still appear in it, spelled as given: ${keep.join(", ") || "(none)"}. Add the higher-demand phrase alongside them; NEVER replace them with it. No word may appear twice: write ONE natural line a person would publish, never a comma list of search phrasings.${packet.bannedTerms.length > 0 ? ` These words are banned and must not appear at all: ${packet.bannedTerms.join(", ")}.` : ""}`];
    })() : []),
    "Every claim you make must name the ids above that carry it. Write only what those words already show about this page. DECLARE A CLAIM FOR EVERY ASSERTION YOUR COPY MAKES: anything the copy says that no claim of yours covers is refused.",
    "Return sources as an empty array; never send a source entry with blank fields. evidenceRefs is DIFFERENT and required: cite at least one of the evidence ids handed to you above. A claim's supportedBy lists at most 8 ids."];
  const field = kind === "description" ? "meta" : kind === "h1" ? "h1" : kind === "title" ? "title" : kind === "link" ? "internal_link" : "answer_block";
  let deliverable = await runEditor(packet, field, card.pageLabel, [...hints, ...(rewrite ? [`You are REWRITING the existing section that currently reads: "${rewrite.replaces.slice(0, 500)}". Your copy REPLACES it in place: keep everything true it says, add the mapping, structure or precision it lacks, and never write it as a new section.`] : [])],
    card.estimatedEffortMinutes ?? 0, opts, refuse, kind === "link" ? { to: dest!, anchor: card.primaryQuery } : null, rewrite, (DRAFT_BUDGET.RETRIES as number) === 0);
  // THE RETRIES THE POLICY PAYS FOR, and not a number of its own: the loop and the allowance read one contract (decision/draft-budget), because when they drifted the allowance ran out mid-deliverable every time. Each retry is told EVERY refusal so far: a section juggles nine constraints and a retry told only the last one fixes that and breaks an earlier one, so the lessons accumulate. The editor decrements the pass's shared attempt budget before every charged call, so this is counted work, never free. A RETRY IS CORRECTIVE, NEVER "TRY AGAIN" (Codex, 2026-08-23): the exact words a gate called unsupported are named back as removals, so the next attempt fixes the named defect instead of rediscovering it. The full reasons still follow, oldest first, so fixing one cannot quietly reintroduce another.
  const corrective = (): string => { const bad = [...new Set(lessons.filter((l) => /copy says|copy names|drops/.test(l)).flatMap((l) => [...l.matchAll(/"([^"]{1,40})"/g)].map((m) => m[1]!)))];
    return [bad.length > 0 ? `REMOVE these exact words from your copy, or reword the sentence so a claim you declare carries them and cites the stored passage proving them: ${bad.map((w) => `"${w}"`).join(", ")}. For any category word, use the exact category the cited evidence establishes, or omit the category.` : "",
      `${lessons.length} previous ${lessons.length === 1 ? "attempt was" : "attempts were"} refused. Every reason, oldest first, each of which your next version must not repeat: ${lessons.map((l, i) => `(${i + 1}) ${l}`).join(" ")}`].filter(Boolean).join(" "); };
  for (let round = 0; !deliverable && lessons.length > round && round < DRAFT_BUDGET.RETRIES; round += 1)
    deliverable = await runEditor(packet, field, card.pageLabel, [...hints, corrective()],
      card.estimatedEffortMinutes ?? 0, opts, refuse, kind === "link" ? { to: dest!, anchor: card.primaryQuery } : null, rewrite, round === DRAFT_BUDGET.RETRIES - 1);
  if (!deliverable) return null;
  // THE ONE CANON VALIDATOR, last and unchanged: dashes, ungrounded figures and destructive replacements are house rules about any copy Beacon ships, not opinions about this deliverable, so they stay their own gate.
  const verdict = validateProposal({ ...card, recommendedChange: { kind: "existing_edit", field: kind === "description" ? "meta" : kind === "h1" ? "h1" : kind === "title" ? "title" : "section",
    before: deliverable.beforeText, after: deliverable.finalCopy } },
  // THE PAGE'S OWN WORDS GO IN. The canon validator's entailment half was handed the card's hints and the outline and never the stored body, so it judged copy about a page against everything except that page.
  { pageBodyText: packet.bodyText, evidenceText: [...outline, ...hints, packet.title ?? ""].filter(Boolean).join(" "), now: opts.now });
  if (verdict.verdict === "rejected") return refuse(verdict.reasons[0] ?? "canon refused it");
  // THE PROMOTION IS THE VERDICT, NOT A HABIT (operator, 2026-08-17; reshaped Codex, 2026-08-23): the ONE evaluator reads every round's copy with the adversary's own standards, its objections are fed back, and the canon's deterministic house rules run last, free. Any hold is a blocking finding with its sentence on the card. Unaffordable or unreadable means NOT promoted, never promoted unread.
  const ready = verdict.verdict === "ready" && !deliverable.softFailures?.length;
  if (deliverable.softFailures?.length) // A COMPLETE DRAFT THAT FAILED ONLY SOFT RULES IS REVIEW WORK, and the receipt says so: discarding it turned one imperfect word into zero output and sent the next pass to buy the identical draft again opts.note?.(DRAFT_BUDGET.keyOf(card), "review_saved", deliverable.softFailures.join("; ").slice(0, 300));
  // THE CANON HOLDING A DRAFT IS A VERDICT ON THE COPY, and it was the last one that said nothing. `needs_review` is not `rejected`: the words were read against today's evidence and held, so the page is SETTLED for this evidence and the final reviewer is never asked about copy the canon already stopped. It used to fall through with no note at all, `applyDraftedCopy` saw a non-null deliverable and stayed quiet too, and the receipt ended as a reasonless `retryable_blocked`: /funny-farsi-phrases, live, 2026-08-23 01:00Z. The canon's own status and its own first sentence go on the receipt; no second vocabulary is invented for something it already names.
  if (!ready) opts.note?.(DRAFT_BUDGET.keyOf(card), "deterministic_refusal",
    `${verdict.qualityStatus}: ${verdict.reasons[0] ?? verdict.factViolations[0] ?? "the canon held this copy for a human look"}`);
  // THE LAST EVALUATION WAS THE PROMOTION DECISION (Codex, 2026-08-23): the evaluator already read this copy inside the round that produced it, with its objections fed back, so no second semantic reviewer waits past the budget to refuse what the first one passed. What remains above is the canon: deterministic house rules, free, and already named when they hold.
  return { d: deliverable, ready };
}

/** WHAT THE PAGES THAT WIN THIS PAGE'S OWN HEAD SEARCH COVER, off headings at least two READ winners share. Deterministic and quotes nobody: a heading is named only when several of them agree on it. */
function winnersCover(snapshot: EvidenceSnapshot, page: OwnedPageEvidence): string[] {
  const head = [...(page.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0]?.query;
  const row = head ? (snapshot.research?.serpEvidence ?? []).find((s) => canonicalQueryKey(s.query) === canonicalQueryKey(head)) : null;
  if (!row) return [];
  const ranked = new Set(row.organic.map((o) => canonicalUrlKey(o.url))), mine = canonicalUrlKey(page.url);
  const seen = new Map<string, { label: string; on: Set<string> }>();
  for (const w of snapshot.research?.winningPages ?? []) {
    const key = canonicalUrlKey(w.url);
    if (key === mine || !ranked.has(key) || !w.extract) continue;
    for (const h of w.extract.headings) {
      const label = h.replace(/\s+/g, " ").trim();
      if (!label || label.length > 60 || words(label) > MAX_HEADING_WORDS || FURNITURE.test(label) || UNSAFE.test(label)) continue;
      const at = label.toLowerCase(), cur = seen.get(at) ?? { label, on: new Set<string>() };
      cur.on.add(w.domain); seen.set(at, cur);
    }
  }
  return [...seen.values()].filter((h) => h.on.size >= AGREEING_WINNERS)
    .sort((a, b) => b.on.size - a.on.size || a.label.localeCompare(b.label)).slice(0, MAX_HEADINGS).map((h) => h.label);
}

/** The same cards, with words wherever this pass could honestly put them. Never adds, drops or reorders a card. Fail-soft: anything that does not land leaves the producer's own card intact. */
export async function applyDraftedCopy(cards: readonly ChangeProposal[], opts: DraftedCopyOptions): Promise<ChangeProposal[]> {
  const out: ChangeProposal[] = [];
  // THE PASS OWNS THE MONEY, AND THIS FAMILY HAS NO POOL OF ITS OWN. A caller that hands in no budget gets one sized for a single family standing alone; the production caller hands in the pass's shared budget, so the editor competes for the same slots and the same charged calls as every other drafting family. A caller that hands in no plan gets one made from these cards alone, priced and ranked by the same rules; the production caller hands in the pass's shared plan, so the editor competes for the same slots and charged calls as every other family.
  const budget = opts.budget ?? DRAFT_BUDGET.plan({ candidates: MAX_DRAFTS,
    jobs: cards.filter((c) => kindFor(c) != null).map((c) => ({ key: DRAFT_BUDGET.keyOf(c), family: "editor", impact: c.impactScore ?? 0, calls: DRAFT_BUDGET.DELIVERABLE_CALLS })) });
  if (!opts.budget) log.info("[drafted-copy] no pass plan was handed in, so this run plans its own", { tenantId: opts.tenantId });
  // ONE bounded body read for the pass: the stored copy of exactly the pages about to be drafted, never the site.
  const drafting = cards.filter((c) => kindFor(c) != null)
    .map((c) => pageFor(opts.snapshot, c)?.url).filter((u): u is string => !!u).slice(0, MAX_DRAFTS);
  const bodies = drafting.length > 0 ? await loadOwnedPageBodies(opts.tenantId, drafting).catch(() => new Map<string, OwnedPageBody>()) : new Map<string, OwnedPageBody>();
  for (const card of cards) {
    const slug = slugOf(card), wants = kindFor(card); const page = wants ? pageFor(opts.snapshot, card) : null;
    if (!page) { out.push(card); continue; }
    // AN UNREAD PAGE BUYS NO DRAFT. A zero-word capture is blindness, not content: its own card already names the rendered read as the next step, and no body-dependent copy may stand on words nobody holds.
    if (slug === "thin_page" && (page.content?.wordCount ?? 0) === 0) { out.push(card); continue; }
    const meta = wants === "description", h1 = wants === "h1", link = wants === "link", title = wants === "title";
    // ONE ALLOWANCE PER CANDIDATE PAGE, and it was decided before this pass spent anything: a page the plan did not fund gets nothing here however early the editor reaches it. Never an early return: the NEXT card still collects its own. OUT OF TIME IS NOT OUT OF MONEY: a card the drive can no longer start is left exactly as its producer minted it, so it is owed rather than half-bought.

    const slice = opts.stopBy != null && Date.now() >= opts.stopBy ? null : budget.draw(DRAFT_BUDGET.keyOf(card), DRAFT_BUDGET.DELIVERABLE_CALLS);
    if (!slice) log.info("[drafted-copy] paid work stopped for this card: the pass's plan funded no allowance for it", { tenantId: opts.tenantId, path: card.pagePath, owed: wants });
    const done = slice ? await draftBlock(card, page, bodies.get(canonicalUrlKey(page.url)) ?? null, { ...opts, attempts: slice }, wants!) : null;
    // WHO SAID NO, ON THE RECEIPT. A card the pass paid for and did not finish was refused either by the provider (nobody could write it, so it stays owed) or by Beacon's OWN gates reading it against today's evidence (settled, and offering it again every drive is the retry loop this repair exists to stop).
    if (slice && !done) opts.note?.(DRAFT_BUDGET.keyOf(card), opts.unsettled?.has(DRAFT_BUDGET.keyOf(card)) ? "retryable_blocked" : "deterministic_refusal", opts.refusals?.get(DRAFT_BUDGET.keyOf(card)));
    const drafted = done?.d;
    if (drafted) {
      const dest = link ? linkDestOf(card) : null;
      out.push({ ...card, researchOnly: false,
        // FINISHED WORK IS READY WORK. Copy that cleared the drafter, the deterministic editor contract, the judge and the canon validator is not something waiting on a human look, and leaving it at `needs_review` put it in the same lane, with the same Copy and Mark done, as a card nobody wrote.
        status: done!.ready ? "ready" : card.status,
        // THE CLAIMS AND THE EVIDENCE BEHIND EACH ONE, PERSISTED WITH THE WORDS. "What supports every claim" was answerable only inside the pass that wrote the copy, so nothing on the card could be re-checked.
        claims: drafted.claims.map((c) => ({ text: c.text, supportedBy: [...c.supportedBy] })),
        // AND THE WORDS EACH ID STANDS FOR, so the detail page can quote the evidence instead of printing its symbol.
        supportFacts: drafted.supportFacts.map((f) => ({ id: f.id, fact: f.fact })),
        recommendedChange: { kind: "existing_edit", field: meta ? "meta" : h1 ? "h1" : title ? "title" : "section",
          before: drafted.beforeText, after: drafted.finalCopy,
          // WHERE IT GOES, IN THE PAGE'S OWN WORDS: the anchor the editor found in the stored copy, checked against that copy before it got here. A field edit replaces its own line and names no place.
          where: meta || h1 || title ? null : link
            ? `One sentence placed after "${drafted.placementAnchor}", with "${card.primaryQuery}" linked to ${dest ?? "the page it names"}`
            : card.treatment === "rewrite_existing_section" && drafted.beforeText
              ? `Replaces the existing passage under "${drafted.placementAnchor}"`
              : `A new section headed "${drafted.naturalHeading ?? ""}", placed after "${drafted.placementAnchor}"` },
        operatorSteps: meta
          ? [`Open the site editor on ${card.pagePath}`, "Paste the description above, exactly as written",
            "Mark it done here and the click rate gets read again"]
          : title
            ? [`Open the site editor on ${card.pagePath}`, "Replace the page title with the copy above, exactly as written",
              "Mark it done here and the click rate gets read again"]
          : h1
            ? [`Open the site editor on ${card.pagePath}`, "Replace the page heading with the copy above, exactly as written",
              "Mark it done here and the positions get read again"]
            : link
              ? [`Open the site editor on ${card.pagePath}`, `Find "${drafted.placementAnchor}" on the page`,
                "Paste the sentence above straight after it",
                `Make the words "${card.primaryQuery}" in that sentence a link to ${dest ?? "the page this card names"}`,
                "Mark it done here and the position gets read again"]
              : card.treatment === "rewrite_existing_section" && drafted.beforeText
                ? [`Open the site editor on ${card.pagePath}`, `Find the passage beginning "${drafted.beforeText.slice(0, 80)}" under "${drafted.placementAnchor}"`,
                  "Replace that passage with the copy above, exactly as written", "Mark it done here and the next answers get checked against it"]
                : [`Open the site editor on ${card.pagePath}`, `Find "${drafted.placementAnchor}" on the page`,
                  `Start a new section straight after it, with the heading "${drafted.naturalHeading ?? ""}"`,
                  "Paste the answer above as that section's opening, exactly as written", "Mark it done here and the next answers get checked against it"],
        limitations: [...card.limitations, ...(done!.d.softFailures ?? []), ...drafted.uncertaintyOrOmitted, meta
          ? "This line is written off the page's own title, headings and stored copy as last read, so check it still describes the page before you publish it."
          : title
            ? "This title is written off the page's own stored copy and the searches it still earns clicks on, so check it still names what the page delivers before you publish it."
          : h1
            ? "This heading is written off the page's own stored copy and search rows as last read, so check it still names what the page covers before you publish it."
            : link
              ? "This sentence is written off both pages' stored copy and search rows as last read, so check it reads naturally where it lands before you publish it."
              : "This answer is written off the page's own title, headings and stored copy as last read and the stored answers this card cites, so check every word of it is true of the page before you publish it."] });
      continue;
    }
    // A THIN PAGE WHOSE SECTION COULD NOT BE DRAFTED still leaves with the shape the winners agree on, so its brief carries real subjects rather than only an owed note.
    if (slug === "thin_page") {
      const covers = winnersCover(opts.snapshot, page);
      out.push(covers.length === 0 ? { ...card, limitations: [...card.limitations, owedNote("section")] } : { ...card,
        recommendedChange: { kind: "existing_edit", field: "section",
          before: card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.before : null,
          after: `${card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.after : ""} The pages that win this cover: ${covers.join(", ")}.` },
        operatorSteps: [...(card.operatorSteps ?? []).slice(0, -1), `Give each of these its own section: ${covers.join(", ")}`,
          ...(card.operatorSteps ?? []).slice(-1)],
        limitations: [...card.limitations, `Those subjects are the headings ${AGREEING_WINNERS} or more of the pages Google ranks for this search share, read off the copies on file, and they are what those pages cover rather than a plan written for this one.`] });
      continue;
    }
    out.push({ ...card, limitations: [...card.limitations, owedNote(meta ? "description" : title ? "title" : h1 ? "heading" : link ? "link sentence" : "answer")] });
  }
  log.info("[drafted-copy] paid work this pass", { tenantId: opts.tenantId, ...budget.spent(), callsLeft: Math.max(0, budget.calls.left) });
  return out;
}

/** THE FIELD a stored component replaces, where it replaces one at all. */
const FIELD_OF_KIND: Partial<Record<string, EditorField>> = { title: "title", h1: "h1", meta: "meta", opening_answer: "answer_block" };
/** The target page as the pass already holds it, never a fresh read: its four stored fields. */
type HeldPage = { title: string | null; h1: string | null; metaDescription: string | null; outline?: readonly string[] | null };

/** WHY BANKED ATOMIC COPY MAY NOT BE PRESERVED, or empty. Banking skips the drafter AND every gate, so copy accepted under an older boundary was served on for ever while the boundary moved under it: identity alone decided, and identity says nothing about whether the words still stand. The packet is rebuilt from what the ROW ITSELF banked (its claims and the exact words behind each id) plus the page as this pass holds it, and every deterministic rule is asked again on the evidence the copy actually leans on. No provider, no fresh read, and NO RE-JUDGING: the prior reading of sense stands while the material identity does. A row that banked no copy or no provenance answers empty, because there is nothing here to re-read; whether such a row may be preserved at all is preferFinished's question. */
function bankedCopyReasons(p: ChangeProposal, bannedTerms: readonly string[], held: HeldPage | null, preserve: readonly string[] = []): string[] {
  const c = p.recommendedChange, claims = p.claims ?? [], facts = p.supportFacts ?? [];
  if (c.kind !== "existing_edit" || p.researchOnly === true || claims.length === 0 || facts.length === 0) return [];
  const evidence: Record<string, string> = {}; for (const f of facts) evidence[f.id] = f.fact;
  const out: string[] = [], field = c.field as EditorDeliverable["actionType"];
  const unknown = [...new Set(claims.flatMap((x) => [...x.supportedBy]))].filter((id) => !evidence[id]);
  if (unknown.length > 0) out.push(`the evidence its claims name is not banked beside them: ${unknown.slice(0, 3).join(", ")}`);
  // THE BANKED ROW'S OWN DEMAND FACTS stand in for live search rows, so a re-read never refuses vocabulary the original packet legitimately granted (the demand-gated banned-term exception included).
  const bankedVocab = facts.filter((f) => f.id.startsWith("demand-")).map((f) => (/"([^"]+)"/.exec(f.fact)?.[1] ?? "")).filter(Boolean);
  const packet: SourcePacket = { targetUrl: p.pageUrl ?? p.pagePath ?? "", title: held?.title ?? null, h1: held?.h1 ?? null, metaDescription: held?.metaDescription ?? null,
    bodyText: facts.map((f) => f.fact).join(" "), headings: [...(held?.outline ?? [])], evidence, trackedQuestion: p.primaryQuery, ownedPaths: [], bannedTerms,
    demand: { preserve, vocabulary: bankedVocab } };
  // A BANKED TITLE OR HEADING IS RE-READ AGAINST WHAT THE PAGE EARNS TODAY, exactly as a fresh draft is: the girl-names rewrite that dropped "List" was banked under a generation with no earning gate and stayed visible for exactly that reason. Same rule, same words-as-spelled comparison, run on the banked strings.
  if (preserve.length > 0 && (field === "title" || field === "h1") && held != null) {
    const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const earning = new Set(preserve.flatMap(wordsOf)), after = new Set(wordsOf(c.after)); const line = field === "title" ? held.title : held.h1;
    const dropped = [...new Set(wordsOf(line ?? ""))].filter((t) => earning.has(t) && !after.has(t));
    if (dropped.length > 0) out.push(`it drops ${dropped.slice(0, 3).map((t) => `"${t}"`).join(", ")}, which this page earns clicks on today`);
  }
  out.push(...rereadableRefusals(c.after, packet));
  // WORD CONTAINMENT WAS DELETED FROM THE EDITOR AND SURVIVED HERE (Codex, 2026-08-23), so a rule no fresh draft is held to went on destroying banked work: the second finished /funny-farsi-phrases answer was retired over the ordinary word "evidence". What it was protecting is kept in the only form that survives a paraphrase: a claim whose cited evidence is ABOUT SOMETHING ELSE ENTIRELY. Support that was reworded still passes; support that was swapped for a different reading does not, and no banked row can argue from something nobody banked.
  const inventedNames = unheldNames(`${facts.map((f) => f.fact).join(" ")} ${claims.map((x) => x.text).join(" ")} ${(held?.outline ?? []).join(" ")} ${held?.title ?? ""}`, c.after);
  if (inventedNames.length > 0) out.push(`its copy names ${inventedNames.slice(0, 3).map((t) => `"${t}"`).join(", ")}, and nothing on file about this page mentions them`);
  const adrift = claims.filter((x) => { const mine = topicTokens(x.text).filter((w) => !CARRIER.has(w)), its = new Set(topicTokens(x.supportedBy.map((id) => evidence[id] ?? "").join(" ")));
    return mine.length >= 4 && mine.filter((w) => its.has(w)).length / mine.length < 0.25; });
  if (adrift.length > 0) out.push(`the evidence "${adrift[0]!.text.slice(0, 60)}" names is about something else entirely, so this copy argues from support nobody banked`);
  // A LINK IS ONE SENTENCE, filed under `section` for the store's sake. Its id still says what it is, and re-reading it against section's forty word floor would withdraw every finished link sentence on the sweep.
  const band = p.id.endsWith("::internal_link") ? "internal_link" as const : field; const [lo, hi, unit] = BAND[band], n = unit === "c" ? c.after.trim().length : words(c.after);
  if (n < lo || n > hi || UNSAFE.test(c.after)) out.push(`its copy is ${n} long, outside the ${lo} to ${hi} this field takes, or carries something nobody can paste`);
  if (band !== "internal_link" && (field === "answer_block" || field === "section") && SELF_POINTER.test(c.after)) out.push("it points at the page instead of answering");
  if (withoutCta(c.after, band) == null) out.push("its closing line asks the reader to read the page and too little is left without it");
  const line: Record<string, string | null | undefined> = { title: held?.title, h1: held?.h1, meta: held?.metaDescription }; // AND THE LINE IT REPLACES IS STILL THE LINE THE PAGE CARRIES, asked only of a page this pass is actually holding: a page I could not read is not a page that changed.
  if (held && field in line && c.before != null && (line[field] == null || flat(c.before) !== flat(line[field]!))) out.push("the line it says it replaces is not the one this page carries");
  return [...new Set(out)];
}

/** WHY A STORED CHANGE MAY NOT BE SERVED AGAIN AS IT STANDS, or empty. Stored work is REUSED without being redrafted, so every gate added after it was written simply never ran on it: a bundle's pieces that narrowed a page off its own subject sat in a live queue through three passes, and a banked description kept a figure that had walked away from the qualifier its own sentence carried. This is the ONE re-read, for both shapes. It runs ONLY the gates that need no model and no fresh evidence, so a re-read can never invent a failure the producer would not have made, and it is $0 by construction. What it cannot hold it SKIPS rather than fails, for an ordinary re-validation pass: a page whose words are not in hand, and a row that banked no provenance, are withheld from this question, never destroyed by it. `strict` is the ONE door that may not skip: the promotion door asks the operator's yes to stand for the exact row it is confirming, so there absence of provenance and a body the door does not hold each become the refusal instead, never a silent pass. Whether the change still treats its own diagnosed cause is asked once, by the caller, on every row on its way to the store. PURE. */
export function staleCopyReasons(p: ChangeProposal, bodies: ReadonlyMap<string, OwnedPageBody>, bannedTerms: readonly string[], page?: HeldPage | null, strict = false,
  /** THE WORDS THIS PAGE IS PAID FOR TODAY, from the caller's own live search rows. Banked titles and headings are re-read against them, so a rewrite that drops an earning word cannot outlive the generation whose gate it predates. Absent = the caller holds no rows, and the check is skipped rather than guessed. */
  preserve: readonly string[] = []): string[] {
  const parts = p.bundle?.components ?? [];
  if (parts.length === 0) return strict && (!p.claims?.length || !p.supportFacts?.length) ? ["this copy carries no record of what it stands on, so it is held rather than promoted"] : bankedCopyReasons(p, bannedTerms, page ?? null, preserve);
  const held = [...bodies.values()], owned = held.map((b) => pathOf(b.url)), out: string[] = [];
  const bodyFor = (page: string): OwnedPageBody | null => held.find((b) => pathOf(b.url).toLowerCase() === page.toLowerCase() || canonicalUrlKey(b.url) === canonicalUrlKey(page)) ?? null;
  for (const c of parts) {
    const field = FIELD_OF_KIND[c.kind]; if (!field) continue;
    const page = (c.page ?? p.pagePath ?? "").trim(); const body = page ? bodyFor(page) : null; if (!body) { if (strict) out.push(`${page}: the words this change lands on are not in hand, so it is held for the next pass to re-read`); continue; }
    const packet = packetForBody(body, p.primaryQuery, p.evidence.hints, owned, bannedTerms);
    for (const why of rereadableRefusals(c.after, packet)) out.push(`${page}: ${why}`);
    // A PIECE THAT MAKES ITS PAGE LESS DISTINCT among the pages this very change names: the words its own line carried that no sibling carries are why that address exists, and a stored rewrite that dropped one is the defect this bundle shipped. Only asked where the change really spans several pages of this account.
    const siblingPages = [...new Set(parts.map((x) => x.page).filter((x): x is string => !!x && x !== page))];
    if (siblingPages.length === 0 || c.before == null) continue;
    const siblings = new Set(siblingPages.flatMap((sp) => { const b = bodyFor(sp);
      return b ? topicTokens([b.title ?? "", b.h1 ?? "", ...b.headings.slice(0, 40)].join(" ")) : []; }));
    const lost = topicTokens(c.before).filter((w) => !siblings.has(w) && !topicTokens(c.after).includes(w));
    if (lost.length > 0) out.push(`${page}: it drops "${lost[0]}", which none of the other pages in this change cover`);
  }
  return [...new Set(out)];
}
