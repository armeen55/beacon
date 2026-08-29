/** results-presentation - EVERY operator-facing string the Results surface says about one measured change, as
 * pure functions over what the measurement kernel already computed: the kernel owns the verdict, the lift and
 * the read dates, the Shipment store owns what the live check found, and this module only puts those answers
 * into the operator's own words in ONE place, so a test reads every sentence without rendering a page. Three
 * rules: no raw slug ever reaches the screen; no number is invented; every row ends on a next step. */

import { monthDayLabel } from "@/components/data/receipt-line";
import { isMature as kernelIsMature } from "@/domains/measurement";
import type { ControlReceipt, KernelRead, MeasurementState, ShipmentObjective, ShipmentVerification } from "@/domains/measurement";
import { RESULT_LINES } from "./results-lines";
const { AI_MOVE, aiDays, aiHappenedLine, aiMove, aiStory, caveatLines, groupFor, happenedLine, judgedOnAi, liftLabel, nextStepLine, reasonWords, receiptOf, taughtLine, unadjustedLine, workLabel, yardstickOf } = RESULT_LINES;


/** What one measured change carries on the Results surface. */
export type ShipmentPresentation = {
  read: KernelRead;
  /** Whether a fair comparison exists for this one. Recording an implementation never waits on it. */
  measurement?: MeasurementState | null;
  /** The day the operator marked it done. Null on a record written before there was a stamp. */ implementedAt: string | null;
  verification: ShipmentVerification | null;
  /** The immutable numbers this page stood at when it was marked done. */ baseline: { clicks: number; impressions: number; windowDays: number; capturedAt: string } | null;
  /** THIS PAGE'S OWN change over the read that was used, from the stored reading. Absent on a  snapshot written before it was kept, and then the before and after stay off the screen. */
  basisMove?: { clicks: number; impressions: number } | null;
  /** Which pages stood behind this one, and why each qualified. Absent on a row recorded before the
   *  receipt was kept, and then the screen never calls the comparison pages similar. */
  controlsReceipt?: ControlReceipt[] | null;
  /** THE AI HALF OF THE SAME CHANGE, off the stored answers around its stamp: the direction of the objective the change declared, the sentence the outcome engine wrote, that objective's own numbers, and one sentence when the instrument moved under the reading. Null when the change carries no scope or stamp, and then the screen says nothing about AI rather than implying it was watched. */
  ai?: { direction: "improved" | "worsened" | "no_clear_movement" | "mixed" | "unclear"; line: string; metricLines?: string[]; boundary?: string | null; terminal?: boolean;
    /** Days since the stamp, capped at the 28 day stretch this is judged over, so the group can hold an early lean as still reading. */ daysElapsed?: number } | null;
  /** THE YARDSTICK THIS CHANGE DECLARED AT THE PRESS, typed as the closed set a Shipment may carry so no surface can invent a sixth. An
   *  AI objective means the AI outcome is the verdict and Google is the context, not the other way round. Absent (a row recorded before
   *  the declaration existed) or "clicks" leaves everything exactly as it was. */
  judgedMetric?: ShipmentObjective | null;
};

/** The four things a change can be, in the order the strip shows them. */
export type ResultsGroup = "worked" | "down" | "flat" | "reading";

type ResultsRow = {
  id: string; path: string; url: string;
  /** What the change was, said the way an operator would say it. */
  work: string;
  group: ResultsGroup;
  verdictWord: string;
  dot: "emerald" | "rose" | "grey" | "sky";
  /** Bar fill, -1 to 1, on ONE shared scale. Null when there is nothing to draw. An AI judged row draws ITS OWN objective's
   *  direction here: a bar sized and signed off Google painted a rose bar across a won citation. */
  bar: number | null;
  barOpacity: number;
  /** The short number for the row. Null when no number is claimed. On an AI judged row this is the objective's own move in words,
   *  because no click figure can stand in for it and the Google one used to sit there saying the opposite. */
  liftLabel: string | null;
  /** What has been read, for a row that has no number yet. */
  readLabel: string | null;
  /** The Google appearances delta. Null on an AI judged row: a bare unlabelled Google number beside an AI verdict is read as the verdict's own. */
  impressionsLabel: string | null;
  /** The AI half in one sentence, off stored answers around the stamp. Null = not watched, and the row says nothing rather than implying it was. */ aiLine: string | null;
  /** WHICH YARDSTICK DECIDED THIS ROW'S verdict, when it was not clicks. A reader must never have to guess whether "Worked" means traffic or citations. */ yardstick: string | null;
  /** The declared objective's own numbers, one sentence each, under that line. Empty on a change judged on clicks: its AI line is an observation, not its yardstick. */ aiMetricLines: string[];
  /** One sentence when a model or a mode moved under the reading, so a step reads as the instrument rather than as the change. Null when the whole stretch was one instrument. */ aiBoundary: string | null;
  chip: { text: string; amber: boolean } | null;
  pips: Array<{ day: number; state: "read" | "pending" | "shared" }>;
  pipCaption: string | null;
  happened: string;
  /** THE GOOGLE HALF OF A ROW JUDGED ON AI, under its own heading so it can never be read as this row's answer. Null on a row
   *  judged on clicks, whose Google sentence IS the story above. */
  googleAside: { heading: string; line: string } | null;
  numbers: { before: [string, string]; after: [string, string] } | null;
  numbersNote: string | null;
  /** The pages this one was measured against, one line each, or empty when none is on file. */
  comparedAgainst: string[];
  /** The site's own before and after, labeled as unadjusted, where no fair comparison exists. */
  unadjustedNote: string | null;
  caveats: string[];
  timeline: Array<{ label: string; done: boolean }>;
  taught: string;
  nextStep: string;
  /** Ordering key inside the group, ascending. */
  sort: number;
};

export type ResultsView = {
  rows: Record<ResultsGroup, ResultsRow[]>;
  counts: Record<ResultsGroup, number>;
  header: {
    worked: { value: string; sub: string; isCount: boolean };
    /** NET across every settled change, with the gross from the wins carried in the note. */
    clicks: { value: string; positive: boolean; note: string | null };
    appearances: { value: string; positive: boolean; note: string | null };
    reading: { value: string; sub: string; isCount: boolean };
    /** The period every total above answers for. */
    window: string;
  };
  defaultGroup: ResultsGroup;
};

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "-" : ""}${num(Math.abs(n))}`;
// -- the closed label maps (a slug never reaches the screen) -------------------

/** ONE shared scale for every bar on the screen: a move of a quarter against this page's own  starting point fills the bar, and everything larger is held at the edge. */
const CLAMP = 0.25;

const isMature = (d: number | null): boolean => kernelIsMature(d as 7 | 14 | 28 | 56 | null);

/** ONE MATURITY RULE, THE SAME ONE THE LEDGER BANDS USE (proof-gsc/kernel.ts bandOf): a read whose window has not closed is still
 *  reading, whichever way it leans, and only a finished one is a settled answer. An early lean filed under "Worked" or "Went down"
 *  is what had Today saying "out of 12 finished" over a Results header saying 14, and it promised a verdict nothing had earned. */
export const groupOf = (r: KernelRead): ResultsGroup => {
  if (r.verdict === "stronger_improvement" || r.verdict === "directional_improvement") return isMature(r.basisDay) ? "worked" : "reading";
  if (r.verdict === "directional_decline") return isMature(r.basisDay) ? "down" : "reading";
  if (r.verdict === "no_clear_movement" || r.verdict === "confounded") return isMature(r.basisDay) ? "flat" : "reading";
  return "reading";
};

/** Where this row's bar sits on the one shared scale. Null when nothing is claimed. */
function barOf(p: ShipmentPresentation): number | null {
  const r = p.read;
  // AN AI JUDGED ROW IS DRAWN IN ITS OWN DIRECTION, at the smallest honest size, on the same rule the no-starting-point case below already
  // uses: the objective carries a direction and no ratio, so the bar shows which way it went and never invents a size. Scaled off Google
  // clicks, it drew a full rose bar across a citation this change had won.
  if (judgedOnAi(p)) { const d = aiMove(p); return d === "improved" ? 0.18 : d === "worsened" ? -0.18 : d === "no_clear_movement" || d === "mixed" ? 0 : null; }
  if (r.basisDay == null || r.verdict === "confounded" || r.verdict === "waiting" || r.verdict === "insufficient_evidence") return null;
  const b = p.baseline;
  let rel = 0;
  if (r.metric === "ctr") {
    const beforeRate = b && b.impressions > 0 ? b.clicks / b.impressions : 0;
    rel = beforeRate > 0 ? r.lift / beforeRate : 0;
  } else if (r.metric === "position") {
    rel = r.lift / 10;
  } else {
    const before = b && b.windowDays > 0 ? (b.clicks * r.basisDay) / b.windowDays : 0;
    rel = before > 0 ? r.lift / before : 0;
  }
  const scaled = Math.max(-1, Math.min(1, rel / CLAMP));
  // A page with no starting point on file cannot be scaled against itself, so the bar shows the direction at its smallest honest size rather than nothing at all.
  if (Math.abs(r.lift) > 1e-9 && Math.abs(scaled) < 0.18) return r.lift > 0 ? 0.18 : -0.18;
  return scaled;
}

/** The next read that has not landed, as its raw close date. */
export const nextCloseOn = (r: KernelRead): string | null => r.windows.find((w) => w.state !== "closed")?.closesOn ?? null;
/** A PROMISE ABOUT THE FUTURE MAY NEVER RENDER A PAST DATE (operator, 2026-08-21): "next result lands August
 *  19" printed on August 21 is impossible on its face. A window whose close date has passed without finalized
 *  data is OVERDUE because Google reports a few days behind, and that is what is said. */
export const landsLabel = (closesOn: string | null | undefined, now: Date): string | null => {
  const day = monthDayLabel(closesOn ?? null);
  if (!day) return null;
  const end = Date.parse(`${(closesOn ?? "").slice(0, 10)}T23:59:59Z`);
  return Number.isFinite(end) && end < now.getTime() ? "is overdue; Google reports a few days behind" : `lands ${day}`;
};

export const lastClosed = (r: KernelRead) => [...r.windows].reverse().find((w) => w.state === "closed") ?? null;

const showsImpressions = (p: ShipmentPresentation): boolean => !(p.baseline && p.baseline.impressions <= 0);

// -- the sentences ------------------------------------------------------------

/** Marked done, the live check, the last read that landed and the next one owed. */
function timelineLines(p: ShipmentPresentation): Array<{ label: string; done: boolean }> {
  const marked = monthDayLabel(p.implementedAt);
  const checked = monthDayLabel(p.verification?.checkedAt ?? null);
  const done = lastClosed(p.read), next = p.read.windows.find((w) => w.state !== "closed");
  const out = [
    { label: marked ? `Marked done ${marked}` : "Marked done, date not kept", done: true },
    p.verification && checked ? { label: `Live page checked ${checked}`, done: true } : { label: "Live page not read yet", done: false },
  ];
  // A ROW JUDGED ON AI IS READ OVER ITS OWN 28 DAYS FROM THE STAMP, not over the Google windows: a change three days into its
  // citation read carried "28 day read May 29, done" beside its own "Reading". No date is printed for it, because none is on file.
  if (judgedOnAi(p)) {
    const d = aiDays(p);
    out.push({ label: d >= 28 ? "28 day read done" : `Day ${d} of the 28 day read`, done: d >= 28 });
    return out;
  }
  if (done) out.push({ label: `${done.day} day read ${monthDayLabel(done.closesOn) ?? ""}`.trim(), done: true });
  if (next) out.push({ label: `${next.day} day read ${monthDayLabel(next.closesOn) ?? ""}`.trim(), done: false });
  return out;
}

/** The one exception worth a chip, or none. Shared credit always wins the slot. AUTHORSHIP IS SAID OUT LOUD
 *  (Codex, 2026-08-21): a live page carrying wording that differs from what Beacon wrote is still measured,
 *  and its result is the operator's rather than Beacon-authored work, so the chip names whose wording won. */
function chipOf(p: ShipmentPresentation): { text: string; amber: boolean } | null {
  if (p.read.verdict === "confounded") return { text: "Shared with a later change", amber: true };
  const v = p.verification;
  if (!v) return { text: "Live page not read yet", amber: false };
  if (v.status === "verified") return null;
  if (v.status === "differs" || v.components?.some((c) => c.state === "changed_differently"))
    return { text: "Measured on your own wording, not Beacon's", amber: false };
  if (v.status === "partially_verified") return { text: "Part of it is live", amber: false };
  return { text: "Not on the live page yet", amber: false };
}

/** This page's own before and after over the read that was used. */
function numbersOf(p: ShipmentPresentation): { numbers: ResultsRow["numbers"]; note: string | null } {
  const r = p.read;
  const b = p.baseline;
  if (!b) return { numbers: null, note: "No starting point was kept for this one." };
  if (b.impressions <= 0) return { numbers: null, note: "No Google traffic on file." };
  if (r.basisDay == null || !p.basisMove) return { numbers: null, note: "Nothing read yet." };
  const scale = b.windowDays > 0 ? r.basisDay / b.windowDays : 1;
  const beforeClicks = b.clicks * scale;
  const beforeImpr = b.impressions * scale;
  return {
    numbers: {
      before: [num(beforeClicks), num(beforeImpr)],
      after: [num(beforeClicks + p.basisMove.clicks), num(beforeImpr + p.basisMove.impressions)],
    },
    note: null,
  };
}

// -- the whole surface --------------------------------------------------------

function rowOf(p: ShipmentPresentation, now: Date): ResultsRow {
  const r = p.read;
  const group = groupFor(p);
  const onAi = judgedOnAi(p), aiDone = aiDays(p), move = onAi ? aiMove(p) : null;
  const shared = r.verdict === "confounded";
  const done = lastClosed(r);
  const next = r.windows.find((w) => w.state !== "closed");
  const { numbers, note } = numbersOf(p);
  const started = Date.parse(p.implementedAt ?? r.windows[0]?.closesOn ?? "") || 0;
  const bar = barOf(p);
  const claimNumber = r.basisDay != null && !shared && r.verdict !== "insufficient_evidence";
  return {
    id: r.id,
    path: r.path,
    url: r.page,
    work: workLabel(r.actionType),
    group,
    // THE COLLAPSED ROW IS HONEST BEFORE ANYTHING IS OPENED (Codex, 2026-08-21): no clear movement, a split
    // between assistants and a terminally unmeasurable result are three different silences, and only a real
    // control-based flat result may say "No change".
    verdictWord: shared && !onAi ? "Shared with a later change"
      : r.metric === "unclassified" && !onAi ? "Not judged"
        : group === "worked" ? "Worked"
        : group === "down" ? "Went down"
          : group !== "flat" ? "Reading"
            : p.ai?.terminal === true ? "Not measurable"
              : move === "mixed" ? "Assistants split"
                : onAi ? "No clear movement" : "No change",
    dot: group === "worked" ? "emerald" : group === "down" ? "rose" : group === "flat" ? "grey" : "sky",
    bar,
    // A Google confidence dims a GOOGLE bar only: dimmed to 0.4 under a won citation it printed a doubt no
    // reading of that objective had expressed.
    barOpacity: onAi ? 1 : r.confidence === "high" ? 1 : r.confidence === "medium" ? 0.65 : 0.4,
    // THE ONE VALUE THE COLLAPSED LINE SHOWS. It preferred the Google number over the verdict word, so a citation win printed
    // "-30 clicks behind" in green under "Worked". The objective's own move is a word, never a click figure standing in for it.
    liftLabel: onAi ? (move ? `${aiStory(p)[0]} ${AI_MOVE[move].replace(/ (than|as) before$/, "")}` : null)
      : claimNumber ? liftLabel(r.metric, r.lift) : null,
    readLabel: onAi ? (aiDone >= 28 ? "28 day read done" : aiDone > 0 ? `${aiDone} of 28 days in` : "Nothing read yet")
      : done ? `${done.day} day read done` : "Nothing read yet",
    // A page with no traffic on file before the change gets no delta at all: there is nothing to count from. Everything else prints what was read, and "Level" rather than a bare zero.
    // EVERY COLLAPSED NUMBER CARRIES ITS UNIT (operator, 2026-08-21): a bare +1,119 answers nothing.
    impressionsLabel: onAi || !claimNumber || !showsImpressions(p) ? null
      : (Math.abs(r.impressionsLift) < 0.5 ? "Level" : `${signed(r.impressionsLift)} shown`),
    chip: chipOf(p),
    // The dots count down the read THIS row is judged over. A citation change one day in showed three filled dots and "Done May 29",
    // because those are the Google windows, beside its own "Reading".
    pips: onAi ? [7, 14, 28].map((day) => ({ day, state: aiDone >= day ? "read" as const : "pending" as const }))
      : r.windows.filter((w) => w.day !== 56).map((w) => ({
        day: w.day,
        state: w.confounded != null ? "shared" as const : w.state === "closed" ? "read" as const : "pending" as const,
      })),
    pipCaption: onAi ? (aiDone >= 28 ? "Read over 28 days" : aiDone > 0 ? `Day ${aiDone} of 28` : "Nothing read yet")
      : next ? ((l) => l == null || l.startsWith("lands") ? `Next ${monthDayLabel(next.closesOn) ?? "soon"}` : "Overdue; Google reports a few days behind")(landsLabel(next.closesOn, now))
        : done ? `Done ${monthDayLabel(done.closesOn) ?? ""}`.trim() : null,
    happened: onAi ? aiHappenedLine(p) : happenedLine(p, now),
    // GOOGLE STAYS ON THE ROW AND STOPS BEING THE ANSWER: same sentence, same before and after, under a heading that says whose they are.
    googleAside: onAi ? { heading: "Google search, for context", line: happenedLine(p, now) } : null,
    numbers,
    numbersNote: note,
    comparedAgainst: receiptOf(p).map((c) => ((w) => (w.length > 0 ? `${c.path} (${w.join("; ")})` : c.path))(reasonWords(c.reasons))),
    unadjustedNote: unadjustedLine(p), aiLine: p.ai?.line ?? null, yardstick: yardstickOf(p.judgedMetric),
    aiMetricLines: p.ai?.metricLines ?? [], aiBoundary: p.ai?.boundary ?? null,
    // A WIN NOBODY VERIFIED SAYS SO ON THE ROW (operator, 2026-08-21): improvement after a marked change is a
    // fact, and "the live implementation has not been verified" is the other fact that belongs beside it.
    caveats: [...(group === "worked" && (p.verification == null || p.verification.status === "not_found" || p.verification.status === "blocked" || p.verification.status === "operator_confirmed")
      ? [onAi ? "This improved after the change was marked done; the live implementation has not been verified yet." : "Traffic improved after this marked change; the live implementation has not been verified yet."] : []),
    ...caveatLines(r, onAi)].slice(0, 3),
    timeline: timelineLines(p),
    taught: taughtLine(p),
    nextStep: nextStepLine(p, now),
    sort: group === "worked" ? -(bar ?? 0)
      : group === "down" ? (bar ?? 0)
        : group === "flat" ? -started
          : Date.parse(next?.closesOn ?? "") || Number.MAX_SAFE_INTEGER,
  };
}

/** THE WHOLE RESULTS SURFACE, in the operator's words. Pure. This is the only thing the screen
 * renders, so it can never say a sentence this function did not produce.
 */
export function buildResultsView(shipments: ReadonlyArray<ShipmentPresentation>, now: Date = new Date()): ResultsView {
  const rows: Record<ResultsGroup, ResultsRow[]> = { worked: [], down: [], flat: [], reading: [] };
  for (const p of shipments) rows[groupFor(p)].push(rowOf(p, now));
  for (const g of Object.keys(rows) as ResultsGroup[]) rows[g].sort((a, b) => a.sort - b.sort);
  const counts = { worked: rows.worked.length, down: rows.down.length, flat: rows.flat.length, reading: rows.reading.length };

  // SETTLED = finished its 28 day read ON ITS OWN YARDSTICK, off the ONE grouping: reading it off the Google
  // verdict while the strip grouped on the declared one let a citation win sit under a header saying nothing
  // had finished. `groupFor` already holds an unfinished read of either kind as reading.
  const settled = shipments.filter((p) => groupFor(p) !== "reading");
  const wins = settled.filter((p) => groupFor(p) === "worked");
  const soonest = landsLabel(shipments
    .map((p) => p.read.windows.find((w) => w.state !== "closed")?.closesOn ?? null)
    .filter((d): d is string => d != null).sort()[0] ?? null, now);

  // NET, NOT CHERRY PICKED. The headline totals used to add up the wins alone, so a site that lost more than it
  // gained still read "+54 clicks added". They now add up EVERY settled row exactly as the screen prints it
  // (rounded, and nothing from a row that claims no number), and the gross from the wins drops to the second line.
  // THE TOTALS ARE THE VISIBLE ROWS ADDED UP. An AI-judged row prints no click figure at all, so folding its
  // Google numbers in made a header nobody could reconcile against the list under it; a row with no closed
  // window would add a zero reading as "earned nothing" rather than "nothing read yet". Its Google movement
  // stays on the row itself, in the labelled aside, as context and never as a claim.
  const counted = settled.filter((p) => !judgedOnAi(p) && p.read.verdict !== "confounded" && p.read.verdict !== "insufficient_evidence" && isMature(p.read.basisDay));
  const won = (p: ShipmentPresentation) => groupFor(p) === "worked";
  const total = (list: ShipmentPresentation[], of: (p: ShipmentPresentation) => number) => list.reduce((s, p) => s + Math.round(of(p)), 0);
  // Clicks are summed only where the read was measured in clicks; a rate read adds its count instead of a number pretending to be one.
  const clicked = counted.filter((p) => p.read.metric === "clicks");
  const clicks = total(clicked, (p) => p.read.lift);
  const clicksWon = total(clicked.filter(won), (p) => p.read.lift);
  const rateReads = counted.length - clicked.length;
  const seen = counted.filter(showsImpressions);
  const appearances = total(seen, (p) => p.read.impressionsLift);
  const appearancesWon = total(seen.filter(won), (p) => p.read.impressionsLift);
  const fromWins = (gross: number, net: number) => `${signed(gross)} from wins, ${signed(net - gross)} from the rest`;

  return {
    rows,
    counts,
    header: {
      worked: settled.length === 0
        ? { value: soonest ? `First result ${soonest}` : "First result lands once a read closes", sub: "Nothing has finished its 28 day read yet", isCount: false }
        // COUNTED, NEVER CHERRY PICKED, AND NEVER OVERSOLD: a row without a clear result is inconclusive, not
        // proof of what does not work (operator, 2026-08-21), so the rest are counted and never characterized.
        : { value: `${num(wins.length)} ${wins.length === 1 ? "win" : "wins"}`, isCount: true,
            sub: `out of ${settled.length} finished` },
      clicks: clicked.length === 0
        ? { value: rateReads > 0 ? `${rateReads} read in click rate` : "Nothing read yet", positive: false, note: null }
        : { value: signed(clicks), positive: clicks > 0,
            note: `${fromWins(clicksWon, clicks)}${rateReads > 0 ? `, plus ${rateReads} more read in click rate` : ""}` },
      appearances: seen.length === 0
        ? { value: "Not enough read yet", positive: false, note: null }
        : { value: signed(appearances), positive: appearances > 0, note: fromWins(appearancesWon, appearances) },
      // A BARE 0 SET IN THE BIG NUMBER READS AS A FAILURE. Nothing mid-read is a fine state, so it is said in
      // words and small, exactly as the three totals beside it say their own missing answers.
      reading: counts.reading === 0
        ? { value: "None", sub: "every change recorded has been read", isCount: false }
        : { value: num(counts.reading), sub: soonest ? `next result ${soonest}` : "next result lands once a read closes", isCount: true },
      window: settled.length === 0
        ? "Nothing has finished its 28 day read yet."
        : `Across the ${num(settled.length)} ${settled.length === 1 ? "change" : "changes"} that finished their 28 day read.`,
    },
    defaultGroup: counts.worked > 0 ? "worked" : counts.down > 0 ? "down" : counts.reading > 0 ? "reading" : "flat",
  };
}
