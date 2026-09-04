/** results-brain - WHAT BEACON BELIEVES ABOUT EACH KIND OF WORK ON THIS SITE, derived once, deterministically, from the shipments the surface already holds. Results used to be a ledger wearing a header: "6 wins banked" over a strip saying no reading had been verified, both true under two rules sharing one label. This is the ONE argument the page makes, in four layers: the belief, the field of thoughts, the evidence behind a selected thought, and what is still owed. PURE: no clock reads, no prose from a model, no I/O; hand it the same shipments and it says the same thing. ONE CLASSIFICATION: every row's state comes from RESULT_LINES.rowState, the same rule the ledger below prints, so the
 * belief and the list reconcile by construction rather than by a test. */

import { isMature as kernelIsMature, treatmentLearning } from "@/domains/measurement";
import { landsLabel, type ShipmentPresentation } from "./results-presentation";
import { RESULT_LINES } from "./results-lines";
import { pageLabel } from "../changes/types";

const { groupFor, happenedLine, isRetired, judgedOnAi, liftLabel, liveConfirmed, rowState, stateWord } = RESULT_LINES;
type ResultState = ReturnType<typeof rowState>;
type Metric = ShipmentPresentation["read"]["metric"];
/** THE CONFIDENCE CONTRACT, STATED AND DESCRIPTIVE (operator, 2026-09-01): no magic five, and no probability either. A fair-coin
 *  sign test was printed here for a day; it was one-sided after the direction had been chosen from the data, and these reads are one
 *  site's own pages sharing dates, families and algorithm weather, never independent throws. So the Brain says what it can defend: how
 *  many verified reads there are, how many agree, and that a small site-specific sample is consistent, not proven. A record is
 *  called consistent from four verified reads with at most one in five pointing the other way; under four it is an early signal. */
const CONSISTENT_MIN = 4;
const isMature = (d: number | null): boolean => kernelIsMature(d as 7 | 14 | 28 | 56 | null);
const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;
const HISTORICAL = new Set<ResultState>(["historical_ahead", "historical_behind", "historical_unclear"]);
const FINISHED = new Set<ResultState>(["verified_early", "inconclusive", "confounded", "not_measurable", ...HISTORICAL]);

/** One kind of work, as a thought in the field. Every count names its own unit in the words the surface prints. */
type Thought = {
  key: string; family: string | null; name: string;
  /** How sure Beacon may be: nothing verified yet, an early signal, a consistent pattern, or a record that points both ways. */
  confidence: "none" | "early" | "pattern" | "mixed";
  /** What the field draws: the verified sample sizes the node, the historical ring, and whether confirmed readings are in flight. */
  verifiedSample: number; historical: number; inFlight: number;
  shipped: number; liveVerified: number; waitingVerification: number; recorded: number;
  ahead: number; behind: number; inconclusive: number; confounded: number; notMeasurable: number; overlapping: number;
  historicalAhead: number; historicalBehind: number; historicalUnclear: number;
  /** The yardstick most of the verified reads share, and the middle read in that unit; a click-rate fraction is never printed as clicks. */
  unit: Metric | null; medianEffect: number | null;
  /** The agreement behind the confidence, said as a count and the odds of it by chance, so a small sample reads as one. */
  agreement: string | null; pageFamilies: string[];
  belief: string; strongest: Example | null; counterexample: Example | null; limits: string[]; changeMind: string; watching: string;
  /** Keys of thoughts whose changes overlapped this one's on the same page: real combinations off the kernel's own overlap ids. */
  edges: string[];
};
type Example = { id: string; label: string; url: string; line: string; state: ResultState };

export type BrainModel = {
  belief: { headline: string; lines: string[]; confidence: Thought["confidence"] };
  changed: string | null; watching: string[]; thoughts: Thought[];
  /** The one thing to do now, with somewhere to go when the app has that somewhere. */
  nextStep: { text: string; href: string | null };
  counts: { shipped: number; liveVerified: number; verifiedMature: number; historicalMature: number; reading: number; waitingVerification: number;
    historicalAhead: number; historicalBehind: number; historicalUnclear: number; confounded: number; notMeasurable: number };
};

const CONF_LABEL: Record<Thought["confidence"], string> = { none: "nothing verified", early: "an early signal", pattern: "a consistent record", mixed: "a split record" };
const FAMILY_NAME: Record<string, string> = { title: "Titles", meta: "Meta descriptions", title_meta: "Titles and meta descriptions", h1: "Page headlines",
  answer: "Answers at the top", link: "Internal links", schema: "Structured data", content: "Page content", new_page: "New pages", full_rewrite: "Full rewrites", other: "Other changes" };
/** THE SAME GROUPING THE KERNEL LEARNS BY: one row through treatment-learning yields the coarse family its own grouping would file it under, so the field and the ranking's history can never disagree about what kind of work a change was. THE PROJECTION IS THE KERNEL'S OWN ADJUDICATED READING and never a second opinion: the basis day, the lift it settled on and whether it stood against the site are the only window facts treatment-learning reads, the rest of the stored shape is required and carries no meaning here, and a read on click rate or judged on assistants projects no window at all rather than handing clicks arithmetic a rate. */
const learningRowOf = (p: ShipmentPresentation): Parameters<typeof treatmentLearning>[0][number] => ({ actionType: p.read.actionType, after: null, implementedAt: p.implementedAt, verification: p.verification, operatorVerdictOverride: null, pinnedRead: null, treatmentStamp: null, componentsApplied: null, baseline: p.baseline == null ? undefined : { ...p.baseline, ctr: 0, position: 0 },
  windows: p.read.basisDay == null || p.read.metric !== "clicks" || judgedOnAi(p) ? [] : [{ day: p.read.basisDay, checkOn: "", ran: true, adjustedLift: p.read.lift, controlsUsed: 1, comparedToSite: p.read.comparison === "site", treatedDelta: 0, controlDelta: 0, treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0 }] });
const familyOf = (p: ShipmentPresentation): string | null => treatmentLearning([{ ...learningRowOf(p), windows: [] }])[0]?.family ?? null;
const exampleOf = (p: ShipmentPresentation, now: Date): Example => ({ id: p.read.id, label: pageLabel(p.read.path || p.read.page), url: p.read.page, state: rowState(p), line: `${happenedLine(p, now)} ${stateWord(p)}.` });
/** The direction a finished read points, off the group the ledger files it under; a shared or level read points nowhere. */
const direction = (p: ShipmentPresentation): "ahead" | "behind" | null => {
  const s = rowState(p), g = groupFor(p);
  return s === "historical_ahead" || (s === "verified_early" && g === "worked") ? "ahead" : s === "historical_behind" || (s === "verified_early" && g === "down") ? "behind" : null;
};

function thoughtOf(family: string | null, rows: ShipmentPresentation[], now: Date, edges: string[], pooled: { percent: number; readings: number } | null = null): Thought {
  const states = rows.map(rowState), count = (s: ResultState) => states.filter((x) => x === s).length;
  const finished = (p: ShipmentPresentation): boolean => rowState(p) === "verified_early" && !judgedOnAi(p), verified = rows.filter((p) => finished(p) && p.read.comparison !== "site"), blind = rows.filter((p) => finished(p) && p.read.comparison === "site").length; // A READING AGAINST THE SITE'S OWN MOVEMENT SIZES NO BELIEF (reviewer, 2026-09-03): treatment-learning refuses it, so counting it here would have the Brain claim a signal off readings the engine will not learn from. It is named below instead.
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
  const families = [...rows.reduce((m, p) => { const f = `/${(p.read.path || p.read.page || "").replace(/^https?:\/\//, "").split("/").filter(Boolean).find((x, i) => i > 0 || !x.includes(".")) ?? ""}`; return m.set(f, (m.get(f) ?? 0) + 1); }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f, n]) => `${f === "/" ? "home" : f} (${n})`); // a stored path may carry its host; the family is the first path segment
  const historical = rows.filter((p) => HISTORICAL.has(rowState(p))).length, inFlight = rows.filter((p) => p.implementedAt != null && (rowState(p) === "reading" || rowState(p) === "live_verified")).length;
  const overlapping = rows.filter((p) => p.read.overlappingIds.length > 0).length, name = family == null ? "Older, untyped changes" : FAMILY_NAME[family] ?? "Other changes";
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
  // WHAT THIS KIND OF WORK HAS RETURNED, off the readings the engine actually learns from and said in the one unit that compares across pages: percent of what those pages were already earning. Under three usable readings there is no such number, and then the sentences above stand exactly as they were, because an average of almost nothing is not a measurement and a flat sentence invented for it would read as one.
  const record = pooled == null ? "" : ` ${name} on this site: about ${pooled.percent >= 0 ? "plus" : "minus"} ${num(Math.abs(pooled.percent))} percent across ${plural(pooled.readings, "reading")}.`;
  const owed = Math.max(0, CONSISTENT_MIN - verified.length);
  const agreement = verified.length + level === 0 ? null : `${agree} of ${plural(verified.length, "directional verified read")} point the same way${level > 0 ? `, and ${plural(level, "finished verified read")} moved nothing` : ""}. A small sample from one site: ${confidence === "pattern" ? "consistent, not proven" : confidence === "mixed" ? "split, and a split this small can still be noise" : "too few to call a record"}.`;
  const changeMind = confidence === "pattern" ? `Verified reads finishing the other way would turn this back into a split record.`
    : confidence === "mixed" ? `Verified reads that separate consistently, ahead or behind, would make this a consistent record.`
    : `${plural(owed, "more verified 28 day read")} pointing the same way would make this a consistent record; ${owed === CONSISTENT_MIN ? "the first" : "the next"} live-confirmed change finishing its read moves it.`;
  const soon = rows.map((p) => p.read.windows.find((w) => w.state !== "closed")?.closesOn ?? null).filter((d): d is string => d != null).sort()[0] ?? null;
  const next = soon ? `For ${name.toLowerCase()}, the next read ${landsLabel(soon, now) ?? "lands soon"}.` : null;
  const watching = inFlight > 0 ? `${plural(inFlight, "confirmed change")} still being read.${next ? ` ${next}` : ""}` : count("waiting_verification") + count("recorded") > 0
    ? `${plural(count("waiting_verification") + count("recorded"), "change")} recorded and not yet confirmed on the live page.` : "Nothing in flight for this kind of work.";
  // EXAMPLES ARE CHOSEN BY DIRECTION, verified before historical, and sized inside one unit: the largest read is not the largest number.
  const pick = (want: "ahead" | "behind"): Example | null => {
    const list = rows.filter((p) => direction(p) === want && !judgedOnAi(p)).sort((a, b) => Number(rowState(b) === "verified_early") - Number(rowState(a) === "verified_early"));
    const u = unit ?? list[0]?.read.metric, same = list.filter((p) => p.read.metric === u).sort((a, b) => Math.abs(b.read.lift) - Math.abs(a.read.lift));
    const best = same[0] ?? list[0]; return best ? exampleOf(best, now) : null;
  };
  return { key: family ?? "unsigned", family, name, confidence, verifiedSample: verified.length, historical, inFlight, shipped: rows.length,
    liveVerified: rows.filter(liveConfirmed).length, waitingVerification: count("waiting_verification"), recorded: count("recorded"),
    ahead, behind, inconclusive: count("inconclusive"), confounded: count("confounded"), notMeasurable: count("not_measurable"), overlapping,
    historicalAhead: count("historical_ahead"), historicalBehind: count("historical_behind"), historicalUnclear: count("historical_unclear"), unit, medianEffect: median, agreement, pageFamilies: families,
    belief: belief + record, strongest: pick("ahead"), counterexample: pick("behind"), limits, changeMind, watching, edges };
}

/** THE WHOLE ARGUMENT. Thoughts are ordered by what may be believed first: patterns, then signals, then the largest in flight. */
export function buildResultsBrain(shipments: ReadonlyArray<ShipmentPresentation>, now: Date, actionable: { ready: number | null } = { ready: null }): BrainModel {
  const byFamily = new Map<string | null, ShipmentPresentation[]>();
  for (const p of shipments) { const f = familyOf(p); byFamily.set(f, [...(byFamily.get(f) ?? []), p]); }
  // REAL COMBINATIONS ONLY: two kinds of work are joined when the kernel found their windows overlapping on one page.
  const familyById = new Map(shipments.map((p) => [p.read.id, familyOf(p) ?? "unsigned"] as const));
  const edgesOf = (f: string | null): string[] => [...new Set((byFamily.get(f) ?? []).flatMap((p) => p.read.overlappingIds.map((id) => familyById.get(id))).filter((k): k is string => !!k && k !== (f ?? "unsigned")))];
  const pooled = new Map(treatmentLearning(shipments.map(learningRowOf)).map((g) => [g.family, g.estimate == null ? null : { percent: g.estimate.percent, readings: g.sampleSize }] as const));
  const thoughts = [...byFamily].map(([f, rows]) => thoughtOf(f, rows, now, edgesOf(f), pooled.get(f) ?? null))
    .sort((a, b) => ["pattern", "mixed", "early", "none"].indexOf(a.confidence) - ["pattern", "mixed", "early", "none"].indexOf(b.confidence) || b.verifiedSample - a.verifiedSample || b.inFlight - a.inFlight || b.shipped - a.shipped);
  const states = shipments.map(rowState), c = (s: ResultState) => states.filter((x) => x === s).length;
  // NEWER CHANGES ARE THE ONES WITH A STAMP THAT HAVE NOT FINISHED; a change that predates verification is history however young its read.
  const newer = shipments.filter((p) => p.implementedAt != null && !FINISHED.has(rowState(p))), inFlight = newer.filter(liveConfirmed).length, unconfirmed = newer.length - inFlight;
  const counts: BrainModel["counts"] = { shipped: shipments.length, liveVerified: shipments.filter(liveConfirmed).length,
    verifiedMature: c("verified_early") + c("inconclusive"), historicalMature: c("historical_ahead") + c("historical_behind") + c("historical_unclear"),
    reading: newer.length, waitingVerification: unconfirmed,
    historicalAhead: c("historical_ahead"), historicalBehind: c("historical_behind"), historicalUnclear: c("historical_unclear"), confounded: c("confounded"), notMeasurable: c("not_measurable") };
  const patterns = thoughts.filter((t) => t.confidence === "pattern"), early = thoughts.filter((t) => t.confidence === "early"), mixed = thoughts.filter((t) => t.confidence === "mixed");
  const confidence: Thought["confidence"] = patterns.length > 0 ? "pattern" : mixed.length > 0 && early.length === 0 ? "mixed" : early.length > 0 ? "early" : "none";
  const headline = patterns.length > 0 ? `Beacon has a consistent verified record for ${patterns.map((t) => t.name.toLowerCase()).join(", ")}, not yet proof.`
    : early.length > 0 ? `Beacon has an early verified signal for ${early.map((t) => t.name.toLowerCase()).join(", ")}, not yet a pattern.`
    : counts.shipped === 0 ? "Nothing has been marked done yet, so Beacon has no result to believe."
    : "Beacon cannot claim a live-verified pattern yet.";
  const lines = [
    ...(counts.historicalMature > 0 ? [`${plural(counts.historicalMature, "historical read")} ${counts.historicalMature === 1 ? "gives" : "give"} context: ${counts.historicalAhead} finished ahead, ${counts.historicalBehind} behind and ${counts.historicalUnclear} ${counts.historicalUnclear === 1 ? "was" : "were"} unclear. None was confirmed on the live page, so none trains recommendations.`] : []),
    ...(counts.verifiedMature > 0 ? [`${plural(counts.verifiedMature, "live-verified read")} ${counts.verifiedMature === 1 ? "has" : "have"} finished${c("inconclusive") > 0 ? `, ${c("inconclusive")} of them inconclusive` : ""}.`] : []),
    ...(newer.length > 0 ? [`${plural(newer.length, "newer change")} ${newer.length === 1 ? "is" : "are"} not finished: ${plural(inFlight, "change")} confirmed on the live page and reading, ${plural(unconfirmed, "change")} recorded and waiting for live verification.`] : []),
    ...(mixed.length > 0 ? [`${mixed.map((t) => t.name).join(", ")} point both ways, so no pattern is claimed there.`] : [])];
  // WHAT CHANGED RECENTLY IS A DIFFERENCE BETWEEN TWO BELIEFS, not a count of rows: the same model is asked what it believed two weeks ago,
  // with every read that closed since then still open, and each thought whose confidence moved is named. The closes are the second sentence.
  const cutoff = now.getTime() - 14 * 86_400_000, closedSince = (p: ShipmentPresentation): boolean => isMature(p.read.basisDay) && [...p.read.windows].some((w) => w.state === "closed" && w.closesOn != null && Date.parse(w.closesOn) > cutoff);
  // A RETIRED RECOMMENDATION IS HISTORY, NOT NEWS: a read that closed under advice Beacon has since taken back is not part of
  // "what finished in the last two weeks", and it may not be the thing the operator is sent to go and publish.
  const recent = shipments.filter((p) => closedSince(p) && !isRetired(p)), earlier = shipments.map((p) => closedSince(p) ? { ...p, read: { ...p.read, basisDay: null, verdict: "waiting" as const, lift: 0 } } : p);
  const then = new Map([...byFamily.keys()].map((f) => [f ?? "unsigned", thoughtOf(f, earlier.filter((p) => familyOf(p) === f), new Date(cutoff), []).confidence] as const));
  const moved = thoughts.filter((t) => then.get(t.key) !== t.confidence).map((t) => `${t.name}: ${CONF_LABEL[then.get(t.key) ?? "none"]} two weeks ago, ${CONF_LABEL[t.confidence]} now`);
  const ahead = recent.filter((p) => direction(p) === "ahead").length, behind = recent.filter((p) => direction(p) === "behind").length, hist = recent.filter((p) => HISTORICAL.has(rowState(p))).length;
  const split = [[ahead, "ahead"], [behind, "behind"], [recent.length - ahead - behind, "unclear"]].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`).join(", ");
  const changed = recent.length === 0 ? null : `${moved.length > 0 ? `${moved.join("; ")}. ` : "No belief moved in the last two weeks. "}${plural(recent.length, "read")} finished in that time: ${split}${hist === recent.length ? ", all of them historical" : hist > 0 ? `, ${hist} of them historical` : ""}.`;
  const soonest = shipments.map((p) => p.read.windows.find((w) => w.state !== "closed")?.closesOn ?? null).filter((d): d is string => d != null).sort()[0] ?? null;
  // THE FACTS BEHIND THE LIVE CHECK, said as facts: a page whose live copy differs from the approved words, and a page that could not be read.
  const differs = shipments.filter((p) => p.implementedAt != null && p.verification?.status === "differs" && !isRetired(p)), unread = shipments.filter((p) => p.verification?.status === "blocked" && p.verification.recheckAfter != null).length;
  const watching = [...(counts.liveVerified > 0 ? [`${plural(counts.liveVerified, "change")} confirmed on the live page, whose reads decide the first verified pattern.`] : []),
    ...(soonest ? [`The next read ${landsLabel(soonest, now) ?? "lands soon"}.`] : []),
    ...(differs.length > 0 ? [`${plural(differs.length, "marked-done change")} ${differs.length === 1 ? "does" : "do"} not yet show on the live page as approved: check ${differs.length === 1 ? "it is" : "they are"} published, and Beacon re-reads ${differs.length === 1 ? "it" : "them"}.`] : []),
    ...(unread > 0 ? [`${plural(unread, "page")} could not be read on the last check; Beacon retries ${unread === 1 ? "it" : "them"}.`] : []),
    ...(unconfirmed > 0 ? [`${plural(unconfirmed, "change")} recorded and not yet confirmed live: their numbers are context only.`] : [])];
  // ALWAYS A NEXT STEP, AND AN IMPERATIVE, OFF ACTIONABLE STATE (truth review, 2026-09-01): the finished changes the saved release
  // serves on Changes come first; a page whose live copy differs is the operator's to check; otherwise the next read is the wait.
  const nextStep = actionable.ready != null && actionable.ready > 0 ? { text: `Make the ${plural(actionable.ready, "finished change")} waiting on Changes; each one starts its read the day you mark it done.`, href: "/changes" }
    : differs.length > 0 ? { text: `Check that ${differs.length === 1 ? "the marked-done change on" : `the ${differs.length} marked-done changes on`} ${[...new Set(differs.map((p) => p.read.path || p.read.page))].slice(0, 2).join(" and ")} ${differs.length === 1 ? "is" : "are"} published as approved; Beacon re-reads ${differs.length === 1 ? "it" : "them"} after that.`, href: `#change-${differs[0]!.read.id}` }
    : soonest ? { text: `Nothing to do until the next read ${landsLabel(soonest, now) ?? "lands soon"}; mark the next change done on Changes and its read starts that day.`, href: "/changes" }
      : { text: "Mark the next change done on Changes; its read starts from that day.", href: "/changes" };
  return { belief: { headline, lines, confidence }, changed, watching, thoughts, counts, nextStep };
}
