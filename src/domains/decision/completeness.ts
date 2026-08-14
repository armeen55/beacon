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
/** A blank somebody is expected to fill in before the copy is usable. */
const BLANK_TO_FILL = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b/;
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
  const owed = [...new Set(parts.map((x) => x.page).filter((x): x is string => !!x))]
    .filter((pg) => !parts.some((x) => x.page === pg && !noCopy(x.after) && !notFinal(x.after)));
  if (owed.length > 0) gaps.push(`${owed.length} of the pages it changes have no copy written`);
  if ((c.field === "section" || c.field === "answer_block") && !placed(c.where)
    && !(p.bundle?.components ?? []).some((x) => placed(x.where))) {
    gaps.push("where it goes on the page is not named");
  }
  return [...new Set(gaps)];
}
