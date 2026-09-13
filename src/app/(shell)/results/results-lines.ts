import "server-only";

/** results-lines - every SENTENCE the Results surface says about one measured change: the labels, the
 *  predicates that pick a row's direction, and the writers of happened/taught/next. Split from
 *  results-presentation at its ceiling; that file imports THIS, and this imports only helpers back. */

import type { CauseFinding } from "@/domains/decision";
import { MIN_FINISHED_READINGS } from "@/domains/decision"; // THE FUNDING DOOR'S OWN NUMBER, IMPORTED: a copy of it is a second answer waiting to disagree
import type { ControlReceipt } from "@/domains/measurement";
import { isMature as kernelIsMature, treatmentLearning, type TreatmentGroup } from "@/domains/measurement";
import { monthDayLabel } from "@/components/data/receipt-line";
import type { KernelRead } from "@/domains/measurement";
import { groupOf, landsLabel, nextCloseOn, type ResultsGroup, type ShipmentPresentation } from "./results-presentation";

type LearningRow = Parameters<typeof treatmentLearning>[0][number];
/** This account's closed readings for one row, and WHICH record answered: its own kind of work, or the whole family. */
type Funding = { readings: number; netLift: number; of: "kind" | "family" } | null;
const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const isMature = (d: number | null): boolean => kernelIsMature(d as 7 | 14 | 28 | 56 | null), countsForLearning = (d: number | null): boolean => d != null && d >= 14; // TWO DIFFERENT QUESTIONS SINCE 2026-09-03: what the engine may learn from is a window closed at 14 days or beyond (treatment-learning), and what may be called a win is still the 28 day read alone.

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

/** What the proposal said was wrong with the page. TOTAL OVER THE CAUSE LADDER, and the compiler is the pin: this map held thirteen of the sixteen causes, so `factual_error` (its own lever set, its own gap kind, its own entry in the Brain's treatment names, and the four name-meaning corrections this account is shipping right now) silently vanished out of every place a cause is named. The two that are not page defects map to nothing on purpose and drop out where causes are listed. */
const CAUSE_LABEL: Record<CauseFinding["cause"], string> = {
  cannibalization: "two of your own pages competing for the same search", ctr_snippet: "the line searchers saw not matching what they typed", competitor_content_gap: "the pages beating you answering something yours did not",
  incomplete_coverage: "the page answering part of the question and stopping", weak_opening: "the page taking too long to answer", serp_shape_shift: "the results page changing shape around you",
  intent_shift: "people wanting something different from that search", internal_link_weakness: "the rest of your site barely pointing at this page", ai_citation_gap: "AI assistants answering the question without crediting you",
  factual_error: "statements on this page that independent sources contradict", demand_decline: "fewer people searching for this at all", ranking_loss: "the page sliding down the results",
  retrieved_not_cited: "AI assistants reading your page and crediting someone else", technical_indexability: "search engines not being able to read the page properly", measuring_change: "", no_problem: "",
};
/** THE ONE READER OF THAT MAP, because a stored cause is a plain string: a value the ladder does not carry reads as unnamed rather than disappearing, which is how a real cause went missing without one surface saying so. */
const causeWords = (cause: string | null | undefined): string => !cause ? "" : CAUSE_LABEL[cause as CauseFinding["cause"]] ?? "something not named yet";

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

/** THE ONE TRUTH VOCABULARY (operator, 2026-09-01), AND THE RUNG EACH ROW STANDS ON. Every row is exactly one of these, derived from the SAME
 *  group the ledger files it under, so the Brain above the list and the list itself can never disagree by construction. Legacy first: a row
 *  with no stamp predates live verification and can only ever be history. Then verification: a reading nobody confirmed live is a number
 *  nobody may learn from. TWO READINGS AND NEVER ONE WORD (2026-09-03): the one closing at 14 days against matched pages is what the engine
 *  starts learning from and says early wherever it appears, and the 28 day one alone may call a win; both wore "early signal" over the other. */
type ResultState = "recorded" | "waiting_verification" | "live_verified" | "reading" | "historical_ahead" | "historical_behind"
  | "historical_unclear" | "verified_early" | "verified_mature" | "confounded" | "inconclusive" | "not_measurable";
const STATE_LABEL: Record<ResultState, string> = { recorded: "Recorded", waiting_verification: "Waiting for live verification",
  live_verified: "Live verified", reading: "Reading", historical_ahead: "Historical read ahead", historical_behind: "Historical read behind",
  historical_unclear: "Historical unclear", verified_early: "Early reading at 14 days", verified_mature: "Verified at 28 days",
  confounded: "Shared with a later change", inconclusive: "Inconclusive", not_measurable: "Not measurable" };
/** Use the same applied-unit qualification as ranking, never a status label alone. */
const liveConfirmed = (p: ShipmentPresentation): boolean => treatmentLearning([{ ...learningRowOf(p), implementedAt: p.implementedAt, verification: p.verification, windows: [] }])[0]?.verified === 1;
/** THE ONE TEST FOR A RETIRED RECOMMENDATION, so the chip, the belief and the next step can never disagree about which rows are history. */
const isRetired = (p: ShipmentPresentation): boolean => p.recommendation?.state === "retired";
/** WHY THE RECOMMENDATION BEHIND A CHANGE NO LONGER STANDS, one plain sentence each. A finished reading closing the queue's own
 *  loop never lands here: that reading is what the row already prints, and calling it a retirement would deny a result this
 *  surface just claimed. */
const RETIRED_WHY: Record<string, string> = {
  withdrawn: "The recommendation behind this was taken back after the change was marked done.",
  superseded: "A newer recommendation replaced this one after the change was marked done.",
  dismissed: "The recommendation behind this was set aside after the change was marked done.",
  gone: "No recommendation stands behind this change any more.",
};
/** SAID WITHOUT HIDING ANYTHING: the change stays in history, its read stays on the row, and whether that read still teaches is
 *  the live check's answer rather than the retirement's. No cause is claimed in either direction. */
const retiredChip = (p: ShipmentPresentation): { text: string; note: string } | null => !isRetired(p) ? null
  : { text: "Recommendation later retired",
    note: `${RETIRED_WHY[p.recommendation?.disposition ?? "gone"] ?? RETIRED_WHY.gone} The change stays in history and its read stays on this row. ${liveConfirmed(p) ? "The live page confirmed it, so the read still counts." : "Nothing here teaches current work: the live page never confirmed it."}` };
function rowState(p: ShipmentPresentation): ResultState {
  const r = p.read, onAi = judgedOnAi(p), group = groupFor(p), legacy = p.implementedAt == null;
  if (p.ai?.terminal === true || (r.metric === "unclassified" && !onAi)) return "not_measurable";
  // A SHIPMENT THE LIVE PAGE CAN NEVER CONFIRM IS NOT WAITING: the verifier's terminal "blocked" with no recheck (the words it was meant
  // to read were never stored) can never teach, so it is named as such instead of standing as recorded for ever.
  if (!legacy && p.verification?.status === "blocked" && p.verification.recheckAfter == null) return "not_measurable";
  if (group !== "reading" && !onAi && (r.verdict === "confounded" || r.overlappingIds.length > 0)) return "confounded";
  if (group === "reading") {
    const started = onAi ? (p.ai?.daysElapsed ?? 0) > 0 : r.basisDay != null;
    if (legacy) return "reading";
    if (!liveConfirmed(p)) return started ? "waiting_verification" : "recorded";
    // A READING THAT CLOSED AT 14 DAYS AGAINST MATCHED PAGES IS NOT "still reading": it is the first reading the engine learns from, and hiding it under Reading meant nothing on screen ever showed the evidence the ranking had already taken. The 28 day window is still open, so it says early and claims nothing.
    return !started ? "live_verified" : !onAi && countsForLearning(r.basisDay) && r.comparison === "fair" ? "verified_early" : "reading";
  }
  if (legacy) return group === "worked" ? "historical_ahead" : group === "down" ? "historical_behind" : "historical_unclear";
  if (!liveConfirmed(p)) return "waiting_verification";
  return group === "flat" ? "inconclusive" : "verified_mature";
}
const stateWord = (p: ShipmentPresentation): string => STATE_LABEL[rowState(p)];
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
  if (metric === "ctr") { const pp = Math.abs(Math.round(lift * 1000) / 10); return `${pp} point${pp === 1 ? "" : "s"} of click rate`; }
  const n = metric === "position" ? Math.round(Math.abs(lift) * 10) / 10 : Math.abs(Math.round(lift));
  return `${n} ${metric === "position" ? "rank" : "click"}${n === 1 ? "" : "s"}`;
}

/** The short signed number for one row, compact enough to sit on one line. */
function liftLabel(metric: KernelRead["metric"], lift: number): string {
  if (Math.abs(lift) < 1e-9) return "Level";
  const size = liftSize(metric, lift).replace("points of click rate", "click rate").replace("point of click rate", "click rate");
  return `${lift > 0 ? "+" : "-"}${size} ${lift > 0 ? "ahead" : "behind"}`;
}

/** WHY A READING IS NOT A CONFIRMATION, one phrase per typed cause the verifier now names (measurement/verify-shipment). SEVEN causes printed "its exact words were never stored", true of exactly one of them: a robots refusal, a site that did not answer, a page that builds itself in the browser and a spent recheck all told the operator their copy was missing. Beacon owns the reads it could not take and says it retries; the operator owns only a publish that has not happened and wording that went live differently, and that row quotes their own page back to them. */
const WHY_UNCONFIRMED: Record<string, string> = {
  not_published_yet: "Not on the live page yet", published_differently: "Measured on your own wording, not Beacon's", page_unreachable: "Your site did not answer; Beacon tries again", address_mismatch: "No page at that address", stale_reading: "The copy on file predates this change",
  rendered_content_gap: "Built in the browser, so it could not be read", applied_wording_missing: "Its exact words were never stored", google_not_updated: "Live on your page; Google has not caught up", unmeasurable: "Your robots rules ask for this page not to be read",
};

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
  p.read.comparison === "site" ? "the rest of the site" // too few untouched pages matched, so the site's own movement is what this stood against
    : receiptOf(p).length > 0 ? "similar pages that were not changed" : "pages that were not changed";

/** WHAT THIS PAGE'S OWN CLICKS CAN PROVE, SAID BEFORE THE FIRST READ AND AGAIN WHEN ONE LANDS UNDER IT (2026-09-03). Two stretches of
 *  counted days swing against each other on their own, and the fewer the clicks the wider that swing: a page taking five a day cannot
 *  tell a third of its traffic apart from an ordinary month, while a real edit moves five to fifteen percent. So the plan is stated at
 *  ship time in the page's own number, and a settled reading that came in under it says so instead of offering the movement as a
 *  result. The kernel owns the floor (measurement/detectable-lift); these two write it down. A level reading claims no effect and is
 *  left alone; what carries forward is the row's own taught line, which already says whether this reading trains anything. */
const wholePct = (v: number): number => Math.round(v * 100);
/** WAITING ON GOOGLE, NOT ON A CLOCK BEACON OWNS. Roughly two in five edited pages are not recrawled inside a week, and until Google reads
 *  the new copy no window may run (measurement/measure-lifecycle's crawlClock), so the row says what it is waiting for and promises no date
 *  at all rather than a date its own reading will not honour. */
const awaitingLine = (stamp: string, now: Date): string => {
  const n = Math.max(0, Math.floor((now.getTime() - Date.parse(`${stamp}T00:00:00Z`)) / 86_400_000));
  return `Waiting for Google to recrawl this page, changed ${n} ${n === 1 ? "day" : "days"} ago.`;
};
const planLine = (r: KernelRead): string => r.metric !== "clicks" ? ""
  : r.ownProof.floor == null ? " Clicks are read after 28 days; this page has too few of them to show a change of any size on its own, so what it does is read across the batch."
    : ` Clicks are read after 28 days; this page can show a change of about ${wholePct(r.ownProof.floor)} percent or more on its own; smaller movement is read across the batch.`;
const cannotProveLine = (r: KernelRead, peers: string): string | null =>
  r.metric !== "clicks" || !isMature(r.basisDay) ? null
    : r.ownProof.floor == null ? `Ran ${r.basisDay} days. Too few clicks on this page for a change of any size to show, so no result is claimed for it on its own.`
      : r.ownProof.unprovenHere && r.verdict !== "no_clear_movement"
        ? `Ran ${r.basisDay} days. ${liftSize(r.metric, r.lift)} ${r.lift > 0 ? "ahead of" : "behind"} ${peers}, which this page's own clicks cannot prove: about ${wholePct(r.ownProof.floor)} percent is the least a change here can show, and this one is ${wholePct(r.ownProof.move ?? 0)} percent.` : null;

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
  const d = aiDays(p), move = aiMove(p), ran = d >= 28 ? "Ran 28 days." : `${d} ${d === 1 ? "day" : "days"} in.`;
  if (move) return `${ran} ${aiStory(p)[1]} ${AI_MOVE[move]}.`;
  return d > 0 ? `${ran} The AI answers for this change's own searches do not add up to a direction yet.` : "Nothing read yet on the AI answers for this change's own searches.";
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
    const held = r.basisDay == null ? "" : ` Estimated lift: ${liftSize(r.metric, r.lift)} ${r.lift > 0 ? "ahead of" : "behind"} ${peers}, held as shared credit rather than a win.`;
    const day = monthDayLabel(r.cleanUntil), n = r.overlappingIds.length;
    if (day) return `This page changed again on ${day}, so the days after that belong to both changes.${held}`;
    return `${n} other ${n === 1 ? "change" : "changes"} landed on this page at the same time, so the credit is shared.${held}`;
  }
  if (r.basisDay == null) {
    if (r.awaitingCrawl) return awaitingLine(r.awaitingCrawl, now);
    const next = landsLabel(r.promisedRead ?? nextCloseOn(r), now); // the crawl clock where Google has started one, so this date and Today's are one date
    return `${next ? `Nothing read yet. The first result ${next}.` : "Nothing read yet. The first result lands once a read closes."}${planLine(r)}`;
  }
  // TOO FEW PAGES TO STAND BEHIND IT IS NOT TOO LITTLE DATA: the days ran and the page moved, and the pair below shows it.
  if (r.verdict === "insufficient_evidence") {
    return r.comparison === "insufficient"
      ? `Ran ${r.basisDay} days. A fair comparison is not available: too few pages on this site can stand behind this one.`
      : `Ran ${r.basisDay} days, and there is too little Google data on this page to call it.`;
  }
  // AND WHAT THIS PAGE COULD EVER SHOW ON ITS OWN, asked before its movement is offered as a result.
  const alone = cannotProveLine(r, peers);
  if (alone) return alone;
  // ESTIMATED, NEVER CAUSED: the number compares against pages left alone, so no sentence says the change added anything.
  const estimate = r.verdict === "no_clear_movement" ? `Estimated lift: level with ${peers}` : `Estimated lift: ${liftSize(r.metric, r.lift)} ${r.lift > 0 ? "ahead of" : "behind"} ${peers}`;
  return isMature(r.basisDay) ? `Ran ${r.basisDay} days. ${estimate}.` : `${r.basisDay} days in. ${estimate}.`;
}

/** THE PAGE'S OWN MOVEMENT BESIDE THE ADJUSTED COMPARISON, ON EVERY READING THAT HAS ONE (operator, 2026-09-05). This printed only where no fair comparison existed, so on a fair one the screen showed the adjusted number alone and A PAGE GAINING TRAFFIC AND A PAGE OUTPERFORMING A FALLING COMPARISON WERE ONE SENTENCE: five live readings reported plus 75 clicks while the pages measured against them fell 75 and the page itself never moved at all. Both facts are printed now, and the third sentence says which of the two happened, in the operator's words. Printed only when the kernel exposes the unadjusted pair; the comparison's own movement comes off the stored window and the clause drops when no window carries it. Nothing is scaled, guessed or filled in here, and a row judged on assistants says nothing, because its clicks are context and its own story is told above. */
const rawMoveOf = (p: ShipmentPresentation): { own: number; peers: number | null } | null => p.read.unadjusted == null || judgedOnAi(p) ? null
  : { own: p.read.unadjusted.clicksAfter - p.read.unadjusted.clicksBefore, peers: (p.learning?.windows ?? []).find((w) => w.day === p.read.unadjusted!.basisDay)?.controlDelta ?? null };
function unadjustedLine(p: ShipmentPresentation): string | null {
  const u = p.read.unadjusted, m = rawMoveOf(p); if (!u || !m) return null;
  const own = `This page went from ${num(u.clicksBefore)} to ${num(u.clicksAfter)} clicks, ${m.own === 0 ? "flat" : m.own > 0 ? `up ${num(m.own)}` : `down ${num(-m.own)}`}`;
  const peersMoved = m.peers == null ? null : m.peers === 0 ? "did not move" : m.peers < 0 ? `fell ${num(-m.peers)}` : `rose ${num(m.peers)}`; /* THE GAP CLAIM IS ONLY TRUE IN CLICKS (reviewer, 2026-09-05): five live readings are judged on click rate, and "0.7 points of click rate is the gap between those two click movements" is arithmetic that does not hold */
  const reading = p.read.basisDay == null || p.read.verdict === "waiting" ? "" : p.read.metric === "clicks" ? ` This reading reports ${liftSize(p.read.metric, p.read.lift)}, which is the gap between those two movements and not clicks this change won.`
    : ` The reading itself is ${liftSize(p.read.metric, p.read.lift)}, judged on a different measure from the clicks above, and it is not clicks this change won.`;
  // WHICH OF THE TWO HAPPENED, SAID OUTRIGHT: a page that took more clicks than before is a different fact from a page that held still while everything around it fell, and "ahead" was the only word both ever got.
  const which = p.read.metric !== "clicks" || m.peers == null || m.peers >= 0 ? "" : m.own > 0 ? " This page took more clicks than before and the pages compared against it took fewer, so both are true of it." : " Finishing ahead here is the comparison falling further, not traffic this page gained."; // ASKED ONLY OF A READING JUDGED ON CLICKS (reviewer, 2026-09-05): on a click rate or a position read, "finishing ahead" would name a verdict those clicks never decided, and the clause below already says the reading is on another measure
  return peersMoved == null ? `${own}, unadjusted: the site moved too.` : `${own}, while the pages compared against it ${peersMoved}.${which}${reading}`;
}

/** THE ROW THE FUNDING DOOR ITSELF LEARNS FROM, carried on the presentation off the canonical record: the signature stamped at the press, the operator's mute, the frozen reading and the stored readings. An older snapshot carries no facts and pools nothing rather than being handed a rebuilt shape. TWO READINGS ARE HELD OUT OF THE CLICK NUMBERS AND KEEP THEIR OWN ROWS: days two edits both moved belong to neither alone, and a change pressed to win a citation is answered on citations, so its Google clicks are context here and never one of the readings this bet is sized on. `forRanking` shapes the row exactly as the funding door shapes it (decision/load-proposals and produce-proposals both blank an assistant-judged row's windows and nothing else), so what this surface says about the queue is computed off the queue's own input. MOVED HERE FROM THE BELIEF ABOVE THE LIST (2026-09-05), because the rows underneath it need the same shape and a second copy is a second answer. */
const learningRowOf = (p: ShipmentPresentation, forRanking = false): LearningRow => ((row: LearningRow): LearningRow => (forRanking ? judgedOnAi(p) : p.read.verdict === "confounded" || judgedOnAi(p)) ? { ...row, windows: [] } : row)(p.learning
  ?? { actionType: p.read.actionType, after: null, implementedAt: p.implementedAt, verification: p.verification, operatorVerdictOverride: null, pinnedRead: null, treatmentStamp: null, componentsApplied: null, windows: [] });
/** The family AND treatment one row files under: an answer section added because assistants never read the page and one added because the opening buried the answer are two bets, and they were one node. */
const betOf = (p: ShipmentPresentation): TreatmentGroup => treatmentLearning([{ ...learningRowOf(p), windows: [] }])[0]!;
/** WHOSE RECORD ANSWERS FOR THIS ROW, asked of the ONE map the queue reads (measurement/treatment-learning), in the ONE order every consumer asks it: this exact kind of work first, the whole family it belongs to only where the finer record holds nothing at all. A family is not a bet, and reading one as the other is what let nine internal links that finished behind discount every link this account will ever ship. */
const fundingFor = (map: ReadonlyMap<string, { readings: number; netLift: number }> | null | undefined, p: ShipmentPresentation): Funding => {
  const bet = betOf(p), fine = map?.get(bet.key); if (fine) return { ...fine, of: "kind" };
  const whole = bet.family == null ? undefined : map?.get(bet.family); return whole ? { ...whole, of: "family" } : null; };
/** WHAT THIS RECORD HAS CHANGED IN WHAT GETS FUNDED NEXT, in the funding door's own rule and in ONE spelling. The belief above the list and every row under it said this in their own words off the same map, which is two answers waiting to disagree. The order moves in exactly one way: three or more closed readings that are down between them rank the next change of that kind below the rest, and a good run buys nothing at all, because the traffic riding on a change decides the queue and never the kind of change. */
function fundingLine(record: Funding): string {
  const which = record?.of === "family" ? "this whole family of changes" : "this exact kind of change";
  const learned = record?.readings ?? 0, net = record?.netLift ?? 0, closed = `${num(learned)} closed reading${learned === 1 ? "" : "s"}`;
  if (learned === 0) return "Nothing here has changed what gets funded next yet.";
  if (learned < MIN_FINISHED_READINGS) return `${closed} of ${which} here, and the next one is funded exactly as before: ${MIN_FINISHED_READINGS} closed readings that are down between them is what moves the order.`;
  if (net < 0) return `${closed} of ${which} here are ${num(-net)} click${net === -1 ? "" : "s"} down between them, so the next one is funded below the rest until one finishes ahead.`;
  return `${closed} of ${which} here ${net === 0 ? "are level between them" : `are ${num(net)} click${net === 1 ? "" : "s"} up between them`}, and a record that is not down buys no place in the queue: what gets funded next is decided on the traffic riding on each change.`;
}

/** WHAT THE OPERATOR ACTUALLY DID, AND WHAT THE LIVE PAGE SAID ABOUT IT (2026-09-05). One paragraph carried this and the reading together, so "the page moved up after it" sat in the same breath as "never confirmed on the live page" and nothing on the row told what happened to the PAGE apart from what the reading TAUGHT. This sentence answers only the first: what was applied, when, whose wording is on the page, what the live check found, and whether the page has moved again since. The typed cause the verifier names is what speaks, so a page that builds itself in the browser says it could not be read and never says the words were missing. */
function executionLine(p: ShipmentPresentation): string {
  const day = monthDayLabel(p.implementedAt), own = (p.applied ?? []).length > 0 ? ", in your own wording" : "";
  const applied = p.implementedAt == null ? "Marked done before the day it was applied was recorded" : `Applied on ${day ?? "the day it was recorded"}${own}`;
  const v = p.verification, why = v?.reason ? WHY_UNCONFIRMED[v.reason] : null;
  const checked = v == null ? "It has not been read on the live page yet."
    : v.status === "verified" || v.status === "partially_verified" ? `${v.status === "partially_verified" ? "Part of it was confirmed" : "Confirmed"} on the page on ${monthDayLabel(v.checkedAt) ?? "the day it was read"}.`
      : why ? `${why}.` : v.status === "not_found" ? "Not found on the page." : "It could not be read on the page.";
  const again = p.read.cleanUntil ? ` The page changed again on ${monthDayLabel(p.read.cleanUntil) ?? "a later day"}.` : "";
  return `${applied}. ${checked}${again}`;
}

/** What this read carries forward, plus how much stands behind it. Clauses drop rather than guess. THE OUTCOME CLAUSE IS THE ROW'S OWN
 *  YARDSTICK: a change judged on citations carried "the page did not clearly move" out of Google into the lesson, and that lesson is what
 *  gets recommended next on pages like this one. */
function taughtLine(p: ShipmentPresentation): string {
  const r = p.read, l = r.learning;
  // A SCHEMA ROW IS STRUCTURED DATA ON THE ROW AS IT IS IN THE BRAIN: the technical family also holds forwards and canonicals.
  const family = /schema|json.?ld|structured/i.test(r.actionType) ? "a structured data change" : FAMILY_LABEL[l.actionFamily];
  const cause = causeWords(l.diagnosisCause);
  const ai = judgedOnAi(p) ? aiMove(p) : null;
  // SETTLED MEANS WHAT TRAINS: treatment-learning takes a closed 14 day window with a nonzero read, so the first reading carries forward on day 14 and a 7 day lean or a level read still carries nothing. The win itself is called at 28 and nowhere earlier. BLIND is the reading measured against the site's own movement: too few untouched pages matched, and on a day a whole family ships that comparison subtracts the shared gain from itself, so treatment-learning refuses it however long it ran and this row may not promise otherwise.
  const blind = !judgedOnAi(p) && r.comparison === "site", settled = judgedOnAi(p) ? ai != null : !blind && !!l.outcomeDirection && l.outcomeDirection !== "unclear" && countsForLearning(r.basisDay) && r.lift !== 0;
  const moved = judgedOnAi(p) ? (ai ? `${aiStory(p)[2]} ${AI_MOVE[ai]}` : "it is too early to say which way this went")
    : l.outcomeDirection === "up" ? "the page moved up after it" : l.outcomeDirection === "down" ? "the page moved down after it"
      : l.outcomeDirection === "flat" ? "the page did not clearly move" : "it is too early to say which way this went";
  const parts: string[] = [];
  if (cause) parts.push(`this page read as ${cause}`);
  if (family) parts.push(`it was answered with ${family}`);
  parts.push(moved);
  // NOTHING IS CARRIED FORWARD FROM A READ THAT HAS NOT LANDED, AND NOTHING TRAINS FROM A CHANGE NEVER CONFIRMED ON THE LIVE PAGE: the kernel learns only from live-confirmed changes, so a row may not promise otherwise (Results Brain, 2026-09-01). A blind read is named first, because "until it settles" would promise a lesson that is never coming.
  const carried = blind ? "Nothing is learned from this one. Too few untouched pages matched it, so the comparison was the rest of the site, and that cannot tell a gain this change made from one the whole site shared."
    : !settled ? (judgedOnAi(p) || countsForLearning(r.basisDay) ? "Nothing carries forward from this one until it settles." : "Nothing carries forward from this one until the 14 day reading lands.")
      : !liveConfirmed(p) ? "Context only: a read never confirmed on the live page does not shape what gets recommended."
        : `That carries into what gets recommended next on pages like this one.${judgedOnAi(p) || isMature(r.basisDay) ? "" : " A win is only called at 28 days."}`;
  const backing = typeof l.evidenceCompleteness === "number" && l.evidenceCompleteness > 0 ? `Backed by ${l.evidenceCompleteness} check${l.evidenceCompleteness === 1 ? "" : "s"}.` : "Read once so far.";
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
/** A READ NOBODY CONFIRMED LIVE RECOMMENDS NOTHING (truth review, 2026-09-01): seven unverified rows were telling the operator to put a title back. */
const unconfirmedStep = (p: ShipmentPresentation): string => p.implementedAt == null
  ? "Context only: this read predates live verification, so nothing is recommended from it."
  : "Confirm the change on the live page first; nothing is recommended from an unverified read.";
function nextStepLine(p: ShipmentPresentation, now: Date = new Date()): string {
  const r = p.read;
  if (judgedOnAi(p)) {
    const [, , , target, down, flat] = aiStory(p), move = aiMove(p);
    if (move != null && !liveConfirmed(p)) return unconfirmedStep(p);
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
  if (p.implementedAt != null && p.verification?.status === "blocked" && p.verification.recheckAfter == null) return `Nothing can be read on this one. ${WHY_UNCONFIRMED[p.verification.reason ?? ""] ?? "The live page could not confirm it"}. Make the next change on this page and measure that.`;
  if (r.verdict === "confounded") return "Two changes share these days. Make the next change on this page on its own, then measure it.";
  const d = r.learning.outcomeDirection;
  if (d !== "unclear" && !liveConfirmed(p)) return unconfirmedStep(p);
  // THE TECHNICAL FAMILY ALSO HOLDS STRUCTURED DATA AND CANONICALS: only a redirect row may be told to reverse a redirect.
  if (d === "down" && r.learning.actionFamily === "technical-family" && !/redirect/i.test(r.actionType)) return "This page lost ground after the technical change. Undo it only if the loss holds on the next read; otherwise leave it and measure again.";
  if (d !== "unclear") return (NEXT_STEP[r.learning.actionFamily] ?? GENERIC_NEXT)[d === "up" ? 0 : d === "down" ? 1 : 2];
  if (r.awaitingCrawl) return "Nothing to do until Google reads this page again.";
  const next = landsLabel(r.promisedRead ?? nextCloseOn(r), now);
  return next == null ? "Nothing to do until the next read lands."
    : next.startsWith("lands") ? `Nothing to do until the next read ${next}.`
      : "Nothing to do; the next read is overdue because Google reports a few days behind.";
}

/** At most two, and only the ones this row actually carries. `judgedOnAi` drops the one caveat that is purely about the Google
 *  comparison: "too few similar pages stood behind this one" is an unlabelled doubt cast over a verdict those pages did not decide. */
function caveatLines(r: KernelRead, judgedOnAi: boolean): string[] {
  const out: string[] = [], day = monthDayLabel(r.cleanUntil), n = r.overlappingIds.length;
  if (day) out.push(`This page changed again on ${day}. The days after that belong to both changes.`);
  else if (n > 0) out.push(`${n} other ${n === 1 ? "change" : "changes"} landed on this page at the same time.`);
  if (r.windows.some((w) => w.state === "pending_data")) out.push("Google has not finalized the latest days yet. It reports a few days behind.");
  if (!judgedOnAi && r.confidence === "low" && r.basisDay != null && out.length < 2) out.push("Too few similar pages stood behind this one to call it a sure read.");
  return out.slice(0, 2);
}

/** ONE module surface: the sentence layer exports itself once, not eighteen times. */
export const RESULT_LINES = { AI_MOVE, WHY_UNCONFIRMED, betOf, causeWords, executionLine, fundingFor, fundingLine, learningRowOf, aiDays, aiHappenedLine, aiMove, aiStory, cap, caveatLines, groupFor, happenedLine, isRetired, judgedOnAi, liftLabel, liveConfirmed, nextStepLine, rawMoveOf, reasonWords, receiptOf, retiredChip, rowState, stateWord, taughtLine, unadjustedLine, workLabel, yardstickOf } as const;
