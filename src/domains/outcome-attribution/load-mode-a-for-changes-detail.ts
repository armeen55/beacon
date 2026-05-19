/**
 * 2026-05-19 — Slice 9.A2β — Changes detail Mode A loader.
 *
 * Server-side wrapper that pulls tenant-scoped cached
 * `ga4_url_traffic` rows for a single tenant + computes Mode A
 * outcome attribution for a single recommended_edit via the pure
 * `computeModeATrafficAttribution` from 9.A2α.2.
 *
 * Mirrors the caller-bound `.forTenant(tenantId)` discipline of
 * `load-lifecycle.ts` / `load-repeat-citation.ts` /
 * `load-change-primary-evidence.ts` — tenant scope lives at THIS
 * boundary; the pure compute module receives already-tenant-scoped
 * inputs. The Supabase read filters by `tenant_id = tenantId` at
 * the query layer; the pure compute sees only the matched rows.
 *
 * Read shape:
 *   • Supabase admin `from("ga4_url_traffic").select(...).eq("tenant_id", tenantId)`.
 *   • NEVER calls the GA4 Data API.
 *   • NEVER imports `runGa4UrlTrafficReport` / `persistGa4UrlTraffic`
 *     / `refreshTenantGa4Traffic` / `normalizeGa4PagePathToFullUrl`
 *     (those are operator-substrate refresh-time only).
 *   • Type-only import of `Ga4UrlTrafficRow` (TypeScript erases at
 *     compile time; no runtime dependency on `@/lib/connectors/ga4/*`).
 *
 * Fail-soft:
 *   When Supabase admin is unavailable (env vars unset in dev),
 *   table is missing (42P01 — sequencing window between code deploy
 *   and migration apply), or any other read error fires, the loader
 *   returns `null`. The customer-facing `OutcomeAttributionAct3`
 *   renders nothing on `null`, matching the locked Section 9 K-block
 *   discipline that silent suppression is the correct response to a
 *   substrate gap.
 *
 * Cache:
 *   • Key: `["mode-a-changes-detail:v1", tenantId, recommendedEdit.id,
 *     recommendedEdit.live_at ?? "no-live", recommendedEdit.target_url
 *     ?? "no-url"]`.
 *   • TTL: 21600s (6h). Mode A inputs (recommended_edits + cached
 *     ga4_url_traffic rows) move slowly; the diagnostic page already
 *     uses derive-on-read for the operator surface, so a slightly
 *     longer TTL keeps the customer Changes detail snappy without
 *     diverging from the operator-side view.
 *   • Tag: `recommended_edits:${tenantId}` (mirrors load-lifecycle /
 *     load-repeat-citation so existing edit-mutation invalidation
 *     flows through; an operator-triggered Refresh GA4 traffic AND
 *     a recommended_edits mutation both flush the cache).
 *
 * CallRail K2-deferred:
 *   `qualifiedCallCount` is hard-coded to 0 for now. When 9.B CallRail
 *   lands, the loader will read per-edit call counts from a sibling
 *   read model and thread them in. The Mode A compute's K4 OR-branch
 *   already handles `≥ 1 calls` correctly.
 *
 * Pinned by:
 *   • tests/domains/outcome-attribution/load-mode-a-for-changes-detail.test.ts
 *   • tests/architecture/outcome-attribution-changes-detail-no-ga4-api.test.ts
 */

import {
  computeModeATrafficAttribution,
  type ModeAResult,
} from "@/domains/outcome-attribution/mode-a-cited-here-traffic-here";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { Ga4UrlTrafficRow } from "@/lib/connectors/ga4/types";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";

const TABLE = "ga4_url_traffic";

export type LoadModeAForChangesDetailOptions = {
  tenantId: string;
  recommendedEdit: RecommendedEditRow;
  /** Clock injection for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
};

/**
 * Read cached `ga4_url_traffic` rows for the tenant + compute Mode
 * A. Returns `null` on Supabase fail-soft (admin unavailable,
 * 42P01, generic read error); returns a `ModeAResult` discriminator
 * otherwise. The consumer component suppresses `null` AND every
 * `ineligible` discriminator from customer copy.
 */
export async function loadModeAForChangesDetail(
  options: LoadModeAForChangesDetailOptions,
): Promise<ModeAResult | null> {
  const { tenantId, recommendedEdit } = options;
  const now = options.now ?? new Date();

  const { unstable_cache } = await import("next/cache");
  const cacheKey = [
    "mode-a-changes-detail:v1",
    tenantId,
    recommendedEdit.id,
    recommendedEdit.live_at ?? "no-live",
    recommendedEdit.target_url ?? "no-url",
  ];

  const cached = unstable_cache(
    async () => {
      // Tenant-scoped Supabase read. Soft-fail on missing table /
      // admin unavailable / read error — return `null` so the
      // customer surface renders silently (same posture as
      // `ineligible` discriminators downstream).
      let admin;
      try {
        admin = getSupabaseAdmin();
      } catch {
        return null;
      }
      const { data, error } = await admin
        .from(TABLE)
        .select("url, date, sessions, engaged_sessions, conversions")
        .eq("tenant_id", tenantId);
      if (error != null) {
        return null;
      }
      if (!Array.isArray(data)) {
        return null;
      }

      const rows: Ga4UrlTrafficRow[] = [];
      for (const row of data) {
        if (row == null || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const url = typeof r.url === "string" ? r.url : null;
        const date = typeof r.date === "string" ? r.date : null;
        if (url == null || date == null) continue;
        rows.push({
          url,
          date,
          sessions: typeof r.sessions === "number" ? r.sessions : 0,
          engaged_sessions:
            typeof r.engaged_sessions === "number" ? r.engaged_sessions : 0,
          conversions:
            typeof r.conversions === "number" ? r.conversions : 0,
        });
      }

      return computeModeATrafficAttribution({
        recommendedEdit,
        ga4UrlTrafficRows: rows,
        // K2-deferred CallRail; light up in 9.B when the connector ships.
        qualifiedCallCount: 0,
        now,
      });
    },
    cacheKey,
    {
      revalidate: 21_600,
      tags: [`recommended_edits:${tenantId}`],
    },
  );

  return cached();
}
