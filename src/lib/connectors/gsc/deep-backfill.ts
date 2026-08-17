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
import { syncGscSearchAnalyticsForTenant } from "./sync-search-analytics";

/** One chunk = about one calendar month of days. Small enough that a single
 *  invocation (HTTP pulls + Supabase upserts for ~30 days) finishes well
 *  inside a serverless timeout; large enough that a full backfill converges
 *  in a small, bounded number of chunks (about 13 for the full 480 days). */
const CHUNK_DAYS = 30;

type BackfillProgressRow = {
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
async function readBackfillProgress(
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

type DeepBackfillChunkResult =
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
async function runDeepBackfillChunk(
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

/** How far back Google serves Search Analytics history: roughly 16 months. */
const DEEP_BACKFILL_DAYS = 480;

/**
 * Start the deep backfill: seed the progress row so every later chunk (the research pass's
 * gsc_backfill_chunk phase, or a direct runDeepBackfillChunk loop) walks backward from the oldest
 * day already synced toward `targetDays` ago. Idempotent: an in-progress or complete backfill is
 * left alone. THIS WAS THE MISSING HALF: the continuation ran on every pass for weeks against a
 * progress table nothing had ever seeded, so 16 months of free history sat unpulled at Google
 * while every opportunity was scored against a post-collapse baseline.
 */
async function startDeepBackfill(tenantId: string, targetDays = DEEP_BACKFILL_DAYS): Promise<{ started: boolean; reason: string }> {
  const property = await resolveKnownProperty(tenantId);
  if (property == null) return { started: false, reason: "no_synced_property" };
  const existing = await readBackfillProgress(tenantId, property);
  if (existing != null) return { started: false, reason: existing.status === "complete" ? "already_complete" : "already_in_progress" };
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("gsc_daily_rows").select("date").eq("tenant_id", tenantId)
    .order("date", { ascending: true }).limit(1);
  const oldest = (data?.[0] as { date?: string } | undefined)?.date;
  if (!oldest) return { started: false, reason: "no_synced_rows" };
  const target = addDays(new Date().toISOString().slice(0, 10), -targetDays);
  const cursor = addDays(oldest, -1);
  if (cursor < target) return { started: false, reason: "history_already_covered" };
  await writeProgress({ tenant_id: tenantId, property, target_date: target, cursor_date: cursor, status: "in_progress", days_pulled: 0 });
  log.info("[gsc-deep-backfill] started", { tenantId, property, cursor, target });
  return { started: true, reason: "seeded" };
}

/**
 * THE ONE PRODUCTION ENTRY: start the backfill for any eligible connected account that never started
 * one, then run exactly one more chunk of whichever backfill is open. "Continue if started" was the
 * whole wiring for weeks while nothing in production ever STARTED one, so the continuation ran on
 * every pass against a table nothing had seeded and 16 months of free history sat unpulled at Google.
 * Eligibility is mechanical: a synced property with rows on file whose history is not already covered.
 * Fail-soft, single try/catch; a start that cannot happen names its reason and costs nothing.
 */
export async function ensureDeepBackfill(tenantId: string, now: Date = new Date()): Promise<DeepBackfillChunkResult> {
  try {
    const property = await resolveKnownProperty(tenantId);
    if (property == null) return { ran: false, reason: "no_synced_property" };
    let progress = await readBackfillProgress(tenantId, property);
    if (progress == null) {
      const started = await startDeepBackfill(tenantId);
      if (!started.started) return { ran: false, reason: started.reason };
      progress = await readBackfillProgress(tenantId, property);
    }
    if (progress == null || progress.status === "complete") {
      return { ran: false, reason: progress == null ? "not_started" : "already_complete" };
    }
    return await runDeepBackfillChunk(tenantId, { now });
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message.slice(0, 200) : "error" };
  }
}
