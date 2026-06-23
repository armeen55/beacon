import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadBatchExperimentRows } from "@/domains/insight/batch-experiment-loader";
import { selectExperimentBatch } from "@/domains/insight/select-experiment-batch";
import { ExperimentsClient } from "./experiments-client";

/**
 * Batch Experiment Planner (TASK 4) — the daily operating surface.
 *
 * Picks the next 5 to 10 safe, high-upside changes to make today across pages,
 * each with paste-ready copy + proof instructions, built on the per-page TASK-3
 * optimizer. Pages already under measurement are held out so a new change never
 * muddies an open proof window. Read-only: nothing publishes here. Operator-gated.
 */
export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  if (!isOperatorModeServer()) notFound();

  const tenantId = await currentTenantId();
  const rows = await loadBatchExperimentRows(tenantId).catch(() => []);
  const cards = selectExperimentBatch(rows);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Next experiment batch</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          The next changes to ship today, ranked by impact and chosen for a mix you
          can measure. Pages already running an experiment are held out so you do
          not muddy an open proof window. Nothing publishes here.
        </p>
      </div>
      <ExperimentsClient cards={cards} />
    </div>
  );
}
