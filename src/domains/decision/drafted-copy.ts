import "server-only";

/** decision/drafted-copy: THE WORDS, ON THE CARD. The $0 producers prove a page has no description and prove a page is a stub, and both hand the operator an instruction instead of work: "write a description of about 150 characters". That is the job, restated. This runs AFTER them and never inside one, so a budget block, a refusal or a cold cache changes nothing about which cards exist or which families were swept. Two halves:   1. A MISSING OR TEMPLATED DESCRIPTION gets a paste-ready line and a page AI answers never credit gets a      paste-ready ANSWER, both through the EXISTING structured drafter, grounded on that page's OWN STORED BODY under named ids (one bounded read for the pass), budgeted and cached by the one gateway, and read      back by the editor contract below, at most MAX_DRAFTS a pass. Anything short leaves the producer's card.   2. A THIN PAGE gets an OUTLINE, deterministically, out of headings at least two read winners share, named as theirs. No model, no invention; no winners on file leaves the card as the producer wrote it. */

import { log } from "@/lib/logger";
import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { demandUnitsOf } from "@/domains/evidence/demand-units";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { callStructuredLLM, draftAtomicEditStructured, type CompleteFn } from "./llm/structured-drafter";
import type { AtomicEditDraft } from "./llm/schemas";
import { validateProposal } from "./validate-proposal";
import type { ChangeProposal } from "./contracts";

/** How many drafted blocks one pass buys, descriptions and answers together; past it, the honest note. */
const MAX_DRAFTS = 5;
const META_MIN = 110, META_MAX = 165; // what Google shows of a description before it cuts, and the floor under a line worth pasting
const ANSWER_MIN = 40, ANSWER_MAX = 90; // the drafter's own brief in words; a block outside it ignored the brief and is refused, never trimmed
/** Headings this many read winners share before they are worth naming, and how many are named. */
const AGREEING_WINNERS = 2, MAX_HEADINGS = 5;
const MAX_HEADING_WORDS = 8; // a heading past this is a wrapped paragraph, and site furniture is not a subject
const FURNITURE = /^(home|menu|search|contact|about|share|follow|newsletter|comments?|related|categories|tags|advertisement|subscribe|navigation|footer|privacy|terms)\b/i;
const UNSAFE = /[–—]|\[|\]|\{|\}/; // nothing an operator can paste: a dash Beacon never writes, a bracket somebody forgot to fill in

/** The marker the ranking reads to hold a card behind finished work; "is still owed, and this card is what is owed" is the stable phrase and may not change wording. */
const owedNote = (what: string): string => `The exact ${what} lands on the next pass; it is still owed, and this card is what is owed. No action needed from you until it does.`;

const pathOf = (url: string): string => { try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** `judge` is the semantic reader of a finished edit. ABSENT MEANS NOTHING IS ACCEPTED, so a pass with no judge wired writes no copy and buys nothing, and wiring one is a deliberate act rather than a default. */
type DraftedCopyOptions = { tenantId: string; snapshot: EvidenceSnapshot; now: Date; complete?: CompleteFn; bypassCache?: boolean; judge?: JudgeFn;
  /** The account's banned vocabulary, read once per pass by the caller so this file does no I/O of its own. */
  bannedTerms?: readonly string[];
  /** The pass's shared attempt budget. Absent = this file owns one of its own for this run. */
  attempts?: { left: number } };

const slugOf = (p: ChangeProposal): string => p.id.split("::").at(-1) ?? ""; // the producer's own slug, off the id it minted

/** The page this card lands on, by either key. */
function pageFor(snapshot: EvidenceSnapshot, card: ChangeProposal): OwnedPageEvidence | null {
  const url = (card.pageUrl ?? "").trim(), path = (card.pagePath ?? "").trim().toLowerCase();
  return snapshot.ownedPages.find((p) => (url && canonicalUrlKey(p.url) === canonicalUrlKey(url)) || pathOf(p.url).toLowerCase() === path) ?? null;
}

// ── THE EDITOR CONTRACT ───────────────────────────────────────────────────────
/** WHETHER COPY IS FINISHED IS NOT A QUESTION ABOUT ITS SPELLING. Two word lists used to answer it: a verb list  called a sentence an instruction, and a vocabulary list called a word invented because the page had not  already printed it. The second refused the one thing an editor is for, a faithful paraphrase. So the editor hands back its HOMEWORK and two gates read it. The deterministic half checks only what code can know: fields  present, no placeholder, every id resolves, the text it replaces and the place it lands are really on the  stored page, the heading is not the tracked question said back, the copy is the length its field takes. Sense is the JUDGE's, and NO JUDGE MEANS NO DELIVERABLE. Dashes, ungrounded figures and destructive replacements stay where they live (validate-proposal, llm/numeric-fidelity): house rules for any copy. */
type EditorDeliverable = {
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
  /** THE SEARCHERS' OWN WORDS FOR THIS PAGE. `preserve`: queries the page EARNS clicks on today, whose concepts
   *  no rewrite may drop without a stated reason. `vocabulary`: every member phrasing of the page's demand
   *  units, which the drafter may lead with (each also rides the evidence map as a demand-N id, so a claim can
   *  cite it and the grounding gate resolves searched words the page's own copy never printed). This is the
   *  input that was missing when a shoes page was described by its SKU names instead of what people search. */
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
const ENUMERATED = /\b([a-z][a-z' -]{2,40}(?:,\s*[a-z][a-z' -]{2,40}){1,5},?\s+(?:and|or)\s+[a-z][a-z' -]{2,40})\b/gi;
const OFFERED = /\b(?:by|such as|including)\s+([a-z][a-z' -]{2,40})/gi;
const MEMBER_WORDS = 4; // past this a comma joins clauses rather than listing members
/** CRAWLER MARKERS ARE NOT PAGE COPY. The capture brackets every body with these, and an anchor cut from them ("top of pagePopular Persian...") names a string no operator can find on the rendered page. */
const CHROME = /\b(?:top|bottom) of page/gi;
/** The same marker, NON-global: a /g regex carries `lastIndex` between calls, so testing with the one used for replacing alternates true and false. */
const CHROME_AT = /\b(?:top|bottom) of page/i;
const ANCHOR_MAX = 160; // a place on the page, not a paragraph: a 300 character blob is not an anchor
const BODY_TO_JUDGE = 24_000; // how much of a stored page fits in one judging call beside the rest of the prompt
/** EVERY CHARGED CALL ONE PASS MAY MAKE, drafts and judgings together, failures counted the same as successes.  The old cap counted only the drafts that WORKED, so a pass whose every draft was refused simply bought another one, for ever: 364 charged calls produced seven visible changes, about fifty two calls each. */
export const MAX_PAID_CALLS = 30;
const PLACEHOLDER = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b/;
/** MARKUP IS NOT WORDS. A drafted title read "Colors &amp; History": pasted, a reader sees the entity, not the ampersand. */
const ENTITY = /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/;
/** THE WORDS THAT MAKE A FIGURE MEAN SOMETHING NARROWER THAN THE BARE NUMBER. A description shipped "ships in 7-21  business days" off a sentence that said INTERNATIONAL delivery takes 7-21 days while the same page promises 2-6 days inside the country: every digit was lifted from the page and the sentence was still false. */
const QUALIFIER = /\b(international(?:ly)?|excluding|from|up to|per|depending)\b/i;
/** A SITE NAMED IN THIS CARD'S EVIDENCE. A rival the answers cite is WHY the card exists and is never copy for the operator's page. */
const HOSTISH = /\b([a-z][a-z0-9-]{3,})\.(?:com|org|net|io|co|edu|info)\b/gi;
const flat = (s: string): string => s.toLowerCase().replace(/[\s\u00a0]+/g, " ").replace(/[\u201c\u201d]/g, '"').replace(/[\u2019]/g, "'").trim();
const blankish = (s: string | null | undefined): boolean => !s || s.trim().length === 0 || PLACEHOLDER.test(s);
const urlKey = (u: string): string => flat(u).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");

/** THE LIVE JUDGE, through the ONE gateway: registered prompt, content-hash cache ($0 on a repeat), fail-closed  budget, strict schema, single retry, then refusal. gpt-5-mini spends reasoning tokens before it answers, so  the timeout is the memory's floor and not the drafter's default. Any transport or schema failure is null, which is a refusal: nothing about a judge that could not read the copy says the copy is good. */
const JUDGE_SYSTEM = 'You are a senior SEO and AEO editor reviewing ONE finished edit before it is handed to a paying customer. You are given the edit and the exact stored evidence it names. Return ONLY a JSON object with seven booleans and "notes" (one sentence naming what decided it): '
  + '"pageFit" (does this belong on THIS page), "claimsEntailed" (check EVERY material claim against the quoted evidence one at a time: the evidence must carry it, with no fact added that the evidence does not show. ANY claim about what the page itself contains, lists or shows must be verifiable in the stored page excerpt below; a page that merely mentions a subject does not list it. When in doubt on any claim, answer false), "usefulAndNatural" (does it read as a person wrote it and tell a reader something), "placementCorrect" (does it belong exactly where it says it lands), '
  + '"implementableNow" (could an operator paste this today with no further decisions), "improvesPage" (does it improve the page rather than repeat the search back, and does an answer answer rather than point at its own page), "wouldHandToCustomer" (would you personally hand this to a customer). Judge only what you are given. When in doubt on any field, answer false.';
const liveJudge = (tenantId: string, now: Date): JudgeFn => async (d, p) => {
  const user = [`Page: ${p.targetUrl}`, `Its title: ${p.title ?? "(none)"}`, `Its heading: ${p.h1 ?? "(none)"}`, `The search or question behind this: ${p.trackedQuestion ?? "(none)"}`,
    `Edit type: ${d.actionType}`, `It lands at: ${d.placementAnchor}`, d.naturalHeading ? `Under the heading: ${d.naturalHeading}` : "", d.beforeText ? `It replaces: ${d.beforeText}` : "It replaces nothing.",
    `THE COPY: ${d.finalCopy}`, "Its claims and the evidence each one names:", ...d.claims.map((c) => `- "${c.text}" <- ${c.supportedBy.join(", ")}`),
    // THE WHOLE STORED PAGE, NOT A SLICE OF IT. The judge was asked whether the copy is true of the page while being shown six passages of it, so "the page does not list that" was a question it could not answer. It now reads everything held, bounded ONLY by the 24,000 characters that fit the call beside the rest of the prompt; a page longer than that is truncated and the judge is told so rather than left to assume it saw all.
    "The stored evidence, by id:", ...Object.entries(p.evidence).map(([id, t]) => `${id}: ${t.slice(0, 4000)}`),
    p.bodyText.length > BODY_TO_JUDGE ? `The page's own words (first ${BODY_TO_JUDGE} characters of ${p.bodyText.length}; anything past this you have NOT seen, so do not conclude the page lacks something on this alone): ${p.bodyText.slice(0, BODY_TO_JUDGE)}`
      : `The page's own words, whole: ${p.bodyText}`, "", "Return the JSON now."].filter(Boolean).join("\n");
  const r = await callStructuredLLM({ kind: "editor_judgement", tenantId, system: JUDGE_SYSTEM, user, grounded: user, projectedCostUsd: 0.01, maxTokens: 2000, timeoutMs: 95_000, now }).catch(() => null);
  return r?.status === "drafted" ? (r.value as JudgeVerdict) : null;
};

/** THE GATES THAT NEED NO MODEL AND NO FRESH EVIDENCE, so they can be re-read against a STORED piece as well as  a fresh one: markup where a word belongs, a figure that dropped the qualifier its own sentence carried, a  range that is really two neighbours, a rival's name this page never mentions, and the account's own banned words. Split out because a bundle is SERVED FROM REUSE without redrafting, so a piece written before a gate existed outlived the gate that would have refused it. PURE. */
function rereadableRefusals(copy: string, p: SourcePacket, heading: string | null = null): string[] {
  const out: string[] = [];
  if (ENTITY.test(copy) || ENTITY.test(heading ?? "")) out.push("it carries a raw HTML entity, so what gets pasted is not what a reader sees");
  // A FIGURE CARRIES ITS SUBJECT OR IT IS A DIFFERENT FACT: every digit run is traced back to the stored sentence it came out of, and a qualifier that sentence carries and the copy drops changes what the number is ABOUT. DASHES ARE NOT IDENTITY. The house rule rewrites an en dash, so copy saying "7-21" never matched a body saying "7\u201321" and the whole check silently skipped the one sentence that would have refused it: the shipping line went out claiming 7-21 days off a sentence reading "International ... depending on location".
  const figure = (t: string): string => t.replace(/[\u2013\u2014]/g, "-").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
  // A RANGE SPELLED OUT IS THE SAME FACT AS A RANGE WITH A DASH IN IT: "from 550 to 330 BCE" narrows nothing, and reading its "from" as a qualifier refused every line naming the years its own page is about. Normalized to the form the copy would write, BEFORE the sentence is asked what it qualifies.
  const said = p.bodyText.replace(/\bfrom\s+([\d,.]+)\s+to\s+([\d,.]+)/gi, "$1-$2").split(/(?<=[.!?])\s+|\n+/).map((t) => figure(t).trim()).filter(Boolean);
  for (const n of new Set(figure(copy).match(/\d[\d,.-]*\d|\d+/g) ?? [])) {
    const q = QUALIFIER.exec(said.find((s) => s.includes(n)) ?? "");
    if (q && !new RegExp(`\\b${q[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(copy)) {
      out.push(`the figure's own sentence says ${q[1]!.toLowerCase()}, and the copy drops it`); break; } }
  // A RANGE IS A SPAN, NOT TWO NEIGHBOURS: "Afsaneh to Anoushka" sold a list of 194 names as a range whose two ends sit beside each other in the page's own list.
  const span = /\b([A-Z][a-z]+)\s+to\s+([A-Z][a-z]+)\b/.exec(copy);
  if (span) { const list = p.headings.map((h) => flat(h)), a = list.indexOf(flat(span[1]!)), b = list.indexOf(flat(span[2]!));
    if (a >= 0 && b >= 0 && Math.abs(b - a) < Math.max(2, Math.floor(list.length / 2)))
      out.push(`it sells "${span[1]} to ${span[2]}" as a range, and this page's own list puts them ${Math.abs(b - a)} apart`); }
  // A RIVAL'S NAME IS NOT COPY FOR THIS PAGE: naming the site the answers already cite hands that engine one more mention, on the operator's own page, in the operator's own words.
  const bare = (t: string): string => flat(t).replace(/[^a-z0-9]/g, "");
  const mine = bare(`${p.bodyText} ${p.title ?? ""} ${p.h1 ?? ""} ${p.headings.join(" ")}`), flatCopy = bare(copy);
  const rival = [...new Set(Object.values(p.evidence).flatMap((t) => [...t.matchAll(HOSTISH)].map((m) => m[1]!.toLowerCase().replace(/-/g, ""))))]
    .find((r) => flatCopy.includes(r) && !mine.includes(r));
  if (rival) out.push(`it names ${rival}, which this page's own words never mention, so the copy points a reader at somebody else's site`);
  // A BANNED WORD THE SEARCHERS THEMSELVES USE IS DIFFERENT SPEECH (operator ruling, 2026-08-16): "Persian,
  // never Farsi" holds for Beacon's own voice, but when a real search for this page carries the word, using it
  // beside the preferred term is meeting the searcher, not breaking the rule. The exception is demand-gated
  // and generic: a term clears only when a stored search phrase for THIS page contains it.
  const banned = p.bannedTerms.filter((t) => t.trim() && new RegExp(`\\b${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${copy} ${heading ?? ""}`)
    && !p.demand.vocabulary.some((v) => new RegExp(`\\b${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(v)));
  if (banned.length > 0) out.push(`it uses words this account does not publish: ${banned.slice(0, 3).join(", ")}`);
  return out;
}

/** THE CANONICAL PAGE EVIDENCE AS ONE BAG OF WORDS: everything stored about this page plus every evidence line this card names. "The evidence carries this" is a lookup against exactly this and nothing wider. */
const corpusOf = (p: SourcePacket): string =>
  flat([p.bodyText, p.headings.join(" "), p.title ?? "", p.h1 ?? "", p.metaDescription ?? "", Object.values(p.evidence).join(" ")].join(" ")).replace(/[^a-z0-9]+/g, " ");
/** Every content word of a phrase that the canonical page evidence does not carry. Singularized and stripped of  universal words by the ONE tokenizer this codebase already uses, so a faithful paraphrase passes and an invented member does not. Substring containment on purpose: it errs toward letting real copy through. */
const unheld = (corpus: string, phrase: string): string[] => topicTokens(phrase).filter((w) => !corpus.includes(w));
/** SUPPORT ENTAILMENT, and it used to be nobody's question: does each claim stand on the evidence IT names. The coverage corpus above carries the claim text, so a sentence and the claim declaring it are one string and a hallucination authenticated itself ("These shoes are waterproof", declared word for word against a page title silent about waterproofing). A CLAIM IS NEVER PART OF ITS OWN SUPPORT: each is read against the quoted facts its own supportedBy names and nothing else, on the words the COPY actually leans on, because a claim word the copy never prints cannot make the copy false and an editor's bookkeeping ("the page subject is") is not a page claim. EXACT NORMALIZED TOKEN MEMBERSHIP, never substring: `held.includes(w)` let a claim word ride inside a longer evidence word, so a page whose evidence said "credit" was held to support copy saying "red". A WHOLE WORD, matched whole, after both sides go through the ONE tokenizer. THIS IS SPELLING AND NOTHING MORE: meaning stays the judge's. PURE, so a stored row is re-read exactly as a fresh draft is checked. */
/** THE TOKENIZER'S ONE OVER-TRIM, UNDONE, AND NOTHING ELSE. Its plural rule takes two letters off a word ending in "ses", so "showcases" comes back as "showcas" beside the singular "showcase" and one word failed to match itself; only that exact spelling is repaired here. NO SILENT E IS DROPPED and NO TRAILING PLURAL IS STRIPPED: dropping a final e made "rate" and "rat" the same token, so a page whose evidence said "rat" was read as carrying copy that says "rate" (and the reverse), and a bare trailing-s strip aliases unrelated words the same way ("does" and "doe", "news" and "new"). The plural is already handled where it belongs, by the ONE tokenizer, on both sides. */
const fold = (w: string): string => w.replace(/se$/, "s");
/** A CAPITAL LETTER RUNNING OUT OF A LOWERCASE ONE IS TWO WORDS. The capture glues a heading to the sentence under it ("Persian AccessoriesShowcase your heritage"), and matching whole words against that string calls the page's own word missing. Both sides are split the same way, so this can only ever restore a boundary a crawl removed. */
const words2 = (t: string): string[] => topicTokens(t.replace(/([a-z])([A-Z])/g, "$1 $2"));
function ungroundedClaimWords(claims: EditorDeliverable["claims"], evidence: Readonly<Record<string, string>>, copy: string): string[] {
  const inCopy = new Set(words2(copy).map(fold));
  return [...new Set(claims.flatMap((c) => { const q = flat(c.supportedBy.map((id) => evidence[id] ?? "").join(" ").replace(/([a-z])([A-Z])/g, "$1 $2")).replace(/[^a-z0-9]+/g, " ");
    const held = new Set([...q.split(" ").filter(Boolean), ...topicTokens(q)].map(fold));
    return words2(c.text).filter((w) => inCopy.has(fold(w)) && !held.has(fold(w))); }))];
}

/** WHY THIS DELIVERABLE IS NOT FINISHED, or empty. PURE, and no line here is an opinion about whether the copy is any good. */
export function deliverableFailures(d: EditorDeliverable, p: SourcePacket): string[] {
  const out: string[] = [], stored = flat([p.bodyText, p.headings.join(" "), p.title ?? "", p.h1 ?? ""].join(" ")), corpus = corpusOf(p);
  for (const [what, text] of [["copy", d.finalCopy], ["placement", d.placementAnchor], ["measurement target", d.measurementTarget]] as const) {
    if (blankish(text)) out.push(`its ${what} is blank or still carries a placeholder`); }
  if (blankish(d.targetUrl) || urlKey(d.targetUrl) !== urlKey(p.targetUrl)) out.push("it names a page this evidence is not about");
  const known = new Set(Object.keys(p.evidence)), unknown = [...new Set([...d.evidenceIdsUsed, ...d.claims.flatMap((c) => [...c.supportedBy])])].filter((id) => !known.has(id));
  if (unknown.length > 0) out.push(`it names evidence that is not on file: ${unknown.slice(0, 3).join(", ")}`);
  if (d.claims.length === 0) out.push("it makes no claim anybody could check");
  if (d.claims.some((c) => c.supportedBy.length === 0 || blankish(c.text))) out.push("one of its claims names no evidence at all");
  // THE COPY IS READ INDEPENDENTLY OF WHAT WAS DECLARED, so an assertion the writer simply did not mention is held to the same evidence as one it did. NOT A VOCABULARY TEST: asking whether every word of a sentence is printed on the page refuses the one thing an editor is for, a faithful paraphrase, and this codebase has already thrown that mechanism out once. This asks a STRUCTURAL question instead. Enumerating is naming MEMBERS, and a member either exists or it does not. The HEAD of a list is skipped on purpose: a pattern reading backwards from the first comma swallows the verb in front of it ("browse and filter Persian accessories by type"), and judging that phrase judges the sentence rather than the member. AND A LIST OF LONG MEMBERS IS NOT A LIST: "Ferdowsi, who founded an empire and wrote the epic that carried the Persian language" is a chain of clauses wearing commas, so a match with any member past MEMBER_WORDS is discarded whole rather than read as a claim about what the page holds.
  const members = (t: string): string[] => t.split(",").slice(1).flatMap((x) => x.split(/\band\b|\bor\b/)).map((x) => x.trim()).filter((x) => x.length > 2);
  const asserted = [...new Set([...[...d.finalCopy.matchAll(ENUMERATED)].map((m) => members(m[1]!)),
    ...[...d.finalCopy.matchAll(OFFERED)].map((m) => [m[1]!.trim()])]
    .filter((list) => list.length > 0 && list.every((t) => words(t) <= MEMBER_WORDS)).flat())];
  const invented = asserted.filter((t) => topicTokens(t).length > 0 && unheld(corpus, t).length > 0);
  if (invented.length > 0) out.push(`it tells a reader this page offers ${invented.slice(0, 3).map((t) => `"${t}"`).join(", ")}, and this page's own evidence shows no such thing`);
  // WHAT IS BEING REPLACED HAS TO EXIST, or the operator is told to swap words the page does not have, and the swap deletes whatever is truly there. A FIELD IS ITS OWN PLACE. A title, a heading and a description are lines the page already HAS, so what they replace is the stored FIELD and where they land IS that field, never a string inside the body copy. Checked against the body they were refused every single time: a description is not printed in a page's own words, so no real description edit could ever finish. Copy that lands in the body still owes a real anchor in it.
  const FIELD: Partial<Record<EditorDeliverable["actionType"], string | null>> = { title: p.title, h1: p.h1, meta: p.metaDescription };
  if (d.actionType in FIELD) {
    if (d.beforeText != null && flat(d.beforeText) !== flat(FIELD[d.actionType] ?? "\u0000")) out.push("the line it says it replaces is not the one this page carries");
    // NO TITLE OR HEADING DROPS A WORD THE PAGE EARNS CLICKS ON. A rewrite proposed "Shiraz Population" for a
    // city page and stripped "Persian", "Boy" and "List" from a title earning 43 clicks: a word that appears
    // both in the current line and in a search the page is PAID for is load-bearing, and only an explicit,
    // evidenced reason may remove it. "List" is not filler when readers search for lists.
    if (d.actionType === "title" || d.actionType === "h1") {
      // PLAIN WORDS, NEVER TOPIC TOKENS. The destruction class lives exactly in the words a relevance
      // tokenizer calls generic: "list" is noise to a topic gate and load-bearing on a page whose paid
      // searches read "persian boy names list". A preserved search is compared as the searcher spelled it.
      const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const earning = new Set(p.demand.preserve.flatMap(wordsOf));
      const after = new Set(wordsOf(d.finalCopy));
      const dropped = [...new Set(wordsOf(FIELD[d.actionType] ?? ""))].filter((t) => earning.has(t) && !after.has(t));
      if (dropped.length > 0) out.push(`it drops ${dropped.slice(0, 3).map((t) => `"${t}"`).join(", ")}, which this page earns clicks on, and names no supported reason to`);
    }
  } else {
    if (d.beforeText != null && !stored.includes(flat(d.beforeText))) out.push("the words it says it replaces are not on the stored page");
    if (!blankish(d.placementAnchor) && !stored.includes(flat(d.placementAnchor))) out.push("the place it says it lands is not on the stored page"); }
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
  // A LINK IS CHECKED AS A LINK: the destination has to be a page this account actually owns, and the words on it have to be in the sentence being pasted. AN ANSWER MAY NOT BE ABOUT THE PAGE. Only for copy that lands in the body; a description IS about the page.
  if ((d.actionType === "answer_block" || d.actionType === "section") && SELF_POINTER.test(d.finalCopy)) {
    out.push("it points at the page instead of answering"); }
  out.push(...rereadableRefusals(d.finalCopy, p, d.naturalHeading));
  if (d.placementAnchor.trim().length > ANCHOR_MAX) out.push("where it goes is a paragraph rather than a place on the page");
  if (CHROME_AT.test(d.placementAnchor)) out.push("where it goes is taken from the crawl's own markers, not from the page");
  if (d.actionType === "internal_link") {
    if (!d.linkTo || !p.ownedPaths.some((x) => x.toLowerCase() === d.linkTo!.toLowerCase())) out.push("the page it links to is not one this account owns");
    if (blankish(d.anchorText) || !flat(d.finalCopy).includes(flat(d.anchorText!))) out.push("the words it puts on the link are not in the sentence it hands over"); }
  if (!(d.implementationMinutes > 0)) out.push("it does not say how long it takes");
  // TWO QUESTIONS, TWO CORPORA, AND NEITHER IS ANSWERED BY THE WRITER'S OWN SAY SO. CLAIM COVERAGE asks whether every material assertion in the copy maps to a persisted claim. The page's own words are wide: "modern designs" cleared the corpus above because one stored sentence says "timeless designs" and another says "modern fashion", and it shipped on a live card whose four claims carried no such thing. TWO STRICTNESSES inside that one question, because a MEMBER of a list is a specific thing the copy says this page holds, so a CLAIM the writer declared has to carry it, while ordinary prose is read against those claims PLUS the exact stored words each one names: a faithful paraphrase of cited evidence passes, and a sentence about something no claim ever cited does not, list shape or no list shape.
  const declared = flat(d.claims.map((c) => c.text).join(" ")).replace(/[^a-z0-9]+/g, " ");
  const graph = `${declared} ${flat([...new Set(d.claims.flatMap((c) => [...c.supportedBy]))].map((id) => p.evidence[id] ?? "").join(" ")).replace(/[^a-z0-9]+/g, " ")}`;
  const undeclared = asserted.filter((t) => topicTokens(t).length > 0 && unheld(declared, t).length > 0);
  if (undeclared.length > 0) out.push(`it tells a reader this page offers ${undeclared.slice(0, 3).map((t) => `"${t}"`).join(", ")}, and no claim on this card carries it`);
  const uncovered = unheld(graph, d.finalCopy);
  if (uncovered.length > 0) out.push(`its copy says ${uncovered.slice(0, 3).map((t) => `"${t}"`).join(", ")}, which no claim it makes and no evidence those claims name carries`);
  const ungrounded = ungroundedClaimWords(d.claims, p.evidence, d.finalCopy);
  if (ungrounded.length > 0) out.push(`its copy says ${ungrounded.slice(0, 3).map((t) => `"${t}"`).join(", ")} on a claim of its own, and the evidence that claim names does not carry it`);
  return [...new Set(out)];
}

/** A CLOSING SENTENCE THAT ASKS THE READER TO READ THE PAGE IS FILLER WHERE A FACT BELONGS: the description  equivalent of "click here". DETERMINISTIC and about the SHAPE of an imperative, never a vocabulary: the final  sentence, opening on an instruction to read, view, browse, visit or shop. Trimmed where what is left still fills  the field, and otherwise sent back for ONE redraft that is told not to write one. PURE. */
const CTA_TAIL = /^(?:read|click|see|view|browse|visit|explore|discover|shop|learn|find|check)\b/i;
const NO_CTA = "Write no closing call to action. Never end with an instruction to read, view, browse, visit or shop this page: the last sentence has to carry a fact about the page.";
export function withoutCta(copy: string, type: EditorDeliverable["actionType"]): string | null {
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
  return ([["pageFit", "it does not belong on this page"], ["claimsEntailed", "the evidence it names does not carry every claim it makes"],
    ["usefulAndNatural", "it is not useful or does not read naturally"], ["placementCorrect", "it lands in the wrong place"],
    ["implementableNow", "an operator could not act on it as written"], ["improvesPage", "it repeats the search instead of improving the page"],
    ["wouldHandToCustomer", "no serious editor would hand this to a customer"]] as const).filter(([k]) => v[k] !== true).map(([, why]) => why);
}

/** THE STORED FACTS THIS PAGE'S EDIT IS CHECKED AGAINST, each under an id the drafter is handed and the  deliverable must name back. Nothing here is fetched: it is the snapshot's own capture and this card's own evidence, so "the evidence supports this" is a lookup rather than a belief. */
function packetFor(card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null, owned: readonly OwnedPageEvidence[], bannedTerms: readonly string[]): SourcePacket {
  const evidence: Record<string, string> = {};
  card.evidence.hints.forEach((h, i) => { evidence[`card-${i + 1}`] = h; });
  if (page.content?.title) evidence["page-title"] = page.content.title; if (page.content?.h1) evidence["page-h1"] = page.content.h1;
  (page.content?.outline ?? []).slice(0, 8).forEach((h, i) => { evidence[`page-heading-${i + 1}`] = h; });
  (body?.passages ?? []).slice(0, 6).forEach((t, i) => { evidence[`page-copy-${i + 1}`] = t; });
  // THE PAGE'S OWN DEMAND, off its stored search rows: what it earns (never to be dropped) and how searchers
  // actually phrase it (legal vocabulary, each entry a citable demand-N fact carrying its own numbers).
  const rows = page.search?.topQueries ?? [];
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
type EditorWiring = { tenantId: string; now: Date; complete?: CompleteFn; bypassCache?: boolean; judge?: JudgeFn;
  /** THE PASS'S OWN HARD ATTEMPT BUDGET, shared by every editor run in it and decremented BEFORE each charged call, so a refusal costs exactly what it cost. Absent means one editor run standing on its own. */
  attempts?: { left: number } };
/** The fields this editor writes: a line the page already has, or the copy an opening owes. */
type EditorField = "title" | "h1" | "meta" | "answer_block" | "internal_link";

/** THE EDITOR OVER ONE PACKET: the drafter writes the field against that page's own stored words, the deterministic half of the contract reads its homework against the same packet, and the judge reads it for sense. Null is a refusal, never a draft, and every refusal names itself through `refuse`. */
async function runEditor(packet: SourcePacket, field: EditorField, pageLabel: string, hints: string[],
  minutes: number, opts: EditorWiring, refuse: (why: string, extra?: Record<string, unknown>) => null, redrafted = false,
  /** A LINK RUN CARRIES ITS OWN TWO FACTS: the owned page the sentence lands a link on, and the words that become the link. Both are the caller's, read off the card, never the model's. */
  link: { to: string; anchor: string } | null = null): Promise<EditorDeliverable | null> {
  // THE LINE THE MODEL IS SHOWN IS THE LINE THE GATE CHECKS. The drafter used to be handed the CARD's stored `before` while the gate compared against the freshly loaded page, so any crawl newer than the card (a re-punctuated dash was enough) made the model echo one string and the gate demand another, and every field edit was refused for disagreeing with itself.
  const held = field === "meta" ? packet.metaDescription : field === "title" ? packet.title : field === "h1" ? packet.h1 : null;
  // THE MONEY IS SPENT HERE, SO THE BUDGET IS READ HERE. Counted down before the call and never after it, so a call that fails, refuses or throws has still been paid for and still counts against what this pass may spend.
  if (opts.attempts && (opts.attempts.left -= 1) < 0) return refuse("this pass has spent its whole attempt budget");
  const drafted = await draftAtomicEditStructured({
    query: packet.trackedQuestion ?? "", pageLabel, field: field === "internal_link" ? "answer_block" : field, currentValue: held,
    // THE SEARCHERS' WORDS RIDE THE BRIEF. The drafter used to receive one query string and the page's own
    // outline, so it optimised for what the page already says (a shoes page described by its SKU names) and
    // never for what people search. Demand is handed over explicitly, and the earning words are marked as
    // load-bearing, so the model leads with the phrasing that has an audience and drops nothing that pays.
    outline: [...packet.headings].slice(0, 8), evidenceHints: [...hints,
      ...(packet.demand.vocabulary.length > 0 ? [`People actually search this as: ${packet.demand.vocabulary.slice(0, 8).map((v) => `"${v}"`).join(", ")}. Lead with the highest-demand phrasing the evidence supports.`] : []),
      ...(packet.demand.preserve.length > 0 ? [`This page already earns clicks on: ${packet.demand.preserve.slice(0, 6).map((v) => `"${v}"`).join(", ")}. Never drop those words from a line that carries them today.`] : [])], tenantId: opts.tenantId,
  }, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache }).catch(() => null);
  // WHY THE DRAFTER SAID NO, NOT JUST THAT IT DID. The status alone ("validation_failed") named nothing that could be acted on, so diagnosing one refusal meant buying another call to see what the last one objected to.
  if (!drafted || drafted.status !== "drafted") return refuse("no draft came back", { status: drafted?.status ?? "threw",
    errors: (drafted as { errors?: string[] } | null)?.errors?.slice(0, 4) ?? null, failure: (drafted as { failure?: string } | null)?.failure ?? null });
  const v = drafted.value as AtomicEditDraft;
  const claims = v.claims.map((c) => ({ text: c.text, supportedBy: c.supportedBy }));
  const deliverable: { -readonly [K in keyof EditorDeliverable]: EditorDeliverable[K] } = {
    actionType: field, targetUrl: packet.targetUrl,
    placementAnchor: v.placementAnchor, beforeText: v.before, finalCopy: v.after.replace(/\s+/g, " ").trim(),
    naturalHeading: v.naturalHeading, claims, evidenceIdsUsed: [...new Set(claims.flatMap((c) => [...c.supportedBy]))],
    // THE ID IS RESOLVED WHERE THE EVIDENCE IS IN HAND. Afterwards nobody can: the packet is built from a snapshot and a body read that this pass holds and the next one rebuilds, so "(from page-copy-1)" on a stored row named a fact that no longer existed anywhere.
    supportFacts: [...new Set(claims.flatMap((c) => [...c.supportedBy]))].filter((id) => !!packet.evidence[id]).map((id) => ({ id, fact: packet.evidence[id]!.slice(0, 400) })),
    uncertaintyOrOmitted: v.risks, implementationMinutes: v.implementationMinutes || minutes,
    measurementTarget: v.proofPlan.metrics[0] ?? "",
    ...(field === "internal_link" && link ? { linkTo: link.to, anchorText: link.anchor } : {}),
  };
  // THE MODEL PROPOSES, CODE VERIFIES. A field edit replaces the page's OWN stored line, and a model that paraphrases or re-spaces it by a character was refused outright. A near miss is RESOLVED to the exact stored form here, so what persists is still character-exact to the page; only a `before` naming something else fails. A NEAR MISS IS PUNCTUATION, NOT DISAGREEMENT. The house rule forbids en dashes, so a model asked to echo a stored line containing one rewrites it ("550-330" for "550\u2013330") and the two strings stop matching. They are compared with dashes and their spacing normalized, and the STORED form is what gets written back.
  const norm = (t: string): string => flat(t).replace(/[\u2013\u2014]/g, "-").replace(/\s*-\s*/g, "-");
  const near = (a: string, b: string): boolean => norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
  // AN ANCHOR IS A SENTENCE A HUMAN CAN FIND. The model may hand back a whole paragraph or a run that starts in the crawl's own markers; the SHORTEST stored sentence carrying it is what an operator can actually look for, so the anchor is resolved to that and only an anchor nothing on the page carries is refused below. THE CLOSING CALL TO ACTION, BEFORE ANY GATE READS THE COPY: trimmed where the field still fills without it, and otherwise ONE redraft that is TOLD not to write one. Recursion, not a loop, so the retry pays the same attempt budget through the same door and a second failure refuses instead of buying a third.
  const trimmed = withoutCta(deliverable.finalCopy, field);
  if (trimmed == null) return redrafted ? refuse("its closing line asks the reader to read the page and too little is left without it")
    : runEditor(packet, field, pageLabel, [...hints, NO_CTA], minutes, opts, refuse, true, link);
  deliverable.finalCopy = trimmed;
  const anchor = deliverable.placementAnchor.trim();
  if (anchor) {
    // AMBIGUITY IS A REFUSAL, NEVER A GUESS: two distinct stored sentences sharing the matched prefix means the operator could land the copy in the wrong place, so nothing is rewritten and the card keeps its owed note.
    const cands = [...new Set(packet.bodyText.replace(CHROME, " ").split(/(?<=[.!?])\s+|\n+/).map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= ANCHOR_MAX && flat(t).includes(flat(anchor.slice(0, 60)))))];
    if (cands.length > 1) return refuse("where it goes matches more than one place on the page", { reasons: ["where it goes matches more than one place on the page"] });
    if (cands[0]) deliverable.placementAnchor = cands[0];
  }
  if (held && deliverable.beforeText != null && near(held, deliverable.beforeText)) deliverable.beforeText = held;
  // A JUDGING IS A CHARGED CALL LIKE ANY OTHER. It went uncounted entirely, which is how a five-draft cap turned into hundreds of calls; the deterministic half runs first inside `acceptDeliverable`, so an exhausted budget only ever costs the copy a reading it could not pay for, never a refusal the packet could have made for free.
  if (opts.attempts && !opts.judge && (opts.attempts.left -= 1) < 0) return refuse("this pass has spent its whole attempt budget");
  const refused = await acceptDeliverable(deliverable, packet, opts.judge ?? liveJudge(opts.tenantId, opts.now));
  // A REFUSAL NAMES THE TWO STRINGS IT COMPARED. "not the line this page carries" was unactionable without them.
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
type DraftKind = "description" | "answer" | "h1" | "link";
const KIND_OF_SLUG: Partial<Record<string, DraftKind>> = { missing_description: "description", ai_answer_gap: "answer",
  thin_page: "answer", duplicate_heading: "h1", internal_link: "link" };
/** The destination an internal link card names, read off the card's own instruction line and nowhere else. */
const linkDestOf = (c: ChangeProposal): string | null =>
  c.recommendedChange.kind === "existing_edit" ? (/pointing to (\S+?),/.exec(c.recommendedChange.after)?.[1] ?? null) : null;

/** ONE FINISHED EDIT for one page, or nothing: the description under its title, or the answer a page owes. The drafter is handed the page's own stored words under named ids and must hand back the whole homework; the deterministic half of the editor contract reads it against the packet, the judge reads it for sense, and the one canon validator reads the copy last. Anything short of all three leaves the producer's card. */
async function draftBlock(card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null,
  opts: DraftedCopyOptions, kind: DraftKind): Promise<{ d: EditorDeliverable; ready: boolean } | null> {
  const packet = packetFor(card, page, body, opts.snapshot.ownedPages, opts.bannedTerms ?? []), outline = (page.content?.outline ?? []).slice(0, 8);
  const refuse = (why: string, extra: Record<string, unknown> = {}): null => {
    log.info(`[drafted-copy] the ${kind} is not finished`, { tenantId: opts.tenantId, path: card.pagePath, why, ...extra });
    return null; };
  // A LINK DELIVERABLE IS ONE SENTENCE, and both its facts are the card's own: the destination off its
  // instruction line, the anchor off the search it names. Either unreadable is a refusal, never a guess.
  const dest = kind === "link" ? linkDestOf(card) : null;
  if (kind === "link" && !dest) return refuse("the destination this link names cannot be read off the card");
  // THE BRIEF'S OWN TARGET COPY IS THE STARTING POINT, NOT A PROMPT TO OUTDO. A producer that already carries an agreed spec (the exact title or opening the evidence lane settled) hands it over to be VERIFIED against the stored page and refined to fit, so the model checks work rather than replacing it with an idea of its own. A RESEARCH BRIEF IS NOT A SPEC: its `after` is an instruction about the work, and telling the model to refine an instruction ships the instruction as copy, so a brief is framed as the job and never as the words.
  const spec = card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.after.trim() : "";
  const hints = [...Object.entries(packet.evidence).map(([id, text]) => `${id}: ${text.slice(0, 400)}`),
    ...(spec ? [card.researchOnly === true
      ? `The brief for this edit: "${spec.slice(0, 600)}". Write the finished copy that fulfils it; the brief itself is never the copy.`
      : `The target the team already agreed for this edit: "${spec.slice(0, 600)}". Verify it against the stored copy above and refine it to fit that copy exactly; do not replace it with a different idea.`] : []),
    ...(kind === "link" ? [`Write ONE sentence that reads naturally in this page's body and contains the exact phrase "${card.primaryQuery}". Those words become a link to ${dest}. Say only what the evidence ids above carry.`] : []),
    "Every claim you make must name the ids above that carry it. Write only what those words already show about this page. DECLARE A CLAIM FOR EVERY ASSERTION YOUR COPY MAKES: anything the copy says that no claim of yours covers is refused."];
  const deliverable = await runEditor(packet, kind === "description" ? "meta" : kind === "h1" ? "h1" : kind === "link" ? "internal_link" : "answer_block", card.pageLabel, hints,
    card.estimatedEffortMinutes ?? 0, opts, refuse, false, kind === "link" ? { to: dest!, anchor: card.primaryQuery } : null);
  if (!deliverable) return null;
  // THE ONE CANON VALIDATOR, last and unchanged: dashes, ungrounded figures and destructive replacements are house rules about any copy Beacon ships, not opinions about this deliverable, so they stay their own gate.
  const verdict = validateProposal({ ...card, recommendedChange: { kind: "existing_edit", field: kind === "description" ? "meta" : kind === "h1" ? "h1" : "section",
    before: deliverable.beforeText, after: deliverable.finalCopy } },
  // THE PAGE'S OWN WORDS GO IN. The canon validator's entailment half was handed the card's hints and the outline and never the stored body, so it judged copy about a page against everything except that page.
  { pageBodyText: packet.bodyText, evidenceText: [...outline, ...hints, packet.title ?? ""].filter(Boolean).join(" "), now: opts.now });
  // THE PROMOTION IS THE VERDICT, NOT A HABIT. Every card these producers mint is born `needs_review`, and nothing ever moved one to `ready`: copy that had passed the drafter, the deterministic contract, the judge AND this validator still sat in the same lane as a card nobody had written, and the screen offered both of them Copy and Mark done. A deliverable that cleared all four is ready; anything else stays for a human.
  return verdict.verdict === "rejected" ? refuse(verdict.reasons[0] ?? "canon refused it")
    : { d: deliverable, ready: verdict.verdict === "ready" };
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
  // EVERY ATTEMPT COUNTS, NOT EVERY SUCCESS. `bought` counted the drafts that WORKED, so a card whose draft was refused simply left the cap where it was and the next card bought another call, and the next, without limit. The pass's shared budget is decremented inside the editor before each charged call instead, so this is only the reading of it. THE PASS OWNS THAT BUDGET: called without one this minted a SECOND pool the same size beside the one the deep bundles were already spending, so a 30 call ceiling bought 60. The fallback is for a caller standing on its own, and it says so; the one production caller hands its own budget in.
  const attempts = opts.attempts ?? { left: MAX_PAID_CALLS };
  if (!opts.attempts) log.info("[drafted-copy] no pass budget was handed in, so this run counts its own attempts", { tenantId: opts.tenantId, left: attempts.left });
  // ONE bounded body read for the pass: the stored copy of exactly the pages about to be drafted, never the site.
  const drafting = cards.filter((c) => KIND_OF_SLUG[slugOf(c)] != null)
    .map((c) => pageFor(opts.snapshot, c)?.url).filter((u): u is string => !!u).slice(0, MAX_DRAFTS);
  const bodies = drafting.length > 0 ? await loadOwnedPageBodies(opts.tenantId, drafting).catch(() => new Map<string, OwnedPageBody>()) : new Map<string, OwnedPageBody>();
  for (const card of cards) {
    const slug = slugOf(card), wants = KIND_OF_SLUG[slug] ?? null;
    const page = wants ? pageFor(opts.snapshot, card) : null;
    if (!page) { out.push(card); continue; }
    // AN UNREAD PAGE BUYS NO DRAFT. A zero-word capture is blindness, not content: its own card already names
    // the rendered read as the next step, and no body-dependent copy may stand on words nobody holds.
    if (slug === "thin_page" && (page.content?.wordCount ?? 0) === 0) { out.push(card); continue; }
    const meta = wants === "description", h1 = wants === "h1", link = wants === "link";
    if (attempts.left <= 0) log.info("[drafted-copy] paid work stopped: the pass has spent its whole attempt budget", { tenantId: opts.tenantId, path: card.pagePath, owed: wants });
    const done = attempts.left > 0 ? await draftBlock(card, page, bodies.get(canonicalUrlKey(page.url)) ?? null, opts, wants!) : null;
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
        recommendedChange: { kind: "existing_edit", field: meta ? "meta" : h1 ? "h1" : "section",
          before: drafted.beforeText, after: drafted.finalCopy,
          // WHERE IT GOES, IN THE PAGE'S OWN WORDS: the anchor the editor found in the stored copy, checked against that copy before it got here. A field edit replaces its own line and names no place.
          where: meta || h1 ? null : link
            ? `One sentence placed after "${drafted.placementAnchor}", with "${card.primaryQuery}" linked to ${dest ?? "the page it names"}`
            : `A new section headed "${drafted.naturalHeading ?? ""}", placed after "${drafted.placementAnchor}"` },
        operatorSteps: meta
          ? [`Open the site editor on ${card.pagePath}`, "Paste the description above, exactly as written",
            "Mark it done here and the click rate gets read again"]
          : h1
            ? [`Open the site editor on ${card.pagePath}`, "Replace the page heading with the copy above, exactly as written",
              "Mark it done here and the positions get read again"]
            : link
              ? [`Open the site editor on ${card.pagePath}`, `Find "${drafted.placementAnchor}" on the page`,
                "Paste the sentence above straight after it",
                `Make the words "${card.primaryQuery}" in that sentence a link to ${dest ?? "the page this card names"}`,
                "Mark it done here and the position gets read again"]
              : [`Open the site editor on ${card.pagePath}`, `Find "${drafted.placementAnchor}" on the page`,
                `Start a new section straight after it, with the heading "${drafted.naturalHeading ?? ""}"`,
                "Paste the answer above as that section's opening, exactly as written", "Mark it done here and the next answers get checked against it"],
        limitations: [...card.limitations, ...drafted.uncertaintyOrOmitted, meta
          ? "This line is written off the page's own title, headings and stored copy as last read, so check it still describes the page before you publish it."
          : h1
            ? "This heading is written off the page's own stored copy and search rows as last read, so check it still names what the page covers before you publish it."
            : link
              ? "This sentence is written off both pages' stored copy and search rows as last read, so check it reads naturally where it lands before you publish it."
              : "This answer is written off the page's own title, headings and stored copy as last read and the stored answers this card cites, so check every word of it is true of the page before you publish it."] });
      continue;
    }
    // A THIN PAGE WHOSE SECTION COULD NOT BE DRAFTED still leaves with the shape the winners agree on, so its
    // brief carries real subjects rather than only an owed note.
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
    out.push({ ...card, limitations: [...card.limitations, owedNote(meta ? "description" : h1 ? "heading" : link ? "link sentence" : "answer")] });
  }
  log.info("[drafted-copy] paid attempts left after this pass", { tenantId: opts.tenantId, left: Math.max(0, attempts.left) });
  return out;
}

/** THE FIELD a stored component replaces, where it replaces one at all. */
const FIELD_OF_KIND: Partial<Record<string, EditorField>> = { title: "title", h1: "h1", meta: "meta", opening_answer: "answer_block" };
/** The target page as the pass already holds it, never a fresh read: its four stored fields. */
type HeldPage = { title: string | null; h1: string | null; metaDescription: string | null; outline?: readonly string[] | null };

/** WHY BANKED ATOMIC COPY MAY NOT BE PRESERVED, or empty. Banking skips the drafter AND every gate, so copy accepted under an older boundary was served on for ever while the boundary moved under it: identity alone decided, and identity says nothing about whether the words still stand. The packet is rebuilt from what the ROW ITSELF banked (its claims and the exact words behind each id) plus the page as this pass holds it, and every deterministic rule is asked again on the evidence the copy actually leans on. No provider, no fresh read, and NO RE-JUDGING: the prior reading of sense stands while the material identity does. A row that banked no copy or no provenance answers empty, because there is nothing here to re-read; whether such a row may be preserved at all is preferFinished's question. */
function bankedCopyReasons(p: ChangeProposal, bannedTerms: readonly string[], held: HeldPage | null): string[] {
  const c = p.recommendedChange, claims = p.claims ?? [], facts = p.supportFacts ?? [];
  if (c.kind !== "existing_edit" || p.researchOnly === true || claims.length === 0 || facts.length === 0) return [];
  const evidence: Record<string, string> = {}; for (const f of facts) evidence[f.id] = f.fact;
  const out: string[] = [], field = c.field as EditorDeliverable["actionType"];
  const unknown = [...new Set(claims.flatMap((x) => [...x.supportedBy]))].filter((id) => !evidence[id]);
  if (unknown.length > 0) out.push(`the evidence its claims name is not banked beside them: ${unknown.slice(0, 3).join(", ")}`);
  // THE BANKED ROW'S OWN DEMAND FACTS stand in for live search rows, so a re-read never refuses vocabulary the
  // original packet legitimately granted (the demand-gated banned-term exception included).
  const bankedVocab = facts.filter((f) => f.id.startsWith("demand-")).map((f) => (/"([^"]+)"/.exec(f.fact)?.[1] ?? "")).filter(Boolean);
  const packet: SourcePacket = { targetUrl: p.pageUrl ?? p.pagePath ?? "", title: held?.title ?? null, h1: held?.h1 ?? null, metaDescription: held?.metaDescription ?? null,
    bodyText: facts.map((f) => f.fact).join(" "), headings: [...(held?.outline ?? [])], evidence, trackedQuestion: p.primaryQuery, ownedPaths: [], bannedTerms,
    demand: { preserve: [], vocabulary: bankedVocab } };
  out.push(...rereadableRefusals(c.after, packet));
  // WHAT THE COPY LEANS ON HAS TO STILL CARRY IT. Support reworded, re-pointed or dropped leaves banked words arguing from something nobody banked, and a stored claim cannot say that about itself.
  const ungrounded = ungroundedClaimWords(claims, evidence, c.after), uncovered = unheld(`${flat(claims.map((x) => x.text).join(" "))} ${flat(facts.map((f) => f.fact).join(" "))}`.replace(/[^a-z0-9]+/g, " "), c.after);
  if (ungrounded.length > 0) out.push(`its copy says ${ungrounded.slice(0, 3).map((t) => `"${t}"`).join(", ")} on a claim of its own, and the evidence that claim names does not carry it`);
  if (uncovered.length > 0) out.push(`its copy says ${uncovered.slice(0, 3).map((t) => `"${t}"`).join(", ")}, which no claim it makes and no evidence those claims name carries`);
  // A LINK IS ONE SENTENCE, filed under `section` for the store's sake. Its id still says what it is, and
  // re-reading it against section's forty word floor would withdraw every finished link sentence on the sweep.
  const band = p.id.endsWith("::internal_link") ? "internal_link" as const : field;
  const [lo, hi, unit] = BAND[band], n = unit === "c" ? c.after.trim().length : words(c.after);
  if (n < lo || n > hi || UNSAFE.test(c.after)) out.push(`its copy is ${n} long, outside the ${lo} to ${hi} this field takes, or carries something nobody can paste`);
  if (band !== "internal_link" && (field === "answer_block" || field === "section") && SELF_POINTER.test(c.after)) out.push("it points at the page instead of answering");
  if (withoutCta(c.after, band) == null) out.push("its closing line asks the reader to read the page and too little is left without it");
  // AND THE LINE IT REPLACES IS STILL THE LINE THE PAGE CARRIES, asked only of a page this pass is actually holding: a page I could not read is not a page that changed.
  const line: Record<string, string | null | undefined> = { title: held?.title, h1: held?.h1, meta: held?.metaDescription };
  if (held && field in line && c.before != null && flat(c.before) !== flat(line[field] ?? " ")) out.push("the line it says it replaces is not the one this page carries");
  return [...new Set(out)];
}

/** WHY A STORED CHANGE MAY NOT BE SERVED AGAIN AS IT STANDS, or empty. Stored work is REUSED without being redrafted, so every gate added after it was written simply never ran on it: a bundle's pieces that narrowed a page off its own subject sat in a live queue through three passes, and a banked description kept a figure that had walked away from the qualifier its own sentence carried. This is the ONE re-read, for both shapes. It runs ONLY the gates that need no model and no fresh evidence, so a re-read can never invent a failure the producer would not have made, and it is $0 by construction. What it cannot hold it SKIPS rather than fails, for an ordinary re-validation pass: a page whose words are not in hand, and a row that banked no provenance, are withheld from this question, never destroyed by it. `strict` is the ONE door that may not skip: the promotion door asks the operator's yes to stand for the exact row it is confirming, so there absence of provenance and a body the door does not hold each become the refusal instead, never a silent pass. Whether the change still treats its own diagnosed cause is asked once, by the caller, on every row on its way to the store. PURE. */
export function staleCopyReasons(p: ChangeProposal, bodies: ReadonlyMap<string, OwnedPageBody>, bannedTerms: readonly string[], page?: HeldPage | null, strict = false): string[] {
  const parts = p.bundle?.components ?? [];
  if (parts.length === 0) return strict && (!p.claims?.length || !p.supportFacts?.length) ? ["this copy carries no record of what it stands on, so it is held rather than promoted"] : bankedCopyReasons(p, bannedTerms, page ?? null);
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
