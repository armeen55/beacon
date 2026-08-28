import "server-only";

/** decision/draft-resolution: THE INFORMATION-GAIN REFUSAL CLASS AND ITS DETERMINISTIC LADDER, beside the editor
 *  rather than inside it so the 701-line editor file stays within its ceiling. Two things live here and they are
 *  one contract. `GAIN` names the gate lines whose refusal means the copy failed for what it does not ADD, the one
 *  failure class evidence acquisition or restructuring can fix: their class is an IDENTITY check on these exact
 *  constants, never an inference from prose, because notes explain a decision and must never control the runtime.
 *  `gainResolution` is the cheapest-defensible-first ladder that turns such a refusal into the smallest correct
 *  typed next step (producers/contract's DraftResolution). */

import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, jobComparison, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import type { ChangeProposal } from "./contracts";
import type { DraftResolution, EvidenceRequirement } from "./producers/contract";

const GAIN_LINES = new Set<string>();
const GAIN_TEXT = {
  ADDS_NOTHING: "every claim stands only on this page's own words, so a reader already on the page learns nothing: add a checked fact (a fact- id) or relate this page to another the account owns (an owned-page id)",
  REPEATS_BELOW: "it repeats what stays on the page below it, so a reader gets the same thing twice",
  TOO_THIN: "this rearranges the page into one more paragraph: a synthesis owes a direct answer and then the items, meanings or comparison the reader came for, each on its own line",
  NOT_IMPROVING: "it repeats the search instead of improving the page",
  /** Membership = the refusal is the gain class. TOO_THIN is deliberately NOT a member: it fires only once the
   *  synthesis path was already chosen, which means the material exists and the defect is SHAPE, exactly what the
   *  corrective retry fixes; no acquisition can make one paragraph into three lines. */
} as const;
GAIN_LINES.add(GAIN_TEXT.ADDS_NOTHING); GAIN_LINES.add(GAIN_TEXT.REPEATS_BELOW); GAIN_LINES.add(GAIN_TEXT.NOT_IMPROVING);
/** How many surviving entries a replacement must swallow before it is a consolidation rather than a rewrite, how many words an entry owes before its own section may be deleted for it, and how much of what that section says has to survive here. A single incidental mention is not duplication, and naming a term without its meaning does not carry it. */
/** How many surviving sections a replacement must swallow before it is a consolidation rather than a rewrite, and how short a sentence may be before it carries no material claim. */
const MIN_ABSORBED = 2, KEEPS_MEANING = 0.75; // deleting a section is destructive, so the bar for "this copy carries it" sits high: three lost words of nine ("literally father dog") is lost meaning, not a paraphrase
/** Letters and digits only, so "Chert-o-Pert", "Chert o Pert" and "**Chert-o-Pert**" are one subject and punctuation decides nothing. */
const flatKey = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** THE SUBJECTS THE PAGE ITSELF DECLARES, never a shape guessed out of the copy. A parser that recognised "Subject: definition" was a rule about PUNCTUATION: the same entry written with an em dash, as a bullet, in bold before "means", or in an ordinary sentence walked straight past it. The page already says what its sections are about, in its own stored headings and in the leading term of its own list items, so those are the subjects and the only question left is whether the replacement says them again. A parenthetical (a native spelling, a transliteration) is stripped, and a heading too long to be a term is not one. */
const subjectsOf = (text: string, headings: readonly string[]): Array<{ subject: string; key: string }> => {
  const seen = new Map<string, string>();
  const take = (raw: string) => { const subject = raw.replace(/\([^)]*\)/g, " ").replace(/[*_`#>\u2022]/g, " ").replace(/\s+/g, " ").trim();
    const key = flatKey(subject);
    if (key.length >= 3 && subject.split(" ").length <= 5 && !seen.has(key)) seen.set(key, subject); };
  for (const h of headings) take(h);
  // AND THE LIST ITEMS A PAGE WRITES INSTEAD OF HEADINGS, read off whichever separator it happens to use.
  for (const line of text.split(/\n+/)) { const m = /^\s*(?:[-*\u2022]|\d+[.)])?\s*([^:\u2013\u2014-]{2,60})\s*(?::|\u2013|\u2014|\s-\s)/.exec(line); if (m) take(m[1]!); }
  return [...seen.entries()].map(([key, subject]) => ({ key, subject }));
};
/** THE SENTENCES OF ONE SURVIVING SECTION THAT SAY SOMETHING: what would be lost if that section were deleted.
 *  MATERIAL IS CONTENT, NEVER LENGTH: a word-count floor called "Topoli means chubby" immaterial and licensed
 *  deleting the one sentence that says what the word means. A sentence is material when it carries two content
 *  tokens, or any number or date at all. */
const claimsOf = (section: string): string[] => section.split(/(?<=[.!?])\s+|\n+/).map((t) => t.trim())
  .filter((t) => materialTokens(t).length >= 2 || /\d/.test(t));
/** Content words AND every number whole, because a dropped "42" is how a figure stops being material; and whether a sentence says yes or no, because "X is safe" and "X is not safe" share every content token. They lived in decision/proof while the Ready door judged preservation lexically; that door may now only REFUSE on words and never authorize with them, so these are the drafter's own again. */
const materialTokens = (t: string): string[] => [...new Set([...topicTokens(t), ...(t.toLowerCase().match(/\d[\d.,%°:-]*/g) ?? [])])];
const negated = (t: string): boolean => /\b(?:not|never|no|none|cannot|isn't|aren't|won't|don't|doesn't|without)\b/i.test(t);
/** WHAT A REPLACEMENT WOULD HAND THE READER TWICE, AND WHETHER IT COULD TAKE THOSE SECTIONS WITH IT.
 *  `repeats` is the subjects the PAGE declares that still stand below this copy and that this copy names again, asked of
 *  the subject and never of the wording, because a subject does not paraphrase and punctuation is not structure.
 *  `whole` is the authorization to tell an operator to DELETE those sections, and it is a claim question, not a
 *  similarity score: a 60 percent token overlap once passed a replacement that dropped "literally father dog", so every
 *  material sentence of every absorbed section must be carried here, and the first one that is not is named in `missing`
 *  so the card can say what it would have destroyed. Overlap can find candidates; it may never authorize Ready. PURE. */
function absorption(copy: string, remains: string, headings: readonly string[] = []): { repeats: string[]; whole: boolean; missing?: string } {
  if (remains.trim().length === 0) return { repeats: [], whole: false };
  const said = flatKey(copy), below = flatKey(remains);
  // A subject counts only where the page still carries it BELOW this copy and this copy names it again.
  const all = subjectsOf(remains, headings).filter((s) => below.includes(s.key));
  const live = all.filter((s) => said.includes(s.key));
  const repeats = live.map((s) => s.subject);
  if (repeats.length < MIN_ABSORBED) return { repeats, whole: false };
  // The words this copy devotes to one subject: its own line where it writes lines, else the whole copy.
  const mineFor = (key: string): string => copy.split(/\n+/).find((l) => flatKey(l).includes(key)) ?? copy;
  // THE SECTION THAT WOULD BE DELETED FOR IT: from where the page names that subject to where it names the next one, off
  // the page's own units. Anything looser reads a neighbour's sentences as this subject's and refuses a sound removal.
  const marks = remains.split(/(?<=[.!?])\s+|\n+/).map((t) => t.trim()).filter(Boolean);
  const startOf = (key: string): number => marks.findIndex((t) => flatKey(t).includes(key));
  // EVERY subject the page still carries bounds a section, not only the ones this copy absorbs: taking the last absorbed
  // subject's section to the end of the page swept in six sections it never claimed and refused a sound removal for them.
  const edges = [...new Set(all.map((s) => startOf(s.key)).filter((i) => i >= 0))].sort((a, b) => a - b);
  const starts = live.map((s) => ({ ...s, at: startOf(s.key) })).filter((s) => s.at >= 0).sort((a, b) => a.at - b.at);
  for (let n = 0; n < starts.length; n += 1) {
    const here = starts[n]!, stop = edges.find((i) => i > here.at) ?? marks.length;
    const line = mineFor(here.key), mine = new Set(materialTokens(line)), own = new Set(topicTokens(here.subject));
    for (const claim of claimsOf(marks.slice(here.at, stop).join(" "))) {
      const material = materialTokens(claim).filter((w) => !own.has(w));
      const kept = material.filter((w) => mine.has(w));
      // Numbers and dates are material one by one: a claim's figure missing from the copy is lost meaning whatever the
      // coverage ratio says, and a flipped polarity is a contradiction, never a preservation.
      const figures = material.filter((w) => /\d/.test(w)), figuresKept = figures.every((w) => mine.has(w));
      const polarityHolds = negated(claim) === negated(line);
      if (material.length > 0 && (kept.length / material.length < KEEPS_MEANING || !figuresKept || !polarityHolds))
        return { repeats, whole: false, missing: `${here.subject}: ${claim.slice(0, 90)}` };
    }
  }
  return { repeats, whole: true };
}
/** THE DETERMINISTIC RESOLUTION LADDER for an information-gain refusal, cheapest defensible first. By the time
 *  this runs the two $0 rungs are spent: a real replace target already became a structural synthesis upstream,
 *  and every authorized stored fact was already in the packet the refused rounds drafted from. What remains is
 *  what to GO AND GET: the page's own body when no read is in hand, the exact-query results page when none is on
 *  file, a winner those results name whose content is unread, and authoritative support when nothing external is
 *  banked. All present and still refused is `no_valid_treatment`, typed debt, never a loop. The evaluator's typed
 *  step is honored only where the ladder's own rungs are all present, because the ladder can prove its gaps and
 *  the judge cannot. PURE. */
function gainResolution(judge: DraftResolution, snapshot: EvidenceSnapshot, card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null, facts: readonly { subject: string; state?: string }[]): { resolution: DraftResolution; need?: EvidenceRequirement } {
  const q = card.primaryQuery, qk = canonicalQueryKey(q);
  if (judge === "no_valid_treatment") return { resolution: "no_valid_treatment" };
  if ((body?.passages ?? []).length === 0) return { resolution: "acquire_page_source", need: { kind: "page_source", query: q, url: page.url, reasonCode: "page_unread" } };
  const serpRow = (snapshot.research?.serpEvidence ?? []).find((s) => canonicalQueryKey(s.query) === qk) ?? null;
  if (!serpRow) return { resolution: "acquire_serp", need: { kind: "serp", query: q, reasonCode: "no_exact_serp" } };
  // THE MISSING INFORMATION ITSELF, AHEAD OF READING ONE MORE RIVAL. This sat BEHIND a rung demanding an extract for
  // each of the top FIVE organic rivals, while the acquisition that rung mints banks at most THREE for a query, so the
  // ladder could never reach the only rung that banks a NEW external fact and the writer never received one. A gap the
  // comparison has ALREADY established needs no further rival read to act on: the rivals' own comparison names the subjects
  // NOTHING on this page mentions, and the deadlock this rung closes is exactly that a rival may identify what
  // is missing while its copy may support nothing, the fact check re-checked only claims the page ALREADY makes,
  // and the writer therefore never received one new authorized fact. The requirement carries the missing topic
  // as the proposition to research, and only a fact banked FOR THAT TOPIC satisfies it: an unrelated stored fact
  // leaves it standing, which is what `facts` (the authorized rows themselves, not a count) is here to prove.
  const compared = jobComparison(snapshot.research, q, `${page.content?.title ?? ""} ${(body?.passages ?? []).join(" ")}`, page.content?.outline ?? []);
  const answered = new Set(facts.map((f) => f.subject.trim().toLowerCase()));
  const owedTopic = compared.flatMap((c) => c.missing.map((m) => ({ topic: m, url: c.url }))).find((m) => !answered.has(m.topic.trim().toLowerCase()));
  if (owedTopic) return { resolution: "acquire_factual_source",
    need: { kind: "factual_source", query: `${owedTopic.topic} ${q}`.slice(0, 120), url: page.url, reasonCode: "missing_information", missingTopic: owedTopic.topic, rivalUrl: owedTopic.url } };
  // NO GAP ESTABLISHED YET, so read the next winner that could establish one. This is the FALLBACK now, never the toll gate.
  const extracts = new Set((snapshot.research?.winningPages ?? []).filter((w) => w.extract).map((w) => canonicalUrlKey(w.url)));
  // A PUBLISHER'S FINAL NO IS NOT A READING TO REQUIRE: the bundle producer already skips robots-blocked winners, and this rung minted the same impossible reddit read on every pass, retiring and re-minting it forever while every drive's box burned on the retry.
  const finalNo = new Set((snapshot.research?.winningPages ?? []).filter((w) => !w.extract && w.readOutcome?.state === "robots_blocked").map((w) => canonicalUrlKey(w.url)));
  const unread = serpRow.organic.filter((o) => canonicalUrlKey(o.url) !== canonicalUrlKey(page.url)).slice(0, 5).find((o) => !extracts.has(canonicalUrlKey(o.url)) && !finalNo.has(canonicalUrlKey(o.url))) ?? null;
  if (unread) return { resolution: "acquire_competitor_page", need: { kind: "competitor_page", query: q, url: unread.url, reasonCode: "winner_unread" } };
  if (facts.length === 0 || judge === "acquire_factual_source") return { resolution: "acquire_factual_source", need: { kind: "factual_source", query: q, url: page.url, reasonCode: "facts_owed" } };
  return { resolution: "no_valid_treatment" };
}
/** THE PAGE'S OWN WORDS THAT WOULD STILL STAND UNDER AN EDIT: everything after the passage it replaces. Empty where nothing is replaced or the body is not on file, so the duplication reading above asks nothing rather than guessing. PURE. */
const surviving = (passages: readonly string[], before: string | null): string => {
  const whole = passages.join(" "), replaced = (before ?? "").trim(); if (replaced.length < 20) return "";
  const cut = whole.indexOf(replaced.slice(0, 60)); return cut >= 0 ? whole.slice(cut + replaced.length) : "";
};
/** ONE public surface for what a draft's gain outcome IS and what to do about it: the refusal lines and their identity
 *  set, the deterministic next-step ladder, and the duplication reading a replacement is held to. One symbol, because
 *  every caller that needs one of these needs the others in the same breath. */
export const GAIN = { ...GAIN_TEXT, LINES: GAIN_LINES, MIN_ABSORBED, resolution: gainResolution, absorption, surviving } as const;
