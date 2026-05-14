/**
 * 2026-05-14 Phase A.2 Step 1 — cross-tenant brain trust thresholds.
 *
 * v1 trust thresholds, tunable. Locked per Section 3 Decision Lock
 * (E2 / E3 / E5) in
 * `~/.claude/plans/enter-maximum-depth-planning-mode-twinkly-balloon.md`.
 *
 * Sample-size gates (E3):
 *
 *   • `llm_packet: 5` — the operator-side trust threshold for
 *     surfacing a pattern in an LLM specific-edit packet. Mirrors
 *     the existing system-prompt Rule 15 floor ("prefer patterns
 *     with sampleSize >= 5"). Pinning here makes this module the
 *     single source of truth so future producer changes can't drift
 *     from the LLM-side gate.
 *
 *   • `customer_tile: 10` — more conservative gate for the
 *     customer-facing "Beacon learned" Today tile. A claim shown
 *     directly to a customer needs more underlying ship data than a
 *     hint shown to the LLM.
 *
 *   • `threshold_replacement: 20` — the per-tenant ship count at
 *     which Phase A.1's borrowed Profound 6/18/37 defaults are
 *     replaced by Beacon's own observed median for that tenant. Set
 *     conservatively so a thin or skewed sample never swaps the
 *     baseline silently.
 *
 * Packet cap (E5):
 *
 *   • `BRAIN_PACKET_CAP = 5` — maximum number of patterns sent in a
 *     single LLM specific-edit packet. Bounds token-input growth and
 *     prevents overfitting to a long tail of low-confidence patterns.
 *
 * Helping-rate floor + band (E2):
 *
 *   • `HELPING_RATE_FLOOR = 0.6` — minimum helping rate (0..1) the
 *     producer requires before treating a pattern as informative.
 *     Matches the system-prompt Rule 15 floor.
 *
 *   • `HELPING_RATE_BAND = "within_median_days"` — the locked
 *     definition of a "helping outcome." A ship is counted as having
 *     helped only when its first-citation date arrives within the
 *     median-days threshold (currently 18d). The per-action-type
 *     compute in Phase A.2 Step 3 consults this sentinel; the broader
 *     ("any citation ever") and narrower ("within fast_days") bands
 *     are deliberately NOT used in v1 — "within_median_days" is the
 *     conservative-but-rewarding choice.
 *
 * All values are `as const`; downstream consumers see literal types
 * (e.g., `BRAIN_SAMPLE_THRESHOLDS.llm_packet` is typed `5`, not
 * `number`).
 *
 * Pinned by `tests/architecture/brain-config-and-thresholds-provenance.test.ts`:
 *   • Canonical file path.
 *   • Exact values for every constant.
 *   • The "v1 trust thresholds, tunable" comment shape.
 *   • Module purity (no persistence / repository / citation-
 *     lifecycle / specific-edit-evidence imports).
 */

/**
 * Sample-size gates per surface. Tunable per operator decision; the
 * v1 values mirror the operator-locked E3 decision.
 */
export const BRAIN_SAMPLE_THRESHOLDS = {
  llm_packet: 5,
  customer_tile: 10,
  threshold_replacement: 20,
} as const;

/**
 * Maximum number of cross-tenant patterns the producer sends in a
 * single LLM specific-edit packet. E5 lock.
 */
export const BRAIN_PACKET_CAP = 5 as const;

/**
 * Minimum helping rate (0..1) before a pattern is considered
 * informative. Matches the existing system-prompt Rule 15 floor.
 */
export const HELPING_RATE_FLOOR = 0.6 as const;

/**
 * Locked definition of a "helping outcome": first citation arrives
 * within the median-days threshold (currently 18d). Sentinel string
 * consumed by the per-action-type compute in Phase A.2 Step 3.
 */
export const HELPING_RATE_BAND = "within_median_days" as const;
