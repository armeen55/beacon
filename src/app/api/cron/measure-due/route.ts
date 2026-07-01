import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { measureDueForTenant, type AutoMeasureResult } from "@/domains/proof-gsc/auto-measure";
import { log } from "@/lib/logger";

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

  const results: AutoMeasureResult[] = [];
  try {
    const tenants = await listTenants();
    for (const t of tenants) {
      try {
        results.push(await measureDueForTenant(t.id));
      } catch (e) {
        results.push({ tenantId: t.id, measuring: 0, remeasured: 0, settled: 0, errors: 1 });
        log.warn("[measure-due] tenant failed", { tenantId: t.id, error: e instanceof Error ? e.message : "?" });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[measure-due] route failed", { error: err.slice(0, 300) });
    return NextResponse.json({ ok: false, error: err.slice(0, 300), results }, { status: 500 });
  }
}
