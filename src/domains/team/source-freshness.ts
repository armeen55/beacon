/**
 * source-freshness (2026-07-02, master plan item 46 / CARRY-OVER 115) - "honest degradation
 * everywhere". A teammate's daily line is only as good as the data source behind it; when that
 * source's auth is dead or its last good sync is old, the UI must say so instead of quietly
 * showing a normal-looking chip. This module is the PURE assessor: per-source connector facts in,
 * a plain {status, ageDays, sentence} out. No I/O in the pure half - the caller reads the SAME
 * connector state the /settings/connectors cards and the item-10 pipeline-readings collector
 * already read (getConnectorInfo / getConnectorHealth in src/lib/connector-store.ts), so this
 * module never re-implements auth-failure or staleness detection, only turns it into a per-
 * teammate sentence. The bottom of the file adds a thin server-only I/O wrapper
 * (loadTeammateFreshness) that does exactly that read, so team-standup.tsx and the daily card's
 * evidence-brief wiring share ONE loader instead of two copies of the same connector reads.
 *
 * Three states, ordered worst-first:
 *   - "dead"  - the connection is provably broken: a sync TERMINATED in an auth failure
 *               (auth_failed_at set, the same authoritative signal getConnectorHealth reads), or
 *               the source was never connected. Nothing this teammate says can be trusted as live.
 *   - "stale" - connected and no auth failure, but the last good sync is older than
 *               STALE_LIMIT_DAYS. The numbers are real but old, not zero.
 *   - "fresh" - connected, no auth failure, and the last good sync is inside the limit (or the
 *               source has never needed a sync, e.g. Wix is publish-only).
 *
 * Deterministic, $0, no LLM. Pinned by source-freshness.test.ts.
 */

import { CONNECTOR_REGISTRY, isPublishOnly } from "@/lib/connectors/registry";

/** A sync older than this many days reads as "stale", not "fresh". Matches the plain-English
 *  promise in the item ("Search Console data is 3 days old") - short enough that a 2-3 day gap
 *  reads honestly, longer than the pipeline invariant's 48h hard-violation limit (that one alarms
 *  operator-side on the Ops card; this one narrates teammate-side, so it can afford a bit more
 *  patience before every chip on the standup turns amber over an overnight blip). */
export const STALE_LIMIT_DAYS = 2;

export type SourceFreshnessStatus = "fresh" | "stale" | "dead";

/** The subset of connector state the assessor needs, already read by the caller via
 *  getConnectorInfo/getConnectorHealth. Shape-compatible with ConnectorInfo so a caller can pass
 *  one straight through. */
export type SourceFreshnessInput = {
  /** Plain label used in sentences, e.g. "Search Console", "the AI answer feed". */
  label: string;
  /** False/absent = never connected at all - reads as "dead" (nothing to show). */
  connected: boolean;
  /** The authoritative reconnect signal (see GoogleConnectorToken.auth_failed_at doc): a sync
   *  TERMINATED in an auth failure. Non-Google providers never set this - always null for them. */
  authFailedAt?: string | null;
  /** ISO timestamp of the last successful sync, or null when never synced. */
  lastSyncedAt?: string | null;
  /** True for providers that never "pull a reading" (currently: Wix, publish-only) - staleness
   *  rules don't apply; a missing lastSyncedAt just means nothing has been published yet, not a
   *  broken pipe. Mirrors the same carve-out in getConnectorHealth. */
  publishOnly?: boolean;
};

export type SourceFreshness = {
  status: SourceFreshnessStatus;
  /** Age of the last good sync in whole days, or null when there has never been one (dead/never
   *  synced) or the source doesn't sync at all (publishOnly). */
  ageDays: number | null;
  /** First-person, plain-business, actionable sentence. Empty string only for a healthy
   *  publish-only source with nothing to report (never null - always safe to render). */
  sentence: string;
};

function ageInDays(iso: string, now: Date): number | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.floor(Math.max(0, now.getTime() - then) / (24 * 60 * 60 * 1000));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Assess ONE teammate's data-source freshness. PURE, deterministic. Reuses the exact reconnect +
 * staleness facts getConnectorHealth already derives (auth_failed_at, last_synced_at) - this
 * function only turns them into the {status, ageDays, sentence} shape the standup chip and the
 * daily card's brief need, so detection logic lives in exactly one place (connector-store.ts).
 */
export function assessSourceFreshness(
  input: SourceFreshnessInput,
  now: Date = new Date(),
): SourceFreshness {
  const label = input.label;

  if (!input.connected) {
    return {
      status: "dead",
      ageDays: null,
      sentence: `${label} is not connected. Reconnect in Settings.`,
    };
  }

  if (input.authFailedAt != null && input.authFailedAt !== "") {
    const ageDays = ageInDays(input.authFailedAt, now);
    return {
      status: "dead",
      ageDays,
      sentence:
        ageDays != null && ageDays > 0
          ? `${label} lost its connection ${plural(ageDays, "day")} ago. Reconnect in Settings.`
          : `${label} lost its connection. Reconnect in Settings.`,
    };
  }

  if (input.publishOnly) {
    return { status: "fresh", ageDays: null, sentence: "" };
  }

  if (input.lastSyncedAt == null || input.lastSyncedAt === "") {
    // Connected but never synced is a real gap, but it is not the same claim as "3 days old" -
    // GSC in particular can hold up to 90 days of already-synced data with no stamp on legacy
    // rows (see the connector-store STALE_DAYS doc), so we deliberately do NOT call this "dead".
    // It reads as stale-with-no-known-age, honest either way.
    return {
      status: "stale",
      ageDays: null,
      sentence: `${label} is connected but has not finished a first sync yet. Numbers from it may be incomplete.`,
    };
  }

  const ageDays = ageInDays(input.lastSyncedAt, now);
  if (ageDays == null) {
    return {
      status: "stale",
      ageDays: null,
      sentence: `${label} data has an unreadable sync time. Reconnect in Settings.`,
    };
  }
  if (ageDays > STALE_LIMIT_DAYS) {
    return {
      status: "stale",
      ageDays,
      sentence: `${label} data is ${plural(ageDays, "day")} old. Reconnect in Settings.`,
    };
  }
  return { status: "fresh", ageDays, sentence: "" };
}

/** Map of TeammateKey -> SourceFreshness, built once per render. Plain object (not a class) so
 *  server + client components can both consume it without extra typing ceremony. */
export type TeammateFreshnessMap = Map<string, SourceFreshness>;

/** Build the freshness map for every teammate the caller has connector facts for. Teammates with
 *  no backing connector (the strategist, revenue-attribution voices that ride GA4 already covered
 *  elsewhere, live-Google which is env-based DataForSEO, not a connector) are simply omitted - a
 *  missing entry means "no freshness claim to make", never a fabricated dead/stale state. */
export function buildTeammateFreshnessMap(
  inputs: Partial<Record<string, SourceFreshnessInput>>,
  now: Date = new Date(),
): TeammateFreshnessMap {
  const out: TeammateFreshnessMap = new Map();
  for (const [key, input] of Object.entries(inputs)) {
    if (!input) continue;
    out.set(key, assessSourceFreshness(input, now));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// I/O edge (server-only) - reads the SAME connector state the /settings/
// connectors cards and the item-10 pipeline-readings collector already read.
// Kept in this file (not a sibling module) because item 46 names one new
// file; this is the thin translation layer, not a second detector.
// ─────────────────────────────────────────────────────────────────────────

// Deliberately NOT `import "server-only"` at module scope - vitest imports
// the pure half of this file directly in source-freshness.test.ts, and the
// I/O half below already guards itself by only being called from server
// components/actions. `getConnectorInfo` (connector-store.ts) is itself
// `server-only`, so a client-side import of loadTeammateFreshness would fail
// at that boundary anyway - this file doesn't need its own second guard.

/** TeammateKey -> the connector provider that backs it, for the sources this
 *  assessor covers, derived from the ONE canonical connector registry (keyed by
 *  each connector's sourceKey, which is the teammate key here). Teammates without
 *  a connector-backed source (strategist, live-Google/DataForSEO which is
 *  env-based, commerce, proof/results) are simply absent from the registry, so
 *  they never get a freshness claim. */
const TEAMMATE_PROVIDER: Record<
  string,
  { provider: import("@/lib/connector-store").ConnectorProvider; label: string; publishOnly?: boolean }
> = Object.fromEntries(
  CONNECTOR_REGISTRY.map((c) => [
    c.sourceKey,
    { provider: c.id, label: c.freshnessLabel, publishOnly: isPublishOnly(c) || undefined },
  ]),
);

/**
 * Load real freshness for every connector-backed teammate, for one tenant. Fail-soft per source
 * (a read error on one provider never blocks the others or throws) - mirrors the same soft-fail
 * posture getConnectorInfo/getConnectorHealth already guarantee. $0, no LLM, a handful of cached
 * Supabase reads (same cost class as pipeline-readings' connector reads).
 */
export async function loadTeammateFreshness(
  tenantId: string,
  now: Date = new Date(),
): Promise<TeammateFreshnessMap> {
  const { getConnectorInfo } = await import("@/lib/connector-store");
  const entries = await Promise.all(
    Object.entries(TEAMMATE_PROVIDER).map(async ([key, cfg]) => {
      try {
        const info = await getConnectorInfo(cfg.provider, tenantId);
        const input: SourceFreshnessInput = {
          label: cfg.label,
          connected: info.status === "connected",
          authFailedAt: info.auth_failed_at ?? null,
          lastSyncedAt: info.last_synced_at ?? null,
          publishOnly: cfg.publishOnly,
        };
        return [key, assessSourceFreshness(input, now)] as const;
      } catch {
        // A read failure is NOT the same claim as "dead" (that would fabricate a specific
        // diagnosis from our own error) - omit the entry so callers treat it as "no claim",
        // matching buildTeammateFreshnessMap's honest-omission contract.
        return null;
      }
    }),
  );
  const out: TeammateFreshnessMap = new Map();
  for (const e of entries) {
    if (e) out.set(e[0], e[1]);
  }
  return out;
}
