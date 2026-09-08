import { AEO_BAR } from "./accept-worthy";
/** decision/completeness: THE ONE CHECK THAT ASKS WHETHER BEACON HAS FINISHED THE WORK. A customer-facing Change states exactly what to add, replace, delete, move, link, redirect or create, exactly where, and the FINAL COPY wherever copy is involved. IMPERFECT WORK STAYS VISIBLE (operator, 2026-08-15): anything short of that is a genuine opportunity still being developed, and it is RANKED and SHOWN, on the ranked queue and on Today, as a research card carrying what is known, what is still missing and what happens next. What this boundary decides is never whether the operator sees a row, only which of the three lanes it lands in, that it carries no copy to paste and no control that records it done, and that the server refuses to put it into measurement or mark it implemented until the deliverable is actually finished. PURE and derived from the deliverable ITSELF, never from the prose around it, so the queue, the card (a client component) and the server mutation all ask one question and a voice edit moves none of them. It sits beside the contract rather than inside the validator because a client bundle may reach this and may not reach that. */

import { componentIdOf, dangerousComponents } from "./contracts";
import { copyKey } from "./proof";
import { domainOf } from "@/domains/evidence/relevance-gate";
import type { ChangeProposal } from "./contracts";
import { evidenceShortfall } from "./proof";
import { withholdReason } from "./authorization";
import { checkFactualEntailment } from "./drafts/factual-entailment";

/** NO VERB LIST LIVES HERE ANY MORE. Whether copy is the finished words or a note about producing them is a question about meaning, and it was answered by spelling: a production verb near a deliverable noun. It is now answered where it is known. A PRODUCER handing over a brief says so in a typed field (`researchOnly`) as it mints the card. THE EDITOR's copy is read by decision/drafted-copy's editor contract, against the stored page and then by a judge. Only what stays deterministic for any writer is left below. */
/** A blank somebody is expected to fill in before the copy is usable, or MARKUP WHERE A WORD BELONGS: a title reading "Colors &amp; History" is not final copy, because what an operator pastes is not what a reader sees. */
const BLANK_TO_FILL = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b|&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/;
/** Copy that says out loud that the work has not been done. */
const OWED_NOTE = /^The exact .* lands on the next pass/; /* the drafter's "lands on the next pass" note: display, never identity, never a hold */
const SAYS_UNFINISHED = /\b(?:not been (?:drafted|read|written)|is not settled|not on this card|still owed|nothing here is|in your own words|write (?:this|it|these|them) yourself|fill (?:this|it|these) in)\b/i; /* AND AN INSTRUCTION TO WRITE IT YOURSELF (owner's editorial policy, 2026-09-06): copy that tells the operator to write the words is not the words. */

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
  if (c.field === "schema") {
    const json = c.after.replace(/^\s*<script[^>]*>/i, "").replace(/<\/script>\s*$/i, "").trim();
    if (!json) gaps.push("it carries no structured data");
    else try { JSON.parse(json); } catch { gaps.push("its structured data is not valid JSON, so no search engine could read it"); }
    return [...new Set(gaps)];
  }
  if (noCopy(c.after)) gaps.push("it carries no copy");
  else if (notFinal(c.after)) gaps.push("it describes the work instead of being it");
  else if (glued(c.after)) gaps.push("its label runs straight into the words after it, so it would paste as one glued phrase");
  else if (typeof c.before === "string" && c.before.trim() !== "" && flat(c.after) === flat(c.before)) gaps.push("it changes nothing: the new words are the words the page already carries");
  const placed = (t: string | null | undefined): boolean => !!t && t.trim().length >= 12 && !notFinal(t);
  const parts = p.bundle?.components ?? [];
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
const SILENT_SOURCE = /https?:\/\/[^\s"';]+\s+says:?\s+""/g; /** A SOURCE THAT QUOTED NOTHING, in the string this codebase composes for a banked fact itself (`<address> says "<quotation>"`), read only on a row banked before the typed addresses existed. HOW MANY PUBLISHERS STAND BEHIND WHAT THIS COPY CLAIMS, counted by HOST at the ONE place the verdict and the finished card both read, so the number a customer is shown and the number the caveat names can never disagree. TYPED PROVENANCE FIRST (measured, 2026-09-05): the count pulled hostnames out of the banked fact's own prose, so the pre-1979 flag card read "Backed by 2 checked sources" off ONE reading whose bank row says `single_source` and whose first address quoted nothing at all, and 437 of the bank's 1,293 sources carry an empty quotation. A fact banked with its own addresses answers from them; a fact banked before they existed is read from its text with a source that says nothing dropped, which is the same rule applied to the only record that row has. */
/** THE TEN THINGS THE OPERATOR JUDGES FOR THEMSELVES, in their own words (owner's editorial policy, 2026-09-06). A
 *  change is ready for consideration when the deliverable is complete, its target and placement are usable, it is a
 *  reasonable explainable improvement or experiment, its observations and important uncertainties are inspectable, and
 *  it can be applied without finishing Beacon's own writing or research assignment. Ready never meant guaranteed
 *  traffic, a proven cause of a ranking problem, the best possible wording, every sentence independently corroborated,
 *  a new factual discovery, a model's unanimous preference or any word, sentence or style count. So each condition
 *  below stops HIDING complete work: it rides the card as a caveat and carries a weight the ranking can read.
 *  MATCHED AGAINST THE LIVE OUTPUT OF THE DOORS THAT COMPOSE THESE SENTENCES, exactly as `deliverableGaps`'s own gaps
 *  are matched by the ladder: one place writes a sentence, one place reads it, and no stored phrasing decides anything.
 *  NARROW BY CONSTRUCTION: a sentence that matches nothing here is a DEFECT, so the eight kinds Beacon must fix (an
 *  incomplete deliverable or a placeholder, an unusable or nonexistent placement, a fabricated citation, a claim a
 *  checked source contradicts, a destructive or safety-flagged edit, an empty no-op, narration that describes the page
 *  instead of answering the reader, and a fault in the copy's binding to its version) are the default and stay held. */
type Advisory = { kind: string; say: string; weight: number };
const ADVISORY: readonly (Advisory & { re: RegExp })[] = [
  { kind: "conservative_wording", re: /template siblings|sibling page with the subject swapped in|ranking or register judgement/i,
    say: "Conservative wording: it stays close to what the pages built on the same template already say. Paste it, or sharpen the one line that is yours.", weight: 0.6 },
  { kind: "matches_search", re: /repeats the search instead of improving the page/i,
    say: "The wording matches the search this page is shown for, which reads plainly and wins no points for style. Paste it, or ask for a warmer line.", weight: 0.7 },
  { kind: "repeats_supported", re: /rearranges the page into one more paragraph|what a reader gains|only part of this page|belongs to a different reading|naming no evidence and no reorganized material/i,
    say: "It puts material the page already carries in a better order rather than adding a fact. Paste it if the page reads better for it.", weight: 0.5 },
  { kind: "single_source", re: /rests on nothing checked|none of its own sources carry|held until (?:a|one) source is on file|held until one is on file/i,
    say: "One credible source stands behind this. Add a second before publishing if being wrong here would cost you.", weight: 0.5 },
  { kind: "competitor_pattern", re: /a page that competes with this one|stands on a rival page/i,
    say: "Modeled on the pages that win this search, which is a reason to try it and never proof it caused their result. The 28 day reading says whether it worked.", weight: 0.4 },
  { kind: "benefit_uncertain", re: /demand evidence alone|clicks a wording change has never been shown to recover|no longer clears it, so it stays held/i,
    say: "The gain here is not proven: demand says the page matters, not that these words beat the current ones. The 28 day reading says whether it worked.", weight: 0.4 },
  { kind: "role_uncertain", re: /held: this page's own evidence names|works on something other than .* this page's own evidence names|get no words from this change/i,
    say: "Its exact part in this page's wider problem is not settled, so treat it as one step rather than the whole fix.", weight: 0.4 },
  /* THE STORED SPELLINGS OF THE HOLDS THIS POLICY DELETED ARE READ HERE TOO (journey review, 2026-09-06): a row the old doors demoted wears their sentence in `faults` and `limitations`, and a sentence this table did not know was a defect that owed a paid corrective draft for a condition the owner now judges. */
  { kind: "reading_dated", re: /is offered here as what this page says today|readings behind this change are too old/i,
    say: "The readings behind this carry an older date than today. Check the page still reads that way before you paste.", weight: 0.5 },
];
/** The one partition, asked of one sentence. */
const advisoryOf = (why: string): Advisory | null => { const a = ADVISORY.find((x) => x.re.test(why)); return a ? { kind: a.kind, say: a.say, weight: a.weight } : null; };

export function citedPublishers(p: ChangeProposal): Set<string> { const cited = new Set((p.claims ?? []).flatMap((x) => x.supportedBy.filter((id) => id.startsWith("fact-")))); return new Set((p.supportFacts ?? []).filter((f) => cited.has(f.id)).flatMap((f) => f.sources ? f.sources.map((x) => x.url) : (f.fact.replace(SILENT_SOURCE, " ").match(/https?:\/\/[^\s"';]+/g) ?? [])).map((u) => domainOf(u)).filter(Boolean)); }
/** THE ONE READINESS VERDICT, AND WHO MAY ANSWER EACH HALF OF IT. `defects` are the eight kinds Beacon owes before it hands work over and they are the whole of what holds a row: an incomplete deliverable or a placeholder, an unusable or nonexistent placement, a fabricated citation or one off the receipt, a claim a checked source contradicts, a destructive or safety-flagged edit, an empty no-op, narration that describes the page instead of answering the reader, and a fault in the copy's binding to its version. `advisories` are the ten kinds the operator judges for themselves, each typed with the sentence they read and a weight the ranking can take. IMPERFECT WORK STAYS VISIBLE (operator, 2026-08-15) AND COMPLETE WORK STAYS OFFERED (owner, 2026-09-06): a gate decides which lane an opportunity is shown in and which controls its card carries, never whether the operator sees it, and an editorial judgement decides what the card SAYS, never whether the work is handed over. `lane` is `research` while nothing exact is written and `review` once the exact copy exists; `why` is every defect said back where the work is read; `caveats` is what the person keeps in mind; `blocking` is the first hard defect, the fast read for a card, never the sole gate: the row itself is re-asked at the one door that can write `ready` (proposal-store's answerReviewedProposal). `found` is what a caller who holds the page and the words already read (the banked-copy re-read, the canon, the actionable failures), put through THIS partition so no door keeps a refusal chain of its own. PURE, so the queue, the card, the ladder and the server action ask ONE question and no screen can offer a control the server refuses. */
export function openHold(p: ChangeProposal, also: { found?: readonly string[] } = {}): { lane: "review" | "research"; why: string[]; caveats: string[]; blocking: string | null; faulted: boolean; safetyHold: boolean; defects: string[]; advisories: Advisory[] } {
  const stands = (p.claims ?? []).length > 0 && (p.supportFacts ?? []).length > 0; /* AND A ROW WHOSE RECORD STANDS MAY NOT CARRY THE SENTENCE THAT SAYS IT HAS NONE (measured, 2026-09-05: eighteen current rows wear it, seventeen of them truthfully with no claim and no support fact, and one carries a claim and three support facts and is held for a record it holds). The sentence is written where a brief would have displaced finished words, and only a paid reading retired it, so a row whose own record answers it stayed held for a reason its own payload disproves. Asked of the row, at no cost, on every pass that reads it. */ const lims = p.limitations.filter((l) => !OWED_NOTE.test(l) && !(stands && l === NO_RECORD)); /* THE OWED NOTE IS NEVER A HOLD (reviewer, 2026-09-04): "no action needed from you until it does" read as a hard limitation, minted a redraft whose instruction was the note itself, and the obligation flipped every pass with the note */
  const gaps = deliverableGaps(p), c = p.recommendedChange, faults = (p.faults ?? lims.filter((l) => GATE_WORDS.test(l))).filter((f) => !(stands && f === NO_RECORD));
  const bodyDefects = AEO_BAR.rowFailures(p), heading = (p.copyStamp ?? "").split("|").slice(0, 2).join(" ").trim() || p.pageLabel;
  if (c.kind === "existing_edit" && c.field === "meta") {
    bodyDefects.push(...AEO_BAR.emptyMeta(c.after, heading));
    if (AEO_BAR.applies("answer_block", p.assignment?.standard, false, undefined, p) && !(p.bundle?.components ?? []).some((part) => /^(opening_answer|section|section_add|section_rewrite|restructure)$/.test(part.kind) && part.after.trim())) bodyDefects.push(AEO_BAR.holds.lead);
  }
  for (const part of p.bundle?.components ?? []) if (part.kind === "meta") bodyDefects.push(...AEO_BAR.emptyMeta(part.after, heading));
  const hard = [...bodyDefects, ...gaps, ...lims.filter((l) => HARD_LIMITATION.test(l))];
  const anchor = c.kind === "existing_edit" && (c.field === "section" || c.field === "answer_block")
    ? /placed after (?:the heading )?"([^"]+)"/.exec(c.where ?? "")?.[1]?.trim().toLowerCase() ?? null : null;
  const placedOn = (t: string): boolean => t.toLowerCase().includes(anchor!.slice(0, 60));
  if (anchor && !(p.supportFacts ?? []).some((f) => placedOn(f.fact)) && !placedOn(p.copyStamp ?? "")) hard.push(MISPLACED);
  const short = evidenceShortfall(p); if (short) hard.push(short);
  const unfit = withholdReason(p, p.causeFinding?.cause ?? p.diagnosisCause); if (unfit) hard.push(unfit);
  if (dangerousComponents(p.bundle?.components ?? []).length > 0 && p.confirmedVersion !== confirmedVersion(p)) hard.push(DANGER);
  const every = [...new Set([...hard, ...faults, ...also.found ?? []])], said = every.filter((x) => !every.some((y) => y !== x && y.endsWith(x))); // ONE COMPLAINT IS SAID ONCE (measured, 2026-09-05): a refusal is composed with a gate opener at one door and written raw at another, both land in `faults`, and the Set kept both because the strings differ, so the account's most watched card told a reader the same thing twice. The composed form ends with the raw sentence it wraps, so the wrapped one is dropped and nothing a fuller sentence does not already say is lost. WHAT A CALLER ALREADY READ COMES IN THE SAME DOOR: the banked-copy re-read and the canon hold the page and the words, this verdict does not, and putting their findings through the ONE partition is what makes the store, the sweep, the loader and the ladder agree by construction instead of each chaining its own refusals.
  const advisories: Advisory[] = [], heldBy: string[] = [];
  for (const x of said) { const a = x === DANGER ? null : advisoryOf(x); if (!a) { heldBy.push(x); continue; } if (!advisories.some((y) => y.kind === a.kind)) advisories.push(a); }
  if ((p.causeFinding?.cause ?? p.diagnosisCause) === "cannibalization" && /\d[\d,.]*\s*clicks short/i.test(p.whyItMatters ?? "") && !advisories.some((a) => a.kind === "benefit_uncertain")) advisories.push({ kind: "benefit_uncertain", say: "A modeled click gap says what these positions usually earn, never what this wording recovers. The 28 day reading says whether it worked.", weight: 0.4 }); // THE CLICKS PROMISE IS SAID, NOT HELD: this used to hold the row until the ownership work behind it was finished, which hid a finished line for a promise nobody had made on its behalf.
  const cited = new Set((p.claims ?? []).flatMap((x) => x.supportedBy.filter((id) => id.startsWith("fact-")))), publishers = cited.size > 0 ? citedPublishers(p).size : 0; // HOW MANY PUBLISHERS STAND BEHIND WHAT THIS COPY CLAIMS, counted by HOST at the ONE place the card and this verdict both read. It used to be a BAR: two publishers for a replacement or a consensus claim, one otherwise, and short of it the row was held and a reading was bought. One credible source is enough for the operator to judge, so the count is said instead.
  if (cited.size > 0 && publishers < 2 && !advisories.some((a) => a.kind === "single_source")) advisories.push({ kind: "single_source", say: publishers === 1 ? "Backed by 1 checked source. Add a second before publishing if being wrong here would cost you." : "Backed by a reading that names no publisher. Read the source before publishing if being wrong here would cost you.", weight: 0.5 });
  const dated = (p.bundle?.receipt.items ?? []).map((i) => (i.observedAt ?? "").slice(0, 10)).filter(Boolean).sort().at(-1); // THE DATE THE READINGS CARRY, SAID RATHER THAN HELD: a reading older than a freshness window used to take the whole change out of the queue, which is the policy buying nothing and hiding finished work. The card names the day instead.
  if (dated && dated < new Date(Date.parse(p.createdAt) || Date.now()).toISOString().slice(0, 10) && !advisories.some((a) => a.kind === "reading_dated")) advisories.push({ kind: "reading_dated", say: `Backed by readings last taken on ${dated}. Check the page still reads that way before you paste.`, weight: 0.5 });
  const defects = heldBy.filter((x) => x !== DANGER), blocking = hard.find((h) => heldBy.includes(h)) ?? null;
  return { lane: p.researchOnly === true || gaps.some((g) => NOT_WRITTEN.test(g)) ? "research" : "review",
    // EVERYTHING BEACON KNOWS ABOUT WHY THIS IS HELD, not the first kind of reason it happens to find: a row with a safety hold AND a copy fault used to print only the hold, so the defect stayed invisible.
    // AND WHAT IS LEFT FOR THE OPERATOR TO KEEP IN MIND, DECIDED HERE AND NOWHERE ELSE. A caveat is what a person should bear in mind about finished words; a sentence one of Beacon's own gates wrote is a defect Beacon owns, named above or answered by the typed fault and the obligation. The ten advisory kinds ride here in the operator's own words, so a condition that used to hide the work now reaches the card as a caveat and a ranking weight, and no screen can invent a second vocabulary for either half.
    why: heldBy.length > 0 ? heldBy : [UNJUDGED], caveats: [...advisories.map((a) => a.say), ...AEO_BAR.writerLimitations(p.limitations).filter((l) => !GATE_WORDS.test(l) && !said.includes(l))], blocking, faulted: defects.length > 0, safetyHold: blocking === DANGER, defects, advisories };
}

/** WHY THIS CHANGE MAY NOT BE HANDED OVER AS READY, or null when it may: the first hard defect of the ONE verdict above, which is what every caller of this name already asked it for. It used to be a second refusal chain of its own (a split settled on only some of its pages, a lever that misses the diagnosed cause), and both of those are advisories now, so the name survives as the kernel's one-word reader of the verdict rather than as a second vocabulary beside it. The SAFETY confirmation answers to the operator and is never returned here. */
export const unsettledCause = (p: ChangeProposal): string | null => openHold(p).defects[0] ?? null; // the FIRST DEFECT of the one verdict, typed faults and receipt findings included (journey review, 2026-09-06): `blocking` is drawn from the hard arms alone, so a screen reading it offered an approve press on a row the store then refused for its typed fault

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

const CAUSE_STAMPED = "the diagnosed cause changed";
const INCIDENT_FROM = "2026-09-04T16:30:00.000Z", INCIDENT_TO = "2026-09-04T16:35:00.000Z";
const RECOVERED = "a cause named for the first time was not a change, so the words this row already carried came back and the brief that displaced them stood down";
function unretire(p: ChangeProposal | null | undefined): ChangeProposal | null | undefined {
  const was = p?.previousCopy, c = p?.recommendedChange, supportFacts = p?.supportFacts ?? [], banked = new Set(supportFacts.map((f) => f.id));
  if (!p || !was || c?.kind !== "existing_edit" || !(p.researchOnly === true || deliverableGaps(p).length > 0)) return p; /* ONLY ONTO A ROW STILL UNWRITTEN (reviewer, 2026-09-04): a later pass drafted paid copy onto the Achaemenid description before this landed, and putting the older line back over it would have been the incident's own move under a receipt that said the opposite */
  const words = was.after.trim(), brief = (p.research?.missing ?? "").trim() || c.after.trim();
  if (!words || words === brief || (p.claims ?? []).some((x) => x.supportedBy.some((id) => !banked.has(id)))) return p;
  const { research: _brief, redraftRequested: _asked, ...rest } = p;
  const back = (retiredBecause: string, faults: string[]): ChangeProposal => ({ ...rest, recommendedChange: { ...c, after: words }, researchOnly: false, status: "needs_review", faults, limitations: p.limitations.filter((l) => !GATE_WORDS.test(l)), obligation: undefined, previousCopy: { after: brief, retiredBecause, at: was.at, attempts: Math.max(0, (was.attempts ?? 1) - 1) } });
  if (was.retiredBecause === CAUSE_STAMPED && was.at >= INCIDENT_FROM && was.at < INCIDENT_TO) return deliverableGaps(back(RECOVERED, [])).length === 0 ? back(RECOVERED, []) : p;
  if (!/This draft names "[^"]+"/i.test(was.retiredBecause) || !/\b(?:entity|distinguishing(?: attribute)?|group)\b/i.test(was.retiredBecause) || !/^\s*\|.*\|\s*\r?\n\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/m.test(words)) return p;
  if (!checkFactualEntailment({ draftText: words, query: p.primaryQuery, pageBodyText: supportFacts.filter((f) => f.id.startsWith("page-copy-")).map((f) => f.fact).join(" ") || undefined, evidenceText: supportFacts.map((f) => f.fact).filter(Boolean).join(" ") || undefined }).entailed) return p;
  const restored = back("markdown table labels were formatting scaffolding, so the supported copy was restored without a new draft", (p.faults ?? []).filter((f) => !GATE_WORDS.test(f) && f !== was.retiredBecause && !f.endsWith(`: ${was.retiredBecause}`)));
  if (deliverableGaps(restored).length > 0) return p;
  return restored;
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
  const prior = prior0 && prior0.diagnosisCause == null && incoming.diagnosisCause != null ? { ...prior0, diagnosisCause: incoming.diagnosisCause, ...(incoming.causeFinding ? { causeFinding: incoming.causeFinding } : {}) } : prior0, sameWork = !!prior && copyIdentity(prior) === copyIdentity(incoming); // A SETTLED VERDICT IS SETTLED WORK, AND A ROW WITH NO COPY KEEPS ONE EXACTLY AS A ROW WITH WORDS DOES (live, 2026-09-05). `obligation` rides the banked copy below, so only a row holding words could keep a terminal verdict; the two demand-recovery rows hold none, took no kept path, and had their settlement recomputed from nothing by every re-mint. The walk's pass stamps "no substantive gap named" (decision/drafted-copy) and the $0 republish mints no obligation at all, so the row flapped terminal to draft and back on alternate passes, writing a version each time, and one stored settlement was turning into a PAID reading. The verdict rides here on the same identity the copy does, and a pass that moves that identity still arrives with no obligation and the ladder decides again from nothing; a person who asked for better words (`redraftRequested`) outranks it, exactly as they outrank the preservation rule below. AND THE READING A SETTLEMENT OWES RIDES HERE FOR THE SAME REASON (reviewer two, 2026-09-06): the ladder turns "settled with nobody having read this search's winners" into that reading and the store stamps it onto the row, so the settlement it was derived from is no longer on the row, and dropping the reading on the next re-mint left the row owing a first paid draft on a pass where nothing about its evidence had moved. Only this one reason travels, and the ladder re-derives it from the row's own `winnersOnFile` every pass, so a reading that has landed is discharged rather than carried for ever.
  // THE RECEIPT OUTLIVES THE PASS THAT STAMPED IT (review, 2026-08-22): every return carries the newest retirement receipt available, so the retired words stay inspectable under whatever replaced them instead of living exactly one pass. A NEW receipt below outranks an inherited one.
  const inherited = prior?.previousCopy && !incoming.previousCopy ? { previousCopy: prior.previousCopy, ...((prior.faults ?? []).includes(prior.previousCopy.retiredBecause) ? { faults: [...new Set([...(incoming.faults ?? []), prior.previousCopy.retiredBecause])] } : {}) } : {}; // AND THE SENTENCE THAT RETIRED THE WORDS RIDES WITH THE RECEIPT (RV8 residual 1, 2026-09-05): a producer re-mints a research row every pass carrying no faults, so a refusal the drafting pass had just stamped survived exactly one pass and the row went back to owing a first draft. Only the retirement's OWN reason is carried, and only while the prior stands behind it as a typed fault, so an identity move or a stale-rules re-read carries nothing; the incoming row's own faults are kept beside it.
  const priorAfter = prior?.recommendedChange.kind === "existing_edit" ? prior.recommendedChange.after.trim() : "", settledStep = sameWork && (prior!.obligation?.kind === "terminal" || (prior!.obligation?.kind === "evidence" && prior!.obligation.need.reasonCode === "no_winner_to_read")) && !incoming.obligation && !prior!.redraftRequested ? { obligation: prior!.obligation } : {};
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
  const sorted = <T>(xs: readonly T[] | undefined): T[] => [...xs ?? []].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))); // A DOOR MAY REFUSE A CHANGE; IT MAY NEVER CRASH ON ONE: the one verdict is asked of every stored row at every door now, so a legacy bundle missing an array a fresh mint always carries is stamped, never thrown on top of the operator.
  // THE CONFIRMATION STILL PINS THE BASIS AND EVERY RENDERED SENTENCE: copy PRESERVATION dropped them from its
  // own identity (a reworded producer must not destroy finished words), but an operator's yes was given to one
  // account truth and one exact screen, so those stay part of THIS stamp explicitly.
  const material = [p.basis ?? null, p.riskLevel, copyIdentity(p), p.diagnosisCause ?? null, sorted(p.limitations.filter((l) => !OWED_NOTE.test(l))), p.operatorSteps ?? [],
    c.kind === "existing_edit" ? [c.field, c.before, c.after, c.where ?? null] : [c.proposedTitle, c.metaDescription, c.openingAnswer, c.outline, c.faqQuestions, c.schemaTypes],
    (p.claims ?? []).map((x) => [x.text, [...x.supportedBy].sort()]), sorted((p.supportFacts ?? []).map((x) => [x.id, x.fact])), p.informationGain ?? null, p.preservation ?? null,
    f ? [f.cause, f.explanation, f.falsifier, sorted(f.competingExplanations.map((x) => [x.cause, x.reason])), sorted(f.notConsidered.map((x) => [x.cause, x.missing]))] : null,
    b ? [b.objective, b.metric, b.measurementPlan, sorted(b.risks), sorted(b.receipt?.missing), sorted(b.confidenceReasons), sorted((b.alternatives ?? []).map((x) => [x.option, x.reason])),
      b.components.map((x, i) => [componentIdOf(x, i), x.page ?? null, x.where ?? null, x.before, x.risk, x.redirectTo ?? null, x.objective ?? null, x.mechanism ?? null, x.anchorAfter ?? null, x.preserves ?? null, x.sourcePack ?? null, sorted(x.evidenceKeys)]),
      sorted((b.dispositions ?? []).map((d) => [d.page, d.verdict, d.because])),
      sorted((b.receipt?.items ?? []).map((i) => [i.key, i.kind, i.fact, i.observedAt, i.observationId ?? null, [...(i.observationIds ?? [])].sort()]))] : null];
  return componentIdOf({ kind: "confirmation", after: JSON.stringify(material) }, 0);
}
