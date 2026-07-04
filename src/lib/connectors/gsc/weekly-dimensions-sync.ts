/**
 * weekly-dimensions-sync (BEACON_500 R17b / P2 slice 2, v1 items 136 + 268) -
 * the WEEKLY GSC dimensions pass.
 *
 * Pulls two property-level aggregates the nightly day-sliced sync never
 * touches, ONE request each per tenant per week (egress discipline - both
 * numbers are low-volatility):
 *
 *   - searchAppearance  how many impressions carried rich-result styling
 *                       (FAQ snippets, review stars, recipe cards, ...)
 *   - device            desktop / mobile / tablet clicks + impressions +
 *                       position
 *   - country           which markets your Google traffic comes from
 *                       (R17c item 428, alpha-3 codes, clicks + impressions)
 *
 * Each pull covers ONE 7-day final window ending at the sync engine's own
 * lastFinalDay (today Pacific minus FINAL_LAG_DAYS), dataState "final" only.
 * Snapshots append to the "gsc-weekly-dimensions" json-store (GLOBAL
 * classification, rows carry tenant_id - written by the nightly cron fan-out
 * with no request context; Supabase-mirrored so hosted lambdas share it),
 * capped at WEEKLY_SNAPSHOT_CAP per tenant. The FIRST run also pulls the
 * prior week (2 extra requests, once) so the week-over-week styling delta
 * exists immediately.
 *
 * NEVER writes gsc_daily_rows / gsc_daily_totals - this store is a separate,
 * small register; the is_final discipline of the daily tables is untouched.
 *
 * Fail-soft everywhere: no token / no property / a failed pull returns
 * { ran: false, reason } and writes NOTHING (a partial week must not persist
 * as a full one); the cron logs one line and moves on, and next night's run
 * retries because the cadence check still sees no fresh snapshot.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

import {
  gscSearchAnalyticsQuery,
  resolveGscAccessToken,
  type GscSearchAnalyticsRow,
} from "./search-analytics";
import {
  FINAL_LAG_DAYS,
  pacificDateString,
  resolveProperty,
} from "./sync-search-analytics";
import {
  shouldPullWeeklyDimensions,
  WEEKLY_SNAPSHOT_CAP,
  type GscWeeklyDimensionsSnapshot,
} from "@/domains/gsc/weekly-dimensions";

export const GSC_WEEKLY_DIMENSIONS_STORE = "gsc-weekly-dimensions";

export type GscWeeklyDimensionsSyncResult =
  | { ran: false; reason: string }
  | { ran: true; property: string; weeksPulled: number };

function addDays(isoDate: string, days: number): string {
  const t = new Date(isoDate + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Test seams. Every dep defaults to the real implementation. */
export type WeeklyDimensionsSyncDeps = {
  queryImpl?: typeof gscSearchAnalyticsQuery;
  resolveTokenImpl?: typeof resolveGscAccessToken;
  resolvePropertyImpl?: typeof resolveProperty;
  readRows?: () => Promise<GscWeeklyDimensionsSnapshot[]>;
  writeRows?: (rows: GscWeeklyDimensionsSnapshot[]) => Promise<void>;
};

async function pullWeek(args: {
  accessToken: string;
  property: string;
  weekStart: string;
  weekEnd: string;
  tenantId: string;
  pulledAt: string;
  queryImpl: typeof gscSearchAnalyticsQuery;
}): Promise<GscWeeklyDimensionsSnapshot | null> {
  const base = {
    accessToken: args.accessToken,
    siteUrl: args.property,
    startDate: args.weekStart,
    endDate: args.weekEnd,
    dataState: "final" as const,
  };
  // ONE searchAppearance request. The API forbids combining searchAppearance
  // with other dimensions, so it is always requested alone.
  const appearanceRows = await args.queryImpl({ ...base, dimensions: ["searchAppearance"] });
  if (appearanceRows == null) return null;
  // ONE device request (DESKTOP / MOBILE / TABLET - at most 3 rows).
  const deviceRows = await args.queryImpl({ ...base, dimensions: ["device"] });
  if (deviceRows == null) return null;
  // R17c item 428: ONE country request (alpha-3 codes). Same egress discipline
  // as device / searchAppearance - a low-volatility aggregate, once a week.
  const countryRows = await args.queryImpl({ ...base, dimensions: ["country"] });
  if (countryRows == null) return null;

  const mapKeyed = (rows: GscSearchAnalyticsRow[]) =>
    rows.filter((r) => Array.isArray(r.keys) && typeof r.keys[0] === "string");

  return {
    tenant_id: args.tenantId,
    property: args.property,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    pulledAt: args.pulledAt,
    appearance: mapKeyed(appearanceRows).map((r) => ({
      kind: r.keys[0]!,
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
    })),
    devices: mapKeyed(deviceRows).map((r) => ({
      device: r.keys[0]!,
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      position: r.position ?? 0,
    })),
    countries: mapKeyed(countryRows).map((r) => ({
      code: r.keys[0]!.toLowerCase(),
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
    })),
  };
}

export async function syncGscWeeklyDimensionsForTenant(args: {
  tenantId: string;
  now?: Date;
  deps?: WeeklyDimensionsSyncDeps;
}): Promise<GscWeeklyDimensionsSyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();
  const deps = args.deps ?? {};
  const queryImpl = deps.queryImpl ?? gscSearchAnalyticsQuery;
  const resolveTokenImpl = deps.resolveTokenImpl ?? resolveGscAccessToken;
  const resolvePropertyImpl = deps.resolvePropertyImpl ?? resolveProperty;
  const readRows =
    deps.readRows ??
    // Single-line arrow return so the json-store async invariant recognizes
    // this as an awaited/returned readStore (its check is per-line).
    (() => readStore<GscWeeklyDimensionsSnapshot>(GSC_WEEKLY_DIMENSIONS_STORE, []).catch(() => [] as GscWeeklyDimensionsSnapshot[]));
  const writeRows =
    deps.writeRows ??
    ((rows: GscWeeklyDimensionsSnapshot[]) =>
      writeStore<GscWeeklyDimensionsSnapshot>(GSC_WEEKLY_DIMENSIONS_STORE, rows));

  // Cadence FIRST, before any token/API work: a fresh snapshot means zero
  // requests tonight (the weekly-pass isolation contract).
  const weekEnd = addDays(pacificDateString(now), -FINAL_LAG_DAYS);
  const weekStart = addDays(weekEnd, -6);
  const all = await readRows();
  const mine = all
    .filter((r) => r.tenant_id === tenantId)
    .sort((a, b) => (a.weekEnd < b.weekEnd ? -1 : 1));
  const latest = mine[mine.length - 1] ?? null;
  if (!shouldPullWeeklyDimensions(latest?.weekEnd ?? null, weekEnd)) {
    return { ran: false, reason: "weekly_snapshot_current" };
  }

  const accessToken = await resolveTokenImpl(tenantId, now);
  if (accessToken == null) return { ran: false, reason: "no_usable_gsc_token" };
  const property = await resolvePropertyImpl(tenantId, accessToken);
  if (property == null) return { ran: false, reason: "no_property_derivable" };

  const pulledAt = now.toISOString();
  const current = await pullWeek({
    accessToken,
    property,
    weekStart,
    weekEnd,
    tenantId,
    pulledAt,
    queryImpl,
  });
  if (current == null) {
    // Nothing written on a failed pull - a partial week must never persist.
    return { ran: false, reason: "gsc_weekly_pull_failed" };
  }

  const snapshots: GscWeeklyDimensionsSnapshot[] = [current];
  if (mine.length === 0) {
    // First run: also pull the prior week so the week-over-week styling
    // delta exists immediately. Non-fatal - a prior-week failure keeps the
    // current snapshot (the delta simply waits a week).
    const prior = await pullWeek({
      accessToken,
      property,
      weekStart: addDays(weekStart, -7),
      weekEnd: addDays(weekEnd, -7),
      tenantId,
      pulledAt,
      queryImpl,
    });
    if (prior != null) snapshots.unshift(prior);
  }

  try {
    const others = all.filter((r) => r.tenant_id !== tenantId);
    const merged = [...mine, ...snapshots]
      .sort((a, b) => (a.weekEnd < b.weekEnd ? -1 : 1))
      .slice(-WEEKLY_SNAPSHOT_CAP);
    await writeRows([...others, ...merged]);
  } catch (e) {
    log.warn("[gsc-weekly-dimensions] snapshot persist failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ran: false, reason: "weekly_snapshot_persist_failed" };
  }

  return { ran: true, property, weeksPulled: snapshots.length };
}
