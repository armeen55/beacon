import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { runAutopilotPass, type AutopilotPassResult } from "@/domains/autopilot/run-autopilot";
import { log } from "@/lib/logger";
import { recordCronRun } from "@/domains/ops/cron-runs-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /api/cron/autopilot (2026-07-01, BEACON 500 item 1) - the trust-budget
 * autopilot pass. For each tenant that has explicitly armed it in settings,
 * ships up to the weekly budget of changes from PROVEN change types only
 * (default: 10+ measured results with 80 percent that did not hurt), through
 * the existing push path (Ritz hard-blocked, daily cap, pre-push snapshot,
 * proof record + receipt). Default OFF per tenant = instant no-op.
 *
 * Idempotent per day (a daily marker in the autopilot store guards reruns).
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; required,
 * fail-closed (identical to /api/cron/measure-due).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("[autopilot-cron] CRON_SECRET is not set - refusing to run");
    return NextResponse.json({ ok: false, error: "cron_secret_unset" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // T0c deadman receipt: one cron_runs row per invocation (fail-soft) so the
  // stall alarm + health panel can watch this job like every other.
  const startedAt = new Date().toISOString();
  const results: AutopilotPassResult[] = [];
  try {
    const tenants = await listTenants();
    for (const t of tenants) {
      try {
        results.push(await runAutopilotPass(t.id));
      } catch (e) {
        results.push({
          tenantId: t.id,
          ran: false,
          reason: `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
          considered: 0,
          picked: 0,
          shipped: 0,
          failed: 0,
          receiptLines: [],
        });
        log.warn("[autopilot-cron] tenant failed", {
          tenantId: t.id,
          error: e instanceof Error ? e.message : "?",
        });
      }
    }
    await recordCronRun({
      job: "autopilot",
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      perSource: [],
      notes: {
        tenants: results.length,
        shipped: results.reduce((sum, r) => sum + r.shipped, 0),
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[autopilot-cron] route failed", { error: err.slice(0, 300) });
    await recordCronRun({
      job: "autopilot",
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      perSource: [],
      notes: { routeError: err.slice(0, 300) },
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: err.slice(0, 300), results }, { status: 500 });
  }
}
