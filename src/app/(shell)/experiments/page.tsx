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
  // IA consolidation (2026-06-23): available to everyone, no operator gate.

  const tenantId = await currentTenantId();
  const rows = await loadBatchExperimentRows(tenantId).catch(() => []);
  const cards = selectExperimentBatch(rows);

  const updatedOn = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Changes to try next</h1>
          <span className="text-[12px] text-muted-foreground">Updated {updatedOn}</span>
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">
          The best changes to make today, ranked by impact and picked so you can
          clearly measure each one. Pages you are already testing are left out so
          their results stay clean. None of these buttons touch your website. You
          make each change yourself.
        </p>
      </div>
      <ExperimentsClient cards={cards} />
    </div>
  );
}
