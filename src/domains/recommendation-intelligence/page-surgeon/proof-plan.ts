/**
 * Page Surgeon — PROOF PLAN substrate (PS6). NOT A/B testing. The first
 * practical proof loop: for each REVIEWED change (approve / needs_edit), lay out
 * exactly how it will be proven — the measurement window (7/14/28-day check-ins),
 * which GSC metrics will be re-checked (with today's baseline), and the control
 * pages chosen for a diff-in-diff. No cron, no writes — pure planning the
 * operator (or a later runner) executes.
 *
 * PURE. No I/O.
 */

import type { ReviewVerdict } from "./review-store";

export type ProofWindows = {
  decidedAt: string; // ISO
  checkIn7: string; // YYYY-MM-DD
  checkIn14: string;
  checkIn28: string;
};

export type ProofMetric = { label: string; baseline: string };

export type ProofPlanRow = {
  pageUrl: string;
  verdict: ReviewVerdict;
  headlineAction: string;
  decidedAt: string;
  windows: ProofWindows;
  /** GSC metrics that will be re-checked, with today's baseline value. */
  metricsToCheck: ProofMetric[];
  /** Comparable untreated pages for a diff-in-diff (paths). */
  controlPaths: string[];
  measurementPlan: string | null;
  note: string | null;
};

const DAY_MS = 86_400_000;
function addDays(iso: string, days: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

export function buildProofWindows(decidedAtIso: string): ProofWindows {
  return {
    decidedAt: decidedAtIso,
    checkIn7: addDays(decidedAtIso, 7),
    checkIn14: addDays(decidedAtIso, 14),
    checkIn28: addDays(decidedAtIso, 28),
  };
}

export type ProofPlanInput = {
  pageUrl: string;
  verdict: ReviewVerdict;
  headlineAction: string;
  decidedAt: string;
  measurementPlan: string | null;
  note: string | null;
  /** GSC baseline at decision time (what we'll measure the lift against). */
  gsc: { clicks: number; impressions: number; ctr: number; avgPosition: number; topQuery: string } | null;
  controlPaths: string[];
};

export function buildProofPlanRow(input: ProofPlanInput): ProofPlanRow {
  const metricsToCheck: ProofMetric[] = input.gsc
    ? [
        { label: `CTR for "${input.gsc.topQuery}"`, baseline: `${(input.gsc.ctr * 100).toFixed(2)}%` },
        { label: "Clicks (90d)", baseline: input.gsc.clicks.toLocaleString() },
        { label: "Impressions (90d)", baseline: input.gsc.impressions.toLocaleString() },
        { label: "Avg position", baseline: input.gsc.avgPosition.toFixed(1) },
      ]
    : [];
  return {
    pageUrl: input.pageUrl,
    verdict: input.verdict,
    headlineAction: input.headlineAction,
    decidedAt: input.decidedAt,
    windows: buildProofWindows(input.decidedAt),
    metricsToCheck,
    controlPaths: input.controlPaths,
    measurementPlan: input.measurementPlan,
    note: input.note,
  };
}
