/**
 * results-presentation (V1 Truth Convergence Phase 8) - EVERY operator-facing string the Results
 * surface says about one shipped change, as pure functions over what the kernels already compute.
 *
 * Nothing here decides anything. The measurement kernel owns the verdict, the AI reader owns the
 * before and after, the Shipment store owns what the live check found; this module only puts those
 * answers into the operator's own words, in ONE place, so a test can read every sentence the screen
 * can print without rendering a page. Two exported functions, because the card and the trend are
 * the only two things Results draws.
 *
 * Three rules hold on every string below. No raw slug ever reaches the screen (an action, a
 * component kind and a diagnosis all resolve through a closed map, and an unmapped one is left out
 * rather than printed). No raw date stamp reaches it either (a day renders as "Jul 3"). And a
 * missing answer says it is missing: a count nobody has read is never a zero.
 */

import { monthDayLabel } from "@/components/data/receipt-line";
import type { AiOutcomeReport, KernelRead, ShipmentAiOutcome, ShipmentVerification } from "@/domains/measurement";

/** What one measured change carries on the Results surface. */
export type ShipmentPresentation = {
  read: KernelRead;
  /** The day the operator marked it done. Null on a record written before there was a stamp. */
  implementedAt: string | null;
  verification: ShipmentVerification | null;
  /** The immutable numbers this page stood at when it was marked done. */
  baseline: { clicks: number; impressions: number; windowDays: number; capturedAt: string } | null;
  ai: ShipmentAiOutcome | null;
};

/** "done" already happened, "waiting" has not, "shared" belongs to more than one change. */
type StepState = "done" | "waiting" | "shared";

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

// ── the closed label maps (a slug never reaches the screen) ──────────────────

/** What the change actually was, said the way an operator would say it. */
const WORK_LABEL: Record<string, string> = {
  title: "the page title", meta: "the search description", h1: "the page headline",
  opening_answer: "the answer at the top of the page", answer_block: "the answer at the top of the page",
  intro_answer_block: "the answer at the top of the page",
  section: "a section of the page", section_add: "a new section", section_remove: "a section I removed",
  section_rewrite: "a rewritten section", restructure: "the order of the page",
  full_rewrite: "a full rewrite of the page", factual_correction: "a factual correction",
  paragraph_correction: "a corrected paragraph", source_pack: "the sources on the page",
  source_update: "the sources on the page", entity_expansion: "more detail on the page",
  table_or_list_add: "a table on the page", faq: "a visible questions and answers block",
  schema: "the structured data", internal_links: "the internal links", internal_link: "an internal link",
  internal_link_add: "an internal link", internal_link_remove: "a removed internal link",
  anchor_text: "the wording of a link", canonical: "the canonical address",
  redirect: "a redirect", noindex: "hiding the page from search", navigation: "the site navigation",
  consolidation: "merging two pages into one", new_page: "a brand new page",
  keep_current: "watching the page without changing it", monitor: "watching the page without changing it",
};

/** A ledger row names its own action with a verb on the front; the same closed map answers for it.
 *  Unmapped input reads as "this change", never as its slug. */
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

const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", claude: "Claude",
};

// ── 1. did it actually land on the live page ────────────────────────────────

/** The headline sentence for the live check. A null verification is a real state: I have not looked. */
function verificationHeadline(v: ShipmentVerification | null): string {
  if (!v) return "I have not read your live page for this one yet. I look on your next visit.";
  switch (v.status) {
    case "verified": return "I checked your live page and found everything we agreed.";
    case "partially_verified": return "I checked your live page: part of this is live and part of it is not.";
    case "not_found": return "I checked your live page and none of this change is on it yet.";
    case "differs": return "I checked your live page and what is there is not what we agreed.";
    case "blocked": return "Your site did not answer when I went to look, so this is still your word rather than my own check. I try once more on a later day.";
    case "operator_confirmed": return "You told me this is live, so I am measuring from your word rather than from a check of my own.";
  }
}

/** One sentence per component, so a partly applied bundle reads as partly applied. */
function componentLines(v: ShipmentVerification | null): string[] {
  if (!v) return [];
  return v.components.map((c) => {
    const label = workLabel(c.kind);
    switch (c.state) {
      case "verified": return `${cap(label)} is exactly what we agreed.`;
      case "missing": return `${cap(label)} is not there yet.`;
      case "differs": return `${cap(label)} is on the page, but not in the words we agreed.`;
      case "unknown": return `I cannot see ${label} from outside the page, so I am not calling it either way.`;
    }
  });
}

// ── 2. the starting point that never changes ────────────────────────────────

function baselineLine(p: ShipmentPresentation): string | null {
  if (!p.baseline) return null;
  const day = monthDayLabel(p.implementedAt ?? p.baseline.capturedAt);
  const when = day ? `When you marked this done on ${day}` : "When you marked this done";
  const { clicks, impressions, windowDays } = p.baseline;
  if (impressions <= 0) {
    return `${when}, this page had no Google traffic on file over the ${windowDays} days before it. I hold that starting point exactly as it was, and it never moves.`;
  }
  return `${when}, this page had ${num(clicks)} ${clicks === 1 ? "click" : "clicks"} and ${num(impressions)} appearances in Google over the ${windowDays} days before it. I hold that starting point exactly as it was, and it never moves.`;
}

// ── 3. the timeline and the window chips ────────────────────────────────────

/** The honest chip word for one measurement window. A window shared with a later change is amber. */
function windowChip(w: KernelRead["windows"][number]): { text: string; state: StepState } {
  if (w.confounded != null && w.state === "closed") return { text: `${w.day} days: shared with a later change`, state: "shared" };
  if (w.state === "closed") return { text: `${w.day} days: read`, state: "done" };
  if (w.state === "pending_data") return { text: `${w.day} days: waiting on Google`, state: "waiting" };
  return { text: `${w.day} days: still open`, state: "waiting" };
}

/** Marked done, checked live, then every checkpoint, including the 56 day follow up when one ran. */
function timelineSteps(p: ShipmentPresentation): Array<{ label: string; state: StepState; when: string | null }> {
  return [
    { label: "You marked it done", state: (p.implementedAt ? "done" : "waiting") as StepState, when: monthDayLabel(p.implementedAt) },
    {
      label: p.verification ? "I checked your live page" : "I check your live page",
      state: (p.verification ? "done" : "waiting") as StepState,
      when: monthDayLabel(p.verification?.checkedAt ?? null),
    },
    ...p.read.windows.map((w) => ({ label: `${w.day} day read`, state: windowChip(w).state, when: monthDayLabel(w.closesOn) })),
  ];
}

/** Why some window chips are not painted as this change's own. Null when every read is clean. */
function overlapNote(read: KernelRead): string | null {
  const shared = read.windows.some((w) => w.confounded != null);
  if (!shared && read.overlappingIds.length === 0) return null;
  const day = monthDayLabel(read.cleanUntil);
  if (day) return `I changed this page again on ${day}. The windows that closed after that day belong to both changes, so I do not count them as this one's.`;
  const n = read.overlappingIds.length;
  if (n === 0) return null;
  return `I made ${n} other ${n === 1 ? "change" : "changes"} on this page in the same window, so the movement here belongs to more than one change and I will not hand it to this one.`;
}

// ── 4. the two results and what I learned ───────────────────────────────────

/** The AI half: which way it went, how much I actually read, and the kernel's own before and after. */
function aiResult(ai: ShipmentAiOutcome | null): { heading: string; coverage: string; line: string } | null {
  if (!ai) return null;
  const heading =
    ai.direction === "improved" ? "AI assistants name you more often than they did before this went live."
      : ai.direction === "worsened" ? "AI assistants name you less often than they did before this went live."
        : ai.direction === "flat" ? "AI assistants name you about as often as they did before."
          : "I cannot call the AI side of this one yet.";
  const { daysObserved, daysElapsed } = ai.coverage;
  const coverage = daysObserved === 0
    ? `I have not managed to read an AI answer on any of the ${daysElapsed} days since you marked this done.`
    : `I read on ${daysObserved} of the ${daysElapsed} days since then. A day I missed stays missed, and I never fill one in.`;
  return { heading, coverage, line: ai.line };
}

/** What this read carries forward. Every clause is dropped rather than guessed when the row lacks it. */
function learningLine(read: KernelRead): string {
  const l = read.learning;
  const family = FAMILY_LABEL[l.actionFamily];
  const cause = l.diagnosisCause ? CAUSE_LABEL[l.diagnosisCause] : undefined;
  const moved =
    l.outcomeDirection === "up" ? "the page moved up after it"
      : l.outcomeDirection === "down" ? "the page moved down after it"
        : l.outcomeDirection === "flat" ? "the page did not clearly move"
          : "it is too early to say which way this went";
  const parts: string[] = [];
  if (cause) parts.push(`I read this page as ${cause}`);
  if (family) parts.push(`I answered it with ${family}`);
  parts.push(moved);
  const receipts = typeof l.evidenceCompleteness === "number" && l.evidenceCompleteness > 0
    ? ` I had ${l.evidenceCompleteness} pieces of evidence behind that call.`
    : "";
  return `What I learned: ${parts.join(", ")}.${receipts} I carry that into what I recommend next on pages like this one.`;
}

/**
 * THE WHOLE STORY OF ONE SHIPPED CHANGE, in the operator's words. Pure. This is the only thing the
 * card renders, so the screen can never say a sentence this function did not produce.
 */
export function shipmentStory(p: ShipmentPresentation) {
  return {
    work: workLabel(p.read.actionType),
    verification: {
      headline: verificationHeadline(p.verification),
      components: componentLines(p.verification),
      checkedOn: monthDayLabel(p.verification?.checkedAt ?? null),
    },
    baseline: baselineLine(p),
    timeline: timelineSteps(p),
    chips: p.read.windows.map((w) => ({ day: w.day, ...windowChip(w) })),
    overlap: overlapNote(p.read),
    search: { headline: p.read.headline, caveats: p.read.caveats },
    ai: aiResult(p.ai),
    learning: learningLine(p.read),
  };
}

// ── 5. the AI trend, cut wherever the instrument changed ────────────────────

/**
 * The trend the surface draws: one run of points per stretch read on the same instrument, and a
 * NAMED break wherever an engine changed the model or the mode it answered in. A break is never a
 * joined line, because a step caused by the instrument would otherwise read as a win or a loss.
 * Pure.
 */
export function aiTrend(segments: AiOutcomeReport["segments"]) {
  const runs = segments.map((s) => {
    const first = s.boundary?.[0] ?? null;
    const day = monthDayLabel(first?.day ?? null);
    const engine = first ? ENGINE_LABEL[(first.engine || "").toLowerCase()] ?? "An AI assistant" : "";
    const breakLabel = first == null || day == null ? null
      : first.fromMode !== first.toMode
        ? `${engine} started answering me a different way on ${day}, so I start a new line here rather than joining two different readings.`
        : `${engine} changed the version behind its answers on ${day}, so I start a new line here rather than joining two different readings.`;
    return {
      breakLabel,
      points: s.days.map((d) => ({
        day: d.day,
        label: monthDayLabel(d.day) ?? d.day,
        rate: d.mentionRate,
        analyzed: d.analyzed,
      })),
    };
  });
  const read = runs.flatMap((r) => r.points).filter((p) => p.rate != null);
  const breaks = runs.filter((r) => r.breakLabel != null).length;
  const latest = read[read.length - 1];
  const summary = latest == null ? null
    : breaks === 0
      ? `On ${latest.label} you were named in ${Math.round((latest.rate ?? 0) * 100)} out of every 100 answers I read closely.`
      : `On ${latest.label} you were named in ${Math.round((latest.rate ?? 0) * 100)} out of every 100 answers I read closely. The line breaks ${breaks === 1 ? "once" : `${breaks} times`} because an assistant changed how it answers, and I never draw across a break.`;
  return { runs, summary };
}
