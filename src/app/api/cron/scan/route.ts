import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runWebsiteScan } from "@/domains/scanning/orchestrate-scan";
import { isScanDisabled } from "@/lib/flags";

/**
 * POST /api/cron/scan — Recommendation Lifecycle OS Phase 5 (2026-04-28).
 *
 * Hosted trigger for a scheduled scan. Mirrors the shape of
 * `/api/poll/run` (auth header + kill switch + structured JSON
 * response) so operator tooling + curl muscle-memory transfer.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` header. Same secret as
 * the native poll cron.
 *
 * **Hosted Vercel limitation (read this first):**
 *
 * `runWebsiteScan` spawns the bare CLI (`scripts/scan-owned-pages.ts`)
 * via `child_process.exec`. The CLI writes to `.data/tenants/{slug}/...`
 * (post-Phase-5 tenant-routed). On Vercel's serverless lambda the
 * filesystem is **read-only** outside `/tmp`, AND tsx is a
 * devDependency that may not be installed in the production lambda
 * image. Calling this route on hosted Vercel WILL FAIL on the CLI
 * spawn step. Today's "Scan now" button has the same constraint and
 * is currently a local-dev-only path.
 *
 * **Canonical scheduled-scan mechanism: GitHub Actions** (see
 * `.github/workflows/daily-scan.yml`). The GH runner has full FS +
 * tsx + npm install access; `scripts/run-scheduled-scan.ts` invokes
 * `runWebsiteScan` directly there. Local-tier dual-write to Supabase
 * carries the canonical state forward; the GH runner's ephemeral FS
 * is wiped at job end.
 *
 * This route exists for:
 *   1. **Local-dev manual trigger** — operator runs the dev server
 *      and curls this endpoint with their CRON_SECRET to fire a
 *      hosted-shaped scan against local `.data`.
 *   2. **Parity surface** — mirrors `/api/poll/run` so future Vercel
 *      Pro upgrade (writable FS + cron) can flip to direct hosted
 *      execution with one workflow file change.
 *   3. **Manual hosted invocation if a future architectural fix
 *      removes the CLI subprocess** — `runWebsiteScan` could be
 *      refactored to inline the extractor logic and skip the
 *      subprocess; until then, hosted invocation will fail loudly.
 *
 * Required env (resolved at request time):
 *   - CRON_SECRET (auth)
 *   - BEACON_TENANT_ID (passed through to runWebsiteScan via
 *     currentTenantId resolver)
 *   - BEACON_TENANT_SLUG (required by post-Phase-5 tenant-routed CLI;
 *     fail-loud at the CLI subprocess if missing)
 *   - DATA_SOURCE / DUAL_WRITE for Supabase persistence
 *
 * Optional env:
 *   - BEACON_SCAN_DISABLED (truthy: "1"/"true"/"yes"/"on") — kill
 *     switch returning 200 OK with {status:"disabled"}.
 *   - BEACON_LIFECYCLE_ENABLED — gates the lifecycle runner inside
 *     runWebsiteScan. NOT enabled by this route on its own.
 */

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // ── Auth ── (must run BEFORE kill-switch check so unauthorized
  // requests never see operational status).
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Phase 5 kill switch ──
  // 200 OK with status:disabled so cron `--fail-with-body` doesn't
  // trip on a deliberate operator pause. Mirrors the
  // BEACON_POLL_DISABLED contract from Sprint 6A.3d.
  if (isScanDisabled()) {
    console.warn(
      "[/api/cron/scan] BEACON_SCAN_DISABLED is set; returning status=disabled without invoking runWebsiteScan",
    );
    return NextResponse.json({
      status: "disabled",
      reason: "BEACON_SCAN_DISABLED env var is set",
    });
  }

  // ── Run ──
  const startedAt = Date.now();
  console.log("[/api/cron/scan] starting runWebsiteScan({ trigger: 'cron' })");
  try {
    const result = await runWebsiteScan({ trigger: "cron" });
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[/api/cron/scan] completed (${elapsedMs}ms): ok=${result.ok} phase=${result.phase} pagesScanned=${result.payload?.pagesScanned} findingsAdded=${result.findingsAdded}`,
    );
    return NextResponse.json({
      ok: result.ok,
      phase: result.phase,
      pagesScanned: result.payload?.pagesScanned ?? 0,
      findingsAdded: result.findingsAdded,
      error: result.error ?? null,
      elapsedMs,
    });
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[/api/cron/scan] error (${elapsedMs}ms): ${message}`);
    return NextResponse.json(
      {
        error: "scan failed",
        message,
        elapsedMs,
      },
      { status: 500 },
    );
  }
}
