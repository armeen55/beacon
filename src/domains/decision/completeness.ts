/** decision/completeness: THE ONE CHECK THAT ASKS WHETHER BEACON HAS FINISHED THE WORK. A customer-facing Change states exactly what to add, replace, delete, move, link, redirect or create, exactly where, and the FINAL COPY wherever copy is involved. IMPERFECT WORK STAYS VISIBLE (operator, 2026-08-15): anything short of that is a genuine opportunity still being developed, and it is RANKED and SHOWN, on the ranked queue and on Today, as a research card carrying what is known, what is still missing and what happens next. What this boundary decides is never whether the operator sees a row, only which of the three lanes it lands in, that it carries no copy to paste and no control that records it done, and that the server refuses to put it into measurement or mark it implemented until the deliverable is actually finished. PURE and derived from the deliverable ITSELF, never from the prose around it, so the queue, the card (a client component) and the server mutation all ask one question and a voice edit moves none of them. It sits beside the contract rather than inside the validator because a client bundle may reach this and may not reach that. */

import { componentIdOf, dangerousComponents } from "./contracts";
import { copyKey } from "./proof";
import { domainOf } from "@/domains/evidence/relevance-gate";
import type { ChangeProposal } from "./contracts";
import { CAUSE_LEVERS, evidenceShortfall } from "./proof";

/** NO VERB LIST LIVES HERE ANY MORE. Whether copy is the finished words or a note about producing them is a question about meaning, and it was answered by spelling: a production verb near a deliverable noun. It is now answered where it is known. A PRODUCER handing over a brief says so in a typed field (`researchOnly`) as it mints the card. THE EDITOR's copy is read by decision/drafted-copy's editor contract, against the stored page and then by a judge. Only what stays deterministic for any writer is left below. */
/** A blank somebody is expected to fill in before the copy is usable, or MARKUP WHERE A WORD BELONGS: a title reading "Colors &amp; History" is not final copy, because what an operator pastes is not what a reader sees. */
const BLANK_TO_FILL = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b|&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/;
/** Copy that says out loud that the work has not been done. */
const OWED_NOTE = /^The exact .* lands on the next pass/; /* the drafter's "lands on the next pass" note: display, never identity, never a hold */
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
  // STRUCTURED DATA IS NOT PROSE (falsifier, 2026-09-02). Every rule below is about words a person reads, and a bracketed span is a blank still to be filled in copy while it is an ARRAY in JSON-LD: every real FAQPage block read as "it describes the work instead of being it", so the $0 loop demoted finished markup and `nextObligation` sent it to the paid writer as a draft. A schema block is unwritten when it is empty or will not parse; the canon's own JSON-LD gate judges everything else about it.
  if (c.field === "schema") {
    const json = c.after.replace(/^\s*<script[^>]*>/i, "").replace(/<\/script>\s*$/i, "").trim();
    if (!json) gaps.push("it carries no structured data");
    else try { JSON.parse(json); } catch { gaps.push("its structured data is not valid JSON, so no search engine could read it"); }
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
export const GATE_WORDS = /^(?:it |its copy carries no record|this rearranges|every claim|the evaluator's exact objection|missing_source|nothing on file|nothing in it beyond|the line |the only words in it|the sentence carrying the link|the route it opens|a claim here is|the evidence it names|where this copy goes|the place it says it lands)/i; // THE ONE GATE VOCABULARY: the sentences Beacon's own gates write, INCLUDING THE SIX THE SUMMARY-LINE RULES WRITE (live, 2026-09-05: /california-persian-cities/beverly-hills was promoted carrying "the only words in it this page does not share with its template siblings ..." in its limitations, read to a customer as their own caveat, because that opener was outside this pattern so neither the promotion candidate nor the finished door stripped it and it could never be re-earned), and the store's own record sentence with them (probe, 2026-09-05: two rows whose record a reading had rebuilt still carried "its copy carries no record of what it stands on", which no door stripped, so a promotion would have served it as a caveat on finished words). The replay strips them from a candidate, a finished redraft replaces them with its own pass's findings, and legacy rows with no typed faults are read through them.
const MISPLACED = "Where this copy goes can no longer be checked against the words this page has on file, so it is held for a look rather than handed over as ready to paste.";
const UNJUDGED = "The exact words are written and nothing has read them for sense yet, so this one owes your look before it counts as finished.";
/** THE ONE HOLD THAT IS GENUINELY THE OPERATOR'S CALL, named so callers can tell it from a defect Beacon owns: stamping this sentence as a typed fault would flip a safety confirmation into "Beacon must improve this". */
const DANGER = "This one moves or hides a page, so it takes the deliberate confirmation on its own page rather than a plain yes.";
/** THE ONE SENTENCE A LOST RECORD WRITES, shared by the hold below and the preservation branch that keeps such a row's words, so the two can never drift; decision/obligation matches its own copy of the phrase, as it matches `deliverableGaps`'s. */
const NO_RECORD = "its copy carries no record of what it stands on";
const SILENT_SOURCE = /https?:\/\/[^\s"';]+\s+says:?\s+""/g; /** A SOURCE THAT QUOTED NOTHING, in the string this codebase composes for a banked fact itself (`<address> says "<quotation>"`), read only on a row banked before the typed addresses existed. HOW MANY PUBLISHERS STAND BEHIND WHAT THIS COPY CLAIMS, counted by HOST at the ONE place the proportional evidence bar and the finished card both read, so the number a customer is shown and the number that decides whether more evidence is owed can never disagree. TYPED PROVENANCE FIRST (measured, 2026-09-05): the count pulled hostnames out of the banked fact's own prose, so the pre-1979 flag card read "Backed by 2 checked sources" off ONE reading whose bank row says `single_source` and whose first address quoted nothing at all, and 437 of the bank's 1,293 sources carry an empty quotation. A fact banked with its own addresses answers from them; a fact banked before they existed is read from its text with a source that says nothing dropped, which is the same rule applied to the only record that row has. */
export function citedPublishers(p: ChangeProposal): Set<string> { const cited = new Set((p.claims ?? []).flatMap((x) => x.supportedBy.filter((id) => id.startsWith("fact-")))); return new Set((p.supportFacts ?? []).filter((f) => cited.has(f.id)).flatMap((f) => f.sources ?? (f.fact.replace(SILENT_SOURCE, " ").match(/https?:\/\/[^\s"';]+/g) ?? [])).map((u) => domainOf(u)).filter(Boolean)); }
/** WHY A CHANGE SHORT OF READY IS SHORT OF READY, AND WHO MAY ANSWER IT. IMPERFECT WORK STAYS VISIBLE (operator, 2026-08-15): a gate decides which lane a genuine opportunity is shown in and which controls its card carries, never whether the operator sees it at all. `lane` is `research` while nothing exact is written and `review` once the exact copy exists; `why` is the reasons already stored on the row, said back where the work is read; `blocking` is the first reason THIS SCREEN offers to hold the yes back, a fast, friendlier read for the card, never the sole gate: the row itself is re-asked, by the real functions and not by their prose, at the one door that can actually write `ready` (proposal-store's answerReviewedProposal). HARD is a fact about the work: an unwritten deliverable, a blank, a claim the evidence it names does not carry, a page mapping its own diagnosis refuses, copy whose place on the page can no longer be checked, and a change that moves or hides a page (which keeps its own two-step confirmation). SOFT is editorial judgement alone: the words are there, every deterministic check passed, and nothing has read them for sense. PURE, so the queue, the card and the server action ask ONE question and no screen can offer a control the server refuses. */
export function openHold(p: ChangeProposal): { lane: "review" | "research"; why: string[]; caveats: string[]; blocking: string | null; faulted: boolean; safetyHold: boolean; need?: { kind: "factual_source" | "serp"; query: string; url?: string; reasonCode: string; missingTopic?: string } } {
  const stands = (p.claims ?? []).length > 0 && (p.supportFacts ?? []).length > 0; /* AND A ROW WHOSE RECORD STANDS MAY NOT CARRY THE SENTENCE THAT SAYS IT HAS NONE (measured, 2026-09-05: eighteen current rows wear it, seventeen of them truthfully with no claim and no support fact, and one carries a claim and three support facts and is held for a record it holds). The sentence is written where a brief would have displaced finished words, and only a paid reading retired it, so a row whose own record answers it stayed held for a reason its own payload disproves. Asked of the row, at no cost, on every pass that reads it. */ const lims = p.limitations.filter((l) => !OWED_NOTE.test(l) && !(stands && l === NO_RECORD)); /* THE OWED NOTE IS NEVER A HOLD (reviewer, 2026-09-04): "no action needed from you until it does" read as a hard limitation, minted a redraft whose instruction was the note itself, and the obligation flipped every pass with the note */
  const gaps = deliverableGaps(p), c = p.recommendedChange, faults = (p.faults ?? lims.filter((l) => GATE_WORDS.test(l))).filter((f) => !(stands && f === NO_RECORD));
  const hard = [...gaps, ...lims.filter((l) => HARD_LIMITATION.test(l))];
  // COPY THAT LANDS IN THE BODY OWES A PLACE SOMEBODY CAN STILL FIND. The anchor is a sentence off the page as it read when the words were written, and banked copy is served on for ever without that page in hand, so the only honest re-read is against what the ROW ITSELF banked. An anchor no banked fact carries can no longer be checked, so the words, the claims and the evidence stay exactly as they are and the row goes back to review carrying this sentence. Never deleted, never hidden.
  const anchor = c.kind === "existing_edit" && (c.field === "section" || c.field === "answer_block")
    ? /placed after (?:the heading )?"([^"]+)"/.exec(c.where ?? "")?.[1]?.trim().toLowerCase() ?? null : null;
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
  let need: { kind: "factual_source" | "serp"; query: string; url?: string; reasonCode: string; missingTopic?: string } | null = null;
  if (!bypass && /\bnational (?:animal|flag|symbol|language|bird)\b|\bofficial\b/i.test(says) && !(p.claims ?? []).some((x) => x.supportedBy.some((id) => id.startsWith("fact-")))) {
    hard.push("It states what a country's national symbol is and stands only on this page saying so, which is not a source, so it is held until one is on file.");
    need = { kind: "factual_source", query: p.primaryQuery, ...(p.pageUrl ? { url: p.pageUrl } : {}), reasonCode: "claim_unsourced" };
  }
  // EVIDENCE IS PROPORTIONAL TO WHAT THE TREATMENT RISKS, AND SOURCES ARE COUNTED, NOT IDS (operator, 2026-09-01).
  // This held every unpromoted body row whose external support resolved to ONE fact-* id, which is not a source
  // count at all: one fact carrying two independent authorities read as one, two ids cut from the same publisher
  // read as two, and a reversible usage note owed exactly what a destructive correction owes. A fact- id is
  // ALREADY authoritative, freshly read and shown to entail its own claim before it may enter a packet at all
  // (evidence/pages/fact-checks admits nothing else), so ONE such publisher carries an ADDITIVE section, which a
  // reader undoes by deleting it. Corroboration is owed where being wrong costs more than a revert: copy that
  // REPLACES words the page already carries, and copy whose own claim is that sources agree.
  if (!need && !bypass && p.status === "needs_review" && c.kind === "existing_edit" && (c.field === "section" || c.field === "answer_block")) {
    const cited = new Set((p.claims ?? []).flatMap((x) => x.supportedBy.filter((id) => id.startsWith("fact-"))));
    const publishers = citedPublishers(p);
    const owed = (c.before ?? "").trim() !== "" || /\bsources agree\b|\bmost (?:pages|sites|sources|publishers)\b|\bwidely (?:agreed|reported)\b/i.test(says) ? 2 : 1;
    if (cited.size > 0 && publishers.size < owed)
      need = { kind: "factual_source", query: p.primaryQuery, ...(p.pageUrl ? { url: p.pageUrl } : {}),
        reasonCode: publishers.size === 0 ? "unread_source" : "single_source",
        missingTopic: (p.claims ?? []).find((x) => x.supportedBy.some((id) => cited.has(id)))?.text ?? p.primaryQuery };
  }
  if ((p.causeFinding?.cause ?? p.diagnosisCause) === "cannibalization" && /\d[\d,.]*\s*clicks short/i.test(p.whyItMatters ?? "")) hard.push("Its reason promises clicks a wording change has never been shown to recover, so it is held until the ownership work it belongs to is finished.");
  // THE PROOF BURDEN MATCHES THE PROMISE: what a change claims decides what it owes (decision/authorization's
  // evidenceShortfall). Asked here so every reader of the one servability verdict refuses together.
  const short = evidenceShortfall(p); if (short) hard.push(short);
  // AND THE SHAPE HOLD NAMES ITS OWN CURE, TYPED. A replacement line held "until a diagnosis names what is wrong with the current one or a stored results page backs this shape" was a dead end nobody was buying: eight live meta and title rows sat behind it for ever, because `nextObligation` saw nothing owed and the $0 replay skipped them. The cure is one cheap read the runtime already executes, and the condition is recomputed from typed fields rather than read off the sentence.
  const shapeCause = p.causeFinding?.cause ?? p.diagnosisCause;
  if (!need && short && c.kind === "existing_edit" && (c.field === "title" || c.field === "meta" || c.field === "h1")
    && (c.before ?? "").trim() !== "" && !p.modeledOn && !(shapeCause && CAUSE_LEVERS[shapeCause]?.has(c.field)))
    need = { kind: "serp", query: p.primaryQuery, reasonCode: "shape_unbacked" };
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
    // A READ-TIME HARD RULE IS BEACON'S OWN VERDICT TOO: the national-symbol hold is minted here rather than stored, so classifying off stored sentences alone rendered "Needs your review" over a defect Beacon owns (the cheetah card, live). Every hard reason except the SAFETY confirmation counts as Beacon's problem to fix. // AND WHAT IS LEFT FOR THE OPERATOR TO KEEP IN MIND, DECIDED HERE AND NOWHERE ELSE (measured 2026-09-05 at 14:50Z, a LIVE count that moves with every pass so it names its reading rather than standing as a constant: 71 raw gate sentences sit in stored limitations across 64 judged rows and exactly ONE reaches a customer as their own caveat, "its copy carries no record of what it stands on" on /california-persian-cities/fremont, because the row's own claims and support facts DISPROVE it, so this verdict drops it from `why` and the surface then printed the row's raw limitations instead). A caveat is what a person should bear in mind about finished words; a sentence one of Beacon's own gates wrote is a defect Beacon owns, named above or answered by the typed fault and the obligation. One vocabulary, asked once, so no screen can invent a second.
    why: said.length > 0 ? said : [UNJUDGED], caveats: p.limitations.filter((l) => !GATE_WORDS.test(l) && !said.includes(l)), blocking: hard[0] ?? null, faulted: faults.length > 0 || hard.some((h) => h !== DANGER), safetyHold: hard[0] === DANGER, ...(need ? { need } : {}) };
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
const slotOf = (f: string): string => (f === "answer_block" || f === "section" ? "body" : f); /** WHICH SLOT A FIELD WRITES, the field half of mutation-footprint's own table: `answer_block` and `section` are two names for ONE body edit and land on the same words. Read as the raw field, a brief minted `answer_block` and the finished section the writer handed back for that very brief were two kinds of change, so every re-mint retired the finished copy with "the kind of change moved" and put the brief back on the row: twice in one live drive (2026-09-03), both receipts still saying produced. */
function copyIdentity(p: ChangeProposal): string {
  const parts = p.bundle?.components ?? [];
  return JSON.stringify([p.copyStamp ?? null, p.changeFamily, p.diagnosisCause ?? null, normIntent(p.primaryQuery),
    p.recommendedChange.kind === "existing_edit" ? [slotOf(p.recommendedChange.field)] : ["new_page"],
    [...new Set(parts.map((c) => c.page ?? p.pagePath ?? ""))].sort(),
    parts.map((c) => [c.kind, c.page ?? null]),
    (p.bundle?.dispositions ?? []).map((d) => [d.page, d.verdict])]);
}
/** WHICH MATERIAL FACT MOVED, in words, for the retirement receipt. */
function identityMoves(prior: ChangeProposal, incoming: ChangeProposal): string {
  const moves: string[] = [];
  if ((prior.copyStamp ?? null) !== (incoming.copyStamp ?? null)) moves.push("the page's own content changed under it");
  if ((prior.diagnosisCause ?? null) !== (incoming.diagnosisCause ?? null)) moves.push(CAUSE_STAMPED);
  if (normIntent(prior.primaryQuery) !== normIntent(incoming.primaryQuery)) moves.push("the search it answers changed");
  if (prior.changeFamily !== incoming.changeFamily
    || (prior.recommendedChange.kind === "existing_edit" ? slotOf(prior.recommendedChange.field) : "new_page")
      !== (incoming.recommendedChange.kind === "existing_edit" ? slotOf(incoming.recommendedChange.field) : "new_page")) moves.push("the kind of change moved");
  return moves.join("; ") || "the pages this change writes on moved";
}

/** THE ONE SENTENCE A CAUSE MOVE WRITES, shared by the receipt above and the recovery below so the two can never drift apart. */
const CAUSE_STAMPED = "the diagnosed cause changed";
/** THE CAUSE-STAMPING INCIDENT, NAMED BY ITS OWN CLOCK (2026-09-04, 16:30:08Z and 16:33:59Z). The sweep producers began stamping a typed cause on rows that had recorded none, the retirement above compared a recorded null against it, and one drive turned thirty-two drafted rows into their own briefs. The predicate is fixed, so a first-named cause never retires anything again; these rows are the ones it already retired. Bounded to the minutes the faulty code was serving, because AFTER that fix the same sentence means a recorded cause was REPLACED by a different one, which is a real change and whose copy really is stale. A window is what makes this a recovery rather than a standing rule: it can fire on no row minted before or after, and it goes quiet on its own. */
const INCIDENT_FROM = "2026-09-04T16:30:00.000Z", INCIDENT_TO = "2026-09-04T16:35:00.000Z";
const RECOVERED = "a cause named for the first time was not a change, so the words this row already carried came back and the brief that displaced them stood down";
/** THE WORDS THAT INCIDENT RETIRED, PUT BACK ON THE ROW THAT CARRIES THEM, before anything below compares a thing. `identityMoves` names EVERY dimension of `copyIdentity`, so a receipt saying ONLY the cause moved is the proof that the page, the search, the family and the slot all still matched: the copy was never stale, only displaced. Restoring it here rather than in a lane of its own is the whole point, because the rules below are then the ones that decide it: identity must still match, a competing finished draft still wins, the banked-provenance rule still refuses copy whose claims name evidence nobody kept, and the row re-enters review and earns Ready only through the doors every other row uses. REFUSED, in the row's own typed terms: a whole page (four written fields cannot be rebuilt from one string), a retirement of the row's own brief, words that are not a finished deliverable under today's rules, and a claim naming an id no banked fact carries. ONE RECEIPT PER TRANSITION: the brief that was standing in the copy's place takes the retired slot, so the row still says what it gave up, the settle rule never reads the restored words as a writer handing back what it retired, and a second pass finds no incident receipt and recovers nothing. The attempt that retirement charged is given back, because no draft was ever written for it. */
function unretire(p: ChangeProposal | null | undefined): ChangeProposal | null | undefined {
  const was = p?.previousCopy, c = p?.recommendedChange, banked = new Set((p?.supportFacts ?? []).map((f) => f.id));
  if (!p || !was || c?.kind !== "existing_edit" || was.retiredBecause !== CAUSE_STAMPED || was.at < INCIDENT_FROM || was.at >= INCIDENT_TO || !(p.researchOnly === true || deliverableGaps(p).length > 0)) return p; /* ONLY ONTO A ROW STILL UNWRITTEN (reviewer, 2026-09-04): a later pass drafted paid copy onto the Achaemenid description before this landed, and putting the older line back over it would have been the incident's own move under a receipt that said the opposite */
  const words = was.after.trim(), brief = (p.research?.missing ?? "").trim() || c.after.trim();
  if (!words || words === brief || (p.claims ?? []).some((x) => x.supportedBy.some((id) => !banked.has(id)))) return p;
  const { research: _brief, redraftRequested: _asked, ...rest } = p;
  const back: ChangeProposal = { ...rest, recommendedChange: { ...c, after: words }, researchOnly: false, status: "needs_review",
    faults: [], limitations: p.limitations.filter((l) => !GATE_WORDS.test(l)), obligation: undefined,
    previousCopy: { after: brief, retiredBecause: RECOVERED, at: was.at, attempts: Math.max(0, (was.attempts ?? 1) - 1) } };
  return deliverableGaps(back).length === 0 ? back : p;
}

/** THE PAID READING RIDES ITS OWN WORDS, whichever branch below decided the row. `semanticReview.of` IS the copy
 *  key it was taken over and `unreviewed` accepts a reading only while it still matches the row it sits on, so
 *  carrying one onto a row with that exact key can never authorize words nobody read. Guarding this at the CALLER
 *  was wrong and the gate caught it: a prior whose own copy is unfinished returns early from the branches below,
 *  so a matching key at the call site never proved the reading would survive the merge. */
export function preferFinished(incoming: ChangeProposal, prior: ChangeProposal | null | undefined): ChangeProposal {
  const row0 = decideFinished(incoming, prior);
  const row = !row0.semanticReview && prior?.semanticReview && prior.semanticReview.of === copyKey(row0)
    ? { ...row0, semanticReview: prior.semanticReview } : row0;
  // THE SAME WORDS BACK AGAIN ARE NOT A SECOND ATTEMPT, THEY ARE THE ANSWER (operator, 2026-09-02): a writer handing
  // back copy this row already retired has said everything it has to say, so the row settles rather than cycling.
  const again = row.recommendedChange.kind === "existing_edit" && !!row.previousCopy
    && row.recommendedChange.after.trim() === row.previousCopy.after.trim();
  return again ? { ...row, obligation: { kind: "terminal", reason: "the writer handed back the exact words this change already retired, so it is settled rather than drafted again" } } : row;
}

function decideFinished(incoming0: ChangeProposal, prior00: ChangeProposal | null | undefined): ChangeProposal {
  const prior0 = unretire(prior00); // THE INCIDENT IS UNDONE BEFORE ANYTHING IS COMPARED, so every rule below judges the row as it stood before a first-named cause displaced its words
  // A PRODUCER THAT READ NOTHING CANNOT CLAIM THE PAGE MOVED (operator, 2026-08-31). The re-mint of a $0 card
  // arrives with no copyStamp, the finished prior carries the page as the drafting pass read it, and comparing
  // null against that stamp broke identity: the template then replaced the finished description whole, copy to
  // a receipt, backing and status gone. A stampless incoming inherits the prior's stamp; a producer that DID
  // re-read the page and saw it change still breaks identity exactly as before, which is the honest trigger.
  const stamped0 = incoming0.copyStamp == null && prior0?.copyStamp ? { ...incoming0, copyStamp: prior0.copyStamp } : incoming0;
  // A CAUSE NAMED FOR THE FIRST TIME IS NOT A CAUSE THAT CHANGED, AND A CAUSE NOBODY NAMED THIS PASS IS NOT A CAUSE UNNAMED (live 16:31Z on 2026-09-04, both directions from the reviewer, 2026-09-04). The sweep producers began stamping the typed cause they had always known, the retirement below compared a recorded null against it, and one tick retired thirty-one drafted rows into their own briefs with "the diagnosed cause changed" as the receipt. The first repair covered null-to-named ONLY, which left the identical destruction available in reverse and made it LARGER than before: the demand-recovery producer mints causeless whenever the results page for its unit is not on file, and nine open rows now hold both finished copy and a cause. Silence is not a finding on either side, so the pair is reconciled once, here, before identity is compared; two DIFFERENT recorded causes still move identity exactly as before.
  const incoming = stamped0.diagnosisCause == null && prior0?.diagnosisCause != null ? { ...stamped0, diagnosisCause: prior0.diagnosisCause, ...(prior0.causeFinding ? { causeFinding: prior0.causeFinding } : {}) } : stamped0;
  const prior = prior0 && prior0.diagnosisCause == null && incoming.diagnosisCause != null ? { ...prior0, diagnosisCause: incoming.diagnosisCause, ...(incoming.causeFinding ? { causeFinding: incoming.causeFinding } : {}) } : prior0, sameWork = !!prior && copyIdentity(prior) === copyIdentity(incoming); // A SETTLED VERDICT IS SETTLED WORK, AND A ROW WITH NO COPY KEEPS ONE EXACTLY AS A ROW WITH WORDS DOES (live, 2026-09-05). `obligation` rides the banked copy below, so only a row holding words could keep a terminal verdict; the two demand-recovery rows hold none, took no kept path, and had their settlement recomputed from nothing by every re-mint. The walk's pass stamps "no substantive gap named" (decision/drafted-copy) and the $0 republish mints no obligation at all, so the row flapped terminal to draft and back on alternate passes, writing a version each time, and one stored settlement was turning into a PAID reading. The verdict rides here on the same identity the copy does, and a pass that moves that identity still arrives with no obligation and the ladder decides again from nothing; a person who asked for better words (`redraftRequested`) outranks it, exactly as they outrank the preservation rule below.
  // THE RECEIPT OUTLIVES THE PASS THAT STAMPED IT (review, 2026-08-22): every return carries the newest retirement receipt available, so the retired words stay inspectable under whatever replaced them instead of living exactly one pass. A NEW receipt below outranks an inherited one.
  const inherited = prior?.previousCopy && !incoming.previousCopy ? { previousCopy: prior.previousCopy, ...((prior.faults ?? []).includes(prior.previousCopy.retiredBecause) ? { faults: [...new Set([...(incoming.faults ?? []), prior.previousCopy.retiredBecause])] } : {}) } : {}; // AND THE SENTENCE THAT RETIRED THE WORDS RIDES WITH THE RECEIPT (RV8 residual 1, 2026-09-05): a producer re-mints a research row every pass carrying no faults, so a refusal the drafting pass had just stamped survived exactly one pass and the row went back to owing a first draft. Only the retirement's OWN reason is carried, and only while the prior stands behind it as a typed fault, so an identity move or a stale-rules re-read carries nothing; the incoming row's own faults are kept beside it.
  const priorAfter = prior?.recommendedChange.kind === "existing_edit" ? prior.recommendedChange.after.trim() : "", settledStep = sameWork && prior!.obligation?.kind === "terminal" && !incoming.obligation && !prior!.redraftRequested ? { obligation: prior!.obligation } : {};
  if (!prior || !sameWork) {
    // FINISHED COPY IS NEVER LOST WITHOUT A RECEIPT, whether the replacement is a brief OR different finished
    // words: a finished prior whose words do not survive into the incoming row stamps the retirement receipt.
    const incomingAfter = incoming.recommendedChange.kind === "existing_edit" ? incoming.recommendedChange.after.trim() : "";
    if (prior && deliverableGaps(prior).length === 0 && priorAfter && priorAfter !== incomingAfter) {
      return { ...incoming, previousCopy: { after: priorAfter, attempts: (prior.previousCopy?.attempts ?? 0) + 1, // A REDRAFT OWNS ITS ATTEMPTS: nothing on the row counted them, so a row could cycle through the same gates for ever and every pass read it as a first try.
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
  if (!settled && !reviewedPrior && ((incoming.researchOnly !== true && deliverableGaps(incoming).length === 0) || deliverableGaps(prior).length > 0)) return { ...incoming, ...inherited, ...settledStep };
  // COPY NOBODY CAN TRACE IS NOT FINISHED WORK. An atomic card's words are written by the editor, which hands back every claim beside the evidence ids carrying it, and this branch banked the words and dropped the claims: all three ready cards on the live account carried `claims: null` and no persisted mapping from a sentence to the thing behind it, so nothing on the row could ever be re-checked. Banked words survive only WITH their provenance now, and copy that reached the row before this did is redrafted once rather than served on for ever as an unsupported claim. A bundle answers on its receipt instead and is left alone.
  if (!prior.bundle && (prior.claims ?? []).length === 0) { // A BRIEF NEVER SILENTLY DISPLACES FINISHED WORDS (operator, 2026-09-02): a finished description was replaced by its own re-minted brief with no receipt. Claimless copy is held, words kept, for the reading that rebuilds its record; only a competing finished draft may take its place. THE HOLD IS NOT A FAULT ABOUT THE WORDS (incident, 2026-09-04): written as one, it sent twenty five recovered descriptions to a paid rewrite. `openHold` mints it from structure on every read, so the words keep their display caveat and the obligation ladder files a reading.
    return incoming.researchOnly === true ? { ...prior, ...inherited, status: "needs_review", faults: [...new Set([...(prior.faults ?? []), NO_RECORD])], limitations: [...new Set([...prior.limitations, NO_RECORD])] } : { ...incoming, ...inherited, ...settledStep }; } // AND A ROW IN REVIEW IS FINISHED WORK TOO (incident recovery, 2026-09-04): the hold was written for `ready` alone, so a claimless description sitting in review was displaced by its own re-minted brief with no receipt at all, which is the very loss this rule is named for and the one that would have undone the recovery above on the pass after it landed
  // AND A CLAIM POINTING AT AN ID NOBODY BANKED THE WORDS FOR IS NOT PROVENANCE EITHER. The ids resolve inside the pass that drafted the copy and nowhere else, so banked words survive only while every id their claims name has its exact quoted fact banked beside them. Copy banked before the pairs existed is redrafted once, exactly as copy banked before the claims existed was.
  const banked = new Set((prior.supportFacts ?? []).map((f) => f.id));
  if (!prior.bundle && (prior.claims ?? []).some((c) => c.supportedBy.some((id) => !banked.has(id)))) return { ...incoming, ...inherited, ...settledStep };
  // The words, where they land, what they cost, what was said about them AND what each claim stands on stay as banked; THIS pass's evidence, ranking and receipt still land on the row, so the card keeps arguing from what is true today.
  // EVERY COPY-OWNED FIELD RIDES WITH THE COPY, off ONE named list rather than a hand-copied spread that drifts: the hand list carried limitations and dropped `faults`, so the one path that KEEPS a defective row's words silently lost Beacon's own typed statement of the defect and the lane fell back to guessing owners from sentence shape. The operator's yes (`approval`) travels with `confirmedVersion` for the same reason: they are one fact. A pass that changes the work fails the identity above and `incoming` wins whole, faults and all.
  const kept: ChangeProposal = { ...incoming, ...inherited, recommendedChange: prior.recommendedChange, researchOnly: false, research: undefined, status: prior.status, // AND A ROW WHOSE WORDS ARE FINISHED CARRIES NO BRIEF (incident recovery, 2026-09-04): the incoming re-mint's assignment rode onto the preserved copy, so a row holding a deliverable still had an instruction to write it stored beside the words
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
  // AND THE IDENTITY RIDES THE WORDS IT KEEPS (RV9 residual 3, 2026-09-05). This path keeps the prior's copy AND the prior's support and then took the incoming's `workKey` whole, so a $0 re-mint carrying no support facts stamped a key naming none onto a row holding two: the pre-1979 flag answer went from `...::draft::r5:sc2::fact-1,page-copy-1` at v192 to `...::draft::r5:sc2::` at v193 while its words, its claim and its paid reading never moved. Measured over the store the same hour: of the 72 rows whose key carries the current shape, 33 name FEWER facts than the row holds and NOT ONE names a fact the row does not, so the disagreement is one-directional and is this. ONLY the support segment moves, and only on a key of the current shape (the segment before it is the rules version), so the writer contract, the basis, the evidence hash, the treatment and the owed step still move the identity exactly as they did, a contract bump still reopens the work, and a key minted under an older shape is never rewritten.
  const seg = (kept.workKey ?? "").split("::"), ids = (kept.supportFacts ?? []).map((f) => f.id).sort().join(",");
  return seg.length > 1 && /^r\d/.test(seg[seg.length - 2] ?? "") && seg[seg.length - 1] !== ids ? { ...kept, workKey: [...seg.slice(0, -1), ids].join("::") } : kept;
}
/** THE FIELDS THAT BELONG TO THE BANKED COPY and must survive with it. `redraftRequested` is deliberately ABSENT: a person who asked for better words outranks preservation, and that path returns before this list is read. The day someone adds a copy-owned field to the contract and forgets it here, the typed faults lesson repeats; keep this list beside the contract change in the same commit. THAT DAY WAS 2026-09-02 AND `assignment` WAS THE FIELD: measured on the production store, 0 of the 451 stored rows on the ONE account that table holds carried an assignment, at any status. The drafting door computes one typed assignment per row and stores it, and the next $0 re-mint of the same identity takes this path, keeps the prior's copy and lets the re-mint's absent assignment ride, so a row banked under the missing-answer standard was served, judged and re-read as a restructuring within one pass. It belongs here for the same reason `faults` does: it is Beacon's own typed statement about these exact words. Being on the list also makes the 2026-09-04 rule true rather than asserted, because the `else` arm DELETES an incoming brief wherever the preserved copy carries none of its own. */
const COPY_OWNED = ["claims", "supportFacts", "operatorSteps", "bundle", "confirmedVersion", "approval", "faults", "modeledOn", "informationGain", "preservation", "draftNotes", "obligation", "assignment"] as const satisfies readonly (keyof ChangeProposal)[]; // `obligation` rides the banked words so a SETTLED verdict survives every later pass that reaches this row under the same identity; a pass that genuinely moves the identity wins whole and the ladder decides again from nothing

/** THE EXACT VERSION OF A CHANGE AN OPERATOR CAN SAY YES TO, and the ONE definition of it: the screen folds this and the server recomputes it byte for byte off the row it re-reads, so no second reading of "the same version" can exist. A confirmation is worthless unless it names WHAT was confirmed, and this used to name a third of it: the copy it replaces, where the copy lands, what survives a page move, the risks, the caveats, the steps, the reasons pages were left alone, every claim, the words behind every claim, the readings on the receipt and the days they were taken all moved without moving the version. It is now EVERYTHING MATERIAL THE OPERATOR READ. Any edit to any of it mints a different string, the stored stamp stops matching, and the stale confirmation refuses. UNORDERED SETS ARE SORTED, so re-listing the same caveats, support ids, readings or verdicts is not a rewrite; the ranking, the timestamps and the measurement figures are excluded because none of them is the change. SHORT and PURE: it folds through the same tiny fingerprint a bundle's pieces are already named by, so a server component can hand it to a browser. */
export function confirmedVersion(p: ChangeProposal): string {
  const c = p.recommendedChange, b = p.bundle, f = p.causeFinding;
  const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  // THE CONFIRMATION STILL PINS THE BASIS AND EVERY RENDERED SENTENCE: copy PRESERVATION dropped them from its
  // own identity (a reworded producer must not destroy finished words), but an operator's yes was given to one
  // account truth and one exact screen, so those stay part of THIS stamp explicitly.
  const material = [p.basis ?? null, p.riskLevel, copyIdentity(p), p.diagnosisCause ?? null, sorted(p.limitations.filter((l) => !OWED_NOTE.test(l))), p.operatorSteps ?? [],
    c.kind === "existing_edit" ? [c.field, c.before, c.after, c.where ?? null] : [c.proposedTitle, c.metaDescription, c.openingAnswer, c.outline, c.faqQuestions, c.schemaTypes],
    (p.claims ?? []).map((x) => [x.text, [...x.supportedBy].sort()]), sorted((p.supportFacts ?? []).map((x) => [x.id, x.fact])), p.informationGain ?? null, p.preservation ?? null,
    f ? [f.cause, f.explanation, f.falsifier, sorted(f.competingExplanations.map((x) => [x.cause, x.reason])), sorted(f.notConsidered.map((x) => [x.cause, x.missing]))] : null,
    b ? [b.objective, b.metric, b.measurementPlan, sorted(b.risks), sorted(b.receipt.missing), sorted(b.confidenceReasons), sorted(b.alternatives.map((x) => [x.option, x.reason])),
      b.components.map((x, i) => [componentIdOf(x, i), x.page ?? null, x.where ?? null, x.before, x.risk, x.redirectTo ?? null, x.objective ?? null, x.mechanism ?? null, x.anchorAfter ?? null, x.preserves ?? null, x.sourcePack ?? null, sorted(x.evidenceKeys)]),
      sorted((b.dispositions ?? []).map((d) => [d.page, d.verdict, d.because])),
      sorted(b.receipt.items.map((i) => [i.key, i.kind, i.fact, i.observedAt, i.observationId ?? null, [...(i.observationIds ?? [])].sort()]))] : null];
  return componentIdOf({ kind: "confirmation", after: JSON.stringify(material) }, 0);
}
