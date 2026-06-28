export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/data/page-header";
import { loadMovesWorklist } from "../moves/moves-data";
import { MoveCard } from "../today-moves-card";
import { PrepareTopMovesButton } from "../today-moves-prepare";

/**
 * /experiments (2026-06-28 — ActionPack execution loop) — "Ready to ship": the
 * ActionPacks that have been prepared end-to-end (structured draft + experiment +
 * proof plan) and are ready for the operator to make the change. Driven by the
 * canonical worklist (`loadMovesWorklist`), filtered to readyToReview. Each card's
 * "Ship it" records a proof-ledger entry (via respondToRecommendation →
 * autoRecordShippedChangeForRec), starting the measurement clock — closing
 * prepare → ship → measure. Nothing publishes automatically. Replaces the legacy
 * batch-experiment planner.
 */
async function ReadyToShip() {
  const data = await loadMovesWorklist().catch(() => null);
  const all = data?.moves ?? [];
  const ready = all.filter((m) => m.preparedChecklist?.readyToReview);
  const preparedReady = data?.stats.preparedReady ?? ready.length;

  if (ready.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            Nothing is prepared to ship yet. Prepare your strongest moves end-to-end — draft,
            experiment, and proof plan — then they appear here ready to make.
          </p>
          <PrepareTopMovesButton readyCount={0} total={all.length} />
        </div>
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No moves are ready to ship. Click “Prepare my top 10” to draft + proof-plan the strongest
          moves; once prepared they show up here with paste-ready copy and a measurement plan.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {ready.length} move{ready.length === 1 ? "" : "s"} prepared end-to-end. Make each change
          yourself, then hit “Ship it” to start measuring the lift. Nothing here touches your site.
        </p>
        <PrepareTopMovesButton readyCount={preparedReady} total={all.length} />
      </div>
      <div className="grid gap-3">
        {ready.map((m, i) => (
          <MoveCard key={m.id} m={m} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}

export default function ExperimentsPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Ready to ship"
        description="ActionPacks prepared end-to-end — draft, experiment, and proof plan ready. Make the change yourself, then mark it shipped to measure the lift. Nothing here publishes automatically."
      />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />}>
        <ReadyToShip />
      </Suspense>
    </div>
  );
}
