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
