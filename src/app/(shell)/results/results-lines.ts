import "server-only";

/** results-lines - every SENTENCE the Results surface says about one measured change: the labels, the
 *  predicates that pick a row's direction, and the writers of happened/taught/next. Split from
 *  results-presentation at its ceiling; that file imports THIS, and this imports only helpers back. */

import type { ControlReceipt } from "@/domains/measurement";
import { isMature as kernelIsMature } from "@/domains/measurement";
import { monthDayLabel } from "@/components/data/receipt-line";
import type { KernelRead } from "@/domains/measurement";
import { groupOf, landsLabel, lastClosed, nextCloseOn, type ResultsGroup, type ShipmentPresentation } from "./results-presentation";

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "-" : ""}${num(Math.abs(n))}`;
const isMature = (d: number | null): boolean => kernelIsMature(d as 7 | 14 | 28 | 56 | null);

/** What the change actually was, said the way an operator would say it. */
const WORK_LABEL: Record<string, string> = {
  title: "the page title", meta: "the search description", h1: "the page headline",
  opening_answer: "the answer at the top", answer_block: "the answer at the top",
  intro_answer_block: "the answer at the top",
  section: "a section", section_add: "a new section", section_remove: "a removed section",
  section_rewrite: "a rewritten section", restructure: "the order of the page",
  full_rewrite: "a full rewrite", factual_correction: "a factual correction",
  paragraph_correction: "a corrected paragraph", source_pack: "the sources on the page",
  source_update: "the sources on the page", entity_expansion: "more detail",
  table_or_list_add: "a table", faq: "a questions and answers block",
  schema: "the structured data", internal_links: "the internal links", internal_link: "an internal link",
  internal_link_add: "an internal link", internal_link_remove: "a removed internal link",
  anchor_text: "the wording of a link", canonical: "the canonical address",
  redirect: "a redirect", noindex: "hiding the page from search", navigation: "the site navigation",
  consolidation: "merging two pages", new_page: "a brand new page", create_page: "a brand new page",
  keep_current: "watching without changing", monitor: "watching without changing",
  // THE SECOND VOCABULARY. A row's action word is a KIND from the older producers ("title") or the
  // FAMILY the bundle producer stamps off changeFamily ("title-family"). Only the kinds were mapped,
  // so every bundle this account shipped rendered as the shrug "this change" while a real label existed.
  "title-family": "the title and headline", "description-family": "the search description",
  "section-family": "the content on the page", "links-family": "the internal links",
  "technical-family": "the technical setup",
  title_meta: "the title and search description", meta_description: "the search description",
  description: "the search description", answer: "the answer at the top", snippet: "the answer at the top",
  link: "an internal link", content: "the content on the page", edit_page: "the content on the page",
  section_reorder: "the order of the page",
};

/** Unmapped input reads as "this change", never as its slug. */
const workLabel = (raw: string): string =>
  WORK_LABEL[(raw || "").toLowerCase()]
  ?? WORK_LABEL[(raw || "").toLowerCase().replace(/^(edit|change|add|fix|update|create)_/, "")]
  ?? "this change";

/** What the proposal said was wrong with the page. An unmapped cause is left out entirely. */
const CAUSE_LABEL: Record<string, string> = {
  cannibalization: "two of your own pages competing for the same search",
  ctr_snippet: "the line searchers saw not matching what they typed",
  competitor_content_gap: "the pages beating you answering something yours did not",
  incomplete_coverage: "the page answering part of the question and stopping",
  weak_opening: "the page taking too long to answer",
  serp_shape_shift: "the results page changing shape around you",
  intent_shift: "people wanting something different from that search",
  internal_link_weakness: "the rest of your site barely pointing at this page",
  ai_citation_gap: "AI assistants answering the question without crediting you",
  demand_decline: "fewer people searching for this at all",
  ranking_loss: "the page sliding down the results",
  retrieved_not_cited: "AI assistants reading your page and crediting someone else",
  technical_indexability: "search engines not being able to read the page properly",
};

/** The family of work the change belonged to, in the operator's words. */
const FAMILY_LABEL: Record<string, string> = {
  "title-family": "a title and headline change", "section-family": "a content change",
  "links-family": "an internal linking change", "technical-family": "a technical change",
  consolidation: "merging pages", new_page: "a new page",
};

// -- the shared shape of a read -----------------------------------------------


/** THE CHANGE IS FILED UNDER THE YARDSTICK IT DECLARED. Every row was grouped by the Google verdict and the AI
 *  reading was a sentence underneath, so a change raised to win a CITATION could win exactly that and sit under
 *  "No change", while one that moved no citation at all sat under "Worked" for traffic it was never aimed at
 *  (reviewer, 2026-08-19). The objective frozen at the press decides the group; the other side stays visible
 *  as context. `unclear` is still reading, on the same rule the Google side uses: an unfinished read is not a
 *  verdict. A change judged on clicks is grouped byte for byte as it always was. */
const AI_OBJECTIVES = new Set(["ai_retrieval", "ai_citation_conversion", "ai_citation", "ai_mentions"]);
const judgedOnAi = (p: ShipmentPresentation): boolean => !!p.judgedMetric && AI_OBJECTIVES.has(p.judgedMetric);
const groupFor = (p: ShipmentPresentation): ResultsGroup => {
  if (!judgedOnAi(p)) return groupOf(p.read);
  // A TERMINAL SILENCE IS NOT A READ IN PROGRESS: no scope kept or no baseline frozen ends in "Not
  // measurable", filed with the settled rows rather than reading forever (Codex, 2026-08-21).
  if (p.ai?.terminal === true) return "flat";
  const d = aiMove(p);
  return d === "improved" ? "worked" : d === "worsened" ? "down" : d === "no_clear_movement" ? "flat" : d === "mixed" ? "flat" : "reading";
};
/** THE ONE DIRECTION AN AI JUDGED ROW IS TOLD IN, taken once and used by every field below, so a row can never take its group from the
 *  declared objective while its number, its bar, its sentence, its lesson and its step come off Google (reviewer, 2026-08-19). Null =
 *  nothing to tell yet, and an early lean is nothing: three days in has earned a verdict exactly as little as a 7 day Google lean has. */
const aiMove = (p: ShipmentPresentation): "improved" | "worsened" | "no_clear_movement" | "mixed" | null => {
  const d = finishedReading(p) ? p.ai?.direction : "unclear";
  return d === "improved" || d === "worsened" || d === "no_clear_movement" || d === "mixed" ? d : null;
};
/** HAS THIS ROW'S OWN READ FINISHED? The header counts finished reads and says so out loud ("that finished their 28 day read"), and the
 *  Google side earns that sentence through the maturity rule above: a group that is not "reading" already means the window closed. An AI
 *  objective is read over the change's own 28 days from the stamp, so it earns the same sentence only once those days have actually run,
 *  and a row that does not carry the count is not claimed as finished. It still shows in its own lane: which answer a change is and
 *  whether its read is over are two different facts, and only the second one may be totalled. */
const finishedReading = (p: ShipmentPresentation): boolean => (judgedOnAi(p) ? (p.ai?.daysElapsed ?? 0) >= 28 : true);
/** Which yardstick judged this row, in the words the operator reads. Never a lab word. */
const yardstickOf = (metric: string | null | undefined): string | null =>
  metric === "ai_retrieval" ? "Judged on whether assistants read this page for it"
    : metric === "ai_citation_conversion" ? "Judged on being credited, not just read"
      : metric === "ai_citation" ? "Judged on being credited in AI answers"
        : metric === "ai_mentions" ? "Judged on how often AI answers name you" : null;

/** THE OBJECTIVE'S OWN STORY, in the four places one row tells it. Only the group and the yardstick label ever came off the declared
 *  objective; the number on the line, the bar, "what happened", the lesson and the next step all still came off Google, so a won citation
 *  sat under "Worked" beside a click decline, "the page did not clearly move" and advice to put the old wording back (reviewer,
 *  2026-08-19). One row per objective: [the short line, the sentence subject, the lesson clause, what the next page to try looks like,
 *  the step when it went backwards, the step when it did not move]. */
const AI_STORY: Record<string, readonly [short: string, subject: string, clause: string, target: string, down: string, flat: string]> = {
  ai_citation: ["Credited", "Credited in AI answers", "it was credited in AI answers", "AI answers name without crediting",
    "Being credited slipped after this. Read which sources the answers credit instead, cover that on the page, then measure again.",
    "Being credited has not moved. Put the fact those answers credit elsewhere on this page, in your own words, then measure again."],
  ai_citation_conversion: ["Read then credited", "Read and then credited", "it was read and then credited", "AI assistants read and pass over",
    "Read and passed over more often after this. Name the source beside the answer on the page, then measure again.",
    "Still read and passed over. Give the answer a fact of its own worth crediting, then measure again."],
  ai_retrieval: ["Read", "Read by AI assistants", "AI assistants read it", "AI assistants never open",
    "AI assistants opened this page less often after this. Move the answer back to the top of the page, then measure again.",
    "AI assistants still do not read this page for it. Answer the question in the first lines, in plain words, then measure again."],
  ai_mentions: ["Named", "Named in AI answers", "AI answers named it", "AI answers never name",
    "Named less often after this. Read what those answers name instead, cover that on the page, then measure again.",
    "Named no more often than before. Answer the question directly at the top of the page, then measure again."],
};
/** The move itself, in the order every table above uses. The short cell form drops the comparison the sentence keeps. */
const AI_MOVE = { improved: "more often than before", worsened: "less often than before",
  no_clear_movement: "with no clear movement yet", mixed: "with the assistants split on it" } as const;
const aiStory = (p: ShipmentPresentation) => AI_STORY[p.judgedMetric ?? ""];
/** Days since the stamp, which is what the AI half is read over. A row that carries no count has had nothing read, never 28 days of nothing. */
const aiDays = (p: ShipmentPresentation): number => Math.max(0, Math.min(28, Math.round(p.ai?.daysElapsed ?? 0)));


/** The size of a move, never its sign: the sentence around it owns the direction. */
function liftSize(metric: KernelRead["metric"], lift: number): string {
  if (metric === "ctr") {
    const pp = Math.abs(Math.round(lift * 1000) / 10);
    return `${pp} point${pp === 1 ? "" : "s"} of click rate`;
  }
  const n = metric === "position" ? Math.round(Math.abs(lift) * 10) / 10 : Math.abs(Math.round(lift));
  return `${n} ${metric === "position" ? "rank" : "click"}${n === 1 ? "" : "s"}`;
}

/** The short signed number for one row, compact enough to sit on one line. */
function liftLabel(metric: KernelRead["metric"], lift: number): string {
  if (Math.abs(lift) < 1e-9) return "Level";
  const size = liftSize(metric, lift).replace("points of click rate", "click rate").replace("point of click rate", "click rate");
  return `${lift > 0 ? "+" : "-"}${size} ${lift > 0 ? "ahead" : "behind"}`;
}


/** THE COMPARISON RECEIPT the measurement kernel keeps beside a change: which pages stood behind it and
 *  why each qualified. "Similar" is a claim, so a row whose receipt cannot back it says the smaller true
 *  thing instead. And a page with no Google traffic before the change prints no appearances number at
 *  all, a test the header totals reuse so they add up to exactly the rows on the screen. */
const receiptOf = (p: ShipmentPresentation): ControlReceipt[] => p.controlsReceipt ?? [];
/** WHY THAT PAGE QUALIFIED, in the operator's words. The kernel writes its own shorthand ("no open or measuring
 *  changes; traffic within 5x") and it reached the screen raw; an unmapped reason is DROPPED, never printed. */
const REASON_LABEL: [RegExp, string][] = [[/^same page type/, "same kind of page"], [/^traffic within/, "similar traffic"],
  [/^no open or measuring changes$/, "no other change running on it"],
  [/^search data across the whole baseline window$/, "search data for the whole period before the change"]];
const reasonWords = (reasons: readonly string[]): string[] =>
  reasons.map((r) => REASON_LABEL.find(([re]) => re.test(r.trim().toLowerCase()))?.[1]).filter((s): s is string => s != null);
const peersWord = (p: ShipmentPresentation): string =>
  receiptOf(p).length > 0 ? "similar pages that were not changed" : "pages that were not changed";

/** WHAT WAS RECORDED WHEN NO FAIR COMPARISON EXISTS. Marking a change done is a fact about the work and is kept whatever
 *  the data says; whether it can be compared is a separate fact. One sentence each, naming which one is missing. */
const MEASUREMENT_NOTE: Record<string, string> = {
  measurement_unavailable: "Recorded. A fair comparison is not available yet: Search Console data for this site could not be read.",
  insufficient_comparison: "Recorded. A fair comparison is not available yet: too few similar pages on this site can stand behind this one.",
  verification_needed: "Recorded from what was applied. The live page still has to be read before any result is claimed.",
};

/** WHAT HAPPENED ON THE THING THIS CHANGE WAS RAISED TO MOVE. The primary sentence was the Google one on every row, so a change that won
 *  its citation was told "the page did not move" directly under its own "Worked". Days are counted the way the Google half counts its own,
 *  and a read that cannot be called says exactly that: the objective's own numbers sit under this line and name which side is missing. */
function aiHappenedLine(p: ShipmentPresentation): string {
  const d = aiDays(p), move = aiMove(p);
  const ran = d >= 28 ? "Ran 28 days." : `${d} ${d === 1 ? "day" : "days"} in.`;
  if (move) return `${ran} ${aiStory(p)[1]} ${AI_MOVE[move]}.`;
  return d > 0 ? `${ran} The AI answers for this change's own searches do not add up to a direction yet.`
    : "Nothing read yet on the AI answers for this change's own searches.";
}

/** One sentence for what happened, on the read that was actually used. On a row judged on AI this is the Google half, and it prints under
 *  its own heading as context rather than as the answer. */
function happenedLine(p: ShipmentPresentation, now: Date = new Date()): string {
  const r = p.read;
  // Recorded, and honestly not judged: nothing about this row names a Search number to grade it on. UNLESS IT
  // WAS JUDGED ON SOMETHING ELSE. A change pressed under an AI objective carries its verdict from the answers,
  // and printing "not judged" beside its own "Worked" told the operator two opposite things about one row.
  if (r.metric === "unclassified") return judgedOnAi(p)
    ? "Search data cannot fairly compare a change of this kind, so no click figure is claimed for it."
    : "Recorded, and not judged: what was changed here is not a kind that Search data can fairly compare.";
  // Recorded, and nothing to compare it against yet. Said before the "first result lands" promise, which nothing is keeping.
  const state = p.measurement ? MEASUREMENT_NOTE[p.measurement] : undefined;
  if (state && r.basisDay == null) return state;
  const peers = peersWord(p);
  // SHARED CREDIT KEEPS ITS NUMBER AND NAMES THE DEMOTION: hiding the estimate read as if nothing had been measured.
  if (r.verdict === "confounded") {
    const held = r.basisDay == null ? ""
      : ` Estimated lift: ${liftSize(r.metric, r.lift)} ${r.lift > 0 ? "ahead of" : "behind"} ${peers}, held as shared credit rather than a win.`;
    const day = monthDayLabel(r.cleanUntil);
    if (day) return `This page changed again on ${day}, so the days after that belong to both changes.${held}`;
    const n = r.overlappingIds.length;
    return `${n} other ${n === 1 ? "change" : "changes"} landed on this page at the same time, so the credit is shared.${held}`;
  }
  if (r.basisDay == null) {
    const next = landsLabel(nextCloseOn(r), now);
    return next ? `Nothing read yet. The first result ${next}.` : "Nothing read yet. The first result lands once a read closes.";
  }
  // TOO FEW PAGES TO STAND BEHIND IT IS NOT TOO LITTLE DATA: the days ran and the page moved, and the pair below shows it.
  if (r.verdict === "insufficient_evidence") {
    return r.comparison === "insufficient"
      ? `Ran ${r.basisDay} days. A fair comparison is not available: too few pages on this site can stand behind this one.`
      : `Ran ${r.basisDay} days, and there is too little Google data on this page to call it.`;
  }
  // ESTIMATED, NEVER CAUSED: the number compares against pages left alone, so no sentence says the change added anything.
  const estimate = r.verdict === "no_clear_movement"
    ? `Estimated lift: level with ${peers}`
    : `Estimated lift: ${liftSize(r.metric, r.lift)} ${r.lift > 0 ? "ahead of" : "behind"} ${peers}`;
  return isMature(r.basisDay) ? `Ran ${r.basisDay} days. ${estimate}.` : `${r.basisDay} days in. ${estimate}.`;
}

/** THE SITE'S OWN BEFORE AND AFTER where no fair comparison exists, labeled as exactly that. Printed
 *  only when the kernel exposes the unadjusted pair; nothing is scaled, guessed or filled in here. */
function unadjustedLine(p: ShipmentPresentation): string | null {
  const u = p.read.unadjusted;
  if (p.read.comparison !== "insufficient" || !u) return null;
  return `Before ${num(u.clicksBefore)} clicks / After ${num(u.clicksAfter)} clicks, unadjusted: the site moved too.`;
}

/** What this read carries forward, plus how much stands behind it. Clauses drop rather than guess. THE OUTCOME CLAUSE IS THE ROW'S OWN
 *  YARDSTICK: a change judged on citations carried "the page did not clearly move" out of Google into the lesson, and that lesson is what
 *  gets recommended next on pages like this one. */
function taughtLine(p: ShipmentPresentation): string {
  const r = p.read, l = r.learning;
  const family = FAMILY_LABEL[l.actionFamily];
  const cause = l.diagnosisCause ? CAUSE_LABEL[l.diagnosisCause] : undefined;
  const ai = judgedOnAi(p) ? aiMove(p) : null;
  const settled = judgedOnAi(p) ? ai != null : !!l.outcomeDirection && l.outcomeDirection !== "unclear";
  const moved = judgedOnAi(p)
    ? (ai ? `${aiStory(p)[2]} ${AI_MOVE[ai]}` : "it is too early to say which way this went")
    : l.outcomeDirection === "up" ? "the page moved up after it"
      : l.outcomeDirection === "down" ? "the page moved down after it"
        : l.outcomeDirection === "flat" ? "the page did not clearly move"
          : "it is too early to say which way this went";
  const parts: string[] = [];
  if (cause) parts.push(`this page read as ${cause}`);
  if (family) parts.push(`it was answered with ${family}`);
  parts.push(moved);
  // NOTHING IS CARRIED FORWARD FROM A READ THAT HAS NOT LANDED.
  const carried = settled
    ? "That carries into what gets recommended next on pages like this one."
    : "Nothing carries forward from this one until it settles.";
  const backing = typeof l.evidenceCompleteness === "number" && l.evidenceCompleteness > 0
    ? `Backed by ${l.evidenceCompleteness} check${l.evidenceCompleteness === 1 ? "" : "s"}.`
    : "Read once so far.";
  return `${cap(parts.join(", "))}. ${carried} ${backing}`;
}

/** WHAT TO DO NEXT, PER FAMILY OF WORK. Three sentences told every operator to put the old wording
 *  back, including the ones whose change was a redirect or an internal link, where there was no
 *  wording to restore. This is the closed map off the family the kernel already resolved. */
const NEXT_STEP: Record<string, readonly [up: string, down: string, flat: string]> = {
  "title-family": ["Do this again on a similar page.", "Put the previous title back, then measure again.", "The words were not the lever here. Try a content change on this page."],
  "section-family": ["Add the same kind of section to a similar page.", "Review what the new section replaced; restoring the old order is the honest test.", "The added copy did not move readers. A title sharpening is the cheaper next test."],
  "links-family": ["Link the next weakest page the same way.", "This page slid down the results after the new links. Drop the weakest one, then read the position again.", "The position held where it was. Link to this page from a stronger page next."],
  "technical-family": ["Apply the same technical fix to a similar page.", "Reverse the redirect only if the page lost real traffic; otherwise leave it and measure the next read.", "The technical fix moved nothing on its own. Leave it in place and try a content change here."],
  consolidation: ["Merge the next pair of pages competing for the same search.", "The merged page lost ground. Split the two pages apart again, then measure.", "Merging moved nothing. Sharpen the title on the page that survived."],
  new_page: ["Write the next page on the same kind of question.", "The new page is losing ground. Link to it from the pages that already rank before touching it again.", "The new page has not been found yet. Link to it from the pages that already rank."],
};

/** An unmapped family gets a step that never talks about wording it cannot see. */
const GENERIC_NEXT = ["Do this again on a similar page.", "Undo what was applied here, then measure again.", "Nothing moved here. Try a different kind of change on this page."] as const;

/** The one thing to do about this row. A ROW JUDGED ON AI TAKES ITS STEP FROM ITS OWN OBJECTIVE: the Google map above sent a change that
 *  had just won a citation off to "Put the previous title back", because Google clicks had slipped over the same days. There is no undo
 *  step here at all, on purpose: the objective moved or it did not, and the answer to "it did not" is the next thing to try on the page. */
function nextStepLine(p: ShipmentPresentation, now: Date = new Date()): string {
  const r = p.read;
  if (judgedOnAi(p)) {
    const [, , , target, down, flat] = aiStory(p), move = aiMove(p);
    if (move === "improved") return `Do this again on the next page ${target}.`;
    if (move === "worsened") return down;
    if (move === "no_clear_movement" || move === "mixed") return flat;
    // A CHANGE NOBODY IS READING ANSWERS FOR IS NOT MID READ. With no outcome at all there are no days left to wait on, and
    // promising one is worse than saying the read will not come.
    const left = p.ai ? 28 - aiDays(p) : 0;
    return left > 0 ? `Nothing to do for another ${left} ${left === 1 ? "day" : "days"}.`
      : "Nothing can be read on this one. Try the next change on this page and measure that.";
  }
  if (r.metric === "unclassified") return "Nothing to wait for on this one.";
  if (r.verdict === "confounded") return "Two changes share these days. Make the next change on this page on its own, then measure it.";
  const d = r.learning.outcomeDirection;
  if (d !== "unclear") return (NEXT_STEP[r.learning.actionFamily] ?? GENERIC_NEXT)[d === "up" ? 0 : d === "down" ? 1 : 2];
  const next = landsLabel(nextCloseOn(r), now);
  return next == null ? "Nothing to do until the next read lands."
    : next.startsWith("lands") ? `Nothing to do until the next read ${next}.`
      : "Nothing to do; the next read is overdue because Google reports a few days behind.";
}

/** At most two, and only the ones this row actually carries. `judgedOnAi` drops the one caveat that is purely about the Google
 *  comparison: "too few similar pages stood behind this one" is an unlabelled doubt cast over a verdict those pages did not decide. */
function caveatLines(r: KernelRead, judgedOnAi: boolean): string[] {
  const out: string[] = [];
  const day = monthDayLabel(r.cleanUntil);
  if (day) out.push(`This page changed again on ${day}. The days after that belong to both changes.`);
  else if (r.overlappingIds.length > 0) {
    const n = r.overlappingIds.length;
    out.push(`${n} other ${n === 1 ? "change" : "changes"} landed on this page at the same time.`);
  }
  if (r.windows.some((w) => w.state === "pending_data")) {
    out.push("Google has not finalized the latest days yet. It reports a few days behind.");
  }
  if (!judgedOnAi && r.confidence === "low" && r.basisDay != null && out.length < 2) out.push("Too few similar pages stood behind this one to call it a sure read.");
  return out.slice(0, 2);
}


/** ONE module surface: the sentence layer exports itself once, not eighteen times. */
export const RESULT_LINES = { AI_MOVE, aiDays, aiHappenedLine, aiMove, aiStory, cap, caveatLines, groupFor, happenedLine, judgedOnAi, liftLabel, nextStepLine, reasonWords, receiptOf, taughtLine, unadjustedLine, workLabel, yardstickOf } as const;
