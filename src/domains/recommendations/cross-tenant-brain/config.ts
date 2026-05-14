/**
 * 2026-05-14 Phase A.2 Step 1 — cross-tenant brain env gates.
 *
 * Two independent gates. Per the E1 lock in
 * `~/.claude/plans/enter-maximum-depth-planning-mode-twinkly-balloon.md`:
 *
 *   • `BEACON_CROSS_TENANT_BRAIN` — gates the producer + the
 *     LLM-packet pattern injection. When ON, the future
 *     `cross-tenant-brain/producer.ts` (Phase A.2 Step 4) emits real
 *     `CrossTenantPattern[]` aggregated from non-self tenants; when
 *     OFF (default), the producer returns `[]` and Beacon's behavior
 *     is unchanged.
 *
 *   • `BEACON_BRAIN_LEARNED_TILE` — gates the customer-facing
 *     "Beacon learned" Today tile (Phase A.2 Step 8). When OFF
 *     (default), the tile is hidden entirely.
 *
 * Why two flags: per E1, *computation can be safe before customer
 * copy is safe*. The producer can activate (gate 1 on) to validate
 * tenant isolation + privacy scrubbing + threshold accuracy WITHOUT
 * the customer-facing tile being live. The tile gate (gate 2) is the
 * separate honesty knob that says "we trust the numbers enough to
 * show them to a customer."
 *
 * Both flags default OFF. ONLY the literal string `"1"` enables a
 * flag — `"true"`, `"TRUE"`, any other truthy-looking value, and any
 * undefined / unset value all leave the flag OFF. Strict `"1"`
 * matches the Beacon convention for ops env flags (see
 * `BEACON_TODAY_V2`, `BEACON_CHANGES_V2`, `BEACON_OPERATOR_MODE`)
 * and prevents accidental enablement from typos like `"trueish"`.
 *
 * Implementation contract pinned by
 * `tests/architecture/brain-config-and-thresholds-provenance.test.ts`:
 *
 *   1. Both functions read `process.env.<NAME>` at CALL time, not at
 *      module-load time. Tests + scripts can `process.env.X = "1";`
 *      between calls and see the new state.
 *   2. No top-level `const VAR_NAME = process.env.X` — that would
 *      freeze the env at import time.
 *   3. No I/O, no logging, no side effects.
 *   4. No imports from persistence, repository, citation-lifecycle,
 *      or specific-edit-evidence layers — this module is pure
 *      constants + env reads.
 */

const PRODUCER_ENV_VAR = "BEACON_CROSS_TENANT_BRAIN";
const LEARNED_TILE_ENV_VAR = "BEACON_BRAIN_LEARNED_TILE";

/**
 * Gate for the cross-tenant brain producer + LLM-packet pattern
 * injection. Default OFF. Only the literal "1" enables.
 */
export function isCrossTenantProducerEnabled(): boolean {
  return process.env[PRODUCER_ENV_VAR] === "1";
}

/**
 * Gate for the customer-facing "Beacon learned" Today tile. Default
 * OFF. Only the literal "1" enables.
 */
export function isBrainLearnedTileEnabled(): boolean {
  return process.env[LEARNED_TILE_ENV_VAR] === "1";
}
