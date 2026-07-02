import "server-only";

/**
 * proof-gsc/attach-recrawl-clock (MASTER PLAN v2 N11, 2026-07-02) - the read-path
 * seam a proof read site needs: given a tenant's shipped-change ledger rows, load
 * this tenant's `gsc_url_inspections` cache ONCE (item 34's URL Inspection store,
 * src/lib/connectors/gsc/client.ts) and compute each row's recrawl-clock result,
 * keyed by ledger row id. Mirrors the attach-seasonal-inflection.ts precedent in
 * seasonal/ exactly - one substrate read, one pure join, no mutation, no
 * persistence.
 *
 * HARD RULE: computed-only. Nothing here writes to any store; the returned map
 * is fed straight into buildMeasurementPresentation's `recrawlPending` /
 * `recrawlDaysBlind` inputs (measurement-maturity.ts), the same additive posture
 * as shockWindows/weakComparison/seasonalInflection.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { computeRecrawlClock, type RecrawlClockResult, type InspectionPoint } from "./recrawl-clock";

const TABLE = "gsc_url_inspections";

export type RecrawlLedgerRow = {
  id: string;
  /** Canonical page URL - matches gsc_url_inspections.inspection_url. */
  page: string;
  shippedAt: string;
  actionType: string;
  /** The new title/meta text this row shipped, when applicable (rec.after on a
   *  title/meta action type). Feeds the serp_title fallback only. */
  after: string | null;
};

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown };
  return typeof e.code === "string" && (e.code === "42P01" || e.code === "PGRST205");
}

const TITLE_ACTION_TYPES: ReadonlySet<string> = new Set(["edit_title", "title"]);

/**
 * Load this tenant's URL-Inspection history for the given pages (one query,
 * grouped by inspection_url since a page can have been inspected many times -
 * every stored row is one point-in-time snapshot, useful for "earliest crawl
 * after liveAt") and compute the recrawl-clock result for every ledger row.
 * Fail-soft -> empty map (a loader hiccup means recrawlPending never fires,
 * never a crash on the Results page - the SAME posture as
 * attachSeasonalInflectionForLedger).
 */
export async function attachRecrawlClockForLedger(
  tenantId: string,
  rows: readonly RecrawlLedgerRow[],
  now: Date = new Date(),
): Promise<Map<string, RecrawlClockResult>> {
  const out = new Map<string, RecrawlClockResult>();
  if (!tenantId || rows.length === 0) return out;

  const pages = [...new Set(rows.map((r) => r.page).filter((p) => p != null && p !== ""))];
  if (pages.length === 0) return out;

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return out; // no Supabase env (dev without keys) - honest empty map
  }

  const { data, error } = await admin
    .from(TABLE)
    .select("inspection_url, last_crawl_time, last_checked_at")
    .eq("tenant_id", tenantId)
    .in("inspection_url", pages);

  if (error != null) {
    if (!isUndefinedTableError(error)) {
      log.warn("[attach-recrawl-clock] read failed; degrading to no recrawl data", {
        tenantId,
        error: error.message ?? String(error),
      });
    }
    return out;
  }

  const byPage = new Map<string, InspectionPoint[]>();
  for (const row of (data ?? []) as Array<{
    inspection_url: string;
    last_crawl_time: string | null;
    last_checked_at: string;
  }>) {
    const list = byPage.get(row.inspection_url) ?? [];
    list.push({ lastCrawlTime: row.last_crawl_time, checkedAt: row.last_checked_at });
    byPage.set(row.inspection_url, list);
  }

  for (const row of rows) {
    const inspections = byPage.get(row.page) ?? [];
    const isTitleAction = TITLE_ACTION_TYPES.has(row.actionType);
    const result = computeRecrawlClock({
      liveAt: row.shippedAt,
      inspections,
      // serp_title fallback stays unwired until a title-bearing SERP-history
      // reader exists (serp-history.ts's SerpRankPoint carries rank only, no
      // displayed title) - passing newTitle with no snapshots simply never
      // matches, which is the honest "no fallback available yet" behavior.
      newTitle: isTitleAction ? row.after : null,
      now,
    });
    out.set(row.id, result);
  }

  return out;
}
