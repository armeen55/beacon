import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { warmTenantCaches, pacificDay } from "@/domains/ops/warm-caches";
import { hasWarmRunForDay, recordWarmRun, type WarmRunReceipt } from "@/domains/ops/warm-receipt-store";
import { log } from "@/lib/logger";
import { beginCronRun, finishCronRun } from "@/domains/ops/cron-runs-store";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Warm one tenant under ITS OWN ambient context (2026-07-11, BUG 1 fix).
 *
 * The surface stores + warm-caches' cross-tenant guard resolve their scope from
 * the ambient tenant context. A single cron invocation warming many tenants
 * inline used to leave that context at the request's ambient (BEACON_TENANT_ID
 * = ritz), so every non-ritz tenant tripped the guard ("the active tenant
 * context is tenant-ritz-founder, not <tenant>, so we skipped to protect its
 * caches"). `runWithTenant` carries the EXPLICIT tenant end-to-end for the whole
 * warm, so each tenant warms under its own context, with no per-tenant HTTP
 * self-call, no dependence on the middleware forwarding a header. The guard
 * stays intact: ambient now equals the tenant being warmed.
 */
function warmTenantExplicit(tenantId: string): Promise<WarmRunReceipt> {
  return runWithTenant(tenantId, () => warmTenantCaches(tenantId, new Date()));
}

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

  // T0c deadman receipt: INSERT the started row the moment we are invoked (before
  // any work), so the stall alarm can tell "Vercel never fired this" from
  // "invoked but died mid-run". Finished in place below. Fail-soft: begin never
  // throws.
  const startedAt = new Date().toISOString();
  const receipt = await beginCronRun({ job: "precompute", startedAt });
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
        const receipt = await warmTenantExplicit(t.id);
        results.push(receipt);
        // Persist the receipt (it doubles as the per-day marker when ok). A
        // failed pass is recorded too, but does NOT mark the day - a re-fire
        // can retry the missed step at zero risk.
        await recordWarmRun({ ...receipt, trigger: "cron" }).catch((e) => {
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
    // Per-tenant independence (2026-07-06): one tenant's warm failing must not
    // hide that the CORE tenant succeeded. Iranopedia is warmed first (the
    // ordered list above) and is the tenant the whole loop is proven on, so it
    // is the core. The run is `ok` when at least the core tenant warmed; a
    // non-core tenant failing is flagged as degraded in the notes, not a red
    // run. Before this, `results.every(ok)` let a single non-core tenant's warm
    // failure mask that the core was fully warm. When there is no core tenant
    // (empty fleet), fall back to "all warmed".
    const coreReceipt = results[0] ?? null; // Iranopedia sorts first
    const coreOk = coreReceipt == null ? true : coreReceipt.ok;
    const degradedTenants = results.filter((r) => !r.ok);
    await finishCronRun(receipt, {
      ok: coreOk,
      perSource: [],
      notes: {
        tenants: results.length,
        coreTenantId: coreReceipt?.tenant_id ?? null,
        coreOk,
        degradedTenants: degradedTenants.length,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[precompute] route failed", { error: err.slice(0, 300) });
    await finishCronRun(receipt, {
      ok: false,
      perSource: [],
      notes: { routeError: err.slice(0, 300) },
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: err.slice(0, 300), results }, { status: 500 });
  }
}
