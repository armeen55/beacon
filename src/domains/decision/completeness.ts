/**
 * decision/completeness: THE ONE CHECK THAT ASKS WHETHER BEACON HAS FINISHED THE WORK.
 *
 * Beacon's analysis is for Beacon. A customer-facing Change states exactly what to add, replace, delete, move,
 * link, redirect or create, exactly where, and the FINAL COPY wherever copy is involved. Anything short of that is
 * an opportunity still being developed: it stays stored with all its evidence, out of the ranked queue, out of
 * Today, out of measurement, and the server refuses to record it done.
 *
 * PURE and derived from the deliverable ITSELF, never from the prose around it, so the queue, the card (a client
 * component) and the server mutation all ask one question and a voice edit moves none of them. It sits beside the
 * contract rather than inside the validator because a client bundle may reach this and may not reach that. */

import type { ChangeProposal } from "./contracts";

/** NO VERB LIST LIVES HERE ANY MORE. Whether copy is the finished words or a note about producing them is a
 *  question about meaning, and it was answered by spelling: a production verb near a deliverable noun. It is
 *  now answered where it is known. A PRODUCER handing over a brief says so in a typed field (`researchOnly`)
 *  as it mints the card. THE EDITOR's copy is read by decision/drafted-copy's editor contract, against the
 *  stored page and then by a judge. Only what stays deterministic for any writer is left below. */
/** A blank somebody is expected to fill in before the copy is usable, or MARKUP WHERE A WORD BELONGS: a title
 *  reading "Colors &amp; History" is not final copy, because what an operator pastes is not what a reader sees. */
const BLANK_TO_FILL = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b|&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/;
/** Copy that says out loud that the work has not been done. */
const SAYS_UNFINISHED = /\b(?:not been (?:drafted|read|written)|is not settled|not on this card|still owed|nothing here is)\b/i;

const noCopy = (t: string | null | undefined): boolean => !t || t.trim().length === 0;
const flat = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Copy carrying a blank, or saying out loud that it is not written, is unfinished whoever wrote it. */
const notFinal = (t: string): boolean => BLANK_TO_FILL.test(t) || SAYS_UNFINISHED.test(t);

/**
 * WHY THIS IS NOT YET A CHANGE, in plain phrases, or empty when the deliverable is complete BY ITS TYPE.
 * A title, description or heading owes its exact final replacement. An opening or a section owes final copy AND
 * the place it lands, which only a bundle component's `where` carries. A new page owes a publish-ready page and is
 * NEVER title-only, so every section it names owes written copy.
 */
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
  // COPY THAT LANDS SOMEWHERE NEW OWES ITS PLACE. A title, a description or a heading replaces a field the page
  // already has, so its own address is its placement; an opening or a section does not, and a Change is never an
  // instruction to guess where copy goes.
  // A PLACEMENT MUST ITSELF BE FINISHED: a blank-ish or instruction-shaped `where` is no placement at all, whichever writer stamped it.
  const placed = (t: string | null | undefined): boolean => !!t && t.trim().length >= 12 && !notFinal(t);
  // A CHANGE ON SEVERAL PAGES IS FINISHED ONLY WHEN EVERY PAGE IT NAMES IS. Differentiating four siblings is one
  // decision, and three rewritten pages plus one still owed is not three quarters of a change, it is an unfinished one.
  const parts = p.bundle?.components ?? [];
  // EVERY PAGE THE DIAGNOSIS NAMED, NOT EVERY PAGE THAT SURVIVED IT. Reading the component list alone asked only
  // about the addresses still in the change, so a three-page split that lost two pages on the way through the
  // drafter answered "complete" about the one page left. The producer's own verdict ledger is the roll call: a
  // page it says it is differentiating owes written copy, and a page it decided to leave alone owes its reason.
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

/**
 * FINISHED WORK IS NOT UNDONE BY A PASS THAT DID NOT REACH IT. Drafting is capped per pass, so a card past the
 * cap comes back from its producer as the BRIEF it started as, and writing that over copy an earlier pass
 * already paid for DESTROYED it: 6 then 4 then 3 finished cards across three consecutive passes, taking the
 * biggest description on the site (18,317 views in 90 days) with it. A stored deliverable is replaced by a NEW
 * finished one or by an explicit withdrawal carrying a reason, never by silence.
 *
 * WHAT THE COPY WAS WRITTEN FOR IS WHAT KEEPS IT ALIVE. The basis alone decided, and a basis is a reading of the
 * ACCOUNT, not of this page: it does not move when the page is re-crawled, when the diagnosis changes its mind,
 * when the evidence behind the argument is replaced, when the piece is aimed at a different place or a different
 * set of addresses, when the lever changes, or when the line the copy says it replaces is no longer the line the
 * page carries. Every one of those makes banked words answer a question nobody is asking any more. So the words
 * survive only while the identity BELOW them is byte for byte what it was, and that identity is exactly the
 * material fields the stored fingerprint already treats as identity, minus the copy itself. `copyStamp` is the
 * caller's reading of the TARGET PAGE at the moment each card was minted (title, heading, description, outline),
 * banked on the row beside the words, so a page re-crawled into a different shape retires copy written for the
 * old one. A row carrying no stamp compares as null on both sides and is decided by everything else. PURE.
 */
export function copyIdentity(p: ChangeProposal): string {
  const parts = p.bundle?.components ?? [];
  // THE LINE BEING REPLACED IS NOT COMPARED DIRECTLY. A producer re-minting a brief hands back `before: null`
  // because it has not read the field yet, and reading that as "the line changed" would throw away the copy on
  // every single pass, which is the exact destruction this function exists to stop. What the page carries is
  // carried by `copyStamp` instead, which is read off the stored page and says so honestly for every field.
  // AN ATOMIC CARD'S EVIDENCE IS ITS OWN HINTS, and they were the one material thing outside this identity. A
  // description drafted through the editor names its support by id ("card-1", "card-2"), and those ids ARE this
  // list in order, so a hint that moved, was reworded or disappeared changes what every claim on that card
  // points at while the banked words carried on being served. The receipt items below answer the same question
  // for a bundle, which is why they were already here and the hints were not.
  return JSON.stringify([p.basis ?? null, p.copyStamp ?? null, p.changeFamily, p.diagnosisCause ?? null, p.causeFinding?.explanation ?? null,
    p.bundle ? null : [...p.evidence.hints],
    p.recommendedChange.kind === "existing_edit" ? [p.recommendedChange.field] : ["new_page"],
    [...new Set(parts.map((c) => c.page ?? p.pagePath ?? ""))].sort(),
    parts.map((c) => [c.kind, c.page ?? null, c.where ?? null, c.before]),
    (p.bundle?.dispositions ?? []).map((d) => [d.page, d.verdict]),
    (p.bundle?.receipt.items ?? []).map((i) => [i.key, i.observationId ?? null, [...(i.observationIds ?? [])].sort()]).sort()]);
}

export function preferFinished(incoming: ChangeProposal, prior: ChangeProposal | null | undefined): ChangeProposal {
  if (!prior || copyIdentity(prior) !== copyIdentity(incoming)) return incoming;
  if (deliverableGaps(incoming).length === 0 || deliverableGaps(prior).length > 0) return incoming;
  // COPY NOBODY CAN TRACE IS NOT FINISHED WORK. An atomic card's words are written by the editor, which hands
  // back every claim beside the evidence ids carrying it, and this branch banked the words and dropped the
  // claims: all three ready cards on the live account carried `claims: null` and no persisted mapping from a
  // sentence to the thing behind it, so nothing on the row could ever be re-checked. Banked words survive only
  // WITH their provenance now, and copy that reached the row before this did is redrafted once rather than
  // served on for ever as an unsupported claim. A bundle answers on its receipt instead and is left alone.
  if (!prior.bundle && (prior.claims ?? []).length === 0) return incoming;
  // The words, where they land, what they cost, what was said about them AND what each claim stands on stay as
  // banked; THIS pass's evidence, ranking and receipt still land on the row, so the card keeps arguing from what
  // is true today.
  return { ...incoming, recommendedChange: prior.recommendedChange, researchOnly: false, status: prior.status,
    limitations: prior.limitations, estimatedEffortMinutes: prior.estimatedEffortMinutes,
    ...(prior.claims ? { claims: prior.claims } : {}),
    ...(prior.operatorSteps ? { operatorSteps: prior.operatorSteps } : {}), ...(prior.bundle ? { bundle: prior.bundle } : {}) };
}
