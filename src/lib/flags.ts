/**
 * Feature flags.
 *
 * First flag helper in the repo. Future flags should follow the same
 * shape — a named boolean reader, server-side only, no `NEXT_PUBLIC_*`
 * unless a flag genuinely needs to be inspected from client code.
 *
 * Defaults are OFF. Flip by setting the env var to `"1"`.
 */

import "server-only";

/**
 * Recommendation Lifecycle OS — Phase 4 (2026-04-27).
 *
 * Switches the URL verdict engine's baseline-split timestamp from
 * `entry.timestamp` (operator's accept time) to
 * `entry.live_at ?? entry.timestamp` (scan-verified live time).
 * Also enables the new `not_implemented` verdict label for changelog
 * entries linked to `recommended_edits` rows in the
 * `not_found_after_7d` lifecycle state.
 *
 * **OFF by default.** When OFF: verdict engine behaves byte-identically
 * to pre-Phase-4 — no `live_at` reads, no `not_implemented` label,
 * no recommended_edits join. When ON: the precedence and the new
 * label both activate together.
 *
 * Independent of `BEACON_LIFECYCLE_ENABLED` so the lifecycle runner
 * (Phase 3) and the attribution change (Phase 4) can be rolled back
 * independently. Recommended dogfeed sequence: enable
 * `BEACON_LIFECYCLE_ENABLED=1` first, run scans for ≥7 days to
 * accumulate `live_at` stamps + a `not_found_after_7d` row or two,
 * then flip `BEACON_LIFECYCLE_VERDICT_ENABLED=1` and compare /changes
 * verdicts before/after.
 */
export function isLifecycleVerdictEnabled(): boolean {
  return process.env.BEACON_LIFECYCLE_VERDICT_ENABLED === "1";
}

