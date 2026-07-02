/**
 * _serp-history-backfill (2026-07-02, BEACON_500 item 17) - seed the append-only
 * dataforseo_serp_history table from the EXISTING 14-day SERP cache, so history
 * starts with today's already-paid knowledge instead of an empty table.
 *
 * For each currently-cached SERP snapshot (the global dataforseo-serp-cache store,
 * Supabase blob preferred, file fallback) it synthesizes ONE history row for the
 * tenant in BEACON_TENANT_ID: captured_at = the cache row's fetchedAt, own_rank
 * resolved against the tenant's registered domain, raw_cost_usd = 0 (no new spend;
 * the cache was already paid for). IDEMPOTENT + APPEND-ONLY: inserts use ON
 * CONFLICT DO NOTHING on (tenant_id, id), so re-runs create zero rows and never
 * mutate existing history. $0: no paid API call anywhere in this script.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/_serp-history-backfill.ts
 */

import { readStore } from "@/lib/persistence/json-store";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getTenantOrThrow } from "@/domains/tenants/store";
import { buildSerpHistoryRow, type SerpCacheRow, type SerpHistoryRow } from "@/domains/serp/dataforseo-serp";

const SERP_CACHE_STORE = "dataforseo-serp-cache";
const HISTORY_TABLE = "dataforseo_serp_history";

async function main(): Promise<void> {
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) throw new Error("Set BEACON_TENANT_ID (e.g. tenant-iranopedia) before running.");
  if (!isSupabaseConfigured()) throw new Error("Supabase env missing. Source .env.local first (set -a; . ./.env.local; set +a).");

  const tenant = await getTenantOrThrow(tenantId);
  console.log(`[serp-history-backfill] tenant=${tenantId} domain=${tenant.domain}`);

  const cacheRows = await readStore<SerpCacheRow>(SERP_CACHE_STORE, []);
  console.log(`[serp-history-backfill] cached SERP snapshots found: ${cacheRows.length}`);
  if (cacheRows.length === 0) {
    console.log("[serp-history-backfill] nothing to backfill.");
    return;
  }

  const historyRows: SerpHistoryRow[] = [];
  let skippedMalformed = 0;
  for (const row of cacheRows) {
    const snapshot = row?.snapshot;
    const capturedAt = row?.fetchedAt || snapshot?.fetchedAt || "";
    if (!snapshot?.query || !capturedAt) {
      skippedMalformed += 1;
      continue;
    }
    // Cache key is "locationCode|languageCode|query(lc)" - keep the first two segments.
    const keyParts = String(row.key ?? "").split("|");
    const location = keyParts.length >= 2 ? `${keyParts[0]}|${keyParts[1]}` : "";
    historyRows.push(
      buildSerpHistoryRow({
        tenantId,
        query: snapshot.query,
        location,
        snapshot,
        tenantDomain: tenant.domain,
        capturedAt,
        costUsd: 0, // already paid when cached; the backfill spends nothing
      }),
    );
  }

  const admin = getSupabaseAdmin();
  // Insert-or-ignore, returning ONLY the rows actually created (idempotent re-runs -> 0).
  const { data, error } = await admin
    .from(HISTORY_TABLE)
    .upsert(historyRows, { onConflict: "tenant_id,id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`history insert failed: ${error.message}`);

  const created = Array.isArray(data) ? data.length : 0;
  const withOwnRank = historyRows.filter((r) => r.own_rank != null).length;
  console.log(`[serp-history-backfill] history rows created: ${created}`);
  console.log(`[serp-history-backfill] already present (skipped): ${historyRows.length - created}`);
  console.log(`[serp-history-backfill] rows where ${tenant.domain} appears in the top results: ${withOwnRank}`);
  if (skippedMalformed > 0) console.log(`[serp-history-backfill] malformed cache rows skipped: ${skippedMalformed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
