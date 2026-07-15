import "server-only";

import { hasFactoryBatchForWeek } from "@/domains/page-factory/batch-store";
import {
  mondayOfWeek,
  runProductionLineForTenant,
  type ProductionLineSummary,
} from "@/domains/page-factory/production-line";
import { listRecentCronRuns, recordCronRun, type CronRunRow } from "./cron-runs-store";
import { summarizeJobReceipts } from "./deadman";

export type PageFactoryRecoveryResult =
  | { status: "not_needed"; weekOf: string }
  | { status: "reconciled"; weekOf: string }
  | { status: "recovered"; weekOf: string; summary: ProductionLineSummary }
  | { status: "failed"; weekOf: string; reason: string };

export type PageFactoryRecoveryDeps = {
  listRuns: (job: string, limit: number) => Promise<CronRunRow[]>;
  hasBatch: (tenantId: string, weekOf: string) => Promise<boolean>;
  runFactory: (tenantId: string, weekOf: string, now: Date) => Promise<ProductionLineSummary>;
  recordRun: typeof recordCronRun;
};

const defaultDeps: PageFactoryRecoveryDeps = {
  listRuns: listRecentCronRuns,
  hasBatch: hasFactoryBatchForWeek,
  // Recovery runs inside Next's post-response lifetime. Produce one grounded
  // review brief and defer full prose to normal preparation so this repair
  // cannot monopolize the entire autonomous visit cycle again.
  runFactory: (tenantId, weekOf, now) => runProductionLineForTenant(tenantId, weekOf, {
    now: () => now,
    maxDrafts: 1,
    draftFullPages: false,
  }),
  recordRun: recordCronRun,
};

/**
 * Repair the one expensive failure the operator cannot fix: a weekly page
 * factory invocation that started and died. Every visit may check this, but it
 * only acts on an abandoned receipt and the factory remains idempotent by
 * tenant + week. Successful reconciliation writes a newer finished receipt so
 * the deadman clears on the next render. Failed recovery leaves the abandoned
 * receipt visible rather than manufacturing health.
 */
export async function recoverAbandonedPageFactoryForTenant(
  tenantId: string,
  now: Date = new Date(),
  depsOverride: Partial<PageFactoryRecoveryDeps> = {},
): Promise<PageFactoryRecoveryResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const weekOf = mondayOfWeek(now);
  const runs = await deps.listRuns("page-factory", 10).catch(() => []);
  const state = summarizeJobReceipts(runs, now);
  if (!state.diedMidRunStartedAt) return { status: "not_needed", weekOf };

  const startedAt = now.toISOString();
  if (await deps.hasBatch(tenantId, weekOf).catch(() => false)) {
    await deps.recordRun({
      job: "page-factory",
      tenantId,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      perSource: [],
      notes: { weekOf, recovered_on_visit: true, reconciliation: "batch_already_exists" },
    });
    return { status: "reconciled", weekOf };
  }

  try {
    const summary = await deps.runFactory(tenantId, weekOf, now);
    if (summary.reason.startsWith("error:")) {
      return { status: "failed", weekOf, reason: summary.reason };
    }
    await deps.recordRun({
      job: "page-factory",
      tenantId,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      perSource: [],
      notes: {
        weekOf,
        recovered_on_visit: true,
        reason: summary.reason,
        drafted: summary.drafted,
        queued: summary.queued,
        rejected: summary.rejected,
      },
    });
    return { status: "recovered", weekOf, summary };
  } catch (error) {
    return {
      status: "failed",
      weekOf,
      reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    };
  }
}
