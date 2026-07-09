/**
 * daily-experiments-copy (2026-07-01, assistant-first A) — the PURE friendly-language layer for the
 * daily card. No "use client", no I/O, no actions: just the words the operator sees, so they can be
 * unit-tested and can never drift back into lab jargon. The science keys (lever ids, status ids) are
 * unchanged; this only maps them to plain English. No em dashes anywhere.
 */

import type { PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";
import type { DailyExperimentItemStatus } from "@/domains/experiments/execution-state";

/** Plain names for the kind of change (never "lever", "meta tag", "H1 element"). */
export const LEVER_LABEL: Record<string, string> = {
  meta: "Description",
  internal_link: "Internal link",
  answer_block: "Answer",
  title: "Title",
  h1: "Headline",
  refresh: "Refresh",
};

/** Friendly, assistant-voice status labels. Internal state keys are unchanged. */
export const STATUS_LABEL: Record<DailyExperimentItemStatus, string> = {
  ready_to_apply: "Ready to apply",
  verification_pending: "Checking the page...",
  verification_failed: "Couldn't confirm",
  verified_live: "Change confirmed",
  activation_pending: "Starting...",
  active: "Live, tracking results",
  gsc_submission_pending: "Sending...",
  gsc_submitted: "Sent to Google",
  skipped: "Skipped",
  rolled_back: "Rolled back",
};

/** A friendly one-line "The move" headline, derived from the kind of change + the page. */
export function moveHeadline(e: Pick<PlannedExperimentRecord, "lever" | "pageLabel">): string {
  switch (e.lever) {
    case "meta": return `Sharpen the description on ${e.pageLabel}`;
    case "answer_block": return `Put the answer first on ${e.pageLabel}`;
    case "internal_link": return `Add a helpful link on ${e.pageLabel}`;
    case "title": return `Tighten the title on ${e.pageLabel}`;
    case "h1": return `Tighten the headline on ${e.pageLabel}`;
    case "refresh": return `Refresh ${e.pageLabel} with the missing section`;
    default: return `Improve ${e.pageLabel}`;
  }
}

/** Plain-English "how we track it" line (the 7/14/28 cadence detail lives in "How we know").
 *  operator spec 2026-07-09 E-34: never claims causal certainty ("so we know it was the change,
 *  not luck") - names the comparison-page count as what makes this a fair ESTIMATE, not proof. */
export function trackingLine(controlCount: number): string {
  return controlCount > 0
    ? `I compare this page to ${controlCount} similar page${controlCount === 1 ? "" : "s"} I did not touch, so this is a fair estimate of the change's effect, not proof. First results in about a week.`
    : `I'll track this page's clicks after the change. First results in about a week.`;
}

/**
 * R14a - plain first-person sentences for every planner ExcludedReason code, so the
 * "Why not the others?" expander can never show a raw code. The four hold reasons
 * (interference_hold / last_clean_donor / query_overlap_hold / prerequisite_pending)
 * normally arrive with the planner's own richer plainReason sentence frozen on the
 * record; these entries are their fallbacks. Keys mirror ExcludedReason in daily-experiment-planner.ts +
 * EligibilityReason in experiment-eligibility.ts (pinned by daily-experiments-copy.test.ts).
 */
export const EXCLUDED_REASON_COPY: Record<string, string> = {
  // eligibility reasons
  page_measuring: "I am already tracking a change on this page.",
  active_control: "This page is serving as a comparison page for a change I am still tracking.",
  same_family_measuring: "A similar page has a change mid-flight, and two at once would muddy both reads.",
  recent_no_lift: "I tried this kind of change here recently and it did not move the number.",
  ownership_uncertain: "I am not confident this page really owns the search I would aim at.",
  high_risk_page: "This page earns too much to risk a change on right now.",
  stale_research: "My research on this page has gone stale, so I am refreshing it before I act.",
  compound_edit: "This page changed recently, and stacking edits would hide which one worked.",
  insufficient_controls: "I could not find enough similar pages to compare it against.",
  // planner caps + holds
  page_family_cap: "Tonight's batch already has enough pages of this kind.",
  action_family_cap: "Tonight's batch already has enough changes of this kind.",
  high_traffic_cap: "Tonight's batch already carries enough of your busiest pages.",
  budget_full: "Tonight's time budget was already full.",
  over_max: "Tonight's list was already full.",
  influenced_conflict: "It touches a page tonight's picks already influence.",
  underpowered: "This page does not get enough traffic yet for me to prove an effect either way.",
  lever_retired: "I stopped making this kind of change on pages like this after it lost repeatedly.",
  interference_hold: "I am holding it while nearby changes finish their reads.",
  last_clean_donor: "It is the last clean comparison page for a change I am still tracking.",
  query_overlap_hold: "It competes for the same searches as a change I am already tracking.",
  evidence_expired: "The evidence behind it went stale, so I am re-checking before I act.",
  prerequisite_pending: "Something else needs to happen on this page first, so I am holding this until that is done.",
};

/** One plain sentence for an excluded candidate: the planner's own frozen sentence when it
 *  wrote one, else the reason-code translation, else an honest generic hold. Never a raw code. */
export function excludedReasonSentence(e: { reason: string; plainReason?: string }): string {
  return e.plainReason ?? EXCLUDED_REASON_COPY[e.reason] ?? "I held this one back tonight.";
}
