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

  // Safe-first ordering: a page already in an open proof window should NOT sit at the
  // top with a normal-looking "Ship it" — shipping again muddies its measurement. Split
  // safe-to-ship from measuring and demote the latter into its own clearly-labelled band.
  const safe = ready.filter((m) => !m.alreadyMeasuring && !m.pageMeasuring);
  const measuring = ready.filter((m) => m.alreadyMeasuring || m.pageMeasuring);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {safe.length} safe to ship now{measuring.length > 0 ? `, ${measuring.length} already measuring` : ""}.
          Make each change yourself, then hit “Ship it” to start measuring the lift. Nothing here touches your site.
        </p>
        <PrepareTopMovesButton readyCount={preparedReady} total={all.length} />
      </div>

      {safe.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Safe to ship now</h2>
          <div className="grid gap-3">
            {safe.map((m, i) => (
              <MoveCard key={m.id} m={m} rank={i + 1} />
            ))}
          </div>
        </section>
      ) : (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          Nothing is safe to ship right now — every prepared move below is already in an open proof window.
        </p>
      )}

      {measuring.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-amber-800">Already in a proof window ({measuring.length})</h2>
            <p className="mt-0.5 text-[12px] text-amber-700">
              These pages are mid-measurement. Ship one only if you intentionally want to start a new change and
              muddy the current measurement.
            </p>
          </div>
          <div className="grid gap-3 opacity-90">
            {measuring.map((m, i) => (
              <MoveCard key={m.id} m={m} rank={safe.length + i + 1} />
            ))}
          </div>
        </section>
      ) : null}
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
