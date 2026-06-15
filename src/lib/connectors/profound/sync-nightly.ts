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

import { getBusinessConfig } from "@/lib/business-config";

import {
  fetchProfoundCategories,
  profoundKeyPresent,
  queryProfoundReport,
  queryProfoundV2Report,
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
      /** Agent Analytics v2 (bots/referrals) — 0 when the tenant's
       *  Profound plan doesn't include it (the report 4xxs fail-soft). */
      bot_rows: number;
      referral_rows: number;
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
  if (categories == null) {
    // #88 (2026-06-14) — fetchProfoundCategories returns null for BOTH "no key
    // connected" and "key present but the API call failed". Split the two so
    // the UI can show an honest "not connected yet" skip vs a real API/auth
    // FAILURE. Classification only — no extra fetch (key presence is a store
    // read). Zero genuine results is handled below as synced:true, rows:0.
    const hasKey = await profoundKeyPresent(tenantId, deps);
    return {
      synced: false,
      reason: hasKey ? "profound_api_error" : "no_profound_key",
    };
  }
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

  // ── Agent Analytics v2 (bots + referrals) ──────────────────────────
  // Raw-domain reports (no category needed): which AI crawlers hit
  // which paths (count/citations by bot) + AI-referred human visits by
  // source. 2 requests/night; tenants without Agent Analytics fail-soft
  // to 0 rows (non-2xx → null).
  let botRows = 0;
  let referralRows = 0;
  const domain = getBusinessConfig(tenantId)
    .domain?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (domain) {
    const bots = await queryProfoundV2Report(
      {
        tenantId,
        report: "bots",
        domain,
        startDate,
        endDate,
        metrics: ["count", "citations"],
        dimensions: ["date", "path", "bot_name", "bot_type"],
      },
      deps,
    );
    if (bots != null) {
      if (bots.totalRows > bots.rows.length) {
        log.warn("[profound-sync] bots page truncated", {
          tenantId,
          total: bots.totalRows,
          got: bots.rows.length,
        });
      }
      const mapped = bots.rows
        .filter((r) => r.dims.date)
        .map((r) => ({
          tenant_id: tenantId,
          date: r.dims.date!.slice(0, 10),
          path: r.dims.path ?? "",
          bot_name: r.dims.bot_name ?? "",
          bot_type: r.dims.bot_type ?? "",
          hit_count: r.mets.count ?? 0,
          citations: r.mets.citations ?? 0,
          pulled_at: pulledAt,
        }));
      for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
        const chunk = mapped.slice(i, i + UPSERT_CHUNK);
        const { error } = await sb
          .from("profound_bot_rows")
          .upsert(chunk, {
            onConflict: "tenant_id,date,path,bot_name,bot_type",
          });
        if (error) {
          log.warn("[profound-sync] bot upsert failed", {
            tenantId,
            error: error.message,
          });
          break;
        }
        botRows += chunk.length;
      }
    }

    const referrals = await queryProfoundV2Report(
      {
        tenantId,
        report: "referrals",
        domain,
        startDate,
        endDate,
        metrics: ["visits"],
        dimensions: ["date", "path", "referral_source", "referral_type"],
      },
      deps,
    );
    if (referrals != null) {
      if (referrals.totalRows > referrals.rows.length) {
        log.warn("[profound-sync] referrals page truncated", {
          tenantId,
          total: referrals.totalRows,
          got: referrals.rows.length,
        });
      }
      const mapped = referrals.rows
        .filter((r) => r.dims.date)
        .map((r) => ({
          tenant_id: tenantId,
          date: r.dims.date!.slice(0, 10),
          path: r.dims.path ?? "",
          referral_source: r.dims.referral_source ?? "",
          referral_type: r.dims.referral_type ?? "",
          visits: r.mets.visits ?? 0,
          pulled_at: pulledAt,
        }));
      for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
        const chunk = mapped.slice(i, i + UPSERT_CHUNK);
        const { error } = await sb
          .from("profound_referral_rows")
          .upsert(chunk, {
            onConflict: "tenant_id,date,path,referral_source,referral_type",
          });
        if (error) {
          log.warn("[profound-sync] referral upsert failed", {
            tenantId,
            error: error.message,
          });
          break;
        }
        referralRows += chunk.length;
      }
    }
  }

  return {
    synced: true,
    categories: batch.length,
    citation_rows: citationRows,
    visibility_rows: visibilityRows,
    bot_rows: botRows,
    referral_rows: referralRows,
  };
}
