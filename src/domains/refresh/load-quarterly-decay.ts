/**
 * refresh/load-quarterly-decay (BEACON_500 item 56) - the bounded I/O for the refresh
 * production line's quarter-over-quarter rank. REUSES the existing `gsc_decay_v1` RPC
 * (migrations/2026-06-14_gsc_page_totals_and_decay_rpcs.sql - already applied, already
 * granted to service_role) with quarter-length windows instead of the 28-day windows the
 * gsc_decay trigger uses, so a page that faded gradually over a season - never crossing the
 * trigger's sharper 28d-vs-28d threshold - still surfaces. $0: no new migration, no new
 * table, the RPC is generic over p_since/p_split.
 *
 * Paged in PAGE_SIZE (1000-row) chunks exactly like loadGscDecaySignalsForTenant in
 * gsc-page-signals.ts (PostgREST caps a single response at 1000 rows regardless of
 * .limit()). Fail-soft -> [] on any read error (a loader hiccup silences the refresh queue
 * for a night, nothing more).
 */
import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { readLastFinalizedDate } from "@/domains/proof-gsc/gsc-window";
import { log } from "@/lib/logger";
import type { QuarterlyPageDelta, QuarterlyPageRow } from "./decay-queue";

const PAGE_SIZE = 1000;
/** Hard cap on rows read per tenant per pass - a page-level GROUP BY, so this is a page count,
 *  not a raw-row count; a tenant with more distinct pages than this reads its top page slice
 *  by RPC insertion order, never an unbounded scan. */
const MAX_ROWS = 20_000;
/** One quarter, in days - deliberately a plain 91 (13 weeks) rather than calendar-month math,
 *  so "prior" and "current" windows are always equal-length (a fair click comparison). */
const QUARTER_DAYS = 91;

function isoDaysAgo(anchorMs: number, days: number): string {
  return new Date(anchorMs - days * 86_400_000).toISOString().slice(0, 10);
}

/** The three quarter-boundary dates (since, split, anchor) as ISO YYYY-MM-DD, anchored to the
 *  tenant's last FINALIZED GSC day (mirrors the gsc_decay anchoring fix - GSC finalizes 2-3
 *  days behind, so a wall-clock anchor would give the "current" window fewer real data-days
 *  than the equal-width "prior" window and manufacture a fake decline). Exported for tests. */
export function quarterlyWindowBounds(anchorMs: number): { since: string; split: string } {
  const split = isoDaysAgo(anchorMs, QUARTER_DAYS);
  const since = isoDaysAgo(anchorMs, QUARTER_DAYS * 2);
  return { since, split };
}

type RpcRow = {
  page: string;
  clicks_now: number | string;
  impressions_now: number | string;
  pos_w_now: number | string;
  clicks_prior: number | string;
  impressions_prior: number | string;
  pos_w_prior: number | string;
};

type Acc = { clicks: number; impressions: number; positionWeighted: number };

function toRow(page: string, acc: Acc): QuarterlyPageRow {
  return {
    page,
    clicks: acc.clicks,
    impressions: acc.impressions,
    position: acc.impressions > 0 ? acc.positionWeighted / acc.impressions : 0,
  };
}

/**
 * Quarter-over-quarter page deltas for a tenant: this quarter (last QUARTER_DAYS days, anchored
 * to the last finalized GSC day) vs the quarter before that. Bounded, paged, fail-soft -> [].
 */
export async function loadQuarterlyDecayForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<QuarterlyPageDelta[]> {
  if (!tenantId) return [];
  const lastFinal = await readLastFinalizedDate(tenantId).catch(() => null);
  const anchorMs = lastFinal ? new Date(`${lastFinal}T00:00:00.000Z`).getTime() : now.getTime();
  const { since, split } = quarterlyWindowBounds(anchorMs);

  const nowAcc = new Map<string, Acc>();
  const priorAcc = new Map<string, Acc>();
  try {
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .rpc("gsc_decay_v1", { p_tenant: tenantId, p_since: since, p_split: split })
        .order("page")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[refresh] quarterly decay rpc read failed", { tenantId, offset, error: error.message });
        break;
      }
      const batch = (data ?? []) as unknown as RpcRow[];
      for (const r of batch) {
        // Keep the RAW page string GSC stored (no canonicalization): every downstream read in
        // this lane (loadTopQueriesForPages, loadQueryDeclinesForPages) filters gsc_daily_rows
        // with `page IN (...)`, which must match the stored value byte-for-byte. Two URL
        // variants ranking separately is an honest under-merge, never a broken join.
        const page = r.page;
        const n = nowAcc.get(page) ?? { clicks: 0, impressions: 0, positionWeighted: 0 };
        n.clicks += Number(r.clicks_now) || 0;
        n.impressions += Number(r.impressions_now) || 0;
        n.positionWeighted += Number(r.pos_w_now) || 0;
        nowAcc.set(page, n);
        const p = priorAcc.get(page) ?? { clicks: 0, impressions: 0, positionWeighted: 0 };
        p.clicks += Number(r.clicks_prior) || 0;
        p.impressions += Number(r.impressions_prior) || 0;
        p.positionWeighted += Number(r.pos_w_prior) || 0;
        priorAcc.set(page, p);
      }
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (e) {
    log.warn("[refresh] quarterly decay rpc threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }

  const out: QuarterlyPageDelta[] = [];
  for (const [page, current] of nowAcc) {
    const prior = priorAcc.get(page) ?? { clicks: 0, impressions: 0, positionWeighted: 0 };
    out.push({ page, prior: toRow(page, prior), current: toRow(page, current) });
  }
  return out;
}
