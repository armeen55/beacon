/** decision/completeness: THE ONE CHECK THAT ASKS WHETHER BEACON HAS FINISHED THE WORK. A customer-facing Change states exactly what to add, replace, delete, move, link, redirect or create, exactly where, and the FINAL COPY wherever copy is involved. IMPERFECT WORK STAYS VISIBLE (operator, 2026-08-15): anything short of that is a genuine opportunity still being developed, and it is RANKED and SHOWN, on the ranked queue and on Today, as a research card carrying what is known, what is still missing and what happens next. What this boundary decides is never whether the operator sees a row, only which of the three lanes it lands in, that it carries no copy to paste and no control that records it done, and that the server refuses to put it into measurement or mark it implemented until the deliverable is actually finished. PURE and derived from the deliverable ITSELF, never from the prose around it, so the queue, the card (a client component) and the server mutation all ask one question and a voice edit moves none of them. It sits beside the contract rather than inside the validator because a client bundle may reach this and may not reach that. */

import { componentIdOf, dangerousComponents } from "./contracts";
import { copyKey } from "./proof";
import type { ChangeProposal } from "./contracts";
import { evidenceShortfall } from "./proof";

/** NO VERB LIST LIVES HERE ANY MORE. Whether copy is the finished words or a note about producing them is a question about meaning, and it was answered by spelling: a production verb near a deliverable noun. It is now answered where it is known. A PRODUCER handing over a brief says so in a typed field (`researchOnly`) as it mints the card. THE EDITOR's copy is read by decision/drafted-copy's editor contract, against the stored page and then by a judge. Only what stays deterministic for any writer is left below. */
/** A blank somebody is expected to fill in before the copy is usable, or MARKUP WHERE A WORD BELONGS: a title reading "Colors &amp; History" is not final copy, because what an operator pastes is not what a reader sees. */
const BLANK_TO_FILL = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b|&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/;
/** Copy that says out loud that the work has not been done. */
const SAYS_UNFINISHED = /\b(?:not been (?:drafted|read|written)|is not settled|not on this card|still owed|nothing here is)\b/i;

const noCopy = (t: string | null | undefined): boolean => !t || t.trim().length === 0;
const flat = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Copy carrying a blank, or saying out loud that it is not written, is unfinished whoever wrote it. */
const notFinal = (t: string): boolean => BLANK_TO_FILL.test(t) || SAYS_UNFINISHED.test(t);

/** WHY THIS IS NOT YET A CHANGE, in plain phrases, or empty when the deliverable is complete BY ITS TYPE. A title, description or heading owes its exact final replacement. An opening or a section owes final copy AND the place it lands, which only a bundle component's `where` carries. A new page owes a publish-ready page and is NEVER title-only, so every section it names owes written copy. */
/** THE LEADING "Label:" OF A LABEL AND VALUE LINE, or null. Deliberately narrow, and every part of that narrowness
 *  is load-bearing: it is anchored at the start, so a colon inside ordinary prose is never reached; the first
 *  character must be a letter and the rest letters or single spaces, so a clock time ("12:30") and an identifier
 *  never open one; and a real value has to follow, which is what keeps a scheme ("https://") out, since what comes
 *  after a label is a value and never a second slash. `gap` is the page's OWN spacing after the colon, and `latin`
 *  says whether this is a script whose spacing Beacon may repair at all. */
export function labelOf(s: string): { label: string; gap: string; latin: boolean } | null {
  const m = /^([\p{L}][\p{L} ]{0,22}):([^\S\n]*)(?=[^\s/])/u.exec(s);
  return m ? { label: m[1]!, gap: m[2]!, latin: /^[A-Za-z][A-Za-z ]*$/.test(m[1]!) } : null;
}
/** A LINE THAT WOULD PASTE ONTO THE PAGE AS ONE GLUED PHRASE ("Meaning:Light."). */
const glued = (t: string): boolean => { const lv = labelOf(t); return !!lv && lv.latin && lv.gap === ""; };

export function deliverableGaps(p: ChangeProposal): string[] {
  const gaps: string[] = [];
  if (p.researchOnly === true) gaps.push("nothing has been written for it yet");
  const c = p.recommendedChange;
  if (c.kind === "new_page") {
    for (const [what, text] of [["title", c.proposedTitle], ["description", c.metaDescription], ["opening", c.openingAnswer]] as const) {
      if (noCopy(text)) gaps.push(`it carries no ${what}`);
      else if (notFinal(text)) gaps.push(`its ${what} describes the work instead of being it`);
    }
    if (c.outline.length < 3) gaps.push("it names fewer than three sections");
    const written = (p.bundle?.components ?? []).filter((x) => !noCopy(x.after) && !notFinal(x.after))
      .map((x) => flat(`${x.label} ${x.where ?? ""} ${x.after}`)).join(" | ");
    const owed = c.outline.filter((h) => flat(h).length > 0 && !written.includes(flat(h)));
    if (owed.length > 0) gaps.push(`${owed.length} of its ${c.outline.length} sections have no copy written`);
    return [...new Set(gaps)];
  }
  if (noCopy(c.after)) gaps.push("it carries no copy");
  else if (notFinal(c.after)) gaps.push("it describes the work instead of being it");
  // A LABEL GLUED TO ITS VALUE IS NOT FINISHED OPERATOR WORK. Without this, banked copy carrying the page's own
  // missing space counted as finished, so `preferFinished` kept "Meaning:Light." and the repair that puts the one
  // space there could never reach the rows it was written for (proved live, 2026-08-28).
  else if (glued(c.after)) gaps.push("its label runs straight into the words after it, so it would paste as one glued phrase");
  // COPY THAT LANDS SOMEWHERE NEW OWES ITS PLACE. A title, a description or a heading replaces a field the page already has, so its own address is its placement; an opening or a section does not, and a Change is never an instruction to guess where copy goes. A PLACEMENT MUST ITSELF BE FINISHED: a blank-ish or instruction-shaped `where` is no placement at all, whichever writer stamped it.
  const placed = (t: string | null | undefined): boolean => !!t && t.trim().length >= 12 && !notFinal(t);
  // A CHANGE ON SEVERAL PAGES IS FINISHED ONLY WHEN EVERY PAGE IT NAMES IS. Differentiating four siblings is one decision, and three rewritten pages plus one still owed is not three quarters of a change, it is an unfinished one.
  const parts = p.bundle?.components ?? [];
  // EVERY PAGE THE DIAGNOSIS NAMED, NOT EVERY PAGE THAT SURVIVED IT. Reading the component list alone asked only about the addresses still in the change, so a three-page split that lost two pages on the way through the drafter answered "complete" about the one page left. The producer's own verdict ledger is the roll call: a page it says it is differentiating owes written copy, and a page it decided to leave alone owes its reason.
  const said = p.bundle?.dispositions ?? [];
  const written = (pg: string): boolean => parts.some((x) => x.page === pg && !noCopy(x.after) && !notFinal(x.after));
  const owed = [...new Set([...parts.map((x) => x.page), ...said.filter((d) => d.verdict === "differentiate").map((d) => d.page)])]
    .filter((x): x is string => !!x).filter((pg) => !written(pg));
  if (owed.length > 0) gaps.push(`${owed.length} of the pages it changes have no copy written`);
  const unsaid = said.filter((d) => d.verdict !== "differentiate" && d.because.trim().length < 12).map((d) => d.page);
  if (unsaid.length > 0) gaps.push(`${unsaid.length} of the pages it names give no reason for being left alone`);
  if ((c.field === "section" || c.field === "answer_block") && !placed(c.where)
    && !(p.bundle?.components ?? []).some((x) => placed(x.where))) {
    gaps.push("where it goes on the page is not named");
  }
  return [...new Set(gaps)];
}

/** COPY THAT IS STILL AN INSTRUCTION TO WRITE COPY, in the gaps' own words: those rows are a real opportunity with nothing exact written yet. A placement nobody named is NOT here on purpose: the words exist, so the operator reads them. */
const NOT_WRITTEN = /no copy|describes the work instead|nothing has been written|carries no (?:title|description|opening)/i;
/** A STORED CAVEAT WORTH READING AS A FACT ABOUT THE WORK rather than a note beside it, FOR DISPLAY ONLY: which stored sentences print under "why this is held" versus ride along as an FYI. Deliberately the phrasings this kernel actually writes. THIS REGEX NEVER GATES ANYTHING BY ITSELF: a limitation worded to dodge every phrase here still fails on the fact, because unsettledCause, deliverableGaps and the banked-copy grounding recheck run directly on the row inside the store's own promotion (proposal-store's answerReviewedProposal), never by reading what a sentence says about itself. */
const HARD_LIMITATION = /held for review|is still owed|no words from this change|not ready to paste|paste-ready|cited authoritative source|carries no source|add (?:a |an |one |1-2 )?(?:cited |authoritative )?sources?|verify (?:this|the) (?:claim|fact)/i;
/** THE FALLBACK FOR ROWS STORED BEFORE `faults` WAS TYPED, and only those: guessing an owner from the shape of an English sentence means a reworded refusal silently changes whose problem a row is. For DISPLAY and nothing else: these never touch `blocking`, because a sentence about the work must never decide whether the work ships (the gates themselves already did). The lane printed "nothing has read them for sense yet" over the top of "it repeats what stays on the page below it", handing a known failure back as if the reader were the missing ingredient. A SAFETY hold ("this moves or hides a page") is NOT this: that one really is the operator's call. */
export const GATE_WORDS = /^(?:it |this rearranges|every claim|the evaluator's exact objection|missing_source|nothing on file|the evidence it names|where this copy goes|the place it says it lands)/i; // THE ONE GATE VOCABULARY: the sentences Beacon's own gates write. The replay strips them from a candidate, a finished redraft replaces them with its own pass's findings, and legacy rows with no typed faults are read through them.
const MISPLACED = "Where this copy goes can no longer be checked against the words this page has on file, so it is held for a look rather than handed over as ready to paste.";
const UNJUDGED = "The exact words are written and nothing has read them for sense yet, so this one owes your look before it counts as finished.";
/** THE ONE HOLD THAT IS GENUINELY THE OPERATOR'S CALL, named so callers can tell it from a defect Beacon owns: stamping this sentence as a typed fault would flip a safety confirmation into "Beacon must improve this". */
const DANGER = "This one moves or hides a page, so it takes the deliberate confirmation on its own page rather than a plain yes.";
/** WHY A CHANGE SHORT OF READY IS SHORT OF READY, AND WHO MAY ANSWER IT. IMPERFECT WORK STAYS VISIBLE (operator, 2026-08-15): a gate decides which lane a genuine opportunity is shown in and which controls its card carries, never whether the operator sees it at all. `lane` is `research` while nothing exact is written and `review` once the exact copy exists; `why` is the reasons already stored on the row, said back where the work is read; `blocking` is the first reason THIS SCREEN offers to hold the yes back, a fast, friendlier read for the card, never the sole gate: the row itself is re-asked, by the real functions and not by their prose, at the one door that can actually write `ready` (proposal-store's answerReviewedProposal). HARD is a fact about the work: an unwritten deliverable, a blank, a claim the evidence it names does not carry, a page mapping its own diagnosis refuses, copy whose place on the page can no longer be checked, and a change that moves or hides a page (which keeps its own two-step confirmation). SOFT is editorial judgement alone: the words are there, every deterministic check passed, and nothing has read them for sense. PURE, so the queue, the card and the server action ask ONE question and no screen can offer a control the server refuses. */
export function openHold(p: ChangeProposal): { lane: "review" | "research"; why: string[]; blocking: string | null; faulted: boolean; safetyHold: boolean; need?: { kind: "factual_source"; query: string; url?: string; reasonCode: string; missingTopic?: string } } {
  const gaps = deliverableGaps(p), c = p.recommendedChange, faults = p.faults ?? p.limitations.filter((l) => GATE_WORDS.test(l));
  const hard = [...gaps, ...p.limitations.filter((l) => HARD_LIMITATION.test(l))];
  // COPY THAT LANDS IN THE BODY OWES A PLACE SOMEBODY CAN STILL FIND. The anchor is a sentence off the page as it read when the words were written, and banked copy is served on for ever without that page in hand, so the only honest re-read is against what the ROW ITSELF banked. An anchor no banked fact carries can no longer be checked, so the words, the claims and the evidence stay exactly as they are and the row goes back to review carrying this sentence. Never deleted, never hidden.
  const anchor = c.kind === "existing_edit" && (c.field === "section" || c.field === "answer_block")
    ? /placed after "([^"]+)"/.exec(c.where ?? "")?.[1]?.trim().toLowerCase() ?? null : null;
  // AND THE CARD'S OWN RECORD OF THE PAGE COUNTS AS THAT PROOF, not only the passages its claims happened to cite.
  // Beacon picks this anchor itself, mechanically, from the page's H1, title and headings; `supportFacts` carries the
  // body passages the claims name, and a heading is never a body passage, so an added section was refused for a
  // placement Beacon had chosen and could verify: /nowruz sat held on `placed after "Nowruz - Persian New Year"`, its
  // own H1, which its `copyStamp` carried all along (proved live, 2026-08-28). The burden is unchanged, the card must
  // still carry the words its placement names; `copyStamp` IS the page as it read when the copy was written.
  const placedOn = (t: string): boolean => t.toLowerCase().includes(anchor!.slice(0, 60));
  if (anchor && !(p.supportFacts ?? []).some((f) => placedOn(f.fact)) && !placedOn(p.copyStamp ?? "")) hard.push(MISPLACED);
  // TWO THINGS A CARD MAY NEVER CLAIM, asked HERE because this runs on every stored row every time one is read: the banked re-read only reaches rows a pass actually re-produces, so a row nothing funded kept
  // whatever a past generation decided. (1) A CLAIM ABOUT THE WORLD NEEDS A SOURCE and this page is not one: "Iran's national animal is the Asiatic cheetah" is a claim about a COUNTRY, authoritative sources
  // confirm the cheetah is critically endangered and survives only in Iran without establishing that, and a `fact-` id is the only support from outside the page. (2) A SPLIT MAY NOT PROMISE CLICKS: a modelled
  // CTR gap says what a page's positions usually earn, never what this wording recovers, so "about 176 clicks short" beside a title change is a promise the evidence never made.
  // A BUNDLE THAT DECLARES CLAIMS ANSWERS ON THEM LIKE EVERY OTHER ROW (2026-08-30). The bypass below was written for a bundle whose proposal literal never set `claims`, so a claim rule could only ever fire vacuously on one and the honest fix was to stand down; a deep body bundle now carries the claims its own substantive pieces were authorized on, and the moment it declares one it is judged on it, over ALL its pieces' copy rather than the first piece the change happens to lead with. The bypass survives for exactly what still declares nothing: a link, a canonical, a redirect, a technical repair.
  const declares = (p.claims ?? []).length > 0, bypass = !!p.bundle && !declares;
  const says = c.kind === "existing_edit" ? [c.after, ...(declares ? (p.bundle?.components ?? []).map((x) => x.after) : [])].join(" ") : "";
  // A CLAIM RULE MAY NOT FIRE ON A ROW THAT CARRIES NO CLAIMS BY CONSTRUCTION. A bundle's proposal literal never sets `claims` (its provenance is the receipt), so `(p.claims ?? []).some(...)` was false unconditionally and this rule held EVERY bundle whose components[0] copy said "national flag" or "official", vacuously and forever: the flag bundle sat stored `ready` and rendered in review off exactly this. The rule judges rows that DECLARE claims; a bundle answers on its receipt, whose integrity gate already ran at mint. AND THE HOLD NAMES ITS OWN CURE, TYPED: "held until a source is on file" was a dead end the customer could not act on and nothing was fetching, so the verdict now carries the exact factual_source requirement the runtime's acquisition already executes.
  let need: { kind: "factual_source"; query: string; url?: string; reasonCode: string; missingTopic?: string } | null = null;
  if (!bypass && /\bnational (?:animal|flag|symbol|language|bird)\b|\bofficial\b/i.test(says) && !(p.claims ?? []).some((x) => x.supportedBy.some((id) => id.startsWith("fact-")))) {
    hard.push("It states what a country's national symbol is and stands only on this page saying so, which is not a source, so it is held until one is on file.");
    need = { kind: "factual_source", query: p.primaryQuery, ...(p.pageUrl ? { url: p.pageUrl } : {}), reasonCode: "claim_unsourced" };
  }
  // A BODY CLAIM STANDING ON EXACTLY ONE OUTSIDE SOURCE NAMES ITS OWN CURE: a second independent source. The
  // takbir answer sat in review with a writer-authored hold ("rests on one encyclopedia source") that matches no
  // typed fault, so the lane said "nothing has read them for sense yet" over a cure nothing was fetching: the
  // finished substantive answer for the queue's #2 traffic opportunity was a dead end. Read structurally, never
  // from the sentence: an unpromoted section or answer whose external support is one distinct fact-* id mints
  // the factual_source requirement for THAT claim's own proposition, and the runtime's acquisition researches
  // it, banks the second source, and the next redraft clears the hold on evidence rather than on taste.
  if (!need && !bypass && p.status === "needs_review" && c.kind === "existing_edit" && (c.field === "section" || c.field === "answer_block")) {
    const factBacked = (p.claims ?? []).filter((x) => x.supportedBy.some((id) => id.startsWith("fact-")));
    const distinctFacts = new Set(factBacked.flatMap((x) => x.supportedBy.filter((id) => id.startsWith("fact-"))));
    if (distinctFacts.size === 1 && factBacked[0])
      need = { kind: "factual_source", query: p.primaryQuery, ...(p.pageUrl ? { url: p.pageUrl } : {}), reasonCode: "single_source", missingTopic: factBacked[0].text };
  }
  if ((p.causeFinding?.cause ?? p.diagnosisCause) === "cannibalization" && /\d[\d,.]*\s*clicks short/i.test(p.whyItMatters ?? "")) hard.push("Its reason promises clicks a wording change has never been shown to recover, so it is held until the ownership work it belongs to is finished.");
  // THE PROOF BURDEN MATCHES THE PROMISE: what a change claims decides what it owes (decision/authorization's
  // evidenceShortfall). Asked here so every reader of the one servability verdict refuses together.
  const short = evidenceShortfall(p); if (short) hard.push(short);
  // AND AN UNSUPPORTED CLAIM NAMES ITS OWN CURE rather than leaving the operator holding a refusal nobody is acting on: the same factual_source requirement the runtime's acquisition already executes, minted off the row's own first unsupported claim. Only for the two shapes that can carry one and reach here internal, a whole new page and a deep bundle; an atomic row already has its two mints above.
  if (!need && short) { const unsupported = (p.claims ?? []).find((x) => !x.supportedBy.some((id) => /^fact-|^owned-page/.test(id)));
    if (unsupported && (c.kind === "new_page" || !!p.bundle)) need = { kind: "factual_source", query: p.primaryQuery, ...(p.pageUrl ? { url: p.pageUrl } : {}), reasonCode: "claim_unsupported", missingTopic: unsupported.text }; }
  // THE SAFETY HOLD LIFTS WHEN THE OPERATOR HAS ANSWERED IT, on the exact version they read: pushed unconditionally,
  // a confirmed redirect could never wear Ready anywhere, the next pass swept the hold back into status, and the card
  // told the operator to confirm the very thing they had just confirmed, forever (audit, 2026-08-26). The same
  // staleness rule the validator applies decides: a change edited since the yes re-holds; a current yes stands.
  if (dangerousComponents(p.bundle?.components ?? []).length > 0 && p.confirmedVersion !== confirmedVersion(p)) hard.push(DANGER);
  const said = [...new Set([...hard, ...faults])];
  return { lane: p.researchOnly === true || gaps.some((g) => NOT_WRITTEN.test(g)) ? "research" : "review",
    // EVERYTHING BEACON KNOWS ABOUT WHY THIS IS HELD, not the first kind of reason it happens to find: a row with a safety hold AND a copy fault used to print only the hold, so the defect stayed invisible.
    // A READ-TIME HARD RULE IS BEACON'S OWN VERDICT TOO: the national-symbol hold is minted here rather than stored, so classifying off stored sentences alone rendered "Needs your review" over a defect Beacon owns (the cheetah card, live). Every hard reason except the SAFETY confirmation counts as Beacon's problem to fix.
    why: said.length > 0 ? said : [UNJUDGED], blocking: hard[0] ?? null, faulted: faults.length > 0 || hard.some((h) => h !== DANGER), safetyHold: hard[0] === DANGER, ...(need ? { need } : {}) };
}

/** FINISHED WORK IS NOT UNDONE BY A PASS THAT DID NOT REACH IT. Drafting is capped per pass, so a card past the cap comes back from its producer as the BRIEF it started as, and writing that over copy an earlier pass already paid for DESTROYED it: 6 then 4 then 3 finished cards across three consecutive passes, taking the biggest description on the site (18,317 views in 90 days) with it. A stored deliverable is replaced by a NEW finished one or by an explicit withdrawal carrying a reason, never by silence. WHAT THE COPY WAS WRITTEN FOR IS WHAT KEEPS IT ALIVE. The basis alone decided, and a basis is a reading of the ACCOUNT, not of this page: it does not move when the page is re-crawled, when the diagnosis changes its mind, when the evidence behind the argument is replaced, when the piece is aimed at a different place or a different set of addresses, when the lever changes, or when the line the copy says it replaces is no longer the line the page carries. Every one of those makes banked words answer a question nobody is asking any more. So the words survive only while the identity BELOW them is byte for byte what it was, and that identity is exactly the material fields the stored fingerprint already treats as identity, minus the copy itself. `copyStamp` is the caller's reading of the TARGET PAGE at the moment each card was minted (title, heading, description, outline), banked on the row beside the words, so a page re-crawled into a different shape retires copy written for the old one. A row carrying no stamp compares as null on both sides and is decided by everything else. PURE. */
/** THE MATERIAL COPY-VALIDITY IDENTITY, and ONLY the material half (operator, 2026-08-22). The old identity
 *  hashed the producer's own prose (evidence hint wording, the cause EXPLANATION sentence) and raw observation
 *  ids, so a pass that merely reworded its generator, appended an agreeing observation or shipped under a new
 *  code version computed "different" and DESTROYED finished copy it could not redraft: the one Ready change in
 *  production became a research brief on a paused $0 pass. What decides whether finished words still stand is
 *  material: the target page as it reads today (`copyStamp`), the diagnosed cause BY KEY, the lever, the
 *  normalized intent, and the set of pages a bundle writes on. Contradiction and support are re-checked
 *  separately by the banked-copy re-reads (drafted-copy's staleCopyReasons), which read the claims against the
 *  facts banked beside them, so dropping prose from the identity loosens nothing about truth. */
/** ORDER-FREE: the demand-unit label is minted from a live impressions sort, so two phrasings of ONE unit swap
 *  leadership week to week and a word-order-sensitive intent re-enabled the destruction through the one
 *  dimension this identity added (review, 2026-08-22). Sorted tokens make every reordering of the same words
 *  one intent, which is the same subject rule the canonical query key applies on the server. */
const normIntent = (q: string): string => (q ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").sort().join(" ");
function copyIdentity(p: ChangeProposal): string {
  const parts = p.bundle?.components ?? [];
  return JSON.stringify([p.copyStamp ?? null, p.changeFamily, p.diagnosisCause ?? null, normIntent(p.primaryQuery),
    p.recommendedChange.kind === "existing_edit" ? [p.recommendedChange.field] : ["new_page"],
    [...new Set(parts.map((c) => c.page ?? p.pagePath ?? ""))].sort(),
    parts.map((c) => [c.kind, c.page ?? null]),
    (p.bundle?.dispositions ?? []).map((d) => [d.page, d.verdict])]);
}
/** WHICH MATERIAL FACT MOVED, in words, for the retirement receipt. */
function identityMoves(prior: ChangeProposal, incoming: ChangeProposal): string {
  const moves: string[] = [];
  if ((prior.copyStamp ?? null) !== (incoming.copyStamp ?? null)) moves.push("the page's own content changed under it");
  if ((prior.diagnosisCause ?? null) !== (incoming.diagnosisCause ?? null)) moves.push("the diagnosed cause changed");
  if (normIntent(prior.primaryQuery) !== normIntent(incoming.primaryQuery)) moves.push("the search it answers changed");
  if (prior.changeFamily !== incoming.changeFamily
    || (prior.recommendedChange.kind === "existing_edit" ? prior.recommendedChange.field : "new_page")
      !== (incoming.recommendedChange.kind === "existing_edit" ? incoming.recommendedChange.field : "new_page")) moves.push("the kind of change moved");
  return moves.join("; ") || "the pages this change writes on moved";
}

/** THE PAID READING RIDES ITS OWN WORDS, whichever branch below decided the row. `semanticReview.of` IS the copy
 *  key it was taken over and `unreviewed` accepts a reading only while it still matches the row it sits on, so
 *  carrying one onto a row with that exact key can never authorize words nobody read. Guarding this at the CALLER
 *  was wrong and the gate caught it: a prior whose own copy is unfinished returns early from the branches below,
 *  so a matching key at the call site never proved the reading would survive the merge. */
export function preferFinished(incoming: ChangeProposal, prior: ChangeProposal | null | undefined): ChangeProposal {
  const row = decideFinished(incoming, prior);
  return !row.semanticReview && prior?.semanticReview && prior.semanticReview.of === copyKey(row)
    ? { ...row, semanticReview: prior.semanticReview } : row;
}

function decideFinished(incoming0: ChangeProposal, prior: ChangeProposal | null | undefined): ChangeProposal {
  // A PRODUCER THAT READ NOTHING CANNOT CLAIM THE PAGE MOVED (operator, 2026-08-31). The re-mint of a $0 card
  // arrives with no copyStamp, the finished prior carries the page as the drafting pass read it, and comparing
  // null against that stamp broke identity: the template then replaced the finished description whole, copy to
  // a receipt, backing and status gone. A stampless incoming inherits the prior's stamp; a producer that DID
  // re-read the page and saw it change still breaks identity exactly as before, which is the honest trigger.
  const incoming = incoming0.copyStamp == null && prior?.copyStamp ? { ...incoming0, copyStamp: prior.copyStamp } : incoming0;
  // THE RECEIPT OUTLIVES THE PASS THAT STAMPED IT (review, 2026-08-22): every return carries the newest retirement receipt available, so the retired words stay inspectable under whatever replaced them instead of living exactly one pass. A NEW receipt below outranks an inherited one.
  const inherited = prior?.previousCopy && !incoming.previousCopy ? { previousCopy: prior.previousCopy } : {};
  const priorAfter = prior?.recommendedChange.kind === "existing_edit" ? prior.recommendedChange.after.trim() : "";
  if (!prior || copyIdentity(prior) !== copyIdentity(incoming)) {
    // FINISHED COPY IS NEVER LOST WITHOUT A RECEIPT, whether the replacement is a brief OR different finished
    // words: a finished prior whose words do not survive into the incoming row stamps the retirement receipt.
    const incomingAfter = incoming.recommendedChange.kind === "existing_edit" ? incoming.recommendedChange.after.trim() : "";
    if (prior && deliverableGaps(prior).length === 0 && priorAfter && priorAfter !== incomingAfter) {
      return { ...incoming, previousCopy: { after: priorAfter,
        retiredBecause: identityMoves(prior, incoming), at: incoming.createdAt } };
    }
    return { ...incoming, ...inherited };
  }
  // AND A PERSON WHO READ THE WORDS AND ASKED FOR BETTER ONES OUTRANKS THE PRESERVATION RULE. Banked copy survives because a pass that did not reach a card must not destroy it, which says nothing about a card somebody read and sent back: the ask stands until a pass actually writes over it.
  if (prior.redraftRequested) return { ...incoming, ...inherited };
  // A RESEARCH BRIEF IS NEVER FINISHED WORK, however complete its sentences read (Codex, 2026-08-23): a gap-free instruction ("the work is reachability first") beat the finished /funny-farsi-phrases answer here, one second after that answer saved. Only a row that is itself a deliverable may replace one. AND A SECOND GENERATION OF THE SAME WORK DOES NOT GET TO REPLACE THE ONE THAT ALREADY PASSED. A model varies run to run, which is fine BEFORE validation and never after it: five inspected deliverables persisted as three because a later pass under the same identity re-drafted them and saved whatever it got that time, once storing "Goodbye: goodbye." over a finished answer. Identity is the whole of it, so anything that would make the old answer wrong reopens it: `workKey` folds the writer contract, the basis, the evidence hash, the treatment, the cause and the query, and `copyStamp` is the page as it was last read. A missing stamp on either side is NOT a match, so a row from before this rule is replaced exactly as it was.
  const settled = prior.status === "ready" && deliverableGaps(prior).length === 0 && !!prior.workKey && prior.workKey === incoming.workKey && !!prior.copyStamp && prior.copyStamp === incoming.copyStamp;
  // A PAID REVIEW BOUND TO THE PRIOR'S EXACT COPY OUTRANKS AN UNREVIEWED RE-MINT (live, 2026-09-01): the $0
  // template a producer mints every pass looked complete, so it replaced a drafted and adversarially read row
  // whole, and two paid redrafts were erased the pass after they landed. The reviewed prior takes the kept
  // path below, where its provenance is still demanded before a word survives.
  const reviewedPrior = !!prior.semanticReview && prior.semanticReview.of === copyKey(prior) && !(incoming.semanticReview && incoming.semanticReview.of === copyKey(incoming));
  if (!settled && !reviewedPrior && ((incoming.researchOnly !== true && deliverableGaps(incoming).length === 0) || deliverableGaps(prior).length > 0)) return { ...incoming, ...inherited };
  // COPY NOBODY CAN TRACE IS NOT FINISHED WORK. An atomic card's words are written by the editor, which hands back every claim beside the evidence ids carrying it, and this branch banked the words and dropped the claims: all three ready cards on the live account carried `claims: null` and no persisted mapping from a sentence to the thing behind it, so nothing on the row could ever be re-checked. Banked words survive only WITH their provenance now, and copy that reached the row before this did is redrafted once rather than served on for ever as an unsupported claim. A bundle answers on its receipt instead and is left alone.
  if (!prior.bundle && (prior.claims ?? []).length === 0) return { ...incoming, ...inherited };
  // AND A CLAIM POINTING AT AN ID NOBODY BANKED THE WORDS FOR IS NOT PROVENANCE EITHER. The ids resolve inside the pass that drafted the copy and nowhere else, so banked words survive only while every id their claims name has its exact quoted fact banked beside them. Copy banked before the pairs existed is redrafted once, exactly as copy banked before the claims existed was.
  const banked = new Set((prior.supportFacts ?? []).map((f) => f.id));
  if (!prior.bundle && (prior.claims ?? []).some((c) => c.supportedBy.some((id) => !banked.has(id)))) return { ...incoming, ...inherited };
  // The words, where they land, what they cost, what was said about them AND what each claim stands on stay as banked; THIS pass's evidence, ranking and receipt still land on the row, so the card keeps arguing from what is true today.
  // EVERY COPY-OWNED FIELD RIDES WITH THE COPY, off ONE named list rather than a hand-copied spread that drifts: the hand list carried limitations and dropped `faults`, so the one path that KEEPS a defective row's words silently lost Beacon's own typed statement of the defect and the lane fell back to guessing owners from sentence shape. The operator's yes (`approval`) travels with `confirmedVersion` for the same reason: they are one fact. A pass that changes the work fails the identity above and `incoming` wins whole, faults and all.
  const kept: ChangeProposal = { ...incoming, ...inherited, recommendedChange: prior.recommendedChange, researchOnly: false, status: prior.status,
    limitations: prior.limitations, estimatedEffortMinutes: prior.estimatedEffortMinutes };
  const fits = copyKey(kept) === copyKey(incoming); // A RECEIPT MAY ARRIVE LATE ONLY IF IT WAS WRITTEN FOR THESE WORDS: the exception claimed identity proved the copy byte-identical, but `copyIdentity` EXCLUDES the copy and `workKey` names the job, so a redraft's receipts rode the banked words (Codex, 2026-08-28)
  // THE STEPS FOLLOW THE WORDS THEY DESCRIBE. `fits` means the kept copy is byte for byte what this pass would
  // have written, so the instructions for carrying it out are the ones today's rules produce. Deliberately ONLY
  // the steps: `claims` and `supportFacts` are hashed into `copyKey`, so refreshing either moves the key and
  // silently retires the paid reading attached to it, which is a copy change and belongs in front of the
  // reviewer rather than swapped in underneath one. That is a live defect this shipped and reverted once.
  for (const f of COPY_OWNED) {
    if (fits && f === "operatorSteps") continue; // already carrying this pass's value from `incoming`
    if (prior[f] != null) (kept as Record<string, unknown>)[f] = prior[f];
    else if (!(fits && (f === "preservation" || f === "informationGain"))) delete (kept as Record<string, unknown>)[f]; }
  return kept;
}
/** THE FIELDS THAT BELONG TO THE BANKED COPY and must survive with it. `redraftRequested` is deliberately ABSENT: a person who asked for better words outranks preservation, and that path returns before this list is read. The day someone adds a copy-owned field to the contract and forgets it here, the typed faults lesson repeats; keep this list beside the contract change in the same commit. */
const COPY_OWNED = ["claims", "supportFacts", "operatorSteps", "bundle", "confirmedVersion", "approval", "faults", "modeledOn", "informationGain", "preservation"] as const satisfies readonly (keyof ChangeProposal)[];

/** THE EXACT VERSION OF A CHANGE AN OPERATOR CAN SAY YES TO, and the ONE definition of it: the screen folds this and the server recomputes it byte for byte off the row it re-reads, so no second reading of "the same version" can exist. A confirmation is worthless unless it names WHAT was confirmed, and this used to name a third of it: the copy it replaces, where the copy lands, what survives a page move, the risks, the caveats, the steps, the reasons pages were left alone, every claim, the words behind every claim, the readings on the receipt and the days they were taken all moved without moving the version. It is now EVERYTHING MATERIAL THE OPERATOR READ. Any edit to any of it mints a different string, the stored stamp stops matching, and the stale confirmation refuses. UNORDERED SETS ARE SORTED, so re-listing the same caveats, support ids, readings or verdicts is not a rewrite; the ranking, the timestamps and the measurement figures are excluded because none of them is the change. SHORT and PURE: it folds through the same tiny fingerprint a bundle's pieces are already named by, so a server component can hand it to a browser. */
export function confirmedVersion(p: ChangeProposal): string {
  const c = p.recommendedChange, b = p.bundle, f = p.causeFinding;
  const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  // THE CONFIRMATION STILL PINS THE BASIS AND EVERY RENDERED SENTENCE: copy PRESERVATION dropped them from its
  // own identity (a reworded producer must not destroy finished words), but an operator's yes was given to one
  // account truth and one exact screen, so those stay part of THIS stamp explicitly.
  const material = [p.basis ?? null, p.riskLevel, copyIdentity(p), p.diagnosisCause ?? null, sorted(p.limitations), p.operatorSteps ?? [],
    c.kind === "existing_edit" ? [c.field, c.before, c.after, c.where ?? null] : [c.proposedTitle, c.metaDescription, c.openingAnswer, c.outline, c.faqQuestions, c.schemaTypes],
    (p.claims ?? []).map((x) => [x.text, [...x.supportedBy].sort()]), sorted((p.supportFacts ?? []).map((x) => [x.id, x.fact])), p.informationGain ?? null, p.preservation ?? null,
    f ? [f.cause, f.explanation, f.falsifier, sorted(f.competingExplanations.map((x) => [x.cause, x.reason])), sorted(f.notConsidered.map((x) => [x.cause, x.missing]))] : null,
    b ? [b.objective, b.metric, b.measurementPlan, sorted(b.risks), sorted(b.receipt.missing), sorted(b.confidenceReasons), sorted(b.alternatives.map((x) => [x.option, x.reason])),
      b.components.map((x, i) => [componentIdOf(x, i), x.page ?? null, x.where ?? null, x.before, x.risk, x.redirectTo ?? null, x.objective ?? null, x.mechanism ?? null, x.anchorAfter ?? null, x.preserves ?? null, x.sourcePack ?? null, sorted(x.evidenceKeys)]),
      sorted((b.dispositions ?? []).map((d) => [d.page, d.verdict, d.because])),
      sorted(b.receipt.items.map((i) => [i.key, i.kind, i.fact, i.observedAt, i.observationId ?? null, [...(i.observationIds ?? [])].sort()]))] : null];
  return componentIdOf({ kind: "confirmation", after: JSON.stringify(material) }, 0);
}
