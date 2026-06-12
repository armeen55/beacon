/**
 * Profound nightly sync (2026-06-12 night shift) — per-tenant pull of
 * answer-engine citations + visibility/share-of-voice into Beacon's
 * own tables, so triggers and the proof engine can fuse "which AI
 * platforms cite which of MY urls" with crawl/GSC/SEMrush truth.
 *
 * Budget (spec, official docs): 600 requests/hour per tenant key. One
 * nightly run is 1 discovery + 2 reports per category — single-digit
 * requests. Window: trailing 3 days, EST date semantics (Profound
 * interprets plain YYYY-MM-DD as EST; inclusive both ends), re-pulled
 * nightly so late-settling data self-heals via idempotent UPSERTs —
 * freshness is undocumented (UNVERIFIED), so the 3-day re-pull is the
 * honest hedge.
 *
 * Fail-soft EVERYWHERE: no key / API error / no categories / table
 * missing → { synced: false, reason } — the cron logs one line and
 * moves on. Categories are capped per night (budget discipline) with
 * an honest log line when anything is skipped — no silent caps.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

import {
  fetchProfoundCategories,
  queryProfoundReport,
  type ProfoundFetchDeps,
} from "./client";

/** Trailing re-pull window (days, inclusive). */
const WINDOW_DAYS = 3;
/** Per-night category cap — 2 report requests each. */
const MAX_CATEGORIES_PER_NIGHT = 10;
const UPSERT_CHUNK = 500;

const CITATION_DIMS = ["date", "model", "root_domain", "url"] as const;
const CITATION_METS = ["count", "citation_share"] as const;
const VISIBILITY_DIMS = ["date", "model", "asset_name"] as const;
const VISIBILITY_METS = [
  "visibility_score",
  "share_of_voice",
  "mentions_count",
  "executions",
] as const;

export type ProfoundSyncResult =
  | { synced: false; reason: string }
  | {
      synced: true;
      categories: number;
      citation_rows: number;
      visibility_rows: number;
    };

/** YYYY-MM-DD for `d` in America/New_York — Profound's plain-date
 *  semantics are EST (per the official date-ranges doc). */
export function profoundEstDateString(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function syncProfoundNightlyForTenant(
  args: { tenantId: string; now?: Date },
  deps: ProfoundFetchDeps = {},
): Promise<ProfoundSyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const categories = await fetchProfoundCategories(tenantId, deps);
  if (categories == null) return { synced: false, reason: "no_key_or_api_error" };
  if (categories.length === 0) {
    // Key works but the Profound workspace has no category configured —
    // every report call requires one; tell the operator honestly.
    return { synced: false, reason: "no_categories_configured" };
  }
  if (categories.length > MAX_CATEGORIES_PER_NIGHT) {
    log.warn("[profound-sync] category cap hit — syncing first batch only", {
      tenantId,
      total: categories.length,
      cap: MAX_CATEGORIES_PER_NIGHT,
    });
  }
  const batch = categories.slice(0, MAX_CATEGORIES_PER_NIGHT);

  const endDate = profoundEstDateString(now);
  const startDate = profoundEstDateString(
    new Date(now.getTime() - (WINDOW_DAYS - 1) * 86_400_000),
  );

  let sb;
  try {
    sb = getSupabaseAdmin();
  } catch {
    return { synced: false, reason: "supabase_unavailable" };
  }

  const pulledAt = now.toISOString();
  let citationRows = 0;
  let visibilityRows = 0;

  for (const cat of batch) {
    // (b) citations — which AI models cite which URLs/domains.
    const citations = await queryProfoundReport(
      {
        tenantId,
        report: "citations",
        categoryId: cat.id,
        startDate,
        endDate,
        metrics: CITATION_METS,
        dimensions: CITATION_DIMS,
      },
      deps,
    );
    if (citations != null) {
      if (citations.totalRows > citations.rows.length) {
        log.warn("[profound-sync] citations page truncated", {
          tenantId,
          category: cat.id,
          total: citations.totalRows,
          got: citations.rows.length,
        });
      }
      const mapped = citations.rows
        .filter((r) => r.dims.date && r.dims.url)
        .map((r) => ({
          tenant_id: tenantId,
          category_id: cat.id,
          date: r.dims.date!.slice(0, 10),
          model: r.dims.model ?? "",
          root_domain: r.dims.root_domain ?? "",
          url: r.dims.url!,
          citation_count: r.mets.count ?? 0,
          citation_share: r.mets.citation_share ?? 0,
          pulled_at: pulledAt,
        }));
      for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
        const chunk = mapped.slice(i, i + UPSERT_CHUNK);
        const { error } = await sb
          .from("profound_citation_rows")
          .upsert(chunk, {
            onConflict: "tenant_id,category_id,date,model,root_domain,url",
          });
        if (error) {
          log.warn("[profound-sync] citation upsert failed", {
            tenantId,
            error: error.message,
          });
          break;
        }
        citationRows += chunk.length;
      }
    }

    // (a+c) visibility + share-of-voice per model per asset (the
    // tenant's brand AND its competitors — assets in the category).
    const visibility = await queryProfoundReport(
      {
        tenantId,
        report: "visibility",
        categoryId: cat.id,
        startDate,
        endDate,
        metrics: VISIBILITY_METS,
        dimensions: VISIBILITY_DIMS,
      },
      deps,
    );
    if (visibility != null) {
      if (visibility.totalRows > visibility.rows.length) {
        log.warn("[profound-sync] visibility page truncated", {
          tenantId,
          category: cat.id,
          total: visibility.totalRows,
          got: visibility.rows.length,
        });
      }
      const mapped = visibility.rows
        .filter((r) => r.dims.date)
        .map((r) => ({
          tenant_id: tenantId,
          category_id: cat.id,
          date: r.dims.date!.slice(0, 10),
          model: r.dims.model ?? "",
          asset_name: r.dims.asset_name ?? "",
          visibility_score: r.mets.visibility_score ?? 0,
          share_of_voice: r.mets.share_of_voice ?? 0,
          mentions_count: r.mets.mentions_count ?? 0,
          executions: r.mets.executions ?? 0,
          pulled_at: pulledAt,
        }));
      for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
        const chunk = mapped.slice(i, i + UPSERT_CHUNK);
        const { error } = await sb
          .from("profound_visibility_rows")
          .upsert(chunk, {
            onConflict: "tenant_id,category_id,date,model,asset_name",
          });
        if (error) {
          log.warn("[profound-sync] visibility upsert failed", {
            tenantId,
            error: error.message,
          });
          break;
        }
        visibilityRows += chunk.length;
      }
    }
  }

  return {
    synced: true,
    categories: batch.length,
    citation_rows: citationRows,
    visibility_rows: visibilityRows,
  };
}
