import { NextResponse, type NextRequest } from "next/server";
import { syncAllConnectedForActiveTenants } from "@/lib/connectors/cron-sync";
import { log } from "@/lib/logger";

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

  try {
    const result = await syncAllConnectedForActiveTenants();
    return NextResponse.json({ ok: true, summary: result });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[cron-sync] route failed", { error: err.slice(0, 300) });
    return NextResponse.json({ ok: false, error: err.slice(0, 300) }, { status: 500 });
  }
}
