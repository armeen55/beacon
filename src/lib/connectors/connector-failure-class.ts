/**
 * connector-failure-class (2026-07-06) - degraded vs broken.
 *
 * ROOT CAUSE this fixes: the nightly sync computed its overall `ok` as
 * `failed === 0` (every per-connector result must be green). In production ONE
 * dead login (GA4 refresh returning invalid_grant on both tenants, a Ritz GSC
 * transient, a Clarity with no token) flipped the WHOLE run red every single
 * night, even though the core actually worked (Iranopedia GSC + Profound synced
 * fine). A permanently-red run masks whether a REAL new failure happened and
 * makes the daily automation look broken when it is not.
 *
 * The fix is a semantic split of a per-connector failure into two kinds:
 *
 *   - "degraded": a KNOWN, expected, non-alarming state that does NOT mean the
 *     automation is broken. The connector needs the operator to reconnect (a
 *     dead login), is not wired yet (no token / no property / no categories),
 *     or hit a transient blip it will retry tonight. Each of these is already
 *     surfaced honestly on the connector's own card (the reconnect line / the
 *     "connect to unlock" state), so the RUN itself should not go red for it.
 *
 *   - "broken": an UNEXPECTED failure - a database write failure, an infra
 *     outage, or a shape we do not recognize. This is the class that means "a
 *     real regression happened", and the ONLY class that turns the run red.
 *     Making the run red only on this restores a real regression's visibility.
 *
 * PURE: no I/O, string-classification only, so it stays trivially unit-testable
 * and every surface (the cron ledger `ok`, the health panel, the summary strip)
 * reads the SAME verdict. The full per-connector `{ ok, detail, provider,
 * tenantId }` is preserved verbatim in `per_source` regardless of this split -
 * this module only decides the run-level roll-up.
 */

/** A single connector outcome, exactly as cron-sync records it in per_source. */
export type ConnectorOutcome = {
  tenantId: string | null;
  provider: string;
  ok: boolean;
  /** The engine's reason string, OR a thrown error's message. */
  detail: string;
};

/** Whether a per-connector FAILURE is a known-degraded state or an unexpected
 *  break. Only "broken" turns a run red. */
export type FailureKind = "degraded" | "broken";

/**
 * KNOWN-degraded reason strings. These are the exact `reason` values the read
 * engines return on their expected non-alarming failure branches, grouped by
 * why each is degraded rather than broken:
 *
 *   dead login  - the grant is proven dead; the operator must reconnect. Already
 *                 surfaced as the reconnect line on the card.
 *   not wired   - the source was never connected / half-configured (no token,
 *                 no GA4 property, no Profound categories). Surfaced as the
 *                 "connect to unlock" state on the card.
 *   transient   - a blip (network / refresh race / misconfig) that resolves or
 *                 self-heals; retried tonight.
 */
const DEGRADED_REASONS: ReadonlySet<string> = new Set([
  // ---- dead login (needs reconnect) ----
  "token_expired", // GA4 grant proven dead
  "gsc_token_expired", // GSC grant proven dead
  "gsc_auth_failed_401",
  "gsc_auth_failed_403",
  // ---- not wired yet (connect to unlock) ----
  "no_token",
  "no_property",
  "no_property_derivable",
  "no_usable_gsc_token",
  "no_token_or_api_error",
  "no_profound_key",
  "no_categories_configured",
  "disconnected",
  // ---- transient (will retry tonight) ----
  "gsc_auth_transient",
  "gsc_client_misconfig", // Beacon's server config, not the operator's connection
  "gsc_day_pull_failed", // quota / network on the day pull - re-pulls next run
  "profound_api_error", // upstream API blip - re-polls next run
  "sync reported not-synced", // the generic not-synced fallback from syncSucceeded
]);

/** Regex fragments that mark a THROWN error message (not a clean reason string)
 *  as degraded. A dead login can surface as a thrown invalid_grant when the
 *  source's run() rejects rather than returning a reason. */
const DEGRADED_THROWN_PATTERNS: ReadonlyArray<RegExp> = [
  /invalid_grant/i, // dead refresh token
  /invalid_client/i, // Beacon's own OAuth client misconfig (reconnect can't fix, not a data regression)
];

/**
 * Classify ONE failed connector's detail as degraded or broken.
 *
 * Recognized clean reason strings map by the table above. An unrecognized
 * detail is "broken" by default (fail-LOUD: a shape we do not know about is
 * exactly the regression this must not hide) UNLESS it is a thrown error whose
 * message matches a known-degraded pattern (a dead-login exception).
 *
 * Note: DB-write / infra failures (gsc_daily_rows_upsert_failed,
 * gsc_page_totals_upsert_failed, upsert_failed, supabase_unavailable) are
 * deliberately NOT in DEGRADED_REASONS - those are real breaks and must turn
 * the run red.
 */
export function classifyConnectorFailure(detail: string): FailureKind {
  const d = detail.trim();
  if (DEGRADED_REASONS.has(d)) return "degraded";
  if (DEGRADED_THROWN_PATTERNS.some((re) => re.test(d))) return "degraded";
  return "broken";
}

export type RunHealth = {
  /** TRUE when NO connector failed with a broken (unexpected) error - i.e. the
   *  core succeeded and the only failures are known-degraded connectors. This
   *  is the value the run records as its overall `ok`. */
  ok: boolean;
  /** Failed connectors whose failure is a known-degraded state (reconnect /
   *  not-wired / transient). Does NOT turn the run red. */
  degraded: ConnectorOutcome[];
  /** Failed connectors whose failure is an unexpected break. Turns the run red. */
  broken: ConnectorOutcome[];
};

/**
 * Roll a night's per-connector outcomes up into a run-level health verdict.
 * Successful outcomes are ignored (they neither degrade nor break). A run is
 * `ok` when there are zero BROKEN failures - one dead login (or ten) can no
 * longer flip the run red, but a real DB-write regression still does.
 *
 * PURE - callers pass in the same results they store in per_source, so the
 * ledger `ok`, the health panel, and the summary strip can never disagree.
 */
export function summarizeRunHealth(results: ReadonlyArray<ConnectorOutcome>): RunHealth {
  const degraded: ConnectorOutcome[] = [];
  const broken: ConnectorOutcome[] = [];
  for (const r of results) {
    if (r.ok) continue;
    if (classifyConnectorFailure(r.detail) === "degraded") degraded.push(r);
    else broken.push(r);
  }
  return { ok: broken.length === 0, degraded, broken };
}
