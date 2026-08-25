import "server-only";

/** decision/draft-resolution: THE INFORMATION-GAIN REFUSAL CLASS AND ITS DETERMINISTIC LADDER, beside the editor
 *  rather than inside it so the 701-line editor file stays within its ceiling. Two things live here and they are
 *  one contract. `GAIN` names the gate lines whose refusal means the copy failed for what it does not ADD, the one
 *  failure class evidence acquisition or restructuring can fix: their class is an IDENTITY check on these exact
 *  constants, never an inference from prose, because notes explain a decision and must never control the runtime.
 *  `gainResolution` is the cheapest-defensible-first ladder that turns such a refusal into the smallest correct
 *  typed next step (producers/contract's DraftResolution). */

import { canonicalQueryKey, topicTokens } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
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
const MIN_ABSORBED = 2, MIN_ENTRY_WORDS = 5, KEEPS_MEANING = 0.6;
/** THE ENTRIES A LIST-SHAPED ANSWER DEFINES, as the term each line is ABOUT: the words before its colon, with any parenthetical (a native spelling, a transliteration) dropped. A term, never a sentence, so a line of ordinary prose contributes nothing. Keyed on letters and digits alone, because "Chert-o-Pert" and "Chert o Pert" are one entry. */
const entriesOf = (copy: string) => copy.split("\n").map((l) => l.trim()).flatMap((l) => {
  const at = l.indexOf(":"); if (at <= 0) return [];
  const subject = l.slice(0, at).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(), key = subject.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return key.length >= 3 && subject.split(" ").length <= 5 ? [{ subject, key, line: l, words: l.slice(at + 1).trim().split(/\s+/).filter(Boolean).length }] : [];
});
/** WHAT A REPLACEMENT WOULD HAND THE READER TWICE, AND WHETHER IT COULD TAKE THOSE SECTIONS WITH IT. `repeats` is the
 *  entries this copy defines that still have their own section below it, asked of the SUBJECT and never the wording:
 *  the test this replaced compared whole lines and demanded every word over three letters already appear below, so one
 *  ordinary novel word ("means", "very", "colorful") cleared a line and a paraphrase cleared all of them, and a live
 *  replacement defining five entries that each kept their section underneath went READY at rank 1. A subject does not
 *  paraphrase. `whole` says the page would lose nothing by the removal: every repeated entry is said here in full, and
 *  most of what its section says survives in this copy. Counting the replacement's own words was not enough, because
 *  "Pedar Sag: a very colorful insult, roughly bastard" is a full sentence and still drops "literally father dog". PURE. */
function absorption(copy: string, remains: string): { repeats: string[]; whole: boolean } {
  const flat = remains.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); if (flat.length === 0) return { repeats: [], whole: false };
  const mine = entriesOf(copy).filter((e) => flat.includes(e.key)), lines = remains.split(/(?<=[.!?])\s+|\n+/).map((t) => t.trim()).filter(Boolean);
  const carries = (e: { key: string; line: string; words: number }): boolean => {
    const said = new Set(topicTokens(e.line));
    const theirs = lines.filter((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").includes(e.key)).flatMap((t) => topicTokens(t)).filter((w) => !e.key.includes(w));
    return e.words >= MIN_ENTRY_WORDS && (theirs.length === 0 || theirs.filter((w) => said.has(w)).length / theirs.length >= KEEPS_MEANING); };
  const repeats = [...new Map(mine.map((e) => [e.key, e.subject])).values()];
  return { repeats, whole: repeats.length >= MIN_ABSORBED && mine.every(carries) };
}

/** THE DETERMINISTIC RESOLUTION LADDER for an information-gain refusal, cheapest defensible first. By the time
 *  this runs the two $0 rungs are spent: a real replace target already became a structural synthesis upstream,
 *  and every authorized stored fact was already in the packet the refused rounds drafted from. What remains is
 *  what to GO AND GET: the page's own body when no read is in hand, the exact-query results page when none is on
 *  file, a winner those results name whose content is unread, and authoritative support when nothing external is
 *  banked. All present and still refused is `no_valid_treatment`, typed debt, never a loop. The evaluator's typed
 *  step is honored only where the ladder's own rungs are all present, because the ladder can prove its gaps and
 *  the judge cannot. PURE. */
function gainResolution(judge: DraftResolution, snapshot: EvidenceSnapshot, card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null, factsBanked: number): { resolution: DraftResolution; need?: EvidenceRequirement } {
  const q = card.primaryQuery, qk = canonicalQueryKey(q);
  if (judge === "no_valid_treatment") return { resolution: "no_valid_treatment" };
  if ((body?.passages ?? []).length === 0) return { resolution: "acquire_page_source", need: { kind: "page_source", query: q, url: page.url, reasonCode: "page_unread" } };
  const serpRow = (snapshot.research?.serpEvidence ?? []).find((s) => canonicalQueryKey(s.query) === qk) ?? null;
  if (!serpRow) return { resolution: "acquire_serp", need: { kind: "serp", query: q, reasonCode: "no_exact_serp" } };
  const extracts = new Set((snapshot.research?.winningPages ?? []).filter((w) => w.extract).map((w) => canonicalUrlKey(w.url)));
  const unread = serpRow.organic.filter((o) => canonicalUrlKey(o.url) !== canonicalUrlKey(page.url)).slice(0, 5).find((o) => !extracts.has(canonicalUrlKey(o.url))) ?? null;
  if (unread) return { resolution: "acquire_competitor_page", need: { kind: "competitor_page", query: q, url: unread.url, reasonCode: "winner_unread" } };
  if (factsBanked === 0 || judge === "acquire_factual_source") return { resolution: "acquire_factual_source", need: { kind: "factual_source", query: q, url: page.url, reasonCode: "facts_owed" } };
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
