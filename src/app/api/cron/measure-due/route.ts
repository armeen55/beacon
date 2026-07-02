import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { measureDueForTenant, type AutoMeasureResult } from "@/domains/proof-gsc/auto-measure";
import { log } from "@/lib/logger";
import { recordCronRun } from "@/domains/ops/cron-runs-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /api/cron/measure-due (2026-07-01, FINAL PREMIUM PLAN item 79) - the nightly measurement pass.
 * Re-measures every MEASURING shipped change against fresh GSC (after the 9:00 connector sync)
 * and persists verdicts, so results land without anyone opening the app. Measurement only:
 * no publishes, no plan writes, no paid APIs.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; required, fail-closed.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("[measure-due] CRON_SECRET is not set - refusing to run");
    return NextResponse.json({ ok: false, error: "cron_secret_unset" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const results: AutoMeasureResult[] = [];
  try {
    const tenants = await listTenants();
    for (const t of tenants) {
      try {
        results.push(await measureDueForTenant(t.id));
      } catch (e) {
        results.push({ tenantId: t.id, measuring: 0, remeasured: 0, settled: 0, errors: 1, recrawlInspections: 0 });
        log.warn("[measure-due] tenant failed", { tenantId: t.id, error: e instanceof Error ? e.message : "?" });
      }
    }
    await writeLedgerRow(startedAt, results, null);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[measure-due] route failed", { error: err.slice(0, 300) });
    await writeLedgerRow(startedAt, results, err.slice(0, 300));
    return NextResponse.json({ ok: false, error: err.slice(0, 300), results }, { status: 500 });
  }
}

/**
 * Cron health ledger (BEACON_500 item 85, 2026-07-03): one row per run so the
 * /settings/connectors health panel has a durable history instead of log
 * lines that vanish. FAIL-SOFT: recordCronRun never throws on its own, but
 * this wrapper also swallows any error so a ledger-write bug can never
 * change this route's real response.
 */
async function writeLedgerRow(
  startedAt: string,
  results: ReadonlyArray<AutoMeasureResult>,
  routeError: string | null,
): Promise<void> {
  try {
    const errorsTotal = results.reduce((sum, r) => sum + r.errors, 0);
    await recordCronRun({
      job: "measure-due",
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: routeError == null && errorsTotal === 0,
      perSource: results.map((r) => ({
        tenantId: r.tenantId,
        provider: "measure",
        ok: r.errors === 0,
        detail:
          r.errors > 0
            ? `${r.errors} error(s) during measurement`
            : `measuring=${r.measuring} remeasured=${r.remeasured} settled=${r.settled}`,
      })),
      notes: { routeError, tenants: results.length },
    });
  } catch (e) {
    log.warn("[measure-due] ledger write threw unexpectedly", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
