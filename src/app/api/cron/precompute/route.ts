import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { warmTenantCaches, pacificDay } from "@/domains/ops/warm-caches";
import { hasWarmRunForDay, recordWarmRun, type WarmRunReceipt } from "@/domains/ops/warm-receipt-store";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /api/cron/precompute (2026-07-02, BEACON 500 item 13) - the ~5am Pacific
 * (12:00 UTC) warm pass. Rebuilds the demand-graph snapshot, the /changes
 * and Today SWR surfaces, and tonight's daily plan preview BEFORE the
 * operator wakes, so the morning open is instant and full. Warm cache only:
 * no behavior change, no publishes, no new spend paths (see warm-caches.ts).
 *
 * Idempotent per Pacific day: a successful run writes a marker receipt, so a
 * double-fire is a cheap no-op. Iranopedia goes first. Fail-soft per tenant.
 * The Vercel schedule is wired by the orchestrator, not this file.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; required,
 * fail-closed (identical to /api/cron/measure-due).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("[precompute] CRON_SECRET is not set - refusing to run");
    return NextResponse.json({ ok: false, error: "cron_secret_unset" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const results: WarmRunReceipt[] = [];
  try {
    const day = pacificDay(new Date());
    const tenants = await listTenants();
    // Iranopedia first: the tenant the whole loop is being proven on.
    const ordered = [...tenants].sort(
      (a, b) => Number(b.slug.includes("iranopedia")) - Number(a.slug.includes("iranopedia")),
    );
    for (const t of ordered) {
      try {
        if (await hasWarmRunForDay(t.id, day)) {
          results.push({
            tenant_id: t.id,
            date: day,
            ran_at: new Date().toISOString(),
            ok: true,
            totalMs: 0,
            steps: [{ name: "run-marker", ok: true, ms: 0, skipped: true, note: "already warmed today, nothing to redo" }],
          });
          continue;
        }
        const receipt = await warmTenantCaches(t.id, new Date());
        results.push(receipt);
        // Persist the receipt (it doubles as the per-day marker when ok). A
        // failed pass is recorded too, but does NOT mark the day - a re-fire
        // can retry the missed step at zero risk.
        await recordWarmRun(receipt).catch((e) => {
          log.warn("[precompute] receipt write failed", {
            tenantId: t.id,
            error: e instanceof Error ? e.message : String(e),
          });
        });
        log.info("[precompute] tenant warmed", {
          tenantId: t.id,
          ok: receipt.ok,
          totalMs: receipt.totalMs,
          steps: receipt.steps.map((s) => `${s.name}:${s.ok ? (s.skipped ? "skip" : "ok") : "fail"}:${s.ms}ms`).join(","),
        });
      } catch (e) {
        results.push({
          tenant_id: t.id,
          date: day,
          ran_at: new Date().toISOString(),
          ok: false,
          totalMs: 0,
          steps: [{ name: "pass", ok: false, ms: 0, note: (e instanceof Error ? e.message : String(e)).slice(0, 200) }],
        });
        log.warn("[precompute] tenant failed", { tenantId: t.id, error: e instanceof Error ? e.message : "?" });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[precompute] route failed", { error: err.slice(0, 300) });
    return NextResponse.json({ ok: false, error: err.slice(0, 300), results }, { status: 500 });
  }
}
