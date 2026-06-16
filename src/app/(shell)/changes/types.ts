import type { ScorecardRowWithImpact } from "@/domains/attribution/change-impact";
import type { UrlVerdict } from "@/domains/attribution/url-verdict";

/**
 * Shared /changes row types.
 *
 * Surface collapse (2026-06-15) — these types used to live in the legacy
 * `scorecard-client.tsx`. They were imported by BOTH the legacy table and
 * the v2 proof timeline (`page.tsx` + `changes-v2-client.tsx`). When the
 * legacy client was deleted, the types moved here so the v2 surface no
 * longer depends on a legacy client module.
 */

/**
 * A single row on the /changes page.
 * - `scorecard` = the per-change row with topic event attributions
 *   (kept for drill-down context only; NOT used for the verdict).
 * - `urlVerdict` = the URL-level Z-score verdict (the new primary signal).
 *   null when the change has no URL (site-wide).
 * - `seriesPreview` = trimmed dense daily series around the change date for
 *   optional sparkline rendering in the expand panel.
 * - `hasUrl` = convenience; `false` means site-wide / untracked.
 * - `readyOn` = dynamic "Ready on [date]" prediction from the URL pattern
 *   brain, attached only when the verdict is `too_early`. Tells the
 *   operator when to check back for a landed verdict.
 */
export type EnrichedChangeRow = {
  scorecard: ScorecardRowWithImpact;
  urlVerdict: UrlVerdict | null;
  seriesPreview: Array<{ date: string; count: number }> | null;
  hasUrl: boolean;
  readyOn?: ReadyOnPrediction | null;
};

/**
 * G5 — "Ready on [date]" block shown on too-early rows. Sourced from the
 * URL pattern brain (`url-change-patterns.json`) when a matching bucket
 * exists, else a transparent fallback.
 */
export type ReadyOnPrediction = {
  /** ISO date string for when first verdict read-out is expected. */
  readyDate: string;
  /** Days from the change timestamp until readyDate. */
  daysFromChange: number;
  /** Bucket we derived from, or null when falling back. */
  patternId: string | null;
  /** Helping-count in bucket. 0 = fallback triggered. */
  helpingCount: number;
  /** Total sample count in the bucket. */
  sampleCount: number;
  /** Confidence tier of the bucket (null when fallback). */
  confidenceTier: "high" | "medium" | "low" | null;
  /** Plain-English sentence ready for render. */
  narrative: string;
};
