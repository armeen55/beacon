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
import { log } from "@/lib/logger";
import { refreshTenantGa4Traffic } from "@/app/(shell)/diagnostics/outcome-attribution/actions";
import { refreshCallRailMetrics } from "@/app/(shell)/diagnostics/callrail/actions";
// 2026-06-15 — crons off: the GSC / Clarity sync engines (pure
// HTTP→Supabase, Vercel-safe) are now part of the one-click on-demand refresh
// so connecting those sources actually pulls data with no nightly job.
import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";
import { syncClarityDailyMetricsForTenant } from "@/lib/connectors/clarity/sync-daily-metrics";
import { startDeepBackfill, runDeepBackfillChunk, readBackfillProgress, isBackfillStalled } from "@/lib/connectors/gsc/deep-backfill";

const ROUTE = "/diagnostics/connectors";

export type ConnectorRefreshOutcome = {
  provider: "gsc" | "ga4" | "callrail" | "clarity";
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
  // GSC — genuinely no token row (#87). A CONNECTED-but-expired grant now
  // reports gsc_token_expired (intentionally NOT here → classifies as failed).
  "no_usable_gsc_token",
  "no_property_derivable",
  "no_key_or_api_error",
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

  // (SEMrush domain metrics removed Phase F.1 — SEMrush deleted caller-first.)
  // (Profound AI-visibility sync removed 2026-07-20 — the borrowed account was
  //  fully disconnected. AI-answer evidence now reads only OUR durable stored
  //  tables, refreshed by no live account call.)

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

// ─────────────────────────────────────────────────────────────────────
// PIVOT (2026-06-15): the in-house native AEO polling engine (runNativePoll +
// the Perplexity/ChatGPT poll adapters) and the operator-only "Run today's AI
// reading" action that drove it have been removed. AI-answer evidence now comes
// from the native engine poll (run-engine-poll) writing to our own observation
// tables, plus historical AI-answer rows in our durable stored tables.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// ON-DEMAND Proof Engine recompute (2026-06-15) — crons off.
//
// buildAndPersistTenantProof is the causal Proof Engine: it classifies every
// shipped edit Helping / Hurting / Nothing-Yet against natural-control pages
// (diff-in-diff) and persists the customer-facing outcomes that the Proof tile
// (loadProvenWins) + Changes scorecard read. Its ONLY caller used to be the
// nightly generation script — with that cron gone, the proof would never
// recompute. This surfaces it as an operator gesture.
//
// 100% deterministic, NO paid API (reads existing changelog + edits + citation
// history → Supabase). Safe to click any time; best-effort.
// ─────────────────────────────────────────────────────────────────────

export type RecomputeProofResult =
  | {
      ok: true;
      events_classified: number;
      computed: number;
      weak: number;
      watching: number;
      persisted: number;
    }
  | { ok: false; reason: string };

export async function recomputeProofNow(): Promise<RecomputeProofResult> {
  const action = "recomputeProofNow";
  const t0 = Date.now();
  if (!isOperatorModeServer()) {
    return { ok: false, reason: "not_operator" };
  }
  log.info("Action started", { action });
  try {
    const tenantId = await currentTenantId();
    const { buildAndPersistTenantProof } = await import(
      "@/domains/attribution/proof-engine"
    );
    const proof = await buildAndPersistTenantProof(tenantId);
    revalidatePath(ROUTE);
    log.info("Action completed", {
      action,
      durationMs: Date.now() - t0,
      computed: proof.computed,
      watching: proof.watching,
      persisted: proof.persisted,
    });
    return {
      ok: true,
      events_classified: proof.events_classified,
      computed: proof.computed,
      weak: proof.weak,
      watching: proof.watching,
      persisted: proof.persisted,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: err.slice(0, 500),
    });
    return { ok: false, reason: err.slice(0, 200) };
  }
}

// Void-returning <form action> wrapper the page binds.
export async function recomputeProofFromForm(
  _formData: FormData,
): Promise<void> {
  await recomputeProofNow();
}

// ─────────────────────────────────────────────────────────────────────
// GSC deep history backfill (2026-07-02, master plan item 63) — the seasonality
// engine's peak calendar needs multiple YEARS of demand to prove a wave repeats,
// but the normal sync only ever holds a 90-day cold-start window. This
// one-time operator action reaches back up to DEEP_BACKFILL_DAYS (480, GSC's own
// ~16-month retention ceiling) in small resumable chunks, so a lambda timeout or
// a dropped invocation never loses progress. Runs the FIRST chunk synchronously
// (so the operator sees an immediate result); the operator clicking "Continue
// loading history" on a later visit runs the next chunk the same way. Beacon has
// no scheduler, but continueDeepBackfillIfStarted below also fires during normal
// use, one chunk per owned background visit cycle - the click path and the
// on-use cycle both finish this over time.
// ─────────────────────────────────────────────────────────────────────

export type GscDeepBackfillStatus =
  | { started: false; reason: string }
  | {
      started: true;
      property: string;
      targetDate: string;
      cursorDate: string | null;
      status: "in_progress" | "complete";
      daysPulled: number;
      /** Last time a chunk actually completed (YYYY-MM-DD). */
      lastAdvancedDate: string;
      /** True when an in_progress backfill has stopped advancing: its chunk keeps
       *  failing, so the operator must see the honest stall, not a bland "in progress". */
      stalled: boolean;
    };

/** Read-only status for the connectors page (no mutation) - lets the operator
 *  see backfill progress on every render without re-triggering a chunk. */
export async function loadGscDeepBackfillStatus(): Promise<GscDeepBackfillStatus> {
  try {
    const tenantId = await currentTenantId();
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const gscRow = await getSupabaseAdmin()
      .from("gsc_daily_rows")
      .select("property")
      .eq("tenant_id", tenantId)
      .limit(1);
    const property = (gscRow.data?.[0] as { property?: string } | undefined)?.property;
    if (!property) return { started: false, reason: "no_synced_property" };
    const progress = await readBackfillProgress(tenantId, property);
    if (progress == null) return { started: false, reason: "not_started" };
    return {
      started: true,
      property,
      targetDate: progress.target_date,
      cursorDate: progress.cursor_date,
      status: progress.status,
      daysPulled: progress.days_pulled,
      lastAdvancedDate: progress.updated_at.slice(0, 10),
      stalled: isBackfillStalled(progress, new Date()),
    };
  } catch (e) {
    return { started: false, reason: e instanceof Error ? e.message.slice(0, 120) : "error" };
  }
}

export type StartGscDeepBackfillResult =
  | { ok: true; property: string; targetDate: string; firstChunkDaysPulled: number }
  | { ok: false; reason: string };

/** Operator gesture: "Load my full Search Console history." Initializes the
 *  progress row (idempotent - safe to click again mid-backfill) and runs the
 *  first bounded chunk immediately so the click has a visible effect; the
 *  remaining chunks finish the same way, one click per visit ("Continue
 *  loading history" calls this same action again). */
export async function startGscDeepBackfillNow(): Promise<StartGscDeepBackfillResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const tenantId = await currentTenantId();
  const started = await startDeepBackfill(tenantId);
  if (!started.started) return { ok: false, reason: started.reason };
  const chunk = await runDeepBackfillChunk(tenantId);
  revalidatePath(ROUTE);
  return {
    ok: true,
    property: started.property,
    targetDate: started.targetDate,
    firstChunkDaysPulled: chunk.ran ? chunk.daysPulled : 0,
  };
}

// Void-returning <form action> wrapper the page binds.
export async function startGscDeepBackfillFromForm(_formData: FormData): Promise<void> {
  await startGscDeepBackfillNow();
}
