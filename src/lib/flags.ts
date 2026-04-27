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
 * Phase 0.5 — event-level truth side-by-side preview at `/changes/truth`.
 * Off by default; route returns 404 and the `/changes` link is hidden.
 */
export function isEventTruthPreviewEnabled(): boolean {
  return process.env.BEACON_EVENT_TRUTH_PREVIEW === "1";
}

/**
 * Phase 1 — when enabled, the scan orchestrator will AUTO-create a
 * structured ChangelogEntry for every schema-only snapshot diff it sees
 * (no operator click required).
 *
 * OFF by default. Manual-confirm path through `confirmFindingAsChange()`
 * remains the only route to create structured schema-experiment entries
 * until this flag is flipped. This guards against stray template/CMS
 * edits polluting the pattern brain with unintended samples during the
 * first week of dogfeed.
 *
 * Wire-up in the scan orchestrator is deferred — this helper exists so
 * the policy decision is a one-line env toggle when we're ready.
 */
export function isSchemaAutoPromoteEnabled(): boolean {
  return process.env.BEACON_AUTO_PROMOTE_SCHEMA === "1";
}

/**
 * Controls whether the scanner auto-links pending findings to recent
 * changelog entries (see `generateFindings()` auto-reconcile loop).
 *
 * **OFF by default.** When disabled, every scan finding stays in
 * `status: "pending"` until an operator explicitly confirms or dismisses
 * it — which is what's needed for the Phase 1 schema-experiment flow to
 * work correctly (structured fields only get stamped via the manual
 * `confirmFindingAsChange()` path).
 *
 * Historically the auto-link used a 30-day window + loose keyword match,
 * which silently collapsed brand-new experiments (tonight's `/our-process`
 * HowTo addition) into unrelated 16-day-old changelog entries whose
 * descriptions happened to mention "schema" or "faq." Disabling by default
 * forces every finding through the operator-in-the-loop path.
 *
 * Flip `BEACON_AUTO_LINK_FINDINGS=1` to re-enable the legacy behavior.
 * Do NOT flip it while running the Phase 1 schema-experiment dogfeed.
 */
export function isFindingAutoLinkEnabled(): boolean {
  return process.env.BEACON_AUTO_LINK_FINDINGS === "1";
}

/**
 * Recommendation Lifecycle OS — Phase 3 (2026-04-27).
 *
 * Gates the scan-side match runner. **OFF by default.** When OFF the
 * scan orchestrator behaves byte-identically to pre-Phase-3 — no
 * lifecycle reads, no reconciliation, no match engine call, no
 * recommended_edits writes, no changelog `live_at` stamps.
 *
 * Flip `BEACON_LIFECYCLE_ENABLED=1` to enable. Recommended dogfeed
 * sequence:
 *   1. Verify pure match engine purity invariants (Phase 2) green.
 *   2. Sign off Phase 3 in `.data/exit-gates.json`.
 *   3. Set `BEACON_LIFECYCLE_ENABLED=1` locally; run a manual scan;
 *      verify `recommended_edits` lifecycle fields populate correctly.
 *   4. Only then enable on Vercel.
 *
 * Phase 4 (verdict engine reads `live_at`) ships behind a SEPARATE
 * flag so the lifecycle flip and the attribution change can be
 * rolled back independently.
 */
export function isLifecycleEnabled(): boolean {
  return process.env.BEACON_LIFECYCLE_ENABLED === "1";
}

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
