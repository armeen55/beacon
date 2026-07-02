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

/** Plain-English "how we track it" line (the 7/14/28 cadence detail lives in "How we know"). */
export function trackingLine(controlCount: number): string {
  return controlCount > 0
    ? `I'll compare this page to ${controlCount} similar page${controlCount === 1 ? "" : "s"} so we know it was the change, not luck. First results in about a week.`
    : `I'll track this page's clicks after the change. First results in about a week.`;
}
