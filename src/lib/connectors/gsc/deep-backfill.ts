/**
 * gsc/deep-backfill (2026-07-02, master plan item 63) - the one-time deep
 * history pull that unlocks the seasonality engine.
 *
 * GSC's Search Analytics API serves up to roughly 16 months (DEEP_BACKFILL_DAYS
 * = 480 days) of history, but the normal sync (sync-search-analytics.ts) only
 * ever cold-starts 90 days back and then walks forward from a watermark - it
 * can never reach further into the past. The item-21 permanent monthly archive
 * (gsc_monthly_archive) is starved as a direct result: it can only roll up
 * whatever gsc_daily_rows already holds, and 90 days of history cannot prove a
 * query repeats year over year.
 *
 * This module walks BACKWARD from the oldest day the normal sync already
 * covers toward a target date up to DEEP_BACKFILL_DAYS ago, one calendar month
 * at a time (CHUNK_DAYS), so:
 *   - each chunk is a small, bounded HTTP+DB workload that finishes well inside
 *     a serverless function's timeout, never the 480-day span in one call;
 *   - progress survives a timeout, a redeploy, or a dropped invocation: every
 *     chunk persists its new cursor to gsc_backfill_progress BEFORE returning,
 *     so the next call (operator retry, or the nightly continuation below)
 *     resumes from exactly where the last one stopped;
 *   - the existing 429 backoff + idempotent UPSERT machinery in
 *     sync-search-analytics.ts / search-analytics.ts is reused as-is - this
 *     module never talks to Google directly, it only calls
 *     syncGscSearchAnalyticsForTenant with a bounded [startDate, endDate]
 *     window per chunk.
 *
 * Fail-soft everywhere: a missing token / no property / a failed chunk leaves
 * the progress row exactly where it was (never advances the cursor on a
 * failure), so the next attempt safely retries the same window.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { syncGscSearchAnalyticsForTenant, pacificDateString } from "./sync-search-analytics";

/** How far back the deep backfill reaches: GSC's own documented retention
 *  ceiling is ~16 months; 480 days is comfortably inside that window. */
export const DEEP_BACKFILL_DAYS = 480;
/** One chunk = about one calendar month of days. Small enough that a single
 *  invocation (HTTP pulls + Supabase upserts for ~30 days) finishes well
 *  inside a serverless timeout; large enough that a full backfill converges
 *  in a small, bounded number of chunks (about 13 for the full 480 days). */
export const CHUNK_DAYS = 30;

export type BackfillProgressRow = {
  tenant_id: string;
  property: string;
  target_date: string;
  cursor_date: string | null;
  status: "in_progress" | "complete";
  days_pulled: number;
  started_at: string;
  updated_at: string;
};

function addDays(isoDate: string, days: number): string {
  const t = new Date(isoDate + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const TABLE = "gsc_backfill_progress";

/** Read the tenant's backfill progress row for a property, or null if the
 *  backfill has never been started. Fail-soft -> null. */
export async function readBackfillProgress(
  tenantId: string,
  property: string,
): Promise<BackfillProgressRow | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("property", property)
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0] as BackfillProgressRow;
  } catch {
    return null;
  }
}

/** Earliest day already covered by the tenant's normal gsc_daily_rows sync -
 *  the deep backfill's natural STARTING point (it only needs to reach further
 *  back than this; the normal sync already owns everything from here forward).
 *  Fail-soft -> null (no rows yet -> nothing to anchor a backfill start to). */
async function earliestSyncedDay(tenantId: string, property: string): Promise<string | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("date")
      .eq("tenant_id", tenantId)
      .eq("property", property)
      .order("date", { ascending: true })
      .limit(1);
    if (error) return null;
    const d = (data?.[0] as { date?: string } | undefined)?.date;
    return typeof d === "string" ? d.slice(0, 10) : null;
  } catch {
    return null;
  }
}

async function writeProgress(row: Omit<BackfillProgressRow, "started_at" | "updated_at"> & { started_at?: string }): Promise<void> {
  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await sb.from(TABLE).upsert(
    {
      tenant_id: row.tenant_id,
      property: row.property,
      target_date: row.target_date,
      cursor_date: row.cursor_date,
      status: row.status,
      days_pulled: row.days_pulled,
      started_at: row.started_at ?? now,
      updated_at: now,
    },
    { onConflict: "tenant_id,property" },
  );
  if (error) {
    log.warn("[gsc-deep-backfill] progress write failed", { tenantId: row.tenant_id, property: row.property, error: error.message });
  }
}

export type StartDeepBackfillResult =
  | { started: true; property: string; targetDate: string }
  | { started: false; reason: string };

/**
 * Operator trigger ("Load my full Search Console history"): initializes the
 * progress row so the next chunk run (this call, plus the nightly continuation
 * below) has somewhere to resume from. Idempotent - calling it again while a
 * backfill is already in_progress is a no-op that returns the existing target.
 */
export async function startDeepBackfill(
  tenantId: string,
  opts: { now?: Date; days?: number } = {},
): Promise<StartDeepBackfillResult> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? DEEP_BACKFILL_DAYS;

  // Resolve the property the same way the normal sync does, by reading what
  // it already wrote under (the deep backfill only ever runs AFTER the normal
  // sync has established a property - there is nothing to backfill before that).
  const property = await resolveKnownProperty(tenantId);
  if (property == null) {
    return { started: false, reason: "no_synced_property" };
  }

  const existing = await readBackfillProgress(tenantId, property);
  if (existing != null && existing.status === "in_progress") {
    return { started: true, property, targetDate: existing.target_date };
  }

  const anchor = (await earliestSyncedDay(tenantId, property)) ?? pacificDateString(now);
  const targetDate = addDays(pacificDateString(now), -days);
  if (existing != null && existing.status === "complete" && existing.target_date <= targetDate) {
    // Already reached at least this far back - nothing new to do.
    return { started: true, property, targetDate: existing.target_date };
  }

  await writeProgress({
    tenant_id: tenantId,
    property,
    target_date: targetDate,
    cursor_date: addDays(anchor, -1), // the day just before the normal sync's earliest day
    status: "in_progress",
    days_pulled: 0,
  });
  return { started: true, property, targetDate };
}

/** The property gsc_daily_rows already has rows under for this tenant (the
 *  normal sync resolves + writes it; the backfill reuses it rather than
 *  re-deriving from a live token call). Fail-soft -> null. */
async function resolveKnownProperty(tenantId: string): Promise<string | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("property")
      .eq("tenant_id", tenantId)
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const p = (data[0] as { property?: string }).property;
    return typeof p === "string" && p ? p : null;
  } catch {
    return null;
  }
}

export type DeepBackfillChunkResult =
  | { ran: false; reason: string }
  | {
      ran: true;
      property: string;
      chunkStart: string;
      chunkEnd: string;
      daysPulled: number;
      rowsUpserted: number;
      complete: boolean;
    };

/**
 * Runs ONE bounded chunk (at most CHUNK_DAYS days) of the deep backfill and
 * persists the new cursor. Safe to call repeatedly (operator retry, or the
 * nightly continuation) until `complete` is true. A chunk that fails mid-pull
 * (network/quota/auth) leaves the cursor untouched so the same window retries
 * next time - never marks progress on a partial/failed pull.
 */
export async function runDeepBackfillChunk(
  tenantId: string,
  opts: { now?: Date } = {},
): Promise<DeepBackfillChunkResult> {
  const now = opts.now ?? new Date();
  const property = await resolveKnownProperty(tenantId);
  if (property == null) return { ran: false, reason: "no_synced_property" };

  const progress = await readBackfillProgress(tenantId, property);
  if (progress == null) return { ran: false, reason: "not_started" };
  if (progress.status === "complete") return { ran: false, reason: "already_complete" };
  if (progress.cursor_date == null) return { ran: false, reason: "no_cursor" };

  const target = progress.target_date;
  if (progress.cursor_date < target) {
    // Already walked past the target on a prior run - mark complete defensively.
    await writeProgress({ ...progress, status: "complete" });
    return { ran: false, reason: "already_complete" };
  }

  const chunkEnd = progress.cursor_date;
  const naiveStart = addDays(chunkEnd, -(CHUNK_DAYS - 1));
  const chunkStart = naiveStart < target ? target : naiveStart;

  const result = await syncGscSearchAnalyticsForTenant({
    tenantId,
    now,
    startDate: chunkStart,
    endDate: chunkEnd,
  });

  if (!result.synced) {
    log.warn("[gsc-deep-backfill] chunk failed, cursor unchanged", { tenantId, property, chunkStart, chunkEnd, reason: result.reason });
    return { ran: false, reason: result.reason };
  }

  const nextCursor = addDays(chunkStart, -1);
  const reachedTarget = chunkStart <= target;
  await writeProgress({
    tenant_id: tenantId,
    property,
    target_date: target,
    cursor_date: reachedTarget ? target : nextCursor,
    status: reachedTarget ? "complete" : "in_progress",
    days_pulled: progress.days_pulled + result.days,
  });

  log.info("[gsc-deep-backfill] chunk complete", {
    tenantId,
    property,
    chunkStart,
    chunkEnd,
    daysPulled: result.days,
    rowsUpserted: result.rows_upserted,
    complete: reachedTarget,
  });

  return {
    ran: true,
    property,
    chunkStart,
    chunkEnd,
    daysPulled: result.days,
    rowsUpserted: result.rows_upserted,
    complete: reachedTarget,
  };
}

/**
 * Nightly continuation (cron-sync wires this beside the normal GSC sync): if a
 * backfill is in progress for this tenant, run exactly one more chunk. A no-op
 * (fail-soft, single try/catch) when no backfill was ever started - the deep
 * backfill is ALWAYS operator-triggered first via startDeepBackfill.
 */
export async function continueDeepBackfillIfStarted(tenantId: string, now: Date = new Date()): Promise<DeepBackfillChunkResult> {
  try {
    const property = await resolveKnownProperty(tenantId);
    if (property == null) return { ran: false, reason: "no_synced_property" };
    const progress = await readBackfillProgress(tenantId, property);
    if (progress == null || progress.status === "complete") {
      return { ran: false, reason: progress == null ? "not_started" : "already_complete" };
    }
    return await runDeepBackfillChunk(tenantId, { now });
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message.slice(0, 200) : "error" };
  }
}
