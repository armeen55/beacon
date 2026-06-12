/**
 * Insight Graph slice 2 (2026-06-12) — nightly SEMrush organic-keyword
 * sync. One domain_organic call per tenant per night (150 lines ×
 * 10 units = 1,500 units, inside the ≤2,000/night budget), UPSERTed
 * into `semrush_organic_keywords`.
 *
 * ToS COMPLIANCE: SEMrush's API usage restrictions permit caching raw
 * API data for AT MOST ONE MONTH. Every sync purges this tenant's rows
 * with fetched_at older than 30 days — a contractual TTL on cached
 * third-party rows (scoped to this table only; tenant data is never
 * touched). Derived recommendations are our own work product and keep
 * their own lifecycle.
 *
 * Fail-soft: no key / disconnected / API error → { synced: false },
 * one log line, the cron continues.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getBusinessConfig } from "@/lib/business-config";
import { log } from "@/lib/logger";

import {
  DOMAIN_ORGANIC_NIGHTLY_LIMIT,
  fetchDomainOrganicKeywords,
} from "./domain-organic";

const TOS_TTL_DAYS = 30;
const UPSERT_CHUNK = 200;

export type SemrushOrganicSyncResult =
  | { synced: false; reason: string }
  | { synced: true; domain: string; rows_upserted: number; purged: boolean };

export async function syncSemrushOrganicKeywordsForTenant(args: {
  tenantId: string;
  now?: Date;
}): Promise<SemrushOrganicSyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const domain = getBusinessConfig(tenantId)
    .domain?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  if (!domain) return { synced: false, reason: "no_domain" };

  const keywords = await fetchDomainOrganicKeywords({
    tenantId,
    domain,
    displayLimit: DOMAIN_ORGANIC_NIGHTLY_LIMIT,
  });
  if (keywords == null) {
    return { synced: false, reason: "no_key_or_api_error" };
  }

  const sb = getSupabaseAdmin();
  const rows = keywords.map((k) => ({
    tenant_id: tenantId,
    domain,
    keyword: k.keyword,
    position: k.position,
    prev_position: k.prevPosition,
    volume: k.volume,
    cpc: k.cpc,
    url: k.url,
    traffic_pct: k.trafficPct,
    difficulty: k.difficulty,
    intent: k.intent,
    fetched_at: now.toISOString(),
  }));
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await sb
      .from("semrush_organic_keywords")
      .upsert(chunk, { onConflict: "tenant_id,domain,keyword,url" });
    if (error) {
      log.warn("[semrush-sync] upsert failed", {
        tenantId,
        error: error.message,
      });
      return { synced: true, domain, rows_upserted: upserted, purged: false };
    }
    upserted += chunk.length;
  }

  // ToS 30-day TTL purge (this tenant's stale cached rows only).
  let purged = false;
  try {
    const cutoff = new Date(
      now.getTime() - TOS_TTL_DAYS * 86_400_000,
    ).toISOString();
    const { error } = await sb
      .from("semrush_organic_keywords")
      .delete()
      .eq("tenant_id", tenantId)
      .lt("fetched_at", cutoff);
    purged = error == null;
  } catch {
    purged = false;
  }

  return { synced: true, domain, rows_upserted: upserted, purged };
}
