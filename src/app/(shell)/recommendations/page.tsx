export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/data/page-header";
import { loadMovesWorklist } from "../moves/moves-data";
import { TodayNewPagesSection } from "../today-newpages-section";
import { PrepareTopMovesButton } from "../today-moves-prepare";
import { DraftsClient } from "./drafts-client";
import { draftStatusOf } from "./draft-status";

/**
 * /recommendations — "Drafts" (2026-06-28 — ActionPack execution loop).
 *
 * Rebuilt off the canonical ActionPack worklist (loadMovesWorklist → rich TodayMove)
 * instead of the legacy recommended_edits queue. Each card is a prepared ActionPack
 * asset: draft/brief + evidence chips + copy buttons + "Ship it" (which records a
 * proof entry, closing prepare → ship → measure). Status tabs separate Ready /
 * Ready to draft / Needs review. New Pages drafts board below.
 *
 * The deep per-rec brief + armed-publish review still live on /recommendations/[id]
 * (unchanged) — deep links there are preserved.
 */

async function Drafts() {
  const data = await loadMovesWorklist().catch(() => null);
  const moves = data?.moves ?? [];
  const ready = moves.filter((m) => draftStatusOf(m) === "ready").length;
  const readyToDraft = moves.filter((m) => draftStatusOf(m) === "ready_to_draft").length;
  const preparedReady = data?.stats.preparedReady ?? 0;

  if (moves.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No drafts yet. Once your Search + AI demand data syncs, prepared fixes and briefs appear here.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {ready} ready to review · {readyToDraft} ready to draft. Review the copy, paste it, then ship to measure.
        </p>
        <PrepareTopMovesButton readyCount={preparedReady} total={moves.length} />
      </div>
      <DraftsClient moves={moves} />
    </div>
  );
}

export default function DraftsPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Drafts"
        description="Prepared fixes and briefs from your ActionPack worklist — review, copy, or ship when ready. The full brief + publish review opens on each card's detail."
      />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />}>
        <Drafts />
      </Suspense>
      {/* New Pages drafts (create/coverage half of the brain) — AI-validated badges
          + Draft AEO brief live here. */}
      <Suspense fallback={null}>
        <TodayNewPagesSection enableAeoBrief />
      </Suspense>
    </div>
  );
}
