/**
 * Legacy kill-switch flags (2026-06-26, Core Consolidation Phase E.0 — Step 3).
 *
 * Quarantine legacy systems WITHOUT deleting them: an env-gated flag per legacy
 * subsystem. DEFAULT = NOT quarantined, so customer surfaces are unchanged until
 * an operator deliberately flips a flag. The point is to turn a legacy path OFF
 * (and watch the unified ActionPack brain carry the load) BEFORE the code is
 * physically removed — a reversible step between "live" and "deleted".
 *
 * Wiring contract: a legacy surface/trigger checks `isLegacyQuarantined(x)` at its
 * entry; when true it no-ops (returns empty / hides) and the operator diagnostics
 * show it as "legacy quarantined". The ActionPack diagnostics are NEVER gated.
 *
 * PURE (reads env only). No I/O.
 */

export type LegacySystem =
  | "visibility_score"        // brand-SoV score surfaces (today v2 hero/leaderboard/chart) — superseded by per-prompt Profound coverage
  | "profound_brand_sov"      // the old visibility/SoV-based AEO-gap trigger — superseded by per-prompt coverage
  | "legacy_rec_scorer"       // recommendations/{prioritize,generate,load-queue} competing customer scorer
  | "semrush"                 // SEMrush connector + semrush-page-signals triggers — replaced by DataForSEO
  | "agent_analytics_writer"; // sync-nightly bots/referrals writers (403 on this key)

export const LEGACY_SYSTEMS: LegacySystem[] = [
  "visibility_score",
  "profound_brand_sov",
  "legacy_rec_scorer",
  "semrush",
  "agent_analytics_writer",
];

const ENV_KEY: Record<LegacySystem, string> = {
  visibility_score: "BEACON_QUARANTINE_VISIBILITY_SCORE",
  profound_brand_sov: "BEACON_QUARANTINE_PROFOUND_BRAND_SOV",
  legacy_rec_scorer: "BEACON_QUARANTINE_LEGACY_REC_SCORER",
  semrush: "BEACON_QUARANTINE_SEMRUSH",
  agent_analytics_writer: "BEACON_QUARANTINE_AGENT_ANALYTICS_WRITER",
};

/** True when the operator has flipped this legacy system OFF. Default false
 *  (legacy stays live) so nothing changes for customers until intentionally set. */
export function isLegacyQuarantined(system: LegacySystem): boolean {
  return process.env[ENV_KEY[system]] === "true";
}

/** Operator-diagnostic readout: each legacy system + whether it's quarantined. */
export function legacyQuarantineStatus(): Array<{ system: LegacySystem; envKey: string; quarantined: boolean }> {
  return LEGACY_SYSTEMS.map((system) => ({ system, envKey: ENV_KEY[system], quarantined: isLegacyQuarantined(system) }));
}
