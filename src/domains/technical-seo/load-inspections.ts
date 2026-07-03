/**
 * load-inspections (2026-07-03, BEACON_500 P11) - the I/O boundary that reads the
 * tenant's cached URL-Inspection rows (Google's own per-URL index verdict) into a
 * canonical-URL -> {coverageState} map the technical engines consume.
 *
 * Server-only. Reads ONLY the ALREADY-SYNCED gsc_url_inspections cache rows the
 * GSC client already populates - it NEVER calls the URL Inspection API itself (no
 * quota burn on the recommendation path). Fail-soft: missing table / no rows /
 * Supabase error -> empty map, and the index-verdict legs of the engines then
 * abstain (dead-URL still fires off snapshot 404s; redirect-chain still fires off
 * the liveness pass; only the coverage-verdict legs go quiet).
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

import type { TechnicalInspection } from "./load-technical-inputs";

const CACHE_TABLE = "gsc_url_inspections";
const PAGE_SIZE = 1_000;
const MAX_ROWS = 20_000;

/**
 * Load the tenant's URL-inspection coverage verdicts, keyed by canonical URL.
 * Fail-soft to an empty map on any read failure.
 */
export async function loadInspectionsForTenant(
  tenantId: string,
): Promise<Map<string, TechnicalInspection>> {
  const out = new Map<string, TechnicalInspection>();
  let sb;
  try {
    sb = getSupabaseAdmin();
  } catch {
    return out;
  }
  try {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from(CACHE_TABLE)
        .select("inspection_url, coverage_state")
        .eq("tenant_id", tenantId)
        .order("inspection_url")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        // 42P01 (table missing, migration window) is a silent skip; anything else
        // is logged once and degrades to whatever loaded so far.
        if ((error as { code?: unknown }).code !== "42P01") {
          log.warn("[technical-seo] inspection cache read failed", {
            tenantId,
            offset,
            error: error.message,
          });
        }
        break;
      }
      const batch = (data ?? []) as Array<{
        inspection_url: string;
        coverage_state: string | null;
      }>;
      for (const r of batch) {
        const key = canonicalizeCitationUrl(r.inspection_url) ?? r.inspection_url;
        out.set(key, { coverageState: r.coverage_state });
      }
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (e) {
    log.warn("[technical-seo] inspection cache read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return out;
  }
  return out;
}
