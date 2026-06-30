export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/data/page-header";
import { loadMovesWorklist } from "../moves/moves-data";
import { TodayNewPagesSection } from "../today-newpages-section";
import { MovesWorklistClient } from "../moves/moves-worklist-client";
import { PrepareTopMovesButton, RegenerateFromTeardownButton, EnrichResearchButton } from "../today-moves-prepare";

/**
 * /worklist (2026-06-28 — route consolidation) — THE canonical Rank-&-Revenue
 * worklist, the one ActionPack brain (`loadMovesWorklist` →
 * `loadActionPackWorklistForTenant`): the deduped, cross-source-ranked set the
 * unified diagnostic proves, joined to the rich card (ship / draft / title lab /
 * AI draft). Replaces the old 6-row worklist + the Moves/Opportunities split —
 * /moves and /opportunities now redirect here. New Pages board below.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function StatTile({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <span className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}

async function Worklist() {
  let data;
  try {
    data = await loadMovesWorklist();
  } catch {
    data = { moves: [], stats: { movesReady: 0, demandAtStake: 0, citationsContested: 0, pagesCovered: 0, draftsReady: 0, strikingWins: 0, losingQueries: 0, selfCompeting: 0, heldWhileMeasuring: 0, preparedReady: 0 } };
  }
  const { moves, stats } = data;

  if (!moves.length) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No Rank-&-Revenue moves yet. Once your search + AI demand data syncs, Beacon&apos;s ranked moves
        appear here.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={String(stats.movesReady)} label="Moves ranked" accent="text-gray-900" />
        <StatTile value={fmtNum(stats.demandAtStake)} label="Monthly demand at stake" accent="text-sky-600" />
        <StatTile value={String(stats.citationsContested)} label="AI citations to win" accent="text-violet-600" />
        {stats.draftsReady > 0 ? (
          <StatTile value={String(stats.draftsReady)} label="AI drafts ready" accent="text-emerald-600" />
        ) : (
          <StatTile value={String(stats.pagesCovered)} label="Pages" accent="text-emerald-600" />
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Let Beacon prepare the top moves end-to-end — structured draft, experiment, and proof plan — so each arrives ready to review.
        </p>
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-start">
          <RegenerateFromTeardownButton />
          <EnrichResearchButton />
          <PrepareTopMovesButton readyCount={stats.preparedReady ?? 0} total={moves.length} />
        </div>
      </div>
      <MovesWorklistClient moves={moves} />
      {stats.movesReady > moves.length ? (
        <p className="text-center text-xs text-gray-400">
          Showing the {moves.length} strongest of {stats.movesReady} ranked moves. Use the filters above to narrow.
        </p>
      ) : null}
    </div>
  );
}

export default function WorklistPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Worklist"
        description="Your ranked Rank-&-Revenue worklist — every move Beacon found across your Google + AI demand, strongest first. Review, draft, ship."
      />
      <Suspense
        fallback={<div className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />}
      >
        <Worklist />
      </Suspense>
      <Suspense fallback={null}>
        <TodayNewPagesSection enableAeoBrief />
      </Suspense>
    </div>
  );
}
