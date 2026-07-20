import { NextResponse, type NextRequest } from "next/server";
import { syncAllConnectedForActiveTenants, type CronSyncResult } from "@/lib/connectors/cron-sync";
import { log } from "@/lib/logger";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { beginCronRun, finishCronRun } from "@/domains/ops/cron-runs-store";

// Pure HTTP→Supabase fan-out across tenants; must never be statically rendered.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export type SyncCronHttpOutcome = {
  status: 200 | 207 | 500 | 503;
  ok: boolean;
  state: "healthy" | "degraded" | "broken" | "misconfigured";
  error?: "receipt_not_durable" | "no_active_tenants" | "no_connected_sources";
};

/**
 * PURE route health contract. A completed function is not automatically a
 * healthy cron. Fail closed on an ephemeral receipt, missing fleet/source
 * inventory, or a broken connector; distinguish known degradation with 207.
 */
export function syncCronHttpOutcome(result: CronSyncResult, durableReceipt: boolean): SyncCronHttpOutcome {
  if (!durableReceipt) return { status: 503, ok: false, state: "misconfigured", error: "receipt_not_durable" };
  if (result.tenants === 0) return { status: 503, ok: false, state: "misconfigured", error: "no_active_tenants" };
  if (result.connectedSources === 0) return { status: 503, ok: false, state: "misconfigured", error: "no_connected_sources" };
  if (result.health.state === "broken") return { status: 500, ok: false, state: "broken" };
  if (result.health.state === "degraded") return { status: 207, ok: false, state: "degraded" };
  return { status: 200, ok: true, state: "healthy" };
}

/**
 * Manual data-sync maintenance endpoint (NOT on a schedule — vercel.json `crons`
 * is empty; Beacon has no scheduler, so the on-visit refresh is the live freshness
 * path). Invoked by hand to force a full fleet sync + enrichment when needed.
 *
 * Keeps every connected read source fresh AND keeps Google OAuth tokens alive
 * inside their 7-day refresh window (so connections stop going stale). After
 * each tenant syncs, it ALSO runs the §6 move-draft precompute (cron-sync.ts)
 * so the cockpit opens with ready AI drafts — that path is OFF unless
 * BEACON_LLM_PROVIDER=openai, budget-capped ($10/mo fail-closed), and idempotent
 * (only un-drafted Moves, so steady-state is ~free). Fail-soft: a precompute or
 * sync error for one tenant never aborts the rest.
 *
 * Auth: Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`
 * on scheduled invocations when CRON_SECRET is set. We require it so the
 * endpoint cannot be triggered anonymously. The auth middleware treats
 * /api/cron/* as public (no Supabase session is present on a cron call), so
 * this header check is the route's only gate.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("[cron-sync] CRON_SECRET is not set — refusing to run");
    return NextResponse.json({ ok: false, error: "cron_secret_unset" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Deadman receipt: INSERT the started row the MOMENT this route is reached
  // (right after auth, before ANY sync work). This is the one job whose ledger
  // row is written deep inside cron-sync.ts, so lifting the begin receipt up to
  // the route entry is what lets the stall alarm tell "Vercel never fired the
  // 09:00 sync" (no row) from "it fired but died before finishing" (a running
  // row that never finished). The handle flows into the sync so it FINISHES the
  // same row; a route-level throw finishes it here. Fail-soft: begin never throws.
  const receipt = await beginCronRun({ job: "sync-connectors", startedAt: new Date().toISOString() });
  try {
    const result = await syncAllConnectedForActiveTenants(receipt);
    const outcome = syncCronHttpOutcome(result, receipt.storage === "supabase");
    return NextResponse.json({ ...outcome, summary: result }, { status: outcome.status });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[cron-sync] route failed", { error: err.slice(0, 300) });
    // N39: the whole nightly run died before its own fail-soft phases could
    // record anything. Fleet-level row (no tenant context at this altitude).
    await recordAppError({
      route: "cron/sync-connectors",
      tenantId: null,
      action: "route",
      ...errorFieldsFrom(e),
    });
    // The sync threw before it could finish its own receipt: close it here so
    // the started row never lingers and reads as a false died-mid-run.
    await finishCronRun(receipt, {
      ok: false,
      perSource: [],
      notes: { routeError: err.slice(0, 300) },
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: err.slice(0, 300) }, { status: 500 });
  }
}
