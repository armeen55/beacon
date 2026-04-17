/**
 * Phase 0 — static edit-type priors.
 *
 * Kept in its own module (no `server-only` import) so CLI scripts, pure
 * domain code, and tests can pull in the priors without dragging in the
 * full business-config surface. `business-config.ts` re-exports this
 * constant so existing call sites continue to work.
 *
 * Every use of a value from this table MUST write
 * `confidence_source: "seed_prior"` on the attribution record. These are
 * seed heuristics, not measured magnitudes.
 */

export const EVENT_PRIORS_V1 = {
  metadata_publication: 0.95,
  schema_rollout: 0.9,
  crawlability_fix: 0.9,
  page_created: 0.9,
  performance_batch: 0.85,
  content_rollout: 0.8,
  content_edit: 0.3,
} as const;

export type EventPriorType = keyof typeof EVENT_PRIORS_V1;
