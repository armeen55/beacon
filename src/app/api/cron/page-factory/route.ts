import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { runProductionLineForTenant, mondayOfWeek, type ProductionLineSummary } from "@/domains/page-factory/production-line";
import { hasFactoryBatchForWeek } from "@/domains/page-factory/batch-store";
import { log } from "@/lib/logger";
import { beginCronRun, finishCronRun } from "@/domains/ops/cron-runs-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * /api/cron/page-factory (2026-07-02, BEACON 500 item 62) - the weekly page
 * factory production line. Every Monday, runs the entity-attribute factory's
 * candidates through $0 cached-demand validation, drafts up to 5 demand-
 * validated pages under the existing quality gates, and STAGES them as a
 * batch the operator reviews on the New Pages board. NEVER publishes - see
 * production-line.ts. Idempotent per (tenant, weekOf): a second call the
 * same week is a no-op per tenant.
 *
 * Does NOT edit vercel.json - the orchestrator wires the actual cron schedule;
 * this route itself still refuses to do real work on a non-Monday call (belt +
 * suspenders: a manually-triggered or misconfigured cron hit any other day is
 * a silent no-op, not an out-of-cycle batch), unless `?force=1` is passed for
 * manual/test runs.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; required,
 * fail-closed (identical to /api/cron/strategy-review and /api/cron/autopilot).
 */

/** True when `now` is a Monday (UTC) - the intended run day. */
export function isMonday(now: Date): boolean {
  return now.getUTCDay() === 1;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("[page-factory-cron] CRON_SECRET is not set - refusing to run");
    return NextResponse.json({ ok: false, error: "cron_secret_unset" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // T0c deadman receipt: INSERT the started row the moment we are invoked
  // (before any work), so the stall alarm can tell "Vercel never fired this"
  // from "invoked but died mid-run". The non-Monday no-op still finishes the
  // receipt - the cron fired, which is what the deadman needs proof of.
  // Fail-soft: begin never throws.
  const startedAt = new Date().toISOString();
  const receipt = await beginCronRun({ job: "page-factory", startedAt });
  const now = new Date();
  const force = request.nextUrl.searchParams.get("force") === "1";
  if (!isMonday(now) && !force) {
    await finishCronRun(receipt, {
      ok: true,
      perSource: [],
      notes: { skipped: true, reason: "not_monday" },
    }).catch(() => {});
    return NextResponse.json({ ok: true, skipped: true, reason: "not_monday" });
  }

  const weekOf = mondayOfWeek(now);

  const results: Array<{ tenantId: string; result: ProductionLineSummary }> = [];
  try {
    const tenants = await listTenants();
    for (const t of tenants) {
      try {
        if (await hasFactoryBatchForWeek(t.id, weekOf)) {
          results.push({
            tenantId: t.id,
            result: { tenantId: t.id, weekOf, ran: false, reason: "already_ran", drafted: 0, queued: 0, rejected: 0, costUsd: 0, batch: null },
          });
          continue;
        }
        results.push({ tenantId: t.id, result: await runProductionLineForTenant(t.id, weekOf, { now: () => now }) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        results.push({
          tenantId: t.id,
          result: { tenantId: t.id, weekOf, ran: false, reason: `error: ${error}`.slice(0, 300), drafted: 0, queued: 0, rejected: 0, costUsd: 0, batch: null },
        });
        log.warn("[page-factory-cron] tenant failed", { tenantId: t.id, error });
      }
    }
    await finishCronRun(receipt, {
      ok: true,
      perSource: [],
      notes: { weekOf, tenants: results.length },
    }).catch(() => {});
    return NextResponse.json({ ok: true, weekOf, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[page-factory-cron] route failed", { error: err.slice(0, 300) });
    await finishCronRun(receipt, {
      ok: false,
      perSource: [],
      notes: { weekOf, routeError: err.slice(0, 300) },
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: err.slice(0, 300), weekOf, results }, { status: 500 });
  }
}
