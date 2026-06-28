export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/data/page-header";
import { loadMovesWorklist } from "./moves-data";
import { TodayNewPagesSection } from "../today-newpages-section";
import { MovesWorklistClient } from "./moves-worklist-client";

/**
 * /moves (2026-06-25; ActionPack-powered 2026-06-27) — the full Rank-&-Revenue
 * worklist, now driven by the CANONICAL ActionPack brain (`loadMovesWorklist` →
 * `loadActionPackWorklistForTenant`): the same deduped, cross-source-ranked set
 * the unified diagnostic proves, joined to the rich §7 card (ship / draft / title
 * lab / AI draft). Coverage-only AEO packs surface inline. New Pages board below.
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

async function MovesWorklist() {
  let data;
  try {
    data = await loadMovesWorklist();
  } catch {
    data = { moves: [], stats: { movesReady: 0, demandAtStake: 0, citationsContested: 0, pagesCovered: 0, draftsReady: 0, strikingWins: 0, losingQueries: 0, selfCompeting: 0 } };
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
      <MovesWorklistClient moves={moves} />
    </div>
  );
}

export default function MovesPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Moves"
        description="Your ranked Rank-&-Revenue worklist — every move Beacon found across your Google + AI demand, strongest first. Review, draft, ship."
      />
      <Suspense
        fallback={<div className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />}
      >
        <MovesWorklist />
      </Suspense>
      <Suspense fallback={null}>
        {/* AEO-brief button enabled on /moves only (the cockpit "/" still has
            8s-timeout fragility — don't pile interaction onto it yet). */}
        <TodayNewPagesSection enableAeoBrief />
      </Suspense>
    </div>
  );
}
