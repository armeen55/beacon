import Link from "next/link";
import { loadTodayMovesHeroData } from "./today-moves-data";
import { MoveCard } from "./today-moves-card";
import { BulkShipBar } from "./today-moves-bulkship";

/**
 * today-moves-hero (2026-06-24) — the premium "Today's Moves" ritual hero that
 * leads the cockpit. Renders the live Rank-&-Revenue Moves (demand-graph engine,
 * now flowing into the real queue) as rich §7 cards: the move, why now, who AI
 * cites instead + what wins, the grounded outline, the proof plan, and one-tap
 * Ship it. Silent (renders nothing) when the engine is off for the tenant.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function StatTile({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white/70 px-4 py-3">
      <span className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}

export async function TodayMovesHeroSection() {
  let data;
  try {
    data = await loadTodayMovesHeroData();
  } catch {
    return null; // never break the cockpit on a moves-hero load failure
  }
  if (!data.moves.length) return null;

  const { moves, stats } = data;
  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-gray-50 via-white to-violet-50/40 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
            </span>
            <h2 className="text-xl font-bold tracking-tight text-gray-900">Today&apos;s Moves</h2>
          </div>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            The highest-leverage moves Beacon found across your Google + AI demand — each with who
            wins it now, what it takes, and how you&apos;ll know it worked. Review, then ship.
          </p>
        </div>
        <Link
          href="/moves"
          className="rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
        >
          See all moves →
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={String(stats.movesReady)} label="Moves ready" accent="text-gray-900" />
        <StatTile value={fmtNum(stats.demandAtStake)} label="Monthly demand at stake" accent="text-sky-600" />
        <StatTile value={String(stats.citationsContested)} label="AI citations to win" accent="text-violet-600" />
        {stats.draftsReady > 0 ? (
          <StatTile value={String(stats.draftsReady)} label="AI drafts ready" accent="text-emerald-600" />
        ) : (
          <StatTile value={String(stats.pagesCovered)} label="Pages" accent="text-emerald-600" />
        )}
      </div>

      {stats.strikingWins > 0 || stats.losingQueries > 0 || stats.selfCompeting > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
          {stats.strikingWins > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-amber-500">↑</span>
              <span className="font-semibold text-gray-800">{stats.strikingWins}</span> striking-distance{" "}
              {stats.strikingWins === 1 ? "win" : "wins"} (rank 4–15, ready to climb)
            </span>
          ) : null}
          {stats.losingQueries > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-rose-500">↓</span>
              <span className="font-semibold text-gray-800">{stats.losingQueries}</span>{" "}
              {stats.losingQueries === 1 ? "query" : "queries"} losing ground
            </span>
          ) : null}
          {stats.selfCompeting > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-orange-500">⚔</span>
              <span className="font-semibold text-gray-800">{stats.selfCompeting}</span> self-competing
            </span>
          ) : null}
        </div>
      ) : null}

      <BulkShipBar moves={moves.map((m) => ({ id: m.id, targetUrl: m.targetUrl, query: m.query }))} />

      <div className="mt-5 grid gap-3">
        {moves.map((m, i) => (
          <MoveCard key={m.id} m={m} rank={i + 1} />
        ))}
      </div>
    </section>
  );
}
