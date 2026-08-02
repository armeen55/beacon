/**
 * Quota/waste guard (2026-06-17) — keep TEST runs off the live/prod database.
 *
 * Root cause of the egress blowout: local dev + some tests could reach the REAL
 * production Supabase (prod creds in `.env.local`), so an accidental full-suite
 * run or a left-open dev tab burned prod egress like a careless crawler. This
 * module is the single, importable (NOT server-only) guard both the app client
 * factory and the test gates use.
 *
 * Policy: a TEST run must NEVER connect to a hosted/prod Supabase unless the
 * operator EXPLICITLY opts in with `BEACON_LIVE_DB_TESTS=1` (or the alias
 * `BEACON_ALLOW_LIVE_DB_TESTS=1`). Local Supabase (127.0.0.1 / localhost) is
 * always fine.
 */

/** True only when live external-DB access is explicitly opted into. */
function isLiveDbTestAllowed(): boolean {
  return (
    process.env.BEACON_LIVE_DB_TESTS === "1" ||
    process.env.BEACON_ALLOW_LIVE_DB_TESTS === "1"
  );
}

/** True when we're running under a test runner (vitest sets VITEST). */
function isTestRuntime(): boolean {
  return process.env.VITEST != null || process.env.NODE_ENV === "test";
}

/**
 * A hosted/prod Supabase URL — `*.supabase.co` (or .in). Local dev uses
 * 127.0.0.1 / localhost (the `supabase start` stack), which is always allowed.
 */
function looksLikeHostedSupabase(url: string): boolean {
  if (/localhost|127\.0\.0\.1|\[::1\]/i.test(url)) return false;
  return /\.supabase\.(co|in)\b/i.test(url);
}

/**
 * Throw LOUDLY if a test run is about to connect to a hosted Supabase without
 * the explicit opt-in. Called from the admin client factory so EVERY path
 * (app loaders reached from tests, the repository backend, scripts) is covered.
 */
export function assertHermeticSupabase(url: string): void {
  if (!isTestRuntime()) return;
  if (!looksLikeHostedSupabase(url)) return;
  if (isLiveDbTestAllowed()) return;
  throw new Error(
    "[live-db-guard] Refusing to connect to a hosted Supabase from a test run " +
      "(this is how a pre-prod app burns prod egress). Tests must be hermetic. " +
      "Use a local Supabase or file mode; set BEACON_LIVE_DB_TESTS=1 to opt in " +
      "for the rare live integration test.",
  );
}
