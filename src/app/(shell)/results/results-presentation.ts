/** results-presentation - EVERY operator-facing string the Results surface says about one measured
 * change, as pure functions over what the measurement kernel already computed.
 *
 * Nothing here decides anything. The kernel owns the verdict, the lift and the read dates; the Shipment store owns what the live check found; this module only puts those answers into the
 * operator's own words, in ONE place, so a test can read every sentence the screen can print without rendering a page.
 *
 * Three rules hold on every string below. No raw slug ever reaches the screen (an action and a
 * diagnosis resolve through a closed map, and an unmapped one is left out rather than printed). No
 * raw date stamp reaches it either (a day renders as "Jul 3"). And a missing answer says it is missing: a count nobody has read is blank, never a zero.
 */

import { monthDayLabel } from "@/components/data/receipt-line";
import type { ControlReceipt, KernelRead, MeasurementState, ShipmentVerification } from "@/domains/measurement";

/** What one measured change carries on the Results surface. */
export type ShipmentPresentation = {
  read: KernelRead;
  /** Whether a fair comparison exists for this one. Recording an implementation never waits on it. */
  measurement?: MeasurementState | null;
  /** The day the operator marked it done. Null on a record written before there was a stamp. */
  implementedAt: string | null;
  verification: ShipmentVerification | null;
  /** The immutable numbers this page stood at when it was marked done. */
  baseline: { clicks: number; impressions: number; windowDays: number; capturedAt: string } | null;
  /** THIS PAGE'S OWN change over the read that was used, from the stored reading. Absent on a  snapshot written before it was kept, and then the before and after stay off the screen. */
  basisMove?: { clicks: number; impressions: number } | null;
  /** Which pages stood behind this one, and why each qualified. Absent on a row recorded before the
   *  receipt was kept, and then the screen never calls the comparison pages similar. */
  controlsReceipt?: ControlReceipt[] | null;
};

/** The four things a change can be, in the order the strip shows them. */
type ResultsGroup = "worked" | "down" | "flat" | "reading";

type ResultsRow = {
  id: string;
  path: string;
  url: string;
  /** What the change was, said the way an operator would say it. */
  work: string;
  group: ResultsGroup;
  verdictWord: string;
  dot: "emerald" | "rose" | "grey" | "sky";
  /** Bar fill, -1 to 1, on ONE shared scale. Null when there is nothing to draw. */
  bar: number | null;
  barOpacity: number;
  /** The short number for the row. Null when no number is claimed. */
  liftLabel: string | null;
  /** What has been read, for a row that has no number yet. */
  readLabel: string | null;
  impressionsLabel: string | null;
  chip: { text: string; amber: boolean } | null;
  pips: Array<{ day: number; state: "read" | "pending" | "shared" }>;
  pipCaption: string | null;
  happened: string;
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
    reading: { value: string; sub: string };
    /** The period every total above answers for. */
    window: string;
  };
  defaultGroup: ResultsGroup;
};

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "-" : ""}${num(Math.abs(n))}`;

// -- the closed label maps (a slug never reaches the screen) -------------------

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

/** ONE shared scale for every bar on the screen: a move of a quarter against this page's own  starting point fills the bar, and everything larger is held at the edge. */
const CLAMP = 0.25;

const isMature = (d: number | null): boolean => d === 28 || d === 56;

const groupOf = (r: KernelRead): ResultsGroup => {
  if (r.verdict === "stronger_improvement" || r.verdict === "directional_improvement") return "worked";
  if (r.verdict === "directional_decline") return "down";
  if (r.verdict === "no_clear_movement" || r.verdict === "confounded") return "flat";
  return "reading";
};

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

/** Where this row's bar sits on the one shared scale. Null when nothing is claimed. */
function barOf(p: ShipmentPresentation): number | null {
  const r = p.read;
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

/** The next read that has not landed, as a day. */
const nextReadDay = (r: KernelRead): string | null =>
  monthDayLabel(r.windows.find((w) => w.state !== "closed")?.closesOn ?? null);

const lastClosed = (r: KernelRead) => [...r.windows].reverse().find((w) => w.state === "closed") ?? null;

/** THE COMPARISON RECEIPT the measurement kernel keeps beside a change: which pages stood behind it and
 *  why each qualified. "Similar" is a claim, so a row whose receipt cannot back it says the smaller true
 *  thing instead. And a page with no Google traffic before the change prints no appearances number at
 *  all, a test the header totals reuse so they add up to exactly the rows on the screen. */
const receiptOf = (p: ShipmentPresentation): ControlReceipt[] => p.controlsReceipt ?? [];
const peersWord = (p: ShipmentPresentation): string =>
  receiptOf(p).length > 0 ? "similar pages that were not changed" : "pages that were not changed";
const showsImpressions = (p: ShipmentPresentation): boolean => !(p.baseline && p.baseline.impressions <= 0);

// -- the sentences ------------------------------------------------------------

/** WHAT WAS RECORDED WHEN NO FAIR COMPARISON EXISTS. Marking a change done is a fact about the work
 *  and is kept whatever the data says; whether it can be compared is a separate fact about the data.
 *  One honest sentence each, naming which one is missing. A measuring shipment adds nothing here. */
const MEASUREMENT_NOTE: Record<string, string> = {
  measurement_unavailable: "Recorded. A fair comparison is not available yet: Search Console data for this site could not be read.",
  insufficient_comparison: "Recorded. A fair comparison is not available yet: too few similar pages on this site can stand behind this one.",
  verification_needed: "Recorded from what was applied. The live page still has to be read before any result is claimed.",
};

/** One sentence for what happened, on the read that was actually used. */
function happenedLine(p: ShipmentPresentation): string {
  const r = p.read;
  // Recorded, and honestly not judged: nothing about this row names a Search number to grade it on.
  if (r.metric === "unclassified") return "Recorded, and not judged: what was changed here is not a kind that Search data can fairly compare.";
  // Recorded, and nothing to compare it against yet. Said before the "first result lands" promise,
  // which would be a promise nothing is keeping.
  const state = p.measurement ? MEASUREMENT_NOTE[p.measurement] : undefined;
  if (state && r.basisDay == null) return state;
  const peers = peersWord(p);
  // SHARED CREDIT KEEPS ITS NUMBER AND NAMES THE DEMOTION. Hiding the estimate here read as if
  // nothing had been measured; the honest answer is the estimate plus what it cannot be counted as.
  if (r.verdict === "confounded") {
    const held = r.basisDay == null ? ""
      : ` Estimated lift: ${liftSize(r.metric, r.lift)} ${r.lift > 0 ? "ahead of" : "behind"} ${peers}, held as shared credit rather than a win.`;
    const day = monthDayLabel(r.cleanUntil);
    if (day) return `This page changed again on ${day}, so the days after that belong to both changes.${held}`;
    const n = r.overlappingIds.length;
    return `${n} other ${n === 1 ? "change" : "changes"} landed on this page at the same time, so the credit is shared.${held}`;
  }
  if (r.basisDay == null) {
    const next = nextReadDay(r);
    return next ? `Nothing read yet. The first result lands ${next}.` : "Nothing read yet. The first result lands once a read closes.";
  }
  // TOO FEW PAGES TO STAND BEHIND IT IS NOT TOO LITTLE DATA. The days ran and the page moved; what is
  // missing is anything fair to hold it against, which the unadjusted pair below then shows on its own.
  if (r.verdict === "insufficient_evidence") {
    return r.comparison === "insufficient"
      ? `Ran ${r.basisDay} days. A fair comparison is not available: too few pages on this site can stand behind this one.`
      : `Ran ${r.basisDay} days, and there is too little Google data on this page to call it.`;
  }
  // ESTIMATED, NEVER CAUSED. The number is a comparison against pages that were left alone, so the
  // sentence says estimate and never says the change added anything.
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

/** What this read carries forward, plus how much stands behind it. Clauses drop rather than guess. */
function taughtLine(r: KernelRead): string {
  const l = r.learning;
  const family = FAMILY_LABEL[l.actionFamily];
  const cause = l.diagnosisCause ? CAUSE_LABEL[l.diagnosisCause] : undefined;
  const moved =
    l.outcomeDirection === "up" ? "the page moved up after it"
      : l.outcomeDirection === "down" ? "the page moved down after it"
        : l.outcomeDirection === "flat" ? "the page did not clearly move"
          : "it is too early to say which way this went";
  const parts: string[] = [];
  if (cause) parts.push(`this page read as ${cause}`);
  if (family) parts.push(`it was answered with ${family}`);
  parts.push(moved);
  // NOTHING IS CARRIED FORWARD FROM A READ THAT HAS NOT LANDED.
  const carried = l.outcomeDirection && l.outcomeDirection !== "unclear"
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

/** The one thing to do about this row. */
function nextStepLine(r: KernelRead): string {
  if (r.metric === "unclassified") return "Nothing to wait for on this one.";
  if (r.verdict === "confounded") return "Two changes share these days. Make the next change on this page on its own, then measure it.";
  const d = r.learning.outcomeDirection;
  if (d !== "unclear") return (NEXT_STEP[r.learning.actionFamily] ?? GENERIC_NEXT)[d === "up" ? 0 : d === "down" ? 1 : 2];
  const next = nextReadDay(r);
  return next ? `Nothing to do until ${next}.` : "Nothing to do until the next read lands.";
}

/** At most two, and only the ones this row actually carries. */
function caveatLines(r: KernelRead): string[] {
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
  if (r.confidence === "low" && r.basisDay != null && out.length < 2) out.push("Too few similar pages stood behind this one to call it a sure read.");
  return out.slice(0, 2);
}

/** Marked done, the live check, the last read that landed and the next one owed. */
function timelineLines(p: ShipmentPresentation): Array<{ label: string; done: boolean }> {
  const marked = monthDayLabel(p.implementedAt);
  const checked = monthDayLabel(p.verification?.checkedAt ?? null);
  const done = lastClosed(p.read);
  const next = p.read.windows.find((w) => w.state !== "closed");
  const out = [
    { label: marked ? `Marked done ${marked}` : "Marked done, date not kept", done: true },
    p.verification && checked ? { label: `Live page checked ${checked}`, done: true } : { label: "Live page not read yet", done: false },
  ];
  if (done) out.push({ label: `${done.day} day read ${monthDayLabel(done.closesOn) ?? ""}`.trim(), done: true });
  if (next) out.push({ label: `${next.day} day read ${monthDayLabel(next.closesOn) ?? ""}`.trim(), done: false });
  return out;
}

/** The one exception worth a chip, or none. Shared credit always wins the slot. */
function chipOf(p: ShipmentPresentation): { text: string; amber: boolean } | null {
  if (p.read.verdict === "confounded") return { text: "Shared with a later change", amber: true };
  const v = p.verification;
  if (!v) return { text: "Live page not read yet", amber: false };
  if (v.status === "verified") return null;
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

function rowOf(p: ShipmentPresentation): ResultsRow {
  const r = p.read;
  const group = groupOf(r);
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
    verdictWord: shared ? "Shared with a later change"
      : r.metric === "unclassified" ? "Not judged"
        : group === "worked" ? (isMature(r.basisDay) ? "Worked" : "Working so far")
        : group === "down" ? "Went down" : group === "flat" ? "No change" : "Reading",
    dot: group === "worked" ? "emerald" : group === "down" ? "rose" : group === "flat" ? "grey" : "sky",
    bar,
    barOpacity: r.confidence === "high" ? 1 : r.confidence === "medium" ? 0.65 : 0.4,
    liftLabel: claimNumber ? liftLabel(r.metric, r.lift) : null,
    readLabel: done ? `${done.day} day read done` : "Nothing read yet",
    // A page with no traffic on file before the change gets no delta at all: there is nothing to count from. Everything else prints what was read, and "Level" rather than a bare zero.
    impressionsLabel: claimNumber && showsImpressions(p)
      ? (Math.abs(r.impressionsLift) < 0.5 ? "Level" : signed(r.impressionsLift))
      : null,
    chip: chipOf(p),
    pips: r.windows.filter((w) => w.day !== 56).map((w) => ({
      day: w.day,
      state: w.confounded != null ? "shared" as const : w.state === "closed" ? "read" as const : "pending" as const,
    })),
    pipCaption: next ? `Next ${monthDayLabel(next.closesOn) ?? "soon"}`
      : done ? `Done ${monthDayLabel(done.closesOn) ?? ""}`.trim() : null,
    happened: happenedLine(p),
    numbers,
    numbersNote: note,
    comparedAgainst: receiptOf(p).map((c) => (c.reasons.length > 0 ? `${c.path} (${c.reasons.join("; ")})` : c.path)),
    unadjustedNote: unadjustedLine(p),
    caveats: caveatLines(r),
    timeline: timelineLines(p),
    taught: taughtLine(r),
    nextStep: nextStepLine(r),
    sort: group === "worked" ? -(bar ?? 0)
      : group === "down" ? (bar ?? 0)
        : group === "flat" ? -started
          : Date.parse(next?.closesOn ?? "") || Number.MAX_SAFE_INTEGER,
  };
}

/** THE WHOLE RESULTS SURFACE, in the operator's words. Pure. This is the only thing the screen
 * renders, so it can never say a sentence this function did not produce.
 */
export function buildResultsView(shipments: ReadonlyArray<ShipmentPresentation>): ResultsView {
  const rows: Record<ResultsGroup, ResultsRow[]> = { worked: [], down: [], flat: [], reading: [] };
  for (const p of shipments) rows[groupOf(p.read)].push(rowOf(p));
  for (const g of Object.keys(rows) as ResultsGroup[]) rows[g].sort((a, b) => a.sort - b.sort);
  const counts = { worked: rows.worked.length, down: rows.down.length, flat: rows.flat.length, reading: rows.reading.length };

  // The denominator is SETTLED changes only: the ones that finished their 28 day read.
  const settled = shipments.filter((p) => isMature(p.read.basisDay) && groupOf(p.read) !== "reading");
  const wins = settled.filter((p) => groupOf(p.read) === "worked");
  const soonestDay = monthDayLabel(shipments
    .map((p) => p.read.windows.find((w) => w.state !== "closed")?.closesOn ?? null)
    .filter((d): d is string => d != null).sort()[0] ?? null);

  // NET, NOT CHERRY PICKED. The headline totals used to add up the wins alone, so a site that lost
  // more than it gained still read "+54 clicks added". They now add up EVERY settled row exactly as
  // the screen prints it (rounded, and nothing from a row that claims no number), and the gross from
  // the wins drops to the smaller second line beside what the rest gave back.
  const counted = settled.filter((p) => p.read.verdict !== "confounded" && p.read.verdict !== "insufficient_evidence");
  const won = (p: ShipmentPresentation) => groupOf(p.read) === "worked";
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
        ? { value: soonestDay ? `First result lands ${soonestDay}` : "First result lands once a read closes", sub: "Nothing has finished its 28 day read yet", isCount: false }
        // BANKED, NEVER CHERRY PICKED: the wins are counted against every change that finished, and the ones that
        // did not win are named as what they taught rather than left out of the sentence.
        : { value: `${num(wins.length)} ${wins.length === 1 ? "win" : "wins"}`, isCount: true,
            sub: `out of ${settled.length} finished${settled.length > wins.length ? "; the rest taught what does not move this site" : ""}` },
      clicks: clicked.length === 0
        ? { value: rateReads > 0 ? `${rateReads} read in click rate` : "Nothing read yet", positive: false, note: null }
        : { value: signed(clicks), positive: clicks > 0,
            note: `${fromWins(clicksWon, clicks)}${rateReads > 0 ? `, plus ${rateReads} more read in click rate` : ""}` },
      appearances: seen.length === 0
        ? { value: "Not enough read yet", positive: false, note: null }
        : { value: signed(appearances), positive: appearances > 0, note: fromWins(appearancesWon, appearances) },
      reading: { value: num(counts.reading), sub: soonestDay ? `next result lands ${soonestDay}` : "next result lands once a read closes" },
      window: settled.length === 0
        ? "Nothing has finished its 28 day read yet."
        : `Across the ${num(settled.length)} ${settled.length === 1 ? "change" : "changes"} that finished their 28 day read.`,
    },
    defaultGroup: counts.worked > 0 ? "worked" : counts.down > 0 ? "down" : counts.reading > 0 ? "reading" : "flat",
  };
}
