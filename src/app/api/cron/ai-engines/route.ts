import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/domains/tenants/store";
import { runEnginePollForTenant, type EnginePollResult } from "@/domains/ai-visibility/run-engine-poll";
import { log } from "@/lib/logger";
import { recordCronRun } from "@/domains/ops/cron-runs-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * /api/cron/ai-engines (2026-07-01, master plan item 4) - the nightly
 * 4-engine question check. Runs the tenant's tracked questions across
 * ChatGPT + Perplexity (native keys, skipped when absent) and Gemini +
 * Claude (DataForSEO llm_responses, full money gauntlet: cache, dry-run
 * default, shared fail-closed monthly cap, ledger), writes answers into the
 * same observation tables the native poll uses, and stores the per-engine
 * gap diff that feeds Today's AI band + tonight's candidate list.
 *
 * Bounded + idempotent: top 25 prompts, 2 paid engines (~$1.50/night
 * ceiling), one real run per tenant per UTC night. Iranopedia goes first.
 * The Vercel schedule is wired by the orchestrator, not this file.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; required,
 * fail-closed (same contract as measure-due / sync-connectors).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("[ai-engines] CRON_SECRET is not set - refusing to run");
    return NextResponse.json({ ok: false, error: "cron_secret_unset" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // T0c deadman receipt: one cron_runs row per invocation (fail-soft) so the
  // stall alarm + health panel can watch this job like every other.
  const startedAt = new Date().toISOString();
  const results: EnginePollResult[] = [];
  try {
    const tenants = await listTenants();
    // Iranopedia first: the tenant the whole loop is being proven on.
    const ordered = [...tenants].sort(
      (a, b) => Number(b.slug.includes("iranopedia")) - Number(a.slug.includes("iranopedia")),
    );
    for (const t of ordered) {
      try {
        results.push(await runEnginePollForTenant(t.id));
      } catch (e) {
        log.warn("[ai-engines] tenant failed", { tenantId: t.id, error: e instanceof Error ? e.message : "?" });
        results.push({
          tenantId: t.id,
          date: new Date().toISOString().slice(0, 10),
          status: "error",
          promptsRequested: 0,
          engines: [],
          observationsWritten: 0,
          enginesChecked: [],
          gaps: 0,
          detail: e instanceof Error ? e.message.slice(0, 200) : "unknown error",
        });
      }
    }
    await recordCronRun({
      job: "ai-engines",
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: results.every((r) => r.status !== "error"),
      perSource: [],
      notes: {
        tenants: results.length,
        errors: results.filter((r) => r.status === "error").length,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error("[ai-engines] route failed", { error: err.slice(0, 300) });
    await recordCronRun({
      job: "ai-engines",
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      perSource: [],
      notes: { routeError: err.slice(0, 300) },
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: err.slice(0, 300), results }, { status: 500 });
  }
}
