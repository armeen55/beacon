/**
 * Native polling regime boundary — the canonical date that separates
 * the Profound-benchmark regime (everything through this date - 1 day)
 * from the native polling regime (this date forward).
 *
 * Native polls began 2026-04-22.
 *
 * Intentionally hardcoded rather than derived dynamically from data — a
 * "find the last benchmark date" heuristic silently shifts as shards
 * land out of order.
 *
 * **Why this lives in its own file:** previously declared inside
 * `url-citation-history.ts` which carries `import "server-only"`. Client
 * components on /today (T3.1 Trust Sprint score-provenance disclosures)
 * need to flag windows that touch the pre-cutover regime, and they
 * cannot reach a server-only module. Extracting the constant to a
 * client-safe file keeps a single canonical source-of-truth without
 * leaking server-side internals into client bundles.
 *
 * The architecture invariant
 * `tests/architecture/measurement-quality-boundary-pin.test.ts`
 * pins this file as the SINGLE canonical declaration; any other
 * `2026-04-22` literal in `src/**` is a regression.
 */
export const NATIVE_REGIME_START = "2026-04-22";
