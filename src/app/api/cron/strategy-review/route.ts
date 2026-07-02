import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { runStrategyReview, type RunStrategyReviewResult } from "@/domains/strategy-review/run-strategy-review";
import { hasStrategyMixForWeek } from "@/domains/strategy-review/strategy-mix-store";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * /api/cron/strategy-review (2026-07-02, BEACON 500 item 51) - the weekly strategy
 * review. Every Sunday, one budget-gated LLM pass per tenant reads the settled dossier
 * (build-dossier.ts) and reallocates the COMING week's plan posture: a lever mix + up
 * to 3 focus families + a signed memo (run-strategy-review.ts). Idempotent per
 * (tenant, weekOf): a second call the same week is a no-op per tenant.
 *
 * Does NOT edit vercel.json - the orchestrator wires the actual cron schedule; this
 * route itself still refuses to do real work on a non-Sunday call (belt + suspenders:
 * a manually-triggered or misconfigured cron hit any other day is a silent no-op, not
 * an out-of-cycle reallocation), unless `?force=1` is passed for manual/test runs.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; required, fail-closed
 * (identical to /api/cron/autopilot and /api/cron/measure-due).
 */

/** Monday of the week containing `now`, as an ISO date (YYYY-MM-DD), UTC. Stable
 *  "weekOf" key: the same calendar week always resolves to the same Monday regardless
 *  of which day inside it the cron actually fires. */
export function mondayOfWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

/** True when `now` is a Sunday (UTC) - the intended run day. */
export function isSunday(now: Date): boolean {
  return now.getUTCDay() === 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("[strategy-review-cron] CRON_SECRET is not set - refusing to run");
    return NextResponse.json({ ok: false, error: "cron_secret_unset" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const force = request.nextUrl.searchParams.get("force") === "1";
  if (!isSunday(now) && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: "not_sunday" });
  }

  // The mix applies to the COMING week: a Sunday-night run's "weekOf" is the Monday
  // that starts the day after, not the week just ending.
  const nextMonday = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const weekOf = mondayOfWeek(nextMonday);

  const results: Array<{ tenantId: string; result: RunStrategyReviewResult }> = [];
  try {
    const tenants = await listTenants();
    for (const t of tenants) {
      try {
        if (await hasStrategyMixForWeek(t.id, weekOf)) {
          results.push({ tenantId: t.id, result: { ran: false, weekOf, record: null, reason: "already_ran" } });
          continue;
        }
        results.push({ tenantId: t.id, result: await runStrategyReview(t.id, weekOf, { now }) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        results.push({ tenantId: t.id, result: { ran: false, weekOf, record: null, reason: `error: ${error}`.slice(0, 300) } });
        log.warn("[strategy-review-cron] tenant failed", { tenantId: t.id, error });
      }
    }
    return NextResponse.json({ ok: true, weekOf, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[strategy-review-cron] route failed", { error: err.slice(0, 300) });
    return NextResponse.json({ ok: false, error: err.slice(0, 300), weekOf, results }, { status: 500 });
  }
}
