import "server-only";

// Pure canonicalization helper lives in a client-safe module so the
// Today v2 chart can reuse it without dragging server-only into the
// browser bundle. Re-exported below for backwards compatibility with
// callers that already import from this file.
import {
  canonicalizePollPlatform as canonicalizePollPlatformPure,
  type PollPlatform as PollPlatformPure,
} from "./poll-platform-canonical";

export type PollPlatform = PollPlatformPure;
export const canonicalizePollPlatform = canonicalizePollPlatformPure;

/**
 * Poll-health surfaces whether yesterday's (or today's) native poll cron
 * actually ran cleanly. The UI renders a status strip at the top of /today
 * and the `scripts/check-yesterday-poll.ts` canary calls this module to
 * decide whether to exit non-zero and trip a GitHub Actions email alert.
 *
 * Context: hosted polling chunks each platform's 100 prompts into 4 × 25,
 * fired sequentially from a GitHub Actions workflow. On 2026-04-23, ChatGPT's
 * 4 chunks all failed silently (OPENAI_API_KEY missing from Vercel env);
 * curl returned HTTP 200 with `status: "failed"` JSON bodies, GitHub reported
 * the job green, and the silent failure was only caught hours later via
 * manual probe. This module fixes that blind spot.
 */

/**
 * Partial-day patch (2026-05-04, post-W4 audit): describes the SHAPE
 * of a day's sample, independent of run-level pass/fail.
 *
 *   "full"    → ≥ 80 observations persisted (a normal-sized daily run).
 *   "partial" → 10–79 observations persisted (some chunks landed but
 *               not enough to power headline deltas confidently).
 *   "proof"   → 1–9 observations persisted (a manual-proof-style run;
 *               these days should NOT distort headline KPI deltas as
 *               if they were full days).
 *   "empty"   → 0 observations persisted on this platform today.
 *
 * The thresholds are operator-locked at 80 / 10 / 1; downstream
 * surfaces (KPI tiles, sparklines) read this field to mute or warn
 * on small-sample days. Backwards compatibility: when the cross-check
 * isn't supplied to `computePollHealthFromRuns` (legacy callers), the
 * field is always `"full"` for runs with completedChunks > 0 and
 * `"empty"` otherwise — no behavioral change.
 */
export type SamplingStatus = "full" | "partial" | "proof" | "empty";

/** Operator-locked thresholds. */
const FULL_RUN_PROMPT_FLOOR = 80;
const PROOF_RUN_PROMPT_CEIL = 9;

// Canonical `canonicalizePollPlatform` lives in `poll-platform-canonical.ts`
// (pure, client-safe). Re-exported at the top of this file for
// backwards compatibility with existing import sites.

/**
 * Partial-day classifier (2026-05-04). Operator-locked thresholds at
 * 80 / 10 / 1 reflect the production daily-poll target (100 prompts
 * per platform per day). Days that fall below the floor should not
 * drive headline KPI deltas as if they were full days.
 */
export function classifySampling(observationsWritten: number): SamplingStatus {
  if (observationsWritten <= 0) return "empty";
  if (observationsWritten <= PROOF_RUN_PROMPT_CEIL) return "proof";
  if (observationsWritten < FULL_RUN_PROMPT_FLOOR) return "partial";
  return "full";
}

