import { NextResponse, type NextRequest } from "next/server";
import { syncAllConnectedForActiveTenants } from "@/lib/connectors/cron-sync";
import { log } from "@/lib/logger";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { beginCronRun, finishCronRun } from "@/domains/ops/cron-runs-store";

// Pure HTTP→Supabase fan-out across tenants; must never be statically rendered.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly data-sync cron (scheduled in vercel.json, 09:00 UTC).
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
    return NextResponse.json({ ok: true, summary: result });
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
