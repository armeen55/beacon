"use server";

/**
 * 2026-06-09 — operator-only "refresh all connected data sources" (§5
 * connector auto-refresh, single-tenant half). One click pulls fresh
 * data from every connected cache-backed connector that feeds the
 * outcome-attribution substrate (GA4 traffic, CallRail calls, Semrush
 * metrics) instead of visiting each `/diagnostics/<provider>` page.
 *
 * Posture:
 *   • Operator-gated once at this boundary; each composed sub-action is
 *     ALSO operator-gated + soft-failing, so this never makes a call a
 *     non-operator couldn't already make.
 *   • Composes the existing per-connector refresh actions — no new HTTP
 *     paths, no new persistence. Each runs independently; one connector
 *     failing/skipping never blocks the others.
 *   • Per-connector outcome is classified refreshed / skipped (not
 *     connected) / failed (connected but the pull errored), so the
 *     operator sees exactly what happened.
 *   • This is the orchestration seam the nightly poll could later call;
 *     it is NOT scheduled here (no cron added).
 *
 * Pinned by tests/app/diagnostics/connectors-actions.test.ts.
 */

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { refreshTenantGa4Traffic } from "@/app/(shell)/diagnostics/outcome-attribution/actions";
import { refreshSemrushMetrics } from "@/app/(shell)/diagnostics/semrush/actions";
import { refreshCallRailMetrics } from "@/app/(shell)/diagnostics/callrail/actions";
// 2026-06-15 — crons off: the GSC / Profound / Clarity sync engines (pure
// HTTP→Supabase, Vercel-safe) are now part of the one-click on-demand refresh
// so connecting those sources actually pulls data with no nightly job.
import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";
import { syncProfoundNightlyForTenant } from "@/lib/connectors/profound/sync-nightly";
import { syncClarityDailyMetricsForTenant } from "@/lib/connectors/clarity/sync-daily-metrics";

const ROUTE = "/diagnostics/connectors";

export type ConnectorRefreshOutcome = {
  provider: "gsc" | "ga4" | "callrail" | "semrush" | "profound" | "clarity";
  /** refreshed = data pulled · skipped = not connected · failed = pull errored */
  outcome: "refreshed" | "skipped" | "failed";
  detail: string;
};

/** Map a connector sync engine's `{synced, reason?, ...counts}` discriminated
 *  result into a classified outcome without coupling to each engine's exact
 *  field names. Reads common count fields defensively. */
function outcomeFor(
  provider: ConnectorRefreshOutcome["provider"],
  result: unknown,
): ConnectorRefreshOutcome {
  const r = (result ?? {}) as {
    synced?: boolean;
    reason?: string;
    rows_upserted?: number;
    rows?: number;
    citation_rows?: number;
    days?: number;
  };
  if (r.synced) {
    const n = r.rows_upserted ?? r.rows ?? r.citation_rows;
    const detail =
      n != null
        ? `${n.toLocaleString()} row${n === 1 ? "" : "s"}${r.days != null ? ` · ${r.days}d` : ""}`
        : "synced";
    return { provider, outcome: "refreshed", detail };
  }
  return {
    provider,
    outcome: classify(r.reason),
    detail: r.reason ?? "skipped",
  };
}

export type RefreshAllDataSourcesResult =
  | {
      ok: true;
      results: ConnectorRefreshOutcome[];
      refreshedCount: number;
      skippedCount: number;
      failedCount: number;
    }
  | { ok: false; reason: "not_operator" };

/** Reasons that mean "connector simply isn't set up" — a skip, not a failure.
 *  Includes the dormant-until-key reasons of every connector so an unconnected
 *  source shows "not connected", never an alarming "failed". (Genuine failures
 *  like supabase_unavailable / upsert_failed are intentionally NOT here.) */
const NOT_CONNECTED_REASONS = new Set([
  "no_token",
  "no_key",
  "no_property",
  "no_domain",
  "disconnected",
  // GSC
  "no_usable_gsc_token",
  "no_property_derivable",
  // Profound (dormant until key + category configured)
  "no_key_or_api_error",
  "no_categories_configured",
  // Clarity (dormant until token)
  "no_token_or_api_error",
]);

function classify(
  reason: string | undefined,
): "skipped" | "failed" {
  return reason != null && NOT_CONNECTED_REASONS.has(reason)
    ? "skipped"
    : "failed";
}

export async function refreshAllDataSources(): Promise<RefreshAllDataSourcesResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };

  const results: ConnectorRefreshOutcome[] = [];
  const tenantId = await currentTenantId();

  // Google Search Console — the core / highest-priority source (the GSC-led
  // pivot leads every recommendation with first-party search demand). Pure
  // HTTP→Supabase, Vercel-safe; first run on a cold tenant auto-backfills.
  try {
    const gsc = await syncGscSearchAnalyticsForTenant({ tenantId });
    results.push(outcomeFor("gsc", gsc));
  } catch (e) {
    results.push({
      provider: "gsc",
      outcome: "failed",
      detail: e instanceof Error ? e.message.slice(0, 120) : "error",
    });
  }

  // GA4 traffic.
  const ga4 = await refreshTenantGa4Traffic();
  results.push(
    ga4.ok
      ? {
          provider: "ga4",
          outcome: "refreshed",
          detail: `${ga4.rows_upserted} URL/day rows (${ga4.startDate}→${ga4.endDate})`,
        }
      : { provider: "ga4", outcome: classify(ga4.reason), detail: ga4.reason },
  );

  // CallRail calls. Multi-property (2026-06-10): call tracking is a
  // local-service feature — segment-gated per tenant.
  const { getCurrentTenantFeatures } = await import(
    "@/domains/tenants/tenant-features"
  );
  const features = await getCurrentTenantFeatures();
  if (!features.call_tracking) {
    results.push({
      provider: "callrail",
      outcome: "skipped",
      detail: "feature_off_for_segment",
    });
  } else {
    const callrail = await refreshCallRailMetrics();
    results.push(
      callrail.ok
        ? {
            provider: "callrail",
            outcome: "refreshed",
            detail: `${callrail.rowsUpserted} URL/day rows`,
          }
        : {
            provider: "callrail",
            outcome: classify(callrail.reason),
            detail: callrail.reason,
          },
    );
  }

  // Semrush domain metrics.
  const semrush = await refreshSemrushMetrics();
  results.push(
    semrush.ok
      ? {
          provider: "semrush",
          outcome: "refreshed",
          detail: `${semrush.competitorCount} organic competitors`,
        }
      : {
          provider: "semrush",
          outcome: classify(semrush.reason),
          detail: semrush.reason,
        },
  );

  // Profound (AI-visibility, secondary signal). Dormant-honest until a key
  // is connected; pure HTTP→Supabase.
  try {
    const profound = await syncProfoundNightlyForTenant({ tenantId });
    results.push(outcomeFor("profound", profound));
  } catch (e) {
    results.push({
      provider: "profound",
      outcome: "failed",
      detail: e instanceof Error ? e.message.slice(0, 120) : "error",
    });
  }

  // Microsoft Clarity (page-friction signal → clarity_friction trigger).
  try {
    const clarity = await syncClarityDailyMetricsForTenant({ tenantId });
    results.push(outcomeFor("clarity", clarity));
  } catch (e) {
    results.push({
      provider: "clarity",
      outcome: "failed",
      detail: e instanceof Error ? e.message.slice(0, 120) : "error",
    });
  }

  revalidatePath(ROUTE);
  return {
    ok: true,
    results,
    refreshedCount: results.filter((r) => r.outcome === "refreshed").length,
    skippedCount: results.filter((r) => r.outcome === "skipped").length,
    failedCount: results.filter((r) => r.outcome === "failed").length,
  };
}

// ── Void-returning <form action> wrapper (the page binds this) ──────
export async function refreshAllDataSourcesFromForm(
  _formData: FormData,
): Promise<void> {
  await refreshAllDataSources();
}
