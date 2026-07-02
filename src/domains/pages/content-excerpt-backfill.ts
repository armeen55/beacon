import "server-only";

/**
 * content-excerpt-backfill (N19, 2026-07-02) - fills `body_paragraph_sample`
 * for page_snapshots rows that predate the extractor's bounded main-content
 * excerpt. The NEXT scan of any tenant already fills this field going forward
 * (extractPageSnapshot runs on every crawl - see in-process-scan.ts,
 * scripts/scan-owned-pages.ts, verify-action.ts); this module closes the gap
 * for pages that were snapshotted BEFORE this field existed and won't get a
 * fresh crawl on their own for a while.
 *
 * Ground-truth (2026-07-02): all 217 tenant-iranopedia page_snapshots rows
 * predate body_paragraph_sample (Plan A/B1, 2026-04-20) - this is exactly the
 * population this helper targets.
 *
 * Operator/cron callable, never a web-render path: re-fetches HTML via the
 * same polite fetcher the competitor-intel crawler uses, one page at a time,
 * sequentially (no origin gets hammered). Bounded by `limit` on every call -
 * callers control the pace across multiple invocations rather than this
 * module trying to backfill an entire tenant in one shot. Fail-soft per page:
 * a fetch/extract/persist failure for one URL is recorded and skipped, never
 * throws, never blocks the remaining pages in the batch.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { fetchPageHtml } from "@/domains/competitor-intel/polite-fetch";
import { extractPageSnapshot } from "./extractor";
import { syncPageSnapshots } from "@/lib/persistence/dual-write";
import { log } from "@/lib/logger";

const READ_PAGE_SIZE = 1000;
const DEFAULT_LIMIT = 20;
// Hard ceiling independent of the caller's requested limit - this is a
// backfill helper, not a full re-crawl; a caller passing an unreasonably
// large limit must not turn this into an unbounded site-wide fetch storm.
const MAX_LIMIT = 100;

/** PostgREST "table/column not in schema cache" or raw undefined-table ->
 *  degrade to empty/skip rather than throw. Same convention used across the
 *  repo (ai-referrals.ts, cron-runs-store.ts, load-bot-referral-signals.ts). */
function isMissingTableOrColumn(error: { code?: string } | null | undefined): boolean {
  const c = error?.code;
  return c === "PGRST205" || c === "PGRST204" || c === "42P01";
}

/** Lean row shape - only what the backfill needs to decide "is this page
 *  missing its excerpt" and re-fetch it. Deliberately narrower than the
 *  shared repository projection (which omits body_paragraph_sample entirely
 *  to protect hot web-render egress); this helper is operator/cron
 *  triggered and bounded by `limit`, so reading the field for a small,
 *  capped page set is safe. */
type BackfillCandidateRow = {
  id: string;
  page_id: string;
  url: string;
  http_status: number | null;
  body_paragraph_sample: string[] | null;
  fetched_at: string;
};

export type ContentExcerptBackfillOptions = {
  /** Max number of pages to re-fetch THIS call. Default 20, hard-capped at
   *  MAX_LIMIT regardless of what's requested. */
  limit?: number;
};

export type ContentExcerptBackfillPageResult = {
  url: string;
  status: "filled" | "still_empty" | "fetch_failed" | "skipped";
  /** body_paragraph_sample.length after this run (0 when still empty). */
  paragraphCount: number;
  detail?: string;
};

export type ContentExcerptBackfillResult = {
  tenantId: string;
  /** How many candidate rows (missing an excerpt) existed before this run,
   *  independent of `limit` - lets a caller judge how much work remains. */
  candidatesFound: number;
  /** How many of those candidates this call actually attempted (<= limit). */
  attempted: number;
  filled: number;
  stillEmpty: number;
  fetchFailed: number;
  pages: ContentExcerptBackfillPageResult[];
};

/**
 * Read up to `limit` page_snapshots rows for `tenantId` whose latest snapshot
 * has no `body_paragraph_sample` yet (null, undefined, or empty array).
 * Fail-soft: any read error (including a not-yet-migrated column) returns an
 * empty candidate list rather than throwing, since this is a background
 * helper, never a request path the operator is blocked on.
 */
async function findMissingExcerptCandidates(
  tenantId: string,
): Promise<BackfillCandidateRow[]> {
  if (!isSupabaseConfigured() || !tenantId) return [];
  try {
    const sb = getSupabaseAdmin();
    const latestByPageId = new Map<string, BackfillCandidateRow>();
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("page_snapshots")
        .select("id, page_id, url, http_status, body_paragraph_sample, fetched_at")
        .eq("tenant_id", tenantId)
        .order("fetched_at", { ascending: false })
        .range(from, from + READ_PAGE_SIZE - 1);
      if (error) {
        if (isMissingTableOrColumn(error)) {
          log.warn(
            "[content-excerpt-backfill] page_snapshots table/column not available yet (skipping)",
            { tenantId, code: error.code },
          );
        } else {
          log.warn("[content-excerpt-backfill] candidate read failed (non-fatal)", {
            tenantId,
            error: error.message,
          });
        }
        break;
      }
      const rows = (data ?? []) as BackfillCandidateRow[];
      for (const r of rows) {
        // fetched_at DESC means the first row seen per page_id is the latest
        // snapshot for that page - only that one matters for "is it missing".
        if (!latestByPageId.has(r.page_id)) latestByPageId.set(r.page_id, r);
      }
      if (rows.length < READ_PAGE_SIZE) break;
      from += READ_PAGE_SIZE;
    }
    return [...latestByPageId.values()].filter(
      (r) => !Array.isArray(r.body_paragraph_sample) || r.body_paragraph_sample.length === 0,
    );
  } catch (e) {
    log.warn("[content-excerpt-backfill] candidate read threw (non-fatal)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Re-fetch + re-extract + persist a bounded batch of pages missing their
 * content excerpt. Operator/cron callable. Never throws - every failure mode
 * (network, non-HTML, robots-blocked, empty page, Supabase write error) is
 * captured per-page in the returned `pages[]` and the run keeps going.
 */
export async function runContentExcerptBackfill(
  tenantId: string,
  options: ContentExcerptBackfillOptions = {},
): Promise<ContentExcerptBackfillResult> {
  const limit = Math.max(0, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const base: ContentExcerptBackfillResult = {
    tenantId,
    candidatesFound: 0,
    attempted: 0,
    filled: 0,
    stillEmpty: 0,
    fetchFailed: 0,
    pages: [],
  };
  if (!tenantId || limit === 0) return base;

  const candidates = await findMissingExcerptCandidates(tenantId);
  base.candidatesFound = candidates.length;
  if (candidates.length === 0) return base;

  const batch = candidates.slice(0, limit);
  const robotsCache = new Map<string, string[]>();
  const filledSnapshots: Array<ReturnType<typeof extractPageSnapshot>> = [];

  for (const c of batch) {
    if (!/^https?:\/\//i.test(c.url)) {
      base.pages.push({ url: c.url, status: "skipped", paragraphCount: 0, detail: "non_http_url" });
      continue;
    }
    try {
      const fetched = await fetchPageHtml(c.url, robotsCache);
      if (!fetched.ok) {
        base.fetchFailed += 1;
        base.pages.push({
          url: c.url,
          status: "fetch_failed",
          paragraphCount: 0,
          detail: fetched.reason === "robots_blocked" ? "robots_blocked" : (fetched.detail ?? "fetch_failed"),
        });
        continue;
      }
      const snap = extractPageSnapshot(fetched.html, c.url, c.page_id, tenantId, fetched.status);
      // Preserve the original snapshot row identity - this backfill call
      // is enriching the EXISTING row, not creating a new observation. A
      // fresh `id`/`fetched_at` would upsert a second row for the same
      // page_id (page_id is not the primary key) instead of updating the
      // one already on record.
      snap.id = c.id;
      snap.fetched_at = c.fetched_at;
      const paragraphCount = snap.body_paragraph_sample?.length ?? 0;
      if (paragraphCount > 0) {
        base.filled += 1;
        filledSnapshots.push(snap);
      } else {
        base.stillEmpty += 1;
      }
      base.pages.push({
        url: c.url,
        status: paragraphCount > 0 ? "filled" : "still_empty",
        paragraphCount,
      });
    } catch (e) {
      base.fetchFailed += 1;
      base.pages.push({
        url: c.url,
        status: "fetch_failed",
        paragraphCount: 0,
        detail: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
      });
    }
  }

  base.attempted = batch.length;

  if (filledSnapshots.length > 0) {
    try {
      await syncPageSnapshots(filledSnapshots, tenantId);
    } catch (e) {
      // syncPageSnapshots/dualWriteUpsert already fail-soft internally
      // (logs, never throws) - this catch is belt-and-suspenders so a
      // surprise error here still can't crash an operator/cron caller.
      log.warn("[content-excerpt-backfill] persist failed (non-fatal)", {
        tenantId,
        count: filledSnapshots.length,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return base;
}
