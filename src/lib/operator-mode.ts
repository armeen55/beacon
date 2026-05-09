/**
 * Operator-mode env contract — single source of truth.
 *
 * Beacon has TWO operator-mode signals because Next.js client bundles
 * cannot read non-`NEXT_PUBLIC_*` env vars:
 *
 *   • `BEACON_OPERATOR_MODE` — server-only. Visible to server
 *     components, server actions, route handlers, scripts, and cron
 *     entry points. NEVER inlined into the client bundle.
 *   • `NEXT_PUBLIC_OPERATOR_MODE` — public; inlined into the client
 *     bundle at build time. Visible to client components AND server
 *     code, but its value is whatever was set when Vercel built the
 *     deployment.
 *
 * Customer environments default to BOTH UNSET ⇒ both helpers return
 * false ⇒ no debug surfaces, no UUID data-attrs, no internal-tooling
 * affordances. Operator environments must set BOTH intentionally.
 *
 * Rules (enforced by tests/architecture/operator-mode-helpers.test.ts):
 *
 *   1. Production code must call these helpers, not read
 *      `process.env.BEACON_OPERATOR_MODE` /
 *      `process.env.NEXT_PUBLIC_OPERATOR_MODE` directly.
 *   2. Server-only gates (server components, route handlers, server
 *      actions) must use `isOperatorModeServer()`. Never use the
 *      client variant for a server-only gate — its value is fixed at
 *      build time and cannot be flipped without a redeploy.
 *   3. Client-only debug surfaces (data-attrs, debug panels, dev-tool
 *      affordances) must use `isOperatorModeClient()`. Never read the
 *      server-only `BEACON_OPERATOR_MODE` from a client component —
 *      it is `undefined` after Next.js client compilation and the
 *      gate would silently always-false.
 *   4. The customer-mode default (both env vars unset) must remain
 *      `false` for both helpers.
 */

/**
 * Server-side operator gate.
 *
 * Reads `BEACON_OPERATOR_MODE === "true"`. Use for server components,
 * route handlers, server actions, scripts, and any other code that
 * runs only on the server.
 *
 * Returns `false` when the env var is unset, set to anything other
 * than the literal string `"true"`, or read from a client bundle
 * (where `process.env.BEACON_OPERATOR_MODE` is `undefined`).
 */
export function isOperatorModeServer(): boolean {
  return process.env.BEACON_OPERATOR_MODE === "true";
}

/**
 * Client-side operator gate.
 *
 * Reads `NEXT_PUBLIC_OPERATOR_MODE === "true"` OR `NODE_ENV === "test"`.
 * The NODE_ENV branch preserves snapshot/assertion tests that pre-date
 * this helper without requiring per-test env plumbing.
 *
 * Use for client components — debug panels, debug data-attributes,
 * dev-tools affordances, anything that should disappear from
 * customer-mode renders.
 *
 * Safe to call from server code too: `NEXT_PUBLIC_*` vars are
 * available everywhere. Prefer `isOperatorModeServer()` for
 * server-only gates so the gate can be flipped at deploy time
 * without rebuilding the client bundle.
 */
export function isOperatorModeClient(): boolean {
  return (
    process.env.NEXT_PUBLIC_OPERATOR_MODE === "true" ||
    process.env.NODE_ENV === "test"
  );
}
