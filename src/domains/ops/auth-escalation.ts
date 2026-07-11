import "server-only";

/**
 * auth-escalation (refresh-reliability wave, 2026-07-11, BUG 2).
 *
 * The probe found Google grants (GSC + GA4) that failed EVERY nightly sync for
 * weeks with only TRANSIENT classifications (gsc_auth_transient / token blips).
 * The probe-before-stamp guard in the sync engines only stamps auth_failed_at on
 * a PROVEN-dead grant (invalid_grant), by design - so a live-but-flaky grant
 * that never proves dead left auth_failed_at null, /settings/connectors never
 * showed "reconnect", and the operator's data went silently stale.
 *
 * This adds a BOUNDED escalation on top of that guard WITHOUT weakening it: when
 * a source has failed N consecutive nightly syncs spanning >= M days, we stamp a
 * DISTINCT needs-attention marker (never auth_failed_at). The marker's copy is
 * honest and non-accusatory - "I have not been able to pull your data since
 * <date>. Reconnecting usually fixes this." - because we CANNOT prove the grant
 * is revoked, only that pulling has not worked for a while. auth_failed_at
 * (proven dead) always outranks it, and any successful sync clears it.
 *
 * THRESHOLDS (N=5 runs, M=3 days). The nightly sync runs once per Pacific day,
 * so 5 consecutive FAILED cron runs already means ~4-5 days without data. We read
 * only the cron-trigger rows (one per night), so the M>=3-day floor is a
 * belt-and-suspenders guard against clock skew / backfilled rows falsely
 * escalating within a single day. Escalating slowly, only on a durably-bad
 * pattern, mirrors the conservative probe-before-stamp posture: a one-night blip
 * (or a single manual retry) never trips it.
 */

import { getConnectorInfo, updateConnectorToken } from "@/lib/connector-store";
import { listRecentRefreshRuns, type RefreshRunRow } from "@/domains/ops/refresh-runs-store";
import { CONNECTION_LIVENESS_STALE_DAYS } from "@/domains/ops/source-freshness";
import { log } from "@/lib/logger";

export const AUTH_ESCALATION_MIN_RUNS = 5;
export const AUTH_ESCALATION_MIN_DAYS = 3;

/** How stale the last real evidence of data must be before the initial-state
 *  bridge escalates (2026-07-12). Reuses the connection-liveness threshold so
 *  the "this source has gone quiet" bar can never drift from the rest of the
 *  app. 14 days: comfortably past GSC's 3-day and Clarity's 7-day data SLAs. */
export const INITIAL_SILENCE_STALE_DAYS = CONNECTION_LIVENESS_STALE_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The escalation-eligible Google sources and their connector-store provider. */
const ESCALATION_SOURCES = [
  { source: "gsc" as const, provider: "google_gsc" as const },
  { source: "ga4" as const, provider: "google_ga4" as const },
];

type EscalationRow = Pick<RefreshRunRow, "started_at" | "result">;

/**
 * PURE: decide whether a source's recent nightly runs warrant escalation.
 *
 * `rows` are this source's cron-trigger refresh rows, NEWEST FIRST. A `partial`
 * (synced, no new data) or `ok` run means auth WORKED, so it breaks the failing
 * streak - only `failed` runs count. Escalate when the leading failed streak is
 * at least `minRuns` long AND spans at least `minDays` days. `since` is the last
 * good pull before the streak (or the oldest failing run when there is no known
 * good pull in the window), for the "since <date>" copy.
 */
export function deriveAuthEscalation(
  rows: ReadonlyArray<EscalationRow>,
  now: Date,
  opts: { minRuns?: number; minDays?: number } = {},
): { escalate: boolean; since: string | null } {
  const minRuns = opts.minRuns ?? AUTH_ESCALATION_MIN_RUNS;
  const minDays = opts.minDays ?? AUTH_ESCALATION_MIN_DAYS;

  let streak = 0;
  while (streak < rows.length && rows[streak]!.result === "failed") streak++;
  if (streak < minRuns) return { escalate: false, since: null };

  const newestFailing = rows[0]!.started_at;
  const oldestFailing = rows[streak - 1]!.started_at;
  const spanMs = Date.parse(newestFailing) - Date.parse(oldestFailing);
  const spanDays = Number.isFinite(spanMs) ? spanMs / DAY_MS : 0;
  if (spanDays < minDays) return { escalate: false, since: null };

  // The last good pull is the run just older than the streak (if any); else we
  // have not seen a success in-window, so date from the oldest failure.
  const lastGood = rows[streak];
  const since = lastGood != null ? lastGood.started_at : oldestFailing;
  void now; // reserved for future recency gating; kept in the signature for callers.
  return { escalate: true, since };
}

/**
 * PURE: initial-state bridge for when the refresh ledger has NO (or too little)
 * history to prove a streak yet.
 *
 * The refresh_runs ledger started EMPTY on 2026-07-11, so a long-broken source
 * (e.g. a Google grant connected on a date but silent ever since) could not
 * surface a needs-attention warning until 5 failed nights accumulated - days
 * after deploy. This closes that gap HONESTLY from evidence that is already
 * stored: the last successful sync stamp and the source's newest data date.
 *
 * Fires ONLY on POSITIVE evidence of silence: at least one real stamp
 * (last_synced_at or the latest data date) that is OLDER than the freshness
 * window. When there is no stamp at all we stay quiet - absence of a stamp is
 * NOT proof of silence (GSC can hold data behind a null sync marker), so a
 * healthy source is never falsely alarmed. `since` is the newest such stamp -
 * the last moment we know data flowed. Never uses connected_at as a trigger.
 */
export function deriveInitialSilence(
  evidence: { lastSyncedAt: string | null; latestDataDate: string | null },
  now: Date,
  opts: { staleDays?: number } = {},
): { escalate: boolean; since: string | null } {
  const staleMs = (opts.staleDays ?? INITIAL_SILENCE_STALE_DAYS) * DAY_MS;
  const stamps: number[] = [];
  const consider = (v: string | null) => {
    if (v == null || v === "") return;
    const iso = v.length === 10 ? `${v}T00:00:00Z` : v;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) stamps.push(ms);
  };
  consider(evidence.lastSyncedAt);
  consider(evidence.latestDataDate);
  // No positive evidence of any past data or sync -> we cannot prove silence,
  // so stay quiet (never alarm a healthy source off a bare null stamp).
  if (stamps.length === 0) return { escalate: false, since: null };
  const newest = Math.max(...stamps);
  if (now.getTime() - newest <= staleMs) return { escalate: false, since: null }; // fresh -> healthy
  return { escalate: true, since: new Date(newest).toISOString() };
}

/**
 * For ONE tenant, evaluate GSC + GA4 against the refresh ledger and stamp or
 * clear the needs-attention marker. Runs at the end of the nightly cron (after
 * tonight's runs are recorded). FAIL-SOFT per source: a read/write error for one
 * source never affects the other or the sync. Never stamps auth_failed_at, so
 * the never-mark-a-live-grant-revoked invariant holds.
 */
export async function evaluateAuthEscalationForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<void> {
  for (const { source, provider } of ESCALATION_SOURCES) {
    try {
      const info = await getConnectorInfo(provider, tenantId);
      // Not connected -> nothing to escalate (a bare Connect state is not a
      // silent failure). Proven-dead (auth_failed_at) already shows Reconnect
      // and outranks this marker, so leave it to that path.
      if (info.status !== "connected") continue;
      if (info.auth_failed_at != null && info.auth_failed_at !== "") continue;

      const all = await listRecentRefreshRuns(tenantId, { source, limit: 40 });
      const cronRows = all.filter((r) => r.trigger === "cron");
      const marked = info.needs_attention_at != null && info.needs_attention_at !== "";

      // Latest run succeeded (ok) or reached the source (partial) -> auth is
      // working; clear any stale marker and move on.
      if (cronRows.length > 0 && cronRows[0]!.result !== "failed") {
        if (marked) await clearNeedsAttention(provider, tenantId);
        continue;
      }

      // Enough nightly history to prove a streak? Use the streak path. Else the
      // ledger is empty or too short (it started empty on 2026-07-11), so bridge
      // honestly from stored evidence so a long-silent source surfaces NOW
      // instead of days from now once 5 nights accumulate.
      let escalate = false;
      let since: string | null = null;
      let kind: "streak" | "initial_silence" = "streak";
      if (cronRows.length >= AUTH_ESCALATION_MIN_RUNS) {
        const r = deriveAuthEscalation(cronRows, now);
        escalate = r.escalate;
        since = r.since;
      } else {
        // The latest data date is not cheaply readable here without a heavy
        // per-source data read, so we use the last-successful-sync stamp (the
        // same data-recency proxy the connectors strip uses); a future loader
        // can thread the true data-through date through latestDataDate.
        const r = deriveInitialSilence(
          { lastSyncedAt: info.last_synced_at, latestDataDate: null },
          now,
        );
        escalate = r.escalate;
        since = r.since;
        kind = "initial_silence";
      }

      if (escalate && !marked) {
        await updateConnectorToken(
          provider,
          {
            needs_attention_at: now.toISOString(),
            needs_attention_since: since,
            needs_attention_kind: kind,
          },
          tenantId,
        );
        log.warn("[auth-escalation] marked needs-attention", {
          tenantId,
          provider,
          since,
          kind,
          failingNights: cronRows.filter((r) => r.result === "failed").length,
        });
      }
    } catch (e) {
      log.warn("[auth-escalation] source check failed (fail-soft)", {
        tenantId,
        provider,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }
}

/** Clear the needs-attention marker (best-effort). Also invoked from the sync
 *  success path so a good pull heals the banner immediately, not only overnight. */
export async function clearNeedsAttention(
  provider: "google_gsc" | "google_ga4",
  tenantId: string,
): Promise<void> {
  try {
    await updateConnectorToken(
      provider,
      { needs_attention_at: null, needs_attention_since: null, needs_attention_kind: null },
      tenantId,
    );
  } catch {
    /* fail-soft, never alter the sync outcome */
  }
}
