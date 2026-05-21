/**
 * Slice 4.5.D.α₁c (2026-05-20) — promotion live-write env gate.
 *
 * Reads `BEACON_PROMOTION_LIVE_WRITE_ENABLED === "true"`. Strict
 * case — mirrors `isOperatorModeServer()` convention. Default
 * UNSET ⇒ disabled. `"True"` / `"1"` / `"yes"` all DISABLE.
 *
 * Read by page.tsx (UI render gate) AND actions.ts (server-action
 * defense-in-depth gate). Pinned by `recommendation-intelligence-
 * promotion-live-write-guards`.
 */
export function isPromotionLiveWriteEnabled(): boolean {
  return process.env.BEACON_PROMOTION_LIVE_WRITE_ENABLED === "true";
}
