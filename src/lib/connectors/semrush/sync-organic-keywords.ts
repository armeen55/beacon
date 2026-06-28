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
 *
 * IDEMPOTENT-SYNC CONTRACT (audit #35, 2026-06-12): rows UPSERT on
 * (tenant_id, domain, keyword, url); a failed chunk is skipped and
 * the next nightly run re-fetches the full report, so the table
 * converges without dedupe or manual repair — safe to re-run.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getBusinessConfig } from "@/lib/business-config";
import { isLegacyQuarantined } from "@/lib/legacy-flags";
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
  // Legacy kill-switch (Phase F): when SEMrush is quarantined, stop WRITING too
  // (reads are already gated). No new SEMrush data lands. Default OFF → unchanged.
  if (isLegacyQuarantined("semrush")) return { synced: false, reason: "quarantined" };
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
      // B82 (same class as the GSC audit-4 fix): a DB write failure must report
      // synced:false so cron-sync doesn't stamp freshness over a partial write.
      return { synced: false, reason: "upsert_failed" };
    }
    upserted += chunk.length;
  }

  // Stale-URL purge: when a keyword's ranking URL changes, the upsert inserts a
  // NEW (keyword,url) row but the OLD one survives — two URLs then look like they
  // "compete" for the keyword, FABRICATING a cannibalization rec for up to 30
  // days. Delete this (tenant,domain)'s rows not refreshed in THIS sync (older
  // fetched_at than now). Guarded on a non-empty fetch so a transient empty/
  // partial SEMrush pull can never wipe the cached domain.
  if (upserted > 0) {
    try {
      await sb
        .from("semrush_organic_keywords")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("domain", domain)
        .lt("fetched_at", now.toISOString());
    } catch {
      /* non-fatal: the 30-day TTL purge below is the backstop */
    }
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

// ── Keyword-gap slice (2026-06-12) — weekly gap sync ─────────────────

/**
 * Weekly (PT Monday) keyword-gap fetch vs the tenant's TOP organic
 * competitor (from the already-synced semrush_domain_metrics
 * snapshot). 6 lines × 80 units = 480 — the spec's rotating weekly
 * slot inside the nightly budget. Idempotent UPSERTs + the same ToS
 * 30-day TTL purge. Fail-soft everywhere.
 */
export type SemrushGapSyncResult =
  | { synced: false; reason: string }
  | { synced: true; competitor: string; rows_upserted: number };

export async function syncSemrushKeywordGapForTenant(args: {
  tenantId: string;
  now?: Date;
}): Promise<SemrushGapSyncResult> {
  const { tenantId } = args;
  if (isLegacyQuarantined("semrush")) return { synced: false, reason: "quarantined" };
  const now = args.now ?? new Date();

  // Weekly gate: PT Monday only (the budget spec's rotation).
  const weekdayPt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/Los_Angeles",
  }).format(now);
  if (weekdayPt !== "Mon") {
    return { synced: false, reason: "not_gap_day" };
  }

  const domain = getBusinessConfig(tenantId)
    .domain?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  if (!domain) return { synced: false, reason: "no_domain" };

  const { loadSemrushDomainMetrics } = await import(
    "./persist-domain-metrics"
  );
  const metrics = await loadSemrushDomainMetrics(tenantId, domain);
  const competitor = metrics?.organic_competitors?.[0]?.domain?.trim();
  if (!competitor) {
    return { synced: false, reason: "no_known_competitor" };
  }

  const { fetchKeywordGap } = await import("./domain-gap");
  const rows = await fetchKeywordGap({
    tenantId,
    ourDomain: domain,
    competitorDomain: competitor,
  });
  if (rows == null) return { synced: false, reason: "no_key_or_api_error" };

  const sb = getSupabaseAdmin();
  const mapped = rows.map((r) => ({
    tenant_id: tenantId,
    domain,
    competitor_domain: competitor,
    keyword: r.keyword,
    competitor_position: r.competitorPosition,
    volume: r.volume,
    difficulty: r.difficulty,
    fetched_at: now.toISOString(),
  }));
  let upserted = 0;
  if (mapped.length > 0) {
    const { error } = await sb
      .from("semrush_keyword_gaps")
      .upsert(mapped, {
        onConflict: "tenant_id,domain,competitor_domain,keyword",
      });
    if (error) {
      log.warn("[semrush-gap-sync] upsert failed", {
        tenantId,
        error: error.message,
      });
      // audit #16 (2026-06-14): a failed upsert is NOT a successful sync —
      // report it so the nightly runner warns instead of silently logging 0.
      return { synced: false, reason: "upsert_failed" };
    }
    upserted = mapped.length;
  }
  // ToS 30-day TTL purge (cached third-party rows only).
  try {
    const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    await sb
      .from("semrush_keyword_gaps")
      .delete()
      .eq("tenant_id", tenantId)
      .lt("fetched_at", cutoff);
  } catch {
    // best effort
  }
  return { synced: true, competitor, rows_upserted: upserted };
}
