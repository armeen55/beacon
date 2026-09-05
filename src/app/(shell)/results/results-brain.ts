/** results-brain - WHAT BEACON BELIEVES ABOUT EACH KIND OF WORK ON THIS SITE, derived once, deterministically, from the shipments the surface already holds. Results used to be a ledger wearing a header: "6 wins banked" over a strip saying no reading had been verified, both true under two rules sharing one label. This is the ONE argument the page makes, in four layers: the belief, the field of thoughts, the evidence behind a selected thought, and what is still owed. PURE: no clock reads, no prose from a model, no I/O; hand it the same shipments and it says the same thing. ONE CLASSIFICATION: every row's state comes from RESULT_LINES.rowState, the same rule the ledger below prints, so the
 * belief and the list reconcile by construction rather than by a test. */

import { familyHistoryFromShipments, isMature, signatureOfShipment, treatmentLearning, type TreatmentGroup } from "@/domains/measurement";
import { landsLabel, type ShipmentPresentation } from "./results-presentation";
import { RESULT_LINES } from "./results-lines";
import { pageLabel } from "../changes/types";

const { aiStory, causeWords, groupFor, happenedLine, isRetired, judgedOnAi, liftLabel, liveConfirmed, rawMoveOf, rowState, stateWord } = RESULT_LINES;
type ResultState = ReturnType<typeof rowState>;
type Metric = ShipmentPresentation["read"]["metric"];
type LearningRow = NonNullable<ShipmentPresentation["learning"]>;
/** THE CONFIDENCE CONTRACT, STATED AND DESCRIPTIVE (operator, 2026-09-01): no magic five, and no probability either. A fair-coin
 *  sign test was printed here for a day; it was one-sided after the direction had been chosen from the data, and these reads are one
 *  site's own pages sharing dates, families and algorithm weather, never independent throws. So the Brain says what it can defend: how
 *  many verified reads there are, how many agree, and that a small site-specific sample is consistent, not proven. A record is
 *  called consistent from four verified reads with at most one in five pointing the other way; under four it is an early signal. */
const CONSISTENT_MIN = 4;
const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;
const HISTORICAL = new Set<ResultState>(["historical_ahead", "historical_behind", "historical_unclear"]);
const FINISHED = new Set<ResultState>(["verified_mature", "inconclusive", "confounded", "not_measurable", ...HISTORICAL]);
/** THE EVIDENCE LADDER. Every row stands on exactly ONE rung, in the order evidence is earned, so the sentences under the belief add back to the changes marked done instead of each holding some of the same rows. Why a row cannot be read is named on the row itself. */
const RUNG: ReadonlyArray<readonly [key: "recorded" | "liveConfirmed" | "early" | "mature" | "historical" | "blocked", states: ResultState[], said: string]> = [
  ["recorded", ["recorded", "waiting_verification"], "recorded and not confirmed on the live page yet, so the numbers are context only"],
  ["liveConfirmed", ["live_verified", "reading"], "confirmed on the live page and still being read"], ["early", ["verified_early"], "read at 14 days against pages that were not changed: an early reading, never a win"],
  ["mature", ["verified_mature", "inconclusive"], "read at 28 days, the only reading that may call a win"], ["historical", [...HISTORICAL], "marked done before live checks began, so nothing there trains what gets recommended"],
  ["blocked", ["confounded", "not_measurable"], "blocked or not measurable, and each row names why"],
];

/** One kind of work, as a thought in the field. Every count names its own unit in the words the surface prints. */
type Thought = {
  key: string; family: string | null; name: string;
  /** How sure Beacon may be: nothing verified yet, an early signal, a consistent pattern, or a record that points both ways. */
  confidence: "none" | "early" | "pattern" | "mixed";
  /** What the field draws: the verified sample sizes the node, the historical ring, and whether confirmed readings are in flight. */
  verifiedSample: number; historical: number; inFlight: number;
  shipped: number; liveVerified: number; waitingVerification: number; recorded: number; early: number;
  ahead: number; behind: number; inconclusive: number; confounded: number; notMeasurable: number; overlapping: number;
  historicalAhead: number; historicalBehind: number; historicalUnclear: number;
  /** The yardstick most of the verified reads share, and the middle read in that unit; a click-rate fraction is never printed as clicks. */
  unit: Metric | null; medianEffect: number | null;
  /** The agreement behind the confidence, said as a count and the odds of it by chance, so a small sample reads as one. */
  /** `causes` is what the pages under this one bet were diagnosed with: two causes answered by the same treatment stay separable here. */
  agreement: string | null; pageFamilies: string[]; causes: string[];
  belief: string; strongest: Example | null; counterexample: Example | null; limits: string[]; changeMind: string; watching: string; teaches: string; // `teaches` answers what a reader asks straight after a belief: is this already changing what gets recommended, or is it only on the screen
  /** Keys of thoughts whose changes overlapped this one's on the same page: real combinations off the kernel's own overlap ids. */
  edges: string[];
};
type Example = { id: string; label: string; url: string; line: string; state: ResultState };

export type BrainModel = {
  belief: { headline: string; lines: string[]; confidence: Thought["confidence"] };
  changed: string | null; watching: string[]; thoughts: Thought[];
  /** The one thing to do now, with somewhere to go when the app has that somewhere. */
  nextStep: { text: string; href: string | null };
  /** The ladder, one rung per row and nothing counted twice, so `shipped` is the sum of the six. */
  counts: { shipped: number; recorded: number; liveConfirmed: number; early: number; mature: number; historical: number; blocked: number };
  funnel: ReadonlyArray<{ label: string; ai: boolean; shipped: number; read: number }>; // every yardstick this account has changes on, counted apart and never summed; `read` is the finished readings inside `shipped`
};

const CONF_LABEL: Record<Thought["confidence"], string> = { none: "nothing verified", early: "an early signal", pattern: "a consistent record", mixed: "a split record" };
const FAMILY_NAME: Record<string, string> = { title: "Titles", meta: "Meta descriptions", title_meta: "Titles and meta descriptions", h1: "Page headlines",
  answer: "Answers at the top", link: "Internal links", schema: "Structured data", content: "Page content", new_page: "New pages", full_rewrite: "Full rewrites", other: "Other changes" };
/** THE FIVE YARDSTICKS A CHANGE MAY BE JUDGED ON, IN THE ORDER AN ANSWER IS EARNED: read by an assistant, credited, read and then credited, named, and clicks from Google. Five questions, never one number. Each one's words come from the row's own objective story, so this can never drift into a second vocabulary for the same five things. */
const STAGES = ["ai_retrieval", "ai_citation", "ai_citation_conversion", "ai_mentions", "clicks"] as const;
/** The bet inside the family, in the operator's own words. An unmapped one falls back to the family alone rather than printing its own slug. */
const TREATMENT_NAME: Record<string, string> = { rewrite_existing_section: "rewritten sections", add_answer_section: "added answer sections", title_or_h1: "titles and headlines",
  meta_description: "search descriptions", internal_link_or_navigation: "internal links", technical_reachability: "technical fixes",
  consolidate_or_differentiate: "merged or split pages", factual_correction_batch: "factual corrections", new_page: "new pages" };
/** THE ROW THE RANKING ITSELF LEARNS FROM, carried on the presentation off the canonical record: the signature stamped at the press, the operator's mute, the frozen reading and the stored readings. It was assembled HERE out of the kernel read with the stamp, the mute and the pin all set to null, so every bet collapsed into its coarse family, a muted reading still sized a belief, and the pooled percent that orders the queue and the one this page printed were two different numbers off two different shapes. An older snapshot carries no facts and pools nothing rather than being handed a rebuilt shape. TWO READINGS ARE HELD OUT OF THE CLICK NUMBERS AND KEEP THEIR OWN ROWS: days two edits both moved belong to neither alone, and a change pressed to win a citation is answered on citations, so its Google clicks are context here and never one of the readings this bet is sized on. */
const learningRowOf = (p: ShipmentPresentation, forRanking = false): LearningRow => ((row: LearningRow): LearningRow => (forRanking ? judgedOnAi(p) : p.read.verdict === "confounded" || judgedOnAi(p)) ? { ...row, windows: [] } : row)(p.learning
  ?? { actionType: p.read.actionType, after: null, implementedAt: p.implementedAt, verification: p.verification, operatorVerdictOverride: null, pinnedRead: null, treatmentStamp: null, componentsApplied: null, windows: [] }); /** `forRanking` shapes the row the way the FUNDING door shapes it (decision/load-proposals and produce-proposals both blank an assistant-judged row's windows and nothing else), so the sentence this page prints about what the queue reads is computed off the queue's own input rather than off a stricter one of this page's making. */
/** The family AND treatment this row files under: an answer section added because assistants never read the page and one added because the opening buried the answer are two bets, and they were one node. */
const betOf = (p: ShipmentPresentation): TreatmentGroup => treatmentLearning([{ ...learningRowOf(p), windows: [] }])[0]!;
const exampleOf = (p: ShipmentPresentation, now: Date): Example => ({ id: p.read.id, label: pageLabel(p.read.path || p.read.page), url: p.read.page, state: rowState(p), line: `${happenedLine(p, now)} ${stateWord(p)}.` });
/** The direction a finished read points, off the group the ledger files it under; a shared or level read points nowhere. */
const direction = (p: ShipmentPresentation): "ahead" | "behind" | null => {
  const s = rowState(p), g = groupFor(p);
  return s === "historical_ahead" || (s === "verified_mature" && g === "worked") ? "ahead" : s === "historical_behind" || (s === "verified_mature" && g === "down") ? "behind" : null;
};

const FUNDING_VOTES_AT = 3; /** WHEN A FAMILY'S OWN RECORD STARTS MOVING THE QUEUE. Mirrors decision/rank-proposals' `MIN_FINISHED_READINGS`: under it a record is noise wearing a number and the funding order is unchanged, which is what this page must say rather than implying every reading is already at work. */
function thoughtOf(bet: TreatmentGroup, rows: ShipmentPresentation[], now: Date, edges: string[], pooled: { percent: number | null; readings: number; early: boolean } | null = null, funding: { readings: number; netLift: number } | null = null): Thought {
  const states = rows.map(rowState), count = (s: ResultState) => states.filter((x) => x === s).length, family = bet.family;
  const finished = (p: ShipmentPresentation): boolean => rowState(p) === "verified_mature" && !judgedOnAi(p) && p.learning?.operatorVerdictOverride !== "inconclusive", verified = rows.filter((p) => finished(p) && p.read.comparison !== "site"), blind = rows.filter((p) => finished(p) && p.read.comparison === "site").length; // A READING AGAINST THE SITE'S OWN MOVEMENT SIZES NO BELIEF (reviewer, 2026-09-03): treatment-learning refuses it, so counting it here would have the Brain claim a signal off readings the engine will not learn from. It is named below instead.
  const ahead = verified.filter((p) => direction(p) === "ahead").length, behind = verified.length - ahead, agree = Math.max(ahead, behind);
  // ONE UNIT AT A TIME: a title is read on click rate, a section on clicks, a link on position. Reads are counted by direction across
  // units and sized only inside the unit most of them share.
  const units = verified.map((p) => p.read.metric), unit = [...new Set(units)].sort((a, b) => units.filter((u) => u === b).length - units.filter((u) => u === a).length)[0] ?? null;
  const sized = verified.filter((p) => p.read.metric === unit).map((p) => p.read.lift).sort((a, b) => a - b), m = sized.length >> 1;
  const median = sized.length === 0 ? null : sized.length % 2 ? sized[m]! : (sized[m - 1]! + sized[m]!) / 2;
  const typical = unit != null && median != null ? liftLabel(unit, median) : null;
  const level = count("inconclusive"); // finished live-verified reads that moved nothing: part of the record, never dropped from the count
  const confidence: Thought["confidence"] = verified.length >= CONSISTENT_MIN && verified.length >= level ? (verified.length - agree <= verified.length / 5 ? "pattern" : "mixed") : verified.length > 0 ? "early" : "none";
  // WHERE THIS KIND OF WORK HAPPENED, as context beside the belief: the site's own page families, most rows first.
  const families = [...rows.reduce((m, p) => { const f = `/${(p.read.path || p.read.page || "").replace(/^https?:\/\//, "").split("/").filter(Boolean).find((x, i) => i > 0 || !x.includes(".")) ?? ""}`; return m.set(f, (m.get(f) ?? 0) + 1); }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f === "/" ? "home" : f} (${n})`); // a stored path may carry its host; the family is the first path segment, and EVERY family is carried so the counts add back to the rows
  const causes = [...new Set(rows.map((p) => signatureOfShipment(learningRowOf(p))?.cause).filter((c): c is string => !!c))].map(causeWords).filter(Boolean);
  const historical = rows.filter((p) => HISTORICAL.has(rowState(p))).length, inFlight = rows.filter((p) => p.implementedAt != null && (rowState(p) === "reading" || rowState(p) === "live_verified" || rowState(p) === "verified_early")).length;
  const base = family == null ? "Older, untyped changes" : FAMILY_NAME[family] ?? "Other changes", treatment = bet.treatment ? TREATMENT_NAME[bet.treatment] ?? bet.treatment.replace(/_/g, " ") : null;
  const overlapping = rows.filter((p) => p.read.overlappingIds.length > 0).length, name = treatment ? `${base}: ${treatment}` : base;
  const belief = confidence === "pattern" ? `${name} have finished ${ahead >= behind ? "ahead" : "behind"} in ${agree} of ${plural(verified.length, "verified read")}${typical && typical !== "Level" ? `, typically ${typical.replace(/ (ahead|behind)$/, "")} against pages that were not changed` : ""}. Consistent so far, not proof.`
    : confidence === "mixed" ? `${name} point both ways: ${ahead} verified ${ahead === 1 ? "read" : "reads"} ahead, ${behind} behind. No record is claimed.`
    : confidence === "early" ? `${name}: ${plural(verified.length, "verified read")} so far, ${ahead} ahead and ${behind} behind${typical ? `, ${typical} at the middle` : ""}. A signal, not yet a record.`
    : blind > 0 ? `${name}: ${plural(blind, "finished reading")} that could not be compared. Too few untouched pages matched, so nothing is learned from ${blind === 1 ? "it" : "them"} yet.`
    : historical > 0 ? `${name}: no live-verified reading yet. ${plural(historical, "historical read")} ${historical === 1 ? "gives" : "give"} context only.`
    : inFlight > 0 ? `${name}: no finished reading yet. ${plural(inFlight, "change")} confirmed live and still being read.` : `${name}: nothing verified on the live page yet.`;
  const limits = [...(overlapping > 0 ? [`${plural(overlapping, "reading")} ${overlapping === 1 ? "was" : "were"} taken beside other changes on the same page, so no single edit gets all the credit.`] : []),
    ...(count("waiting_verification") > 0 ? [`${plural(count("waiting_verification"), "reading")} cannot teach: the change was not confirmed on the live page.`] : []),
    ...(historical > 0 ? [`${plural(historical, "historical read")} predate live verification and never train recommendations.`] : []),
    ...(count("confounded") > 0 ? [`${plural(count("confounded"), "reading")} shared ${count("confounded") === 1 ? "its" : "their"} days with a later change and cannot be separated.`] : []), ...(blind > 0 ? [`${plural(blind, "reading")} stood against the rest of the site because too few untouched pages matched, so ${blind === 1 ? "it teaches" : "they teach"} nothing.`] : [])];
  // WHAT THIS KIND OF WORK HAS RETURNED, off the readings the engine actually learns from and said in the one unit that compares across pages: percent of what those pages were already earning. Under three usable readings there is no such number, and then the sentences above stand exactly as they were, because an average of almost nothing is not a measurement and a flat sentence invented for it would read as one. AND IT SAYS WHICH READINGS BUILT IT: this number was printed straight after "no finished reading yet" on a group whose every reading closed at 14 days, because the engine's own `early` answer sat unread beside the percent it handed over.
  const record = pooled?.percent == null ? "" : ` ${name} on this site: about ${pooled.percent >= 0 ? "plus" : "minus"} ${num(Math.abs(pooled.percent))} percent across ${plural(pooled.readings, "reading")}${pooled.early ? ", read early and not yet a record" : ""}.`;
  /* WHAT THIS RECORD CHANGED IN THE NEXT DECISION, IN THE FUNDING DOOR'S OWN RULE AND NOT AS A FEELING (operator, 2026-09-05). "N readings here are already shaping what gets recommended next" stood here: true of the map, false of the queue, because the ranking reads one map of this account's closed readings per family (familyHistoryFromShipments, handed to rank-proposals as `familyHistory`) and that map moves the order in exactly ONE way, three or more closed readings that are DOWN between them ranking the next change of that family below the rest. A good run buys nothing at all: the traffic riding on a change decides the queue and never the kind of change. So the three states are said apart, each with its own number, and an account whose readings move nothing yet reads that way. */
  const learned = funding?.readings ?? 0, net = funding?.netLift ?? 0, closed = plural(learned, "closed reading");
  const teaches = family == null || learned === 0 ? "Nothing here has changed what gets funded next yet." : learned < FUNDING_VOTES_AT ? `${closed} here, and the next change of this kind is funded exactly as before: ${FUNDING_VOTES_AT} closed readings that are down between them is what moves the order.`
    : net < 0 ? `${closed} here are ${plural(-net, "click")} down between them, so the next change of this kind is funded below the rest until one finishes ahead.` : `${closed} here ${net === 0 ? "are level between them" : `are ${plural(net, "click")} up between them`}, and a record that is not down buys no place in the queue: what gets funded next is decided on the traffic riding on each change.`;
  const owed = Math.max(0, CONSISTENT_MIN - verified.length);
  const agreement = verified.length + level === 0 ? null : `${agree} of ${plural(verified.length, "directional verified read")} point the same way${level > 0 ? `, and ${plural(level, "finished verified read")} moved nothing` : ""}. A small sample from one site: ${confidence === "pattern" ? "consistent, not proven" : confidence === "mixed" ? "split, and a split this small can still be noise" : "too few to call a record"}.`;
  const changeMind = confidence === "pattern" ? `Verified reads finishing the other way would turn this back into a split record.`
    : confidence === "mixed" ? `Verified reads that separate consistently, ahead or behind, would make this a consistent record.`
    // AND THE WORD COUNTS WHAT THE PARAGRAPH ABOVE JUST COUNTED (reviewer, 2026-09-03): `owed` counts mature reads only, so a bet standing on three finished 14 day readings called the next one "the first" one sentence after naming all three.
    : `${plural(owed, "more verified 28 day read")} pointing the same way would make this a consistent record; ${owed === CONSISTENT_MIN && count("verified_early") + count("verified_mature") + count("inconclusive") === 0 ? "the first" : "the next"} live-confirmed change finishing its read moves it.`;
  const soon = rows.map((p) => p.read.windows.find((w) => w.day === 28 && w.state !== "closed")?.closesOn ?? null).filter((d): d is string => d != null).sort()[0] ?? null;
  const next = soon ? `The next decision here ${landsLabel(soon, now) ?? "lands soon"}.` : "No decision is open here; the next change marked done starts one."; // AND THE DATE THE NEXT DECISION LANDS IS SAID WHATEVER ELSE IS TRUE: it hung off the in-flight branch alone, so the two states a reader most wants a date on, nothing confirmed yet and everything already read, were the two that never carried one
  const watching = `${inFlight > 0 ? `${plural(inFlight, "confirmed change")} still being read.` : count("waiting_verification") + count("recorded") > 0
    ? `${plural(count("waiting_verification") + count("recorded"), "change")} recorded and not yet confirmed on the live page.` : "Nothing in flight for this kind of work."} ${next}`;
  // EXAMPLES ARE CHOSEN BY DIRECTION, verified before historical, and sized inside one unit: the largest read is not the largest number.
  const pick = (want: "ahead" | "behind"): Example | null => {
    const list = rows.filter((p) => direction(p) === want && !judgedOnAi(p)).sort((a, b) => Number(rowState(b) === "verified_mature") - Number(rowState(a) === "verified_mature"));
    const u = unit ?? list[0]?.read.metric, same = list.filter((p) => p.read.metric === u).sort((a, b) => Math.abs(b.read.lift) - Math.abs(a.read.lift));
    const best = same[0] ?? list[0]; return best ? exampleOf(best, now) : null;
  };
  return { key: bet.key, family, name, confidence, verifiedSample: verified.length, historical, inFlight, shipped: rows.length,
    liveVerified: rows.filter(liveConfirmed).length, waitingVerification: count("waiting_verification"), recorded: count("recorded"), early: count("verified_early"), teaches,
    ahead, behind, inconclusive: count("inconclusive"), confounded: count("confounded"), notMeasurable: count("not_measurable"), overlapping,
    historicalAhead: count("historical_ahead"), historicalBehind: count("historical_behind"), historicalUnclear: count("historical_unclear"), unit, medianEffect: median, agreement, pageFamilies: families, causes,
    belief: belief + record, strongest: pick("ahead"), counterexample: pick("behind"), limits, changeMind, watching, edges };
}

/** THE WHOLE ARGUMENT. Thoughts are ordered by what may be believed first: patterns, then signals, then the largest in flight. */
export function buildResultsBrain(shipments: ReadonlyArray<ShipmentPresentation>, now: Date, actionable: { ready: number | null } = { ready: null }): BrainModel {
  const bets = new Map<string, { bet: TreatmentGroup; rows: ShipmentPresentation[] }>();
  for (const p of shipments) { const bet = betOf(p); bets.set(bet.key, { bet, rows: [...(bets.get(bet.key)?.rows ?? []), p] }); }
  // REAL COMBINATIONS ONLY: two kinds of work are joined when the kernel found their windows overlapping on one page.
  const betById = new Map(shipments.map((p) => [p.read.id, betOf(p).key] as const));
  const edgesOf = (key: string): string[] => [...new Set((bets.get(key)?.rows ?? []).flatMap((p) => p.read.overlappingIds.map((id) => betById.get(id))).filter((k): k is string => !!k && k !== key))];
  const pooled = new Map(treatmentLearning(shipments.map((p) => learningRowOf(p))).map((g) => [g.key, { percent: g.estimate?.percent ?? null, readings: g.sampleSize, early: g.early }] as const)); // the readings ride even where the percent does not: how many the ranking has learned from is a fact under three of them, and only the percent is not
  const funding = familyHistoryFromShipments(shipments.map((p) => learningRowOf(p, true))); // THE EXACT MAP THE QUEUE READS, built here from the same rows and the same rule, so what this page says about the next decision is checkable against the decision itself rather than described
  const thoughts = [...bets].map(([key, g]) => thoughtOf(g.bet, g.rows, now, edgesOf(key), pooled.get(key) ?? null, (g.bet.family != null ? funding.get(g.bet.family) : undefined) ?? null))
    .sort((a, b) => ["pattern", "mixed", "early", "none"].indexOf(a.confidence) - ["pattern", "mixed", "early", "none"].indexOf(b.confidence) || b.verifiedSample - a.verifiedSample || b.inFlight - a.inFlight || b.shipped - a.shipped);
  const states = shipments.map(rowState), c = (s: ResultState) => states.filter((x) => x === s).length;
  // NEWER CHANGES ARE THE ONES WITH A STAMP THAT HAVE NOT FINISHED; a change that predates verification is history however young its read.
  const newer = shipments.filter((p) => p.implementedAt != null && !FINISHED.has(rowState(p))), inFlight = newer.filter(liveConfirmed).length, unconfirmed = newer.length - inFlight;
  const rungs = RUNG.map(([key, held, said]) => [key, held.reduce((n, s) => n + c(s), 0), said] as const);
  const counts = { shipped: shipments.length, ...Object.fromEntries(rungs.map(([key, n]) => [key, n])) } as BrainModel["counts"];
  const funnel = STAGES.map((metric) => ((rows: ShipmentPresentation[]) => ({ label: (rows[0] && aiStory(rows[0])?.[1]) ?? "Clicks from Google", ai: metric !== "clicks", shipped: rows.length, read: rows.filter((p) => ["verified_early", "verified_mature", "inconclusive"].includes(rowState(p))).length }))(shipments.filter((p) => (p.judgedMetric ?? "clicks") === metric))).filter((s) => s.shipped > 0);
  const patterns = thoughts.filter((t) => t.confidence === "pattern"), early = thoughts.filter((t) => t.confidence === "early"), mixed = thoughts.filter((t) => t.confidence === "mixed"), hurting = patterns.find((t) => t.behind > t.ahead) ?? null;
  const confidence: Thought["confidence"] = patterns.length > 0 ? "pattern" : mixed.length > 0 && early.length === 0 ? "mixed" : early.length > 0 ? "early" : "none";
  const openOn = (day: number | null): string | null => shipments.flatMap((p) => p.read.windows.filter((w) => w.state !== "closed" && (day == null || w.day === day)).map((w) => w.closesOn)).filter((d): d is string => d != null).sort()[0] ?? null;
  const soonest = openOn(null), matureOn = openOn(28); // the soonest open read of any length, and the soonest open 28 day one, which is the only read that may call a win and therefore the only date a decision lands on
  const headline = patterns.length > 0 ? `Beacon has a consistent verified record, not yet proof: ${patterns.map((t) => `${t.name.toLowerCase()} ${t.ahead >= t.behind ? "ahead" : "behind"}`).join(", ")}.` // AND THE DIRECTION IS IN THE HEADLINE: four readings that all finished BEHIND printed the same sentence as four that finished ahead, under a green chip, over a step telling the operator to stop shipping it
    : early.length > 0 ? `Beacon has an early verified signal for ${early.map((t) => t.name.toLowerCase()).join(", ")}, not yet a pattern.`
    : counts.shipped === 0 ? "Nothing has been marked done yet, so Beacon has no result to believe." // AN EARLY READING IS A STATE OF ITS OWN AT THE TOP OF THE PAGE TOO: changes read at 14 days sat under "cannot claim a pattern yet", true, and silent about both the reading that exists and the day the first decision on it lands
    : counts.early > 0 ? `${plural(counts.early, "live-confirmed change")} ${counts.early === 1 ? "has" : "have"} an early reading at 14 days and no 28 day decision yet: the first one ${landsLabel(matureOn, now) ?? "starts with the next change marked done"}.`
    : "Beacon cannot claim a live-verified pattern yet.";
  // WHAT MOVED, RAW, BESIDE WHAT THE COMPARISON DID (operator, 2026-09-05): "ahead" is one word for two facts, a page that took more clicks than before and a page that held still while the pages beside it fell, and only the first is traffic anybody gained. Counted over the readings that have closed and carry both figures; a reading missing either is in neither count and the sentence says how many were countable.
  const raw = shipments.filter((p) => !isRetired(p) && rawMoveOf(p) != null && (rowState(p) === "verified_mature" || rowState(p) === "verified_early")).map((p) => rawMoveOf(p)!), gained = raw.filter((m) => m.own > 0).length, onlyPeers = raw.filter((m) => m.own <= 0 && m.peers != null && m.peers < 0).length;
  // THE LADDER IS THE ARGUMENT: one sentence per rung that holds anything, then the line that says they add back, so a reader can check the page against itself.
  const lines = [...rungs.filter(([, n]) => n > 0).map(([, n, said]) => `${plural(n, "change")} ${said}.`),
    ...(counts.shipped > 0 ? [`That is every one of the ${plural(counts.shipped, "change")} marked done, each counted once.`] : []),
    ...(raw.length > 0 ? [`Of ${plural(raw.length, "closed reading")} with both figures on file, ${gained === 0 ? "none is a page that took more clicks than before" : `${num(gained)} ${gained === 1 ? "is a page that took" : "are pages that took"} more clicks than before`}${onlyPeers > 0 ? `, and ${num(onlyPeers)} finished ahead only because the pages compared against ${onlyPeers === 1 ? "it" : "them"} fell` : ""}.`] : []),
    ...(mixed.length > 0 ? [`${mixed.map((t) => t.name).join(", ")} point both ways, so no pattern is claimed there.`] : [])];
  // WHAT CHANGED RECENTLY IS A DIFFERENCE BETWEEN TWO BELIEFS, not a count of rows: the same model is asked what it believed two weeks ago,
  // with every read that closed since then still open, and each thought whose confidence moved is named. The closes are the second sentence.
  const cutoff = now.getTime() - 14 * 86_400_000, closedSince = (p: ShipmentPresentation): boolean => isMature(p.read.basisDay as 28 | null) && [...p.read.windows].some((w) => w.state === "closed" && w.closesOn != null && Date.parse(w.closesOn) > cutoff);
  // A RETIRED RECOMMENDATION IS HISTORY, NOT NEWS: a read that closed under advice Beacon has since taken back is not part of
  // "what finished in the last two weeks", and it may not be the thing the operator is sent to go and publish.
  const recent = shipments.filter((p) => closedSince(p) && !isRetired(p)), earlier = shipments.map((p) => closedSince(p) ? { ...p, read: { ...p.read, basisDay: null, verdict: "waiting" as const, lift: 0 } } : p);
  const then = new Map([...bets].map(([key, g]) => [key, thoughtOf(g.bet, earlier.filter((p) => betOf(p).key === key), new Date(cutoff), []).confidence] as const));
  const moved = thoughts.filter((t) => then.get(t.key) !== t.confidence).map((t) => `${t.name}: ${CONF_LABEL[then.get(t.key) ?? "none"]} two weeks ago, ${CONF_LABEL[t.confidence]} now`);
  const ahead = recent.filter((p) => direction(p) === "ahead").length, behind = recent.filter((p) => direction(p) === "behind").length, hist = recent.filter((p) => HISTORICAL.has(rowState(p))).length;
  const split = [[ahead, "ahead"], [behind, "behind"], [recent.length - ahead - behind, "unclear"]].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`).join(", ");
  const changed = recent.length === 0 ? null : `${moved.length > 0 ? `${moved.join("; ")}. ` : "No belief moved in the last two weeks. "}${plural(recent.length, "read")} finished in that time: ${split}${hist === recent.length ? ", all of them historical" : hist > 0 ? `, ${hist} of them historical` : ""}.`;
  // THE FACTS BEHIND THE LIVE CHECK, said as facts: a page whose live copy differs from the approved words, and a page that could not be read.
  const differs = shipments.filter((p) => p.implementedAt != null && p.verification?.status === "differs" && !isRetired(p)), unread = shipments.filter((p) => p.verification?.status === "blocked" && p.verification.recheckAfter != null).length, lands = soonest ? landsLabel(soonest, now) ?? "lands soon" : null;
  const watching = [...(counts.liveConfirmed > 0 ? [`${plural(counts.liveConfirmed, "change")} confirmed on the live page, whose reads decide the first verified pattern.`] : []),
    ...(lands ? [`The next read ${lands}.`] : []),
    ...(differs.length > 0 ? [`${plural(differs.length, "marked-done change")} ${differs.length === 1 ? "does" : "do"} not yet show on the live page as approved: check ${differs.length === 1 ? "it is" : "they are"} published, and Beacon re-reads ${differs.length === 1 ? "it" : "them"}.`] : []),
    ...(unread > 0 ? [`${plural(unread, "page")} could not be read on the last check; Beacon retries ${unread === 1 ? "it" : "them"}.`] : []),
    ...(unconfirmed > 0 ? [`${plural(unconfirmed, "change")} recorded and not yet confirmed live: their numbers are context only.`] : [])];
  // ALWAYS A NEXT STEP, AND AN IMPERATIVE, OFF ACTIONABLE STATE (truth review, 2026-09-01): a kind of work that keeps finishing behind is read before more of it ships; then
  // the finished changes the release serves on Changes; then a page whose live copy differs; otherwise the wait, which names the date it ends on, or the reason it has not, and never runs the two into one broken sentence.
  const nextStep = hurting ? { text: `${hurting.name} have finished behind in ${hurting.behind} of ${plural(hurting.verifiedSample, "verified read")}. Open that kind of work above, read the example under it, and hold off repeating it until one finishes ahead.`, href: null }
    : actionable.ready != null && actionable.ready > 0 ? { text: `Make the ${plural(actionable.ready, "finished change")} waiting on Changes; each one starts its read the day you mark it done.`, href: "/changes" }
    : differs.length > 0 ? { text: `Check that ${differs.length === 1 ? "the marked-done change on" : `the ${differs.length} marked-done changes on`} ${[...new Set(differs.map((p) => p.read.path || p.read.page))].slice(0, 2).join(" and ")} ${differs.length === 1 ? "is" : "are"} published as approved; Beacon re-reads ${differs.length === 1 ? "it" : "them"} after that.`, href: `#change-${differs[0]!.read.id}` }
    : lands ? { text: `The next read ${lands}${lands.startsWith("lands") ? ", so nothing is needed until then" : ", and it lands as soon as those numbers do"}. Mark the next change done on Changes and its read starts that day.`, href: "/changes" }
      : { text: "Mark the next change done on Changes; its read starts from that day.", href: "/changes" };
  return { belief: { headline, lines, confidence }, changed, watching, thoughts, counts, funnel, nextStep };
}
