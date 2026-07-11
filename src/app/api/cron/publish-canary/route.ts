import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { runPublishCanary } from "@/domains/push/publish-canary";
import { log } from "@/lib/logger";
import { beginCronRun, finishCronRun } from "@/domains/ops/cron-runs-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * /api/cron/publish-canary (2026-07-02, master plan item 86) - the nightly
 * publish-path canary. Wix is publish-only (excluded from READ_SOURCES), so
 * without this a dead token or a stale url-map is only discovered when an
 * operator-accepted change fails to push. Every night this proves the path
 * is still alive per tenant: a cheap authenticated READ (list collections)
 * plus ONE executePush dry-run on a representative pushable card, through
 * the exact helper the one-click-publishing arming flow already trusts.
 * READ + DRY-RUN ONLY - never a live write. Ritz stays hard-blocked; the
 * canary records that honestly instead of dry-running a path Ritz can never
 * use. Fail-soft per tenant: one tenant's failure never aborts the rest, and
 * a persistence error never surfaces as a broken cron.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; required,
 * fail-closed (identical to /api/cron/precompute and /api/cron/strategy-review).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("[publish-canary] CRON_SECRET is not set - refusing to run");
    return NextResponse.json({ ok: false, error: "cron_secret_unset" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // T0c deadman receipt: INSERT the started row the moment we are invoked (before
  // any work), so the stall alarm can tell "Vercel never fired this" from
  // "invoked but died mid-run". Finished in place below. Fail-soft: begin never
  // throws, and a wrapper .catch keeps even a mapping bug from changing this
  // route's real response.
  const startedAt = new Date().toISOString();
  const receipt = await beginCronRun({ job: "publish-canary", startedAt });
  try {
    const tenants = await listTenants();
    const results = await runPublishCanary(tenants.map((t) => t.id));
    await finishCronRun(receipt, {
      ok: true,
      perSource: [],
      notes: { tenants: tenants.length },
    }).catch(() => {});
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[publish-canary] route failed", { error: err.slice(0, 300) });
    await finishCronRun(receipt, {
      ok: false,
      perSource: [],
      notes: { routeError: err.slice(0, 300) },
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: err.slice(0, 300) }, { status: 500 });
  }
}
