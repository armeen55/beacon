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

/** AN INSTRUCTION IS A PRODUCTION VERB AND THE THING IT IS ABOUT, IN ONE CLAUSE. UNANCHORED, because the next pass
 *  is a model whose phrasing varies and a two word prefix must never defeat this ("Then write a section that...",
 *  "You should add 800 to 1,200 words...", "Consider adding a description...", "This page needs three more
 *  sections..."); stems carry every inflection. THE CLAUSE is what keeps ordinary imperative page copy whole: a
 *  recipe step and a visa step open on these verbs and name no artifact of Beacon's, so "Cover the pot with a lid
 *  so it steams for ten minutes" is a finished sentence and stays one. */
/** Passive forms are FINISHED copy about the page ("X is covered in this guide's section"), so a be-verb directly ahead disarms the match. */
const VERB = String.raw`\b(?:(?<!\b(?:is|are|was|were|been|be)\s)(?:cover|describ|list|nam|show|mention)|add|writ|rewrit|replac|creat|draft|giv|fill|includ|insert|past|link|put|expand|merg|consolidat|mov|redirect|remov|delet|retir|combin|need|requir|consider)(?:e|es|ed|ing|s|n)?\b[^.!?;:\n]{0,70}?`;
/** BEACON'S OWN DELIVERABLE CLASSES, and an amount of work instead of the words. */
const OWN = String.raw`(?:\b(?:titles?|descriptions?|headings?|h1s?|sections?|paragraphs?|outlines?|anchor text)\b|\b\d[\d,]*(?:\s*(?:to|and|or|-)\s*[\d,]+)?\s*(?:words|characters)\b)`;
/** Everything a longer instruction is about: a deliverable class, an address on this site, or the job the copy is
 *  meant to do. Deliberately NOT "so it" or "so they" (ordinary English carrying no artifact at all) and not a
 *  bare "copy", which is a noun a reader owns too ("Include a copy of your passport photo page when you apply"). */
const INSTRUCTION = new RegExp(`${VERB}(?:${OWN}|\\b(?:sentences?|links?|words|characters|editor)\\b|/[a-z0-9][\\w\\-/]*|\\bthat (?:answers?|names?|says?|covers?|explains?)\\b)`, "i");
/** A SHORT FIELD CAN ONLY BE UNFINISHED BY SAYING SO. A title, a description and a heading ARE their own final copy,
 *  so they are read against the deliverable classes alone: "Write a description of about 150 characters that..."
 *  declares itself unwritten, and "Link building for a Persian culture site works best through museums and
 *  university pages" is a description and is left exactly as written. */
const DECLARES_UNWRITTEN = new RegExp(`${VERB}${OWN}`, "i");
/** A blank somebody is expected to fill in before the copy is usable. */
const BLANK_TO_FILL = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b/;
/** Copy that says out loud that the work has not been done. */
const SAYS_UNFINISHED = /\b(?:not been (?:drafted|read|written)|is not settled|not on this card|still owed|nothing here is)\b/i;

const noCopy = (t: string | null | undefined): boolean => !t || t.trim().length === 0;
const flat = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
const SHORT_FIELD = new Set(["title", "meta", "h1"]); // fields that REPLACE a line the page already has, so the line itself is the whole deliverable
/** Is this piece of copy the finished words, or a note about producing them? `short` marks those three fields. */
const notFinal = (t: string, short = false): boolean =>
  (short ? DECLARES_UNWRITTEN : INSTRUCTION).test(t) || BLANK_TO_FILL.test(t) || SAYS_UNFINISHED.test(t);

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
    for (const [what, text, short] of [["title", c.proposedTitle, true], ["description", c.metaDescription, true], ["opening", c.openingAnswer, false]] as const) {
      if (noCopy(text)) gaps.push(`it carries no ${what}`);
      else if (notFinal(text, short)) gaps.push(`its ${what} describes the work instead of being it`);
    }
    if (c.outline.length < 3) gaps.push("it names fewer than three sections");
    const written = (p.bundle?.components ?? []).filter((x) => !noCopy(x.after) && !notFinal(x.after))
      .map((x) => flat(`${x.label} ${x.where ?? ""} ${x.after}`)).join(" | ");
    const owed = c.outline.filter((h) => flat(h).length > 0 && !written.includes(flat(h)));
    if (owed.length > 0) gaps.push(`${owed.length} of its ${c.outline.length} sections have no copy written`);
    return [...new Set(gaps)];
  }
  if (noCopy(c.after)) gaps.push("it carries no copy");
  else if (notFinal(c.after, SHORT_FIELD.has(c.field))) gaps.push("it describes the work instead of being it");
  // COPY THAT LANDS SOMEWHERE NEW OWES ITS PLACE. A title, a description or a heading replaces a field the page
  // already has, so its own address is its placement; an opening or a section does not, and a Change is never an
  // instruction to guess where copy goes.
  // A PLACEMENT MUST ITSELF BE FINISHED: a blank-ish or instruction-shaped `where` is no placement at all, whichever writer stamped it.
  const placed = (t: string | null | undefined): boolean => !!t && t.trim().length >= 12 && !notFinal(t);
  if ((c.field === "section" || c.field === "answer_block") && !placed(c.where)
    && !(p.bundle?.components ?? []).some((x) => placed(x.where))) {
    gaps.push("where it goes on the page is not named");
  }
  return [...new Set(gaps)];
}
