/**
 * 2026-05-13 Phase A.1 — citation-lifecycle thresholds.
 *
 * BORROWED DEFAULTS. Source: Profound, "How long does it take a
 * marketing page to get cited?" study of ~900 marketing pages.
 * 50th / 75th / 90th percentile rounded to integer days
 * (6 / 18 / 37) per Section 2 Decision Lock D8.
 *
 * These are BORROWED — Beacon will replace them with its own
 * observed medians in Phase A.2 (brain activation, Section 3)
 * once a tenant accumulates >= 20 verified-live edits (per the
 * Section 3 threshold-replacement sample-size gate, E3).
 *
 * DO NOT REMOVE OR EDIT THE "BORROWED DEFAULTS" COMMENT BLOCK
 * WITHOUT UPDATING tests/architecture/thresholds-provenance.test.ts
 * WHICH PINS IT. Architecture invariant exists so the honesty
 * contract (customer sees "these are borrowed benchmarks until we
 * have enough of your data") cannot quietly drift.
 *
 * Consumed by:
 *   - src/domains/citation-lifecycle/lifecycle-stage.ts (band
 *     boundaries for cited_fast / cited_typical / cited_late /
 *     cited_very_late)
 *   - Today edit-lifecycle tile tooltip copy
 *   - Changes detail Act 3 lifecycle-stage copy
 */
export const T2C_THRESHOLDS = {
  fast_days: 6,
  median_days: 18,
  late_days: 37,
} as const;

export type T2cThresholds = typeof T2C_THRESHOLDS;
